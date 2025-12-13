# Brain Web - Project Status & Vision

**Last Updated:** December 2024  
**Version:** 0.1.0

---

## 🎯 Project Overview

Brain Web is an AI-powered knowledge graph system designed to help users visualize, explore, and expand their understanding of interconnected concepts. It serves as a personal knowledge management tool that learns from your lectures, documents, and interactions to create a living, breathing map of your understanding.

**Core Philosophy:** "Everything is a block" - inspired by Notion's design, Brain Web treats knowledge as interconnected blocks that can be explored, connected, and visualized in multiple ways.

---

## ✅ Current Status: What's Been Built

### 1. Core Knowledge Graph Infrastructure

**✅ Fully Implemented:**
- **Neo4j Graph Database**: Complete CRUD operations for concepts (nodes) and relationships (edges)
- **Concept Management**: Create, read, update, delete concepts with properties (name, domain, type, description, tags, notes)
- **Relationship Management**: Typed relationships between concepts (RELATED_TO, DEPENDS_ON, PREREQUISITE, etc.)
- **Graph Visualization**: Interactive 2D force-directed graph using react-force-graph-2d
- **Domain-Based Organization**: Concepts organized by domains with color-coded visualization
- **Multi-Source Tracking**: Track which sources (lectures, Notion pages) contributed to each concept

**Key Features:**
- Auto-generates unique node IDs (format: `NXXXXXXXX`)
- Supports concept search by name and semantic search via embeddings
- Graph export/import via CSV for backup and portability
- Missing description detection and gap analysis

### 2. Lecture Ingestion & Management

**✅ Fully Implemented:**
- **LLM-Powered Extraction**: Uses OpenAI GPT to extract concepts and relationships from lecture text
- **Lecture Segmentation**: Automatically breaks lectures into logical segments with summaries
- **Analogy Extraction**: Identifies and extracts teaching analogies from lecture content
- **Style Tagging**: Segments tagged with teaching style indicators (analogy-heavy, technical, example-driven, etc.)
- **Concept Linking**: Segments linked to concepts they cover
- **Lecture Studio**: Comprehensive three-column UI for viewing and analyzing lectures
- **Draft Next Lecture**: Generate follow-up lecture outlines based on teaching style profile

**Key Features:**
- Smart concept matching (case-insensitive, domain-aware)
- Upsert logic (creates new or updates existing concepts)
- Lecture segments ordered by index with optional timestamps
- Teaching insights and gap detection per lecture

### 3. AI-Powered Features

**✅ Fully Implemented:**
- **Semantic Search**: OpenAI embeddings-based concept search with cosine similarity
- **AI Chat System**: Context-aware Q&A powered by GPT-4o-mini with graph context
- **Answer Generation**: Structured responses with used nodes, suggested questions, and actions
- **Answer Rewriting**: Learn from user-rewritten answers to improve style
- **Gap Detection**: Heuristic-based detection of knowledge gaps (missing descriptions, low connectivity, high interest/low coverage)

**Key Features:**
- Embedding caching to reduce API calls
- Fallback to name matching if OpenAI unavailable
- Feedback system (thumbs up/down) for continuous improvement
- Answer storage with revision tracking

### 4. Notion Integration

**✅ Fully Implemented:**
- **Page Ingestion**: Sync Notion pages into knowledge graph as lectures
- **Auto-Sync**: Background synchronization every 5 minutes (configurable)
- **Page Indexing**: Track which pages are indexed with allowlist/blocklist modes
- **Database Configuration**: Configure which Notion databases to sync
- **Sync Status Tracking**: Visual status indicators and sync history
- **Source Management UI**: Full interface for managing Notion sources

**Key Features:**
- Timestamp-based incremental sync (only syncs updated pages)
- Auto-discovery of databases if none configured
- Error handling with continued processing on failures
- Page-to-lecture conversion using same LLM extraction pipeline

### 5. Personalization & Teaching Style

**✅ Fully Implemented:**
- **Response Style Profile**: Configure tone, teaching style, sentence structure, explanation order
- **Focus Areas**: Current learning themes that bias answers toward specific topics
- **User Profile**: Background, interests, weak spots, learning preferences
- **Teaching Style Profile**: Extracted from user's own lectures (analyzes 5 most recent)
- **Feedback System**: Collect feedback on answers to improve future responses

**Key Features:**
- Style profile automatically injected into AI prompts
- Teaching style recomputation from recent lectures
- Active/inactive focus areas with toggle functionality
- Personalized explanations based on user background

### 6. Resource Management

**✅ Fully Implemented:**
- **File Upload**: Upload images, PDFs, audio files to concepts
- **AI-Powered Processing**: Automatic captioning (GPT-4 Vision) and PDF text extraction
- **Resource Linking**: Attach resources to concepts in the graph
- **Resource Types**: Images, PDFs, audio, web links, Notion blocks, generated images

**Key Features:**
- Local file storage (uploaded_resources/ directory)
- Automatic MIME type detection
- Resource display in concept detail views
- PDF summarization capabilities

### 7. Frontend UI Components

**✅ Fully Implemented:**
- **Landing Page**: Welcome screen with focus area setup
- **Graph Visualization**: Main interactive graph interface with command panel
- **Chat Panel**: Integrated chat interface with suggested questions and actions
- **Node Detail Panel**: Concept properties, neighbors, resources, lecture segments
- **Profile Customization Page**: Comprehensive settings for personalization
- **Source Management Page**: Manage knowledge sources (lectures, Notion)
- **Concept Board**: Multimodal concept card with definition, connections, lectures, resources
- **Gaps View**: Dedicated view for knowledge gaps with quick actions
- **Lecture Studio**: Three-column layout for lecture analysis
- **Notion Sync Manager**: Full UI for managing Notion sync

**Key Features:**
- Command system (search, select, go, link, add, delete, path finding)
- Domain filtering with checkboxes
- Adjustable graph physics parameters
- Smooth transitions and animations

### 8. Admin & Utilities

**✅ Fully Implemented:**
- **CSV Import/Export**: Bidirectional sync between Neo4j and CSV files
- **Test Suite UI**: Web-based interface for running pytest tests
- **Debug Endpoints**: Development tools for inspecting system state
- **Error Handling**: Centralized error handling with structured logging

**Key Features:**
- Auto-import CSV on startup
- Auto-export CSV on graph mutations
- Test manifest with descriptions
- Production-safe debug endpoints

---

## 🚧 In Progress / Partially Implemented

### 1. Demo/Trial Mode
**Status:** Not yet implemented  
**Needs:**
- User isolation (separate graph instances or namespaces)
- API key management (shared vs. user-provided)
- Data privacy controls
- Query limits for trial users
- Demo dataset seeding

### 2. Pathway Creator
**Status:** Conceptual - not yet implemented  
**Vision:** Visual pathway creator for learning journeys, plot development (for writers), research exploration

### 3. Multi-Frame System
**Status:** Conceptual - not yet implemented  
**Vision:** Browser-like tabs/frames for different tasks (learning, working, thinking)

### 4. Advanced Graph Analysis
**Status:** Basic gap detection implemented, advanced features pending  
**Needs:**
- DFS/BFS exploration modes
- Path comparison and visualization
- Logical error detection (for plot development)
- Route merging and optimization

---

## 🌱 Future Growth Opportunities

### Short-Term Enhancements (Next 3-6 Months)

1. **Demo/Trial Mode**
   - Isolated user sessions with demo datasets
   - Shared API keys with usage limits
   - Sandboxed graph instances
   - Query rate limiting

2. **Enhanced Pathway Creator**
   - Visual pathway builder UI
   - Learning journey templates
   - Plot development tools for writers
   - Path comparison and merging

3. **Improved Graph Exploration**
   - DFS/BFS exploration modes
   - Path finding with multiple algorithms
   - Visual path highlighting
   - Exploration history

4. **Better Resource Management**
   - Cloud storage integration (S3, etc.)
   - Resource search and filtering
   - Batch operations
   - Resource versioning

5. **Mobile Responsiveness**
   - Mobile-optimized UI
   - Touch-friendly graph interactions
   - Responsive layouts

### Medium-Term Enhancements (6-12 Months)

1. **Multi-User Support**
   - User authentication and authorization
   - Shared knowledge graphs
   - Collaboration features
   - Permissions system

2. **Advanced AI Features**
   - Multi-modal understanding (images, audio)
   - Concept summarization
   - Automatic relationship suggestions
   - Concept conflict detection

3. **Export/Import Formats**
   - Markdown export
   - Obsidian/Roam Research import
   - GraphML export
   - RDF/OWL export

4. **Analytics & Insights**
   - Usage analytics
   - Learning progress tracking
   - Concept mastery indicators
   - Knowledge growth visualization

5. **Real-Time Collaboration**
   - WebSocket support for real-time updates
   - Live collaboration on graphs
   - Shared editing sessions

### Long-Term Vision (12+ Months)

1. **Domain-Specific Applications**
   - **Education**: Curriculum planning, student progress tracking
   - **Writing**: Character maps, plot development, world-building
   - **Research**: Literature review, hypothesis exploration
   - **Business**: Knowledge management, decision trees

2. **Advanced Visualization**
   - 3D graph visualization
   - Timeline views
   - Domain clustering
   - Concept evolution over time

3. **Integration Ecosystem**
   - More source integrations (Obsidian, Roam, LogSeq)
   - Calendar integration
   - Note-taking app sync
   - Browser extension

4. **AI Agent Capabilities**
   - Autonomous knowledge discovery
   - Automatic gap filling
   - Concept relationship suggestions
   - Teaching style adaptation

---

## 🎨 Vision: The Complete User Journey

### Homescreen Layer
**Status:** ✅ Implemented (Landing Page)

Welcome screen where users enter their focus area for the day. Pre-fills Profile Customization if focus area is already set.

### Profile Customization Layer
**Status:** ✅ Implemented

**Your Voice Section:**
- Tone (Intuitive, Grounded, Exploratory)
- Teaching Style (Big Picture, Example-First, etc.)
- Sentence Structure (Short, Non-Dramatic)
- Explanation Order (Example/Analogy, Definition, etc.)
- Forbidden Styles (Generic, Formal)

**Current Focus Section:**
- Pre-filled from Homescreen or manually entered
- Example: "NVIDIA"

**Teaching Style Profile:**
- Automatically learned from 5 most recent lectures
- Can be recomputed immediately
- Used to shape chat and drafts

**You as a Learner Section:**
- Background
- Interests
- Weak-spots
- Learning Preferences

**Source Management Link:**
- Button at top leads to Source Management

### Source Management Layer
**Status:** ✅ Implemented

**Notion Integration:**
- Configure which pages and databases to index
- Enable/disable auto-sync
- Visualization of indexed pages with status
- Last edited timestamps
- Database source tracking

### Brain Web Visualization
**Status:** ✅ Implemented

**Graph Concierge (Chat):**
- Ask for pathways to learn subjects
- Gain context around neighbors
- Add/remove nodes
- Tweak relationships

**Domain Visualization:**
- Sort through domains
- Visualize overlap or differentiation
- Filter by domain

**Node Properties:**
- Domain registration
- Description (concept, tool)
- Source attribution (Lecture/File)
- Attached resources

### Concept Board
**Status:** ✅ Implemented

Every node has its own concept board showing:
- **In Lectures**: Where the concept was mentioned
- **Connections**: Related nodes and relationship types
- **Definition**: Concept description
- **Notes**: Editable user notes
- **Resources**: Attached files and links

### Future: Pathway Creator
**Status:** 🚧 Conceptual

Visual tool for creating learning pathways, plot development routes, research exploration paths. Supports DFS/BFS exploration modes with visual representation.

---

## 🔐 Demo/Trial Considerations

### Current Challenge
The application requires:
- **Neo4j Database**: User needs their own Neo4j instance
- **OpenAI API Key**: For AI features (semantic search, chat, lecture extraction)
- **Notion API Key**: For Notion integration (optional)

### Proposed Solutions for Demo

#### Option 1: Shared Backend with Isolated Graphs (Recommended)
- **Backend**: Single backend instance with your API keys
- **Graph Isolation**: Use Neo4j multi-tenancy or separate databases per session
- **User Experience**: Users enter demo mode, get isolated graph instance
- **Data Privacy**: Users can't see your personal data
- **Limitations**: Query limits, session timeouts, demo dataset only

**Implementation:**
- Create demo-specific Neo4j database
- Seed with sample concepts and relationships
- Session-based isolation (temporary user IDs)
- Rate limiting on API endpoints
- Auto-cleanup of demo sessions after timeout

#### Option 2: User-Provided API Keys
- **Backend**: Your backend, but users provide their own OpenAI key
- **Graph**: Shared Neo4j instance with namespace isolation
- **User Experience**: Users enter their API key in demo mode
- **Data Privacy**: Namespace isolation prevents data leakage
- **Limitations**: Users need OpenAI account, more complex setup

#### Option 3: Sandboxed Demo Environment
- **Backend**: Separate demo backend instance
- **Graph**: Pre-seeded demo database with sample data
- **User Experience**: Completely isolated demo environment
- **Data Privacy**: No access to your data
- **Limitations**: Requires separate infrastructure

### Recommended Approach

**For Portfolio Demo:**
1. **Create Demo Mode**: Add `/demo` route with isolated session
2. **Seed Demo Data**: Pre-populate with interesting sample concepts (e.g., "Machine Learning", "Neural Networks", "Backpropagation")
3. **Use Your API Keys**: Backend uses your OpenAI key (with rate limiting)
4. **Session Isolation**: Each demo session gets isolated graph namespace
5. **Query Limits**: Limit to 10-20 queries per session
6. **Demo Features**: Show core features (graph visualization, chat, concept board)

**Demo Flow:**
1. User clicks "Try Demo" on your portfolio
2. Enters demo mode with pre-seeded graph
3. Can explore graph, ask questions, create relationships
4. Session expires after 30 minutes or 20 queries
5. Option to "Sign up for full version" with their own setup

### Environment Variables for Demo

**Backend (.env):**
```bash
# Your production keys
OPENAI_API_KEY=sk-...
NEO4J_URI=bolt://localhost:7687
NEO4J_USER=neo4j
NEO4J_PASSWORD=...

# Demo configuration
DEMO_MODE_ENABLED=true
DEMO_SESSION_TIMEOUT=1800  # 30 minutes
DEMO_QUERY_LIMIT=20
DEMO_NEO4J_DATABASE=demo  # Separate database for demos
```

**Frontend (.env.local):**
```bash
NEXT_PUBLIC_API_URL=https://your-backend-url.com
NEXT_PUBLIC_DEMO_MODE=true
```

---

## 📊 Technical Architecture

### Backend Stack
- **Framework**: FastAPI (Python)
- **Database**: Neo4j (Graph Database)
- **AI**: OpenAI API (GPT-4o-mini, text-embedding-3-small, GPT-4 Vision)
- **Storage**: Local file system (resources)
- **API**: RESTful API with 58+ endpoints

### Frontend Stack
- **Framework**: Next.js 14 (React)
- **Visualization**: react-force-graph-2d
- **Styling**: CSS Modules with CSS Variables
- **State Management**: React Hooks
- **API Client**: Custom fetch-based client

### Data Models
- **Concepts**: Nodes with properties (name, domain, type, description, tags, notes)
- **Relationships**: Typed edges (RELATED_TO, DEPENDS_ON, PREREQUISITE, etc.)
- **Lectures**: Lecture nodes with segments and analogies
- **Resources**: Files, images, PDFs linked to concepts
- **User Profiles**: Response style, focus areas, teaching style, user profile

### Key Files Structure
```
brain-web/
├── backend/
│   ├── api_*.py          # API routers (concepts, lectures, ai, etc.)
│   ├── services_*.py     # Business logic
│   ├── models.py         # Pydantic schemas
│   ├── db_neo4j.py       # Neo4j connection
│   ├── config.py         # Environment configuration
│   └── tests/            # Test suite
├── frontend/
│   └── app/
│       ├── components/   # React components
│       ├── [routes]/     # Next.js pages
│       └── api-client.ts # API client
└── docs/                 # Documentation
```

---

## 🧪 Testing & Quality

### Test Coverage
- **47+ tests** across 8 feature areas
- **Test Suite UI**: Web-based test runner at `/tests`
- **Test Organization**: By feature area (Graph, Lectures, Teaching Style, Preferences, Notion, Admin, AI, Core)

### Test Areas
1. Graph & Concepts (14 tests)
2. Lecture Ingestion (7 tests)
3. Teaching Style (4 tests)
4. Preferences (6 tests)
5. Notion Sync (4 tests)
6. Admin & Utilities (6 tests)
7. AI & Chat (2 tests)
8. Core & Internal (4 tests)

---

## 📝 Documentation

### Existing Documentation
- `docs/FEATURES.md` - Complete feature list
- `docs/CODEBASE_OVERVIEW.md` - Architecture overview
- `docs/QUICKSTART.md` - Getting started guide
- `docs/NEO4J_SETUP.md` - Neo4j setup instructions
- `IMPLEMENTATION_SUMMARY.md` - Recent feature implementations
- `README-dev.md` - Developer quick reference

### Documentation Needs
- [ ] Demo mode setup guide
- [ ] Deployment guide
- [ ] API documentation (OpenAPI/Swagger)
- [ ] User guide for end users
- [ ] Contributing guidelines

---

## 🚀 Deployment Considerations

### Current State
- Development-focused setup
- Local file storage
- No authentication
- Single-user system

### Production Readiness Checklist
- [ ] Authentication & authorization
- [ ] Cloud storage for resources (S3, etc.)
- [ ] Database backup strategy
- [ ] Rate limiting
- [ ] Error monitoring (Sentry, etc.)
- [ ] Performance optimization
- [ ] Security hardening
- [ ] CI/CD pipeline
- [ ] Docker containerization
- [ ] Environment variable management

---

## 💡 Use Cases & Applications

### Current Use Cases
1. **Personal Knowledge Management**: Organize and visualize your understanding
2. **Lecture Organization**: Ingest and analyze lecture content
3. **Teaching Style Analysis**: Learn from your own teaching patterns
4. **Knowledge Gap Detection**: Find areas needing more coverage

### Future Use Cases (From Vision)

1. **Education**
   - Curriculum planning
   - Student progress tracking
   - Learning pathway creation

2. **Writing**
   - Character relationship maps
   - Plot development and logical consistency
   - World-building visualization
   - Story arc exploration

3. **Research**
   - Literature review organization
   - Hypothesis exploration
   - Research pathway visualization
   - Knowledge synthesis

4. **Business**
   - Knowledge management
   - Decision tree visualization
   - Process mapping
   - Team knowledge sharing

---

## 🎯 Next Steps for Demo

### Immediate Actions Needed

1. **Create Demo Mode Backend**
   - [ ] Add demo session management
   - [ ] Implement graph isolation (separate database or namespace)
   - [ ] Add query rate limiting
   - [ ] Create demo dataset seeder

2. **Create Demo Mode Frontend**
   - [ ] Add `/demo` route
   - [ ] Create demo landing page
   - [ ] Add session timeout handling
   - [ ] Show query limit indicator

3. **Seed Demo Data**
   - [ ] Create interesting sample concepts
   - [ ] Add sample relationships
   - [ ] Include sample lecture content
   - [ ] Ensure demo showcases key features

4. **Deploy Demo**
   - [ ] Set up demo backend instance
   - [ ] Configure environment variables
   - [ ] Deploy frontend with demo mode enabled
   - [ ] Test demo flow end-to-end

5. **Documentation**
   - [ ] Create demo setup guide
   - [ ] Document API key management
   - [ ] Add deployment instructions

---

## 📞 Contact & Contribution

**Project Status:** Active Development  
**License:** [To be determined]  
**Repository:** [GitHub URL]

---

## 🔄 Changelog

### Version 0.1.0 (Current)
- ✅ Core knowledge graph infrastructure
- ✅ Lecture ingestion and management
- ✅ AI-powered chat and semantic search
- ✅ Notion integration
- ✅ Personalization and teaching style
- ✅ Resource management
- ✅ Frontend UI components
- ✅ Test suite

### Upcoming (v0.2.0)
- 🚧 Demo/trial mode
- 🚧 Pathway creator
- 🚧 Enhanced graph exploration

---

*This document is a living document and will be updated as the project evolves.*
