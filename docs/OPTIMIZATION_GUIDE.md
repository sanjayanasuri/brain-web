# Where to Look Next: Large Files & How to Optimize Them

## Backend (priority order)

### 1. `backend/services_graph.py` (~4,377 lines)
**Directory:** `backend/`

**Already done:** Helpers extracted to `services_graph_helpers.py` (tenant + visibility).

**Next steps:**
- **Split by domain** into submodules under `backend/services/graph/`:
  - `concepts.py` – `get_concept_*`, `create_concept`, `update_concept`, `delete_concept`, `get_all_concepts`, `get_graph_overview`, `get_neighbors*`, `get_nodes_missing_description`, `unlink_lecture`
  - `relationships.py` – `create_relationship`, `get_all_relationships`, `create_relationship_by_ids`, `delete_relationship`, `relationship_exists`, `get_proposed_relationships`, `accept_relationships`, `reject_relationships`, `edit_relationship`, `create_or_update_proposed_relationship`
  - `artifacts.py` – `create_or_get_artifact`, `link_artifact_mentions_concept`, `get_artifact`, `canonicalize_url`, `normalize_text_for_hash`
  - `profiles.py` – `get_response_style_profile`, `update_response_style_profile`, `store_answer`, `store_style_feedback`, `get_style_feedback_examples`, `store_revision`, `get_recent_answers`, `get_answer_detail`, `store_feedback`, `get_recent_feedback_summary`
  - `user_profile.py` – `get_focus_areas`, `upsert_focus_area`, `get_user_profile`, `update_user_profile`, `patch_user_profile`, `update_episodic_context`
  - `memory.py` – `store_conversation_summary`, `get_recent_conversation_summaries`, `upsert_learning_topic`, `get_active_learning_topics`
  - `claims_quotes.py` – `upsert_source_chunk`, `upsert_claim`, `link_claim_mentions`, `get_evidence_subgraph`, `upsert_quote`, `link_concept_has_quote`, etc.
  - `communities.py` – `upsert_community`, `set_concept_community_memberships`, `get_claims_for_communities`
- Keep `services_graph.py` as a thin facade that re-exports from these modules so existing `from services_graph import create_concept` etc. still work.

**Optimization tactics:**
- Use `utils.timestamp.utcnow_ms` / `utcnow_iso` anywhere timestamps are still inlined.
- Batch Neo4j writes where you loop with single writes (e.g. relationship creation).
- Move pure Cypher-building helpers into a small `cypher_helpers.py` if they grow.

---

### 2. `backend/services_lecture_ingestion.py` (~1,622 lines)
**Directory:** `backend/`

**Split strategy:**
- **Extract to `backend/services/lecture_ingestion/`** (or keep in backend with multiple files):
  - `chunking.py` – `chunk_text`, `normalize_name`
  - `extraction.py` – `extract_segments_and_analogies_with_llm`, `call_llm_for_extraction`, `_process_structure_recursive`, `process_structure`, `run_lecture_extraction_engine`
  - `chunk_claims.py` – `process_chunk_atomic`, `run_chunk_and_claims_engine`
  - `segments_analogies.py` – `run_segments_and_analogies_engine`
  - `handwriting.py` – `ingest_handwriting`
  - `concept_utils.py` – `find_concept_by_name_and_domain`, `update_concept_description_if_better`, `merge_tags`, `update_concept_tags`
- Main `services_lecture_ingestion.py` becomes a thin orchestrator that imports and delegates.

**Optimization tactics:**
- Use `utils.timestamp` for any `datetime.utcnow()`-based timestamps.
- If you have big loops that call Neo4j per item, consider batched writes.
- Share a single Neo4j session per request where possible instead of opening many.

---

### 3. `backend/models/__init__.py` (~1,537 lines)
**Directory:** `backend/models/`

**Split strategy:**
- Split by **domain**, one file per area (keep `__init__.py` re-exporting for backward compatibility):
  - `concept.py` – `Concept`, `ConceptCreate`, `ConceptUpdate`, `RelationshipCreate`
  - `lecture.py` – `Lecture`, `LectureCreate`, `LectureUpdate`, `NotebookPage`, `LectureStep`, `ExtractedNode`, `ExtractedLink`, `HierarchicalTopic`, `LectureExtraction`, `LectureIngestRequest`, `HandwritingIngestRequest`, `FreeformCanvasCaptureRequest`, `Analogy`, `LectureSegment`, `LectureBlock`, `LectureMention`, `LectureIngestResult`, etc.
  - `chat_retrieval.py` – `AIChatRequest`, `AIChatResponse`, `SemanticSearch*`, `GraphRAGContext*`, `Intent`, `RetrievalTraceStep`, `RetrievalResult`, `IntentResult`, `RetrievalRequest`
  - `profile_feedback.py` – `ResponseStyleProfile`, `ExplanationFeedback`, `FeedbackSummary`, `FocusArea`, `UserProfile`, `ReminderPreferences`
  - `tasks_events.py` – task/event/notes models
  - Keep `__init__.py`: `from .concept import *; from .lecture import *` etc. so existing `from models import Concept` still works.

**Optimization tactics:**
- Avoid circular imports: models should not import services; keep them data-only.
- Use `Optional` and defaults so call sites stay simple.

---

### 4. `backend/services_retrieval_plans.py` (~1,212 lines)
**Directory:** `backend/`

**Split strategy:**
- One module per **intent/plan** under `backend/services/retrieval_plans/` (or same dir with multiple files):
  - `core.py` – `run_plan`, `_safe_float`, `_clean_compare_target`, `_dedupe_targets`, `_extract_compare_targets_*`, `_identify_compare_targets`, `_empty_result`
  - `definition_overview.py` – `plan_definition_overview`
  - `timeline.py` – `plan_timeline`
  - `causal_chain.py` – `plan_causal_chain`
  - `compare.py` – `plan_compare`
  - `who_network.py` – `plan_who_network`
  - `evidence_check.py` – `plan_evidence_check`
  - `explore_next.py` – `plan_explore_next`
  - `what_changed.py` – `plan_what_changed`
  - `self_knowledge.py` – `plan_self_knowledge`
- `services_retrieval_plans.py` imports from these and exposes `run_plan` and any public API.

**Optimization tactics:**
- Use `utils.timestamp` if any timestamps are built inline.
- Share a single session per request; avoid creating new sessions inside tight loops.
- Consider caching for expensive LLM-based target extraction (`_extract_compare_targets_llm`) if the same query is repeated.

---

### 5. `backend/api_concepts.py` (~1,281 lines)
**Directory:** `backend/`

**Split strategy:**
- Split by **resource/action**:
  - `api_concepts_read.py` – search, get by name/slug/id, list mentions, get notes, cross-graph instances, linked instances, neighbors, claims, sources
  - `api_concepts_write.py` – create, update, pin, create relationship, propose relationship, check relationship, delete concept, delete relationship, cleanup_test_data
- Or split by route group: `concepts_crud.py`, `concepts_relationships.py`, `concepts_claims_sources.py`.
- Register routers in `main.py` from each module so URL surface stays the same.

**Optimization tactics:**
- Use `utils.timestamp` where you set `created_at`/`updated_at`.
- Move non-trivial logic into `services_*` and keep the API layer thin (validation + call service + return).

---

### 6. Other large backend files (quick wins)
- **`backend/services_refresh_bindings.py`** (~1,019) – Extract “binding types” and “refresh steps” into smaller functions or a `services/refresh/` package.
- **`backend/services_contextual_branches.py`** (~969) – Extract branch/context helpers; consider a `contextual_branches/` package.
- **`backend/main.py`** (~915) – Keep as is; it’s mostly router includes. Optionally group router registration in a `register_routers()` function for readability.
- **`backend/api_ai.py`** (~904), **`backend/api_voice_stream.py`** (~818) – Thin out by moving business logic into `services_*` and keeping routes as thin wrappers.

---

## Frontend (priority order)

### 1. `frontend/app/components/context/ContextPanel.tsx` (~3,903 lines)
**Directory:** `frontend/app/components/context/`

**Split strategy:**
- Extract **panels/sections** as separate components:
  - `ContextPanelHeader.tsx`, `ContextPanelEvidence.tsx`, `ContextPanelSources.tsx`, `ContextPanelNotes.tsx`, `ContextPanelQuotes.tsx`, etc.
- Extract **hooks**: e.g. `useContextPanelState.ts`, `useEvidenceFilter.ts`, `useContextPanelData.ts` (fetch/loading state).
- Extract **constants and types** to `contextPanelTypes.ts` and `contextPanelConstants.ts`.
- Keep `ContextPanel.tsx` as a composition of these components and hooks.

**Optimization tactics:**
- Memoize heavy lists with `React.memo` or `useMemo`; virtualize long lists (e.g. `react-window`) if needed.
- Lazy-load heavy child components with `React.lazy` + `Suspense` where it makes sense.

---

### 2. `frontend/app/components/topbar/TopBar.tsx` (~3,733 lines)
**Directory:** `frontend/app/components/topbar/`

**Split strategy:**
- Extract **sections**: e.g. `TopBarLeft.tsx`, `TopBarCenter.tsx`, `TopBarRight.tsx`, or by feature (search, graph switcher, user menu, voice, etc.).
- Extract **hooks**: e.g. `useTopBarState.ts`, `useGraphSwitcher.ts`.
- Extract **types/constants** to `topbarTypes.ts` / `topbarConstants.ts`.

**Optimization tactics:**
- Same as ContextPanel: memoization, lazy loading for heavy dropdowns/panels.

---

### 3. `frontend/app/api/brain-web/chat/route.ts` (~1,764 lines)
**Directory:** `frontend/app/api/brain-web/`

**Split strategy:**
- Extract **handlers** into modules under e.g. `api/brain-web/chat/`:
  - `handleGraphRAGMode.ts`, `buildMessages.ts`, `performWebSearch.ts` (if not already elsewhere), response builders, streaming helpers.
- Extract **types** to `chat/types.ts`.
- Keep `route.ts` as a thin POST handler that delegates to these modules.

**Optimization tactics:**
- Reuse shared fetch/streaming helpers to avoid duplication.
- Keep route handler focused on parsing request and calling one high-level function.

---

### 4. Other large frontend files
- **`LectureEditor.tsx`** (~1,700), **`lecture-studio/page.tsx`** (~1,390), **`templates/page.tsx`** (~1,370) – Extract toolbar, sidebar, block components and page-level hooks; move types to shared files.
- **`api/types.ts`** (~1,287) – Split by domain: `chat.types.ts`, `graph.types.ts`, `lecture.types.ts`, etc., and re-export from `types.ts` for backward compatibility.

---

## Cross-cutting optimization habits

1. **Timestamps** – Use `utils.timestamp.utcnow_ms()` and `utcnow_iso()` in backend instead of ad hoc `datetime.utcnow()`.
2. **Magic numbers** – Move to `config.py` (or frontend env/constants) and document.
3. **Comment blocks** – Remove “moved to X” or “deprecated” commented code; rely on git history.
4. **Imports** – Prefer one place that re-exports (e.g. `services_graph.py` or `models/__init__.py`) so the rest of the codebase doesn’t need to change when you split.
5. **Tests** – After each split, run the test suite and fix imports; add a few smoke tests for the new modules if they’re critical paths.

---

## Suggested order of work

1. **Backend:** `models/__init__.py` (split by domain) – low risk, high clarity.
2. **Backend:** `services_retrieval_plans.py` (split by intent) – clear boundaries.
3. **Backend:** `services_graph.py` (continue split with `services/graph/*`) – biggest win.
4. **Backend:** `services_lecture_ingestion.py` (extract extraction/chunking/claims).
5. **Backend:** `api_concepts.py` (split read/write or by resource).
6. **Frontend:** `ContextPanel.tsx` and `TopBar.tsx` (extract components + hooks).
7. **Frontend:** `chat/route.ts` (extract handlers and types).

This order minimizes risk (models and retrieval plans have fewer call sites) and then tackles the largest files (graph, lecture ingestion, API, then frontend).
