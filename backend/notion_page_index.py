"""
Notion page to lecture ID mapping for Brain Web
Tracks which lecture_ids were created from which Notion pages
"""
import json
from pathlib import Path
from typing import Dict, Any, List, Optional
from datetime import datetime, timezone

# State file for tracking page -> lecture mappings
PAGE_INDEX_FILE = Path(__file__).parent / "notion_page_index.json"


def load_page_index() -> Dict[str, Any]:
    """
    Load the page index from local JSON file.
    
    Returns:
        Dictionary mapping page_id -> {
            "lecture_ids": [list of lecture_ids],
            "last_ingested_at": ISO timestamp string
        }
    """
    if not PAGE_INDEX_FILE.exists():
        return {}
    
    try:
        with open(PAGE_INDEX_FILE, "r") as f:
            return json.load(f)
    except Exception as e:
        print(f"Warning: Failed to load page index: {e}")
        return {}


def save_page_index(index: Dict[str, Any]) -> None:
    """
    Save the page index to local JSON file.
    
    Args:
        index: Dictionary mapping page_id -> page info
    """
    try:
        with open(PAGE_INDEX_FILE, "w") as f:
            json.dump(index, f, indent=2)
    except Exception as e:
        print(f"Warning: Failed to save page index: {e}")


def add_lecture_for_page(page_id: str, lecture_id: str, page_title: Optional[str] = None) -> None:
    """
    Add a lecture_id to the list of lectures created from a page.
    If the page doesn't exist in the index, create it.
    
    Args:
        page_id: Notion page ID
        lecture_id: Lecture ID from ingestion
        page_title: Optional page title for display
    """
    index = load_page_index()
    
    if page_id not in index:
        index[page_id] = {
            "lecture_ids": [],
            "last_ingested_at": None,
            "page_title": None
        }
    
    # Add lecture_id if not already present
    if lecture_id not in index[page_id]["lecture_ids"]:
        index[page_id]["lecture_ids"].append(lecture_id)
    
    # Update page title if provided
    if page_title:
        index[page_id]["page_title"] = page_title
    
    # Update last ingested timestamp
    index[page_id]["last_ingested_at"] = datetime.now(timezone.utc).isoformat()
    
    save_page_index(index)


def get_lectures_for_page(page_id: str) -> List[str]:
    """
    Get all lecture_ids that were created from a given page.
    
    Args:
        page_id: Notion page ID
    
    Returns:
        List of lecture_ids (empty list if page not found)
    """
    index = load_page_index()
    page_info = index.get(page_id, {})
    return page_info.get("lecture_ids", [])


def remove_page_from_index(page_id: str) -> None:
    """
    Remove a page from the index (e.g., after unlinking).
    
    Args:
        page_id: Notion page ID
    """
    index = load_page_index()
    if page_id in index:
        del index[page_id]
        save_page_index(index)


def get_all_page_mappings() -> Dict[str, Any]:
    """
    Get the complete page index mapping.
    
    Returns:
        Dictionary mapping page_id -> page info
    """
    return load_page_index()
