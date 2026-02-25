#!/usr/bin/env bash
# Install daily interest suggestion refresh cron.
# Usage: install-interest-cron.sh [schedule]
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SCHEDULE="${1:-15 9 * * *}"
CMD="cd $ROOT/backend && python3 jobs/refresh_interest_suggestions.py >> /tmp/brainweb-interest-refresh.log 2>&1"

( (crontab -l 2>/dev/null | grep -v 'refresh_interest_suggestions.py') || true ; echo "$SCHEDULE $CMD" ) | crontab -

echo "Installed interest refresh cron: $SCHEDULE"
