# Lecture Ingestion Feature - Implementation Summary

## Overview

The lecture ingestion feature allows you to paste lecture text, which is then processed by an LLM to extract concepts and relationships, and automatically upserted into your Brain Web graph.

## Implementation Details

### 1. Backend API Endpoint

**Endpoint**: `POST /lectures/ingest`

**Location**: `backend/api_lectures.py`

**Request Body**:
```json
{
  "lecture_title": "Intro to Software Engineering",
  "lecture_text": "Today, we are going to talk about...",
  "domain": "Software Engineering"  // optional
}
```

**Response**:
```json
{
  "lecture_id": "LECTURE_XXXXXXXX",
  "nodes_created": [...],
  "nodes_updated": [...],
  "links_created": [
    {
      "source_id": "NXXXXXXXX",
      "target_id": "NYYYYYYYY",
      "predicate": "BUILDS_ON"
    }
  ]
}
```

### 2. LLM Prompt Constants

**Location**: `backend/prompts.py`

- `LECTURE_TO_GRAPH_PROMPT`: System prompt for extracting nodes and links from lecture text
- `BRAIN_WEB_CHAT_SYSTEM_PROMPT`: System prompt for chat responses in Sanjay's voice

### 3. Service Function

**Location**: `backend/services_lecture_ingestion.py`

The `ingest_lecture()` function:
1. Calls OpenAI LLM (gpt-4o-mini) with the lecture text
2. Parses and validates the JSON response
3. Upserts nodes (creates new or updates existing by name+domain)
4. Creates relationships between concepts
5. Returns results with created/updated nodes and links

**Key Features**:
- **Node Matching**: Matches existing nodes by name (case-insensitive) and optionally domain
- **Smart Updates**: Updates description only if new one is longer/more detailed
- **Tag Merging**: Merges new tags with existing tags
- **Confidence Filtering**: Skips relationships with confidence < 0.5
- **Lecture Tracking**: Tags nodes with `lecture_key` to track source

### 4. Pydantic Models

**Location**: `backend/models.py`

New models added:
- `ExtractedNode`: Node structure from LLM extraction
- `ExtractedLink`: Relationship structure from LLM extraction
- `LectureExtraction`: Complete extraction result
- `LectureIngestRequest`: Request payload
- `LectureIngestResult`: Response payload

### 5. Frontend API Client

**Location**: `frontend/app/api-client.ts`

Added `ingestLecture()` function:
```typescript
export async function ingestLecture(payload: {
  lecture_title: string;
  lecture_text: string;
  domain?: string;
}): Promise<LectureIngestResult>
```

### 6. Frontend UI Component

**Location**: `frontend/app/components/LectureIngestion.tsx`

A collapsible panel component that:
- Provides a form for lecture title, domain, and text
- Calls the ingestion API
- Shows loading states and results
- Automatically reloads the graph after successful ingestion

**Integration**: Added to `frontend/app/page.tsx` alongside `GraphVisualization`

### 7. Chat System Prompt Update

**Location**: `frontend/app/api/brain-web/chat/route.ts`

Updated the chat system prompt to use Sanjay's teaching style:
- Grounded, intuitive explanations
- Concrete examples (npm run dev, localhost:3000, etc.)
- Dependency-aware (IDE → compiler → runtime → server → cloud)
- Clear, direct sentences
- Connects to graph concepts

## How to Use

1. **Start the backend** (ensure `OPENAI_API_KEY` is set in `backend/.env`)
2. **Start the frontend**
3. **Open the Lecture Ingestion panel** (top-right corner, click to expand)
4. **Fill in the form**:
   - Lecture Title: e.g., "Intro to Software Engineering"
   - Domain (optional): e.g., "Software Engineering"
   - Lecture Text: Paste your full lecture text
5. **Click "Ingest Lecture"**
6. **Wait for processing** (LLM extraction + graph upsert)
7. **Graph automatically reloads** with new/updated nodes and relationships

## How It Works

### Extraction Flow

1. **LLM Call**: Lecture text is sent to OpenAI gpt-4o-mini with `LECTURE_TO_GRAPH_PROMPT`
2. **JSON Parsing**: LLM returns JSON matching `LectureExtraction` schema
3. **Node Processing**:
   - For each extracted node:
     - Check if exists by name (case-insensitive) + domain
     - If exists: update description (if better), merge tags, set lecture_key
     - If not: create new concept with all fields
4. **Relationship Processing**:
   - For each extracted link (confidence >= 0.5):
     - Map source_name/target_name to node_ids
     - Create relationship using `create_relationship_by_ids()` (MERGE ensures no duplicates)
5. **CSV Export**: Automatically exports to CSV after ingestion (via background task)

### Node Matching Strategy

- **Primary**: Match by normalized name (lowercase, trimmed) + domain
- **Fallback**: Match by normalized name only (if domain doesn't match)
- **Update Logic**: Only update description if new one is longer (more detailed)

## Configuration

### Required Environment Variables

- `OPENAI_API_KEY`: Must be set in `backend/.env` for LLM extraction to work

### LLM Settings

- **Model**: `gpt-4o-mini`
- **Temperature**: 0.3 (for consistent extraction)
- **Max Tokens**: 4000

## TODOs / Future Improvements

1. **Conflict Resolution**: 
   - More sophisticated strategies for handling conflicting descriptions
   - User review/approval for high-confidence conflicts

2. **Confidence Thresholds**:
   - Make confidence threshold configurable
   - Different thresholds for different relationship types

3. **Batch Processing**:
   - Support for ingesting multiple lectures at once
   - Progress tracking for large batches

4. **Error Recovery**:
   - Partial ingestion on LLM failures
   - Retry logic for transient errors

5. **UI Improvements**:
   - Better integration with graph visualization
   - Auto-center on newly created cluster
   - Preview of extracted nodes/links before ingestion

6. **Lecture Management**:
   - Store full lecture text in database
   - Re-extract/update from stored lectures
   - Lecture versioning

7. **Validation**:
   - Schema validation for LLM responses
   - Sanitization of predicate names
   - Validation of node names (no special characters, etc.)

## Code Structure

```
backend/
├── models.py                          # Pydantic models (ExtractedNode, etc.)
├── prompts.py                         # LLM prompt constants
├── services_lecture_ingestion.py      # Main ingestion logic
├── api_lectures.py                    # POST /lectures/ingest endpoint
└── services_graph.py                  # Graph operations (reused)

frontend/
├── app/
│   ├── api-client.ts                  # ingestLecture() function
│   ├── components/
│   │   └── LectureIngestion.tsx       # UI component
│   ├── api/brain-web/chat/route.ts    # Updated chat prompt
│   └── page.tsx                       # Integration
```

## Testing

To test the feature:

1. **Simple Test**:
   ```bash
   curl -X POST http://localhost:8000/lectures/ingest \
     -H "Content-Type: application/json" \
     -d '{
       "lecture_title": "Test Lecture",
       "lecture_text": "An IDE is a tool that combines a code editor and compiler. npm is a package manager for Node.js.",
       "domain": "Software Engineering"
     }'
   ```

2. **Frontend Test**:
   - Open the app
   - Expand the Lecture Ingestion panel
   - Paste a lecture and submit

## Notes

- The LLM prompt is designed to extract meaningful, reusable concepts (not every word)
- Relationships use UPPER_SNAKE_CASE predicates (e.g., `BUILDS_ON`, `HAS_COMPONENT`)
- Nodes are tagged with `lecture_key` to track their source lecture
- The system is idempotent-ish: re-ingesting the same lecture won't create duplicates (nodes are matched by name)
