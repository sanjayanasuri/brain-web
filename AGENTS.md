# Brain Web Agent Preferences

## Engineering default
- Prefer production-oriented designs over the fastest implementation path.
- Minimize hardcoded routing/business logic in service files; prefer config-driven behavior and provider abstractions.
- Optimize for correctness, observability, maintainability, and safe rollout.
- If a fast tactical patch is necessary, explicitly label it as temporary and outline the production follow-up.

## Web search / live data
- Treat web retrieval as a provider architecture (Exa for web/docs/news, structured providers for exact metrics).
- Keep provider routing policy configurable where practical (aliases, indicator catalogs, query heuristics).

## Cursor Cloud specific instructions

### Architecture overview
Brain Web is a full-stack AI knowledge graph app: **FastAPI backend** (port 8000) + **Next.js 14 frontend** (port 3000), backed by Neo4j, PostgreSQL (TimescaleDB), Qdrant, and Redis via Docker Compose.

### Starting services
1. Docker services: `sudo docker compose up -d neo4j postgres qdrant redis` (from repo root). Docker daemon must be running first (`sudo bash -c 'dockerd &>/var/log/dockerd.log &'`; wait ~3s).
2. Backend: `cd backend && source .venv/bin/activate && uvicorn main:app --reload --host 127.0.0.1 --port 8000`
3. Frontend: `cd frontend && npm run dev`

### Environment files
- Root `.env` must set `NEO4J_PASSWORD` (required by docker-compose). Use `.env.example` as template.
- `frontend/.env.local` needs `NEXT_PUBLIC_API_URL=http://127.0.0.1:8000`, `NEXTAUTH_URL=http://localhost:3000`, and a `NEXTAUTH_SECRET`.

### Gotchas
- **`api_preferences.py` missing import**: The file uses `require_auth` but originally did not import it from `auth`. This was fixed by adding `require_auth` to the import line. If the fix is reverted, the backend will fail to start with `NameError: name 'require_auth' is not defined`.
- **Postgres schema warnings**: On first startup, `db_postgres` may log `cannot alter type of a column used in a policy definition` — this is benign; the schema already exists.
- **Backend health endpoint** requires a trailing slash: `GET /health/` (without trailing slash returns 307 redirect).
- **Backend tests** (`pytest`) import `main.py` via `conftest.py`, so any module-level import error in any `api_*.py` file will prevent all tests from running.
- The `OPENAI_API_KEY` env var is required by the backend; set to a placeholder for non-AI dev work.

### Commands reference
- Lint: `cd frontend && npx next lint`
- Typecheck: `cd frontend && npx tsc -p tsconfig.json --noEmit`
- Frontend tests: `cd frontend && npm test`
- Backend tests: `cd backend && source .venv/bin/activate && python -m pytest tests/ -v`
- See `Makefile` for additional targets (`make test`, `make doctor`, etc.).
