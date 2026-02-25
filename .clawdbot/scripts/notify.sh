#!/usr/bin/env bash
# Notify merge-ready task.
# Priority:
# 1) Telegram bot (if TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID)
# 2) openclaw system event (if openclaw installed)
# 3) stdout fallback
set -euo pipefail

if [[ $# -lt 3 ]]; then
  echo "Usage: $0 TASK_ID PR_NUMBER PR_URL" >&2
  exit 1
fi

task_id="$1"
pr_number="$2"
pr_url="$3"
text="✅ PR ready: $task_id (#$pr_number) $pr_url"

if [[ -n "${TELEGRAM_BOT_TOKEN:-}" && -n "${TELEGRAM_CHAT_ID:-}" ]]; then
  curl -sS -X POST "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage" \
    -d chat_id="${TELEGRAM_CHAT_ID}" \
    --data-urlencode text="$text" >/dev/null || true
  exit 0
fi

if command -v openclaw >/dev/null 2>&1; then
  openclaw system event --text "$text" --mode now >/dev/null 2>&1 || true
  exit 0
fi

echo "READY: $task_id PR #$pr_number $pr_url"
