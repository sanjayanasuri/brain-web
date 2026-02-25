#!/usr/bin/env bash
# One-command orchestrator tick:
# 1) optional scout
# 2) dispatch approved ideas
# 3) run checker/notifications
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-.}")" && pwd)"

if [[ "${CLAWDBOT_RUN_SCOUT:-false}" == "true" ]]; then
  "$SCRIPT_DIR/scout.sh" --run || true
fi

"$SCRIPT_DIR/dispatch.sh" || true
"$SCRIPT_DIR/check.sh"

echo "swarm_tick_complete"
