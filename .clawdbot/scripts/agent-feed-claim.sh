#!/usr/bin/env bash
# Claim next open agent-feed issue safely.
# Usage: agent-feed-claim.sh [--label agent-fix]
set -euo pipefail

label="agent-fix"
if [[ "${1:-}" == "--label" && -n "${2:-}" ]]; then
  label="$2"
fi

require_cmd() { command -v "$1" >/dev/null 2>&1 || { echo "Missing $1" >&2; exit 1; }; }
require_cmd gh
require_cmd jq

me="$(gh api user --jq .login)"
now="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
lease_expires="$(date -u -v+30M +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || python3 - <<'PY'
from datetime import datetime,timezone,timedelta
print((datetime.now(timezone.utc)+timedelta(minutes=30)).strftime('%Y-%m-%dT%H:%M:%SZ'))
PY
)"

issues=$(gh issue list --label "$label" --state open --limit 50 --json number,title,body,labels,url)
num=$(echo "$issues" | jq 'length')
[[ "$num" -eq 0 ]] && { echo "No open $label issues"; exit 0; }

for i in $(seq 0 $((num-1))); do
  issue=$(echo "$issues" | jq -c ".[$i]")
  issue_number=$(echo "$issue" | jq -r .number)
  labels=$(echo "$issue" | jq -r '.labels[].name' 2>/dev/null || true)
  if echo "$labels" | grep -q '^agent-claimed$'; then
    continue
  fi

  gh issue edit "$issue_number" --add-label agent-claimed >/dev/null
  gh issue comment "$issue_number" --body "agent_feed_claim: {\"claimed_by\":\"$me\",\"claimed_at\":\"$now\",\"lease_expires_at\":\"$lease_expires\"}" >/dev/null
  echo "Claimed issue #$issue_number"
  exit 0
done

echo "No unclaimed issues found"
