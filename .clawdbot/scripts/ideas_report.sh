#!/usr/bin/env bash
# Report on the ideas queue and whether the scout is generating ideas.
# Usage: ideas_report.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-.}")" && pwd)"
source "$SCRIPT_DIR/helpers.sh"
ensure_ideas_file

echo "=== Ideas queue ==="
total=$(jq 'length' "$IDEAS_FILE")
echo "Total ideas: $total"

if [[ "$total" -eq 0 ]]; then
  echo "No ideas yet. Run scout: ./.clawdbot/scripts/scout.sh --run (or --ingest <path>)" >&2
  exit 0
fi

echo ""
echo "By status:"
jq -r 'group_by(.status) | .[] | "  \(.[0].status): \(length)"' "$IDEAS_FILE" 2>/dev/null || jq -r '[.[].status] | group_by(.) | .[] | "  \(.[0]): \(length)"' "$IDEAS_FILE"

echo ""
echo "Last 10 (updated_at | status | title):"
jq -r 'sort_by(.updated_at) | reverse | .[0:10] | .[] | "  \(.updated_at) \(.status) \(.title)"' "$IDEAS_FILE"

if [[ -f "$CLAWDBOT_DIR/scout-last-run" ]]; then
  last_run=$(cat "$CLAWDBOT_DIR/scout-last-run" 2>/dev/null || echo "?")
  echo ""
  echo "Last scout run: $last_run"
else
  echo ""
  echo "Last scout run: never (run scout.sh --run to generate ideas)"
fi
