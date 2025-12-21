# Resource Fetching Implementation

This document describes the current resource fetching implementation to help design a Browser Use provider interface.

## Overview

Resources are media attachments (images, PDFs, audio, links, etc.) that can be associated with concepts in the knowledge graph. The system currently supports:
- **File uploads** (via multipart form)
- **Direct URL references** (web links)
- **AI-powered processing** (captioning, summarization)

## Current Architecture

### Data Model

**Resource Node (Neo4j)**:
```cypher
(:Resource {
  resource_id: String,      // Unique ID: "R{8-char-hex}"
  kind: String,            // 'image' | 'pdf' | 'audio' | 'file' | 'web_link' | 'notion_block' | 'generated_image'
  url: String,             // File URL or external link
  title: Optional[String],
  mime_type: Optional[String],
  caption: Optional[String], // AI-generated or manual
  source: Optional[String]   // 'upload' | 'notion' | 'gpt' | 'browser_use' | etc.
})
```

**Relationship**:
```cypher
(:Concept)-[:HAS_RESOURCE]->(:Resource)
```

**Pydantic Models** (`backend/models.py`):
```python
class Resource(BaseModel):
    resource_id: str
    kind: str  # 'image', 'pdf', 'audio', 'web_link', 'notion_block', 'generated_image', 'file'
    url: str
    title: Optional[str] = None
    mime_type: Optional[str] = None
    caption: Optional[str] = None
    source: Optional[str] = None

class ResourceCreate(BaseModel):
    kind: str
    url: str
    title: Optional[str] = None
    mime_type: Optional[str] = None
    caption: Optional[str] = None
    source: Optional[str] = "upload"
```

---

## API Endpoints

### 1. Upload Resource (File Upload)
**Endpoint**: `POST /resources/upload`

**Request**: Multipart form data
```
file: File (required)
concept_id: string (optional) - Link resource to concept immediately
title: string (optional)
source: string (optional, default: "upload")
```

**Response**: `Resource`
```json
{
  "resource_id": "R1A2B3C4D",
  "kind": "image",
  "url": "/static/resources/abc123.jpg",
  "title": "diagram.png",
  "mime_type": "image/png",
  "caption": "A flowchart showing the system architecture...",
  "source": "upload"
}
```

**Flow**:
1. Save file to disk (`uploaded_resources/`)
2. Generate URL path (`/static/resources/{filename}`)
3. Auto-detect `kind` from MIME type
4. AI processing (if enabled):
   - Images → GPT-4 Vision caption
   - PDFs → Text extraction + LLM summary
5. Create Resource node in Neo4j
6. Optionally link to Concept via `HAS_RESOURCE`

**Code**: `backend/api_resources.py:65-124`

---

### 2. List Resources for Concept
**Endpoint**: `GET /resources/by-concept/{concept_id}`

**Response**: `List[Resource]`
```json
[
  {
    "resource_id": "R1A2B3C4D",
    "kind": "image",
    "url": "/static/resources/abc123.jpg",
    "title": "diagram.png",
    "mime_type": "image/png",
    "caption": "...",
    "source": "upload"
  }
]
```

**Code**: `backend/api_resources.py:54-62`

---

### 3. Create Resource (Direct - No File Upload)
**Note**: Currently no direct endpoint, but service function exists.

**Service Function**: `services_resources.create_resource()`
```python
def create_resource(
    session: Session,
    *,
    kind: str,
    url: str,
    title: Optional[str] = None,
    mime_type: Optional[str] = None,
    caption: Optional[str] = None,
    source: Optional[str] = None,
) -> Resource
```

**Usage**: Could be called from a new endpoint like `POST /resources/create`

---

## Service Layer

### Core Services (`backend/services_resources.py`)

1. **`create_resource()`**: Creates Resource node in Neo4j
   - Generates `resource_id`: `"R{8-char-hex}"`
   - Stores all properties
   - Returns `Resource` model

2. **`get_resource_by_id()`**: Fetches Resource by ID

3. **`link_resource_to_concept()`**: Creates `HAS_RESOURCE` relationship
   ```cypher
   MATCH (c:Concept {node_id: $concept_id})
   MATCH (r:Resource {resource_id: $resource_id})
   MERGE (c)-[:HAS_RESOURCE]->(r)
   ```

4. **`get_resources_for_concept()`**: Lists all resources for a concept
   ```cypher
   MATCH (c:Concept {node_id: $concept_id})-[:HAS_RESOURCE]->(r:Resource)
   RETURN r
   ORDER BY r.title
   ```

### AI Services (`backend/services_resource_ai.py`)

1. **`generate_image_caption()`**: GPT-4 Vision for image captions
2. **`extract_pdf_text()`**: PyPDF2 text extraction
3. **`summarize_pdf_text()`**: LLM summarization
4. **`extract_concepts_from_text()`**: Extract concept names from text

---

## Current Resource Kinds

| Kind | Description | MIME Types | Processing |
|------|-------------|------------|-----------|
| `image` | Image files | `image/*` | GPT-4 Vision caption |
| `pdf` | PDF documents | `application/pdf` | Text extraction + summary |
| `audio` | Audio files | `audio/*` | None (future: transcription) |
| `file` | Generic files | Other | None |
| `web_link` | External URLs | N/A | None |
| `notion_block` | Notion block refs | N/A | None |
| `generated_image` | AI-generated images | `image/*` | None |

---

## Storage

**Current**: Local filesystem
- Directory: `backend/uploaded_resources/` (configurable via `RESOURCE_UPLOAD_DIR`)
- URL format: `/static/resources/{filename}`
- Filename: `{uuid}.{ext}`

**Future**: S3/cloud storage (TODO in code)

---

## Integration Points for Browser Use

### Option 1: New Endpoint (Recommended)
Create a new endpoint that accepts Browser Use results:

**Endpoint**: `POST /resources/fetch-from-url`

**Request**:
```json
{
  "url": "https://example.com/article",
  "concept_id": "N12345678",  // optional
  "title": "Article Title",    // optional, auto-extracted if not provided
  "source": "browser_use",
  "metadata": {                // optional Browser Use metadata
    "screenshot_url": "...",
    "extracted_text": "...",
    "actions_taken": [...]
  }
}
```

**Response**: `Resource`
```json
{
  "resource_id": "R1A2B3C4D",
  "kind": "web_link",
  "url": "https://example.com/article",
  "title": "Article Title",
  "mime_type": null,
  "caption": "Extracted summary from Browser Use...",
  "source": "browser_use"
}
```

### Option 2: Extend Existing Upload Endpoint
Add support for URL-based resources:

**Endpoint**: `POST /resources/upload` (extended)

**Request** (alternative to file upload):
```
url: string (instead of file)
concept_id: string (optional)
title: string (optional)
source: "browser_use"
metadata: json (optional)
```

### Option 3: Service Function Only
Create a service function that Browser Use can call directly:

```python
# backend/services_resources.py

def create_resource_from_browser_use(
    session: Session,
    *,
    url: str,
    concept_id: Optional[str] = None,
    title: Optional[str] = None,
    extracted_text: Optional[str] = None,
    screenshot_url: Optional[str] = None,
    metadata: Optional[Dict[str, Any]] = None,
) -> Resource:
    """
    Create a Resource from Browser Use results.
    
    Args:
        url: The URL that was fetched
        concept_id: Optional concept to link to
        title: Page title (auto-extracted if not provided)
        extracted_text: Text content from Browser Use
        screenshot_url: URL to screenshot (if saved)
        metadata: Additional Browser Use metadata
    """
    # Generate caption from extracted_text if available
    caption = None
    if extracted_text:
        caption = summarize_text(extracted_text)  # or use Browser Use summary
    
    # Create resource
    resource = create_resource(
        session=session,
        kind="web_link",
        url=url,
        title=title,
        caption=caption,
        source="browser_use",
    )
    
    # Link to concept if provided
    if concept_id:
        link_resource_to_concept(session, concept_id=concept_id, resource_id=resource.resource_id)
    
    return resource
```

---

## Proposed Browser Use Interface

### JSON Schema for Browser Use Provider

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "BrowserUseResourceRequest",
  "type": "object",
  "required": ["url"],
  "properties": {
    "url": {
      "type": "string",
      "format": "uri",
      "description": "The URL to fetch using Browser Use"
    },
    "concept_id": {
      "type": "string",
      "pattern": "^N[0-9A-F]{8}$",
      "description": "Optional concept ID to link resource to"
    },
    "title": {
      "type": "string",
      "description": "Page title (auto-extracted if not provided)"
    },
    "extracted_text": {
      "type": "string",
      "description": "Text content extracted by Browser Use"
    },
    "screenshot_url": {
      "type": "string",
      "format": "uri",
      "description": "URL to screenshot if saved"
    },
    "metadata": {
      "type": "object",
      "description": "Additional Browser Use metadata",
      "properties": {
        "actions_taken": {
          "type": "array",
          "items": {
            "type": "object"
          }
        },
        "load_time": {
          "type": "number"
        },
        "elements_found": {
          "type": "integer"
        }
      }
    }
  }
}
```

### Response Schema

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "Resource",
  "type": "object",
  "required": ["resource_id", "kind", "url"],
  "properties": {
    "resource_id": {
      "type": "string",
      "pattern": "^R[0-9A-F]{8}$",
      "description": "Unique resource identifier"
    },
    "kind": {
      "type": "string",
      "enum": ["web_link", "image", "pdf", "file"],
      "description": "Resource type"
    },
    "url": {
      "type": "string",
      "format": "uri",
      "description": "Resource URL"
    },
    "title": {
      "type": "string",
      "description": "Display title"
    },
    "mime_type": {
      "type": "string",
      "description": "MIME type if applicable"
    },
    "caption": {
      "type": "string",
      "description": "AI-generated or manual caption"
    },
    "source": {
      "type": "string",
      "enum": ["browser_use", "upload", "notion", "gpt"],
      "description": "Source of the resource"
    }
  }
}
```

---

## Implementation Notes

### 1. No Core Graph Logic Changes Needed
- Resources are stored as separate nodes
- Linking is via `HAS_RESOURCE` relationship
- No impact on Concept nodes or graph structure

### 2. Caption Generation
- Can use Browser Use's extracted text for caption
- Or call existing `summarize_pdf_text()` function
- Or use Browser Use's own summary if provided

### 3. Screenshot Handling
- If `screenshot_url` provided, could create additional `image` resource
- Or store in `metadata` field
- Or create separate screenshot resource linked to main resource

### 4. Metadata Storage
- Could store Browser Use metadata in Resource node properties
- Or create separate `BrowserUseMetadata` node with relationship
- Or store as JSON string in a `metadata` property

### 5. Error Handling
- Browser Use failures should return appropriate HTTP errors
- Partial success (e.g., screenshot but no text) should still create resource

---

## Example Integration Flow

```
1. User requests: "Fetch https://example.com/article for concept N12345678"
2. Backend calls Browser Use API/service
3. Browser Use returns:
   - extracted_text: "..."
   - screenshot_url: "..."
   - title: "Article Title"
4. Backend creates Resource:
   - kind: "web_link"
   - url: "https://example.com/article"
   - title: "Article Title"
   - caption: summarize(extracted_text)
   - source: "browser_use"
5. Backend links to Concept N12345678
6. Returns Resource to user
```

---

## Files to Modify

1. **`backend/api_resources.py`**: Add new endpoint
2. **`backend/services_resources.py`**: Add helper function
3. **`backend/models.py`**: Add request/response models (if needed)
4. **`backend/services_resource_ai.py`**: Reuse summarization (optional)

No changes needed to:
- Graph structure
- Concept nodes
- Existing resource endpoints
- Frontend (unless adding UI for Browser Use)

---

## Summary

**Current State**:
- Resources are separate nodes linked to Concepts
- File upload endpoint exists
- AI processing for images/PDFs
- Simple, extensible structure

**Browser Use Integration**:
- Add new endpoint or extend existing
- Accept URL + Browser Use results
- Create Resource node with `source="browser_use"`
- Optionally link to Concept
- No core graph changes needed

**Key Design Principle**: Resources are **decoupled** from Concepts - they're linked via relationships, so adding Browser Use as a provider doesn't affect existing graph logic.



