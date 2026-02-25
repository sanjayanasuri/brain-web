# Brain Web Agent Preferences

This repo is the Brain Web knowledge + agent system (Neo4j graph, retrieval, backend/frontend). When running as an OpenClaw workspace, you are operating in this repo; follow the rules below.

---

## Vision and context

- **What it is:** A “second brain” that ingests handwriting, text, and voice into a personalized knowledge graph. Users chat with an AI assistant, take structured notes, and revisit ideas. The goal is ingesting content and building on existing ideas, not just storing them.
- **Where it runs:** Production on a Hetzner cluster (Neo4j, Qdrant, Postgres). Demo at **demo.sanjayanasuri.com**. Backend and frontend can run locally for development.
- **When agents work here:** As an OpenClaw workspace; CI on push/PR to main/master.

---

## Commands: what to run when

**From repo root unless noted.**

### Backend (Python, FastAPI)

| What | Command |
|------|--------|
| Install deps | `cd backend && pip install -r requirements.txt` (use a venv: `source backend/.venv/bin/activate` from repo root or `source .venv/bin/activate` from backend) |
| Run API server | `cd backend && python -m uvicorn main:app --host 0.0.0.0 --port 8000` |
| Unit tests (no Neo4j) | `cd backend && pytest tests/test_voice_style_profile.py tests/test_voice_learning_signals.py tests/test_services_vad.py tests/test_events.py tests/test_unified_primitives.py tests/test_unified_citations.py tests/test_feedback_classifier.py tests/test_notes_digest_merge_unit.py -m unit -q --tb=short` (CI: backend-unit-tests) |
| Graph/scoping tests | Requires Neo4j. `cd backend && pytest -q tests/test_graph_scoping_invariants.py -rs` and `pytest -q tests/test_all_endpoints.py -k "branches or resources or concepts"` (CI: backend-graph-scoping-tests). Same workflow runs multi-tenant isolation tests: `tests/test_multitenancy.py`, `tests/test_db_multitenancy.py`. |
| Event coverage QA | `python backend/scripts/qa_events_coverage.py` (run from repo root; also run in Playwright workflow when backend/frontend change) |

### Frontend (Node, Next.js)

| What | Command |
|------|--------|
| Install deps | `cd frontend && npm ci` |
| Dev server | `cd frontend && npm run dev` |
| Build | `cd frontend && npm run build` |
| Lint | `cd frontend && npm run lint` (CI: frontend-lint) |
| Typecheck | `cd frontend && npm run typecheck` (CI: frontend-lint) |
| Explorer E2E | `cd frontend && npm run test:explorer` (Playwright; see “Explorer E2E tests” below) |
| Full E2E | `cd frontend && npm run test:e2e`; smoke: `npm run test:smoke` |

---

## Architecture (decisions and layout)

- **Backend:** FastAPI app in `backend/main.py`. Many feature routers (api_*.py). Config from `backend/config.py`; env load order: `backend/.env` → repo `.env` → `.env.local` (highest). Neo4j (graph), Postgres (app DB), Qdrant (vector search) for retrieval. Prefer config-driven behavior and provider abstractions; avoid hardcoded routing in services.
- **Frontend:** Next.js in `frontend/`; app router under `frontend/app/`. Key surfaces: Explorer (graph + chat), library, reader, lecture-studio, review, etc. Uses React Query, Zustand, Sentry.
- **Integrations:** Notion sync (optional), voice/PersonaPlex, Exa for web search, OpenAI for AI features. Provider routing should stay configurable (aliases, indicator catalogs, query heuristics).
- **Observability:** Events (event store / activity API) with trace_id/correlation_id where possible. Event coverage enforced by `backend/scripts/qa_events_coverage.py`.

---

## Engineering default
- Prefer production-oriented designs over the fastest implementation path.
- Minimize hardcoded routing/business logic in service files; prefer config-driven behavior and provider abstractions.
- Optimize for correctness, observability, maintainability, and safe rollout.
- If a fast tactical patch is necessary, explicitly label it as temporary and outline the production follow-up.

## Web search / live data
- Treat web retrieval as a provider architecture (Exa for web/docs/news, structured providers for exact metrics).
- Keep provider routing policy configurable where practical (aliases, indicator catalogs, query heuristics).

## Events and observability
- Event coverage is checked by `python backend/scripts/qa_events_coverage.py` (run from repo root). CI runs it in the Playwright workflow when backend/frontend change. All feature areas should push events (event store or activity API) with trace_id/correlation_id where possible for OpenTelemetry.

## Multi-tenancy and data isolation
- **Request identity:** Auth middleware sets `user_id` and `tenant_id` on the request and in context vars (`set_request_graph_identity`, `set_request_db_identity`). Postgres RLS and Neo4j/Qdrant queries use this for tenant scoping.
- **Background jobs:** Any job that touches tenant- or user-scoped data (e.g. content pipeline, digest, refresh) must set identity at the start of the job: `set_request_graph_identity(job.user_id, job.tenant_id)` and `set_request_db_identity(job.user_id, job.tenant_id)`, then reset in a `finally` (see `services_content_pipeline_queue`). New background jobs must follow this pattern.
- **Graph listing:** Use `list_graphs(session, tenant_id=...)` for app code (tenant required). Use `list_all_graphs(session)` only for admin endpoints or scripts that intentionally operate on all tenants.
- **Scripts:** Scripts that touch tenant-scoped data (e.g. export, migrate) should accept an explicit tenant (CLI arg or env) when possible and pass it into services. When a script must operate on all tenants (e.g. full export), use `list_all_graphs` and document that the script is admin/full-export use.

## Explorer E2E tests
- **Run:** from repo root `cd frontend && npm run test:explorer` (or from `frontend/`: `npm run test:explorer`).
- **What it does:** Playwright runs the Explorer page suite (`tests/explorer-page.spec.ts`): loads `/explorer`, checks toolbar + search, graph area, chat panel, concept panel when a node is selected, and legend toggle. Uses `data-testid` selectors. Frontend dev server can be started by Playwright (see `playwright.config.ts` webServer) or run `npm run dev` first; backend optional for full chat/API behavior.

## Debugging and deployment health
- **No single store:** Logs and errors are not in one database. They live in: (1) **Sentry** (browser + backend errors, performance traces), (2) **Loki** (backend/container logs, via Grafana on Hetzner), (3) **GitHub issues** with label `agent-fix` (Sentry/Lighthouse/Playwright sync). Use **request_id** (and **bw_session_id**) to correlate across these: same ID appears in Sentry tags, backend log lines, and activity events.
- **Central entry point for “what’s wrong” / “what’s causing slowdowns”:** Call **GET /admin/observability-summary** (auth required). It returns links to Sentry and Grafana/Loki, suggested Loki log queries, and optionally recent Sentry issues if the backend has Sentry API env configured. Use that response to answer deployment-health and slowdown questions.
- **Runbook when summary isn’t enough:** (1) **Sentry** – open your Sentry project, filter last 24h, check errors and performance for slow transactions. (2) **Loki (Grafana)** – run: `{container="brainweb-backend"}` for backend logs; `{job="docker"} |= "ERROR"` for errors; `{job="docker"} |= "request_id"` and add the id to narrow. (3) **Agent-fix issues** – open GitHub issues with label `agent-fix` for automated Sentry/Lighthouse/Playwright items. (4) **Given a request_id:** search Loki for that id; in Sentry filter by tag `request_id`; in Neo4j/activity events search by `trace_id`.
- **Docs:** `docs/deployment/OBSERVABILITY_HETZNER.md` (Grafana/Loki setup), `.github/AGENT_FEED.md` (agent-fix issue format and claim protocol).

## CI / GitHub Actions
- **Pin actions to full commit SHAs.** Use the 40-character SHA (e.g. `actions/checkout@34e114876b0b11c390a56381ad16ebd13914f8d5`), not tags like `@v4`. This avoids IDE/linter “repository or version not found” when it can’t resolve GitHub and matches GitHub’s guidance for immutable, secure action usage. To get the SHA for a tag: `https://api.github.com/repos/OWNER/REPO/commits/TAG` and use the response `sha`.
- **Job-level env for step outputs.** If a step sets env vars that later steps use (e.g. image names), define them in the job’s `env` block so linters don’t report “context access might be invalid”; prefer that over `echo VAR=... >> $GITHUB_ENV` when the value can be expressed in YAML.
- **“Unable to resolve action” in the IDE.** If the editor shows “repository or version not found” for workflow actions, the environment likely can’t reach GitHub (e.g. offline, restricted network). The workflows are valid; CI will run correctly. Ignore those diagnostics or, if needed, disable the GitHub Actions extension’s workflow validation for this workspace. Optional: `.vscode/settings.json` can map `.github/**` to a minimal YAML schema (e.g. `.vscode/schemas/empty.json` with `{}`) to reduce schema-based validation noise; the repo currently ignores `.vscode/`, so add that locally if desired.
