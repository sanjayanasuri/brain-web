#!/bin/bash
# Start optimization services (Qdrant, PostgreSQL, Redis)
# This script works with both 'docker-compose' and 'docker compose'

set -e

echo "Starting optimization services..."

# Try docker compose (V2) first, then docker-compose (V1)
if command -v docker &> /dev/null; then
    if docker compose version &> /dev/null; then
        echo "Using 'docker compose' (V2)..."
        docker compose up -d qdrant postgres redis
    elif command -v docker-compose &> /dev/null; then
        echo "Using 'docker-compose' (V1)..."
        docker-compose up -d qdrant postgres redis
    else
        echo "ERROR: Neither 'docker compose' nor 'docker-compose' found."
        echo ""
        echo "Please install docker-compose:"
        echo "  Option 1: Install Docker Desktop (includes compose)"
        echo "  Option 2: brew install docker-compose"
        echo "  Option 3: pip install docker-compose"
        exit 1
    fi
else
    echo "ERROR: Docker is not installed."
    echo "Please install Docker Desktop from https://www.docker.com/products/docker-desktop"
    exit 1
fi

echo ""
echo "✓ Services started!"
echo ""
echo "Verify services are running:"
echo "  docker ps | grep -E 'qdrant|postgres|redis'"
echo ""
echo "Next step: Run migration script:"
echo "  cd backend && python scripts/migrate_to_qdrant.py"
