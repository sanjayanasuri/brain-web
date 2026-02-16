#!/bin/bash

# Configuration
NEO4J_HOST="localhost"
NEO4J_PORT="7687"
BACKEND_DIR="./backend"
FRONTEND_DIR="./frontend"
BACKEND_PORT="8000"
FRONTEND_PORT="3000"

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${YELLOW}Starting Brain Web System...${NC}"

# 1. Start Docker Containers
echo -e "${YELLOW}Starting Infrastructure (Docker)...${NC}"

# Check if Docker is running
if ! docker info > /dev/null 2>&1; then
    echo -e "${RED}Error: Docker is not running. Please start Docker Desktop.${NC}"
    exit 1
fi

# Function to start a container if not running
start_container() {
    local container_name=$1
    local image_name=$2
    local run_args=$3

    if [ "$(docker ps -q -f name=$container_name)" ]; then
        echo -e "  - $container_name is already running."
    else
        if [ "$(docker ps -aq -f name=$container_name)" ]; then
            echo -n "  - Starting existing $container_name... "
            docker start $container_name >/dev/null
        else
            echo -n "  - Creating and starting $container_name... "
            docker run -d --name $container_name $run_args $image_name >/dev/null
        fi
        echo -e "${GREEN}Done${NC}"
    fi
}

# Use local settings to enable JSON format and configure engines
SETTINGS_PATH="$(pwd)/services/miyami-search/searxng_settings.yml"
start_container "searxng" "searxng/searxng" "-p 8888:8080 -e BASE_URL=http://localhost:8888/ -v $SETTINGS_PATH:/etc/searxng/settings.yml"
# Add your specific Neo4j/Postgres run commands here if they aren't in docker-compose
# For now, assuming user might have them via docker-compose or named containers
# If you have a docker-compose.yml, prefer: docker-compose up -d neo4j postgres searxng

# Try docker-compose first if file exists, else use specific container starts (fallback)
if [ -f "docker-compose.yml" ]; then
    echo -e "  - Running docker-compose up -d for databases (this may take a moment)..."
    docker-compose up -d neo4j postgres
    if [ $? -eq 0 ]; then
        echo -e "${GREEN}Done${NC}"
    else
        echo -e "${YELLOW}Docker compose failed/incomplete. Attempting fallback...${NC}"
        # Fallback: standalone Neo4j if compose fails
        start_container "neo4j" "neo4j:5.14.0" "-p 7687:7687 -p 7474:7474 -e NEO4J_AUTH=neo4j/password"
    fi
fi

# Wait for Neo4j Port
echo -n "Waiting for Neo4j at $NEO4J_HOST:$NEO4J_PORT... "
RETRIES=0
while ! nc -z "$NEO4J_HOST" "$NEO4J_PORT" 2>/dev/null; do
    sleep 1
    RETRIES=$((RETRIES+1))
    if [ $RETRIES -gt 30 ]; then
        echo -e "${RED}Timeout!${NC}"
        echo -e "${RED}Error: Neo4j did not start in time.${NC}"
        exit 1
    fi
done
echo -e "${GREEN}Connected!${NC}"

# Initialize Postgres Tables (idempotent)
echo -n "Initializing/Checking Database Tables... "
if [ -d "backend" ] && [ -f "backend/init_study_db.py" ]; then
    # Run in a subshell to not affect current env
    (
        cd backend || exit
        if [ -d ".venv" ]; then source .venv/bin/activate; fi
        # Suppress output unless error
        python init_study_db.py >/dev/null 2>&1
    )
    echo -e "${GREEN}Done${NC}"
else
    echo -e "${YELLOW}Skipped (script not found)${NC}"
fi

# 2. Start Backend
echo -e "${YELLOW}Starting Backend...${NC}"
cd "$BACKEND_DIR" || exit
# Check if venv exists and activate
if [ -d "venv" ]; then
    echo "Activating venv..."
    source venv/bin/activate
elif [ -d ".venv" ]; then
    echo "Activating .venv..."
    source .venv/bin/activate
fi

# Kill likely conflicting process
pkill -f "uvicorn main:app" 2>/dev/null

# Start in background
uvicorn main:app --reload --port "$BACKEND_PORT" --host 0.0.0.0 > ../backend.log 2>&1 &
BACKEND_PID=$!
echo -e "${GREEN}Backend started (PID: $BACKEND_PID). Logs: backend.log${NC}"
cd ..

# 3. Start Frontend
echo -e "${YELLOW}Starting Frontend...${NC}"
cd "$FRONTEND_DIR" || exit
# Start in background
npm run dev > ../frontend.log 2>&1 &
FRONTEND_PID=$!
echo -e "${GREEN}Frontend started (PID: $FRONTEND_PID). Logs: frontend.log${NC}"
cd ..

echo -e "${GREEN}System is running!${NC}"
echo -e "Backend: http://localhost:$BACKEND_PORT"
echo -e "Frontend: http://localhost:3000 (or 3001 if 3000 was busy)"
echo -e "${YELLOW}Press Ctrl+C to stop all services.${NC}"

# Cleanup on exit
trap "echo 'Stopping services...'; kill $BACKEND_PID $FRONTEND_PID; exit" SIGINT SIGTERM

# Keep script running
wait
