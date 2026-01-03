#!/usr/bin/env bash
# Brain Web Stopper - Stops all running services

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

PID_DIR="$HOME/.brainweb"

echo "🛑 Stopping Brain Web services..."
echo ""

# Stop backend
if [ -f "$PID_DIR/backend.pid" ]; then
    PID=$(cat "$PID_DIR/backend.pid")
    if kill -0 "$PID" 2>/dev/null; then
        echo "   Stopping backend (PID: $PID)..."
        kill "$PID" 2>/dev/null || true
        sleep 1
        kill -9 "$PID" 2>/dev/null || true
        echo -e "${GREEN}   ✅ Backend stopped${NC}"
    else
        echo "   Backend process not running"
    fi
    rm -f "$PID_DIR/backend.pid"
fi

# Stop frontend
if [ -f "$PID_DIR/frontend.pid" ]; then
    PID=$(cat "$PID_DIR/frontend.pid")
    if kill -0 "$PID" 2>/dev/null; then
        echo "   Stopping frontend (PID: $PID)..."
        kill "$PID" 2>/dev/null || true
        sleep 1
        kill -9 "$PID" 2>/dev/null || true
        echo -e "${GREEN}   ✅ Frontend stopped${NC}"
    else
        echo "   Frontend process not running"
    fi
    rm -f "$PID_DIR/frontend.pid"
fi

# Note about Neo4j Desktop
echo ""
echo "   Note: Neo4j Desktop is managed separately"
echo "   To stop Neo4j, use Neo4j Desktop application"

echo ""
echo -e "${GREEN}✅ All services stopped${NC}"

