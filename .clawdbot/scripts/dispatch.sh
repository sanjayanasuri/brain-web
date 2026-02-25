#!/usr/bin/env bash
# Start implementing approved ideas: pick one from the queue and spawn a task.
# Only starts ideas with status=approved. Marks idea as building and sets task_id.
# Usage: dispatch.sh [--dry-run]
# Env: DISPATCH_AGENT_CMD (default: cursor), DISPATCH_MAX_CONCURRENT (default: 1)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-.}")" && pwd)"
source "$SCRIPT_DIR/helpers.sh"
# Optional local runtime env (not committed): .clawdbot/.env
if [[ -f "$CLAWDBOT_DIR/.env" ]]; then
  set -a
  source "$CLAWDBOT_DIR/.env"
  set +a
fi
SPAWN_SCRIPT="$SCRIPT_DIR/spawn.sh"
ROUTER_SCRIPT="$SCRIPT_DIR/task-router.sh"
require_cmd jq

DRY_RUN=false
[[ "${1:-}" == "--dry-run" ]] && DRY_RUN=true

ensure_ideas_file
ensure_tasks_file

# How many tasks can be "running" at once (from our queue)
max_concurrent="${DISPATCH_MAX_CONCURRENT:-1}"
agent_cmd="${DISPATCH_AGENT_CMD:-auto}"

# Count running tasks that we spawned from the ideas queue (have matching idea with status=building)
running_from_queue=$(jq -r '
  [.[] | select(.status == "building" and .task_id != null and .task_id != "")] |
  [.[].task_id] as $building_ids |
  $building_ids | length
' "$IDEAS_FILE" 2>/dev/null || echo "0")

# If we're at the limit, don't start another
if [[ "$running_from_queue" -ge "$max_concurrent" ]]; then
  echo "Already $running_from_queue building (max $max_concurrent). Nothing to dispatch." >&2
  exit 0
fi

# Pick oldest approved idea with no task_id yet
candidate=$(jq -c '
  [.[] | select(.status == "approved" and ((.task_id | . == null or . == "") or .task_id == ""))] |
  sort_by(.updated_at) |
  .[0]
' "$IDEAS_FILE" 2>/dev/null)

if [[ -z "$candidate" || "$candidate" == "null" ]]; then
  echo "No approved idea ready to build (approve ideas by setting status=approved in ideas.json)." >&2
  exit 0
fi

idea_id=$(echo "$candidate" | jq -r '.id')
title=$(echo "$candidate" | jq -r '.title')
description=$(echo "$candidate" | jq -r '.description // ""')
suggested_scope=$(echo "$candidate" | jq -r '.suggested_scope // ""')
lane=$(echo "$candidate" | jq -r '.lane // ""')

# Sanitize idea_id for branch/session: only alnum and -
task_id="${idea_id}"
branch_name="feat/${idea_id}"
tmux_session="claw-${idea_id}"
# tmux session names: replace any non-alnum with -
tmux_session=$(echo "$tmux_session" | sed 's/[^a-zA-Z0-9-]/-/g' | sed 's/--*/-/g' | sed 's/^-//;s/-$//')

task_description="${title}
${description}
Scope: ${suggested_scope}"

if [[ "$agent_cmd" == "auto" ]]; then
  agent_cmd="$($ROUTER_SCRIPT "$title" "$description" "$suggested_scope" "$lane")"
fi

if [[ "$DRY_RUN" == "true" ]]; then
  echo "Would dispatch: $idea_id -> task $task_id, branch $branch_name, tmux $tmux_session" >&2
  echo "Agent: $agent_cmd" >&2
  echo "Title: $title" >&2
  exit 0
fi

"$SPAWN_SCRIPT" "$task_id" "$branch_name" "$tmux_session" "$agent_cmd" "$task_description"

now="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
update_idea "$idea_id" "{\"status\": \"building\", \"task_id\": \"$task_id\", \"updated_at\": \"$now\"}"
echo "Dispatched idea $idea_id as task $task_id (tmux: $tmux_session)"
