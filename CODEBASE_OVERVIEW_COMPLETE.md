# Brain Web - Complete Codebase Overview

This document provides a comprehensive view of the entire codebase structure with key files expanded, designed to be fed to an LLM for understanding what to extract for a similar project.

---

## 📁 Complete Directory Structure

```
brain-web/
├── backend/                    # FastAPI Python backend
│   ├── api_*.py               # API route handlers (FastAPI routers)
│   ├── services_*.py         # Business logic layer
│   ├── models.py             # Pydantic data models
│   ├── db_neo4j.py           # Neo4j database connection
│   ├── config.py             # Environment configuration
│   ├── main.py               # FastAPI app entry point
│   ├── prompts.py            # LLM prompt templates
│   ├── notion_*.py           # Notion integration modules
│   ├── teaching_style_*.py  # Teaching style extraction
│   ├── source_interface.py   # Multi-source abstraction
│   ├── requirements.txt      # Python dependencies
│   ├── tests/                # Test suite
│   ├── scripts/              # Utility scripts
│   └── uploaded_resources/   # File storage
│
├── frontend/                  # Next.js React frontend
│   ├── app/                  # Next.js app directory
│   │   ├── api/              # Next.js API routes (proxies)
│   │   ├── components/       # React components
│   │   ├── [routes]/         # Next.js pages
│   │   ├── api-client.ts     # Backend API client
│   │   └── globals.css       # Global styles
│   ├── package.json          # Node.js dependencies
│   └── tsconfig.json         # TypeScript config
│
├── docs/                     # Documentation
├── graph/                    # CSV seed data
└── scripts/                  # Development scripts
```

---

## 🔑 Key Files (Expanded)

### Backend Core Files

#### 1. `backend/main.py` - FastAPI Application Entry Point

**Purpose:** Main FastAPI application setup, middleware, router registration, error handling

**Key Features:**
- FastAPI app initialization with lifespan management
- CORS middleware configuration
- Router registration (concepts, lectures, AI, Notion, preferences, etc.)
- Centralized error handling (HTTP exceptions, validation errors, general exceptions)
- Static file serving for uploaded resources
- CSV auto-import on startup
- Notion auto-sync background loop (if enabled)

**Routers Registered:**
- `concepts_router` - Concept CRUD operations
- `ai_router` - AI chat and semantic search
- `lectures_router` - Lecture ingestion and management
- `admin_router` - Admin operations (CSV import/export)
- `notion_router` - Notion integration
- `preferences_router` - User preferences and personalization
- `feedback_router` - Answer feedback system
- `teaching_style_router` - Teaching style profile
- `debug_router` - Debug endpoints
- `answers_router` - Answer tracking
- `resources_router` - Resource management
- `tests_router` - Test suite UI
- `gaps_router` - Knowledge gap detection

**Error Handling:**
- HTTP exceptions (4xx/5xx) with appropriate logging levels
- Request validation errors (422)
- General exception handler with sanitized messages

---

#### 2. `backend/models.py` - Pydantic Data Models

**Purpose:** All data models/schemas for API requests/responses and database entities

**Key Models:**

**Core Concept Models:**
- `Concept` - Main concept/node model with properties (node_id, name, domain, type, description, tags, notes_key, url_slug, lecture_sources, created_by, last_updated_by)
- `ConceptCreate` - For creating new concepts
- `ConceptUpdate` - Partial update model
- `RelationshipCreate` - For creating relationships between concepts

**Lecture Models:**
- `Lecture` - Lecture metadata (lecture_id, title, description, primary_concept, level, estimated_time, slug)
- `LectureCreate` - For creating lectures
- `LectureStep` - Lecture step with concept reference
- `LectureSegment` - Segmented lecture content with style tags, covered concepts, analogies
- `Analogy` - Teaching analogies extracted from lectures
- `LectureIngestRequest` - Request for lecture ingestion
- `LectureIngestResult` - Result with created/updated nodes and links
- `ExtractedNode` - Node extracted by LLM from lecture text
- `ExtractedLink` - Relationship extracted by LLM

**AI Models:**
- `AIChatRequest` - Chat request
- `AIChatResponse` - Chat response
- `SemanticSearchRequest` - Semantic search query
- `SemanticSearchResponse` - Search results with scores

**Personalization Models:**
- `ResponseStyleProfile` - Tone, teaching style, sentence structure, explanation order, forbidden styles
- `FocusArea` - Current learning themes
- `UserProfile` - Background, interests, weak spots, learning preferences
- `NotionConfig` - Notion integration configuration

**Feedback Models:**
- `ExplanationFeedback` - User feedback on answers
- `FeedbackSummary` - Aggregated feedback
- `AnswerRecord` - Stored answers
- `Revision` - User-rewritten answers

**Teaching Style Models:**
- `TeachingStyleProfile` - Extracted teaching style
- `TeachingStyleUpdateRequest` - Manual style updates

**Resource Models:**
- `Resource` - File/image/link resources
- `ResourceCreate` - Resource creation request

---

#### 3. `backend/config.py` - Environment Configuration

**Purpose:** Load and expose environment variables with priority order

**Configuration Priority:**
1. `backend/.env` (lowest priority)
2. `repo_root/.env` (overrides backend)
3. `repo_root/.env.local` (highest priority)

**Environment Variables:**
- `NEO4J_URI` - Neo4j connection URI (default: bolt://localhost:7687)
- `NEO4J_USER` - Neo4j username (default: neo4j)
- `NEO4J_PASSWORD` - Neo4j password (required, no default)
- `OPENAI_API_KEY` - OpenAI API key (optional, for AI features)
- `NOTION_API_KEY` - Notion API key (optional, for Notion integration)
- `NOTION_DATABASE_IDS` - Comma-separated list of Notion database IDs
- `ENABLE_NOTION_AUTO_SYNC` - Enable background Notion sync (default: false)
- `BRAINWEB_API_BASE` - API base URL (default: http://127.0.0.1:8000)

---

#### 4. `backend/db_neo4j.py` - Neo4j Database Connection

**Purpose:** Neo4j driver initialization and session management

**Key Functions:**
- `get_neo4j_session()` - FastAPI dependency that yields a Neo4j session (request-scoped, auto-closes)

**Features:**
- Validates NEO4J_PASSWORD is set
- Creates GraphDatabase driver with connection URI and auth
- Session generator pattern for FastAPI dependency injection

---

#### 5. `backend/services_graph.py` - Graph Operations Service

**Purpose:** Core business logic for graph operations (concepts, relationships, queries)

**Key Functions:**
- `get_concept_by_id(session, node_id)` - Get concept by node ID
- `get_concept_by_name(session, name)` - Get concept by name
- `create_concept(session, payload)` - Create new concept with auto-generated node_id (format: NXXXXXXXX)
- `update_concept(session, node_id, payload)` - Update concept properties
- `delete_concept(session, node_id)` - Delete concept
- `create_relationship(session, source_name, target_name, predicate)` - Create relationship by names
- `create_relationship_by_ids(session, source_id, target_id, predicate)` - Create relationship by IDs
- `get_neighbors(session, node_id)` - Get connected concepts
- `get_neighbors_with_relationships(session, node_id)` - Get neighbors with relationship metadata
- `get_all_concepts(session)` - Get all concepts
- `get_all_relationships(session)` - Get all relationships
- `get_nodes_missing_description(session, limit)` - Find concepts without descriptions
- `find_concept_gaps(session, limit)` - Heuristic gap detection (low connectivity, short descriptions)

**Data Normalization:**
- `_normalize_concept_from_db(record_data)` - Handles backward compatibility, ensures lecture_sources is a list

**Multi-Source Tracking:**
- Concepts track `lecture_sources` (array), `created_by`, `last_updated_by`
- Backward compatibility with deprecated `lecture_key` field

---

#### 6. `backend/api_concepts.py` - Concepts API Router

**Purpose:** FastAPI router for concept CRUD and graph queries

**Endpoints:**
- `GET /concepts/missing-descriptions` - Concepts missing descriptions
- `GET /concepts/gaps` - Knowledge gaps
- `GET /concepts/search?q=...` - Search concepts by name
- `GET /concepts/all/graph` - Get all nodes and relationships
- `GET /concepts/by-name/{name}` - Get concept by name
- `GET /concepts/{node_id}` - Get concept by ID
- `GET /concepts/{node_id}/neighbors` - Get neighbors
- `GET /concepts/{node_id}/neighbors-with-relationships` - Get neighbors with relationship types
- `POST /concepts/` - Create concept
- `PUT /concepts/{node_id}` - Update concept
- `DELETE /concepts/{node_id}` - Delete concept
- `POST /concepts/relationship` - Create relationship by names
- `POST /concepts/relationship-by-ids` - Create relationship by IDs
- `DELETE /concepts/relationship` - Delete relationship
- `POST /concepts/cleanup-test-data` - Cleanup test data

**Pattern:** All endpoints use `session=Depends(get_neo4j_session)` for database access

---

#### 7. `backend/services_lecture_ingestion.py` - Lecture Ingestion Service

**Purpose:** Extract concepts and relationships from lecture text using LLM

**Key Functions:**
- `ingest_lecture(session, lecture_title, lecture_text, domain)` - Main ingestion function
  - Calls OpenAI GPT to extract nodes and links from lecture text
  - Uses `LECTURE_TO_GRAPH_PROMPT` for extraction
  - Uses `LECTURE_SEGMENTATION_PROMPT` for segmentation
  - Upserts concepts (creates new or updates existing by name+domain)
  - Creates relationships
  - Creates lecture segments with analogies
  - Returns `LectureIngestResult` with created/updated nodes, links, segments

**Concept Matching:**
- `find_concept_by_name_and_domain(session, name, domain)` - Find existing concept
- `normalize_name(name)` - Normalize for comparison (lowercase, strip)
- `update_concept_description_if_better(session, concept, new_description)` - Update only if new description is longer

**LLM Integration:**
- Uses OpenAI client initialized from `OPENAI_API_KEY`
- Extracts nodes with: name, description, domain, type, examples, tags
- Extracts links with: source_name, target_name, predicate, explanation, confidence
- Segments lecture into logical segments with style tags and analogies

---

#### 8. `backend/api_lectures.py` - Lectures API Router

**Purpose:** FastAPI router for lecture management

**Endpoints:**
- `POST /lectures/ingest` - Ingest lecture text (extract concepts using LLM)
- `POST /lectures/` - Create lecture manually
- `GET /lectures/{lecture_id}` - Get lecture metadata
- `POST /lectures/{lecture_id}/steps` - Add step to lecture
- `GET /lectures/{lecture_id}/steps` - Get lecture steps
- `GET /lectures/{lecture_id}/segments` - Get lecture segments
- `GET /lectures/segments/by-concept/{concept_name}` - Get segments covering a concept
- `POST /lectures/draft-next` - Generate follow-up lecture outline

**Pattern:** Uses `services_lecture_ingestion.ingest_lecture()` for LLM extraction

---

#### 9. `backend/services_search.py` - Semantic Search Service

**Purpose:** Semantic search using OpenAI embeddings

**Key Functions:**
- `semantic_search_nodes(query, session, limit)` - Semantic search over concepts
  - Embeds query using OpenAI `text-embedding-3-small`
  - Embeds all concepts (with caching)
  - Computes cosine similarity
  - Returns top N matches with scores

**Caching:**
- `EMBEDDINGS_CACHE_FILE` - JSON file cache for embeddings
- `_embedding_cache` - In-memory cache
- `_compute_text_hash(node_text)` - Hash to detect changes
- Caches embeddings by node_id with text hash for invalidation

**Fallback:**
- If OpenAI unavailable, falls back to simple name matching

---

#### 10. `backend/api_ai.py` - AI API Router

**Purpose:** FastAPI router for AI features

**Endpoints:**
- `POST /ai/chat` - AI chat (stub, currently just echoes)
- `POST /ai/semantic-search` - Semantic search endpoint
  - Uses `services_search.semantic_search_nodes()`
  - Returns nodes and scores

**Note:** Main chat functionality is in frontend API route (`frontend/app/api/brain-web/chat/route.ts`)

---

#### 11. `backend/prompts.py` - LLM Prompt Templates

**Purpose:** System prompts for OpenAI LLM calls

**Key Prompts:**
- `LECTURE_TO_GRAPH_PROMPT` - Extract concepts and relationships from lecture text
  - Returns JSON with nodes and links
  - Specifies node properties (name, description, domain, type, examples, tags)
  - Specifies link properties (source_name, target_name, predicate, explanation, confidence)
  
- `BRAIN_WEB_CHAT_SYSTEM_PROMPT` - System prompt for chat responses
  - Defines user's voice/style
  - Instructions to use graph context first
  - Format: ANSWER, SUGGESTED_ACTIONS, FOLLOW_UP_QUESTIONS

- `LECTURE_SEGMENTATION_PROMPT` - Break lecture into segments and extract analogies
  - Returns JSON with segments (text, summary, style_tags, covered_concepts, analogies)
  - Extracts analogies with label, description, target_concepts

---

#### 12. `backend/api_preferences.py` - Preferences API Router

**Purpose:** User personalization endpoints

**Endpoints:**
- `GET /preferences/response-style` - Get response style profile
- `POST /preferences/response-style` - Update response style
- `GET /preferences/focus-areas` - Get all focus areas
- `POST /preferences/focus-areas` - Create/update focus area
- `POST /preferences/focus-areas/{focus_id}/active` - Toggle focus area active status
- `GET /preferences/user-profile` - Get user profile
- `POST /preferences/user-profile` - Update user profile

**Storage:** Uses Neo4j Meta nodes for storing preferences

---

#### 13. `backend/api_notion.py` - Notion Integration API Router

**Purpose:** Notion sync and management endpoints

**Endpoints:**
- `GET /notion/summary` - Get Notion pages summary
- `POST /notion/ingest-pages` - Ingest specific pages
- `POST /notion/ingest-all` - Ingest all pages
- `GET /admin/notion/pages` - List pages with indexing status
- `POST /admin/notion/pages/index` - Select/deselect pages for indexing
- `POST /admin/notion/unlink-page` - Remove page from graph
- `GET /admin/notion/index-state` - Get indexing state
- `GET /admin/notion/sync-history` - Get sync history
- `GET /admin/notion-config` - Get Notion configuration
- `POST /admin/notion-config` - Update Notion configuration

**Integration:**
- Uses `notion_wrapper.py` for Notion API calls
- Uses `notion_sync.py` for background sync
- Uses `notion_index_state.py` for page indexing management

---

#### 14. `backend/services_resources.py` - Resource Management Service

**Purpose:** File upload and resource linking

**Key Functions:**
- `upload_resource(session, file, concept_id, title)` - Upload file and create resource node
- `get_resources_for_concept(session, concept_id)` - Get all resources for a concept
- `link_resource_to_concept(session, resource_id, concept_id)` - Link resource to concept

**File Storage:**
- Files saved to `uploaded_resources/` directory
- Served at `/static/resources/{filename}` via FastAPI StaticFiles

---

#### 15. `backend/services_resource_ai.py` - AI-Powered Resource Processing

**Purpose:** Automatic captioning and analysis of uploaded resources

**Key Functions:**
- `generate_image_caption(image_path)` - GPT-4 Vision caption generation
- `extract_pdf_text(pdf_path)` - PDF text extraction
- `summarize_pdf_text(text)` - PDF summarization

---

#### 16. `backend/teaching_style_extractor.py` - Teaching Style Extraction

**Purpose:** Extract teaching style from user's lectures

**Key Functions:**
- `extract_teaching_style_from_lectures(session, num_lectures)` - Analyze recent lectures
  - Gets N most recent lectures
  - Extracts segments and analogies
  - Uses LLM to analyze style patterns
  - Returns `TeachingStyleProfile` with tone, teaching_style, sentence_structure, explanation_order, forbidden_styles

---

#### 17. `backend/source_interface.py` - Multi-Source Abstraction

**Purpose:** Abstract interface for different knowledge sources

**Key Classes:**
- `SourceInterface` - Abstract base class for sources
- `LectureSource` - Implementation for lecture sources
- `NotionSource` - Implementation for Notion sources

**Features:**
- Tracks source attribution on concepts
- Supports multiple sources per concept
- Handles source metadata

---

### Frontend Core Files

#### 18. `frontend/app/api-client.ts` - Backend API Client

**Purpose:** TypeScript client for all backend API calls

**Key Functions:**
- `getConcept(nodeId)` - Get concept by ID
- `getConceptByName(name)` - Get concept by name
- `updateConcept(nodeId, updates)` - Update concept
- `getNeighbors(nodeId)` - Get neighbors
- `getNeighborsWithRelationships(nodeId)` - Get neighbors with relationship types
- `fetchGraphData(rootNodeId, maxDepth)` - Recursively fetch graph starting from root
- `getAllGraphData()` - Get all nodes and relationships
- `createRelationshipByIds(sourceId, targetId, predicate)` - Create relationship
- `ingestLecture(title, text, domain)` - Ingest lecture
- `getLectureSegments(lectureId)` - Get lecture segments
- `getSegmentsByConcept(conceptName)` - Get segments covering concept
- `getResponseStyle()` - Get response style profile
- `setResponseStyle(profile)` - Update response style
- `getFocusAreas()` - Get focus areas
- `upsertFocusArea(name, description)` - Create/update focus area
- `getUserProfile()` - Get user profile
- `setUserProfile(profile)` - Update user profile
- `getTeachingStyle()` - Get teaching style profile
- `recomputeTeachingStyle(numLectures)` - Recompute from lectures
- `getResourcesForConcept(conceptId)` - Get resources
- `uploadResourceForConcept(conceptId, file, title)` - Upload resource
- `getGapsOverview(limit)` - Get knowledge gaps
- `chatWithBrainWeb(message)` - Chat with AI (via Next.js API route)

**API Base URL:** `process.env.NEXT_PUBLIC_API_URL || 'http://127.0.0.1:8000'`

---

#### 19. `frontend/app/components/GraphVisualization.tsx` - Main Graph Component

**Purpose:** Interactive graph visualization with chat, commands, and node management

**Key Features:**
- **Force-Directed Graph:** Uses `react-force-graph-2d` for visualization
- **Domain-Based Coloring:** Each domain gets unique color from palette
- **Node Interactions:**
  - Click to select/focus
  - Hover to highlight connections
  - Double-click to expand
- **Command Panel:** Text-based commands (search, select, go, link, add, delete, path, etc.)
- **Chat Panel:** Integrated chat interface with AI
- **Node Detail Panel:** Shows concept properties, neighbors, resources, lecture segments
- **Domain Filter:** Filter graph by domain
- **Graph Controls:** Adjustable physics parameters
- **Lecture Ingestion Form:** Inline form for ingesting lectures
- **Resource Management:** Upload and view resources

**State Management:**
- `nodes` - Map of node_id to Concept
- `links` - Array of relationships
- `selectedNode` - Currently selected node
- `chatMessages` - Chat history
- `commandMode` - Current command mode (link, etc.)

**Graph Physics:**
- Uses d3-force for layout
- Custom collision detection
- Adjustable link distance, node charge, collision radius

---

#### 20. `frontend/app/components/LandingPage.tsx` - Landing Page Component

**Purpose:** Welcome screen with focus area setup

**Features:**
- Personalized greeting ("Welcome Back, {name}")
- Editable focus areas textarea
- Existing focus areas as toggleable buttons
- "Save Focus" button
- "Enter Brain Web" button
- Smooth transitions

---

#### 21. `frontend/app/page.tsx` - Main Page

**Purpose:** Root page that shows LandingPage or GraphVisualization

**Logic:**
- Shows LandingPage initially
- After "Enter Brain Web", shows GraphVisualization
- Manages transition state

---

#### 22. `frontend/app/api/brain-web/chat/route.ts` - Chat API Route

**Purpose:** Next.js API route that proxies chat requests to backend + OpenAI

**Flow:**
1. Receives user message
2. Calls backend `/ai/semantic-search` to find relevant concepts
3. Fetches neighbors of relevant concepts for context
4. Builds prompt with graph context, response style, focus areas, user profile
5. Calls OpenAI GPT-4o-mini with prompt
6. Parses response (ANSWER, SUGGESTED_ACTIONS, FOLLOW_UP_QUESTIONS)
7. Stores answer in backend
8. Returns structured response

---

### Other Important Files

#### 23. `backend/notion_sync.py` - Notion Auto-Sync

**Purpose:** Background synchronization of Notion pages

**Key Functions:**
- `sync_once(force_full)` - Perform single sync cycle
  - Loads last sync timestamp
  - Finds updated pages since last sync
  - Converts pages to lectures
  - Ingests via `services_lecture_ingestion.ingest_lecture()`
  - Saves new sync timestamp

**State Management:**
- `notion_sync_state.json` - Stores last sync timestamp
- `load_last_sync_timestamp()` - Load timestamp
- `save_last_sync_timestamp(dt)` - Save timestamp

**Background Loop:**
- Runs every 5 minutes if `ENABLE_NOTION_AUTO_SYNC=true`
- Started in `main.py` lifespan context

---

#### 24. `backend/notion_wrapper.py` - Notion API Wrapper

**Purpose:** Wrapper around Notion API client

**Key Functions:**
- `get_page(page_id)` - Get page content
- `get_page_blocks(page_id)` - Get page blocks
- `get_page_title(page)` - Extract page title
- `get_page_domain(page)` - Extract domain from page properties
- `get_database_pages(database_id)` - Get all pages from database
- `extract_plaintext_from_blocks(blocks)` - Convert blocks to plain text
- `list_notion_databases()` - List all accessible databases
- `list_notion_pages()` - List all accessible pages

---

#### 25. `backend/services_lecture_draft.py` - Lecture Draft Generation

**Purpose:** Generate follow-up lecture outlines

**Key Functions:**
- `draft_next_lecture(session, seed_concepts, target_level, source_lecture_id)` - Generate outline
  - Uses teaching style profile
  - Considers graph neighbors of seed concepts
  - Returns outline with sections and suggested analogies

---

#### 26. `backend/api_gaps.py` - Knowledge Gaps API Router

**Purpose:** Gap detection endpoints

**Endpoints:**
- `GET /gaps/overview` - Comprehensive gap analysis
  - Missing descriptions
  - Low connectivity
  - High interest but low coverage

---

#### 27. `backend/services_sync.py` - CSV Sync Service

**Purpose:** Bidirectional CSV sync with Neo4j

**Key Functions:**
- `auto_export_csv(background_tasks)` - Export graph to CSV in background
- Uses `scripts/export_csv_from_neo4j.py` for export
- Auto-import on startup (in `main.py`)

**CSV Files:**
- `graph/nodes_semantic.csv` - All concepts
- `graph/edges_semantic.csv` - All relationships
- `graph/lecture_covers_*.csv` - Lecture-cover relationships

---

## 🏗️ Architecture Patterns

### Backend Architecture

**Layered Architecture:**
1. **API Layer** (`api_*.py`) - FastAPI routers, request/response handling
2. **Service Layer** (`services_*.py`) - Business logic, database operations
3. **Data Layer** (`db_neo4j.py`, `models.py`) - Database connection, data models

**Dependency Injection:**
- FastAPI `Depends(get_neo4j_session)` for database sessions
- Request-scoped sessions (auto-close after request)

**Error Handling:**
- Centralized exception handlers in `main.py`
- HTTP exceptions with appropriate status codes
- Sanitized error messages (don't leak internal details)

**Background Tasks:**
- FastAPI `BackgroundTasks` for async operations (CSV export)
- AsyncIO tasks for long-running loops (Notion sync)

### Frontend Architecture

**Next.js App Router:**
- `app/` directory structure
- Server and client components
- API routes for proxying/processing

**Component Structure:**
- `components/` - Reusable React components
- `[routes]/` - Next.js pages
- `api/` - Next.js API routes

**State Management:**
- React hooks (useState, useEffect, useCallback)
- No external state management library

**API Communication:**
- Centralized `api-client.ts` for all backend calls
- TypeScript interfaces for type safety
- Error handling with try/catch

### Data Flow

**Lecture Ingestion Flow:**
1. User submits lecture text via frontend
2. Frontend calls `POST /lectures/ingest`
3. Backend calls `services_lecture_ingestion.ingest_lecture()`
4. Service calls OpenAI GPT to extract concepts/relationships
5. Service upserts concepts and creates relationships in Neo4j
6. Service creates lecture segments with analogies
7. Background task exports to CSV
8. Response returned to frontend

**Chat Flow:**
1. User asks question in frontend
2. Frontend calls `frontend/app/api/brain-web/chat/route.ts`
3. Next.js route calls backend `/ai/semantic-search` for relevant concepts
4. Next.js route fetches neighbors for context
5. Next.js route builds prompt with graph context, style, profile
6. Next.js route calls OpenAI GPT-4o-mini
7. Next.js route parses response and stores answer
8. Response returned to frontend

**Graph Visualization Flow:**
1. Frontend loads initial graph data (`getAllGraphData()` or `fetchGraphData()`)
2. User clicks node → fetch neighbors
3. User asks question → semantic search → chat
4. User creates relationship → `createRelationshipByIds()`
5. Graph updates in real-time

---

## 🔧 Key Technologies

### Backend
- **FastAPI** - Web framework
- **Neo4j** - Graph database
- **OpenAI API** - LLM (GPT-4o-mini, text-embedding-3-small, GPT-4 Vision)
- **Pydantic** - Data validation
- **python-dotenv** - Environment variables
- **notion-client** - Notion API
- **pytest** - Testing

### Frontend
- **Next.js 14** - React framework (App Router)
- **React 18** - UI library
- **TypeScript** - Type safety
- **react-force-graph-2d** - Graph visualization
- **d3-force** - Graph physics

---

## 📊 Data Models Summary

### Neo4j Node Types
- `Concept` - Knowledge concepts
- `Lecture` - Lecture metadata
- `LectureSegment` - Lecture segments
- `Analogy` - Teaching analogies
- `FocusArea` - Current focus areas
- `Resource` - Files/images/links
- `Meta` - Configuration/preferences
- `Feedback` - Answer feedback
- `Answer` - Stored answers
- `Revision` - User-rewritten answers
- `UserProfile` - User profile
- `NotionConfig` - Notion configuration

### Neo4j Relationship Types
- `RELATED_TO` - General relationship
- `DEPENDS_ON` - Dependency
- `PREREQUISITE_FOR` - Prerequisite
- `HAS_COMPONENT` - Component relationship
- `COVERS` - Lecture covers concept
- `HAS_SEGMENT` - Lecture has segment
- `COVERS_CONCEPT` - Segment covers concept
- `USES_ANALOGY` - Segment uses analogy
- `HAS_RESOURCE` - Concept has resource

---

## 🎯 What to Extract for Similar Project

### Core Graph Infrastructure
- `backend/db_neo4j.py` - Database connection pattern
- `backend/services_graph.py` - Graph CRUD operations
- `backend/models.py` - Concept and relationship models
- `backend/api_concepts.py` - Graph API endpoints

### LLM Integration
- `backend/services_lecture_ingestion.py` - LLM extraction pattern
- `backend/prompts.py` - Prompt engineering
- `backend/services_search.py` - Semantic search with embeddings
- `backend/services_resource_ai.py` - Multi-modal AI processing

### Frontend Graph Visualization
- `frontend/app/components/GraphVisualization.tsx` - Complete graph UI
- `frontend/app/api-client.ts` - API client pattern
- Graph physics and interaction patterns

### Personalization System
- `backend/api_preferences.py` - Preferences API
- `backend/services_graph.py` - Preference storage (Meta nodes)
- Response style and user profile models

### Multi-Source Architecture
- `backend/source_interface.py` - Source abstraction
- Multi-source tracking on concepts
- Source-specific ingestion logic

### Integration Patterns
- `backend/notion_wrapper.py` - External API integration pattern
- `backend/notion_sync.py` - Background sync pattern
- `backend/services_sync.py` - CSV backup/sync pattern

### Testing Infrastructure
- `backend/tests/` - Test suite structure
- `backend/tests_manifest.py` - Test organization
- `backend/api_tests.py` - Test UI endpoint

---

## 📝 Notes for Extraction

1. **Database Layer:** The Neo4j connection pattern with FastAPI dependencies is reusable
2. **LLM Integration:** The prompt engineering and extraction patterns can be adapted
3. **Graph Visualization:** The react-force-graph-2d setup is complete and reusable
4. **API Structure:** The FastAPI router pattern is consistent across all modules
5. **Error Handling:** Centralized error handling in `main.py` is a good pattern
6. **State Management:** Frontend uses React hooks - no external state library needed
7. **Type Safety:** TypeScript interfaces match Pydantic models for consistency

---

*This document provides a complete overview of the codebase structure and key files. Use this to understand what to extract for a similar project.*
