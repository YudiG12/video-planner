// Pipeline decision for one PR: merge | wait for owner | circuit breaker. See AGENTS.md "Pipeline".
// Each Codex verdict is bound to the commit it reviewed; only the exact Codex bot identity counts.
const { GITHUB_REPOSITORY: R, GH_TOKEN, PR, DRY_RUN } = process.env;
const CODEX = "chatgpt-codex-connector[bot]";
const SENSITIVE_PATH = /^(wrangler.*\.jsonc|worker\/agent\.ts|SECURITY\.md|\.github\/)/;
const SENSITIVE_CODE = /cf-access|ACCESS_|AGENT_TOKEN|DEV_OPEN|workers_dev|Access-Control|cors|safeEqual|unauthorized/i;

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
if (labels.includes("precisa-yudi") || labels.includes("disjuntor")) stop("waiting for owner");
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
const failedShas = new Set(verdicts.filter((v) => v.fail).map((v) => v.sha.slice(0, 7)));

if (failedShas.size >= 2 && !latest?.pass) {
  await label("disjuntor");
  await comment(`🛑 **Circuit breaker:** Codex failed this PR on ${failedShas.size} commits. Stopping here — @YudiG12 please take a look.`);
  stop("circuit breaker");
}

// Sensitive changes wait for the owner (patches read fully in memory, no pipes)
const files = await all(`/pulls/${PR}/files`);
const hits = files.filter((f) => SENSITIVE_PATH.test(f.filename) || (f.patch || "").split("\n").some((l) => /^[+-]/.test(l) && SENSITIVE_CODE.test(l))).map((f) => f.filename);
const uninspectable = files.length >= 3000 || files.some((f) => !f.patch && f.status !== "removed" && /\.(ts|tsx|js|mjs|jsonc?)$/.test(f.filename));
if (hits.length || uninspectable) {
  await label("precisa-yudi");
  await comment(`✋ **Waiting for @YudiG12:** this PR touches security-sensitive areas (${hits.join(", ") || "diff too large to inspect"}). Not merging automatically.`);
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
