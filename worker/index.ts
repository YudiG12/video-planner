import { Hono } from "hono";
import { safeEqual, verifyAccess } from "./auth";
export { safeEqual }; // used by worker/agent.ts
import { Store, saveAsset, isBlockError } from "./store";
import { handleMcp } from "./mcp";
import { liveNotifier, liveStub, type LiveHub } from "./live";
export { LiveHub } from "./live";

type Env = {
  DB: D1Database;
  LIVE?: DurableObjectNamespace<LiveHub>; // live-update hub (agent Worker binds it via script_name)
  AGENT_TOKEN?: string;        // agent Bearer token (MCP/API)
  ACCESS_TEAM_DOMAIN?: string; // e.g. yourteam.cloudflareaccess.com
  ACCESS_AUD?: string;         // Access app's Application Audience (AUD)
  DEV_OPEN?: string;           // "1" only in local .dev.vars
  LOCALE?: string;             // "pt-BR" for a Portuguese UI (default: English)
  CHANNEL_NAME?: string; CHANNEL_HANDLE?: string; AVATAR_URL?: string;
};
type Vars = { store: Store };
const app = new Hono<{ Bindings: Env; Variables: Vars }>();

// Auth
// - Agent: Authorization: Bearer AGENT_TOKEN.
// - Person: Cloudflare Access in front of the hostname; the JWT (Cf-Access-Jwt-Assertion) is verified here.
// - Dev: DEV_OPEN=1 in .dev.vars, no secrets, localhost only.

app.use("*", async (c, next) => {
  const { AGENT_TOKEN: token, ACCESS_TEAM_DOMAIN: team, ACCESS_AUD: aud } = c.env;
  const bearer = c.req.header("authorization")?.replace(/^Bearer\s+/i, "") || "";
  const isAgent = !!token && !!bearer && safeEqual(bearer, token);
  let ok = isAgent;
  if (!ok && team && aud) {
    const jwt = c.req.header("cf-access-jwt-assertion");
    ok = !!jwt && (await verifyAccess(jwt, team, aud).catch(() => false));
  }
  // With nothing configured, only localhost (dev) is allowed. In production, no secrets = everything locked.
  const host = new URL(c.req.url).hostname;
  if (!ok && c.env.DEV_OPEN === "1" && !token && !team && !aud && (host === "localhost" || host === "127.0.0.1")) ok = true;
  if (!ok) return c.json({ error: "unauthorized" }, 401);
  if (["POST", "PATCH", "PUT", "DELETE"].includes(c.req.method) && !(c.req.header("content-type") || "").startsWith("application/json"))
    return c.json({ error: "content-type must be application/json" }, 415);
  const actor = isAgent ? "agente" : "owner";
  // x-client-id: random per-tab id the app sends, so a tab can skip the echo of its own writes
  const origin = (c.req.header("x-client-id") || "").replace(/[^\w-]/g, "").slice(0, 40);
  c.set("store", new Store(c.env.DB, actor, liveNotifier(c.env, c.executionCtx, actor, origin)));
  await next();
});

// Live updates (WebSocket). Same auth as every other route (middleware above); the hub only accepts upgrades here.
app.get("/api/live", (c) => {
  const hub = liveStub(c.env);
  if (!hub) return c.json({ error: "live updates not configured" }, 501);
  if (c.req.header("upgrade")?.toLowerCase() !== "websocket") return c.json({ error: "expected websocket" }, 426);
  return hub.fetch(c.req.raw);
});

app.all("/mcp", (c) => handleMcp(c.req.raw, c.var.store));

app.get("/api/bootstrap", async (c) => c.json({
  ...(await c.var.store.bootstrap()),
  locale: c.env.LOCALE === "pt-BR" ? "pt-BR" : "en",
  channel: { name: c.env.CHANNEL_NAME || "Your Channel", handle: c.env.CHANNEL_HANDLE || "yourchannel", avatar: c.env.AVATAR_URL || "/avatar.svg" },
}));
app.get("/api/videos", async (c) => c.json(await c.var.store.list(c.req.query())));
app.get("/api/videos/:id", async (c) => {
  const v = await c.var.store.get(c.req.param("id"));
  return v ? c.json(v) : c.json({ error: "not found" }, 404);
});
app.post("/api/videos", async (c) => {
  const v = await c.var.store.create(await c.req.json());
  return isBlockError(v) ? c.json(v, v.status as 400) : c.json(v, 201);
});
app.patch("/api/videos/:id", async (c) => {
  const v = await c.var.store.update(c.req.param("id"), await c.req.json());
  if (isBlockError(v)) return c.json(v, v.status as 400 | 404 | 409);
  return v ? c.json(v) : c.json({ error: "not found" }, 404);
});
// One script block: GET -> { value, version, previous: { value, version } }; PUT { value, base_version? } -> { value, version } or 409 conflict
app.get("/api/videos/:id/script/:block", async (c) => {
  const r = await c.var.store.getBlock(c.req.param("id"), c.req.param("block"));
  return isBlockError(r) ? c.json(r, r.status as 400 | 404) : c.json(r);
});
app.put("/api/videos/:id/script/:block", async (c) => {
  const b = await c.req.json<{ value?: unknown; base_version?: number | null }>().catch(() => null);
  if (!b || typeof b !== "object" || !("value" in b)) return c.json({ error: "body must be { value, base_version? }" }, 400);
  const r = await c.var.store.setBlock(c.req.param("id"), c.req.param("block"), b.value, b.base_version);
  return isBlockError(r) ? c.json(r, r.status as 400 | 404 | 409) : c.json(r);
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
  if (Number(c.req.header("content-length") || 0) > 2_100_000) return c.json({ error: "image too large" }, 413);
  const { data } = await c.req.json<{ data: string }>();
  const r = await saveAsset(c.env.DB, data);
  if ("error" in r) return c.json({ error: r.error }, r.status as 400 | 413);
  const { id } = r;
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
app.patch("/api/series/:id", async (c) => {
  const r = await c.var.store.updateSeries(c.req.param("id"), await c.req.json().catch(() => null));
  return "error" in r ? c.json({ error: r.error }, r.status as 400 | 404) : c.json(r);
});
app.get("/api/series/:id/next-episode", async (c) => c.json({ episode: await c.var.store.nextEpisode(c.req.param("id")) }));

export default app;
