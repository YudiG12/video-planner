#!/usr/bin/env node
// Builds the PR "proof" comment from verify-out/: verdict, checks, GIF and screenshots.
// Images are pushed to the `verify-assets` branch by CI and linked from there.
import { readFileSync, readdirSync, existsSync } from "node:fs";
const [repo, pr, sha] = process.argv.slice(2);
const r = JSON.parse(readFileSync("verify-out/report.json", "utf8"));
const raw = (f) => `https://raw.githubusercontent.com/${repo}/verify-assets/pr-${pr}/${sha}/${f}`;
const pngs = readdirSync("verify-out").filter((f) => f.endsWith(".png"));
const ok = r.verdict === "PASS";
let md = `<!-- pr-proof -->\n## ${ok ? "✅" : "❌"} Verify: ${r.verdict} · ${r.results.filter((x) => x.ok).length}/${r.results.length}\n<sub>commit ${sha.slice(0, 7)} · local app with fake data · \`npm run verify\`</sub>\n\n`;
if (existsSync("verify-out/flow.gif")) md += `### Main flow\n![flow](${raw("flow.gif")})\n\n`;
md += `### Screens\n<table><tr>${pngs.map((f, i) => `${i && i % 2 === 0 ? "</tr><tr>" : ""}<td><b>${f.replace(".png", "")}</b><br><a href="${raw(f)}"><img src="${raw(f)}" width="420"></a></td>`).join("")}</tr></table>\n\n`;
md += `<details><summary>Checks</summary>\n\n${r.results.map((x) => `- ${x.ok ? "✅" : "❌"} ${x.name}${x.ok ? "" : ` — ${x.error}`}`).join("\n")}\n</details>\n`;
process.stdout.write(md);
