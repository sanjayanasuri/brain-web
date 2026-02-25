#!/usr/bin/env bash
# Scout: run an agent to analyze the repo and propose ideas, then ingest into ideas.json.
# Usage:
#   scout.sh --ingest <path>     Ingest a JSON array from path into .clawdbot/ideas.json.
#   scout.sh --run               Run SCOUT_AGENT_CMD with scout prompt; then ingest output.
# For --run: set SCOUT_AGENT_CMD (e.g. 'cursor' or 'llm -m gpt-4o') and optionally
#   SCOUT_OUTPUT_PATH (default .clawdbot/scout-output.json). Cron can call this.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-.}")" && pwd)"
source "$SCRIPT_DIR/helpers.sh"
CLAWDBOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
REPO_ROOT="$(cd "$CLAWDBOT_DIR/.." && pwd)"
SCOUT_PROMPT="$CLAWDBOT_DIR/prompts/scout.md"
DEFAULT_SCOUT_OUTPUT="$CLAWDBOT_DIR/scout-output.json"

usage() {
  echo "Usage: $0 --ingest <path>   Ingest JSON array from path into ideas.json" >&2
  echo "       $0 --run            Run scout agent (SCOUT_AGENT_CMD), then ingest SCOUT_OUTPUT_PATH" >&2
  echo "Env:   SCOUT_AGENT_CMD     Command to run (e.g. 'cursor', 'llm -m gpt-4o'). Required for --run." >&2
  echo "       SCOUT_OUTPUT_PATH   Where agent writes JSON (default: $DEFAULT_SCOUT_OUTPUT)" >&2
  exit 1
}

ingest() {
  local path="$1"
  if [[ ! -f "$path" ]]; then
    echo "Error: file not found: $path" >&2
    exit 1
  fi
  require_cmd jq
  if ! jq -e 'type == "array"' "$path" >/dev/null 2>&1; then
    echo "Error: $path must be a JSON array of { title, lane, description, suggested_scope }" >&2
    exit 1
  fi
  ensure_ideas_file
  local before
  before=$(jq 'length' "$IDEAS_FILE")
  ingest_ideas "$path"
  local after
  after=$(jq 'length' "$IDEAS_FILE")
  echo "Ingested $((after - before)) new proposal(s) into $IDEAS_FILE"
}

run_scout() {
  local out_path="${SCOUT_OUTPUT_PATH:-$DEFAULT_SCOUT_OUTPUT}"
  if [[ -z "${SCOUT_AGENT_CMD:-}" ]]; then
    echo "Error: SCOUT_AGENT_CMD is not set. Set it to your agent command and re-run." >&2
    echo "Example (OpenAI): SCOUT_AGENT_CMD='python3 .clawdbot/scripts/run_scout_openai.py' OPENAI_API_KEY=sk-... $0 --run" >&2
    echo "Alternatively, run the agent yourself and then: $0 --ingest $out_path" >&2
    exit 1
  fi
  require_cmd jq
  ensure_ideas_file
  # Render prompt with output path (for CLIs that read prompt from stdin)
  local rendered
  rendered="$(mktemp)"
  trap 'rm -f "${rendered:-}"' EXIT
  sed -e "s|{{SCOUT_OUTPUT_PATH}}|$out_path|g" "$SCOUT_PROMPT" > "$rendered"
  # Export so script-based agents (e.g. run_scout_openai.py) can read them
  export SCOUT_OUTPUT_PATH="$out_path"
  export SCOUT_PROMPT_PATH="$SCOUT_PROMPT"
  echo "Running scout: $SCOUT_AGENT_CMD (output -> $out_path)" >&2
  (cd "$REPO_ROOT" && cat "$rendered" | $SCOUT_AGENT_CMD) || true
  if [[ -f "$out_path" ]]; then
    ingest "$out_path"
    date -u +%Y-%m-%dT%H:%M:%SZ > "$CLAWDBOT_DIR/scout-last-run" 2>/dev/null || true
  else
    echo "Warning: scout did not create $out_path; nothing to ingest." >&2
  fi
}

case "${1:-}" in
  --ingest)
    [[ -n "${2:-}" ]] || usage
    ingest "$2"
    ;;
  --run)
    run_scout
    ;;
  *)
    usage
    ;;
esac
