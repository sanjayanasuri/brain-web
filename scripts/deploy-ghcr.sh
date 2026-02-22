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

echo "Checking frontend..."
curl -fsSL http://localhost:3000 >/dev/null
echo "✓ Frontend reachable"

echo "Checking backend..."
if curl -fsSL http://localhost:8000/health >/dev/null 2>&1 || curl -fsSL http://localhost:8000/api/health >/dev/null 2>&1; then
  echo "✓ Backend healthy"
else
  echo "WARNING: Backend health endpoint did not return success yet"
  exit 1
fi

echo "GHCR deploy complete."
