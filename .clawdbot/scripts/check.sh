#!/usr/bin/env bash
# Deterministic monitor for running tasks.
# - checks tmux session
# - checks PR + CI via gh
# - optional auto-respawn on dead tmux (max retries)
# - optional approval/screenshot gates
# - emits notification when merge-ready
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-.}")" && pwd)"
source "$SCRIPT_DIR/helpers.sh"
# Optional local runtime env (not committed): .clawdbot/.env
if [[ -f "$CLAWDBOT_DIR/.env" ]]; then
  set -a
  source "$CLAWDBOT_DIR/.env"
  set +a
fi
ensure_tasks_file
require_cmd jq

NOTIFY_SCRIPT="$SCRIPT_DIR/notify.sh"
UPDATED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
MAX_RETRIES_DEFAULT="${CLAWDBOT_MAX_RETRIES:-3}"
MIN_APPROVALS="${CLAWDBOT_MIN_APPROVALS:-1}"
REQUIRE_UI_SCREENSHOT="${CLAWDBOT_REQUIRE_UI_SCREENSHOT:-true}"

running_tasks=$(jq -c '[.[] | select(.status == "running")]' "$TASKS_FILE")
count=$(echo "$running_tasks" | jq 'length')
[[ "$count" -eq 0 ]] && exit 0

for i in $(seq 0 $((count - 1))); do
  task=$(echo "$running_tasks" | jq -c ".[$i]")
  task_id=$(echo "$task" | jq -r '.task_id')
  branch_name=$(echo "$task" | jq -r '.branch_name')
  tmux_session=$(echo "$task" | jq -r '.tmux_session')
  worktree=$(echo "$task" | jq -r '.worktree // ""')
  agent_cmd=$(echo "$task" | jq -r '.agent_cmd // empty')
  retries=$(echo "$task" | jq -r '.retries // 0')
  max_retries=$(echo "$task" | jq -r ".max_retries // $MAX_RETRIES_DEFAULT")

  tmux_alive=true
  if ! tmux has-session -t "$tmux_session" 2>/dev/null; then
    tmux_alive=false
  fi

  pr_number=""
  pr_url=""
  mergeable=false
  ci_passed=false
  approval_count=0
  approvals_ok=false
  ui_changed=false
  screenshot_present=true

  if command -v gh >/dev/null 2>&1; then
    pr_line=$(gh pr list --head "$branch_name" --json number,url --jq 'if length > 0 then "\(.[0].number) \(.[0].url)" else "" end' 2>/dev/null || true)
    if [[ -n "$pr_line" ]]; then
      pr_number="${pr_line%% *}"
      pr_url="${pr_line#* }"

      merge_state=$(gh pr view "$pr_number" --json mergeStateStatus --jq '.mergeStateStatus' 2>/dev/null || echo "")
      [[ "$merge_state" == "CLEAN" ]] && mergeable=true

      if gh pr checks "$pr_number" >/dev/null 2>&1; then
        ci_passed=true
      fi

      if [[ "$pr_number" =~ ^[0-9]+$ ]]; then
        approval_count=$(gh api graphql -f query='query($owner:String!, $repo:String!, $number:Int!){ repository(owner:$owner, name:$repo){ pullRequest(number:$number){ reviews(states: APPROVED, first:100){ totalCount } } } }' \
          -F owner="$(gh repo view --json owner --jq '.owner.login')" \
          -F repo="$(gh repo view --json name --jq '.name')" \
          -F number="$pr_number" \
          --jq '.data.repository.pullRequest.reviews.totalCount' 2>/dev/null || echo 0)
      else
        approval_count=0
      fi
      [[ "$approval_count" -ge "$MIN_APPROVALS" ]] && approvals_ok=true

      pr_body=$(gh pr view "$pr_number" --json body --jq '.body // ""' 2>/dev/null || echo "")
      changed_files=$(gh pr view "$pr_number" --json files --jq '.files[].path' 2>/dev/null || true)
      if echo "$changed_files" | grep -E '^(frontend/|browser-extension/|.*\.(tsx|jsx|css|scss)$)' >/dev/null 2>&1; then
        ui_changed=true
      fi
      if [[ "$ui_changed" == "true" ]]; then
        if [[ "$REQUIRE_UI_SCREENSHOT" == "true" ]]; then
          if ! echo "$pr_body" | grep -E '(!\[.*\]\(|<img|screenshot)' -i >/dev/null 2>&1; then
            screenshot_present=false
          fi
        fi
      fi
    fi
  fi

  # Auto-respawn only if tmux died and no PR exists yet.
  if [[ "$tmux_alive" == "false" && -z "$pr_number" ]]; then
    if [[ "$retries" -lt "$max_retries" && -n "$agent_cmd" && -n "$worktree" && -d "$worktree" ]]; then
      retry_prompt="$CLAWDBOT_DIR/prompts/retry.md"
      rendered="$(mktemp)"
      trap 'rm -f "$rendered"' EXIT
      desc=$(echo "$task" | jq -r '.description // ""')
      sed -e "s|{{TASK_ID}}|$task_id|g" \
          -e "s|{{BRANCH_NAME}}|$branch_name|g" \
          -e "s|{{PREVIOUS_OUTCOME}}|tmux session exited before PR creation|g" \
          -e "s|{{TASK_DESCRIPTION}}|$desc|g" "$retry_prompt" > "$rendered"
      tmux new-session -d -s "$tmux_session" -c "$worktree" "cat '$rendered' | $agent_cmd; exec bash"
      retries=$((retries + 1))
      update_task "$task_id" "{\"retries\": $retries, \"updated_at\": \"$UPDATED_AT\"}"
      continue
    else
      update_task "$task_id" "{\"status\": \"failed\", \"updated_at\": \"$UPDATED_AT\"}"
      continue
    fi
  fi

  checks_json=$(jq -n \
    --argjson prCreated "$( [[ -n "$pr_number" ]] && echo true || echo false )" \
    --argjson ciPassed "$( [[ "$ci_passed" == "true" ]] && echo true || echo false )" \
    --argjson mergeable "$( [[ "$mergeable" == "true" ]] && echo true || echo false )" \
    --argjson approvalsOk "$( [[ "$approvals_ok" == "true" ]] && echo true || echo false )" \
    --argjson approvalsCount "$approval_count" \
    --argjson uiChanged "$( [[ "$ui_changed" == "true" ]] && echo true || echo false )" \
    --argjson screenshotPresent "$( [[ "$screenshot_present" == "true" ]] && echo true || echo false )" \
    '{prCreated: $prCreated, ciPassed: $ciPassed, mergeable: $mergeable, approvalsOk: $approvalsOk, approvalsCount: $approvalsCount, uiChanged: $uiChanged, screenshotPresent: $screenshotPresent}')

  update_payload=$(jq -n \
    --arg updated "$UPDATED_AT" \
    --arg pr_number "$pr_number" \
    --arg pr_url "$pr_url" \
    --argjson checks "$checks_json" \
    '{updated_at:$updated, checks:$checks} +
     (if $pr_number != "" then {pr_number: ($pr_number|tonumber), pr_url:$pr_url} else {} end)')

  update_task "$task_id" "$update_payload"

  # Merge-ready gate
  if [[ -n "$pr_number" && "$ci_passed" == "true" && "$mergeable" == "true" && "$approvals_ok" == "true" && "$screenshot_present" == "true" ]]; then
    update_task "$task_id" "{\"status\": \"ready\", \"updated_at\": \"$UPDATED_AT\", \"completedAt\": $(date +%s)000}"
    notified=$(echo "$task" | jq -r '.notified // false')
    if [[ "$notified" != "true" ]]; then
      "$NOTIFY_SCRIPT" "$task_id" "$pr_number" "$pr_url"
      update_task "$task_id" "{\"notified\": true}"
    fi
  fi
done
