#!/usr/bin/env bash
# Shared paths and helpers for clawdbot scripts. Source from spawn.sh / check.sh.
set -euo pipefail

# Require a command on PATH; exit with clear message if missing.
require_cmd() {
  local cmd="$1"
  local hint="${2:-}"
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "Error: '$cmd' is required but not installed or not on PATH." >&2
    [[ -n "$hint" ]] && echo "$hint" >&2
    exit 1
  fi
}

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-.}")" && pwd)"
CLAWDBOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
REPO_ROOT="$(cd "$CLAWDBOT_DIR/.." && pwd)"
WORKTREES_DIR="${REPO_ROOT}-worktrees"
TASKS_FILE="$CLAWDBOT_DIR/active-tasks.json"
IDEAS_FILE="$CLAWDBOT_DIR/ideas.json"

# Ensure active-tasks.json exists and is valid JSON array
ensure_tasks_file() {
  if [[ ! -f "$TASKS_FILE" ]]; then
    printf '%s\n' '[]' > "$TASKS_FILE"
  fi
  # Normalize multi-document JSON (if accidental concatenation happened) to the last array.
  if ! jq -e '.' "$TASKS_FILE" >/dev/null 2>&1; then
    echo "Error: $TASKS_FILE is not valid JSON" >&2
    exit 1
  fi
  local docs
  docs=$(jq -s 'length' "$TASKS_FILE" 2>/dev/null || echo 0)
  if [[ "$docs" -gt 1 ]]; then
    local tmp
    tmp="$(mktemp)"
    jq -s 'last' "$TASKS_FILE" > "$tmp" && mv "$tmp" "$TASKS_FILE"
  fi
}

# Get task by task_id from active-tasks.json
get_task() {
  local task_id="$1"
  jq -e --arg id "$task_id" '.[] | select(.task_id == $id)' "$TASKS_FILE" 2>/dev/null || true
}

# Update a task's fields (merge into existing object). Usage: update_task TASK_ID '{"status":"ready"}'
update_task() {
  local task_id="$1"
  local updates="$2"
  ensure_tasks_file
  local tmp
  tmp="$(mktemp)"
  jq --arg id "$task_id" --argjson up "$updates" \
    '(.[] | select(.task_id == $id) |= . + $up) as $new | . | map(if .task_id == $id then . + $up else . end)' \
    "$TASKS_FILE" > "$tmp" && mv "$tmp" "$TASKS_FILE"
}

# Append or replace task entry (by task_id). Pass JSON object for the task.
set_task() {
  local task_json="$1"
  ensure_tasks_file
  local tmp
  tmp="$(mktemp)"
  local task_id
  task_id="$(echo "$task_json" | jq -r '.task_id')"
  jq --argjson new "$task_json" --arg id "$task_id" \
    '([.[] | select(.task_id != $id)] + [$new]) | sort_by(.created_at // "") | reverse' \
    "$TASKS_FILE" > "$tmp" && mv "$tmp" "$TASKS_FILE"
}

# --- Ideas queue ---

ensure_ideas_file() {
  if [[ ! -f "$IDEAS_FILE" ]]; then
    printf '%s\n' '[]' > "$IDEAS_FILE"
  fi
  if ! jq -e '.' "$IDEAS_FILE" >/dev/null 2>&1; then
    echo "Error: $IDEAS_FILE is not valid JSON" >&2
    exit 1
  fi
}

# Ingest a JSON array of proposals into ideas.json. Each element should have title, lane, description, suggested_scope.
# Adds id, status=proposed, created_at, updated_at. Dedupes by title (skip if title already exists).
ingest_ideas() {
  local input_file="$1"
  ensure_ideas_file
  local tmp
  tmp="$(mktemp)"
  local now
  now="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  jq -n --arg now "$now" --slurpfile existing "$IDEAS_FILE" --slurpfile incoming "$input_file" '
    ($existing[0] | map(.title)) as $existing_titles |
    ($incoming[0] | if type == "array" then . else [.] end) |
    map(select(.title as $t | ($existing_titles | index($t)) | not)) |
    to_entries |
    map(.value + {
      id: ("idea-" + ($now | split("T")[0] | gsub("-";"")) + "-" + (.key | tostring)),
      status: "proposed",
      created_at: $now,
      updated_at: $now
    }) |
    $existing[0] + .
  ' > "$tmp" && mv "$tmp" "$IDEAS_FILE"
}

# Update an idea by id. Usage: update_idea IDEA_ID '{"status":"building","task_id":"..."}'
update_idea() {
  local idea_id="$1"
  local updates="$2"
  ensure_ideas_file
  local tmp
  tmp="$(mktemp)"
  jq --arg id "$idea_id" --argjson up "$updates" \
    'map(if .id == $id then . + $up else . end)' \
    "$IDEAS_FILE" > "$tmp" && mv "$tmp" "$IDEAS_FILE"
}
