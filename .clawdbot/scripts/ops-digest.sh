#!/usr/bin/env bash
# Quick daily operational summary for Sanjay.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
TASKS="$ROOT/.clawdbot/active-tasks.json"

if [[ ! -f "$TASKS" ]]; then
  echo "No active-tasks.json found."
  exit 0
fi

printf "\n=== CLAWDBOT DIGEST (%s) ===\n" "$(date)"

running=$(jq '[.[] | select(.status=="running")] | length' "$TASKS")
ready=$(jq '[.[] | select(.status=="ready")] | length' "$TASKS")
failed=$(jq '[.[] | select(.status=="failed")] | length' "$TASKS")

echo "Running: $running | Ready: $ready | Failed: $failed"

if [[ "$ready" -gt 0 ]]; then
  echo "\nReady PRs:"
  jq -r '.[] | select(.status=="ready") | "- \(.task_id): PR #\(.pr_number // "?") \(.pr_url // "")"' "$TASKS"
fi

if [[ "$failed" -gt 0 ]]; then
  echo "\nFailed tasks:"
  jq -r '.[] | select(.status=="failed") | "- \(.task_id) (retries: \(.retries // 0))"' "$TASKS"
fi

if command -v gh >/dev/null 2>&1; then
  echo "\nOpen PRs (top 10):"
  gh pr list --limit 10 --json number,title,headRefName,state,url --jq '.[] | "- #\(.number) [\(.state)] \(.title) (\(.headRefName)) -> \(.url)"' || true
fi

echo ""
