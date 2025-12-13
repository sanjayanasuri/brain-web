# Brain Web - Developer Quick Reference

## Frontend Structure

### Main Entry Points
- `frontend/app/page.tsx` - Landing page → Graph view
- `frontend/app/components/GraphVisualization.tsx` - Main graph visualization component

### Pages
- `/` - Main graph view (GraphVisualization component)
- `/tests` - Test suite UI
- `/notion-admin` - Notion sync management
- `/notion-import` - Notion page import
- `/control-panel` - Admin controls
- `/profile-customization` - User preferences
- `/source-management` - Source management UI
- `/debug/answers` - Answer debugging

### API Routes
- `frontend/app/api/brain-web/chat/route.ts` - Chat endpoint (calls backend `/ai/semantic-search` + OpenAI)

### Key Components
- `GraphVisualization.tsx` - Force-directed graph, chat panel, commands
- `LectureIngestion.tsx` - Lecture ingestion form
- `LectureSegmentsViewer.tsx` - View lecture segments
- `NotionSyncStatus.tsx` - Notion sync status display

### API Client
- `frontend/app/api-client.ts` - Browser-side client for FastAPI backend
  - Graph operations (getConcept, getNeighbors, etc.)
  - Lecture operations (ingestLecture, getLectureSegments)
  - Preferences (getResponseStyle, getFocusAreas, etc.)
  - Resources (getResourcesForConcept, uploadResourceForConcept)

## Backend Structure

### Main API Routers
- `backend/api_concepts.py` - Concept CRUD, graph queries
- `backend/api_lectures.py` - Lecture ingestion, segments, steps
- `backend/api_teaching_style.py` - Teaching style profile management
- `backend/api_preferences.py` - Response style, focus areas, user profile
- `backend/api_ai.py` - Semantic search
- `backend/api_resources.py` - Resource upload/linking
- `backend/api_notion.py` - Notion integration
- `backend/api_admin.py` - Admin operations

### Key Endpoints

#### Lectures
- `GET /lectures/{lecture_id}` - Get lecture metadata
- `GET /lectures/{lecture_id}/segments` - Get segments for a lecture
- `GET /lectures/segments/by-concept/{concept_name}` - Get segments covering a concept
- `POST /lectures/ingest` - Ingest lecture text

#### Concepts
- `GET /concepts/{node_id}` - Get concept by ID
- `GET /concepts/by-name/{name}` - Get concept by name
- `GET /concepts/{node_id}/neighbors-with-relationships` - Get neighbors with relationship types
- `GET /concepts/missing-descriptions` - Concepts missing descriptions
- `GET /concepts/gaps` - Concept gaps (low connectivity, etc.)

#### Teaching Style
- `GET /teaching-style` - Get current teaching style profile
- `POST /teaching-style` - Update teaching style
- `POST /teaching-style/recompute` - Recompute from recent lectures

#### Resources
- `GET /resources/by-concept/{concept_id}` - Get resources for a concept
- `POST /resources/upload` - Upload resource

## Data Models

### LectureSegment
- segment_id, lecture_id, segment_index
- text, summary, style_tags
- covered_concepts: List[Concept]
- analogies: List[Analogy]

### Concept
- node_id, name, domain, type
- description, tags
- lecture_sources, created_by, last_updated_by

### TeachingStyleProfile
- tone, teaching_style, sentence_structure
- explanation_order, forbidden_styles

## Navigation Flow
Landing → Graph → (Lecture Studio | Concept Board | Gaps View)
