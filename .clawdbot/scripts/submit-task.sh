#!/usr/bin/env bash
# Submit a task idea quickly, auto-approve, and dispatch.
# Usage:
#   submit-task.sh --title "..." --scope "frontend/..." [--desc "..."] [--lane A] [--agent codex|cursor|auto]
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-.}")" && pwd)"
source "$SCRIPT_DIR/helpers.sh"
require_cmd jq

TITLE=""
DESC=""
SCOPE=""
LANE="A"
AGENT="auto"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --title) TITLE="${2:-}"; shift 2 ;;
    --desc|--description) DESC="${2:-}"; shift 2 ;;
    --scope) SCOPE="${2:-}"; shift 2 ;;
    --lane) LANE="${2:-A}"; shift 2 ;;
    --agent) AGENT="${2:-auto}"; shift 2 ;;
    *) echo "Unknown arg: $1" >&2; exit 1 ;;
  esac
done

if [[ -z "$TITLE" ]]; then
  echo "Usage: $0 --title \"...\" --scope \"...\" [--desc \"...\"] [--lane A] [--agent codex|cursor|auto]" >&2
  exit 1
fi

ensure_ideas_file

now="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
stamp="$(date -u +%Y%m%d-%H%M%S)"
idea_id="idea-${stamp}"

new_idea=$(jq -n \
  --arg id "$idea_id" \
  --arg title "$TITLE" \
  --arg lane "$LANE" \
  --arg desc "$DESC" \
  --arg scope "$SCOPE" \
  --arg agent "$AGENT" \
  --arg now "$now" \
  '{id:$id,title:$title,lane:$lane,description:$desc,suggested_scope:$scope,preferred_agent:$agent,status:"approved",created_at:$now,updated_at:$now}')

tmp="$(mktemp)"
jq --argjson item "$new_idea" '. + [$item]' "$IDEAS_FILE" > "$tmp" && mv "$tmp" "$IDEAS_FILE"

echo "Submitted and approved: $idea_id"
"$SCRIPT_DIR/dispatch.sh"
