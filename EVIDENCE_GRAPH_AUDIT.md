# Evidence Graph Upgrade - Audit & Implementation Plan

## Executive Summary

This document audits the current web ingestion pipeline and proposes an upgrade to a first-class "Evidence Graph" with Quote nodes, improved provenance tracking, and an "Extend" operation for controlled graph expansion.

---

## 1. High-Level Architecture

### Current Architecture (Text Diagram)

```
┌─────────────────────────────────────────────────────────────────┐
│                    BROWSER EXTENSION                            │
├─────────────────────────────────────────────────────────────────┤
│  Content Script (src/content_script.js)                        │
│    ├─ extractReaderTextFallback()                              │
│    ├─ extractFullTextFallback()                                │
│    ├─ getSelectionText()                                        │
│    └─ getMetadata() → {url, title, author, published_time, ...} │
│                                                                 │
│  Popup (src/popup.js)                                           │
│    └─ Enqueues capture with mode: selection|reader|full        │
│                                                                 │
│  Service Worker (src/service_worker.js)                         │
│    ├─ Queue management (localStorage)                           │
│    └─ runCaptureNow() → POST /web/ingest                       │
└─────────────────────────────────────────────────────────────────┘
                            │
                            │ HTTP POST
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│                    BACKEND API                                   │
├─────────────────────────────────────────────────────────────────┤
│  api_web_ingestion.py::ingest_web()                            │
│    ├─ Canonicalize URL                                          │
│    ├─ Compute checksum (idempotency)                            │
│    ├─ Create IngestionRun                                       │
│    ├─ upsert_source_document() → SourceDocument node            │
│    ├─ chunk_text() → List[chunk]                                 │
│    ├─ For each chunk:                                           │
│    │   ├─ upsert_source_chunk() → SourceChunk node              │
│    │   │   └─ Auto-creates (SourceChunk)-[:FROM_DOCUMENT]->(SourceDocument)
│    │   └─ extract_claims_from_chunk() → List[claim_data]        │
│    │       └─ For each claim:                                   │
│    │           ├─ upsert_claim() → Claim node                   │
│    │           │   └─ Auto-creates (Claim)-[:SUPPORTED_BY]->(SourceChunk)
│    │           └─ link_claim_mentions() → (Claim)-[:MENTIONS]->(Concept)
│    └─ mark_source_document_status("INGESTED")                  │
└─────────────────────────────────────────────────────────────────┘
                            │
                            │ Neo4j Writes
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│                    NEO4J GRAPH SCHEMA                           │
├─────────────────────────────────────────────────────────────────┤
│  Nodes:                                                          │
│    • SourceDocument {doc_id, url, source, metadata, ...}       │
│    • SourceChunk {chunk_id, text, chunk_index, metadata, ...}  │
│    • Claim {claim_id, text, confidence, method, ...}           │
│    • Concept {node_id, name, domain, type, ...}                  │
│                                                                 │
│  Relationships:                                                 │
│    • (SourceChunk)-[:FROM_DOCUMENT]->(SourceDocument)          │
│    • (Claim)-[:SUPPORTED_BY]->(SourceChunk)                     │
│    • (Claim)-[:MENTIONS]->(Concept)                              │
│    • (Concept)-[:RELATES_TO]->(Concept)  [various predicates]   │
└─────────────────────────────────────────────────────────────────┘
```

### Target Architecture (Evidence Graph)

```
┌─────────────────────────────────────────────────────────────────┐
│                    BROWSER EXTENSION (Enhanced)                 │
├─────────────────────────────────────────────────────────────────┤
│  Content Script                                                 │
│    ├─ Capture selection with anchor (CSS selector + offset)     │
│    ├─ Capture full page with metadata                            │
│    └─ Support Wikipedia revision_id if available                │
│                                                                 │
│  Popup                                                           │
│    └─ "Extend" button → POST /extend                           │
└─────────────────────────────────────────────────────────────────┘
                            │
                            │ HTTP POST
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│                    BACKEND API (Enhanced)                        │
├─────────────────────────────────────────────────────────────────┤
│  api_web_ingestion.py::ingest_web()                             │
│    └─ Creates Quote nodes for selections                        │
│                                                                 │
│  api_extend.py::extend()  [NEW]                                 │
│    ├─ Mode A: Suggest connections (no writes)                  │
│    ├─ Mode B: Generate claims from quotes (writes Claim + edges) │
│    └─ Mode C: Controlled expansion (cap new nodes)              │
└─────────────────────────────────────────────────────────────────┘
                            │
                            │ Neo4j Writes
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│                    NEO4J GRAPH SCHEMA (Enhanced)                 │
├─────────────────────────────────────────────────────────────────┤
│  Nodes:                                                          │
│    • SourcePage {url, title, domain, captured_at, ...}         │
│    • Quote {quote_id, text, anchor, captured_at, user_note, ...}│
│    • Claim {claim_id, text, stance, created_at, ...}            │
│    • Concept {concept_id, display_name, aliases[], ...}        │
│                                                                 │
│  Relationships:                                                 │
│    • (Concept)-[:HAS_QUOTE]->(Quote)                            │
│    • (Quote)-[:QUOTED_FROM]->(SourcePage)                       │
│    • (Claim)-[:EVIDENCED_BY]->(Quote)                           │
│    • (Concept)-[:SUPPORTED_BY]->(Claim)                          │
│    • (Concept)-[:RELATES_TO {type, justification, confidence}]->(Concept)
└─────────────────────────────────────────────────────────────────┘
```

---

## 2. Component Inventory & Gap Analysis

### 2.1 Extension Capture Flow

| Component | Current | Target | Change |
|-----------|---------|--------|--------|
| **Content Script** | `src/content_script.js`<br/>- `extractReaderTextFallback()`<br/>- `getSelectionText()` (plain text only)<br/>- `getMetadata()` (title, url, author, published_time) | Same + anchor capture<br/>- Store CSS selector + text offset for selections<br/>- Store section + paragraph index for Wikipedia<br/>- Store page number + bbox for PDFs | **Enhance**: Add anchor serialization to `getSelectionText()` |
| **Popup UI** | `src/popup.js`<br/>- Mode selector (selection/reader/full)<br/>- Domain, tags, note fields<br/>- Queue display | Same + "Extend" button<br/>- Quote preview/management | **Add**: Extend UI component |
| **Service Worker** | `src/service_worker.js`<br/>- Queue management<br/>- `runCaptureNow()` → POST `/web/ingest` | Same + Extend API calls | **Add**: Extend request handler |

### 2.2 Backend Ingestion Flow

| Component | Current | Target | Change |
|-----------|---------|--------|--------|
| **Request Model** | `WebIngestRequest`<br/>- url, title, text, capture_mode<br/>- selection_text (optional)<br/>- metadata (dict) | Same + quote_data[]<br/>- anchor (CSS selector or structured)<br/>- user_note, tags | **Enhance**: Add quote fields to request |
| **Endpoint** | `POST /web/ingest`<br/>`api_web_ingestion.py::ingest_web()` | Same + quote creation logic | **Modify**: Create Quote nodes for selections |
| **Chunking** | `services_lecture_ingestion.py::chunk_text()`<br/>- max_chars=1200, overlap=150<br/>- Sentence-boundary aware | Same (keep as-is) | **No change** |
| **Claim Extraction** | `services_claims.py::extract_claims_from_chunk()`<br/>- LLM-based extraction<br/>- Returns: claim_text, mentioned_concept_names, confidence | Same (keep as-is) | **No change** |
| **Concept Extraction** | ❌ **NOT DONE** in web ingestion<br/>- Only exists in `services_resource_ai.py::extract_concepts_from_text()` (unused) | Optional: Extract concepts from quotes/chunks | **Add**: Optional concept extraction step |

### 2.3 Neo4j Schema

| Component | Current | Target | Change |
|-----------|---------|--------|--------|
| **SourceDocument** | `{doc_id, url, source, external_id, metadata, status, checksum, ...}`<br/>Label: `SourceDocument` | Rename to `SourcePage`<br/>Add: `published_at`, `content_type`, `revision_id` (optional) | **Refactor**: Rename node label + add fields |
| **SourceChunk** | `{chunk_id, text, chunk_index, source_id, metadata, ...}`<br/>Label: `SourceChunk`<br/>Relationship: `(SourceChunk)-[:FROM_DOCUMENT]->(SourceDocument)` | Keep for backward compatibility<br/>OR deprecate in favor of Quote | **Decision**: Keep both (Quote for selections, Chunk for full-page chunks) |
| **Quote** | ❌ **DOES NOT EXIST** | `{quote_id, text, anchor, captured_at, user_note, tags, ...}`<br/>Label: `Quote`<br/>Relationships:<br/>- `(Quote)-[:QUOTED_FROM]->(SourcePage)`<br/>- `(Concept)-[:HAS_QUOTE]->(Quote)` | **NEW**: Create Quote node type |
| **Claim** | `{claim_id, text, confidence, method, source_id, source_span, chunk_id, ...}`<br/>Label: `Claim`<br/>Relationships:<br/>- `(Claim)-[:SUPPORTED_BY]->(SourceChunk)`<br/>- `(Claim)-[:MENTIONS]->(Concept)` | Same + add `stance`, `qualifier`<br/>Change: `(Claim)-[:EVIDENCED_BY]->(Quote)` instead of `SUPPORTED_BY->SourceChunk` | **Modify**: Update relationship type + add fields |
| **Concept** | `{node_id, name, domain, type, description, tags, ...}`<br/>Label: `Concept`<br/>Relationships:<br/>- `(Concept)-[:RELATES_TO]->(Concept)` (various predicates) | Same + add `aliases[]`<br/>Add: `(Concept)-[:HAS_QUOTE]->(Quote)`<br/>Add: `(Concept)-[:SUPPORTED_BY]->(Claim)` | **Enhance**: Add aliases field + new relationships |

### 2.4 Current Graph Entities & Relationships

**Node Labels (Current):**
- `Concept` - Knowledge concepts
- `SourceDocument` - Ingested documents (web pages, SEC filings, etc.)
- `SourceChunk` - Text chunks from documents
- `Claim` - Extracted factual claims
- `Lecture`, `LectureSegment`, `Analogy` - Lecture-specific nodes
- `Resource` - Attached resources (images, PDFs, etc.)
- `IngestionRun` - Ingestion tracking
- `GraphSpace`, `Branch` - Graph scoping
- `Community` - Community detection results

**Relationship Types (Current):**
- `(SourceChunk)-[:FROM_DOCUMENT]->(SourceDocument)`
- `(Claim)-[:SUPPORTED_BY]->(SourceChunk)`
- `(Claim)-[:MENTIONS]->(Concept)`
- `(Concept)-[:RELATES_TO {predicate}]->(Concept)` - Various predicates (PREREQUISITE_FOR, DEPENDS_ON, etc.)
- `(Concept)-[:BELONGS_TO]->(GraphSpace)`
- `(SourceChunk)-[:BELONGS_TO]->(GraphSpace)`
- `(Claim)-[:BELONGS_TO]->(GraphSpace)`

**Missing for Target Model:**
- `Quote` node label
- `(Quote)-[:QUOTED_FROM]->(SourcePage)` relationship
- `(Concept)-[:HAS_QUOTE]->(Quote)` relationship
- `(Claim)-[:EVIDENCED_BY]->(Quote)` relationship (currently uses `SUPPORTED_BY->SourceChunk`)
- `(Concept)-[:SUPPORTED_BY]->(Claim)` relationship (currently only `Claim->MENTIONS->Concept`)

---

## 3. Code Path Locations

### 3.1 Capture of Selected Text vs Full Page

**File**: `browser-extension/src/content_script.js`

- **Selection mode**: `getSelectionText()` (line 32-40)
  - Uses `window.getSelection().toString()`
  - Returns plain text only (no anchor)
  
- **Full page mode**: `extractFullTextFallback()` (line 95-99)
  - Clones body, removes noise nodes
  - Returns `clone.innerText`

- **Reader mode**: `extractReaderTextFallback()` (line 70-93)
  - Scores candidate elements (article, main, div, section)
  - Returns best-scoring element's text

**Change needed**: Enhance `getSelectionText()` to capture anchor (CSS selector + offset).

### 3.2 Metadata Capture

**File**: `browser-extension/src/content_script.js::getMetadata()` (line 101-131)

Captures:
- `url` - `window.location.href`
- `title` - `document.title`
- `canonical_url` - `<link rel="canonical">`
- `author` - Meta tags (author, article:author, parsely-author)
- `published_time` - Meta tags (article:published_time, og:published_time, etc.)
- `site_name` - `og:site_name`
- `page_description` - Meta description

**Missing**: `published_at` (parsed timestamp), `content_type`, `revision_id` (for Wikipedia).

### 3.3 Chunking Logic

**File**: `backend/services_lecture_ingestion.py::chunk_text()` (line 77-127)

- Function: `chunk_text(text: str, max_chars: int = 1200, overlap: int = 150)`
- Logic: Sentence-boundary aware, tries to break at `.`, `\n`, `!`, `?`, falls back to space
- Returns: `List[Dict[str, Any]]` with `{"text": str, "index": int}`

**Used in**: `api_web_ingestion.py::ingest_web()` (line 246)

**No change needed** - works well for full-page chunks.

### 3.4 Claim Extraction Logic

**File**: `backend/services_claims.py::extract_claims_from_chunk()` (line 67-150)

- Uses LLM (GPT-4o-mini) with `CLAIM_EXTRACTION_PROMPT`
- Returns: `List[Dict]` with `claim_text`, `mentioned_concept_names`, `confidence`, `source_span`
- Called from: `api_web_ingestion.py::ingest_web()` (line 326)

**No change needed** - works well.

### 3.5 Concept Extraction Logic

**File**: `backend/services_resource_ai.py::extract_concepts_from_text()` (line 163-211)

- Uses LLM to extract concept names from text
- **NOT USED** in web ingestion flow
- Only used for resource attachment suggestions

**Change needed**: Integrate into web ingestion (optional step).

### 3.6 Relationship Creation Logic

**File**: `backend/services_graph.py`

- **Claim to Chunk**: `upsert_claim()` (line 2447-2535) auto-creates `(Claim)-[:SUPPORTED_BY]->(SourceChunk)`
- **Claim to Concept**: `link_claim_mentions()` (line 2538-2569) creates `(Claim)-[:MENTIONS]->(Concept)`
- **Concept to Concept**: `create_relationship()` (line 671-698) creates `(Concept)-[:RELATES_TO {predicate}]->(Concept)`

**Change needed**: 
- Add `(Claim)-[:EVIDENCED_BY]->(Quote)` relationship
- Add `(Concept)-[:SUPPORTED_BY]->(Claim)` relationship (reverse direction)

### 3.7 Rename/Alias Logic

**File**: `backend/services_graph.py`

- `normalize_name()` used in multiple places (line 44-46 in `api_web_ingestion.py`, line 72-74 in `services_lecture_ingestion.py`)
- **No alias system exists** - concepts only have a single `name` field

**Change needed**: Add `aliases[]` field to Concept model and update matching logic.

### 3.8 Deduplication/Upsert Logic

**File**: `backend/services_sources.py::upsert_source_document()` (line 31-124)

- Uses `MERGE` on `(graph_id, doc_id)` key
- Checks `checksum` for idempotency (line 66, 150 in `api_web_ingestion.py`)
- Updates `on_branches` array on match

**File**: `backend/services_graph.py::upsert_source_chunk()` (line 2369-2444)

- Uses `MERGE` on `(graph_id, chunk_id)` key
- Auto-creates `FROM_DOCUMENT` relationship

**File**: `backend/services_graph.py::upsert_claim()` (line 2447-2535)

- Uses `MERGE` on `(graph_id, claim_id)` key
- **No deduplication by text** - each call creates new claim_id

**Change needed**: Add quote deduplication (by text + source_page + anchor).

---

## 4. Schema Gaps Assessment

### 4.1 Missing Nodes

| Node Type | Status | Gap |
|-----------|--------|-----|
| **SourcePage** | ❌ Missing | Currently `SourceDocument` - needs rename + fields: `published_at`, `content_type`, `revision_id` |
| **Quote** | ❌ Missing | **NEW** - First-class quote nodes with anchor, user_note, tags |
| **Concept** | ✅ Exists | Needs `aliases[]` field |
| **Claim** | ✅ Exists | Needs `stance`, `qualifier` fields |

### 4.2 Missing Relationships

| Relationship | Status | Gap |
|-------------|--------|-----|
| `(Concept)-[:HAS_QUOTE]->(Quote)` | ❌ Missing | **NEW** |
| `(Quote)-[:QUOTED_FROM]->(SourcePage)` | ❌ Missing | **NEW** |
| `(Claim)-[:EVIDENCED_BY]->(Quote)` | ❌ Missing | Currently `(Claim)-[:SUPPORTED_BY]->(SourceChunk)` |
| `(Concept)-[:SUPPORTED_BY]->(Claim)` | ❌ Missing | Currently only `(Claim)-[:MENTIONS]->(Concept)` (one-way) |
| `(Concept)-[:RELATES_TO {type, justification, confidence}]->(Concept)` | ⚠️ Partial | Exists but missing `justification` field |

### 4.3 Overlaps & Refactoring Needs

1. **SourceDocument vs SourcePage**: Rename `SourceDocument` to `SourcePage` for clarity (or keep both for backward compatibility).

2. **SourceChunk vs Quote**: 
   - **Option A**: Keep both - `SourceChunk` for full-page chunks, `Quote` for user selections
   - **Option B**: Deprecate `SourceChunk` in favor of `Quote` (more work, breaks existing data)

   **Recommendation**: Option A (keep both).

3. **Claim relationships**: Currently `(Claim)-[:SUPPORTED_BY]->(SourceChunk)`. Need to add `(Claim)-[:EVIDENCED_BY]->(Quote)` for quote-backed claims.

4. **Concept aliases**: No alias system exists. Need to add `aliases[]` field and update matching logic.

---

## 5. Quote as First-Class Implementation

### 5.1 Quote Node Schema

```cypher
CREATE (q:Quote {
  quote_id: string,           // "QUOTE_{hash}"
  text: string,                // The quoted text
  anchor: string,              // JSON string: {type, selector, offset, ...}
  captured_at: integer,        // Unix timestamp (ms)
  user_note: string?,          // Optional user annotation
  tags: [string]?,             // Optional tags
  graph_id: string,
  on_branches: [string]
})
```

### 5.2 Anchor Storage Strategy

**For Generic Web Pages:**
```json
{
  "type": "css_selector",
  "selector": "#main-content > p:nth-child(3)",
  "text_offset": 42,
  "text_prefix": "Neural networks use",
  "text_suffix": "backpropagation to"
}
```

**For Wikipedia:**
```json
{
  "type": "wikipedia",
  "section": "History",
  "paragraph_index": 2,
  "revision_id": 12345678,
  "text_offset": 10
}
```

**For PDFs (Future):**
```json
{
  "type": "pdf",
  "page_number": 5,
  "bbox": [100, 200, 500, 250],
  "text_offset": 0
}
```

**Simplest Implementation**: Start with CSS selector + text offset for generic pages. Add Wikipedia/PDF support later.

### 5.3 Anchor Capture in Extension

**File**: `browser-extension/src/content_script.js`

Add function:
```javascript
function getSelectionWithAnchor() {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return null;
  
  const range = sel.getRangeAt(0);
  const text = range.toString();
  
  // Get CSS selector for start container
  const startEl = range.startContainer.nodeType === Node.TEXT_NODE
    ? range.startContainer.parentElement
    : range.startContainer;
  
  const selector = getCSSSelector(startEl);
  const offset = range.startOffset;
  
  return {
    text,
    anchor: {
      type: "css_selector",
      selector,
      text_offset: offset,
      text_prefix: text.slice(0, 20),
      text_suffix: text.slice(-20)
    }
  };
}
```

### 5.4 Quote Creation in Backend

**File**: `backend/services_graph.py`

Add function:
```python
def upsert_quote(
    session: Session,
    graph_id: str,
    branch_id: str,
    quote_id: str,
    text: str,
    anchor: Dict[str, Any],
    source_page_id: str,
    user_note: Optional[str] = None,
    tags: Optional[List[str]] = None,
    captured_at: Optional[int] = None
) -> dict:
    """Create or update a Quote node and link to SourcePage."""
    # Implementation similar to upsert_source_chunk
    # Creates (Quote)-[:QUOTED_FROM]->(SourcePage)
```

**File**: `backend/api_web_ingestion.py`

Modify `ingest_web()` to:
- If `capture_mode == "selection"` and `selection_text` exists, create Quote node
- Link Quote to SourceDocument (later SourcePage)

---

## 6. Extend Operation Design

### 6.1 Extend Modes

**Mode A: Suggest Connections (No Writes)**
- Input: Concept ID or Quote ID
- Output: List of suggested relationships/claims
- Writes: None (only creates `Suggestion` nodes for review)

**Mode B: Generate Evidence-Backed Claims (Writes)**
- Input: Quote ID(s) or Concept ID
- Output: Generated Claim nodes + edges
- Writes: `Claim` nodes, `(Claim)-[:EVIDENCED_BY]->(Quote)`, `(Concept)-[:SUPPORTED_BY]->(Claim)`

**Mode C: Controlled Graph Expansion (Cap New Nodes)**
- Input: Concept ID, max_new_nodes
- Output: New concepts + relationships (up to cap)
- Writes: `Concept` nodes, `(Concept)-[:RELATES_TO]->(Concept)` relationships

### 6.2 Extend Endpoint

**File**: `backend/api_extend.py` (NEW)

```python
@router.post("/extend", response_model=ExtendResponse)
def extend(
    payload: ExtendRequest,
    session: Session = Depends(get_neo4j_session),
):
    """
    Extend the graph with suggestions or controlled expansion.
    
    Modes:
    - A: suggest_connections (no writes)
    - B: generate_claims (writes Claim + edges)
    - C: controlled_expansion (writes Concept + edges, capped)
    """
```

**Request Model**:
```python
class ExtendRequest(BaseModel):
    mode: Literal["suggest_connections", "generate_claims", "controlled_expansion"]
    source_id: str  # Concept ID or Quote ID
    max_new_nodes: Optional[int] = None  # For mode C
    context: Optional[str] = None  # Optional context/query
```

**Response Model**:
```python
class ExtendResponse(BaseModel):
    mode: str
    suggestions: List[Dict[str, Any]]  # For mode A
    created_nodes: List[str]  # Node IDs created
    created_relationships: List[Dict[str, Any]]  # {source, target, type}
    status: str
```

### 6.3 Extend UI Integration

**File**: `browser-extension/src/popup.js`

Add "Extend" button that:
1. Shows current page/selection context
2. Calls `POST /extend` with mode selection
3. Displays suggestions (mode A) or created nodes (modes B/C)

**File**: `frontend/app/...` (if web UI exists)

Add Extend component to concept/quote detail pages.

---

## 7. Phased Implementation Plan

### Phase 1: Quote as First-Class (Minimal Viable)

**Goal**: Enable Quote nodes for selections with basic provenance.

**Changes**:

1. **Extension** (`browser-extension/src/content_script.js`):
   - Add `getSelectionWithAnchor()` function
   - Modify `getSelectionText()` to return anchor data
   - Update `buildResponse()` to include anchor in selection mode

2. **Backend Models** (`backend/models.py`):
   - Add `Quote` model class
   - Add `anchor` field to `WebIngestRequest` (optional)

3. **Backend Services** (`backend/services_graph.py`):
   - Add `upsert_quote()` function
   - Add `link_quote_to_source_page()` helper

4. **Backend API** (`backend/api_web_ingestion.py`):
   - Modify `ingest_web()` to create Quote node when `capture_mode == "selection"`
   - Link Quote to SourceDocument (keep SourceDocument label for now)

5. **Neo4j Schema**:
   - Create `Quote` node label
   - Create `(Quote)-[:QUOTED_FROM]->(SourceDocument)` relationship

**Files to Modify**:
- `browser-extension/src/content_script.js` (add anchor capture)
- `backend/models.py` (add Quote model)
- `backend/services_graph.py` (add upsert_quote function)
- `backend/api_web_ingestion.py` (create quotes for selections)

**Risks**:
- Anchor serialization may fail on complex pages
- Need to handle edge cases (no selection, invalid selector)

**Tests Needed**:
- Unit test for `getSelectionWithAnchor()`
- Integration test for quote creation in `ingest_web()`

---

### Phase 2: Enhanced Provenance & Relationships

**Goal**: Complete the evidence graph relationships and add missing fields.

**Changes**:

1. **Backend Models** (`backend/models.py`):
   - Add `aliases[]` to `Concept` model
   - Add `stance`, `qualifier` to `Claim` model
   - Rename `SourceDocument` to `SourcePage` (or add alias)

2. **Backend Services** (`backend/services_graph.py`):
   - Add `(Concept)-[:HAS_QUOTE]->(Quote)` relationship creation
   - Add `(Claim)-[:EVIDENCED_BY]->(Quote)` relationship (in addition to existing `SUPPORTED_BY->SourceChunk`)
   - Add `(Concept)-[:SUPPORTED_BY]->(Claim)` relationship (reverse direction)
   - Update concept matching to use `aliases[]`

3. **Backend API** (`backend/api_web_ingestion.py`):
   - Link quotes to concepts mentioned in selection
   - Create `HAS_QUOTE` relationships

4. **Neo4j Schema**:
   - Add `aliases` property to `Concept` nodes
   - Create `(Concept)-[:HAS_QUOTE]->(Quote)` relationship
   - Create `(Claim)-[:EVIDENCED_BY]->(Quote)` relationship
   - Create `(Concept)-[:SUPPORTED_BY]->(Claim)` relationship

**Files to Modify**:
- `backend/models.py` (add fields)
- `backend/services_graph.py` (add relationships)
- `backend/api_web_ingestion.py` (link quotes to concepts)
- Migration script for existing data (add aliases, create relationships)

**Risks**:
- Migration of existing data may be slow
- Need to handle backward compatibility

**Tests Needed**:
- Test alias matching in concept resolution
- Test bidirectional claim-concept relationships

---

### Phase 3: Extend Operation

**Goal**: Implement Extend API with three modes.

**Changes**:

1. **Backend API** (`backend/api_extend.py` - NEW):
   - Create `extend()` endpoint
   - Implement Mode A: `suggest_connections()` - LLM-based suggestion generation
   - Implement Mode B: `generate_claims_from_quotes()` - Extract claims from quotes
   - Implement Mode C: `controlled_expansion()` - Generate concepts with cap

2. **Backend Services** (`backend/services_extend.py` - NEW):
   - `suggest_connections()` - Use LLM to suggest relationships
   - `generate_claims_from_quotes()` - Extract claims from quote text
   - `controlled_expansion()` - Generate new concepts with relationship suggestions

3. **Extension UI** (`browser-extension/src/popup.js`):
   - Add "Extend" button
   - Add mode selector
   - Display suggestions/results

4. **Frontend UI** (if applicable):
   - Add Extend component to concept/quote pages

**Files to Create**:
- `backend/api_extend.py`
- `backend/services_extend.py`

**Files to Modify**:
- `browser-extension/src/popup.js` (add Extend UI)
- `backend/main.py` (register extend router)

**Risks**:
- LLM costs for suggestion generation
- Need rate limiting for Extend API
- Mode C expansion may create too many nodes

**Tests Needed**:
- Test each Extend mode
- Test rate limiting
- Test node capping in Mode C

---

## 8. Detailed File Changes (Phase 1)

### 8.1 `browser-extension/src/content_script.js`

**Add after line 40**:
```javascript
function getCSSSelector(element) {
  if (!element || element.id) {
    return element.id ? `#${element.id}` : null;
  }
  
  const path = [];
  while (element && element.nodeType === Node.ELEMENT_NODE) {
    let selector = element.nodeName.toLowerCase();
    if (element.className) {
      const classes = element.className.split(/\s+/).filter(Boolean);
      if (classes.length > 0) {
        selector += '.' + classes.join('.');
      }
    }
    path.unshift(selector);
    element = element.parentElement;
  }
  return path.join(' > ');
}

function getSelectionWithAnchor() {
  try {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return null;
    
    const range = sel.getRangeAt(0);
    const text = cleanText(range.toString());
    if (!text) return null;
    
    const startContainer = range.startContainer;
    const startEl = startContainer.nodeType === Node.TEXT_NODE
      ? startContainer.parentElement
      : startContainer;
    
    const selector = getCSSSelector(startEl);
    const offset = range.startOffset;
    
    // Get context (prefix/suffix)
    const containerText = startContainer.textContent || '';
    const prefix = containerText.slice(Math.max(0, offset - 20), offset);
    const suffix = containerText.slice(offset, Math.min(containerText.length, offset + 20));
    
    return {
      text,
      anchor: {
        type: "css_selector",
        selector: selector || "body",
        text_offset: offset,
        text_prefix: prefix,
        text_suffix: suffix
      }
    };
  } catch (e) {
    return null;
  }
}
```

**Modify `getSelectionText()` (line 32-40)**:
```javascript
function getSelectionText() {
  try {
    const sel = window.getSelection();
    if (!sel) return "";
    return cleanText(sel.toString());
  } catch {
    return "";
  }
}
```

**Modify `buildResponse()` (line 139-188)** to include anchor:
```javascript
function buildResponse({ mode }) {
  const meta = getMetadata();
  const selection = getSelectionText();
  const selectionWithAnchor = mode === "selection" ? getSelectionWithAnchor() : null;
  const pdf = isProbablyPDF();

  // ... existing PDF/selection/reader/full logic ...

  if (mode === "selection") {
    return {
      ok: true,
      mode_used: "selection",
      selection_text: selection || null,
      text: selection || "",
      anchor: selectionWithAnchor?.anchor || null,  // NEW
      meta: { ...meta, is_pdf: pdf }
    };
  }

  // ... rest of function ...
}
```

### 8.2 `backend/models.py`

**Add after line 891**:
```python
class Quote(BaseModel):
    """A first-class quote node with provenance."""
    quote_id: str
    text: str
    anchor: Dict[str, Any]  # JSON-serialized anchor data
    captured_at: int  # Unix timestamp (ms)
    user_note: Optional[str] = None
    tags: Optional[List[str]] = None
    graph_id: str
    source_page_id: str  # doc_id of SourceDocument/SourcePage
```

### 8.3 `backend/services_graph.py`

**Add after line 2570**:
```python
def upsert_quote(
    session: Session,
    graph_id: str,
    branch_id: str,
    quote_id: str,
    text: str,
    anchor: Dict[str, Any],
    source_page_id: str,
    user_note: Optional[str] = None,
    tags: Optional[List[str]] = None,
    captured_at: Optional[int] = None
) -> dict:
    """
    Create or update a Quote node and link to SourcePage.
    
    Args:
        session: Neo4j session
        graph_id: Graph ID for scoping
        branch_id: Branch ID for scoping
        quote_id: Unique quote identifier
        text: Quote text content
        anchor: Anchor data (dict, will be JSON stringified)
        source_page_id: SourceDocument/SourcePage doc_id
        user_note: Optional user annotation
        tags: Optional tags list
        captured_at: Optional capture timestamp (defaults to now)
    
    Returns:
        dict with quote_id and basic fields
    """
    ensure_graph_scoping_initialized(session)
    
    if captured_at is None:
        captured_at = int(datetime.utcnow().timestamp() * 1000)
    
    anchor_str = json.dumps(anchor) if anchor else None
    tags_str = json.dumps(tags) if tags else None
    
    query = """
    MATCH (g:GraphSpace {graph_id: $graph_id})
    MERGE (q:Quote {graph_id: $graph_id, quote_id: $quote_id})
    ON CREATE SET
        q.text = $text,
        q.anchor = $anchor,
        q.captured_at = $captured_at,
        q.user_note = $user_note,
        q.tags = $tags,
        q.on_branches = [$branch_id],
        q.created_at = timestamp()
    ON MATCH SET
        q.text = $text,
        q.anchor = $anchor,
        q.user_note = $user_note,
        q.tags = $tags,
        q.on_branches = CASE
            WHEN q.on_branches IS NULL THEN [$branch_id]
            WHEN $branch_id IN q.on_branches THEN q.on_branches
            ELSE q.on_branches + $branch_id
        END,
        q.updated_at = timestamp()
    MERGE (q)-[:BELONGS_TO]->(g)
    WITH q, g
    MATCH (d:SourceDocument {graph_id: $graph_id, doc_id: $source_page_id})
    MERGE (q)-[:QUOTED_FROM]->(d)
    RETURN q.quote_id AS quote_id,
           q.text AS text,
           q.captured_at AS captured_at
    """
    result = session.run(
        query,
        graph_id=graph_id,
        branch_id=branch_id,
        quote_id=quote_id,
        text=text,
        anchor=anchor_str,
        source_page_id=source_page_id,
        user_note=user_note,
        tags=tags_str,
        captured_at=captured_at
    )
    record = result.single()
    if not record:
        raise ValueError(f"Failed to create/update Quote {quote_id}")
    return record.data()
```

### 8.4 `backend/api_web_ingestion.py`

**Modify `WebIngestRequest` (line 55-65)**:
```python
class WebIngestRequest(BaseModel):
    """Request to ingest a webpage via the extension."""
    url: str
    title: Optional[str] = None
    capture_mode: str = "reader"  # "selection" | "reader" | "full"
    text: str  # extracted body text from extension
    selection_text: Optional[str] = None
    anchor: Optional[Dict[str, Any]] = None  # NEW: anchor data for selections
    domain: Optional[str] = "General"
    tags: List[str] = []
    note: Optional[str] = None
    metadata: Dict[str, Any] = {}
```

**Modify `ingest_web()` (after line 243, before chunking)**:
```python
    # Step 7.5: Create Quote node if selection mode
    quote_id = None
    if payload.capture_mode == "selection" and payload.anchor and payload.selection_text:
        try:
            quote_id = f"QUOTE_{uuid4().hex[:8].upper()}"
            from services_graph import upsert_quote
            upsert_quote(
                session=session,
                graph_id=graph_id,
                branch_id=branch_id,
                quote_id=quote_id,
                text=payload.selection_text,
                anchor=payload.anchor,
                source_page_id=artifact_id,
                user_note=payload.note,
                tags=payload.tags if payload.tags else None,
            )
        except Exception as e:
            error_msg = f"Failed to create Quote: {str(e)}"
            errors.append(error_msg)
            # Continue with chunking even if quote creation fails
```

---

## 9. Migration Considerations

### 9.1 Existing Data

- **SourceDocument nodes**: Keep as-is (or add migration to rename to SourcePage)
- **SourceChunk nodes**: Keep as-is (used for full-page chunks)
- **Claim nodes**: Add `EVIDENCED_BY` relationships to Quotes when quotes exist
- **Concept nodes**: Add `aliases[]` field (empty array initially)

### 9.2 Backward Compatibility

- Keep `SourceDocument` label (don't break existing queries)
- Keep `(Claim)-[:SUPPORTED_BY]->(SourceChunk)` relationships
- Add new relationships alongside existing ones

---

## 10. Testing Strategy

### 10.1 Unit Tests

- `getSelectionWithAnchor()` - Test anchor serialization
- `upsert_quote()` - Test quote creation and linking
- `extend()` modes - Test each mode independently

### 10.2 Integration Tests

- Full ingestion flow with selection → Quote creation
- Extend API with all three modes
- Relationship creation (HAS_QUOTE, EVIDENCED_BY, etc.)

### 10.3 End-to-End Tests

- Extension capture → Backend ingestion → Quote node in Neo4j
- Extend operation → New nodes/relationships created

---

## 11. Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Anchor serialization fails on complex pages | High | Fallback to text-only, log error |
| Migration of existing data is slow | Medium | Run migration in background, batch processing |
| Extend API creates too many nodes | High | Implement node capping, rate limiting |
| LLM costs for Extend suggestions | Medium | Cache suggestions, limit requests per user |
| Breaking changes to existing queries | High | Keep old relationships, add new ones alongside |

---

## 12. Success Metrics

- Quote nodes created for all selections
- Extend API used regularly (track usage)
- Evidence-backed claims linked to quotes
- User satisfaction with provenance tracking

---

## Appendix: File Reference Summary

### Extension Files
- `browser-extension/src/content_script.js` - Text extraction + anchor capture
- `browser-extension/src/popup.js` - UI for capture + Extend
- `browser-extension/src/service_worker.js` - Queue management + API calls

### Backend Files
- `backend/api_web_ingestion.py` - Web ingestion endpoint
- `backend/services_graph.py` - Graph operations (upsert_quote, relationships)
- `backend/services_claims.py` - Claim extraction
- `backend/services_lecture_ingestion.py` - Chunking logic
- `backend/services_sources.py` - SourceDocument management
- `backend/models.py` - Pydantic models
- `backend/api_extend.py` - **NEW** Extend endpoint
- `backend/services_extend.py` - **NEW** Extend logic

### Neo4j Schema
- Node labels: `Quote`, `SourceDocument` (or `SourcePage`), `Concept`, `Claim`
- Relationships: `QUOTED_FROM`, `HAS_QUOTE`, `EVIDENCED_BY`, `SUPPORTED_BY`, `MENTIONS`

