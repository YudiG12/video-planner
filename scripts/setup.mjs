// Deploy your own: creates the D1 database, applies migrations, generates the agent token and deploys both Workers.
// Usage: npx wrangler login && npm run setup
import { execSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";

const sh = (cmd, opts = {}) => execSync(cmd, { stdio: ["pipe", "pipe", "inherit"], encoding: "utf8", ...opts });
const files = ["wrangler.jsonc", "wrangler.agent.jsonc"];

// 1. D1
if (readFileSync("wrangler.jsonc", "utf8").includes("REPLACE_WITH_YOUR_D1_ID")) {
  console.log("› Creating D1 database video-planner");
  const out = sh("npx wrangler d1 create video-planner");
  const id = /"?database_id"?\s*[:=]\s*"([0-9a-f-]{36})"/.exec(out)?.[1];
  if (!id) throw new Error("Could not read database_id from wrangler output:\n" + out);
  for (const f of files) writeFileSync(f, readFileSync(f, "utf8").replace("REPLACE_WITH_YOUR_D1_ID", id));
}
console.log("› Applying migrations");
sh("npx wrangler d1 migrations apply video-planner --remote", { stdio: "inherit" });

// 2. Deploy
console.log("› Building and deploying");
sh("npm run deploy", { stdio: "inherit" });

// 3. Agent token (kept in .agent-token, git-ignored)
let token = existsSync(".agent-token") ? readFileSync(".agent-token", "utf8").trim() : "";
if (!token) { token = randomBytes(24).toString("hex"); writeFileSync(".agent-token", token + "\n", { mode: 0o600 }); }
for (const f of files) sh(`npx wrangler secret put AGENT_TOKEN -c ${f}`, { input: token });

console.log(`
Done.

App:    https://video-planner.<your-subdomain>.workers.dev   (protect it with Cloudflare Access, see README)
Agent:  https://video-planner-agent.<your-subdomain>.workers.dev/mcp

Add the MCP to Claude Code (token is in .agent-token):
  claude mcp add --transport http video-planner https://video-planner-agent.<your-subdomain>.workers.dev/mcp --header "Authorization: Bearer $(cat .agent-token)"
`);
