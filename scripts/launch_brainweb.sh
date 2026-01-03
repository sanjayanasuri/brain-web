#!/usr/bin/env bash
# Brain Web Launcher - Comprehensive startup script
# This script starts all required services and monitors their health

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Get the script directory and project root
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# PID file location
PID_DIR="$HOME/.brainweb"
mkdir -p "$PID_DIR"

# Log file
LOG_FILE="$PID_DIR/launcher.log"
exec > >(tee -a "$LOG_FILE") 2>&1

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "🚀 Brain Web Launcher"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# Function to check if a port is in use
check_port() {
    local port=$1
    lsof -ti:$port > /dev/null 2>&1
}

# Function to check if a port is listening
check_port_listening() {
    local port=$1
    # Try nc first, fallback to lsof
    if command -v nc &> /dev/null; then
        nc -z localhost "$port" 2>/dev/null
    else
        lsof -ti:$port > /dev/null 2>&1
    fi
}

# Function to wait for a service to be ready
wait_for_service() {
    local url=$1
    local name=$2
    local max_attempts=30
    local attempt=0
    
    echo -n "   Waiting for $name to be ready"
    while [ $attempt -lt $max_attempts ]; do
        if curl -s "$url" > /dev/null 2>&1; then
            echo " ✅"
            return 0
        fi
        echo -n "."
        sleep 1
        attempt=$((attempt + 1))
    done
    echo " ❌ (timeout)"
    return 1
}

# Function to check if Neo4j Desktop is running
check_neo4j_desktop() {
    echo -e "${BLUE}🔍 Checking Neo4j Desktop...${NC}"
    
    # Check if Neo4j is accessible on the expected port
    if check_port_listening 7687; then
        echo -e "${GREEN}   ✅ Neo4j is running on port 7687${NC}"
        return 0
    else
        echo -e "${YELLOW}   ⚠️  Neo4j is not running on port 7687${NC}"
        echo ""
        echo "Please start Neo4j Desktop:"
        echo "  1. Open Neo4j Desktop application"
        echo "  2. Start your database (click the play button)"
        echo "  3. Make sure it's running on bolt://localhost:7687"
        echo ""
        read -p "Press Enter after starting Neo4j Desktop, or Ctrl+C to cancel..."
        
        # Wait a bit and check again
        sleep 3
        if check_port_listening 7687; then
            echo -e "${GREEN}   ✅ Neo4j is now running${NC}"
            return 0
        else
            echo -e "${RED}   ❌ Neo4j still not accessible${NC}"
            echo "   Please check Neo4j Desktop and try again"
            exit 1
        fi
    fi
}

# Function to verify Neo4j connection
verify_neo4j() {
    echo ""
    echo -e "${BLUE}🔍 Verifying Neo4j connection...${NC}"
    
    # Check if port is open
    if ! check_port_listening 7687; then
        echo -e "${RED}   ❌ Cannot connect to Neo4j on port 7687${NC}"
        echo "   Please make sure Neo4j Desktop is running and your database is started"
        return 1
    fi
    
    echo -e "${GREEN}   ✅ Neo4j port is accessible${NC}"
    echo "   Make sure NEO4J_PASSWORD is set correctly in .env.local"
    
    return 0
}

# Function to setup Python environment
setup_backend() {
    echo ""
    echo -e "${BLUE}🔧 Setting up backend...${NC}"
    
    cd "$PROJECT_ROOT/backend"
    
    # Create virtual environment if it doesn't exist
    if [ ! -d ".venv" ]; then
        echo "   Creating Python virtual environment..."
        python3 -m venv .venv
    fi
    
    # Activate virtual environment
    source .venv/bin/activate
    
    # Install dependencies if needed
    if [ ! -f ".venv/.deps_installed" ] || [ "requirements.txt" -nt ".venv/.deps_installed" ]; then
        echo "   Installing Python dependencies..."
        pip install --quiet --upgrade pip
        pip install --quiet -r requirements.txt
        touch .venv/.deps_installed
    fi
    
    echo -e "${GREEN}   ✅ Backend environment ready${NC}"
}

# Function to start backend
start_backend() {
    echo ""
    echo -e "${BLUE}🚀 Starting backend server...${NC}"
    
    cd "$PROJECT_ROOT/backend"
    
    # Check if backend is already running
    if check_port 8000; then
        echo "   Backend is already running on port 8000"
        return 0
    fi
    
    # Activate virtual environment
    source .venv/bin/activate
    
    # Start backend in background
    nohup uvicorn main:app --host 127.0.0.1 --port 8000 > "$PID_DIR/backend.log" 2>&1 &
    echo $! > "$PID_DIR/backend.pid"
    
    echo "   Backend starting (PID: $(cat "$PID_DIR/backend.pid"))"
    
    # Wait for backend to be ready
    if wait_for_service "http://127.0.0.1:8000/" "Backend"; then
        echo -e "${GREEN}   ✅ Backend is ready${NC}"
        return 0
    else
        echo -e "${RED}   ❌ Backend failed to start${NC}"
        echo "   Check logs: $PID_DIR/backend.log"
        return 1
    fi
}

# Function to setup frontend
setup_frontend() {
    echo ""
    echo -e "${BLUE}🎨 Setting up frontend...${NC}"
    
    cd "$PROJECT_ROOT/frontend"
    
    # Find npm
    NPM_CMD=$(find_npm)
    if [ -z "$NPM_CMD" ]; then
        echo -e "${RED}   ❌ npm not found${NC}"
        echo "   Please install Node.js from https://nodejs.org/"
        return 1
    fi
    
    # Check if node_modules exists
    if [ ! -d "node_modules" ]; then
        echo "   Installing Node.js dependencies..."
        "$NPM_CMD" install --silent
    fi
    
    echo -e "${GREEN}   ✅ Frontend environment ready${NC}"
}

# Function to find npm in PATH
find_npm() {
    # Try common locations
    if command -v npm &> /dev/null; then
        echo "npm"
        return 0
    fi
    
    # Try common Node.js installation paths
    for path in \
        "/usr/local/bin/npm" \
        "/opt/homebrew/bin/npm" \
        "$HOME/.nvm/versions/node/*/bin/npm" \
        "/usr/bin/npm"
    do
        if [ -f "$path" ]; then
            echo "$path"
            return 0
        fi
    done
    
    # Last resort: try to find via node
    if command -v node &> /dev/null; then
        NODE_PATH=$(which node)
        NPM_PATH=$(dirname "$NODE_PATH")/npm
        if [ -f "$NPM_PATH" ]; then
            echo "$NPM_PATH"
            return 0
        fi
    fi
    
    echo ""
    return 1
}

# Function to start frontend
start_frontend() {
    echo ""
    echo -e "${BLUE}🚀 Starting frontend server...${NC}"
    
    cd "$PROJECT_ROOT/frontend"
    
    # Check if frontend is already running
    if check_port 3000; then
        echo "   Frontend is already running on port 3000"
        return 0
    fi
    
    # Find npm
    NPM_CMD=$(find_npm)
    if [ -z "$NPM_CMD" ]; then
        echo -e "${RED}   ❌ npm not found in PATH${NC}"
        echo "   Please make sure Node.js is installed and in your PATH"
        echo "   You can add it by running: export PATH=\"/usr/local/bin:\$PATH\""
        return 1
    fi
    
    # Ensure we have the full environment
    export PATH="/usr/local/bin:/opt/homebrew/bin:$HOME/.nvm/versions/node/*/bin:$PATH"
    
    # Start frontend in background
    nohup "$NPM_CMD" run dev > "$PID_DIR/frontend.log" 2>&1 &
    echo $! > "$PID_DIR/frontend.pid"
    
    echo "   Frontend starting (PID: $(cat "$PID_DIR/frontend.pid"))"
    echo "   Using npm: $NPM_CMD"
    
    # Wait for frontend to be ready
    if wait_for_service "http://localhost:3000" "Frontend"; then
        echo -e "${GREEN}   ✅ Frontend is ready${NC}"
        return 0
    else
        echo -e "${YELLOW}   ⚠️  Frontend may still be starting (this can take 30-60 seconds)${NC}"
        echo "   Check logs: tail -f $PID_DIR/frontend.log"
        return 0
    fi
}

# Function to open browser with splash screen
open_browser() {
    echo ""
    echo -e "${BLUE}🌐 Opening browser...${NC}"
    
    # Open splash screen first
    SPLASH_FILE="$PROJECT_ROOT/frontend/public/splash.html"
    if [ -f "$SPLASH_FILE" ]; then
        echo "   Opening startup screen..."
        open "file://$SPLASH_FILE" 2>/dev/null || true
    fi
    
    # Wait for frontend to be ready, then redirect
    local max_wait=60
    local waited=0
    
    while [ $waited -lt $max_wait ]; do
        if curl -s "http://localhost:3000" > /dev/null 2>&1; then
            echo "   Frontend is ready!"
            echo -e "${GREEN}   ✅ Browser will redirect to Brain Web${NC}"
            # The splash screen will auto-redirect
            return 0
        fi
        sleep 2
        waited=$((waited + 2))
        echo -n "."
    done
    
    echo ""
    echo -e "${YELLOW}   ⚠️  Frontend taking longer than expected${NC}"
    echo "   Opening browser anyway..."
    open "http://localhost:3000" 2>/dev/null || true
}

# Function to show status
show_status() {
    echo ""
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo -e "${GREEN}✅ Brain Web is running!${NC}"
    echo ""
    echo "📍 Services:"
    echo "   • Neo4j Browser:  http://localhost:7474"
    echo "   • Backend API:    http://localhost:8000"
    echo "   • Frontend App:   http://localhost:3000"
    echo ""
    echo "📝 Logs:"
    echo "   • Launcher:       $LOG_FILE"
    echo "   • Backend:        $PID_DIR/backend.log"
    echo "   • Frontend:       $PID_DIR/frontend.log"
    echo ""
    echo "🛑 To stop all services:"
    echo "   Run: $SCRIPT_DIR/stop_brainweb.sh"
    echo "   Or:  kill \$(cat $PID_DIR/*.pid)"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo ""
}

# Main execution
main() {
    # Setup PATH for macOS app bundles (they don't inherit full shell environment)
    export PATH="/usr/local/bin:/opt/homebrew/bin:$HOME/.nvm/versions/node/*/bin:/usr/bin:/bin:$PATH"
    
    # Load shell profile to get Node.js paths (if using nvm, homebrew, etc.)
    if [ -f "$HOME/.zshrc" ]; then
        source "$HOME/.zshrc" 2>/dev/null || true
    elif [ -f "$HOME/.bash_profile" ]; then
        source "$HOME/.bash_profile" 2>/dev/null || true
    elif [ -f "$HOME/.bashrc" ]; then
        source "$HOME/.bashrc" 2>/dev/null || true
    fi
    
    # Load environment variables
    if [ -f "$PROJECT_ROOT/.env.local" ]; then
        set -a
        source "$PROJECT_ROOT/.env.local"
        set +a
    fi
    
    # Check Neo4j Desktop
    check_neo4j_desktop
    
    # Verify Neo4j connection
    verify_neo4j
    setup_backend
    start_backend
    setup_frontend
    start_frontend
    
    # Open browser
    open_browser
    
    # Show status
    show_status
    
    # Keep script running (for app bundle)
    echo "Press Ctrl+C to stop all services..."
    trap 'echo ""; echo "Stopping services..."; "$SCRIPT_DIR/stop_brainweb.sh"; exit 0' INT TERM
    
    # Monitor services
    while true; do
        sleep 10
        # Check if services are still running
        if [ -f "$PID_DIR/backend.pid" ] && ! kill -0 "$(cat "$PID_DIR/backend.pid")" 2>/dev/null; then
            echo -e "${RED}⚠️  Backend process died, restarting...${NC}"
            start_backend
        fi
        if [ -f "$PID_DIR/frontend.pid" ] && ! kill -0 "$(cat "$PID_DIR/frontend.pid")" 2>/dev/null; then
            echo -e "${RED}⚠️  Frontend process died, restarting...${NC}"
            start_frontend
        fi
    done
}

# Run main function
main

