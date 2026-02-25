#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
IDEAS="$ROOT/.clawdbot/ideas.json"
ACTION="${1:-}"
shift || true

if [[ ! -f "$IDEAS" ]]; then
  echo "ideas.json not found"
  exit 1
fi

if [[ -z "$ACTION" || $# -eq 0 ]]; then
  echo "Usage: $0 approve|deny|defer <idx...>"
  exit 1
fi

case "$ACTION" in
  approve) NEW_STATUS="approved" ;;
  deny) NEW_STATUS="denied" ;;
  defer) NEW_STATUS="deferred" ;;
  *) echo "Unknown action: $ACTION"; exit 1 ;;
esac

TMP=$(mktemp)
cp "$IDEAS" "$TMP"

for idx in "$@"; do
  jq --argjson i "$idx" --arg s "$NEW_STATUS" '
    if (.[$i] != null) then
      .[$i].status = $s |
      .[$i].updated_at = (now|strftime("%Y-%m-%dT%H:%M:%SZ"))
    else . end
  ' "$TMP" > "$TMP.next" && mv "$TMP.next" "$TMP"
done

mv "$TMP" "$IDEAS"
echo "Updated ideas -> $NEW_STATUS for indexes: $*"

if [[ "$NEW_STATUS" == "approved" ]]; then
  "$ROOT/.clawdbot/scripts/dispatch.sh" || true
fi
