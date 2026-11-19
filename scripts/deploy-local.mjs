// Deploy from your machine. wrangler*.jsonc keep the REPLACE_WITH_YOUR_D1_ID placeholder (CI fills it from a secret),
// so this fills it in place, runs `npm run deploy` and always puts the placeholder back.
// D1 id: $D1_DATABASE_ID, or the one in wrangler.local.jsonc (git-ignored, written by setup).
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { execSync } from "node:child_process";
let id = process.env.D1_DATABASE_ID;
if (!id && existsSync("wrangler.local.jsonc")) id = readFileSync("wrangler.local.jsonc", "utf8").match(/"database_id":\s*"([0-9a-f-]{36})"/)?.[1];
if (!id) { console.error("D1 id not found: set D1_DATABASE_ID or run npm run setup"); process.exit(1); }
const files = ["wrangler.jsonc", "wrangler.agent.jsonc"];
const orig = files.map((f) => readFileSync(f, "utf8"));
try {
  files.forEach((f, i) => writeFileSync(f, orig[i].replaceAll("REPLACE_WITH_YOUR_D1_ID", id)));
  execSync("npm run deploy", { stdio: "inherit" });
} finally {
  files.forEach((f, i) => writeFileSync(f, orig[i]));
}
