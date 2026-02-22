#!/bin/bash

set -euo pipefail

IMAGE_TAG="${IMAGE_TAG:-}"
GHCR_NAMESPACE="${GHCR_NAMESPACE:-sanjayanasuri}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

if [ -z "$IMAGE_TAG" ]; then
  echo "ERROR: IMAGE_TAG is required (example: IMAGE_TAG=<git-sha> ./scripts/deploy-ghcr.sh)"
  exit 1
fi

cd "$PROJECT_DIR"

if [ ! -f .env ]; then
  echo "ERROR: .env file not found in $PROJECT_DIR"
  exit 1
fi

if [ -n "${GHCR_PULL_TOKEN:-}" ] && [ -n "${GHCR_PULL_USERNAME:-}" ]; then
  echo "Logging into GHCR as ${GHCR_PULL_USERNAME}..."
  echo "$GHCR_PULL_TOKEN" | docker login ghcr.io -u "$GHCR_PULL_USERNAME" --password-stdin >/dev/null
fi

echo "Deploying GHCR images with IMAGE_TAG=$IMAGE_TAG (namespace=$GHCR_NAMESPACE)"

compose_cmd=(docker compose -f docker-compose.yml -f docker-compose.ghcr.yml)

echo "Pulling runtime images..."
GHCR_NAMESPACE="$GHCR_NAMESPACE" IMAGE_TAG="$IMAGE_TAG" "${compose_cmd[@]}" pull backend frontend

echo "Updating application containers..."
GHCR_NAMESPACE="$GHCR_NAMESPACE" IMAGE_TAG="$IMAGE_TAG" "${compose_cmd[@]}" up -d --remove-orphans backend frontend

echo "Service status:"
GHCR_NAMESPACE="$GHCR_NAMESPACE" IMAGE_TAG="$IMAGE_TAG" "${compose_cmd[@]}" ps

retry_http_ok() {
  local name="$1"
  local attempts="$2"
  shift 2

  for i in $(seq 1 "$attempts"); do
    if "$@" >/dev/null 2>&1; then
      echo "✓ $name reachable"
      return 0
    fi
    sleep 2
  done

  echo "WARNING: $name did not become healthy in time"
  return 1
}

echo "Checking frontend..."
retry_http_ok "Frontend" 20 curl -fsSL http://localhost:3000

echo "Checking backend..."
if retry_http_ok "Backend" 30 curl -fsSL http://localhost:8000/health || retry_http_ok "Backend" 30 curl -fsSL http://localhost:8000/api/health; then
  :
else
  echo "WARNING: Backend health endpoint did not return success yet"
  exit 1
fi

echo "GHCR deploy complete."
