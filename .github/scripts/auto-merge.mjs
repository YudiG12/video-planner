// Pipeline decision for one PR: merge | wait for owner | circuit breaker. See AGENTS.md "Pipeline".
// Each Codex verdict is bound to the commit it reviewed; only the exact Codex bot identity counts.
const { GITHUB_REPOSITORY: R, GH_TOKEN, PR, DRY_RUN } = process.env;
const CODEX = "chatgpt-codex-connector[bot]";
// Owner rule: wait only for changes that could LOOSEN security (auth, Access, tokens, CORS, public routes, workers_dev)
// or that change the pipeline itself. New infra (bindings, Durable Objects, queues) merges like any other change.
const SENSITIVE_PATH = /^(worker\/agent\.ts|SECURITY\.md|\.github\/)/;
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
if (labels.includes("needs-owner") || labels.includes("circuit-breaker")) stop("waiting for owner");
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

// Sensitive changes wait for the owner (patches read fully in memory, no pipes)
const files = await all(`/pulls/${PR}/files`);
const reasons = [];
for (const f of files) {
  if (SENSITIVE_PATH.test(f.filename)) { reasons.push(`\`${f.filename}\` (${f.filename.startsWith(".github/") ? "pipeline" : "auth"} file)`); continue; }
  if (TEST_ONLY.test(f.filename)) continue;
  const lines = (f.patch || "").split("\n").filter((l) => /^[+-]/.test(l) && !/^(\+\+\+|---)/.test(l) && SENSITIVE_CODE.test(l));
  for (const l of lines.slice(0, 3)) reasons.push(`\`${f.filename}\`: \`${l.trim().slice(0, 140).replace(/`/g, "'")}\``);
}
const uninspectable = files.length >= 3000 || files.some((f) => !f.patch && f.status !== "removed" && /\.(ts|tsx|js|mjs|jsonc?)$/.test(f.filename));
if (reasons.length || uninspectable) {
  await label("needs-owner");
  await comment(`✋ **Waiting for @YudiG12:** this PR may loosen security or changes the pipeline. Lines that triggered it:\n\n${reasons.map((r) => `- ${r}`).join("\n") || "- diff too large to inspect"}\n\nIf none of these loosen anything, remove the \`needs-owner\` label and it merges on the next Codex PASS.`);
  stop("sensitive");
}

const runs = await api(`/commits/${head}/check-runs`);
const ci = runs.check_runs.find((c) => c.name === "check")?.conclusion;
if (ci !== "success") stop(`CI: ${ci ?? "pending"}`);
if (!latest?.pass) stop("no Codex PASS for head commit");

await api(`/pulls/${PR}/merge`, { method: "PUT", body: JSON.stringify({ merge_method: "squash", sha: head }) });
await api(`/git/refs/heads/${pr.head.ref}`, { method: "DELETE" }).catch(() => {});
// Merges made with GITHUB_TOKEN don't trigger push workflows: dispatch the deploy explicitly
await api(`/actions/workflows/deploy.yml/dispatches`, { method: "POST", body: JSON.stringify({ ref: "main" }) });
console.log(`merged PR ${PR} at ${head.slice(0, 7)} and dispatched deploy`);
