import { Hono } from "hono";
import { Store } from "./store";
import { handleMcp } from "./mcp";

type Env = {
  DB: D1Database;
  AGENT_TOKEN?: string;        // Bearer do agente (MCP/API)
  ACCESS_TEAM_DOMAIN?: string; // ex.: suaequipe.cloudflareaccess.com
  ACCESS_AUD?: string;         // Application Audience (AUD) do app no Access
  DEV_OPEN?: string;           // "1" só no .dev.vars local
  CHANNEL_NAME?: string; CHANNEL_HANDLE?: string; AVATAR_URL?: string;
};
type Vars = { store: Store };
const app = new Hono<{ Bindings: Env; Variables: Vars }>();

// Auth
// - Agente: Authorization: Bearer AGENT_TOKEN.
// - Pessoa: Cloudflare Access na frente do hostname; o JWT (Cf-Access-Jwt-Assertion) é verificado aqui.
// - Dev: DEV_OPEN=1 no .dev.vars, sem segredos, só em localhost.
const enc = new TextEncoder();
export function safeEqual(a: string, b: string) {
  const x = enc.encode(a), y = enc.encode(b);
  if (x.byteLength !== y.byteLength) return false;
  return (crypto.subtle as unknown as { timingSafeEqual(a: ArrayBufferView, b: ArrayBufferView): boolean }).timingSafeEqual(x, y);
}
const b64url = (s: string) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4)), (c) => c.charCodeAt(0));
let certs: { at: number; keys: JsonWebKey[] } | null = null;
async function verifyAccess(jwt: string, team: string, aud: string) {
  const [h, p, sig] = jwt.split(".");
  if (!h || !p || !sig) return false;
  const header = JSON.parse(new TextDecoder().decode(b64url(h)));
  const claims = JSON.parse(new TextDecoder().decode(b64url(p)));
  const now = Date.now() / 1000;
  const auds: string[] = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (header.alg !== "RS256" || !auds.includes(aud) || claims.iss !== `https://${team}` || !(claims.exp > now) || (claims.nbf && claims.nbf > now + 60)) return false;
  const load = async () => { const r = await fetch(`https://${team}/cdn-cgi/access/certs`); certs = { at: Date.now(), keys: ((await r.json()) as { keys: JsonWebKey[] }).keys }; };
  if (!certs || Date.now() - certs.at > 3600_000) await load();
  let jwk = certs!.keys.find((k: any) => k.kid === header.kid);
  if (!jwk && Date.now() - certs!.at > 60_000) { await load(); jwk = certs!.keys.find((k: any) => k.kid === header.kid); } // chave rotacionada
  if (!jwk) return false;
  const key = await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
  return crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, b64url(sig), enc.encode(`${h}.${p}`));
}

app.use("*", async (c, next) => {
  const { AGENT_TOKEN: token, ACCESS_TEAM_DOMAIN: team, ACCESS_AUD: aud } = c.env;
  const bearer = c.req.header("authorization")?.replace(/^Bearer\s+/i, "") || "";
  const isAgent = !!token && !!bearer && safeEqual(bearer, token);
  let ok = isAgent;
  if (!ok && team && aud) {
    const jwt = c.req.header("cf-access-jwt-assertion");
    ok = !!jwt && (await verifyAccess(jwt, team, aud).catch(() => false));
  }
  // Sem nada configurado, só libera em localhost (dev). Em produção, sem segredos = tudo fechado.
  const host = new URL(c.req.url).hostname;
  if (!ok && c.env.DEV_OPEN === "1" && !token && !team && !aud && (host === "localhost" || host === "127.0.0.1")) ok = true;
  if (!ok) return c.json({ error: "unauthorized" }, 401);
  if (["POST", "PATCH", "PUT", "DELETE"].includes(c.req.method) && !(c.req.header("content-type") || "").startsWith("application/json"))
    return c.json({ error: "content-type deve ser application/json" }, 415);
  c.set("store", new Store(c.env.DB, isAgent ? "agente" : "owner"));
  await next();
});

app.all("/mcp", (c) => handleMcp(c.req.raw, c.var.store));

app.get("/api/bootstrap", async (c) => c.json({
  ...(await c.var.store.bootstrap()),
  channel: { name: c.env.CHANNEL_NAME || "Seu Canal", handle: c.env.CHANNEL_HANDLE || "seucanal", avatar: c.env.AVATAR_URL || "/avatar.svg" },
}));
app.get("/api/videos", async (c) => c.json(await c.var.store.list(c.req.query())));
app.get("/api/videos/:id", async (c) => {
  const v = await c.var.store.get(c.req.param("id"));
  return v ? c.json(v) : c.json({ error: "not found" }, 404);
});
app.post("/api/videos", async (c) => c.json(await c.var.store.create(await c.req.json()), 201));
app.patch("/api/videos/:id", async (c) => {
  const v = await c.var.store.update(c.req.param("id"), await c.req.json());
  return v ? c.json(v) : c.json({ error: "not found" }, 404);
});
app.post("/api/videos/:id/move", async (c) => {
  const b = await c.req.json<{ status: string; position?: number }>();
  return c.json(await c.var.store.move(c.req.param("id"), b.status, b.position));
});
app.delete("/api/videos/:id", async (c) => c.json(await c.var.store.remove(c.req.param("id"))));
app.get("/api/yt-title", async (c) => {
  const id = (c.req.query("id") || "").replace(/[^\w-]/g, "");
  const r = await fetch(`https://www.youtube.com/oembed?format=json&url=https://www.youtube.com/watch?v=${id}`);
  if (!r.ok) return c.json({ title: null });
  const j = await r.json<{ title: string; author_name: string }>();
  return c.json({ title: j.title, author: j.author_name }, 200, { "cache-control": "private, max-age=86400" });
});
app.post("/api/assets", async (c) => {
  if (Number(c.req.header("content-length") || 0) > 2_100_000) return c.json({ error: "imagem grande demais" }, 413);
  const { data } = await c.req.json<{ data: string }>();
  if (typeof data !== "string" || data.length > 2_100_000) return c.json({ error: "imagem grande demais" }, 413);
  const m = /^data:(image\/(?:png|jpeg|webp|gif));base64,([A-Za-z0-9+/=]+)$/.exec(data);
  if (!m) return c.json({ error: "imagem inválida" }, 400);
  const bytes = Uint8Array.from(atob(m[2]), (ch) => ch.charCodeAt(0));
  if (bytes.length > 1_500_000) return c.json({ error: "imagem grande demais" }, 413);
  const id = crypto.randomUUID().replace(/-/g, "").slice(0, 16);
  await c.env.DB.prepare("INSERT INTO assets (id, mime, data) VALUES (?, ?, ?)").bind(id, m[1], bytes).run();
  return c.json({ id, url: `/api/assets/${id}` }, 201);
});
app.get("/api/assets/:id", async (c) => {
  const r = await c.env.DB.prepare("SELECT mime, data FROM assets WHERE id = ?").bind(c.req.param("id")).first<{ mime: string; data: ArrayBuffer }>();
  if (!r) return c.json({ error: "not found" }, 404);
  return new Response(new Uint8Array(r.data as any), { headers: {
    "content-type": /^image\/(png|jpeg|webp|gif)$/.test(r.mime) ? r.mime : "application/octet-stream",
    "x-content-type-options": "nosniff", "content-security-policy": "default-src 'none'; sandbox", "content-disposition": "inline",
    "cache-control": "private, max-age=31536000, immutable",
  } });
});
app.get("/api/series/:id/next-episode", async (c) => c.json({ episode: await c.var.store.nextEpisode(c.req.param("id")) }));

export default app;
