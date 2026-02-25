#!/usr/bin/env bash
set -euo pipefail

# Ensure Playwright can bind expected dev port (3000)
if lsof -ti tcp:3000 >/dev/null 2>&1; then
  echo "[pretest-explorer] Releasing port 3000..."
  lsof -ti tcp:3000 | xargs kill -9 || true
  sleep 1
fi

echo "[pretest-explorer] Port 3000 ready."