# Multi-Source Architecture Design

## Current Architecture

The ingestion pipeline is **already source-agnostic**! The core function `ingest_lecture()` only needs:
- `lecture_title: str`
- `lecture_text: str`
- `domain: Optional[str]`

It doesn't care if the text comes from Notion, Obsidian, Roam, or anywhere else.

## How to Add New Sources

### Step 1: Create a Source Wrapper

Create a new file like `obsidian_wrapper.py` or `roam_wrapper.py`:

```python
# backend/obsidian_wrapper.py
"""
Obsidian API client wrapper
"""
from typing import List, Dict, Any
import os

# Example: if Obsidian has an API
OBSIDIAN_API_KEY = os.getenv("OBSIDIAN_API_KEY")

def get_obsidian_note(note_id: str) -> Dict[str, Any]:
    """Fetch a single Obsidian note"""
    # Implementation depends on Obsidian's API
    pass

def list_obsidian_notes() -> List[Dict[str, Any]]:
    """List all Obsidian notes"""
    pass

def extract_text_from_note(note: Dict[str, Any]) -> str:
    """Extract plain text from Obsidian note format"""
    pass
```

### Step 2: Create a Source Sync Module

Create `obsidian_sync.py` (similar to `notion_sync.py`):

```python
# backend/obsidian_sync.py
"""
Obsidian auto-sync service
"""
from obsidian_wrapper import get_obsidian_note, list_obsidian_notes, extract_text_from_note
from services_lecture_ingestion import ingest_lecture
from source_index_state import load_index_state, is_source_indexed  # Generalized
from source_page_index import add_lecture_for_source  # Generalized
from db_neo4j import get_neo4j_session

def sync_obsidian_once():
    """Sync Obsidian notes to graph"""
    # 1. Get list of notes
    # 2. Check index state (is this note indexed?)
    # 3. For each indexed note:
    #    - Extract text
    #    - Call ingest_lecture()
    #    - Track mapping (note_id -> lecture_id)
    pass
```

### Step 3: Generalize Index State Management

Rename/extend the index state to support multiple sources:

```python
# backend/source_index_state.py
"""
Generalized source indexing state (supports Notion, Obsidian, etc.)
"""
import json
from pathlib import Path
from typing import Dict, Any

INDEX_STATE_FILE = Path(__file__).parent / "source_index_state.json"

def load_index_state(source_type: str = "notion") -> Dict[str, Any]:
    """Load index state for a specific source type"""
    # Structure: { "notion": {...}, "obsidian": {...}, ... }
    pass

def is_source_indexed(source_type: str, source_id: str) -> bool:
    """Check if a source item is indexed"""
    pass
```

### Step 4: Create API Endpoints

Add endpoints in `api_admin.py` or create `api_obsidian.py`:

```python
# backend/api_obsidian.py
@router.get("/obsidian/notes")
def list_obsidian_notes_with_index_status():
    """List Obsidian notes with indexing status"""
    pass

@router.post("/obsidian/notes/index")
def toggle_obsidian_note_indexing(payload: ObsidianNoteIndexRequest):
    """Toggle whether an Obsidian note should be indexed"""
    pass
```

## Example: Adding Obsidian Support

### Option A: Obsidian via Local Files

If Obsidian stores notes as markdown files:

```python
# backend/obsidian_wrapper.py
from pathlib import Path
from typing import List, Dict, Any

OBSIDIAN_VAULT_PATH = Path(os.getenv("OBSIDIAN_VAULT_PATH", "~/Documents/Obsidian"))

def list_obsidian_notes() -> List[Dict[str, Any]]:
    """List all .md files in Obsidian vault"""
    notes = []
    for md_file in OBSIDIAN_VAULT_PATH.rglob("*.md"):
        notes.append({
            "id": md_file.stem,
            "title": md_file.stem,
            "path": str(md_file),
            "last_modified": md_file.stat().st_mtime
        })
    return notes

def get_note_text(note_id: str) -> str:
    """Read markdown file content"""
    # Find file by ID
    for md_file in OBSIDIAN_VAULT_PATH.rglob("*.md"):
        if md_file.stem == note_id:
            return md_file.read_text()
    raise ValueError(f"Note {note_id} not found")
```

### Option B: Obsidian via API (if they add one)

```python
# backend/obsidian_wrapper.py
import requests

OBSIDIAN_API_URL = os.getenv("OBSIDIAN_API_URL")
OBSIDIAN_API_KEY = os.getenv("OBSIDIAN_API_KEY")

def list_obsidian_notes() -> List[Dict[str, Any]]:
    """Call Obsidian API to list notes"""
    response = requests.get(
        f"{OBSIDIAN_API_URL}/notes",
        headers={"Authorization": f"Bearer {OBSIDIAN_API_KEY}"}
    )
    return response.json()
```

## Example: Adding Roam Research Support

Roam has an API:

```python
# backend/roam_wrapper.py
import requests

ROAM_API_KEY = os.getenv("ROAM_API_KEY")
ROAM_GRAPH_ID = os.getenv("ROAM_GRAPH_ID")

def list_roam_pages() -> List[Dict[str, Any]]:
    """List all pages in Roam graph"""
    response = requests.post(
        "https://roamresearch.com/api/graph",
        json={"action": "q", "query": "[:find ?title :where [?e :node/title ?title]]"},
        headers={"Authorization": f"Bearer {ROAM_API_KEY}"}
    )
    return response.json()

def get_roam_page_content(page_title: str) -> str:
    """Get content of a Roam page"""
    # Implementation depends on Roam API
    pass
```

## Unified Admin UI

The frontend admin UI could be generalized:

```typescript
// frontend/app/source-admin/page.tsx
export default function SourceAdminPage() {
  const [sources, setSources] = useState<SourceType[]>(['notion', 'obsidian', 'roam']);
  const [selectedSource, setSelectedSource] = useState('notion');
  
  // Show items for selected source
  // Toggle indexing
  // Unlink items
}
```

## Benefits of This Architecture

1. **Modular**: Each source is independent
2. **Reusable**: Same ingestion pipeline for all sources
3. **Extensible**: Easy to add new sources
4. **Unified**: Same graph, same visualization, same search

## Migration Path

1. **Phase 1**: Keep Notion-specific code as-is (backward compatible)
2. **Phase 2**: Create generalized `source_index_state.py` that wraps notion_index_state
3. **Phase 3**: Add new sources one at a time
4. **Phase 4**: Unified admin UI for all sources

## Current State

Right now, the system is **Notion-specific** but the **ingestion is generic**. To add other sources:

1. ✅ Ingestion pipeline: Already generic ✓
2. ⚠️ Index state: Currently Notion-specific (needs generalization)
3. ⚠️ Page mapping: Currently Notion-specific (needs generalization)
4. ⚠️ Admin UI: Currently Notion-specific (needs generalization)

The good news: The hard part (LLM extraction, graph storage) is already done! You just need to add source-specific wrappers and generalize the indexing layer.
