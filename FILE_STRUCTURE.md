# Brain Web - Complete File Structure

Quick reference for all files in the codebase.

## 📁 Complete File Tree

```
brain-web/
│
├── 📄 README.md                          # Main project README
├── 📄 README-dev.md                      # Developer quick reference
├── 📄 PROJECT_STATUS.md                   # Project status and roadmap
├── 📄 DEMO_STRATEGY.md                   # Demo mode strategy
├── 📄 CODEBASE_OVERVIEW_COMPLETE.md      # Complete codebase overview (this file)
├── 📄 FILE_STRUCTURE.md                  # This file - file tree reference
├── 📄 DOCUMENTATION_INDEX.md             # Documentation navigation
├── 📄 IMPLEMENTATION_SUMMARY.md          # Recent feature implementations
├── 📄 .gitignore                         # Git ignore rules
├── 📄 .env.example                       # Environment variables template
├── 📄 docker-compose.yml                 # Docker Compose config
│
├── 📂 backend/                           # FastAPI Python Backend
│   │
│   ├── 📄 main.py                        # ⭐ FastAPI app entry point
│   ├── 📄 config.py                      # ⭐ Environment configuration
│   ├── 📄 db_neo4j.py                    # ⭐ Neo4j database connection
│   ├── 📄 models.py                      # ⭐ Pydantic data models
│   ├── 📄 prompts.py                     # ⭐ LLM prompt templates
│   ├── 📄 requirements.txt               # Python dependencies
│   ├── 📄 pytest.ini                     # Pytest configuration
│   ├── 📄 pyrightconfig.json             # Type checking config
│   ├── 📄 run.sh                         # Development server script
│   │
│   ├── 📂 api_*.py                       # API Route Handlers
│   │   ├── 📄 api_concepts.py            # ⭐ Concepts CRUD API
│   │   ├── 📄 api_lectures.py            # ⭐ Lectures API
│   │   ├── 📄 api_ai.py                  # ⭐ AI chat & semantic search API
│   │   ├── 📄 api_preferences.py         # ⭐ User preferences API
│   │   ├── 📄 api_notion.py              # ⭐ Notion integration API
│   │   ├── 📄 api_resources.py           # ⭐ Resource management API
│   │   ├── 📄 api_teaching_style.py      # ⭐ Teaching style API
│   │   ├── 📄 api_feedback.py            # ⭐ Feedback system API
│   │   ├── 📄 api_answers.py             # ⭐ Answer tracking API
│   │   ├── 📄 api_admin.py               # ⭐ Admin operations API
│   │   ├── 📄 api_gaps.py                # ⭐ Knowledge gaps API
│   │   ├── 📄 api_tests.py               # ⭐ Test suite API
│   │   └── 📄 api_debug.py               # ⭐ Debug endpoints
│   │
│   ├── 📂 services_*.py                 # Business Logic Layer
│   │   ├── 📄 services_graph.py         # ⭐ Core graph operations
│   │   ├── 📄 services_lecture_ingestion.py  # ⭐ LLM lecture extraction
│   │   ├── 📄 services_lectures.py       # ⭐ Lecture management
│   │   ├── 📄 services_lecture_draft.py  # ⭐ Lecture draft generation
│   │   ├── 📄 services_search.py         # ⭐ Semantic search
│   │   ├── 📄 services_resources.py      # ⭐ Resource management
│   │   ├── 📄 services_resource_ai.py    # ⭐ AI resource processing
│   │   ├── 📄 services_notion.py        # ⭐ Notion operations
│   │   ├── 📄 services_sync.py           # ⭐ CSV sync service
│   │   └── 📄 services_teaching_style.py # ⭐ Teaching style service
│   │
│   ├── 📂 notion_*.py                    # Notion Integration
│   │   ├── 📄 notion_wrapper.py         # ⭐ Notion API wrapper
│   │   ├── 📄 notion_sync.py            # ⭐ Background sync
│   │   ├── 📄 notion_index_state.py     # ⭐ Page indexing state
│   │   ├── 📄 notion_page_index.py      # ⭐ Page-to-lecture mapping
│   │   └── 📄 notion_sync_state.json    # Sync state file
│   │
│   ├── 📂 teaching_style_*.py            # Teaching Style
│   │   ├── 📄 teaching_style_extractor.py  # ⭐ Style extraction
│   │   └── 📄 teaching_style_service.py    # Style service
│   │
│   ├── 📄 source_interface.py           # ⭐ Multi-source abstraction
│   │
│   ├── 📂 tests/                          # Test Suite
│   │   ├── 📄 __init__.py
│   │   ├── 📄 conftest.py                # Pytest fixtures
│   │   ├── 📄 mock_helpers.py            # Mock utilities
│   │   ├── 📄 README.md                  # Test documentation
│   │   ├── 📄 README_TESTS.md           # Test guide
│   │   ├── 📄 test_concepts_api.py       # Concept API tests
│   │   ├── 📄 test_concepts.py           # Concept service tests
│   │   ├── 📄 test_lectures_api.py       # Lecture API tests
│   │   ├── 📄 test_lectures.py           # Lecture service tests
│   │   ├── 📄 test_lecture_segments.py   # Segment tests
│   │   ├── 📄 test_teaching_style_api.py # Teaching style tests
│   │   ├── 📄 test_preferences_api.py    # Preferences tests
│   │   ├── 📄 test_notion_sync.py        # Notion sync tests
│   │   ├── 📄 test_admin_api.py          # Admin tests
│   │   ├── 📄 test_admin.py              # Admin service tests
│   │   ├── 📄 test_ai.py                 # AI tests
│   │   ├── 📄 test_root.py               # Root endpoint tests
│   │   └── 📄 test_error_logging.py      # Error handling tests
│   │
│   ├── 📄 tests_manifest.py              # ⭐ Test manifest for UI
│   │
│   ├── 📂 scripts/                       # Utility Scripts
│   │   ├── 📄 import_csv_to_neo4j.py    # CSV import script
│   │   ├── 📄 export_csv_from_neo4j.py  # CSV export script
│   │   └── 📄 README.md                  # Scripts documentation
│   │
│   ├── 📂 archive/                        # Archived Files
│   │   ├── 📄 example_notion_ingest.py
│   │   ├── 📄 test_connection.py
│   │   └── 📄 verify_ingestion.py
│   │
│   └── 📂 uploaded_resources/           # File Storage
│       ├── 📄 031cab727b624ef8b2a81ea3e989c43f.jpg
│       └── 📄 d3c5e3fe592a421caac0aaf57da7837d.pdf
│
├── 📂 frontend/                          # Next.js React Frontend
│   │
│   ├── 📄 package.json                    # ⭐ Node.js dependencies
│   ├── 📄 tsconfig.json                   # TypeScript configuration
│   ├── 📄 next.config.js                  # Next.js configuration
│   ├── 📄 .eslintrc.json                  # ESLint configuration
│   ├── 📄 .gitignore                      # Frontend gitignore
│   ├── 📄 README.md                       # Frontend README
│   │
│   └── 📂 app/                            # Next.js App Directory
│       │
│       ├── 📄 layout.tsx                  # Root layout
│       ├── 📄 page.tsx                     # ⭐ Main page (Landing/Graph)
│       ├── 📄 globals.css                  # ⭐ Global styles
│       │
│       ├── 📂 components/                  # React Components
│       │   ├── 📄 GraphVisualization.tsx   # ⭐ Main graph component
│       │   ├── 📄 LandingPage.tsx          # ⭐ Landing page component
│       │   ├── 📄 LectureIngestion.tsx     # Lecture ingestion form
│       │   ├── 📄 LectureSegmentsViewer.tsx # Segment viewer
│       │   ├── 📄 NotionSyncManager.tsx    # Notion sync UI
│       │   └── 📄 NotionSyncStatus.tsx     # Notion status indicator
│       │
│       ├── 📂 api/                        # Next.js API Routes
│       │   ├── 📂 brain-web/
│       │   │   └── 📂 chat/
│       │   │       └── 📄 route.ts        # ⭐ Chat API route
│       │   └── 📂 notion/
│       │       ├── 📄 route.ts            # Notion pages API
│       │       ├── 📄 sync/route.ts       # Notion sync API
│       │       ├── 📄 unlink/route.ts      # Notion unlink API
│       │       └── 📂 pages/
│       │           ├── 📄 route.ts
│       │           └── 📂 index/
│       │               └── 📄 route.ts
│       │
│       ├── 📄 api-client.ts               # ⭐ Backend API client
│       │
│       ├── 📂 [routes]/                    # Next.js Pages
│       │   ├── 📂 profile-customization/
│       │   │   └── 📄 page.tsx            # Profile customization page
│       │   ├── 📂 source-management/
│       │   │   └── 📄 page.tsx            # Source management page
│       │   ├── 📂 notion-admin/
│       │   │   └── 📄 page.tsx            # Notion admin page
│       │   ├── 📂 notion-import/
│       │   │   └── 📄 page.tsx            # Notion import page
│       │   ├── 📂 control-panel/
│       │   │   └── 📄 page.tsx            # Control panel page
│       │   ├── 📂 lecture-studio/
│       │   │   ├── 📄 page.tsx            # Lecture studio page
│       │   │   └── 📂 draft/
│       │   │       └── 📄 page.tsx        # Draft lecture page
│       │   ├── 📂 concepts/
│       │   │   └── 📂 [id]/
│       │   │       └── 📄 page.tsx        # Concept board page
│       │   ├── 📂 gaps/
│       │   │   └── 📄 page.tsx            # Gaps view page
│       │   ├── 📂 tests/
│       │   │   └── 📄 page.tsx            # Test suite UI page
│       │   └── 📂 debug/
│       │       └── 📂 answers/
│       │           └── 📄 page.tsx        # Debug answers page
│
├── 📂 docs/                               # Documentation
│   │
│   ├── 📄 README.md                       # Docs README
│   ├── 📄 CODEBASE_OVERVIEW.md            # Codebase overview
│   ├── 📄 FEATURES.md                     # ⭐ Complete feature list
│   ├── 📄 QUICKSTART.md                   # Quick start guide
│   ├── 📄 NEO4J_SETUP.md                  # Neo4j setup guide
│   ├── 📄 DEMO_SETUP.md                   # Demo setup guide
│   ├── 📄 FEEDBACK_LOOP_GUIDE.md          # Feedback system guide
│   ├── 📄 MULTI_SOURCE_ARCHITECTURE.md    # Multi-source architecture
│   ├── 📄 TEST_SUITE_UI.md                # Test suite UI docs
│   │
│   └── 📂 archive/                        # Archived Documentation
│       ├── 📄 EXPECTED_BEHAVIOR_SEGMENTS.md
│       ├── 📄 LAYOUT_CUSTOMIZATION_GUIDE.md
│       ├── 📄 LECTURE_INGESTION_IMPLEMENTATION.md
│       ├── 📄 OPENAI_API_KEY_SETUP.md
│       ├── 📄 PERSONALIZATION_IMPLEMENTATION.md
│       ├── 📄 PHASE3_IMPLEMENTATION_SUMMARY.md
│       ├── 📄 PHASE3_VERIFICATION.md
│       ├── 📄 PRACTICAL_DEMO.md
│       ├── 📄 SYNC_VERIFICATION_GUIDE.md
│       ├── 📄 TEACHING_STYLE_IMPLEMENTATION.md
│       ├── 📄 TEACHING_STYLE_QUICK_START.md
│       ├── 📄 TEST_LECTURE_SEGMENTS.md
│       ├── 📄 TEST_LLM_EXTRACTION.md
│       ├── 📄 TESTING_SEGMENTS.md
│       ├── 📄 UNDERSTANDING_THE_TEST.md
│       ├── 📄 VISUAL_EXAMPLE.md
│       └── 📄 WHY_SEGMENTS_MATTER.md
│
├── 📂 graph/                              # CSV Seed Data
│   ├── 📄 nodes_semantic.csv              # Concept nodes
│   ├── 📄 edges_semantic.csv               # Relationships
│   ├── 📄 lectures.csv                    # Lecture metadata
│   ├── 📄 lecture_covers_export.csv        # Lecture-cover relationships
│   └── 📄 lecture_covers_*.csv            # Lecture-specific covers
│
└── 📂 scripts/                            # Development Scripts
    └── 📄 start_dev.sh                    # Development startup script
```

## ⭐ Key Files (Must Read for Understanding)

### Backend Core
- `backend/main.py` - FastAPI app setup
- `backend/config.py` - Configuration
- `backend/db_neo4j.py` - Database connection
- `backend/models.py` - Data models

### Backend API
- `backend/api_concepts.py` - Graph CRUD
- `backend/api_lectures.py` - Lecture management
- `backend/api_ai.py` - AI endpoints
- `backend/api_preferences.py` - Personalization
- `backend/api_notion.py` - Notion integration

### Backend Services
- `backend/services_graph.py` - Core graph operations
- `backend/services_lecture_ingestion.py` - LLM extraction
- `backend/services_search.py` - Semantic search
- `backend/prompts.py` - LLM prompts

### Frontend Core
- `frontend/app/api-client.ts` - API client
- `frontend/app/components/GraphVisualization.tsx` - Main graph UI
- `frontend/app/components/LandingPage.tsx` - Landing page
- `frontend/app/page.tsx` - Root page
- `frontend/app/api/brain-web/chat/route.ts` - Chat API

### Integration
- `backend/notion_wrapper.py` - Notion API
- `backend/notion_sync.py` - Background sync
- `backend/source_interface.py` - Multi-source abstraction

## 📊 File Count Summary

- **Backend Python Files:** ~30
- **Frontend TypeScript Files:** ~20
- **Test Files:** ~15
- **Documentation Files:** ~25
- **Total:** ~90 files

## 🎯 Files by Category

### API Routes (Backend)
- `api_concepts.py` - Concepts
- `api_lectures.py` - Lectures
- `api_ai.py` - AI
- `api_preferences.py` - Preferences
- `api_notion.py` - Notion
- `api_resources.py` - Resources
- `api_teaching_style.py` - Teaching style
- `api_feedback.py` - Feedback
- `api_answers.py` - Answers
- `api_admin.py` - Admin
- `api_gaps.py` - Gaps
- `api_tests.py` - Tests
- `api_debug.py` - Debug

### Services (Backend)
- `services_graph.py` - Graph operations
- `services_lecture_ingestion.py` - Lecture extraction
- `services_lectures.py` - Lecture management
- `services_lecture_draft.py` - Draft generation
- `services_search.py` - Semantic search
- `services_resources.py` - Resource management
- `services_resource_ai.py` - AI resource processing
- `services_notion.py` - Notion operations
- `services_sync.py` - CSV sync
- `services_teaching_style.py` - Teaching style

### Components (Frontend)
- `GraphVisualization.tsx` - Main graph
- `LandingPage.tsx` - Landing page
- `LectureIngestion.tsx` - Lecture form
- `LectureSegmentsViewer.tsx` - Segment viewer
- `NotionSyncManager.tsx` - Notion sync UI
- `NotionSyncStatus.tsx` - Notion status

### Pages (Frontend)
- `page.tsx` - Root (Landing/Graph)
- `profile-customization/page.tsx` - Profile
- `source-management/page.tsx` - Sources
- `notion-admin/page.tsx` - Notion admin
- `lecture-studio/page.tsx` - Lecture studio
- `concepts/[id]/page.tsx` - Concept board
- `gaps/page.tsx` - Gaps view
- `tests/page.tsx` - Test suite

---

*Use this file tree to quickly locate files when extracting code for a similar project.*
