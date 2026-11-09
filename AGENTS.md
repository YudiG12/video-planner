# Deploying Video Planner (for AI coding agents)

1. `npm ci`
2. Make sure `npx wrangler whoami` shows a logged-in account; if not, ask the user to run `npx wrangler login`.
3. `npm run setup` (creates D1, migrates, deploys both Workers, writes `.agent-token`).
4. Tell the user to protect the `video-planner` Worker with Cloudflare Access (README, "Protect the app"), then set `ACCESS_TEAM_DOMAIN` and `ACCESS_AUD` with `wrangler secret put`. Never print or commit `.agent-token`.
5. Register the MCP: `claude mcp add --transport http video-planner https://video-planner-agent.<subdomain>.workers.dev/mcp --header "Authorization: Bearer $(cat .agent-token)"`.
