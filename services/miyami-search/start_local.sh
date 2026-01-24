#!/bin/bash
# Start Miyami Search locally (without Docker)
# This runs SearXNG and FastAPI directly on your Mac

set -e

echo "🚀 Starting Miyami Search locally..."

# Check if we're in the right directory
if [ ! -f "search_api/main.py" ]; then
    echo "❌ Error: Please run this script from services/miyami-search/ directory"
    exit 1
fi

# Check if Python 3 is available
if ! command -v python3 &> /dev/null; then
    echo "❌ Error: Python 3 is not installed"
    exit 1
fi

# Create virtual environment if it doesn't exist
if [ ! -d ".venv" ]; then
    echo "📦 Creating Python virtual environment..."
    python3 -m venv .venv
fi

# Activate virtual environment
source .venv/bin/activate

# Install dependencies if needed
if [ ! -f ".venv/.deps_installed" ]; then
    echo "📦 Installing Python dependencies (this may take a few minutes)..."
    pip install --upgrade pip
    pip install -r search_api/requirements.txt
    
    # Clone SearXNG if not already present
    if [ ! -d "searxng" ]; then
        echo "📦 Cloning SearXNG..."
        git clone https://github.com/searxng/searxng.git
        cd searxng
        pip install -r requirements.txt
        cd ..
    fi
    
    touch .venv/.deps_installed
    echo "✅ Dependencies installed"
fi

# Set environment variables
export SEARXNG_SECRET="${SEARXNG_SECRET:-$(openssl rand -hex 32)}"
export SEARXNG_BIND_ADDRESS="${SEARXNG_BIND_ADDRESS:-127.0.0.1}"
export SEARXNG_PORT="${SEARXNG_PORT:-8888}"
export PORT="${PORT:-8081}"

# Start SearXNG in background
echo "🔍 Starting SearXNG on ${SEARXNG_BIND_ADDRESS}:${SEARXNG_PORT}..."
cd searxng
python3 -m searx.webapp > /tmp/searxng.log 2>&1 &
SEARXNG_PID=$!
cd ..

# Wait for SearXNG to be ready
echo "⏳ Waiting for SearXNG to start..."
SEARXNG_READY=false
for i in {1..30}; do
    if curl -s http://${SEARXNG_BIND_ADDRESS}:${SEARXNG_PORT} > /dev/null 2>&1; then
        echo "✅ SearXNG is ready!"
        SEARXNG_READY=true
        break
    fi
    echo "   Waiting... ($i/30)"
    sleep 2
done

if [ "$SEARXNG_READY" = false ]; then
    echo "⚠️  SearXNG may not be ready yet, but continuing..."
fi

# Start FastAPI
echo "🚀 Starting FastAPI on http://localhost:${PORT}..."
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "✅ Miyami Search is running!"
echo ""
echo "📍 Services:"
echo "   • SearXNG:      http://localhost:${SEARXNG_PORT}"
echo "   • FastAPI API:  http://localhost:${PORT}"
echo "   • Health Check: http://localhost:${PORT}/health"
echo ""
echo "📝 To stop: Press Ctrl+C"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# Trap Ctrl+C to kill SearXNG
trap "echo ''; echo '🛑 Stopping services...'; kill $SEARXNG_PID 2>/dev/null; exit" INT

# Start FastAPI (this will block)
cd search_api
uvicorn main:app --host 0.0.0.0 --port ${PORT} --reload
