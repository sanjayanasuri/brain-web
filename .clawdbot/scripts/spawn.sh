#!/usr/bin/env bash
# Spawn a coding agent in an isolated worktree + tmux session.
# Usage: spawn.sh TASK_ID BRANCH_NAME TMUX_SESSION AGENT_CMD TASK_DESCRIPTION
set -euo pipefail

if [[ $# -lt 5 ]]; then
  echo "Usage: $0 TASK_ID BRANCH_NAME TMUX_SESSION AGENT_CMD TASK_DESCRIPTION" >&2
  exit 1
fi

TASK_ID="$1"
BRANCH_NAME="$2"
TMUX_SESSION="$3"
AGENT_CMD="$4"
TASK_DESCRIPTION="$5"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-.}")" && pwd)"
source "$SCRIPT_DIR/helpers.sh"
require_cmd git
require_cmd jq
require_cmd tmux "Install with: brew install tmux"
ensure_tasks_file

WORKTREE_PATH="$WORKTREES_DIR/$TASK_ID"
PROMPT_FILE="$CLAWDBOT_DIR/prompts/task.md"
CREATED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
STARTED_AT_MS="$(date +%s)000"
REPO_NAME="$(basename "$REPO_ROOT")"

(cd "$REPO_ROOT" && git fetch origin main 2>/dev/null || true)
if [[ -d "$WORKTREE_PATH" ]]; then
  echo "Worktree already exists at $WORKTREE_PATH; reusing." >&2
  (cd "$WORKTREE_PATH" && git fetch origin main 2>/dev/null || true)
  (cd "$WORKTREE_PATH" && git checkout "$BRANCH_NAME" 2>/dev/null || git checkout -b "$BRANCH_NAME" origin/main)
else
  (cd "$REPO_ROOT" && git worktree add -b "$BRANCH_NAME" "$WORKTREE_PATH" origin/main)
fi

if command -v pnpm >/dev/null 2>&1; then
  (cd "$WORKTREE_PATH" && pnpm install)
else
  (cd "$WORKTREE_PATH" && npm ci)
fi

RENDERED_PROMPT="$(mktemp)"
trap 'rm -f "$RENDERED_PROMPT"' EXIT
python3 - <<PY
from pathlib import Path
p = Path("$PROMPT_FILE")
out = Path("$RENDERED_PROMPT")
text = p.read_text()
text = text.replace("{{TASK_ID}}", """$TASK_ID""")
text = text.replace("{{BRANCH_NAME}}", """$BRANCH_NAME""")
text = text.replace("{{TASK_DESCRIPTION}}", """$TASK_DESCRIPTION""")
out.write_text(text)
PY

if tmux has-session -t "$TMUX_SESSION" 2>/dev/null; then
  echo "Tmux session $TMUX_SESSION already exists. Reusing." >&2
else
  tmux new-session -d -s "$TMUX_SESSION" -c "$WORKTREE_PATH" \
    "cat '$RENDERED_PROMPT' | $AGENT_CMD; exec bash"
fi

TASK_JSON=$(jq -n \
  --arg task_id "$TASK_ID" \
  --arg branch "$BRANCH_NAME" \
  --arg session "$TMUX_SESSION" \
  --arg created "$CREATED_AT" \
  --arg updated "$CREATED_AT" \
  --arg repo "$REPO_NAME" \
  --arg worktree "$WORKTREE_PATH" \
  --arg desc "$TASK_DESCRIPTION" \
  --arg agent_cmd "$AGENT_CMD" \
  --arg started_ms "$STARTED_AT_MS" \
  '{
    task_id: $task_id,
    id: $task_id,
    repo: $repo,
    worktree: $worktree,
    branch_name: $branch,
    branch: $branch,
    tmux_session: $session,
    tmuxSession: $session,
    agent_cmd: $agent_cmd,
    description: $desc,
    status: "running",
    startedAt: ($started_ms | tonumber),
    retries: 0,
    max_retries: 3,
    notifyOnComplete: true,
    checks: {
      prCreated: false,
      ciPassed: false,
      mergeable: false
    },
    created_at: $created,
    updated_at: $updated
  }')
set_task "$TASK_JSON"

echo "Spawned task $TASK_ID in $WORKTREE_PATH (tmux: $TMUX_SESSION)"
