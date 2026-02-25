#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SCHEDULE="${1:-*/20 * * * *}"
CMD="cd $ROOT/backend && python3 jobs/memory_consolidation_job.py >> /tmp/brainweb-memory-consolidation.log 2>&1"
( (crontab -l 2>/dev/null | grep -v 'memory_consolidation_job.py') || true ; echo "$SCHEDULE $CMD" ) | crontab -
echo "Installed memory consolidation cron: $SCHEDULE"
