#!/usr/bin/env bash
set -e

echo "🚀 Starting Brain Web development environment..."
echo ""

# Check if Docker is running
if ! docker info > /dev/null 2>&1; then
    echo "❌ Error: Docker is not running. Please start Docker Desktop and try again."
    exit 1
fi

# Start Neo4j via Docker
echo "📦 Starting Neo4j via Docker..."
docker compose up -d neo4j

# Wait a moment for Neo4j to start
echo "⏳ Waiting for Neo4j to be ready..."
sleep 5

# Check if Neo4j is responding
if ! docker exec brainweb-neo4j cypher-shell -u neo4j -p brainweb_pass "RETURN 1" > /dev/null 2>&1; then
    echo "⚠️  Neo4j may still be starting. It should be ready in a few seconds."
else
    echo "✅ Neo4j is ready!"
fi

echo ""
echo "🔧 Starting backend..."
cd backend

# Check if virtualenv exists, create if not
if [ ! -d ".venv" ]; then
    echo "📦 Creating Python virtual environment..."
    python3 -m venv .venv
fi

# Activate virtualenv and install dependencies if needed
source .venv/bin/activate
if [ ! -f ".venv/.deps_installed" ]; then
    echo "📦 Installing Python dependencies..."
    pip install -r requirements.txt
    touch .venv/.deps_installed
fi

# Start backend in background
echo "🚀 Starting FastAPI backend..."
uvicorn main:app --reload --host 127.0.0.1 --port 8000 &
BACKEND_PID=$!
cd ..

echo ""
echo "🎨 Starting frontend..."
cd frontend

# Check if node_modules exists
if [ ! -d "node_modules" ]; then
    echo "📦 Installing Node dependencies..."
    npm install
fi

# Start frontend in background
echo "🚀 Starting Next.js frontend..."
npm run dev &
FRONTEND_PID=$!
cd ..

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "✅ Brain Web is starting up!"
echo ""
echo "📍 Services:"
echo "   • Neo4j Browser:  http://localhost:7474 (user: neo4j, pass: brainweb_pass)"
echo "   • Backend API:    http://localhost:8000"
echo "   • Frontend App:   http://localhost:3000"
echo ""
echo "📝 Process IDs:"
echo "   • Backend PID:    $BACKEND_PID"
echo "   • Frontend PID:   $FRONTEND_PID"
echo ""
echo "🛑 To stop all services:"
echo "   • Press Ctrl+C to stop backend/frontend"
echo "   • Run: docker compose down (to stop Neo4j)"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# Wait for user interrupt
wait
