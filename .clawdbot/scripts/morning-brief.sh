#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
IDEAS="$ROOT/.clawdbot/ideas.json"
TASKS="$ROOT/.clawdbot/active-tasks.json"

echo "=== BUJJI MORNING BRIEF ($(date)) ==="

if [[ -f "$TASKS" ]]; then
  running=$(jq '[.[] | select(.status=="running")] | length' "$TASKS" 2>/dev/null || echo 0)
  ready=$(jq '[.[] | select(.status=="ready" or .status=="merged")] | length' "$TASKS" 2>/dev/null || echo 0)
  failed=$(jq '[.[] | select(.status=="failed")] | length' "$TASKS" 2>/dev/null || echo 0)
  echo "Tasks: running=$running ready/merged=$ready failed=$failed"
fi

echo
if [[ -f "$IDEAS" ]]; then
  echo "Top proposed ideas (approve by index):"
  jq -r '
    [ .[] | select(.status=="proposed") ]
    | to_entries
    | .[:5]
    | .[]
    | "[\(.key)] \(.value.title) | lane=\(.value.lane // "A") | scope=\(.value.suggested_scope // "-")"
  ' "$IDEAS" 2>/dev/null || echo "No proposed ideas."
else
  echo "No ideas.json found."
fi

echo
echo "Quick actions:"
echo "  ./bw approve <idx...>"
echo "  ./bw deny <idx...>"
echo "  ./bw defer <idx...>"
