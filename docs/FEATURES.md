# Brain Web - Complete Feature List

This document provides a comprehensive, descriptive list of every feature implemented in the Brain Web project. Use this for planning future features and understanding the current system capabilities.

---

## 1. CORE KNOWLEDGE GRAPH FEATURES

### 1.1 Concept Management
**Description**: Full CRUD operations for concepts (nodes) in the Neo4j knowledge graph.

**Features**:
- **Create Concepts**: Create new concept nodes with properties (name, domain, type, description, tags, notes_key, url_slug). Supports multi-source tracking (lecture_sources, created_by, last_updated_by). Auto-generates unique node IDs in format `NXXXXXXXX`.
- **Read Concepts**: 
  - Get concept by node_id (`GET /concepts/{node_id}`)
  - Get concept by name (`GET /concepts/by-name/{name}`)
  - Get all concepts for graph visualization (`GET /concepts/all/graph`)
  - Search concepts by query string (`GET /concepts/search`)
- **Update Concepts**: Concepts can be updated through lecture ingestion (upsert by name+domain)
- **Delete Concepts**: Delete individual concepts or cleanup test data (`DELETE /concepts/{node_id}`, `POST /concepts/cleanup-test-data`)
- **Concept Properties**: Each concept stores name, domain, type, description, tags, notes_key, lecture_key (deprecated), url_slug, and multi-source tracking fields

### 1.2 Relationship Management
**Description**: Create and manage typed relationships (edges) between concepts.

**Features**:
- **Create Relationships**: 
  - By concept names (`POST /concepts/relationship`)
  - By node IDs (`POST /concepts/relationship-by-ids`)
  - Supports typed predicates (e.g., "RELATED_TO", "DEPENDS_ON", "PREREQUISITE")
- **Read Relationships**: 
  - Get neighbors of a concept (`GET /concepts/{node_id}/neighbors`)
  - Get neighbors with relationship metadata (`GET /concepts/{node_id}/neighbors-with-relationships`)
  - All relationships included in full graph data
- **Delete Relationships**: Remove specific relationships between concepts (`DELETE /concepts/relationship`)

### 1.3 Graph Visualization
**Description**: Interactive 2D force-directed graph visualization using react-force-graph-2d.

**Features**:
- **Dynamic Graph Rendering**: Real-time force-directed layout with customizable physics (link distance, charge, collision)
- **Domain-Based Coloring**: Each domain gets a unique color from a palette; nodes colored by domain
- **Node Interactions**:
  - Click to select/focus a node
  - Hover to highlight node and its connections
  - Click background to recenter view
  - Double-click to expand/collapse (if implemented)
- **Zoom & Pan**: Full zoom and pan controls with smooth transitions
- **Domain Filtering**: Filter graph to show only selected domains
- **Focus Mode**: Center and zoom to specific nodes
- **Temporary Nodes**: Create temporary nodes that exist only in the UI (not persisted)
- **Graph Controls**: Adjustable parameters for link distance, node charge, collision radius, bubble spacing
- **Visual Styling**: Custom node rendering with domain badges, size based on connections, link styling by predicate type

### 1.4 Graph Analysis & Utilities
**Description**: Analysis tools for understanding graph structure and finding gaps.

**Features**:
- **Missing Descriptions**: Find concepts that lack descriptions (`GET /concepts/missing-descriptions`)
- **Concept Gaps**: Heuristic-based gap detection - finds concepts with short descriptions or low relationship count (`GET /concepts/gaps`)
- **Graph Export**: Export entire graph structure (nodes + relationships) for visualization
- **Neighbor Analysis**: Get all neighbors of a concept, optionally with relationship details

---

## 2. LECTURE INGESTION & MANAGEMENT

### 2.1 Lecture Ingestion (LLM-Powered)
**Description**: Extract concepts and relationships from lecture text using OpenAI LLM.

**Features**:
- **Text Ingestion**: Submit lecture title and text, system extracts:
  - Concepts (nodes) with name, description, domain, type, examples, tags
  - Relationships (links) with source, target, predicate, explanation, confidence
- **Smart Matching**: Concepts matched by name (case-insensitive) and optionally domain; existing concepts updated if new data is more detailed
- **Upsert Logic**: Creates new concepts or updates existing ones based on name matching
- **Domain Assignment**: Optional domain parameter to categorize all extracted concepts
- **Ingestion Result**: Returns detailed result with:
  - `lecture_id`: Generated unique ID (format `LXXXXXXXX`)
  - `nodes_created`: List of newly created concepts
  - `nodes_updated`: List of updated concepts
  - `links_created`: List of created relationships
  - `segments`: Lecture segments (see 2.2)

### 2.2 Lecture Segmentation & Analogies
**Description**: Break lectures into segments and extract teaching analogies.

**Features**:
- **Automatic Segmentation**: LLM breaks lecture into logical, ordered segments
  - Each segment has: text, summary, style_tags, covered_concepts, analogies
  - Segments ordered by segment_index (0-based)
  - Optional start_time_sec and end_time_sec for future audio/video support
- **Analogy Extraction**: Identifies and extracts analogies from lecture text
  - Each analogy has: label (short name), description, target_concepts, tags
  - Analogies linked to segments and concepts
- **Style Tagging**: Segments tagged with teaching style indicators:
  - "analogy-heavy", "technical", "story", "example-driven", "definition", "comparison"
- **Concept Linking**: Segments linked to concepts they cover
- **Segment Queries**:
  - Get all segments for a lecture (`GET /lectures/{lecture_id}/segments`)
  - Get segments by concept name (`GET /lectures/segments/by-concept/{concept_name}`)

### 2.3 Lecture CRUD Operations
**Description**: Manual lecture management without LLM extraction.

**Features**:
- **Create Lecture**: Create lecture node with title, description, primary_concept, level, estimated_time, slug (`POST /lectures/`)
- **Get Lecture**: Retrieve lecture by ID (`GET /lectures/{lecture_id}`)
- **Lecture Steps**: 
  - Add step to lecture (`POST /lectures/{lecture_id}/steps`) - creates COVERS relationship with step_order
  - Get lecture steps (`GET /lectures/{lecture_id}/steps`) - returns ordered steps with concept details

### 2.4 Lecture UI Components
**Description**: Frontend components for lecture management.

**Features**:
- **Lecture Ingestion Form**: Compact form in graph UI for ingesting lectures
  - Input fields for title, text, optional domain
  - Shows ingestion results (nodes created/updated, links created)
  - Auto-reloads graph after successful ingestion
- **Lecture Segments Viewer**: Component to view and browse lecture segments
  - Shows segments with text, summary, style tags
  - Displays covered concepts and analogies
  - Filter by concept or lecture

---

## 3. AI-POWERED FEATURES

### 3.1 Semantic Search
**Description**: Find concepts using OpenAI embeddings and cosine similarity.

**Features**:
- **Embedding-Based Search**: Uses OpenAI `text-embedding-3-small` model
  - Embeds user query
  - Embeds all concept nodes (with caching)
  - Computes cosine similarity scores
  - Returns top N matches with scores
- **Fallback to Name Match**: If OpenAI API key unavailable, falls back to simple name matching
- **Caching**: Node embeddings cached to avoid redundant API calls
- **Endpoint**: `POST /ai/semantic-search` with message and limit parameters

### 3.2 AI Chat System
**Description**: Natural language Q&A system powered by GPT-4o-mini with graph context.

**Features**:
- **Context-Aware Answers**: 
  - Performs semantic search to find relevant concepts
  - Fetches neighbors of relevant concepts for context
  - Builds structured prompt with graph context
- **Structured Responses**: Returns:
  - `answer`: Main answer text
  - `usedNodes`: Concepts referenced in answer
  - `suggestedQuestions`: Follow-up questions
  - `suggestedActions`: Actions user can take (link concepts, add nodes, etc.)
  - `answerId`: Unique ID for feedback tracking
- **Gap Detection Integration**: Automatically suggests questions for concepts with missing descriptions
- **Personalization Layers**: Incorporates response style, feedback, focus areas, user profile (see Section 5)
- **Answer Storage**: All answers stored with question, used nodes, timestamp for feedback and revision tracking
- **Draft Answer System**: Can generate draft answers that can be rewritten using style examples

### 3.3 Answer Rewriting & Style Examples
**Description**: Learn from user-rewritten answers to improve style.

**Features**:
- **Answer Revisions**: Users can rewrite answers; revisions stored as examples
- **Style Learning**: Recent user-rewritten answers used as style examples in future prompts
- **Example Retrieval**: `GET /answers/examples` returns recent revisions for style guidance
- **Answer Tracking**: Each answer has unique ID for linking feedback and revisions

---

## 4. NOTION INTEGRATION

### 4.1 Notion Page Ingestion
**Description**: Sync Notion pages into the knowledge graph as lectures.

**Features**:
- **Page Discovery**: 
  - List all pages from configured Notion databases (`GET /notion/summary`)
  - List pages with indexing status (`GET /admin/notion/pages`)
- **Bulk Ingestion**:
  - Ingest specific pages (`POST /notion/ingest-pages` with page_ids list)
  - Ingest all pages (`POST /notion/ingest-all` with mode: "pages", "databases", or "both")
- **Page-to-Lecture Conversion**: Each Notion page ingested as a lecture using same LLM extraction as text ingestion
- **Domain Assignment**: Optional domain parameter for categorizing Notion content
- **Error Handling**: Continues processing other pages if some fail; collects and reports errors

### 4.2 Notion Auto-Sync
**Description**: Background synchronization of Notion pages.

**Features**:
- **Automatic Sync Loop**: Background task runs every 5 minutes (configurable)
- **Timestamp Tracking**: Tracks last sync timestamp; only syncs pages updated since last sync
- **State Management**: Persists sync state to `notion_sync_state.json`
- **Startup Integration**: Auto-sync can be enabled via `ENABLE_NOTION_AUTO_SYNC` config
- **Manual Sync**: Admin endpoint to trigger sync manually (`POST /admin/sync-notion`)
- **Force Full Sync**: Option to sync all pages regardless of timestamp (`force_full` parameter)

### 4.3 Notion Page Indexing
**Description**: Track which Notion pages are indexed and manage indexing state.

**Features**:
- **Index State Tracking**: Tracks which pages are currently indexed in the graph
- **Index Mode**: 
  - "all": Index all pages
  - "selected": Only index explicitly selected pages
- **Page Selection**: Select/deselect pages for indexing (`POST /admin/notion/pages/index`)
- **Unlink Pages**: Remove Notion pages from graph (`POST /admin/notion/unlink-page`)
- **Index State Query**: Get current indexing state and mode (`GET /admin/notion/index-state`)
- **Sync History**: View history of sync operations (`GET /admin/notion/sync-history`)

### 4.4 Notion Configuration
**Description**: Configure which Notion databases to sync.

**Features**:
- **Database Selection**: Configure which Notion database IDs to include
- **Auto-Sync Toggle**: Enable/disable background auto-sync
- **Config Storage**: Stored in Neo4j as NotionConfig node
- **Endpoints**: `GET /admin/notion-config`, `POST /admin/notion-config`

### 4.5 Notion UI Components
**Description**: Frontend interfaces for Notion management.

**Features**:
- **Notion Sync Manager**: Full UI for managing Notion sync
  - List all pages with indexing status
  - Select/deselect pages for indexing
  - Trigger manual sync
  - View sync results and statistics
  - Filter pages by indexed/unindexed status
- **Notion Sync Status**: Status indicator showing last sync time and status
- **Notion Import Page**: Dedicated page for Notion import operations
- **Notion Admin Page**: Admin interface for Notion configuration

---

## 5. PERSONALIZATION & TEACHING STYLE

### 5.1 Response Style Profile
**Description**: Configure how Brain Web answers questions (tone, style, structure).

**Features**:
- **Style Components**:
  - `tone`: Overall tone (e.g., "intuitive, grounded, exploratory")
  - `teaching_style`: Teaching approach (e.g., "analogy-first, zoom-out then zoom-in")
  - `sentence_structure`: Sentence style (e.g., "short, minimal filler")
  - `explanation_order`: Ordered list of explanation components
  - `forbidden_styles`: Styles to avoid (e.g., "overly formal", "glib")
- **Default Profile**: System creates default profile if none exists
- **Profile Management**: `GET /preferences/response-style`, `POST /preferences/response-style`
- **Prompt Integration**: Style profile injected into AI chat system prompts

### 5.2 Focus Areas
**Description**: Current learning themes that bias answers toward specific topics.

**Features**:
- **Focus Area Management**:
  - Create/update focus areas (`POST /preferences/focus-areas`)
  - List all focus areas (`GET /preferences/focus-areas`)
  - Toggle active status (`POST /preferences/focus-areas/{focus_id}/active`)
- **Active Focus Areas**: Only active focus areas influence answers
- **Answer Biasing**: Active focus areas included in AI chat prompts to connect explanations back to themes
- **Landing Page Integration**: Editable textarea on welcome screen to set daily focus areas
- **Profile Customization UI**: Full management interface in Profile Customization page

### 5.3 User Profile
**Description**: Long-term personal preferences for personalized explanations.

**Features**:
- **Profile Components**:
  - `name`: User name
  - `background`: List of background areas (e.g., ["Computer Science", "Mathematics"])
  - `interests`: List of interests
  - `weak_spots`: Areas needing extra attention
  - `learning_preferences`: JSON object for flexible preferences
- **Personalization Effects**:
  - Avoids re-explaining fundamentals in strong background areas
  - Pays extra attention to weak spots
  - Uses preferred learning styles (analogies, layered explanations, etc.)
- **Profile Management**: `GET /preferences/user-profile`, `POST /preferences/user-profile`
- **Default Profile**: Creates default profile with name "Sanjay" if none exists

### 5.4 Teaching Style Profile
**Description**: Extracted teaching style from user's own lectures.

**Features**:
- **Style Extraction**: Analyzes recent lectures to extract teaching style
  - Tone, teaching style, sentence structure, explanation order, forbidden styles
- **Recomputation**: `POST /teaching-style/recompute` analyzes N recent lectures and updates profile
- **Manual Override**: `POST /teaching-style` allows partial updates to style profile
- **Default Style**: System provides default style if none exists
- **Integration**: Teaching style can influence how Brain Web explains concepts

### 5.5 Feedback System
**Description**: Collect feedback on answers to improve future responses.

**Features**:
- **Feedback Submission**: 
  - Thumbs up/down on answers (`POST /feedback/`)
  - Optional reasoning text
  - Linked to answer via `answer_id`
- **Feedback Summary**: Aggregated feedback summary (`GET /feedback/summary`)
  - Total ratings, positive/negative counts
  - Common reasons for negative feedback
- **Prompt Integration**: Feedback summary included in AI chat prompts to avoid negative patterns
- **Answer Revisions**: Users can rewrite answers; revisions stored separately (`POST /feedback/answer/revision`)
- **UI Integration**: Feedback buttons (👍/👎) in chat interface

---

## 6. RESOURCE MANAGEMENT

### 6.1 Resource Upload & Storage
**Description**: Upload and attach files (images, PDFs, audio) to concepts.

**Features**:
- **File Upload**: Upload files via `POST /resources/upload`
  - Supports images, PDFs, audio files, generic files
  - Files saved to `uploaded_resources/` directory
  - Served at `/static/resources/{filename}`
- **Resource Types**: 
  - `image`: Image files (JPG, PNG, etc.)
  - `pdf`: PDF documents
  - `audio`: Audio files
  - `file`: Generic files
  - `web_link`: External URLs
  - `notion_block`: Notion block references
  - `generated_image`: AI-generated images
- **Resource Properties**:
  - `resource_id`: Unique identifier
  - `kind`: Resource type
  - `url`: File URL or external link
  - `title`: Display title
  - `mime_type`: MIME type
  - `caption`: AI-generated or manual caption
  - `source`: Origin ("upload", "notion", "gpt", etc.)

### 6.2 AI-Powered Resource Processing
**Description**: Automatic captioning and analysis of uploaded resources.

**Features**:
- **Image Captioning**: GPT-4 Vision generates descriptive captions for uploaded images
- **PDF Text Extraction**: Extracts text from PDF files
- **PDF Summarization**: Generates summaries of PDF content
- **Concept Extraction**: Can extract concepts from PDF text (optional feature)
- **Automatic Processing**: Captions and summaries generated automatically on upload

### 6.3 Resource Linking
**Description**: Link resources to concepts in the knowledge graph.

**Features**:
- **Link to Concepts**: Resources can be linked to concepts during upload or after
- **Resource Queries**: Get all resources for a concept (`GET /resources/by-concept/{concept_id}`)
- **Graph Integration**: Resources displayed in concept detail views
- **Resource UI**: Frontend components to view and manage resources attached to concepts

---

## 7. ADMIN & UTILITIES

### 7.1 CSV Import/Export
**Description**: Bidirectional sync between Neo4j graph and CSV files.

**Features**:
- **CSV Import**: Import graph from CSV files (`POST /admin/import`)
  - Reads `graph/nodes_semantic.csv`, `graph/edges_semantic.csv`, `graph/lecture_covers_*.csv`
  - Creates constraints in Neo4j
  - Imports nodes, edges, and lecture-cover relationships
- **CSV Export**: Export graph to CSV files (`POST /admin/export`)
  - Writes nodes, edges, and lecture covers back to CSV
  - Maintains data consistency
- **Auto-Import on Startup**: Backend automatically imports CSV on startup
- **Auto-Export on Mutations**: Graph mutations trigger background CSV export

### 7.2 Debug Endpoints
**Description**: Development tools for inspecting system state.

**Features**:
- **Recent Answers**: View recent answers with feedback flags (`GET /debug/answers/recent`)
- **Answer Details**: Get full answer details including feedback and revisions (`GET /debug/answers/{answer_id}`)
- **Production Safety**: Debug endpoints disabled in production environment
- **Debug Page**: Frontend page at `/debug/answers` for viewing answer history

### 7.3 Test Suite UI
**Description**: Web-based interface for running and monitoring pytest tests.

**Features**:
- **Test Organization**: Tests organized by feature area (Graph & Concepts, Lectures, Teaching Style, Preferences, Notion Sync, Admin, AI, Core)
- **Test Manifest**: Centralized test metadata in `backend/tests_manifest.py`
  - Each test has: id, path, description, enabled flag
- **Selective Running**: 
  - Select individual tests via checkboxes
  - Run entire test suites
  - "Run Selected" button for custom test sets
- **Test Execution**: Runs pytest programmatically via subprocess
- **Results Display**: 
  - Shows pass/fail status per test
  - Displays pytest output
  - Shows statistics (total, passed, failed)
- **UI Features**:
  - Expandable test suites
  - Test descriptions for each test
  - Loading states during execution
  - Collapsible output panels
- **Endpoints**: `GET /tests/manifest`, `POST /tests/run`
- **Frontend Page**: `/tests` route with full test management UI

---

## 8. FRONTEND UI FEATURES

### 8.1 Landing Page
**Description**: Welcome screen with focus area setup.

**Features**:
- **Welcome Message**: Personalized greeting ("Welcome Back, {name}")
- **Editable Focus Areas**: Large textarea to type focus areas for the day
  - One per line or comma-separated
  - Auto-creates/updates focus areas on save
  - Syncs with Profile Customization
- **Existing Focus Areas**: Display existing focus areas as toggleable buttons
- **Save Functionality**: "Save Focus" button to persist focus areas
- **Enter Button**: "Enter Brain Web" button to proceed to main graph view
- **Smooth Transitions**: Fade animations when entering main app

### 8.2 Graph Visualization UI
**Description**: Main interactive graph interface.

**Features**:
- **Command Panel**: Text-based command interface
  - Natural language questions → AI chat
  - Commands: `search`, `select`, `go`, `open`, `show`, `link`, `relink`, `add`, `temp`, `delete`, `cleanup`, `preserve`, `path`
- **Chat Panel**: 
  - Integrated chat interface for questions
  - Shows answers with used nodes highlighted
  - Suggested questions and actions
  - Feedback buttons (👍/👎)
  - Expandable/maximizable chat view
- **Node Detail Panel**: Shows selected node information
  - Concept properties
  - Neighbors list
  - Resources attached
  - Lecture segments covering concept
- **Domain Filter**: Filter graph by domain with checkboxes
- **Graph Controls**: Adjustable physics parameters
- **Quick Actions**: Suggested action chips for common operations
- **Lecture Ingestion**: Inline form for ingesting lectures
- **Resource Management**: Upload and view resources for concepts

### 8.3 Profile Customization Page
**Description**: Comprehensive settings page for personalization.

**Features**:
- **Response Style Editor**: 
  - Edit tone, teaching style, sentence structure
  - Configure explanation order (comma-separated)
  - Set forbidden styles
  - Save button
- **User Profile Editor**:
  - Edit name, background, interests, weak spots
  - Learning preferences (JSON editor)
  - Save button
- **Focus Areas Management**:
  - List all focus areas as toggleable pills
  - Add new focus area (name + description)
  - Toggle active status
- **Notion Configuration**: (if integrated)
  - Configure Notion database IDs
  - Toggle auto-sync
- **Layout**: Two-column layout with clear sections

### 8.4 Source Management Page
**Description**: Manage different sources of knowledge (lectures, Notion, etc.).

**Features**:
- **Source Overview**: List all sources contributing to graph
- **Source Filtering**: Filter concepts by source
- **Source Statistics**: Count of concepts per source

### 8.5 Notion Management Pages
**Description**: Dedicated pages for Notion integration.

**Features**:
- **Notion Import Page**: Interface for importing Notion pages
- **Notion Admin Page**: Admin interface for Notion configuration
- **Notion Sync Status**: Status indicators and sync controls

---

## 9. DATA PERSISTENCE & SYNC

### 9.1 Neo4j Database
**Description**: Primary graph database for all knowledge.

**Features**:
- **Node Types**: Concept, Lecture, LectureSegment, Analogy, FocusArea, Resource, Meta, Feedback, Answer, Revision, UserProfile, NotionConfig
- **Relationship Types**: Various typed relationships between concepts, COVERS (lecture→concept), HAS_SEGMENT (lecture→segment), USES_ANALOGY (segment→analogy), COVERS_CONCEPT (segment→concept), HAS_RESOURCE (concept→resource)
- **Constraints**: Unique constraints on node IDs
- **Session Management**: FastAPI dependency for request-scoped Neo4j sessions

### 9.2 CSV Backup System
**Description**: CSV files as backup and seed data.

**Features**:
- **Node CSV**: `graph/nodes_semantic.csv` with all concept properties
- **Edge CSV**: `graph/edges_semantic.csv` with relationships
- **Lecture CSV**: `graph/lecture_covers_*.csv` files for lecture-cover relationships
- **Bidirectional Sync**: Auto-export on mutations, auto-import on startup
- **Manual Sync**: Admin endpoints for manual import/export

### 9.3 State Files
**Description**: JSON files for tracking state.

**Features**:
- **Notion Sync State**: `notion_sync_state.json` tracks last sync timestamp
- **Notion Index State**: `notion_index_state.py` manages page indexing state

---

## 10. COMMAND SYSTEM

### 10.1 Text Commands
**Description**: Text-based commands for graph manipulation.

**Features**:
- **Navigation**: `go <concept>`, `open <concept>`, `show <concept>` - Navigate to and focus on concepts
- **Search**: `search <query>` - Semantic search for concepts
- **Selection**: `select <concept>` - Select a concept
- **Linking**: 
  - `link` - Enter linking mode, then click source and target
  - `relink <source> <target> <predicate>` - Create relationship
- **Node Management**:
  - `add node <name> [domain]` - Add temporary node
  - `temp <name>` - Create temporary node
  - `delete node <name>` - Delete concept
- **Cleanup**: `cleanup` - Delete test/seed data
- **Preserve**: `preserve` - Save current graph state
- **Path Finding**: `path <source> <target>` - Find path between concepts
- **Help**: `help` or `?` - Show available commands

### 10.2 Natural Language Questions
**Description**: Questions processed by AI chat system.

**Features**:
- **Question Detection**: System distinguishes commands from questions
- **Context Building**: Semantic search + neighbor fetching for context
- **Structured Answers**: Answers with suggested actions and follow-up questions
- **Graph Integration**: Answers reference concepts in graph; nodes highlighted

---

## 11. ERROR HANDLING & LOGGING

### 11.1 Centralized Error Handling
**Description**: Consistent error handling across all endpoints.

**Features**:
- **HTTP Exception Handler**: Logs 4xx at WARNING, 5xx at ERROR
- **Validation Error Handler**: Logs request validation errors
- **General Exception Handler**: Catch-all for unhandled exceptions; returns sanitized messages
- **Error Logging**: Full stack traces logged server-side; sanitized messages to client

### 11.2 Logging System
**Description**: Structured logging throughout the application.

**Features**:
- **Log Levels**: INFO, WARNING, ERROR with appropriate usage
- **Structured Logging**: Includes method, path, status codes, error details
- **Request Logging**: All API requests logged with context

---

## 12. TESTING INFRASTRUCTURE

### 12.1 Test Suite
**Description**: Comprehensive pytest test suite.

**Features**:
- **Test Organization**: Tests organized by feature area
- **Test Coverage**: 
  - Graph & Concepts (14 tests)
  - Lecture Ingestion (7 tests)
  - Teaching Style (4 tests)
  - Preferences (6 tests)
  - Notion Sync (4 tests)
  - Admin & Utilities (6 tests)
  - AI & Chat (2 tests)
  - Core & Internal (4 tests)
- **Mocking**: Mock Neo4j sessions, OpenAI clients, CSV export
- **Fixtures**: Reusable test fixtures in `conftest.py`
- **Test Helpers**: Mock helpers for Neo4j records and results

### 12.2 Test UI
**Description**: Web-based test runner (see Section 7.3)

---

## 13. CONFIGURATION & ENVIRONMENT

### 13.1 Environment Variables
**Description**: Configuration via environment variables.

**Features**:
- **Neo4j**: `NEO4J_URI`, `NEO4J_USER`, `NEO4J_PASSWORD`
- **OpenAI**: `OPENAI_API_KEY` (optional, enables AI features)
- **Notion**: `NOTION_API_KEY`, `NOTION_DATABASE_IDS`
- **Features**: `ENABLE_NOTION_AUTO_SYNC`
- **Uploads**: `RESOURCE_UPLOAD_DIR`
- **API URL**: `NEXT_PUBLIC_API_URL` (frontend)

### 13.2 Configuration Files
**Description**: Various config files for different aspects.

**Features**:
- **pytest.ini**: Pytest configuration
- **pyrightconfig.json**: Type checking configuration
- **next.config.js**: Next.js configuration
- **tsconfig.json**: TypeScript configuration
- **requirements.txt**: Python dependencies
- **package.json**: Node.js dependencies

---

## 14. MULTI-SOURCE TRACKING

### 14.1 Source Attribution
**Description**: Track which sources contributed to each concept.

**Features**:
- **Lecture Sources**: `lecture_sources` array tracks all lectures/pages that contributed
- **Created By**: `created_by` tracks original source
- **Last Updated By**: `last_updated_by` tracks most recent source
- **Source Interface**: Abstract interface for different source types
- **Source Filtering**: Can filter concepts by source

---

## SUMMARY STATISTICS

- **Total API Endpoints**: ~58 endpoints across 13 routers
- **Frontend Pages**: 8+ pages (graph, profile, notion, tests, debug, etc.)
- **Frontend Components**: 6+ major components
- **Data Models**: 20+ Pydantic models
- **Neo4j Node Types**: 10+ node types
- **Neo4j Relationship Types**: 10+ relationship types
- **Test Coverage**: 47+ tests across 8 feature areas
- **Integration Points**: OpenAI, Notion API, Neo4j, CSV files

---

## NOTES FOR FUTURE PLANNING

- **Scalability**: Current implementation uses local file storage for resources; consider S3/cloud storage
- **Authentication**: No authentication currently; admin endpoints should be protected
- **Real-time Updates**: Graph updates require page refresh; consider WebSocket for real-time updates
- **Mobile Support**: Current UI optimized for desktop; mobile responsiveness could be improved
- **Offline Support**: No offline capabilities; consider service workers for offline graph viewing
- **Export Formats**: Currently CSV; consider JSON, GraphML, RDF exports
- **Import Formats**: Currently CSV and Notion; consider Markdown, Obsidian, Roam Research imports
- **Analytics**: No usage analytics; consider adding usage tracking
- **Versioning**: No version history for concepts; consider adding version tracking
- **Collaboration**: Single-user system; consider multi-user support with permissions
