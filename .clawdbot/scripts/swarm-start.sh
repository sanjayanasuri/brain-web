#!/usr/bin/env bash
# One-command orchestrator tick:
# 1) optional scout
# 2) dispatch approved ideas
# 3) run checker/notifications
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-.}")" && pwd)"
CLAWDBOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

# Optional local runtime env
if [[ -f "$CLAWDBOT_DIR/.env" ]]; then
  set -a
  source "$CLAWDBOT_DIR/.env"
  set +a
fi

if [[ "${CLAWDBOT_RUN_SCOUT:-false}" == "true" ]]; then
  "$SCRIPT_DIR/scout.sh" --run || true
fi

# Optional feed claim before dispatch
if [[ "${CLAWDBOT_CLAIM_FEED:-true}" == "true" ]]; then
  "$SCRIPT_DIR/agent-feed-claim.sh" --label "${CLAWDBOT_FEED_LABEL:-agent-fix}" || true
fi

"$SCRIPT_DIR/dispatch.sh" || true
"$SCRIPT_DIR/check.sh"

echo "swarm_tick_complete"
