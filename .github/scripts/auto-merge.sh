#!/usr/bin/env bash
# Decision: merge | wait for owner | circuit breaker. See AGENTS.md "Pipeline".
set -euo pipefail
[ -z "${PR:-}" ] && { echo "no PR"; exit 0; }
R=$GITHUB_REPOSITORY
state=$(gh pr view "$PR" --json state,isDraft -q '.state + " " + (.isDraft|tostring)')
[ "$state" != "OPEN false" ] && { echo "PR $PR: $state"; exit 0; }
labels=$(gh pr view "$PR" --json labels -q '[.labels[].name] | join(",")')
case ",$labels," in *",precisa-yudi,"*|*",disjuntor,"*) echo "waiting for owner ($labels)"; exit 0;; esac
head=$(gh pr view "$PR" --json headRefOid -q .headRefOid)

# Codex verdicts on this PR (reviews + comments by the Codex bot)
codex=$(gh api "repos/$R/pulls/$PR/reviews" --paginate -q '.[] | select(.user.login|test("codex")) | .body'
        gh api "repos/$R/issues/$PR/comments" --paginate -q '.[] | select(.user.login|test("codex")) | .body')
# PASS must be about the current head commit (Codex writes "Reviewed commit: `<sha10>`")
pass=$(printf '%s' "$codex" | tr '\n' ' ' | grep -oE "(Didn't find any major issues|VERDICT: *PASS)[^<]{0,400}Reviewed commit:\*\* *\`[0-9a-f]+|VERDICT: *PASS[^@]{0,200}${head:0:7}" | grep -c "${head:0:7}" || true)
fail=$(gh api "repos/$R/pulls/$PR/comments" --paginate -q '[.[] | select(.user.login|test("codex")) | .commit_id] | unique | length')
fail=$(( fail + $(printf '%s' "$codex" | grep -ciE "VERDICT: *FAIL" || true) ))

if [ "$fail" -ge 2 ] && [ "$pass" -eq 0 ]; then
  gh pr edit "$PR" --add-label disjuntor
  gh pr comment "$PR" --body "🛑 **Circuit breaker:** Codex failed this PR $fail times. Stopping here — @YudiG12 please take a look."
  exit 0
fi

# Sensitive paths: anything that could loosen security waits for the owner
sensitive=$(gh pr diff "$PR" --name-only | grep -E '^(wrangler.*\.jsonc|worker/agent\.ts|SECURITY\.md|\.github/)' || true)
if gh pr diff "$PR" | grep -E '^[+-]' | grep -qE 'cf-access|ACCESS_|AGENT_TOKEN|DEV_OPEN|workers_dev|Access-Control|cors|safeEqual|unauthorized'; then sensitive="$sensitive auth code"; fi
if [ -n "$sensitive" ]; then
  gh pr edit "$PR" --add-label precisa-yudi
  gh pr comment "$PR" --body "✋ **Waiting for @YudiG12:** this PR touches security-sensitive areas ($(echo $sensitive | tr '\n' ' ')). Not merging automatically."
  exit 0
fi

ci=$(gh api "repos/$R/commits/$head/check-runs" -q '[.check_runs[] | select(.name=="check")][0].conclusion // "pending"')
[ "$ci" != "success" ] && { echo "CI: $ci"; exit 0; }
[ "$pass" -eq 0 ] && { echo "no Codex PASS yet"; exit 0; }

gh pr merge "$PR" --squash --delete-branch --match-head-commit "$head"
# Merges made with GITHUB_TOKEN don't trigger push workflows: dispatch the deploy explicitly
gh workflow run deploy.yml --ref main
echo "merged PR $PR and dispatched deploy"
