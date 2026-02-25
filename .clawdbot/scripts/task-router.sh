#!/usr/bin/env bash
# Pick execution agent command for a task.
# Usage: task-router.sh "<title>" "<description>" "<scope>" "<lane>"
set -euo pipefail

title="${1:-}"
description="${2:-}"
scope="${3:-}"
lane="${4:-}"

text="$(printf '%s\n%s\n%s\n%s\n' "$title" "$description" "$scope" "$lane" | tr '[:upper:]' '[:lower:]')"

# Configurable commands
cursor_cmd="${CURSOR_AGENT_CMD:-cursor}"
codex_cmd="${CODEX_AGENT_CMD:-codex exec --full-auto}"
claude_cmd="${CLAUDE_AGENT_CMD:-claude -p}"

is_ui=false
if echo "$text" | grep -E '(frontend|ui|ux|component|page|layout|css|style|visual|demo|screenshot|browser-extension)' >/dev/null 2>&1; then
  is_ui=true
fi

has_codex=false
has_cursor=false
has_claude=false
command -v codex >/dev/null 2>&1 && has_codex=true
command -v cursor >/dev/null 2>&1 && has_cursor=true
command -v claude >/dev/null 2>&1 && has_claude=true

if [[ "$is_ui" == "true" ]]; then
  if [[ "$has_cursor" == "true" ]]; then
    echo "$cursor_cmd"
    exit 0
  fi
  if [[ "$has_claude" == "true" ]]; then
    echo "$claude_cmd"
    exit 0
  fi
fi

# Backend/correctness default lane
if [[ "$has_codex" == "true" ]]; then
  echo "$codex_cmd"
  exit 0
fi
if [[ "$has_claude" == "true" ]]; then
  echo "$claude_cmd"
  exit 0
fi
if [[ "$has_cursor" == "true" ]]; then
  echo "$cursor_cmd"
  exit 0
fi

echo "No supported agent CLI found (need one of: codex, claude, cursor)" >&2
exit 1
