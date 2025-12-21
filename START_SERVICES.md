# Quick Start Guide - Brain Web Services

## Current Status
✅ API keys are configured correctly (found in backend/.env, .env.local, frontend/.env.local)
✅ No API keys exposed in git history
❌ Backend server is NOT running
❌ Frontend server is NOT running

## To Start Everything

### Option 1: Use the automated script (recommended)
```bash
./scripts/start_dev.sh
```

### Option 2: Manual startup

#### 1. Start Neo4j (if using Docker)
```bash
docker compose up -d neo4j
```

#### 2. Start Backend
```bash
cd backend
source .venv/bin/activate
uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

#### 3. Start Frontend (in a new terminal)
```bash
cd frontend
npm run dev
```

## Verify Everything Works

After starting services, run:
```bash
python3 check_functionality.py
```

This will test:
- ✅ Environment files
- ✅ OpenAI API key validity
- ✅ Neo4j connectivity
- ✅ Backend API endpoints
- ✅ Frontend accessibility

## Common Issues

### Backend won't start
- Make sure `.venv` is activated: `source backend/.venv/bin/activate`
- Install dependencies: `pip install -r backend/requirements.txt`
- Check Neo4j is running and credentials are correct in `backend/.env`

### Frontend won't start
- Install dependencies: `cd frontend && npm install`
- Check Node.js version: `node --version` (should be 18+)

### OpenAI API errors
- Verify key is valid: Check https://platform.openai.com/api-keys
- Make sure key is in `backend/.env` or `.env.local` (repo root)
- Restart backend after changing .env files

### Neo4j connection errors
- Check Neo4j is running: `docker ps` (if using Docker)
- Verify credentials in `backend/.env` match your Neo4j setup
- Test connection: `docker exec brainweb-neo4j cypher-shell -u neo4j -p brainweb_pass "RETURN 1"`
