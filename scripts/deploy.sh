#!/bin/bash
#
# Brain Web Deployment Script for Hetzner
# Deploys the application using Docker Compose
#
# Usage: ./deploy.sh [environment]
# Example: ./deploy.sh production

set -e

ENVIRONMENT=${1:-production}
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

echo "=========================================="
echo "Brain Web Deployment"
echo "Environment: $ENVIRONMENT"
echo "=========================================="
echo ""

cd "$PROJECT_DIR"

# Check if .env exists
if [ ! -f .env ]; then
    echo "ERROR: .env file not found!"
    echo "Please create .env file from .env.example"
    echo "Run: cp .env.example .env"
    echo "Then edit .env with your configuration"
    exit 1
fi

# Validate required environment variables
echo "Step 1: Validating environment configuration..."
required_vars=(
    "NEO4J_PASSWORD"
    "POSTGRES_PASSWORD"
    "OPENAI_API_KEY"
)

missing_vars=()
for var in "${required_vars[@]}"; do
    if ! grep -q "^${var}=" .env || grep -q "^${var}=$" .env || grep -q "^${var}=.*change.*" .env; then
        missing_vars+=("$var")
    fi
done

if [ ${#missing_vars[@]} -gt 0 ]; then
    echo "ERROR: Missing or invalid required environment variables:"
    for var in "${missing_vars[@]}"; do
        echo "  - $var"
    done
    echo ""
    echo "Please update your .env file with proper values"
    exit 1
fi

echo "✓ Environment configuration validated"
echo ""

# Pull latest changes (if git repo)
if [ -d .git ]; then
    echo "Step 2: Pulling latest changes from git..."
    git pull
    echo "✓ Git pull complete"
    echo ""
else
    echo "Step 2: Skipping git pull (not a git repository)"
    echo ""
fi

# Stop existing services
echo "Step 3: Stopping existing services..."
docker compose down
echo "✓ Services stopped"
echo ""

# Pull latest images
echo "Step 4: Pulling latest Docker images..."
docker compose pull
echo "✓ Images pulled"
echo ""

# Build custom images
echo "Step 5: Building custom images..."
docker compose build --no-cache
echo "✓ Build complete"
echo ""

# Start services
echo "Step 6: Starting services..."
docker compose up -d
echo "✓ Services started"
echo ""

# Wait for services to be healthy
echo "Step 7: Waiting for services to be healthy..."
sleep 10

# Check service status
echo ""
echo "Service Status:"
docker compose ps
echo ""

# Test backend health
echo "Step 8: Testing backend health..."
max_attempts=30
attempt=0
while [ $attempt -lt $max_attempts ]; do
    if curl -f http://localhost:8000/health > /dev/null 2>&1; then
        echo "✓ Backend is healthy!"
        break
    fi
    attempt=$((attempt + 1))
    echo "Waiting for backend... (attempt $attempt/$max_attempts)"
    sleep 2
done

if [ $attempt -eq $max_attempts ]; then
    echo "WARNING: Backend health check timed out"
    echo "Check logs with: docker compose logs backend"
fi

echo ""
echo "=========================================="
echo "Deployment Complete!"
echo "=========================================="
echo ""
echo "Services running:"
docker compose ps --format "table {{.Name}}\t{{.Status}}\t{{.Ports}}"
echo ""
echo "Useful commands:"
echo "  View logs:     docker compose logs -f"
echo "  Restart:       docker compose restart"
echo "  Stop:          docker compose down"
echo "  Update:        ./scripts/deploy.sh"
echo ""
echo "Backend API: http://localhost:8000"
echo "Neo4j Browser: http://localhost:7474"
echo ""
