#!/usr/bin/env node
// Verification CLI for agents (Claude builds, Codex verifies). See AGENTS.md "Verify a change".
// Builds the app, runs it locally on an isolated, throwaway D1 with fake demo data,
// smoke-tests the API + MCP and saves screenshots of every view to verify-out/.
//   npm run verify            -> all checks + screenshots
//   npm run verify -- --keep  -> leave the server running (random free port, printed at the end) to explore
import { spawn, execSync } from "node:child_process";
import { rmSync, mkdirSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { randomBytes } from "node:crypto";

const freePort = () => new Promise((r) => { const s = createServer().listen(0, () => { const p = s.address().port; s.close(() => r(p)); }); });
const PORT = await freePort(), APORT = await freePort();
const BASE = `http://localhost:${PORT}`, AGENT = `http://localhost:${APORT}`, STATE = ".verify/state", OUT = "verify-out";
const AGENT_TOKEN = "verify-" + randomBytes(12).toString("hex"); // throwaway, local only
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

const srv = spawn("npx", ["wrangler", "dev", "-c", "dist/video_planner/wrangler.json", "--port", String(PORT), "--persist-to", STATE, "--var", "DEV_OPEN:1"], { stdio: ["ignore", "pipe", "pipe"], detached: true });
let log = ""; srv.stdout.on("data", (d) => (log += d)); srv.stderr.on("data", (d) => (log += d));
let asrv;
// each server runs in its own process group, so npx + wrangler + workerd all stop (a leftover would linger in the dev registry)
const stop = () => { for (const p of [srv, asrv]) { try { process.kill(-p.pid, "SIGTERM"); } catch {} } };
process.on("exit", stop);
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => process.exit(130));

for (let i = 0; i < 60; i++) { try { if ((await fetch(BASE + "/api/bootstrap")).ok) break; } catch {} await new Promise((r) => setTimeout(r, 1000)); }
// The agent Worker (Bearer only) on the same local D1; it reaches the app Worker's live hub through the local dev registry
asrv = spawn("npx", ["wrangler", "dev", "-c", "wrangler.agent.jsonc", "--port", String(APORT), "--persist-to", STATE, "--var", `AGENT_TOKEN:${AGENT_TOKEN}`], { stdio: ["ignore", "pipe", "pipe"], detached: true });
asrv.stdout.on("data", (d) => (log += d)); asrv.stderr.on("data", (d) => (log += d));
const agentMcp = async (name, args, token = AGENT_TOKEN) => {
  const r = await fetch(AGENT + "/mcp", { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}` }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }) });
  return { status: r.status, body: await r.json().catch(() => null) };
};
for (let i = 0; i < 60; i++) { try { if ((await agentMcp("list_series", {})).status === 200) break; } catch {} await new Promise((r) => setTimeout(r, 1000)); }
const mcpOut = (r) => { assert(r.status === 200 && r.body?.result && !r.body.result.isError, JSON.stringify(r.body).slice(0, 300)); return JSON.parse(r.body.result.content[0].text); };

const api = async (path, init) => { const r = await fetch(BASE + path, { ...init, headers: { "content-type": "application/json", ...(init?.headers || {}) } }); return { status: r.status, body: await r.json().catch(() => null) }; };
const mcp = (name, args) => api("/mcp", { method: "POST", body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }) });

// ---- API / MCP feature checks ----
let firstId;
await check("api: agent worker /health reports db, live and agent_token without auth", async () => { const r = await fetch(AGENT + "/health"); const b = await r.json(); assert(r.status === 200 && b.ok && b.db && b.live && b.agent_token, JSON.stringify(b)); });
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
await check("api: concurrent writes to one block each get their own version", async () => {
  const rs = await Promise.all(Array.from({ length: 12 }, (_, i) => put(verId, "insercao", { value: `draft ${i}` })));
  assert(rs.every((r) => r.status === 200), rs.map((r) => r.status).join(","));
  const versions = rs.map((r) => r.body.version);
  assert(new Set(versions).size === 12, `duplicate versions returned: ${versions.join(",")}`);
  const g = await api(`/api/videos/${verId}/script/insercao`);
  const winner = rs.find((r) => r.body.version === g.body.version);
  assert(winner && winner.body.value === g.body.value, "returned version does not match the stored value");
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
  // the owner keeps typing after the conflict shows up, then clicks Keep mine right away (no autosave yet): the latest text wins
  await ed.click(); await page.keyboard.press("End"); await page.keyboard.type(" Revised after the conflict.");
  await note.getByRole("button", { name: /Keep mine|Manter/ }).click();
  await note.waitFor({ state: "detached", timeout: 5000 });
  await page.waitForTimeout(500);
  const k = await api(`/api/videos/${verId}/script/conclusao`);
  assert(/Plus my extra line\. Revised after the conflict\./.test(k.body.value) && k.body.previous?.value === "Agent rewrote the ending.", JSON.stringify(k.body));
  assert(/Revised after the conflict\./.test(await ed.innerText()), "editor reverted to an older draft");
});
await check("ui: a live title change while the owner types conflicts; accepting it updates the input (no silent undo)", async () => {
  const c = await api("/api/videos", { method: "POST", body: JSON.stringify({ title: "verify titles", format: "longo" }) }); const id = c.body.id;
  await page.goto(`${BASE}/kanban#/video/${id}`, { waitUntil: "networkidle" }); await page.reload({ waitUntil: "networkidle" }); // load the new video
  const title = page.locator("textarea.yt-title").first(); await title.waitFor({ timeout: 5000 });
  // the owner is in the title field when the agent's titles arrive live (no reload); the owner then types and leaves:
  // their save is based on the version they saw, so it must conflict instead of overwriting the agent's title
  await title.click();
  const refreshed = page.waitForResponse((r) => new URL(r.url()).pathname === "/api/videos" && r.request().method() === "GET", { timeout: 3000 });
  const agent = await put(id, "pairs", { value: [{ title: "Agent newer title" }, {}, {}], base_version: 0 }); assert(agent.status === 200 && agent.body.version === 1, `agent ${agent.status}`);
  await refreshed; await page.waitForTimeout(100); // the live update landed while the field had focus
  await page.keyboard.type("Owner conflicting title");
  await page.evaluate(() => document.activeElement?.blur());
  const note = page.locator('.conflict[data-block="pairs"]'); await note.waitFor({ timeout: 5000 });
  const mid = await api(`/api/videos/${id}/script/pairs`); assert(mid.body.value?.[0]?.title === "Agent newer title", `owner's blur overwrote the agent's title: ${JSON.stringify(mid.body.value)}`);
  await note.getByRole("button", { name: /Use the newer|Usar a vers/ }).click();
  await note.waitFor({ state: "detached", timeout: 5000 });
  assert((await title.inputValue()) === "Agent newer title", `title input shows "${await title.inputValue()}"`);
  await title.click(); await page.evaluate(() => document.activeElement?.blur()); // focus + blur must not save anything
  await page.waitForTimeout(600);
  const g = await api(`/api/videos/${id}/script/pairs`);
  assert(g.body.value?.[0]?.title === "Agent newer title" && g.body.version === 1, JSON.stringify(g.body));
  await api(`/api/videos/${id}`, { method: "DELETE" });
});
// ---- live updates (#11): writes reach an open page without reload ----
const LIVE_TITLE = "Live demo: caching explained";
const LIVE_END = "Caching is a trade. You keep a copy close so you stop paying for the trip.";
let liveId;
const col = (p, name) => p.locator(".col").filter({ has: p.locator(".col-h", { hasText: name }) });
const liveOn = (p) => p.waitForFunction(() => document.documentElement.dataset.live === "on", null, { timeout: 5000 });
const conclusionBlock = (p) => p.locator(".block", { has: p.locator("h3", { hasText: /Conclus/ }) }).first();
await check("live: agent Worker requires its Bearer token", async () => {
  const bad = await agentMcp("list_videos", {}, "wrong-token"); assert(bad.status === 401, `wrong token: ${bad.status}`);
  const ok = await agentMcp("list_videos", {}); assert(Array.isArray(mcpOut(ok)), "list_videos via agent Worker");
});
await check("live: an agent move (agent Worker, MCP) shows on the open kanban within 2s, no reload, with a changed dot", async () => {
  const c = await api("/api/videos", { method: "POST", body: JSON.stringify({ title: LIVE_TITLE, format: "longo", script: { conclusao: LIVE_END, conteudo: "Every cache answers one question: is this copy still good enough?" } }) });
  liveId = c.body.id;
  await page.goto(`${BASE}/kanban`, { waitUntil: "networkidle" }); await liveOn(page);
  await page.evaluate(() => { window.__sameDocument = true; });
  await col(page, /Ideas|Ideias/).locator(".card", { hasText: LIVE_TITLE }).waitFor({ timeout: 3000 });
  const t0 = Date.now();
  mcpOut(await agentMcp("move_video", { id: liveId, status: "Produzindo" }));
  const card = col(page, /Recording|Produzindo/).locator(".card", { hasText: LIVE_TITLE });
  await card.waitFor({ timeout: 2000 });
  const ms = Date.now() - t0; assert(ms <= 2000, `took ${ms} ms`);
  assert(await page.evaluate(() => window.__sameDocument === true), "page reloaded");
  assert(await card.locator(".dot-changed").count() === 1, "no changed dot on the moved card");
  await page.screenshot({ path: `${OUT}/live-kanban-moved.png` });
});
await check("live: agent editing a block highlights it, then marks inserted + removed text until \"ok, seen\"", async () => {
  const card = col(page, /Recording|Produzindo/).locator(".card", { hasText: LIVE_TITLE });
  await card.click();
  const blk = conclusionBlock(page); await blk.locator(".rt").waitFor({ timeout: 5000 });
  assert(await card.locator(".dot-changed").count() === 0, "dot still shown after opening the video");
  const cur = mcpOut(await agentMcp("get_script_block", { id: liveId, block: "conclusao" }));
  await page.locator('.agent-badge[data-block="conclusao"]').waitFor({ timeout: 2000 });
  assert(/agent-editing/.test(await blk.getAttribute("class")), "block not highlighted while the agent edits");
  await blk.scrollIntoViewIfNeeded(); await page.screenshot({ path: `${OUT}/live-agent-editing.png` });
  const next = "Caching is a bet. You keep a fresh copy close so you stop paying for the slow trip.";
  mcpOut(await agentMcp("update_script_block", { id: liveId, block: "conclusao", value: next, base_version: cur.version }));
  await page.waitForFunction((t) => document.querySelector(".panel")?.innerText.includes(t), "fresh copy close", { timeout: 2000 }); // text lands without reload
  const ch = page.locator('.change[data-block="conclusao"]'); await ch.waitFor({ timeout: 4000 });
  const ins = (await ch.locator("ins").allInnerTexts()).join(" "), del = (await ch.locator("del").allInnerTexts()).join(" ");
  assert(/bet/.test(ins) && /fresh/.test(ins) && /slow/.test(ins), `inserted: ${ins}`);
  assert(/trade/.test(del) && !/copy/.test(del), `removed: ${del}`);
  assert(await page.evaluate(() => window.__sameDocument === true), "page reloaded");
  await blk.scrollIntoViewIfNeeded(); await page.screenshot({ path: `${OUT}/live-agent-changed.png` });
  await ch.getByRole("button", { name: /ok, seen|ok, visto/ }).click();
  await ch.waitFor({ state: "detached", timeout: 2000 });
});
await check("live: change marks clear when the video is reopened", async () => {
  mcpOut(await agentMcp("update_script_block", { id: liveId, block: "conclusao", value: "Caching is a bet. Keep a fresh copy close." }));
  const ch = page.locator('.change[data-block="conclusao"]'); await ch.waitFor({ timeout: 4000 });
  await page.locator(".panel button[title=\"Close\"]").click();
  await page.locator(".panel").waitFor({ state: "detached", timeout: 3000 });
  await col(page, /Recording|Produzindo/).locator(".card", { hasText: LIVE_TITLE }).click();
  await conclusionBlock(page).locator(".rt").waitFor({ timeout: 5000 });
  assert(await page.locator(".change").count() === 0, "change marks still shown after reopening");
});
await check("live: owner typing in the same block keeps their text; \"Claude changed this block · view / apply\"", async () => {
  const blk = conclusionBlock(page), ed = blk.locator(".rt").first();
  await ed.click(); await page.keyboard.press("End"); await page.keyboard.type(" Owner draft in progress.");
  const agentText = "Agent wrote a new ending while you typed.";
  mcpOut(await agentMcp("update_script_block", { id: liveId, block: "conclusao", value: agentText }));
  const note = blk.locator(".incoming"); await note.waitFor({ timeout: 2000 });
  await page.waitForTimeout(1500); // past the 1.2s autosave of the owner's last keystroke: it must not fire while the note waits
  assert(await note.count() === 1 && await page.locator('.conflict[data-block="conclusao"]').count() === 0, "autosave replaced the note with a conflict");
  const mid = await api(`/api/videos/${liveId}/script/conclusao`); assert(mid.body.value === agentText, `owner's draft was autosaved: ${JSON.stringify(mid.body.value)}`);
  assert(/Claude changed this block/.test(await note.innerText()) && /view/.test(await note.innerText()) && /apply/.test(await note.innerText()), await note.innerText());
  assert(/Owner draft in progress\./.test(await ed.innerText()), "owner's text was replaced");
  assert(await page.locator('.change[data-block="conclusao"]').count() === 0, "diff box shown while typing");
  await note.getByRole("button", { name: "view" }).click();
  await note.locator(".diff ins", { hasText: /Agent/ }).waitFor({ timeout: 2000 });
  await blk.scrollIntoViewIfNeeded(); await page.screenshot({ path: `${OUT}/live-owner-typing.png` });
  await note.getByRole("button", { name: "apply" }).click();
  await note.waitFor({ state: "detached", timeout: 2000 });
  assert((await ed.innerText()).trim() === agentText, `editor shows "${await ed.innerText()}"`);
  await page.evaluate(() => document.activeElement?.blur()); await page.waitForTimeout(600);
  const g = await api(`/api/videos/${liveId}/script/conclusao`); assert(g.body.value === agentText, `saved ${JSON.stringify(g.body.value)}`);
});
await check("live: owner typing in Content keeps focus and draft when the agent replaces it with a different length", async () => {
  const blk = page.locator(".block", { has: page.locator("h3", { hasText: /Conte/ }) }).first(), ed = blk.locator(".rt").first();
  await ed.click(); await page.keyboard.press("End"); await page.keyboard.type(" Owner content draft.");
  const agentText = "A much longer agent rewrite of the content block, so the text before any marker changes length a lot.";
  mcpOut(await agentMcp("update_script_block", { id: liveId, block: "conteudo", value: agentText }));
  const note = blk.locator(".incoming"); await note.waitFor({ timeout: 2000 });
  assert(await ed.evaluate((el) => el.contains(document.activeElement)), "editor lost focus");
  assert(/Owner content draft\./.test(await ed.innerText()), "owner's draft was replaced");
  const g = await api(`/api/videos/${liveId}/script/conteudo`); assert(g.body.value === agentText, `owner's draft was saved: ${JSON.stringify(g.body.value)}`);
  await note.getByRole("button", { name: "apply" }).click(); await note.waitFor({ state: "detached", timeout: 2000 });
  assert((await ed.innerText()).trim() === agentText, `editor shows "${await ed.innerText()}"`);
  await page.evaluate(() => document.activeElement?.blur());
});
await check("live: a write through the app Worker (REST) reaches another open tab", async () => {
  const p2 = await pctx.newPage(); await p2.goto(`${BASE}/kanban`, { waitUntil: "networkidle" }); await liveOn(p2);
  const t0 = Date.now();
  const r = await api(`/api/videos/${liveId}`, { method: "PATCH", body: JSON.stringify({ title: LIVE_TITLE + " (renamed)" }) }); assert(r.status === 200, `patch ${r.status}`);
  await col(p2, /Recording|Produzindo/).locator(".card", { hasText: "(renamed)" }).waitFor({ timeout: 2000 });
  assert(Date.now() - t0 <= 2000, "took more than 2s");
  await p2.close();
});
await check("live: reduced motion turns the editing animation off", async () => {
  const anim = async (reducedMotion) => {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion }); await offline(ctx);
    const p = await ctx.newPage(); await p.goto(`${BASE}/kanban#/video/${liveId}`, { waitUntil: "networkidle" }); await liveOn(p);
    mcpOut(await agentMcp("get_script_block", { id: liveId, block: "conclusao" }));
    await p.locator('.agent-badge[data-block="conclusao"]').waitFor({ timeout: 2000 });
    const name = await conclusionBlock(p).evaluate((el) => getComputedStyle(el, "::before").animationName);
    await ctx.close(); return name;
  };
  const normal = await anim("no-preference"), reduced = await anim("reduce");
  assert(normal === "agent-sweep" && reduced === "none", `no-preference: ${normal}, reduce: ${reduced}`);
});

await check("ui: full-screen video page", async () => {
  await page.goto(`${BASE}/kanban#/video/${firstId}`, { waitUntil: "networkidle" });
  await page.locator(".full-top").waitFor({ timeout: 5000 });
  await page.screenshot({ path: `${OUT}/video-full.png`, fullPage: true });
});
// Calendar side panel: unscheduled videos, drag in to schedule, drag back out to clear the date
const calSide = async (pg, shots) => {
  const c = await api("/api/videos", { method: "POST", body: JSON.stringify({ title: "Unscheduled verify video", format: "longo" }) }); const id = c.body.id;
  try {
    await pg.evaluate(() => { try { localStorage.removeItem("vp-cal-side"); } catch {} });
    await pg.goto(`${BASE}/calendario`, { waitUntil: "networkidle" }); await pg.waitForTimeout(400);
    assert(await pg.locator("#cal-side").count() === 0, "panel open by default");
    await pg.locator(".side-toggle").click();
    const order = (await api("/api/bootstrap")).body.statuses, all = (await api("/api/videos")).body;
    const want = all.filter((v) => !v.publish_date && v.status !== "Cancelados").sort((a, b) => order.indexOf(a.status) - order.indexOf(b.status) || a.position - b.position).map((v) => v.id);
    await pg.locator("#cal-side .chip").first().waitFor({ timeout: 5000 });
    const got = await pg.locator("#cal-side .chip").evaluateAll((els) => els.map((e) => e.dataset.id));
    assert(JSON.stringify(got) === JSON.stringify(want), `panel order ${got.length} items differs from kanban order`);
    const chip = pg.locator(`#cal-side .chip[data-id="${id}"]`); await chip.waitFor({ timeout: 5000 });
    if (shots) await pg.screenshot({ path: `${OUT}/calendar-side.png` });
    const day = pg.locator(".day.today"); await day.scrollIntoViewIfNeeded();
    await chip.dragTo(day); await pg.waitForTimeout(600);
    const iso = await pg.evaluate(() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; });
    let g = await api(`/api/videos/${id}`); assert(g.body.publish_date === iso, `after drag-in: ${g.body.publish_date}, want ${iso}`);
    await pg.locator(".day.today .chip", { hasText: "Unscheduled verify video" }).waitFor({ timeout: 3000 });
    assert(await chip.count() === 0, "still listed in the panel after scheduling");
    if (shots) await pg.screenshot({ path: `${OUT}/calendar-side-scheduled.png` });
    await pg.locator(".day.today .chip", { hasText: "Unscheduled verify video" }).dragTo(pg.locator("#cal-side")); await pg.waitForTimeout(600);
    g = await api(`/api/videos/${id}`); assert(g.body.publish_date === null, `after drag-out: ${g.body.publish_date}`);
    await chip.waitFor({ timeout: 3000 });
    await pg.reload({ waitUntil: "networkidle" }); assert(await pg.locator("#cal-side").count() === 1, "panel state not remembered");
  } finally { await api(`/api/videos/${id}`, { method: "DELETE" }); }
};
await check("ui: calendar side panel lists videos with no date in kanban order; drag in schedules, drag out clears the date", () => calSide(page, true));
await check("ui: reordering in the calendar side panel changes the kanban order too (and another group = another status)", async () => {
  const statuses = (await api("/api/bootstrap")).body.statuses.filter((x) => x !== "Cancelados");
  const [st, st2] = statuses;
  const mk = async (title) => (await api("/api/videos", { method: "POST", body: JSON.stringify({ title, format: "longo", status: st }) })).body.id;
  const a = await mk("Side order A"), b = await mk("Side order B");
  try {
    await page.goto(`${BASE}/calendario`, { waitUntil: "networkidle" });
    if (!(await page.locator("#cal-side").count())) await page.locator(".side-toggle").click();
    const grp = page.locator(`#cal-side .side-group[data-st="${st}"] .side-group-list`);
    const ids = () => grp.locator(".chip").evaluateAll((els) => els.map((e) => e.dataset.id));
    await grp.locator(`.chip[data-id="${b}"]`).waitFor({ timeout: 5000 });
    let before = await ids(); assert(before.indexOf(a) < before.indexOf(b), `start order ${before}`);
    await grp.locator(`.chip[data-id="${b}"]`).dragTo(grp.locator(`.chip[data-id="${a}"]`), { targetPosition: { x: 20, y: 4 } });
    await page.waitForTimeout(700);
    const after = await ids(); assert(after.indexOf(b) < after.indexOf(a), `panel after: B should be above A`);
    const vs = (await api("/api/videos")).body, pa = vs.find((v) => v.id === a), pb = vs.find((v) => v.id === b);
    assert(pb.position < pa.position && pb.status === st, `api positions A=${pa.position} B=${pb.position}`);
    await page.goto(`${BASE}/kanban`, { waitUntil: "networkidle" });
    const board = await page.locator(".card").evaluateAll((els) => els.map((e) => e.textContent || ""));
    assert(board.findIndex((x) => x.includes("Side order B")) < board.findIndex((x) => x.includes("Side order A")), "kanban still shows A above B");
    await page.goto(`${BASE}/calendario`, { waitUntil: "networkidle" });
    const g2 = page.locator(`#cal-side .side-group[data-st="${st2}"] .side-group-list`);
    await page.locator(`#cal-side .chip[data-id="${a}"]`).dragTo(g2);
    await page.waitForTimeout(700);
    assert((await api(`/api/videos/${a}`)).body.status === st2, "status did not change when dropped in another group");
    // pass over one group's list, release on another group's heading: the heading's group wins (synthetic events: no scrolling races)
    const st3 = statuses[2];
    await page.evaluate(async ({ b, st2, st3 }) => {
      const dt = new DataTransfer(), q = (sel) => document.querySelector(sel);
      const fire = (el, type) => { const r = el.getBoundingClientRect(); el.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: dt, clientX: r.left + 10, clientY: r.top + r.height / 2 })); };
      const wait = () => new Promise((r) => setTimeout(r, 80));
      fire(q(`#cal-side .chip[data-id="${b}"]`), "dragstart"); await wait();
      fire(q(`#cal-side .side-group[data-st="${st2}"] .side-group-list`), "dragover"); await wait();
      const h = q(`#cal-side .side-group[data-st="${st3}"] .side-group-h`);
      fire(h, "dragover"); fire(h, "drop");
    }, { b, st2, st3 });
    await page.waitForTimeout(700);
    const sb2 = (await api(`/api/videos/${b}`)).body.status; assert(sb2 === st3 || sb2 === st, `dropped on "${st3}" heading but status is "${sb2}" (the list it passed over)`); assert(sb2 === st3, `dropped on "${st3}" heading but status is "${sb2}"`);
    await page.screenshot({ path: `${OUT}/calendar-side-reorder.png` });
  } finally { for (const id of [a, b]) await api(`/api/videos/${id}`, { method: "DELETE" }); }
});
await check("ui: record calendar side panel (calendar-side.gif)", async () => {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, recordVideo: { dir: `${OUT}/video-side`, size: { width: 1280, height: 800 } } });
  await offline(ctx); const p = await ctx.newPage();
  await p.goto(`${BASE}/calendario`, { waitUntil: "networkidle" });
  await calSide(p, false); await p.waitForTimeout(800);
  const vid = await p.video().path(); await ctx.close();
  try { execSync(`ffmpeg -y -loglevel error -i ${vid} -vf "fps=8,scale=900:-1:flags=lanczos,split[a][b];[a]palettegen[p];[b][p]paletteuse" ${OUT}/calendar-side.gif`); } catch { console.log("      (ffmpeg not found: kept webm only)"); }
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
// ---- GIF of a live edit: the agent edits a block while the panel is open ----
await check("ui: record live update", async () => {
  const c = await api("/api/videos", { method: "POST", body: JSON.stringify({ title: "Live GIF: why queues matter", format: "longo", status: "Esse mês", script: { conclusao: "Queues let slow work wait without making people wait." } }) });
  const id = c.body.id;
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, recordVideo: { dir: `${OUT}/video-live`, size: { width: 1280, height: 800 } } });
  await offline(ctx);
  const p = await ctx.newPage();
  await p.goto(`${BASE}/kanban`, { waitUntil: "networkidle" }); await liveOn(p); await p.waitForTimeout(600);
  mcpOut(await agentMcp("move_video", { id, status: "Produzindo" })); await p.waitForTimeout(1200);
  await col(p, /Recording|Produzindo/).locator(".card", { hasText: "why queues" }).click(); await p.waitForTimeout(800);
  await conclusionBlock(p).scrollIntoViewIfNeeded();
  const cur = mcpOut(await agentMcp("get_script_block", { id, block: "conclusao" })); await p.waitForTimeout(1800);
  mcpOut(await agentMcp("update_script_block", { id, block: "conclusao", value: "Queues let slow work wait in line, so people never have to.", base_version: cur.version }));
  await p.locator('.change[data-block="conclusao"]').waitFor({ timeout: 4000 }); await p.waitForTimeout(2200);
  const vid = await p.video().path(); await ctx.close();
  try { execSync(`ffmpeg -y -loglevel error -i ${vid} -vf "fps=8,scale=900:-1:flags=lanczos,split[a][b];[a]palettegen[p];[b][p]paletteuse" ${OUT}/live.gif`); }
  catch { console.log("      (ffmpeg not found: kept webm only)"); }
  await api(`/api/videos/${id}`, { method: "DELETE" });
});
await browser.close();

// ---- Auth: a second server configured like production (agent token set). Guards the "no human review" pipeline:
// a PR that loosens auth fails here instead of merging.
{
  const P2 = await new Promise((r) => { const s = createServer().listen(0, () => { const p = s.address().port; s.close(() => r(p)); }); });
  const B2 = `http://localhost:${P2}`, TOKEN = randomBytes(24).toString("hex"); // throwaway, never deployed
  const s2 = spawn("npx", ["wrangler", "dev", "-c", "dist/video_planner/wrangler.json", "--port", String(P2), "--persist-to", STATE, "--var", `AGENT_TOKEN:${TOKEN}`, "--var", "DEV_OPEN:1"], { stdio: ["ignore", "pipe", "pipe"], detached: true });
  s2.stdout.on("data", (d) => (log += d)); s2.stderr.on("data", (d) => (log += d));
  const kill2 = () => { try { process.kill(-s2.pid, "SIGTERM"); } catch {} };
  process.on("exit", kill2);
  const get = (path, headers = {}) => fetch(B2 + path, { headers }).then((r) => r.status).catch(() => 0);
  for (let i = 0; i < 60 && (await get("/api/bootstrap")) === 0; i++) await new Promise((r) => setTimeout(r, 1000));
  await check("auth: no credentials → 401 even on localhost with DEV_OPEN once a token is configured", async () => {
    for (const p of ["/api/bootstrap", "/api/videos", "/mcp"]) { const st = await get(p); assert(st === 401, `${p} → ${st}`); }
  });
  await check("auth: wrong / empty Bearer → 401", async () => {
    for (const h of ["Bearer wrong", "Bearer ", `Bearer ${TOKEN}x`]) { const st = await get("/api/videos", { authorization: h }); assert(st === 401, `"${h}" → ${st}`); }
  });
  await check("auth: forged Access JWT header → 401", async () => {
    const st = await get("/api/videos", { "cf-access-jwt-assertion": [{ alg: "RS256" }, { sub: "x" }].map((o) => Buffer.from(JSON.stringify(o)).toString("base64url")).join(".") + ".c2ln" }); assert(st === 401, `${st}`);
  });
  await check("auth: correct Bearer → 200", async () => {
    const st = await get("/api/videos", { authorization: `Bearer ${TOKEN}` }); assert(st === 200, `${st}`);
  });
  kill2();
}
// Access JWT signature, tested directly on worker/auth.ts with keys made here (the real JWKS fetch is stubbed).
{
  const js = execSync("npx esbuild worker/auth.ts --format=esm --log-level=error").toString();
  const auth = await import("data:text/javascript;base64," + Buffer.from(js).toString("base64"));
  const { subtle } = globalThis.crypto, TEAM = "verify.cloudflareaccess.com", AUD = "verify-aud";
  const gen = () => subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"]);
  const good = await gen(), evil = await gen();
  const jwk = { ...(await subtle.exportKey("jwk", good.publicKey)), kid: "k1" };
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (u) => { assert(String(u) === `https://${TEAM}/cdn-cgi/access/certs`, `fetched ${u}`); return new Response(JSON.stringify({ keys: [jwk] })); };
  const b64 = (x) => Buffer.from(typeof x === "string" ? x : new Uint8Array(x)).toString("base64url");
  const now = Math.floor(Date.now() / 1000);
  const sign = async (key, claims = {}, header = {}) => {
    const h = b64(JSON.stringify({ alg: "RS256", kid: "k1", ...header })), p = b64(JSON.stringify({ aud: [AUD], iss: `https://${TEAM}`, exp: now + 300, ...claims }));
    return `${h}.${p}.${b64(await subtle.sign("RSASSA-PKCS1-v1_5", key.privateKey, new TextEncoder().encode(`${h}.${p}`)))}`;
  };
  const ok = async (jwt) => { auth._resetCerts(); return auth.verifyAccess(jwt, TEAM, AUD).catch(() => false); };
  try {
    await check("auth: Access JWT signed by the team key is accepted", async () => assert(await ok(await sign(good)) === true, "rejected a valid JWT"));
    await check("auth: Access JWT with valid claims but a forged signature → rejected", async () => assert(await ok(await sign(evil)) === false, "accepted forged signature"));
    await check("auth: Access JWT tampered after signing → rejected", async () => {
      const [h, , sig] = (await sign(good)).split("."); const p = b64(JSON.stringify({ aud: [AUD], iss: `https://${TEAM}`, exp: now + 300, email: "attacker@x" }));
      assert(await ok(`${h}.${p}.${sig}`) === false, "accepted tampered payload");
    });
    await check("auth: Access JWT with wrong aud / iss / expired / alg none → rejected", async () => {
      for (const [c, h] of [[{ aud: ["other"] }], [{ iss: "https://evil.com" }], [{ exp: now - 10 }], [{}, { alg: "none" }]]) assert(await ok(await sign(good, c, h)) === false, `accepted ${JSON.stringify({ ...c, ...h })}`);
    });
  } finally { globalThis.fetch = realFetch; }
}

const failed = results.filter((r) => !r.ok);
writeFileSync(`${OUT}/report.json`, JSON.stringify({ verdict: failed.length ? "FAIL" : "PASS", results }, null, 2));
if (failed.length) writeFileSync(`${OUT}/server.log`, log);
console.log(`\n${failed.length ? "FAIL" : "PASS"}  ${results.length - failed.length}/${results.length} checks · screenshots in ${OUT}/`);
if (keep) { console.log(`server running at ${BASE} (Ctrl+C to stop)`); } else { stop(); process.exit(failed.length ? 1 : 0); }
