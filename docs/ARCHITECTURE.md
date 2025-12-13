# Branch Explorer — Architecture (additive on Brain Web)

This document describes how we evolve the existing Brain Web system into Branch Explorer without breaking what works today.

## Current system (baseline)

### Backend
- FastAPI app in `backend/`
- Neo4j database via `backend/db_neo4j.py`
- Routers split across `backend/api_*.py`
- LLM features for ingestion, chat, embeddings, gaps, preferences

### Frontend
- Next.js app in `frontend/`
- Graph visualization + chat
- Calls backend REST endpoints

## Target concepts (new product layer)

### Data primitives
- Graph Collection: named container for graphs
- Branch: alternate lineage within a collection
- Snapshot: saved state (time-travel) for a branch
- Source: provenance for nodes/edges (Notion today)

## Compatibility strategy (do not break existing APIs)

### Phase 1: Add collection-aware endpoints alongside existing endpoints
- Keep current endpoints working with a default collection + default branch
- Introduce new endpoints that accept `collectionId` and optionally `branchId`
- Use additive response fields instead of changing existing schemas where possible

### Defaulting behavior
- If a request hits “legacy” endpoints, it operates on:
  - collection = `default`
  - branch = `main`
- New endpoints allow explicit selection

## Neo4j modeling approach

We add scoping metadata instead of rewriting the entire graph model.

### Option A (preferred for minimal disruption): scope via properties
Add `collection_id` and `branch_id` properties to nodes/edges created going forward.
- Pros: minimal query changes; easy to progressively adopt
- Cons: older data needs a backfill to be explicitly scoped

### Option B: scope via subgraphs / labels
Use labels like `:Concept` plus `:Collection_<id>` or relationship scoping labels.
- Pros: can be query-performant in some cases
- Cons: dynamic labels are harder to manage; complicates tooling

### Recommendation
Start with Option A. Add a one-time backfill script to apply `collection_id=default`, `branch_id=main` to existing nodes/edges.

## API surface (additive)

### New backend routers (planned)
- `backend/api_collections.py`
  - create/list/get/update collections
- `backend/api_branches.py`
  - create/list/get/compare/collapse branches
- `backend/api_snapshots.py`
  - create/list/restore snapshots

### Query scoping
All graph reads/writes that are branch-aware must include:
- `collection_id` and `branch_id` in the WHERE clause for nodes/relationships

### Compare + collapse
- Compare returns structural diffs (nodes/edges added/removed/changed)
- Collapse applies a merge strategy (e.g., “prefer target branch”, “prefer source branch”, “manual conflict set”)

## Frontend architecture (additive)

### New UI concepts (planned)
- Collection picker
- Branch picker + fork button
- Compare view (diff panel)
- Snapshot list + restore
- Profile customization screen
- Source management screen

### Routing
- Keep existing pages working
- Add new routes under `frontend/app/` for Branch Explorer flows (e.g. `/collections`, `/collections/[id]/branches/[branchId]`)

## Migration path to future apps/ split (non-breaking)
We design new files/routes so they can later move cleanly into:
- `apps/backend-api/`
- `apps/frontend-web/`

Without moving anything today.
