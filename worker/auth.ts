// Auth primitives, kept pure so `npm run verify` can test them directly (Access JWT signature, constant-time compare).
const enc = new TextEncoder();
export function safeEqual(a: string, b: string) {
  const x = enc.encode(a), y = enc.encode(b);
  if (x.byteLength !== y.byteLength) return false;
  return (crypto.subtle as unknown as { timingSafeEqual(a: ArrayBufferView, b: ArrayBufferView): boolean }).timingSafeEqual(x, y);
}
const b64url = (s: string) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4)), (c) => c.charCodeAt(0));
let certs: { at: number; keys: JsonWebKey[] } | null = null;
export async function verifyAccess(jwt: string, team: string, aud: string) {
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
  if (!jwk && Date.now() - certs!.at > 60_000) { await load(); jwk = certs!.keys.find((k: any) => k.kid === header.kid); } // key rotated
  if (!jwk) return false;
  const key = await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
  return crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, b64url(sig), enc.encode(`${h}.${p}`));
}
// test hook (scripts/verify.mjs): forget cached certs
export const _resetCerts = () => { certs = null; };
