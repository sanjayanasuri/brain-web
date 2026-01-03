#!/usr/bin/env bash
# Brain Web Status Checker

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

PID_DIR="$HOME/.brainweb"

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "📊 Brain Web Status"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# Check Neo4j Desktop
echo -n "Neo4j: "
# Try nc first, fallback to lsof
if command -v nc &> /dev/null; then
    PORT_CHECK="nc -z localhost 7687 2>/dev/null"
else
    PORT_CHECK="lsof -ti:7687 > /dev/null 2>&1"
fi

if eval "$PORT_CHECK"; then
    echo -e "${GREEN}✅ Running${NC}"
    echo "   Port: 7687 (Bolt)"
    echo "   Browser: http://localhost:7474"
    echo "   Note: Managed by Neo4j Desktop"
else
    echo -e "${RED}❌ Not running${NC}"
    echo "   Please start Neo4j Desktop and your database"
fi

# Check Backend
echo -n "Backend: "
if [ -f "$PID_DIR/backend.pid" ]; then
    PID=$(cat "$PID_DIR/backend.pid")
    if kill -0 "$PID" 2>/dev/null; then
        if curl -s "http://127.0.0.1:8000/" > /dev/null 2>&1; then
            echo -e "${GREEN}✅ Running${NC}"
            echo "   PID: $PID"
            echo "   URL: http://localhost:8000"
        else
            echo -e "${YELLOW}⚠️  Process running but not responding${NC}"
        fi
    else
        echo -e "${RED}❌ Process dead${NC}"
    fi
else
    if curl -s "http://127.0.0.1:8000/" > /dev/null 2>&1; then
        echo -e "${GREEN}✅ Running (no PID file)${NC}"
    else
        echo -e "${RED}❌ Not running${NC}"
    fi
fi

# Check Frontend
echo -n "Frontend: "
if [ -f "$PID_DIR/frontend.pid" ]; then
    PID=$(cat "$PID_DIR/frontend.pid")
    if kill -0 "$PID" 2>/dev/null; then
        if curl -s "http://localhost:3000" > /dev/null 2>&1; then
            echo -e "${GREEN}✅ Running${NC}"
            echo "   PID: $PID"
            echo "   URL: http://localhost:3000"
        else
            echo -e "${YELLOW}⚠️  Process running but not responding${NC}"
        fi
    else
        echo -e "${RED}❌ Process dead${NC}"
    fi
else
    if curl -s "http://localhost:3000" > /dev/null 2>&1; then
        echo -e "${GREEN}✅ Running (no PID file)${NC}"
    else
        echo -e "${RED}❌ Not running${NC}"
    fi
fi

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

