# 🧠 Brain Web

<div align="center">

**An AI-powered knowledge graph system for visualizing, exploring, and expanding your understanding of interconnected concepts.**

[![Status](https://img.shields.io/badge/status-active%20development-brightgreen)]()
[![Version](https://img.shields.io/badge/version-0.1.0-blue)]()
[![License](https://img.shields.io/badge/license-MIT-green)]()
[![Demo](https://img.shields.io/badge/demo-live-orange)](https://demo.sanjayanasuri.com)

[Live Demo](https://demo.sanjayanasuri.com) • [Documentation](#-documentation) • [Quick Start](#-quick-start) • [Features](#-features)

</div>

---

## 📖 Overview

Brain Web is a **standalone, production-ready** knowledge management system that transforms how you organize, visualize, and interact with information. Inspired by Notion's "Everything is a block" philosophy, it treats knowledge as interconnected blocks that can be explored, connected, and visualized in multiple ways.

### What Makes Brain Web Unique?

- 🕸️ **Interactive Knowledge Graph**: Real-time 2D force-directed graph visualization
- 🤖 **AI-Powered Intelligence**: GPT-4o-mini powered chat with semantic search
- 📚 **Automatic Concept Extraction**: LLM-powered extraction from lectures and documents
- 🔗 **Notion Integration**: Seamless sync with your Notion workspace
- 🎨 **Personalized Learning**: Customizable teaching styles and learning preferences
- 📊 **Gap Detection**: AI identifies knowledge gaps and suggests improvements
- 🚀 **Production Ready**: Fully deployed with CI/CD, infrastructure as code, and monitoring

---

## 🏗️ System Architecture

### High-Level Architecture

```
┌─────────────────┐         ┌─────────────────┐         ┌─────────────────┐
│   Frontend      │         │    Backend      │         │   Database      │
│   (Next.js)     │◄───────►│   (FastAPI)     │◄───────►│   (Neo4j)       │
│   Vercel        │   REST  │   AWS ECS       │  Bolt   │   Neo4j Aura    │
└─────────────────┘         └─────────────────┘         └─────────────────┘
        │                           │                           │
        │                           │                           │
        └───────────────────────────┴───────────────────────────┘
                              │
                    ┌─────────▼─────────┐
                    │   OpenAI API      │
                    │   (GPT-4o-mini)  │
                    └──────────────────┘
```

### Request Flow

1. **User Interaction** → Frontend (Next.js/React)
2. **API Call** → Next.js API routes (optional proxy) or direct to backend
3. **Backend Processing** → FastAPI endpoints
4. **Database Query** → Neo4j via Bolt protocol
5. **AI Processing** → OpenAI API (for chat, embeddings, extraction)
6. **Response** → JSON data back to frontend
7. **UI Update** → React state management and re-rendering

### Data Flow

**Graph Data Flow:**
- Neo4j stores nodes (Concept) and relationships (typed edges)
- Backend queries Neo4j using Cypher queries
- Data transformed to GraphData format (nodes + links)
- Frontend receives JSON and renders with react-force-graph-2d
- D3-force physics engine calculates node positions

**AI Processing Flow:**
- User submits lecture text or chat message
- Backend sends to OpenAI API (GPT-4o-mini or embeddings)
- LLM extracts concepts/relationships or generates response
- Results stored in Neo4j (for lectures) or returned to user (for chat)
- Frontend displays results in UI

---

## 🛠️ Technology Stack

### Frontend Stack

| Technology | Version | Purpose |
|------------|---------|---------|
| **Next.js** | 14.x | React framework with App Router, SSR, API routes |
| **React** | 18.2 | UI library with hooks and context |
| **TypeScript** | 5.0+ | Type-safe JavaScript |
| **react-force-graph-2d** | 1.25.3 | Interactive graph visualization |
| **d3-force** | 3.0.0 | Physics simulation for graph layout |
| **@tanstack/react-query** | 5.59.0 | Data fetching, caching, synchronization |
| **TipTap** | 3.14.0 | Rich text editor for lecture/content editing |
| **CSS Modules** | - | Scoped styling with CSS variables |

**Key Frontend Libraries:**
- `html2canvas` + `jspdf`: Export graph as PDF/image
- `markdown-it`: Markdown parsing
- `idb`: IndexedDB for offline storage
- `react-syntax-highlighter`: Code syntax highlighting

### Backend Stack

| Technology | Version | Purpose |
|------------|---------|---------|
| **FastAPI** | 0.104.1 | High-performance async Python web framework |
| **Python** | 3.11+ | Backend language |
| **Neo4j** | 5.14.1 | Graph database driver (Bolt protocol) |
| **Pydantic** | 2.5.0 | Data validation and serialization |
| **OpenAI** | 1.3.0 | GPT-4o-mini API, embeddings (text-embedding-3-small) |
| **Uvicorn** | 0.24.0 | ASGI server for FastAPI |
| **pytest** | 7.4.3 | Testing framework |

**Additional Backend Libraries:**
- `notion-client`: Notion API integration
- `boto3`: AWS services (S3, Parameter Store)
- `scikit-learn`: ML utilities for similarity
- `python-igraph` + `leidenalg`: Graph analysis algorithms
- `qdrant-client`: Vector database for semantic search
- `psycopg2-binary`: PostgreSQL driver (event store)
- `redis`: Caching layer
- `PyPDF2`: PDF processing
- `beautifulsoup4`: HTML parsing for web ingestion

### Infrastructure Stack

| Service | Purpose |
|---------|---------|
| **AWS ECS Fargate** | Container orchestration (serverless) |
| **AWS ECR** | Docker container registry |
| **AWS VPC** | Network isolation (public/private subnets) |
| **AWS ALB** | Application Load Balancer with health checks |
| **AWS Route53** | DNS management |
| **AWS Systems Manager** | Secrets management (Parameter Store) |
| **AWS CloudWatch** | Logging and monitoring |
| **Terraform** | Infrastructure as Code |
| **Vercel** | Frontend hosting (edge network, CDN) |
| **Neo4j Aura** | Managed Neo4j cloud database |
| **GitHub Actions** | CI/CD pipelines |

---

## 📁 File Organization

### Root Directory Structure

```
brain-web/
├── backend/              # FastAPI backend application
│   ├── api_*.py         # API route handlers (30+ files)
│   ├── services_*.py    # Business logic services (40+ files)
│   ├── models.py        # Pydantic data models
│   ├── db_neo4j.py      # Neo4j database connection
│   ├── config.py        # Configuration management
│   ├── main.py          # FastAPI app entry point
│   ├── requirements.txt # Python dependencies
│   ├── Dockerfile       # Container image definition
│   ├── tests/           # pytest test suite
│   ├── connectors/      # External service connectors
│   ├── events/          # Event sourcing system
│   ├── projectors/      # Event projection handlers
│   ├── utils/           # Utility functions
│   └── verticals/       # Domain-specific modules
│
├── frontend/            # Next.js frontend application
│   ├── app/             # Next.js App Router pages
│   │   ├── page.tsx     # Home page
│   │   ├── components/  # React components
│   │   │   ├── graph/   # Graph visualization components
│   │   │   ├── lecture-editor/  # Lecture editing UI
│   │   │   ├── dashboard/       # Dashboard components
│   │   │   └── ...
│   │   ├── api/         # Next.js API routes (proxies)
│   │   ├── hooks/       # Custom React hooks
│   │   ├── lib/         # Client-side libraries
│   │   └── utils/       # Utility functions
│   ├── components/      # Shared components
│   ├── lib/             # TypeScript libraries
│   ├── public/          # Static assets
│   ├── package.json     # Node.js dependencies
│   └── next.config.js   # Next.js configuration
│
├── infra/               # Infrastructure as Code
│   └── envs/
│       └── demo/        # Terraform configs for demo environment
│           ├── main.tf  # Main infrastructure resources
│           ├── variables.tf
│           ├── outputs.tf
│           └── ...
│
├── browser-extension/   # Chrome extension for web capture
│   ├── manifest.json
│   ├── background.js
│   ├── contentScript.js
│   └── popup.html
│
├── scripts/            # Utility scripts
│   ├── *.sh            # Shell scripts
│   └── *.py            # Python scripts
│
├── docs/               # Documentation
│   ├── ARCHITECTURE.md
│   ├── FEATURES.md
│   ├── QUICKSTART.md
│   └── ...
│
├── graph/              # CSV export/import files
│   ├── nodes_*.csv
│   └── edges_*.csv
│
├── .github/
│   └── workflows/      # GitHub Actions CI/CD
│       ├── backend-deploy.yml
│       └── frontend-amplify-deploy.yml
│
├── docker-compose.yml  # Local development services
├── Makefile            # Common development commands
└── README.md           # This file
```

### Backend File Organization

**API Routes (`backend/api_*.py`):**
- `api_concepts.py`: Concept CRUD operations
- `api_lectures.py`: Lecture ingestion and management
- `api_ai.py`: AI chat and retrieval endpoints
- `api_graphs.py`: Graph operations (list, create, select)
- `api_branches.py`: Branch explorer functionality
- `api_snapshots.py`: Graph snapshot management
- `api_notion.py`: Notion synchronization
- `api_resources.py`: File upload and resource management
- `api_gaps.py`: Knowledge gap detection
- `api_preferences.py`: User preferences
- `api_teaching_style.py`: Teaching style analysis
- `api_feedback.py`: User feedback collection
- `api_retrieval.py`: Semantic search and retrieval
- `api_events.py`: Event tracking
- `api_dashboard.py`: Study analytics
- `api_exams.py`: Exam/test functionality
- `api_workflows.py`: Unified workflow system
- `api_voice.py`: Voice command processing
- `api_signals.py`: Learning state signals
- `api_offline.py`: Offline mode support
- `api_sync.py`: Data synchronization
- `api_quotes.py`: Evidence graph quotes
- `api_claims_from_quotes.py`: Claim extraction
- `api_web_ingestion.py`: Web content ingestion
- `api_finance.py`: Finance domain features
- `api_finance_ingestion.py`: Finance data ingestion
- `api_paths.py`: Learning path generation
- `api_quality.py`: Content quality metrics
- `api_trails.py`: Learning trails
- `api_extend.py`: Extension system
- `api_connectors.py`: External connector management
- `api_ingestion_runs.py`: Ingestion run tracking
- `api_sessions_events.py`: Session event tracking
- `api_sessions_websocket.py`: WebSocket sessions
- `api_admin.py`: Admin operations
- `api_debug.py`: Debug endpoints
- `api_tests.py`: Test endpoints
- `api_mentions.py`: Concept mention tracking

**Services (`backend/services_*.py`):**
- `services_graph.py`: Core graph operations
- `services_lecture_ingestion.py`: LLM-powered lecture processing
- `services_lectures.py`: Lecture management
- `services_notion.py`: Notion API integration
- `services_teaching_style.py`: Teaching pattern extraction
- `services_retrieval.py`: Semantic search implementation
- `services_search_qdrant.py`: Vector search with Qdrant
- `services_resources.py`: File storage (local/S3)
- `services_ai.py`: OpenAI API wrapper
- `services_branches.py`: Branch management logic
- `services_snapshots.py`: Snapshot operations
- `services_gaps.py`: Gap detection algorithms
- `services_quality.py`: Quality scoring
- `services_finance_ingestion.py`: Finance data processing
- `services_finance_acquisition.py`: Finance data fetching
- `services_web_ingestion.py`: Web scraping and ingestion
- `services_entity_resolution.py`: Entity matching
- `services_evidence_snapshots.py`: Evidence graph snapshots
- `services_task_queue.py`: Background task processing
- `services_task_processor.py`: Task execution
- `services_study_analytics.py`: Learning analytics
- `services_retrieval_plans.py`: Retrieval strategy planning
- `services_retrieval_signals.py`: Retrieval signal processing
- `services_retrieval_helpers.py`: Retrieval utilities
- `services_style_learning.py`: Style pattern learning
- `services_sync.py`: Data sync logic
- `services_sync_capture.py`: Capture sync
- `services_sources.py`: Source management
- `services_logging.py`: Structured logging
- `services_lecture_blocks.py`: Lecture block processing
- `services_lecture_draft.py`: Draft management
- `services_lecture_mentions.py`: Mention extraction
- `services_branch_ai.py`: Branch AI operations
- `services_branch_explorer.py`: Branch exploration
- `services_browser_use.py`: Browser automation
- `services_claims.py`: Claim processing
- `services_extend.py`: Extension system
- `services_graphrag.py`: GraphRAG implementation
- `services_ingestion_kernel.py`: Ingestion core
- `services_ingestion_runs.py`: Run tracking
- `services_intent_router.py`: Intent routing
- `services_llm_recommendations.py`: LLM recommendations
- `services_research_memo.py`: Research memo generation
- `services_resource_ai.py`: Resource AI processing
- `services_signals.py`: Signal processing
- `services_trails.py`: Trail management
- `services_community_build.py`: Community features

**Core Files:**
- `main.py`: FastAPI app initialization, middleware, route registration
- `models.py`: Pydantic models for all data structures
- `db_neo4j.py`: Neo4j driver and session management
- `config.py`: Environment variable loading and configuration
- `auth.py`: Authentication middleware
- `storage.py`: File storage abstraction (local/S3)
- `prompts.py`: LLM prompt templates
- `cache_utils.py`: Caching utilities
- `pagination.py`: Pagination helpers

### Frontend File Organization

**Pages (`frontend/app/`):**
- `page.tsx`: Home page with graph visualization
- `dashboard/page.tsx`: Study dashboard
- `lecture-editor/page.tsx`: Lecture editing interface
- `lecture-studio/page.tsx`: Lecture studio
- `concepts/[id]/page.tsx`: Concept detail page
- `graphs/[graph_id]/page.tsx`: Graph detail view
- `notion-admin/page.tsx`: Notion sync management
- `notion-import/page.tsx`: Notion import UI
- `gaps/page.tsx`: Knowledge gaps view
- `review/page.tsx`: Review interface
- `saved/page.tsx`: Saved items
- `history/page.tsx`: History view
- `digest/page.tsx`: Digest view
- `ingest/page.tsx`: Content ingestion
- `control-panel/page.tsx`: Control panel
- `profile-customization/page.tsx`: User profile
- `source-management/page.tsx`: Source management
- `offline-settings/page.tsx`: Offline configuration
- `reader/page.tsx`: Content reader
- `mobile/page.tsx`: Mobile-optimized view
- `tests/page.tsx`: Test UI

**Components (`frontend/app/components/`):**
- `graph/`: Graph visualization components
  - `GraphVisualization.tsx`: Main graph component (4000+ lines)
  - `GraphContext.tsx`: Graph state management
  - `GraphMiniMap.tsx`: Mini map overlay
  - `ExplorerToolbar.tsx`: Graph controls
  - `hooks/`: Graph-specific hooks
  - `plugins/`: Graph plugins (lecture, etc.)
- `lecture-editor/`: Lecture editing UI
  - `LectureEditor.tsx`: Main editor (1400+ lines)
  - `ConceptPanel.tsx`: Concept management panel
  - `SegmentEditor.tsx`: Segment editing
- `dashboard/`: Dashboard components
- `context/`: Context panel for selected nodes
- `navigation/`: Navigation components
- `topbar/`: Top navigation bar
- `ui/`: Reusable UI components
- `voice/`: Voice command UI
- `finance/`: Finance domain UI
- `mobile/`: Mobile-specific components
- `notion/`: Notion integration UI
- `offline/`: Offline mode UI
- `trails/`: Learning trail UI

**Libraries (`frontend/app/lib/`):**
- `api-client.ts`: TypeScript API client (2000+ lines)
- `chatSessions.ts`: Chat session management
- `eventsClient.ts`: Event tracking client
- `evidenceFetch.ts`: Evidence retrieval
- `homeNarrative.ts`: Home page narrative
- `observations.ts`: Observation tracking
- `reminders.ts`: Reminder system
- `savedItems.ts`: Saved items management
- `sessionState.ts`: Session state
- `suggestionPrefs.ts`: Suggestion preferences
- `timeTracking.ts`: Time tracking
- `trailState.ts`: Trail state management
- `useTimeTracking.ts`: Time tracking hook

**Hooks (`frontend/app/hooks/`):**
- `useEvidenceNavigation.ts`: Evidence navigation
- `useVoiceRecognition.ts`: Voice recognition

**Utils (`frontend/app/utils/`):**
- `colorUtils.ts`: Color utilities
- `confidence.ts`: Confidence calculations
- `financeSnapshot.ts`: Finance snapshot utilities
- `financeStaleness.ts`: Staleness detection
- `freshness.ts`: Freshness calculations

---

## 🔧 How Things Work

### Graph Visualization

**How the Graph Renders:**
1. **Data Fetching**: Frontend calls `GET /graphs/{graph_id}/overview` or `GET /concepts/all/graph`
2. **Data Format**: Backend returns `GraphData` with `nodes[]` and `links[]`
3. **State Management**: React Context (`GraphContext`) stores graph data
4. **Physics Simulation**: `react-force-graph-2d` uses D3-force for layout:
   - `forceLink`: Connects related nodes
   - `forceManyBody`: Repulsion between nodes
   - `forceCollide`: Prevents node overlap
   - `forceCenter`: Centers graph in viewport
5. **Rendering**: Canvas-based rendering with 60fps updates
6. **Interactions**: Click handlers update selected node, trigger neighbor expansion

**Node Expansion:**
- User clicks node → `GET /concepts/{node_id}/neighbors`
- Backend queries Neo4j: `MATCH (n)-[r]-(neighbor) WHERE n.node_id = $id RETURN neighbor, r`
- New nodes added to graph data
- Physics simulation re-runs with new nodes

**Domain Filtering:**
- User selects domains → Filter `nodes[]` and `links[]` by `node.domain`
- Re-render graph with filtered data
- Maintains physics simulation state

### Lecture Ingestion

**How Lecture Ingestion Works:**
1. **User Input**: User submits lecture title and text via UI
2. **API Call**: `POST /lectures/ingest` with `{title, text, domain?}`
3. **LLM Processing**: Backend sends to OpenAI GPT-4o-mini with prompt:
   ```
   Extract concepts and relationships from this lecture.
   Return JSON with:
   - concepts: [{name, description, domain, type, examples, tags}]
   - relationships: [{source, target, predicate, explanation, confidence}]
   ```
4. **Entity Resolution**: For each extracted concept:
   - Check if concept exists: `MATCH (c:Concept) WHERE c.name = $name AND c.domain = $domain`
   - If exists: Update if new description is longer
   - If not: Create new concept node
5. **Relationship Creation**: For each relationship:
   - Find source and target nodes
   - Create relationship: `CREATE (source)-[:RELATED_TO {predicate: $pred}]->(target)`
6. **Segmentation**: LLM breaks lecture into segments with:
   - Segment text, summary, style_tags, covered_concepts, analogies
7. **Response**: Returns `{lecture_id, nodes_created, nodes_updated, links_created, segments}`

**Smart Matching:**
- Concepts matched by `name` (case-insensitive) and optionally `domain`
- Aliases support: Concept can have multiple names
- Confidence scoring: Relationships include confidence scores

### AI Chat

**How AI Chat Works:**
1. **User Message**: User types question in chat UI
2. **Context Retrieval**: Backend retrieves relevant concepts:
   - Semantic search: Query Qdrant vector DB with user message embedding
   - Graph traversal: Find related concepts from selected node
   - Evidence gathering: Collect quotes, claims, resources
3. **Prompt Construction**: Build prompt with:
   - User question
   - Retrieved context (concepts, relationships, evidence)
   - Teaching style preferences
   - Focus areas
4. **LLM Call**: Send to GPT-4o-mini with system prompt
5. **Response Streaming**: Stream response tokens to frontend
6. **Evidence Highlighting**: Mark concepts/relationships used in answer
7. **Feedback Loop**: User can provide feedback → stored for learning

**Semantic Search:**
- User query → OpenAI embedding (text-embedding-3-small)
- Vector similarity search in Qdrant
- Returns top-K similar concepts
- Used for context retrieval in chat

### Notion Synchronization

**How Notion Sync Works:**
1. **Configuration**: User provides Notion API key and database IDs
2. **Page Discovery**: Backend queries Notion API for all pages in databases
3. **Page Indexing**: For each page:
   - Fetch page content (markdown)
   - Extract title, content, metadata
   - Store in local index (`notion_page_index.json`)
4. **Concept Extraction**: Run lecture ingestion on each page
5. **Sync Tracking**: Track last sync time, page versions
6. **Auto-Sync**: Background task runs every 5 minutes (if enabled)
7. **Manual Sync**: User can trigger via `POST /notion/sync`

**Bidirectional Sync:**
- Notion → Brain Web: Automatic (via API polling)
- Brain Web → Notion: Manual (via Notion API create/update)

### Branch Explorer

**How Branches Work:**
1. **Branch Creation**: User creates branch from a node
   - New branch inherits all nodes/edges up to that point
   - Future changes scoped to branch
2. **Branch Scoping**: Nodes/edges tagged with `branch_id` property
3. **Branch Comparison**: Compare two branches:
   - Structural diff: Nodes/edges added/removed/changed
   - LLM comparison: Natural language summary of differences
4. **Branch Collapse**: Merge branches with conflict resolution
5. **Snapshots**: Save branch state at specific point in time
6. **Restore**: Restore branch to previous snapshot

**Data Model:**
- Nodes: `{node_id, name, ..., branch_id, collection_id}`
- Edges: `{source, target, predicate, ..., branch_id, collection_id}`
- Default: `branch_id = "main"`, `collection_id = "default"`

### Event Sourcing

**How Events Work:**
1. **Event Creation**: User actions create events:
   - `concept_created`, `concept_updated`, `relationship_created`
   - `lecture_ingested`, `chat_message`, `node_selected`
2. **Event Storage**: Events stored in PostgreSQL (event store)
3. **Event Projection**: Background workers project events to:
   - Neo4j (graph updates)
   - Analytics (dashboard metrics)
   - Search indices (Qdrant updates)
4. **Event Replay**: Can replay events to rebuild state
5. **Event Querying**: Query events by time, user, type

**Event Types:**
- Graph events: Concept/relationship changes
- User events: Clicks, searches, selections
- AI events: Chat messages, retrievals
- System events: Syncs, imports, exports

### Offline Mode

**How Offline Works:**
1. **Data Caching**: Frontend caches graph data in IndexedDB
2. **Service Worker**: PWA service worker for offline support
3. **Sync Queue**: Offline actions queued locally
4. **Sync on Reconnect**: When online, sync queued actions to backend
5. **Conflict Resolution**: Handle conflicts when syncing

---

## 🗄️ Database Schema

### Neo4j Graph Model

**Node Labels:**
- `Concept`: Knowledge concepts (nodes in graph)
- `Lecture`: Lecture documents
- `Resource`: Files (PDFs, images) attached to concepts
- `Segment`: Lecture segments
- `Quote`: Evidence quotes
- `Claim`: Extracted claims from quotes
- `Snapshot`: Graph snapshots
- `Branch`: Branch metadata
- `Collection`: Collection metadata

**Relationship Types:**
- `RELATED_TO`: Generic relationship (with `predicate` property)
- `DEPENDS_ON`: Dependency relationship
- `PREREQUISITE`: Prerequisite relationship
- `COVERS`: Lecture covers concept
- `HAS_SEGMENT`: Lecture has segment
- `HAS_RESOURCE`: Concept has resource
- `SUPPORTS`: Quote supports claim
- `MENTIONS`: Segment mentions concept

**Concept Node Properties:**
```cypher
{
  node_id: "N001",           // Unique identifier
  name: "Machine Learning",   // Concept name
  domain: "ai",              // Domain category
  type: "concept",           // Node type
  description: "...",        // Full description
  tags: ["ml", "ai"],       // Tags array
  notes_key: "...",         // Notes reference
  url_slug: "machine-learning", // URL-friendly name
  lecture_sources: ["L001"], // Source lectures
  created_by: "user123",     // Creator
  last_updated_by: "user123", // Last updater
  created_by_run_id: "...",  // Ingestion run ID
  aliases: ["ML", "ML algo"] // Alternative names
}
```

**Relationship Properties:**
```cypher
{
  predicate: "DEPENDS_ON",   // Relationship type
  explanation: "...",        // Why this relationship exists
  confidence: 0.95,          // Confidence score
  branch_id: "main",         // Branch scope
  collection_id: "default"   // Collection scope
}
```

### PostgreSQL Event Store

**Events Table:**
```sql
CREATE TABLE events (
  id UUID PRIMARY KEY,
  event_type VARCHAR(100),
  aggregate_id VARCHAR(100),
  event_data JSONB,
  user_id VARCHAR(100),
  session_id VARCHAR(100),
  timestamp TIMESTAMP,
  metadata JSONB
);
```

### Qdrant Vector Store

**Collection Schema:**
- Collection name: `concepts` (configurable)
- Vector dimension: 1536 (text-embedding-3-small)
- Payload: `{node_id, name, description, domain, type}`

---

## 🔌 API Endpoints

### Core Endpoints

**Concepts:**
- `GET /concepts/` - List all concepts
- `GET /concepts/{node_id}` - Get concept by ID
- `GET /concepts/by-name/{name}` - Get concept by name
- `GET /concepts/search?q={query}` - Search concepts
- `GET /concepts/{node_id}/neighbors` - Get neighbor concepts
- `POST /concepts/` - Create concept
- `POST /concepts/relationship` - Create relationship
- `DELETE /concepts/{node_id}` - Delete concept

**Lectures:**
- `GET /lectures/` - List lectures
- `GET /lectures/{lecture_id}` - Get lecture
- `POST /lectures/ingest` - Ingest lecture text
- `POST /lectures/` - Create lecture
- `GET /lectures/{lecture_id}/segments` - Get segments

**Graphs:**
- `GET /graphs/` - List graphs
- `GET /graphs/{graph_id}/overview` - Get graph overview
- `POST /graphs/` - Create graph
- `POST /graphs/{graph_id}/select` - Select active graph

**AI:**
- `POST /ai/chat` - Chat with AI (streaming)
- `POST /ai/retrieve` - Retrieve relevant concepts

**Branches:**
- `GET /branches/` - List branches
- `POST /branches/` - Create branch
- `GET /branches/{branch_id}` - Get branch
- `POST /branches/{branch_id}/compare` - Compare branches
- `POST /branches/{branch_id}/collapse` - Merge branches

**Snapshots:**
- `GET /snapshots/` - List snapshots
- `POST /snapshots/` - Create snapshot
- `POST /snapshots/{snapshot_id}/restore` - Restore snapshot

**Resources:**
- `GET /resources/search` - Search resources
- `POST /resources/upload` - Upload file
- `GET /resources/{resource_id}` - Get resource

**Notion:**
- `POST /notion/sync` - Trigger Notion sync
- `GET /notion/pages` - List Notion pages
- `GET /notion/status` - Get sync status

**Dashboard:**
- `GET /dashboard/` - Get dashboard data
- `GET /dashboard/stats` - Get statistics

**Events:**
- `POST /events` - Log event
- `GET /events/` - Query events

**Full API Documentation:**
- Interactive docs: `http://localhost:8000/docs` (Swagger UI)
- Alternative docs: `http://localhost:8000/redoc` (ReDoc)

---

## 🚀 Deployment

### Frontend Deployment (Vercel)

**Configuration:**
- Platform: Vercel Edge Network
- Build command: `cd frontend && npm run build`
- Output directory: `frontend/.next`
- Environment variables: Set in Vercel dashboard
- Domain: Custom domain with SSL (demo.sanjayanasuri.com)

**Deployment Process:**
1. Push to `main` branch
2. GitHub Actions triggers (or Vercel auto-deploy)
3. Vercel builds Next.js app
4. Deploys to edge network
5. DNS updated automatically

### Backend Deployment (AWS ECS)

**Infrastructure (Terraform):**
- VPC with public/private subnets (2 AZs)
- ECS Fargate cluster
- Application Load Balancer
- ECR repository
- CloudWatch log groups
- IAM roles and policies

**Deployment Process:**
1. Push to `main` branch (backend changes)
2. GitHub Actions workflow triggered
3. Build Docker image: `docker build -t $ECR_REPO:$SHA ./backend`
4. Push to ECR: `docker push $ECR_REPO:$SHA`
5. Update ECS task definition with new image
6. Deploy to ECS service
7. Health checks verify deployment

**CI/CD Pipeline:**
- `.github/workflows/backend-deploy.yml`: Backend deployment
- `.github/workflows/frontend-amplify-deploy.yml`: Frontend deployment
- Uses OIDC for AWS authentication (no secrets in GitHub)

**Environment Variables:**
- Stored in AWS Systems Manager Parameter Store
- Accessed by ECS tasks at runtime
- Includes: `NEO4J_URI`, `OPENAI_API_KEY`, `NOTION_API_KEY`, etc.

### Database (Neo4j Aura)

**Configuration:**
- Managed Neo4j cloud service
- Connection: Bolt protocol over TLS
- Backup: Automated daily backups
- High Availability: Multi-region replication

**Connection:**
- URI: `neo4j+s://<instance>.databases.neo4j.io`
- Authentication: Username/password
- Database: `neo4j` (default)

---

## 🧪 Testing

### Backend Tests

**Test Structure:**
- Location: `backend/tests/`
- Framework: pytest
- Coverage: 47+ tests across 8 feature areas

**Test Categories:**
1. **Graph & Concepts** (14 tests)
   - Concept CRUD operations
   - Relationship creation
   - Graph queries
2. **Lecture Ingestion** (7 tests)
   - LLM extraction
   - Entity resolution
   - Segmentation
3. **Teaching Style** (4 tests)
   - Style extraction
   - Pattern learning
4. **Preferences** (6 tests)
   - Preference storage
   - Retrieval
5. **Notion Sync** (4 tests)
   - Page indexing
   - Concept extraction
6. **Admin & Utilities** (6 tests)
   - CSV import/export
   - Health checks
7. **AI & Chat** (2 tests)
   - Chat responses
   - Retrieval
8. **Core & Internal** (4 tests)
   - Database connections
   - Configuration

**Running Tests:**
```bash
cd backend
source .venv/bin/activate
pytest                    # Run all tests
pytest -v                 # Verbose output
pytest tests/test_concepts.py  # Run specific test file
pytest -k "test_create"   # Run tests matching pattern
```

**Test Mocks:**
- Neo4j: Mocked with `unittest.mock`
- OpenAI: Mocked API responses
- Notion: Mocked API responses
- All external services mocked for fast, reliable tests

### Frontend Tests

**Test Structure:**
- Framework: Jest + React Testing Library
- E2E: Playwright

**Running Tests:**
```bash
cd frontend
npm test                  # Run Jest tests
npm run test:e2e         # Run Playwright E2E tests
npm run test:e2e:ui     # Run Playwright UI mode
```

---

## 🔐 Security

### Authentication

**Current Implementation:**
- Public endpoints: No auth required (demo mode)
- Protected endpoints: JWT token validation
- Session management: Cookie-based sessions

**Future:**
- OAuth2 integration
- Multi-user support
- Role-based access control

### Secrets Management

**Development:**
- `.env` files (not committed)
- Environment variables in shell

**Production:**
- AWS Systems Manager Parameter Store
- Encrypted at rest
- IAM-based access control

### CORS Configuration

**Allowed Origins:**
- `http://localhost:3000` (development)
- `https://demo.sanjayanasuri.com` (production)
- `https://sanjayanasuri.com` (production)
- Regex patterns for extension/localhost (dev mode)

### Rate Limiting

**Implementation:**
- Request timeout: 5 minutes (configurable)
- Neo4j query timeout: 60 seconds
- Per-endpoint rate limits (future)

---

## 📊 Monitoring & Logging

### Logging

**Backend Logging:**
- Structured JSON logs
- Log levels: INFO, WARNING, ERROR
- Request logging: Method, path, status, latency
- Error logging: Full stack traces

**Log Destinations:**
- Development: Console (stdout)
- Production: AWS CloudWatch Logs

**Log Format:**
```json
{
  "event": "request",
  "request_id": "abc123",
  "session_id": "xyz789",
  "route": "/concepts/",
  "method": "GET",
  "status": 200,
  "latency_ms": 45,
  "user_id": "user123"
}
```

### Monitoring

**Metrics:**
- Request latency
- Error rates
- Database query performance
- API endpoint usage

**Health Checks:**
- `GET /` - Root health check
- `GET /admin/status` - Detailed status
- ECS health checks (ALB)

---

## 🔄 Development Workflow

### Local Development Setup

1. **Clone Repository: `git clone <url>`
2. **Backend Setup:**
   ```bash
   cd backend
   python -m venv .venv
   source .venv/bin/activate
   pip install -r requirements.txt
   cp .env.example .env
   # Edit .env with your credentials
   ```
3. **Frontend Setup:**
   ```bash
   cd frontend
   npm install
   cp .env.example .env.local
   # Edit .env.local
   ```
4. **Start Neo4j:**
   - Local: `docker-compose up neo4j`
   - Cloud: Use Neo4j Aura (recommended)
5. **Start Backend:**
   ```bash
   cd backend
   source .venv/bin/activate
   uvicorn main:app --reload
   ```
6. **Start Frontend:**
   ```bash
   cd frontend
   npm run dev
   ```
7. **Access:**
   - Frontend: `http://localhost:3000`
   - Backend API: `http://localhost:8000`
   - API Docs: `http://localhost:8000/docs`

### Code Style

**Python:**
- Follow PEP 8
- Type hints required
- Pydantic models for data validation
- Async/await for I/O operations

**TypeScript:**
- Strict mode enabled
- ESLint configuration
- Prefer functional components with hooks
- Type safety enforced

### Git Workflow

1. Create feature branch: `git checkout -b feature/name`
2. Make changes
3. Write tests
4. Run tests: `pytest` or `npm test`
5. Commit: `git commit -m "Description"`
6. Push: `git push origin feature/name`
7. Create Pull Request
8. Code review
9. Merge to `main`
10. Auto-deploy triggers

---

## 📚 Key Concepts & Terminology

**Concept**: A node in the knowledge graph representing an idea, topic, or entity.

**Relationship**: An edge connecting two concepts with a typed predicate (e.g., DEPENDS_ON, PREREQUISITE).

**Graph**: A collection of concepts and relationships. Can have multiple graphs (e.g., "default", "demo").

**Branch**: An alternate version of a graph. Allows experimentation without affecting main branch.

**Snapshot**: A saved state of a graph at a specific point in time. Can restore to snapshots.

**Lecture**: A document or text that gets ingested to extract concepts and relationships.

**Segment**: A logical section of a lecture, automatically extracted by LLM.

**Ingestion**: The process of extracting concepts and relationships from text using LLM.

**Teaching Style**: Patterns in how concepts are explained (extracted from lectures).

**Focus Area**: Current learning themes that bias AI responses.

**Evidence**: Quotes, claims, and resources that support concepts.

**Trail**: A learning path through concepts.

**Signal**: Learning state indicators (confusion, interest, mastery).

---

## 🎯 Future Roadmap

### Short-Term (v0.2.0)
- Pathway Creator: Visual learning journey builder
- Enhanced Graph Exploration: DFS/BFS traversal modes
- Mobile Responsiveness: Full mobile support
- Performance Optimizations: Large graph rendering

### Medium-Term
- Multi-User Support: Collaboration features
- Advanced AI: Multi-modal understanding, automated linking
- Export/Import: Obsidian, Roam, Markdown formats
- 3D Visualization: Immersive 3D graph exploration

### Long-Term
- Domain-Specific Versions: Education, research, business editions
- API Marketplace: Third-party integrations
- Community Features: Public graphs, sharing
- Enterprise Features: Team workspaces, SSO, advanced analytics

---

## 🤝 Contributing

Contributions are welcome! This is an active project.

### How to Contribute

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/AmazingFeature`)
3. Make your changes
4. Add tests for new features
5. Run the test suite (`pytest` or `npm test`)
6. Commit your changes (`git commit -m 'Add some AmazingFeature'`)
7. Push to the branch (`git push origin feature/AmazingFeature`)
8. Open a Pull Request

### Development Guidelines

- Follow existing code style and patterns
- Write tests for new features
- Update documentation as needed
- Keep commits atomic and well-described
- Use type hints (Python) and TypeScript types

---

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

---

## 🙏 Acknowledgments

- Inspired by **Notion's "Everything is a block"** philosophy
- Built with modern, open-source technologies
- Powered by **OpenAI** for AI capabilities
- Graph visualization powered by **react-force-graph**
- Database powered by **Neo4j**

---

## 📞 Contact & Links

- **Live Demo**: [demo.sanjayanasuri.com](https://demo.sanjayanasuri.com)
- **GitHub Repository**: [View on GitHub](https://github.com/sanjayanasuri/brain-web)
- **Report Issues**: [GitHub Issues](https://github.com/sanjayanasuri/brain-web/issues)

---

<div align="center">

**Status**: 🟢 Active Development  
**Last Updated**: December 2024

[⬆ Back to Top](#-brain-web)

</div>
