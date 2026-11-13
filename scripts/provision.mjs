#!/usr/bin/env node
// Creates the Cloudflare resources wrangler.jsonc names but that don't exist yet (queues, R2 buckets).
// Runs in deploy.yml before `wrangler deploy`: a PR that adds a binding can't break production by
// pointing at a resource nobody created (2026-11-13: six deploys failed on a missing queue).
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
const cfg = JSON.parse(readFileSync("wrangler.jsonc", "utf8").replace(/^\s*\/\/.*$/gm, "").replace(/,(\s*[}\]])/g, "$1"));
const sh = (args) => { try { execFileSync("npx", ["wrangler", ...args], { stdio: "pipe" }); return true; } catch { return false; } };
const queues = new Set([
  ...(cfg.queues?.producers ?? []).map((q) => q.queue),
  ...(cfg.queues?.consumers ?? []).flatMap((q) => [q.queue, q.dead_letter_queue]),
].filter(Boolean));
for (const q of queues) {
  if (sh(["queues", "info", q])) console.log(`queue ${q}: ok`);
  else if (sh(["queues", "create", q])) console.log(`queue ${q}: created`);
  else { console.error(`queue ${q}: missing and could not be created (token needs Queues Write)`); process.exitCode = 1; }
}
for (const b of (cfg.r2_buckets ?? []).map((b) => b.bucket_name)) {
  if (sh(["r2", "bucket", "info", b])) console.log(`bucket ${b}: ok`);
  else if (sh(["r2", "bucket", "create", b])) console.log(`bucket ${b}: created`);
  else { console.error(`bucket ${b}: missing and could not be created`); process.exitCode = 1; }
}
