# Branch Explorer — Roadmap

This roadmap is intentionally incremental: every step should keep the existing Brain Web engine running.

## Phase 0 — Scaffolding (now)
- Add `VISION.md`, `docs/ARCHITECTURE.md`, `docs/ROADMAP.md`
- Ensure `.env.example` and `docker-compose.yml` are safe and dev-friendly

Exit criteria:
- New docs exist
- Docker compose no longer hardcodes credentials

## Phase 1 — Graph Collections (MVP)
Backend:
- Add collection model (id, name, created_at, updated_at)
- Add endpoints:
  - create/list/get/update collections
- Establish default collection (`default`) and default branch (`main`)

Frontend:
- Add collection list + create flow
- Add collection selector in graph view

Exit criteria:
- You can create/select a collection
- Graph reads/writes are scoped to the selected collection (or default)

## Phase 2 — Branches (fork / compare / collapse)
Backend:
- Add branch model (id, collection_id, name, parent_branch_id, created_at)
- Fork endpoint: create branch from a base branch
- Compare endpoint: structural diff between two branches
- Collapse endpoint: apply merge strategy from source branch into target branch

Frontend:
- Branch picker
- Fork button
- Compare drawer (diff results)
- Collapse action with confirmation

Exit criteria:
- Forking produces isolated changes
- Compare shows meaningful diffs
- Collapse merges changes back into main branch

## Phase 3 — Snapshots (save / restore)
Backend:
- Snapshot model (id, collection_id, branch_id, name, created_at, payload reference)
- Create snapshot (store a frozen set of nodes/edges or a reversible event log)
- Restore snapshot

Frontend:
- Snapshot list per branch
- Save snapshot modal
- Restore snapshot action

Exit criteria:
- Restoring a snapshot returns the graph to that saved state

## Phase 4 — Profile + Exploration Preferences (product polish)
Backend:
- Preferences scoped to collection and optionally branch
- Add exploration settings (default expansion depth, clustering, novelty weighting)

Frontend:
- Profile customization screen
- Exploration preferences panel

Exit criteria:
- Changing preferences has visible effect in graph exploration and AI responses

## Phase 5 — Source Management (Notion now; extensible later)
Backend:
- Source registry with types (notion/github/pdf/web)
- Per-collection source config

Frontend:
- Source management screen
- Source status + sync controls

Exit criteria:
- Collection has explicit source config and visibility
- Notion can be enabled/disabled per collection
