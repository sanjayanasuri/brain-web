# Brain Web Codebase Map
This repo is a two-part app: a FastAPI backend connected to Neo4j and a Next.js/React frontend for visualizing and editing the knowledge graph. Below is a file-by-file map of the important pieces, what they expose, and how requests move through them.

## Data & Infrastructure
- `backend/config.py` – loads `.env`, exposes `NEO4J_URI/USER/PASSWORD` and optional `OPENAI_API_KEY`.
- `backend/db_neo4j.py` – creates the Neo4j driver and `get_neo4j_session()` FastAPI dependency (opens/closes a session per request).
- `graph/*.csv` – seed/sync data (`nodes_semantic.csv`, `edges_semantic.csv`, `lecture_covers_*.csv`) that the import/export scripts read/write.
- `backend/run.sh` – convenience script to run the FastAPI dev server with uvicorn using the virtualenv.
- `backend/NEO4J_SETUP.md`, `OPENAI_API_KEY_SETUP.md`, `QUICKSTART.md`, `README.md`, `LAYOUT_CUSTOMIZATION_GUIDE.md`, `SYNC_VERIFICATION_GUIDE.md` – how-to docs for environment, keys, layout tweaks, and sync verification.

## Backend (FastAPI)
- `backend/main.py` – creates the FastAPI app, sets CORS, mounts routers, and on startup runs CSV import (`scripts/import_csv_to_neo4j.main()`). Root `GET /` healthcheck.
- `backend/models.py` – Pydantic schemas for concepts, lectures, lecture steps, and AI requests/responses.

### Routers (API surface)
- `backend/api_concepts.py` – CRUD and graph utilities for concepts:
  - `GET /concepts/missing-descriptions` → `services_graph.get_nodes_missing_description`
  - `GET /concepts/all/graph` returns all nodes/edges for visualization
  - `GET /concepts/by-name/{name}` and `GET /concepts/{node_id}` lookups
  - `POST /concepts/` creates a concept → triggers CSV auto-export
  - `POST /concepts/relationship` / `POST /concepts/relationship-by-ids` create edges
  - `GET /concepts/{id}/neighbors` and `/neighbors-with-relationships`
  - `DELETE /concepts/{id}` and `DELETE /concepts/relationship` removals (export on success)
  - `POST /concepts/cleanup-test-data` deletes seed/test concepts
- `backend/api_lectures.py` – lecture management:
  - `POST /lectures/` creates a lecture (export)
  - `GET /lectures/{id}` fetches a lecture
  - `POST /lectures/{id}/steps` adds/updates `COVERS` relationships with `step_order` (export)
  - `GET /lectures/{id}/steps` lists ordered lecture steps
- `backend/api_ai.py` – AI-related endpoints:
  - `POST /ai/chat` echo stub
  - `POST /ai/semantic-search` → `services_search.semantic_search_nodes` to return nodes + scores
- `backend/api_admin.py` – manual sync controls:
  - `POST /admin/import` runs CSV → Neo4j import
  - `POST /admin/export` runs Neo4j → CSV export

### Services & helpers
- `backend/services_graph.py` – core graph accessors/mutators:
  - Fetch helpers: `get_concept_by_name/id`, `get_neighbors`, `get_neighbors_with_relationships`, `get_all_concepts`, `get_all_relationships`, `get_nodes_missing_description`, `get_neighbors_for_nodes`.
  - Mutations: `create_concept` (UUID-like `NXXXXXXXX` ids), `create_relationship` (by names), `create_relationship_by_ids`, `delete_concept`, `delete_relationship`, `delete_test_concepts`.
- `backend/services_lectures.py` – lecture helpers:
  - `create_lecture` (generates `LXXXXXXXX`), `get_lecture_by_id`, `add_lecture_step` (MERGE `COVERS` with `step_order`), `get_lecture_steps`.
- `backend/services_search.py` – semantic search pipeline:
  - Loads OpenAI API key (from `backend/.env`, env vars, or `config`), initializes `OpenAI` client.
  - `embed_text` → OpenAI embeddings (`text-embedding-3-small`); `_embedding_cache` memoizes node embeddings.
  - `cosine_similarity` helper.
  - `semantic_search_nodes(query, session, limit)` embeds query, embeds nodes (or falls back to name match if no key), scores via cosine similarity, sorts, returns `[{node, score}]`.
- `backend/services_sync.py` – `auto_export_csv(background_tasks)` wrapper that runs `scripts/export_csv_from_neo4j.main()` either inline or as FastAPI background task after mutations.

### Import/Export scripts
- `backend/scripts/import_csv_to_neo4j.py` – session helper + `create_constraints()`, `import_nodes()`, `import_edges()`, `import_lecture_covers()`, wired by `main()`. Consumes `graph/*.csv`.
- `backend/scripts/export_csv_from_neo4j.py` – session helper + `export_nodes()`, `export_edges()`, `export_lecture_covers()`, wired by `main()`. Writes back to `graph/*.csv`.
- `backend/test_connection.py` – quick Neo4j connectivity check (prints success/failure).

### Tests
- `backend/tests/` – pytest suite covering root, admin, concepts, lectures, and AI endpoints; uses fixtures in `conftest.py` and `pytest.ini`.

## Frontend (Next.js 13+ App Router)
- `frontend/app/layout.tsx` – global layout + metadata; imports shared styles from `globals.css`.
- `frontend/app/page.tsx` – renders the main `GraphVisualization` component.
- `frontend/app/api-client.ts` – browser-side client for FastAPI:
  - Exposes `getConcept`, `getConceptByName`, `getNeighbors`, `getNeighborsWithRelationships`, `fetchGraphData`, `getAllGraphData`.
  - Mutations: `createConcept`, `createRelationshipByIds`, `deleteConcept`, `deleteRelationship`, `cleanupTestData`.
  - Uses `NEXT_PUBLIC_API_URL` (defaults to `http://127.0.0.1:8000`).
- `frontend/app/api/brain-web/chat/route.ts` – server route that powers the chat panel:
  - Loads `OPENAI_API_KEY` at request time (env or `.env.local` fallback).
  - Calls backend `/ai/semantic-search` to get relevant nodes, then `/concepts/{id}/neighbors` for context.
  - Builds a structured prompt (gap analysis vs normal), calls OpenAI Chat (`gpt-4o-mini`), parses `ANSWER`, `SUGGESTED_ACTIONS`, and `FOLLOW_UP_QUESTIONS`, returns JSON `{answer, usedNodes, suggestedQuestions, suggestedActions}`.
- `frontend/app/components/GraphVisualization.tsx` – main UI/interaction layer:
  - Uses `react-force-graph-2d` for canvas graph rendering; dynamic import with custom forces (`applyForcesToGraph` adjusts link distance, charge, and collision radii based on zoom/focus/domain spread/bubble spacing controls).
  - Loads full graph via `api-client.getAllGraphData`, converts to visual nodes/links, supports domain filtering, focus/zoom helpers, and temporary nodes (local only).
  - Node interactions: click to select/focus/toggle expanded, hover highlighting, background click recenters.
  - Command/chat panel: parses text commands (`search/select/go/show`, `link/relink`, `add node`, `temp`, `delete node`, `cleanup`, `preserve` snapshot), invokes API client mutations, and reloads graph. Sends natural-language questions to `/api/brain-web/chat`, displays answers, suggested actions, and follow-up questions.
  - Linking mode lets user pick a source node then click a target to create a relationship with chosen predicate.
  - Auto-fetches concepts missing descriptions to propose suggested questions.
  - UI state for split panes, chat expansion/maximize, quick command chips, and styling for badges/pills.
- `frontend/app/globals.css` – global theme: gradients, typography (Space Grotesk + Plex Mono), layout styles, graph controls, chat styles, pills/badges, loader, etc.
- `frontend/next.config.js`, `frontend/tsconfig.json`, `frontend/package.json` – Next.js configuration and dependencies.

## End-to-End Flow
1) User opens the Next.js app (`frontend/app/page.tsx`), which renders `GraphVisualization`.
2) The component fetches graph data via `api-client` → FastAPI `GET /concepts/all/graph` → Neo4j (`services_graph.get_all_concepts/get_all_relationships`).
3) Mutations (create/delete concepts or relationships, lecture steps) originate from UI commands → `api-client` → FastAPI routers → Neo4j. Post-mutation, `services_sync.auto_export_csv` kicks off a background CSV export to keep `graph/*.csv` in sync.
4) Chat questions go to the Next.js API route `/api/brain-web/chat` → backend `/ai/semantic-search` (OpenAI embeddings) + concept neighbor fetches → OpenAI Chat completion → formatted answer/actions/questions returned to the UI.
5) Admin or startup sync uses `backend/main.py` startup hook or `/admin/import`/`/admin/export` to keep Neo4j and CSV artifacts aligned.

## Notable Entry Points
- Run backend: `cd backend && ./run.sh` (or `uvicorn main:app --reload`).
- Run frontend: `cd frontend && npm run dev` (requires `NEXT_PUBLIC_API_URL` and `OPENAI_API_KEY` in `.env.local`).
- One-off sync: `python backend/scripts/import_csv_to_neo4j.py` or `export_csv_from_neo4j.py`.
