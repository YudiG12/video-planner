// Pipeline decision for one PR: merge | circuit breaker. See AGENTS.md "Pipeline".
// No human review: every PR from a branch of this repo merges on Codex PASS + green CI (security is guarded by the
// auth checks in verify). PRs from forks are held with needs-owner.
// After merging it publishes a GitHub Release (summary + proof GIF/screens) and a CHANGELOG.md line.
// Each Codex verdict is bound to the commit it reviewed; only the exact Codex bot identity counts.
const { GITHUB_REPOSITORY: R, GH_TOKEN, PR, DRY_RUN } = process.env;
const CODEX = "chatgpt-codex-connector[bot]";
// Sensitive = could loosen security. Only flagged 🔒 in the changelog, never blocks.
const SENSITIVE_PATH = /^(wrangler.*\.jsonc|worker\/agent\.ts|SECURITY\.md|\.github\/)/;
const SENSITIVE_CODE = /cf-access|ACCESS_|AGENT_TOKEN|DEV_OPEN|workers_dev|preview_urls|"routes?"\s*:|custom_domain|Access-Control|cors|safeEqual|unauthorized/i;
const TEST_ONLY = /^(scripts\/verify\.mjs|scripts\/demo-seed\.sql)$/; // local verify app: throwaway tokens, never deployed

const api = async (path, init = {}) => {
  if (DRY_RUN && init.method && init.method !== "GET") { console.log(`[dry-run] ${init.method} ${path}`); return null; }
  const r = await fetch(`https://api.github.com/repos/${R}${path}`, { ...init, headers: { authorization: `Bearer ${GH_TOKEN}`, accept: "application/vnd.github+json", ...(init.headers || {}) } });
  if (!r.ok) throw new Error(`${init.method || "GET"} ${path}: ${r.status} ${await r.text()}`);
  return r.status === 204 ? null : r.json();
};
const all = async (path) => { let out = [], page = 1, got; do { got = await api(`${path}${path.includes("?") ? "&" : "?"}per_page=100&page=${page++}`); out = out.concat(got); } while (got.length === 100); return out; };
const comment = (body) => api(`/issues/${PR}/comments`, { method: "POST", body: JSON.stringify({ body }) });
const label = (name) => api(`/issues/${PR}/labels`, { method: "POST", body: JSON.stringify({ labels: [name] }) });
const stop = (msg) => { console.log(msg); process.exit(0); };

if (!PR) stop("no PR");
const pr = await api(`/pulls/${PR}`);
if (pr.state !== "open" || pr.draft) stop(`PR ${PR}: ${pr.state}${pr.draft ? " draft" : ""}`);
const labels = pr.labels.map((l) => l.name);
// manual brake only: the pipeline never adds needs-owner, but the owner can put it on a PR to hold it
if (labels.includes("needs-owner") || labels.includes("circuit-breaker")) stop("held by label");
// Public repo: anyone can open a PR from a fork. Only branches pushed to this repo (people with write access,
// i.e. the owner and the builder routine) may auto-merge; anything else waits for the owner.
if (pr.head.repo?.full_name !== R) {
  await label("needs-owner").catch(() => {});
  await comment("This PR comes from a fork, so it is never auto-merged. The owner will review it.").catch(() => {});
  stop(`PR ${PR} from ${pr.head.repo?.full_name ?? "a deleted fork"}: held for the owner`);
}
const head = pr.head.sha;

// Verdicts: one per Codex review/comment, each tied to the commit it names
const PASS = /Didn't find any major issues|VERDICT:\s*PASS/i, FAIL = /VERDICT:\s*FAIL/i;
const shaIn = (body) => (/Reviewed commit:\**\s*`([0-9a-f]{7,40})`/.exec(body || "") || [])[1];
const verdicts = [];
for (const r of await all(`/pulls/${PR}/reviews`)) {
  if (r.user?.login !== CODEX) continue;
  const pass = PASS.test(r.body);
  verdicts.push({ sha: r.commit_id, at: r.submitted_at, pass, fail: !pass }); // a Codex review with suggestions = findings
}
for (const c of await all(`/issues/${PR}/comments`)) {
  if (c.user?.login !== CODEX) continue;
  const sha = shaIn(c.body);
  if (!sha) continue; // verdicts without a commit can't be bound to the head: ignored
  verdicts.push({ sha, at: c.created_at, pass: PASS.test(c.body), fail: FAIL.test(c.body) });
}
const latest = verdicts.filter((v) => head.startsWith(v.sha)).sort((a, b) => a.at.localeCompare(b.at)).at(-1);
// Circuit breaker: stop when the agent goes in circles, not when it makes progress.
// Trips if the same Codex finding (same file + title) comes back on a later commit, or after MAX_ROUNDS failed commits.
const MAX_ROUNDS = 5;
const failedShas = new Set(verdicts.filter((v) => v.fail).map((v) => v.sha.slice(0, 7)));
const findingTitle = (body) => ((/\*\*\s*(.+?)\*\*/.exec((body || "").replace(/<[^>]+>|!\[[^\]]*\]\([^)]*\)/g, "")) || [])[1] || "").trim().toLowerCase();
const seen = new Map(); let repeated;
for (const c of await all(`/pulls/${PR}/comments`)) {
  if (c.user?.login !== CODEX || c.in_reply_to_id) continue;
  const key = `${c.path} | ${findingTitle(c.body)}`, sha = (c.original_commit_id || c.commit_id || "").slice(0, 7);
  if (!seen.has(key)) seen.set(key, new Set());
  seen.get(key).add(sha);
  if (seen.get(key).size >= 2) repeated = key;
}
if ((repeated || failedShas.size >= MAX_ROUNDS) && !latest?.pass) {
  await label("circuit-breaker");
  const why = repeated ? `the same finding came back after a fix (\`${repeated}\`)` : `Codex failed ${failedShas.size} commits in a row`;
  await comment(`🛑 **Circuit breaker:** ${why}. Stopping here — @YudiG12 please take a look.`);
  stop("circuit breaker");
}

// Sensitive changes no longer wait: they are only flagged (🔒) in the release and changelog
const files = await all(`/pulls/${PR}/files`);
const sensitive = files.filter((f) => !TEST_ONLY.test(f.filename)).filter((f) => SENSITIVE_PATH.test(f.filename) || (f.patch || "").split("\n").some((l) => /^[+-]/.test(l) && SENSITIVE_CODE.test(l))).map((f) => f.filename);

const runs = await api(`/commits/${head}/check-runs`);
const ci = runs.check_runs.find((c) => c.name === "check")?.conclusion;
if (ci !== "success") stop(`CI: ${ci ?? "pending"}`);
if (!latest?.pass) stop("no Codex PASS for head commit");

await api(`/pulls/${PR}/merge`, { method: "PUT", body: JSON.stringify({ merge_method: "squash", sha: head }) });
await api(`/git/refs/heads/${pr.head.ref}`, { method: "DELETE" }).catch(() => {});
// Merges made with GITHUB_TOKEN don't auto-close the linked issues: close "Closes #N" explicitly
for (const [, n] of (pr.body || "").matchAll(/\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s+#(\d+)/gi)) {
  await api(`/issues/${n}`, { method: "PATCH", body: JSON.stringify({ state: "closed", state_reason: "completed" }) }).catch((e) => console.log(`close #${n} failed: ${e.message}`));
  await api(`/issues/${n}/comments`, { method: "POST", body: JSON.stringify({ body: `Done in #${PR}.` }) }).catch(() => {});
}
await publishChangelog().catch((e) => console.log(`changelog failed (merge kept): ${e.message}`));
// Merges made with GITHUB_TOKEN don't trigger push workflows: dispatch the deploy explicitly
await api(`/actions/workflows/deploy.yml/dispatches`, { method: "POST", body: JSON.stringify({ ref: "main" }) });
console.log(`merged PR ${PR} at ${head.slice(0, 7)} and dispatched deploy`);

// ---- Changelog: one GitHub Release per merged PR + a line in CHANGELOG.md ----
async function publishChangelog() {
  const section = (name) => ((new RegExp(`##\\s*${name}\\s*\\n([\\s\\S]*?)(?=\\n##\\s|$)`).exec(pr.body || "") || [])[1] || "").replace(/<!--[\s\S]*?-->/g, "").trim();
  const issue = (/Closes\s+#(\d+)/i.exec(pr.body || "") || [])[1];
  const lock = sensitive.length ? "🔒 " : "";
  const proof = (await all(`/issues/${PR}/comments`)).filter((c) => c.body?.startsWith("<!-- pr-proof -->")).at(-1)?.body.replace("<!-- pr-proof -->", "").trim() || "_no proof comment_";
  let body = `${section("Summary") || pr.title}\n\n`;
  if (section("Decisions")) body += `### Decisions\n${section("Decisions")}\n\n`;
  if (sensitive.length) body += `### 🔒 Security-sensitive\nTouched: ${sensitive.map((f) => `\`${f}\``).join(", ")}\n\n`;
  body += `PR #${PR}${issue ? ` · closes #${issue}` : ""} · commit \`${head.slice(0, 7)}\`\n\n---\n${proof}\n`;
  const rel = await api(`/releases`, { method: "POST", body: JSON.stringify({ tag_name: `pr-${PR}`, target_commitish: "main", name: `${lock}${pr.title}`, body }) });
  const date = new Date().toISOString().slice(0, 10);
  const line = `- ${date} · ${lock}**${pr.title}** ([#${PR}](https://github.com/${R}/pull/${PR}) · [release with GIF/screens](${rel?.html_url || `https://github.com/${R}/releases/tag/pr-${PR}`}))`;
  const cur = await api(`/contents/CHANGELOG.md?ref=main`).catch(() => null);
  const text = cur ? Buffer.from(cur.content, "base64").toString("utf8") : "# Changelog\n\nOne line per merged PR (newest first). Each links to a release with the verify GIF and screenshots.\n\n";
  const [headTxt, ...rest] = text.split(/\n(?=- )/);
  const next = `${headTxt.trimEnd()}\n\n${line}\n${rest.length ? rest.join("\n") : ""}`.replace(/\n{3,}/g, "\n\n");
  await api(`/contents/CHANGELOG.md`, { method: "PUT", body: JSON.stringify({ message: `changelog: #${PR} ${pr.title}`, content: Buffer.from(next).toString("base64"), sha: cur?.sha, branch: "main" }) });
}
