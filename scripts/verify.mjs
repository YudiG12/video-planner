#!/usr/bin/env node
// Verification CLI for agents (Claude builds, Codex verifies). See AGENTS.md "Verify a change".
// Builds the app, runs it locally on an isolated, throwaway D1 with fake demo data,
// smoke-tests the API + MCP and saves screenshots of every view to verify-out/.
//   npm run verify            -> all checks + screenshots
//   npm run verify -- --keep  -> leave the server running (random free port, printed at the end) to explore
import { spawn, execSync } from "node:child_process";
import { rmSync, mkdirSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";

const PORT = await new Promise((r) => { const s = createServer().listen(0, () => { const p = s.address().port; s.close(() => r(p)); }); });
const BASE = `http://localhost:${PORT}`, STATE = ".verify/state", OUT = "verify-out";
const keep = process.argv.includes("--keep");
const sh = (cmd) => execSync(cmd, { stdio: ["ignore", "pipe", "inherit"] }).toString();
const results = [];
const check = async (name, fn) => {
  try { await fn(); results.push({ name, ok: true }); console.log(`PASS  ${name}`); }
  catch (e) { results.push({ name, ok: false, error: String(e.message || e) }); console.log(`FAIL  ${name}: ${e.message || e}`); }
};
const assert = (c, msg) => { if (!c) throw new Error(msg); };

rmSync(".verify", { recursive: true, force: true }); rmSync(OUT, { recursive: true, force: true }); mkdirSync(OUT, { recursive: true });
console.log("build…"); sh("npm run build");
console.log("migrate + seed (isolated local D1)…");
sh(`npx wrangler d1 migrations apply video-planner --local --persist-to ${STATE} -c wrangler.jsonc`);
sh(`npx wrangler d1 execute video-planner --local --persist-to ${STATE} -c wrangler.jsonc --file scripts/demo-seed.sql`);

const srv = spawn("npx", ["wrangler", "dev", "-c", "dist/video_planner/wrangler.json", "--port", String(PORT), "--persist-to", STATE, "--var", "DEV_OPEN:1"], { stdio: ["ignore", "pipe", "pipe"] });
let log = ""; srv.stdout.on("data", (d) => (log += d)); srv.stderr.on("data", (d) => (log += d));
const stop = () => { try { srv.kill("SIGTERM"); } catch {} };
process.on("exit", stop);

for (let i = 0; i < 60; i++) { try { if ((await fetch(BASE + "/api/bootstrap")).ok) break; } catch {} await new Promise((r) => setTimeout(r, 1000)); }

const api = async (path, init) => { const r = await fetch(BASE + path, { ...init, headers: { "content-type": "application/json", ...(init?.headers || {}) } }); return { status: r.status, body: await r.json().catch(() => null) }; };
const mcp = (name, args) => api("/mcp", { method: "POST", body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }) });

// ---- API / MCP feature checks ----
let firstId;
await check("api: bootstrap returns series and statuses", async () => {
  const { status, body } = await api("/api/bootstrap");
  assert(status === 200 && body.series.length > 0 && body.statuses.length > 0, `status ${status}`);
});
await check("api: list videos", async () => {
  const { body } = await api("/api/videos"); assert(Array.isArray(body) && body.length > 0, "no videos"); firstId = body[0].id;
});
await check("api: create + update + delete video", async () => {
  const c = await api("/api/videos", { method: "POST", body: JSON.stringify({ title: "verify", format: "longo" }) });
  assert(c.status < 300 && c.body.id, `create ${c.status}`);
  const u = await api(`/api/videos/${c.body.id}`, { method: "PATCH", body: JSON.stringify({ title: "verify 2" }) });
  assert(u.status < 300 && u.body.title === "verify 2", `update ${u.status}`);
  const d = await api(`/api/videos/${c.body.id}`, { method: "DELETE" }); assert(d.status < 300, `delete ${d.status}`);
});
const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";
await check("api: upload asset + fetch it back", async () => {
  const r = await api("/api/assets", { method: "POST", body: JSON.stringify({ data: PNG }) });
  assert(r.status === 201, `upload ${r.status}`);
  const g = await fetch(BASE + r.body.url); assert(g.ok && g.headers.get("content-type") === "image/png", `get ${g.status}`);
});
await check("api: rejects non-image asset", async () => {
  const r = await api("/api/assets", { method: "POST", body: JSON.stringify({ data: "data:text/html;base64,PGgxPg==" }) }); assert(r.status === 400, `got ${r.status}`);
});
await check("mcp: tools/list", async () => {
  const r = await api("/mcp", { method: "POST", body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }) });
  assert(r.body?.result?.tools?.length > 0, JSON.stringify(r.body).slice(0, 200));
});
await check("mcp: list_videos", async () => { const r = await mcp("list_videos", {}); assert(r.body?.result && !r.body.result.isError, JSON.stringify(r.body).slice(0, 200)); });

// ---- Screenshots of every view ----
const { chromium } = await import("playwright");
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = []; page.on("pageerror", (e) => errors.push(e.message)); page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
for (const v of ["kanban", "calendario", "derivados", "ideias"]) {
  await check(`ui: ${v} renders`, async () => {
    await page.goto(`${BASE}/${v}`, { waitUntil: "networkidle" });
    await page.screenshot({ path: `${OUT}/${v}.png`, fullPage: true });
    assert((await page.locator("body").innerText()).trim().length > 0, "empty page");
  });
}
await check("ui: video panel opens (click card)", async () => {
  await page.goto(`${BASE}/kanban`, { waitUntil: "networkidle" });
  await page.locator(".card", { hasText: "How a database index actually works" }).first().click();
  await page.locator(".serie-box").waitFor({ timeout: 5000 }); // long-form hook shows the series-line box
  assert(await page.locator("h3", { hasText: /Conte|Content/ }).count() > 0, "script blocks not visible");
  await page.screenshot({ path: `${OUT}/video-panel.png` });
});
await check("ui: full-screen video page", async () => {
  await page.goto(`${BASE}/kanban#/video/${firstId}`, { waitUntil: "networkidle" });
  await page.locator(".full-top").waitFor({ timeout: 5000 });
  await page.screenshot({ path: `${OUT}/video-full.png`, fullPage: true });
});
await check("ui: no console errors", async () => assert(errors.length === 0, errors.slice(0, 3).join(" | ")));
await browser.close();

const failed = results.filter((r) => !r.ok);
writeFileSync(`${OUT}/report.json`, JSON.stringify({ verdict: failed.length ? "FAIL" : "PASS", results }, null, 2));
if (failed.length) writeFileSync(`${OUT}/server.log`, log);
console.log(`\n${failed.length ? "FAIL" : "PASS"}  ${results.length - failed.length}/${results.length} checks · screenshots in ${OUT}/`);
if (keep) { console.log(`server running at ${BASE} (Ctrl+C to stop)`); } else { stop(); process.exit(failed.length ? 1 : 0); }
