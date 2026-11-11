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
await check("api: update series rejects bad input", async () => {
  const bad = await api("/api/series/tutorial", { method: "PATCH", body: JSON.stringify({ color: "red" }) }); assert(bad.status === 400, `bad color ${bad.status}`);
  const ext = await api("/api/series/tutorial", { method: "PATCH", body: JSON.stringify({ logo: "https://evil.example/x.png" }) }); assert(ext.status === 400, `external logo ${ext.status}`);
  const extra = await api("/api/series/tutorial", { method: "PATCH", body: JSON.stringify({ name: "x" }) }); assert(extra.status === 400, `unknown field ${extra.status}`);
  const nf = await api("/api/series/nope", { method: "PATCH", body: JSON.stringify({ description: "x" }) }); assert(nf.status === 404, `missing series ${nf.status}`);
});
await check("api: update series description + colors", async () => {
  const r = await api("/api/series/vlog", { method: "PATCH", body: JSON.stringify({ description: "Behind the scenes (verify)", color: "#7A4E0C", bg: "#F6ECD9" }) });
  assert(r.status === 200 && r.body.description === "Behind the scenes (verify)" && r.body.bg === "#F6ECD9" && r.body.name === "Vlog", `${r.status} ${JSON.stringify(r.body)}`);
});
// ---- script block versions (#10) ----
const put = (id, block, body) => api(`/api/videos/${id}/script/${block}`, { method: "PUT", body: JSON.stringify(body) });
let verId;
await check("api: same block saved twice with the same base_version -> second is a conflict", async () => {
  const c = await api("/api/videos", { method: "POST", body: JSON.stringify({ title: "verify versions", format: "longo" }) }); verId = c.body.id;
  assert(c.body.script_versions && Object.keys(c.body.script_versions).length === 0, "new video should have no block versions");
  const a = await put(verId, "conteudo", { value: "first draft", base_version: 0 });
  assert(a.status === 200 && a.body.version === 1, `first save ${a.status} ${JSON.stringify(a.body)}`);
  const b = await put(verId, "conteudo", { value: "other edit", base_version: 0 });
  assert(b.status === 409 && b.body.code === "conflict" && b.body.current?.version === 1 && b.body.current?.value === "first draft", `second save ${b.status} ${JSON.stringify(b.body)}`);
  const g = await api(`/api/videos/${verId}`); assert(g.body.script.conteudo === "first draft" && g.body.script_versions.conteudo === 1, "conflicting write changed the block");
  const p = await api(`/api/videos/${verId}`, { method: "PATCH", body: JSON.stringify({ script: { conteudo: "x" }, base_versions: { conteudo: 0 } }) });
  assert(p.status === 409, `PATCH with stale base_versions ${p.status}`);
});
await check("api: previous value of a changed block is retrievable", async () => {
  const a = await put(verId, "conteudo", { value: "second draft", base_version: 1 }); assert(a.status === 200 && a.body.version === 2, `save ${a.status}`);
  const g = await api(`/api/videos/${verId}/script/conteudo`);
  assert(g.status === 200 && g.body.value === "second draft" && g.body.version === 2 && g.body.previous?.value === "first draft" && g.body.previous?.version === 1, JSON.stringify(g.body));
  const other = await api(`/api/videos/${verId}/script/conclusao`); assert(other.body.version === 0 && other.body.previous === null, "untouched block should be version 0");
});
await check("api: unknown or wrong-format block names are rejected", async () => {
  for (const b of ["intro", "gancho"]) { const r = await put(verId, b, { value: "x" }); assert(r.status === 400, `${b}: ${r.status}`); } // gancho is vertical-only
  const r = await api(`/api/videos/${verId}`, { method: "PATCH", body: JSON.stringify({ script: { "hook ": "x" } }) }); assert(r.status === 400, `PATCH "hook ": ${r.status}`);
  const h = await put(verId, "hook", { value: "not an object" }); assert(h.status === 400, `hook as string: ${h.status}`);
});
await check("mcp: update_script_block rejects unknown block names", async () => {
  for (const b of ["hook ", "intro"]) { const r = await mcp("update_script_block", { id: verId, block: b, value: "x" }); assert(r.body?.result?.isError, `${JSON.stringify(b)} accepted`); }
  const g = await api(`/api/videos/${verId}`); assert(!("intro" in g.body.script) && !("hook " in g.body.script), "ghost block created");
});
await check("mcp: update_script_block with base_version (ok, then conflict) + get_script_block", async () => {
  const ok = await mcp("update_script_block", { id: verId, block: "conclusao", value: "agent ending", base_version: 0 });
  assert(!ok.body?.result?.isError && JSON.parse(ok.body.result.content[0].text).version === 1, JSON.stringify(ok.body).slice(0, 300));
  const stale = await mcp("update_script_block", { id: verId, block: "conclusao", value: "stale", base_version: 0 });
  assert(stale.body?.result?.isError, "stale base_version accepted");
  const err = JSON.parse(stale.body.result.content[0].text); assert(err.code === "conflict" && err.current.value === "agent ending" && err.current.version === 1, stale.body.result.content[0].text);
  const g = await mcp("get_script_block", { id: verId, block: "conteudo" }); const gb = JSON.parse(g.body.result.content[0].text);
  assert(gb.previous?.value === "first draft", JSON.stringify(gb));
  const list = await api("/mcp", { method: "POST", body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }) });
  const tool = list.body.result.tools.find((t) => t.name === "update_script_block");
  assert(tool.inputSchema.properties.base_version && /base_version/.test(tool.description), "update_script_block does not document base_version");
});
await check("mcp: list_videos", async () => { const r = await mcp("list_videos", {}); assert(r.body?.result && !r.body.result.isError, JSON.stringify(r.body).slice(0, 200)); });

// ---- Screenshots of every view ----
const { chromium } = await import("playwright");
const browser = await chromium.launch();
// Offline-safe: external requests (e.g. Google Fonts) get an empty reply, so sandboxes without internet behave the same
const offline = async (ctx) => ctx.route((url) => !url.href.startsWith(BASE), (r) => r.fulfill({ status: 200, body: "" }));
const pctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await offline(pctx);
const page = await pctx.newPage();
const errors = []; page.on("pageerror", (e) => errors.push(e.message)); page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
for (const v of ["kanban", "calendario", "derivados", "ideias"]) {
  await check(`ui: ${v} renders`, async () => {
    await page.goto(`${BASE}/${v}`, { waitUntil: "networkidle" });
    await page.screenshot({ path: `${OUT}/${v}.png`, fullPage: true });
    assert((await page.locator("body").innerText()).trim().length > 0, "empty page");
  });
}
await check("mcp: update_series sets a logo that shows in the Ideas column", async () => {
  // render a small visible logo, upload it via MCP, attach it to the "tutorial" series via MCP
  const lp = await browser.newPage({ viewport: { width: 240, height: 80 } });
  await lp.setContent(`<div style="width:240px;height:80px;display:grid;place-items:center;background:#0E7C86;color:#fff;font:700 28px sans-serif">TUTORIAL</div>`);
  const data = "data:image/png;base64," + (await lp.screenshot()).toString("base64"); await lp.close();
  const up = await mcp("upload_image", { data }); assert(!up.body?.result?.isError, JSON.stringify(up.body).slice(0, 200));
  const { url } = JSON.parse(up.body.result.content[0].text);
  const r = await mcp("update_series", { id: "tutorial", logo: url }); assert(!r.body?.result?.isError, JSON.stringify(r.body).slice(0, 200));
  assert(JSON.parse(r.body.result.content[0].text).logo === url, "logo not saved");
  const bad = await mcp("update_series", { id: "tutorial", color: "nope" }); assert(bad.body?.result?.isError, "bad color accepted via MCP");
  await page.goto(`${BASE}/ideias`, { waitUntil: "networkidle" });
  const img = page.locator(`.serie-cover img[src="${url}"]`);
  await img.waitFor({ timeout: 5000 });
  assert(await img.evaluate((el) => el.complete && el.naturalWidth > 0), "logo image did not load");
  await page.screenshot({ path: `${OUT}/ideias-series-logo.png`, fullPage: true });
});
await check("ui: video panel opens (click card)", async () => {
  await page.goto(`${BASE}/kanban`, { waitUntil: "networkidle" });
  await page.locator(".card", { hasText: "How a database index actually works" }).first().click();
  await page.locator(".serie-box").waitFor({ timeout: 5000 }); // long-form hook shows the series-line box
  assert(await page.locator("h3", { hasText: /Conte|Content/ }).count() > 0, "script blocks not visible");
  await page.screenshot({ path: `${OUT}/video-panel.png` });
});
await check("ui: editing a script block in the app saves it with its version", async () => {
  await page.goto(`${BASE}/kanban#/video/${verId}`, { waitUntil: "networkidle" });
  const ed = page.locator(".block", { has: page.locator("h3", { hasText: /Conclus/ }) }).locator(".rt").first();
  await ed.click(); await page.keyboard.type("Owner wrote this ending.");
  await page.evaluate(() => document.activeElement?.blur()); // blur saves
  await page.waitForTimeout(800);
  const g = await api(`/api/videos/${verId}/script/conclusao`);
  assert(/Owner wrote this ending\./.test(g.body.value) && g.body.version === 2 && g.body.updated_by === "owner", JSON.stringify(g.body));
  await page.screenshot({ path: `${OUT}/script-edit.png`, fullPage: true });
});
await check("ui: conflict shows the newer text and keeps what the owner typed", async () => {
  const cur = await api(`/api/videos/${verId}/script/conclusao`);
  // the agent changes the block while the page is open (no reload)
  const agent = await put(verId, "conclusao", { value: "Agent rewrote the ending.", base_version: cur.body.version }); assert(agent.status === 200, `agent ${agent.status}`);
  const ed = page.locator(".block", { has: page.locator("h3", { hasText: /Conclus/ }) }).locator(".rt").first();
  await ed.click(); await page.keyboard.press("End"); await page.keyboard.type(" Plus my extra line.");
  await page.evaluate(() => document.activeElement?.blur());
  const note = page.locator('.conflict[data-block="conclusao"]'); await note.waitFor({ timeout: 5000 });
  assert(/Agent rewrote the ending\./.test(await note.innerText()), "conflict note does not show the newer text");
  assert(/Plus my extra line\./.test(await ed.innerText()), "owner's text was discarded");
  const g = await api(`/api/videos/${verId}/script/conclusao`); assert(g.body.value === "Agent rewrote the ending.", "owner's save silently overwrote the agent's");
  await ed.scrollIntoViewIfNeeded(); await page.screenshot({ path: `${OUT}/script-conflict.png`, fullPage: true });
  await note.getByRole("button", { name: /Keep mine|Manter/ }).click();
  await note.waitFor({ state: "detached", timeout: 5000 });
  const k = await api(`/api/videos/${verId}/script/conclusao`);
  assert(/Plus my extra line\./.test(k.body.value) && k.body.previous?.value === "Agent rewrote the ending.", JSON.stringify(k.body));
});
await check("ui: full-screen video page", async () => {
  await page.goto(`${BASE}/kanban#/video/${firstId}`, { waitUntil: "networkidle" });
  await page.locator(".full-top").waitFor({ timeout: 5000 });
  await page.screenshot({ path: `${OUT}/video-full.png`, fullPage: true });
});
// the conflict check above makes the browser log its expected 409 response; any other error still fails
await check("ui: no console errors", async () => { const e = errors.filter((m) => !/status of 409 \(Conflict\)/.test(m)); assert(e.length === 0, e.slice(0, 3).join(" | ")); });
// ---- GIF of the main flow (needs ffmpeg; skipped if missing) ----
await check("ui: record main flow", async () => {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, recordVideo: { dir: `${OUT}/video`, size: { width: 1280, height: 800 } } });
  await offline(ctx);
  const p = await ctx.newPage();
  await p.goto(`${BASE}/kanban`, { waitUntil: "networkidle" }); await p.waitForTimeout(800);
  await p.locator(".card", { hasText: "How a database index actually works" }).first().click(); await p.waitForTimeout(1200);
  await p.mouse.move(1000, 500); await p.mouse.wheel(0, 500); await p.waitForTimeout(1000);
  await p.goto(`${BASE}/ideias`, { waitUntil: "networkidle" }); await p.waitForTimeout(1000);
  await p.goto(`${BASE}/calendario`, { waitUntil: "networkidle" }); await p.waitForTimeout(1000);
  const vid = await p.video().path(); await ctx.close();
  try { execSync(`ffmpeg -y -loglevel error -i ${vid} -vf "fps=8,scale=900:-1:flags=lanczos,split[a][b];[a]palettegen[p];[b][p]paletteuse" ${OUT}/flow.gif`); }
  catch { console.log("      (ffmpeg not found: kept webm only)"); }
});
await browser.close();

const failed = results.filter((r) => !r.ok);
writeFileSync(`${OUT}/report.json`, JSON.stringify({ verdict: failed.length ? "FAIL" : "PASS", results }, null, 2));
if (failed.length) writeFileSync(`${OUT}/server.log`, log);
console.log(`\n${failed.length ? "FAIL" : "PASS"}  ${results.length - failed.length}/${results.length} checks · screenshots in ${OUT}/`);
if (keep) { console.log(`server running at ${BASE} (Ctrl+C to stop)`); } else { stop(); process.exit(failed.length ? 1 : 0); }
