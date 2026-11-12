// Word-level diff for "what the agent changed": inserted text highlighted, removed text struck through.
export type Part = { k: "=" | "+" | "-"; s: string };

const tok = (s: string) => s.match(/\s+|[^\s]+/g) || [];

export function wordDiff(a: string, b: string): Part[] {
  const x = tok(a), y = tok(b);
  // common prefix/suffix first: agent edits are usually local, so the LCS table stays small
  let p = 0; while (p < x.length && p < y.length && x[p] === y[p]) p++;
  let q = 0; while (q < x.length - p && q < y.length - p && x[x.length - 1 - q] === y[y.length - 1 - q]) q++;
  const xs = x.slice(p, x.length - q), ys = y.slice(p, y.length - q);
  const mid: Part[] = [];
  if (xs.length * ys.length > 4_000_000) { // too big for LCS: show it as replaced
    if (xs.length) mid.push({ k: "-", s: xs.join("") });
    if (ys.length) mid.push({ k: "+", s: ys.join("") });
  } else {
    const n = xs.length, m = ys.length;
    const L = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
    for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i][j] = xs[i] === ys[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
    let i = 0, j = 0;
    while (i < n || j < m) {
      if (i < n && j < m && xs[i] === ys[j]) { mid.push({ k: "=", s: xs[i] }); i++; j++; }
      // removals before insertions: "~~old~~ new" reads like an edit
      else if (i < n && (j === m || L[i + 1][j] >= L[i][j + 1])) { mid.push({ k: "-", s: xs[i] }); i++; }
      else { mid.push({ k: "+", s: ys[j] }); j++; }
    }
  }
  const all: Part[] = [{ k: "=", s: x.slice(0, p).join("") }, ...mid, { k: "=", s: x.slice(x.length - q).join("") }];
  // merge neighbours of the same kind
  const out: Part[] = [];
  for (const part of all) {
    if (!part.s) continue;
    const last = out[out.length - 1];
    if (last && last.k === part.k) last.s += part.s; else out.push({ ...part });
  }
  return out;
}

// Long unchanged stretches are shortened to "…" so the change itself stays in view.
export function DiffText({ before, after }: { before: string; after: string }) {
  const parts = wordDiff(before, after);
  return (
    <div className="diff">
      {parts.map((p, i) => p.k === "+" ? <ins key={i}>{p.s}</ins> : p.k === "-" ? <del key={i}>{p.s}</del>
        : <span key={i}>{p.s.length > 280 ? (i === 0 ? "…" + p.s.slice(-120) : i === parts.length - 1 ? p.s.slice(0, 120) + "…" : p.s.slice(0, 100) + " … " + p.s.slice(-100)) : p.s}</span>)}
    </div>
  );
}
