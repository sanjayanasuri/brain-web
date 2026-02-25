#!/usr/bin/env bash
# Quick daily operational summary for Sanjay.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
TASKS="$ROOT/.clawdbot/active-tasks.json"

if [[ ! -f "$TASKS" ]]; then
  echo "No active-tasks.json found."
  exit 0
fi

# Handle accidental multi-document JSON by using the last array document.
TASKS_JSON=$(jq -s 'last // []' "$TASKS")

printf "\n=== CLAWDBOT DIGEST (%s) ===\n" "$(date)"

running=$(echo "$TASKS_JSON" | jq '[.[] | select(.status=="running")] | length')
ready=$(echo "$TASKS_JSON" | jq '[.[] | select(.status=="ready")] | length')
failed=$(echo "$TASKS_JSON" | jq '[.[] | select(.status=="failed")] | length')

echo "Running: $running | Ready: $ready | Failed: $failed"

if (( ready > 0 )); then
  printf "\nReady PRs:\n"
  echo "$TASKS_JSON" | jq -r '.[] | select(.status=="ready") | "- \(.task_id): PR #\(.pr_number // "?") \(.pr_url // "")"'
fi

if (( failed > 0 )); then
  printf "\nFailed tasks:\n"
  echo "$TASKS_JSON" | jq -r '.[] | select(.status=="failed") | "- \(.task_id) (retries: \(.retries // 0))"'
fi

if command -v gh >/dev/null 2>&1; then
  printf "\nOpen PRs (top 10):\n"
  gh pr list --limit 10 --json number,title,headRefName,state,url --jq '.[] | "- #\(.number) [\(.state)] \(.title) (\(.headRefName)) -> \(.url)"' || true
fi

echo ""
