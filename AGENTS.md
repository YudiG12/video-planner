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
| Browser tab icon: `public/favicon.svg` (calendar + play) and `apple-touch-icon.png`, linked in `index.html` | `index.html`, `public/` | ui: browser tab icon… (`favicon.png`) |
| Kanban (drag between statuses, Recent strip) | `src/App.tsx` Kanban | ui: kanban |
| Calendar by publish date | `src/App.tsx` Calendar | ui: calendario |
| Calendar side panel: videos with no date grouped by kanban status, in kanban order; drag to reorder (changes the board order) or into another group (changes status) ("No date" button, remembered open/closed); drag in to schedule, drag a calendar chip onto it to clear the date | `src/App.tsx` Calendar (`.cal-side`), `src/styles.css` | ui: calendar side panel… / ui: reordering in the calendar side panel… / `calendar-side.gif` |
| Derivatives checklist | `src/App.tsx` Derivados | ui: derivados |
| Ideas by series (long-form first, series logo) | `src/App.tsx` Ideias | ui: ideias |
| Video panel: script blocks, hook, series line, YT preview | `src/App.tsx` Panel/Script | ui: video panel |
| Change series and sponsor from the video details (panel and full page): click the series chip / sponsor, pick from the list (Esc or click outside closes) | `Meta` in `src/App.tsx`, `.meta-pop` in `src/styles.css` | ui: video details let you change the series and the sponsor / `panel-series-sponsor.gif` |
| REST API: videos CRUD, bootstrap | `worker/index.ts`, `worker/store.ts` | api: * |
| Image assets (png/jpeg/webp/gif, 1.5 MB) | `saveAsset` in `worker/store.ts` | api: upload / rejects |
| MCP tools (list/create/update/move videos, script blocks, upload_image) | `worker/mcp.ts` | mcp: * |
| Update a series (logo, color, bg, description): MCP `update_series`, REST `PATCH /api/series/:id` | `updateSeries` in `worker/store.ts`, `worker/mcp.ts`, `worker/index.ts` | api: update series * / mcp: update_series |
| Per-block script versions: `base_version` conflicts (409), previous value, block-name allow-list; editor shows conflicts and keeps the owner's text | `setBlock`/`getBlock` in `worker/store.ts`, `GET/PUT /api/videos/:id/script/:block`, MCP `update_script_block`/`get_script_block`, `useData.saveBlock` + `ConflictNote` in `src/App.tsx`, `Field` in `src/editor.tsx` | api: same block saved twice… / previous value… / concurrent writes… / unknown block names / mcp: update_script_block… / ui: editing a script block… / ui: conflict… |
| Live updates: writes from both Workers reach open tabs (WebSocket, Durable Object `LiveHub`); agent-editing highlight; inserted/removed text marked until "ok, seen"; kanban "changed" dot; "Claude changed this block · view / apply" while the owner types; respects reduced motion | `worker/live.ts`, `emit` in `worker/store.ts`, `/api/live` in `worker/index.ts`, `useLive` + `LiveNote` in `src/App.tsx`, `Field` (incoming note) in `src/editor.tsx`, `src/diff.tsx`, `durable_objects` in `wrangler*.jsonc` | live: * / ui: record live update (`live.gif`) |
| Auth: Cloudflare Access JWT or agent Bearer; localhost only with `DEV_OPEN=1` | `worker/index.ts` middleware, `worker/auth.ts` (JWT signature, constant-time compare) | auth: * (second server with a token set + JWT signed/forged with keys made in verify) |
| Changelog: GitHub Release per merged PR (summary + proof GIF/screens) + line in `CHANGELOG.md` | `publishChangelog` in `.github/scripts/auto-merge.mjs` | — (runs on merge) |

# Pipeline (issue → PR → verify → merge → deploy)

1. Work is queued as GitHub issues labeled `agent`, each with "Done when…". One open PR per repo at a time.
2. Builder (Claude, cloud) takes the oldest `agent` issue, works on a branch, runs `npm run verify`, opens a PR with the template (Summary, Decisions, Attention) and `Closes #N`.
3. CI posts the proof comment (verdict, GIF, screenshots). Codex reviews/verifies.
4. `auto-merge.yml` merges every PR when Codex passes and CI is green, then deploys. No human review: security is guarded by the `auth:` checks in verify (a PR that loosens auth fails CI), and the merge script always runs from `main`, so a PR can't change its own merge rules. PRs touching sensitive paths (`wrangler*.jsonc`, `worker/agent.ts`, `SECURITY.md`, `.github/`, auth code) are only flagged 🔒 in the changelog. It labels `circuit-breaker` and stops only when the same Codex finding comes back after a fix, or after 5 failed rounds. The owner can hold any PR by adding the `needs-owner` label by hand.
   **Production first:** `scripts/provision.mjs` creates queues/buckets named in wrangler.jsonc on deploy; after deploying, CI checks the agent Worker's `/health` (db, live, agent_token) and that the app is still behind Access. If a deploy fails, CI opens an issue labeled `deploy-failed`; the builder takes it before any other issue and auto-merge holds every other PR until main deploys green.
5. Migrations merge automatically; put the D1 Time Travel bookmark in the PR's "Attention".
6. On merge, a GitHub Release `pr-N` is published (Summary, Decisions, proof GIF + screenshots) and a line is added to `CHANGELOG.md`. Write the PR Summary for the owner: it becomes the changelog entry.
   **Cover:** every PR fills `## Cover` in its body with one screenshot file name from `verify-out/` that best shows *this* PR's feature (the new screen or state, not the start page). CI puts it as the first image of the proof and the release; it is the thumbnail in the owner's panel. If the feature has no screenshot yet, add one to `scripts/verify.mjs`.
