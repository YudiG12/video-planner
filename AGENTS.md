# Deploying Video Planner (for AI coding agents)

1. `npm ci`
2. Make sure `npx wrangler whoami` shows a logged-in account; if not, ask the user to run `npx wrangler login`.
3. `npm run setup` (creates D1, migrates, deploys both Workers, writes `.agent-token`).
4. Tell the user to protect the `video-planner` Worker with Cloudflare Access (README, "Protect the app"), then set `ACCESS_TEAM_DOMAIN` and `ACCESS_AUD` with `wrangler secret put`. Never print or commit `.agent-token`.
5. Register the MCP: `claude mcp add --transport http video-planner https://video-planner-agent.<subdomain>.workers.dev/mcp --header "Authorization: Bearer $(cat .agent-token)"`.

# Verify a change (builder and verifier)

Node 22+ (`.nvmrc`). `npm ci && npx playwright install chromium && npm run verify`

Builds the app, runs it on a throwaway local D1 with fake demo data (never production), checks the API + MCP, and saves screenshots of every view to `verify-out/` plus `verify-out/report.json` (`verdict: PASS|FAIL`). `npm run verify -- --keep` leaves the server up to explore by hand.

**Verifier (Codex):** you did not write this code. Run `npm run verify`, then check the PR's "Done when…" items yourself against the running app (`--keep`) and the screenshots. Reply on the PR with `VERDICT: PASS` or `VERDICT: FAIL` + what failed, and attach the relevant screenshots. Don't fix the code.

**Builder (Claude):** a PR is ready only when `npm run verify` passes. If you add a feature, add its check to `scripts/verify.mjs` and a line to the map below. Fill the PR template (Summary, Decisions, Attention). CI posts the proof comment (verdict, GIF, screenshots) automatically.

## Feature map

| Feature | Where | Checked by verify |
|---|---|---|
| Kanban (drag between statuses, Recent strip) | `src/App.tsx` Kanban | ui: kanban |
| Calendar by publish date | `src/App.tsx` Calendar | ui: calendario |
| Derivatives checklist | `src/App.tsx` Derivados | ui: derivados |
| Ideas by series (long-form first, series logo) | `src/App.tsx` Ideias | ui: ideias |
| Video panel: script blocks, hook, series line, YT preview | `src/App.tsx` Panel/Script | ui: video panel |
| REST API: videos CRUD, bootstrap | `worker/index.ts`, `worker/store.ts` | api: * |
| Image assets (png/jpeg/webp/gif, 1.5 MB) | `saveAsset` in `worker/store.ts` | api: upload / rejects |
| MCP tools (list/create/update/move videos, script blocks, upload_image) | `worker/mcp.ts` | mcp: * |
| Update a series (logo, color, bg, description): MCP `update_series`, REST `PATCH /api/series/:id` | `updateSeries` in `worker/store.ts`, `worker/mcp.ts`, `worker/index.ts` | api: update series * / mcp: update_series |
| Per-block script versions: `base_version` conflicts (409), previous value, block-name allow-list; editor shows conflicts and keeps the owner's text | `setBlock`/`getBlock` in `worker/store.ts`, `GET/PUT /api/videos/:id/script/:block`, MCP `update_script_block`/`get_script_block`, `useData.saveBlock` + `ConflictNote` in `src/App.tsx`, `Field` in `src/editor.tsx` | api: same block saved twice… / previous value… / concurrent writes… / unknown block names / mcp: update_script_block… / ui: editing a script block… / ui: conflict… |
| Auth: Cloudflare Access JWT or agent Bearer; localhost only with `DEV_OPEN=1` | `worker/index.ts` middleware | — (sensitive: human review) |

# Pipeline (issue → PR → verify → merge → deploy)

1. Work is queued as GitHub issues labeled `agent`, each with "Done when…". One open PR per repo at a time.
2. Builder (Claude, cloud) takes the oldest `agent` issue, works on a branch, runs `npm run verify`, opens a PR with the template (Summary, Decisions, Attention) and `Closes #N`.
3. CI posts the proof comment (verdict, GIF, screenshots). Codex reviews/verifies.
4. `auto-merge.yml` merges when Codex passes and CI is green, then deploys. It **does not merge** (label `needs-owner`) when the PR touches `wrangler*.jsonc`, `worker/agent.ts`, `SECURITY.md`, `.github/` or auth code (Access, tokens, CORS, `workers_dev`, `DEV_OPEN`). After 2 Codex failures it labels `circuit-breaker` and stops.
5. Migrations merge automatically; put the D1 Time Travel bookmark in the PR's "Attention".
