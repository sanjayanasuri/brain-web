#!/usr/bin/env bash
# Install/update cron job for clawdbot checker loop.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SCHEDULE="${1:-*/10 * * * *}"
CRON_CMD="cd $REPO_ROOT && ./.clawdbot/check-agents.sh >> /tmp/clawdbot-check.log 2>&1"

( crontab -l 2>/dev/null | grep -v 'clawdbot/check-agents.sh' ; echo "$SCHEDULE $CRON_CMD" ) | crontab -

echo "Installed cron: $SCHEDULE"
