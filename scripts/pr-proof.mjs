#!/usr/bin/env node
// Builds the PR "proof" comment from verify-out/: verdict, checks, GIF and screenshots.
// Images are pushed to the `verify-assets` branch by CI and linked from there.
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
const [repo, pr, sha] = process.argv.slice(2);
const r = JSON.parse(readFileSync("verify-out/report.json", "utf8"));
// github.com/<repo>/raw/… works for private repos too and is what the Herdr panel reads
const raw = (f) => `https://github.com/${repo}/raw/verify-assets/pr-${pr}/${sha}/${f}`;
const pngs = readdirSync("verify-out").filter((f) => f.endsWith(".png"));
const ok = r.verdict === "PASS";
let md = `<!-- pr-proof -->\n## ${ok ? "✅" : "❌"} Verify: ${r.verdict} · ${r.results.filter((x) => x.ok).length}/${r.results.length}\n<sub>commit ${sha.slice(0, 7)} · local app with fake data · \`npm run verify\`</sub>\n\n`;
// Cover: the screenshot named in the PR body's "## Cover" section (the one that best shows this PR's
// feature). First image of the proof and the release; the owner's Herdr panel uses it as the thumbnail.
let body = "";
try { body = execFileSync("gh", ["pr", "view", pr, "--repo", repo, "--json", "body", "-q", ".body"], { encoding: "utf8" }); } catch {}
const named = (/##\s*Cover\s*\n(?:<!--[\s\S]*?-->\s*)?`?([\w.-]+\.png)`?/i.exec(body) || [])[1];
const cover = named && pngs.includes(named) ? named : pngs[0];
if (cover) md += `![cover](${raw(cover)})\n\n`;
if (existsSync("verify-out/flow.gif")) md += `### Main flow\n![flow](${raw("flow.gif")})\n\n`;
if (existsSync("verify-out/live.gif")) md += `### Live update (agent edits a block while the app is open)\n![live](${raw("live.gif")})\n\n`;
md += `### Screens\n<table><tr>${pngs.map((f, i) => `${i && i % 2 === 0 ? "</tr><tr>" : ""}<td><b>${f.replace(".png", "")}</b><br><a href="${raw(f)}"><img src="${raw(f)}" width="420"></a></td>`).join("")}</tr></table>\n\n`;
md += `<details><summary>Checks</summary>\n\n${r.results.map((x) => `- ${x.ok ? "✅" : "❌"} ${x.name}${x.ok ? "" : ` — ${x.error}`}`).join("\n")}\n</details>\n`;
process.stdout.write(md);
