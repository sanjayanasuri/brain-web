"""
Abstract interface for content sources (Notion, Obsidian, Roam, etc.)

This defines the contract that any content source must implement
to integrate with Brain Web.
"""
from abc import ABC, abstractmethod
from typing import List, Dict, Any, Optional
from datetime import datetime


class ContentSource(ABC):
    """
    Abstract base class for content sources.
    
    Any note-taking system can implement this interface to integrate with Brain Web.
    """
    
    @property
    @abstractmethod
    def source_type(self) -> str:
        """Return the source type identifier (e.g., 'notion', 'obsidian', 'roam')"""
        pass
    
    @abstractmethod
    def list_items(self) -> List[Dict[str, Any]]:
        """
        List all available items (pages, notes, etc.) from this source.
        
        Returns:
            List of dicts with at least:
            - id: str (unique identifier)
            - title: str
            - last_edited_time: Optional[str] (ISO format)
            - Any other metadata
        """
        pass
    
    @abstractmethod
    def get_item_content(self, item_id: str) -> tuple[str, str, Optional[str]]:
        """
        Get the content of a specific item.
        
        Args:
            item_id: Unique identifier for the item
        
        Returns:
            Tuple of (title, text_content, domain)
            - title: str
            - text_content: str (plain text, markdown, etc.)
            - domain: Optional[str] (can be inferred from folder, tags, etc.)
        """
        pass
    
    @abstractmethod
    def get_item_metadata(self, item_id: str) -> Dict[str, Any]:
        """
        Get metadata about an item without fetching full content.
        
        Args:
            item_id: Unique identifier
        
        Returns:
            Dict with metadata (title, last_edited, etc.)
        """
        pass


# Example implementations:

class NotionSource(ContentSource):
    """Notion implementation"""
    
    @property
    def source_type(self) -> str:
        return "notion"
    
    def list_items(self) -> List[Dict[str, Any]]:
        from notion_wrapper import get_database_pages
        from services_notion import list_notion_pages
        from config import NOTION_DATABASE_IDS
        
        items = []
        # Implementation using existing notion_wrapper
        # ...
        return items
    
    def get_item_content(self, item_id: str) -> tuple[str, str, Optional[str]]:
        from notion_sync import page_to_lecture
        from notion_wrapper import get_page
        
        page = get_page(item_id)
        title, text, domain = page_to_lecture(page)
        return (title, text, domain)
    
    def get_item_metadata(self, item_id: str) -> Dict[str, Any]:
        from notion_wrapper import get_page, get_page_title
        
        page = get_page(item_id)
        return {
            "id": item_id,
            "title": get_page_title(page),
            "last_edited_time": page.get("last_edited_time"),
        }


class ObsidianSource(ContentSource):
    """Obsidian implementation (example - reads local markdown files)"""
    
    def __init__(self, vault_path: str):
        from pathlib import Path
        self.vault_path = Path(vault_path).expanduser()
    
    @property
    def source_type(self) -> str:
        return "obsidian"
    
    def list_items(self) -> List[Dict[str, Any]]:
        items = []
        for md_file in self.vault_path.rglob("*.md"):
            stat = md_file.stat()
            items.append({
                "id": md_file.relative_to(self.vault_path).as_posix(),
                "title": md_file.stem,
                "last_edited_time": datetime.fromtimestamp(stat.st_mtime).isoformat(),
                "path": str(md_file),
            })
        return items
    
    def get_item_content(self, item_id: str) -> tuple[str, str, Optional[str]]:
        # Find file by ID
        file_path = self.vault_path / item_id
        if not file_path.exists():
            file_path = self.vault_path / f"{item_id}.md"
        
        if not file_path.exists():
            raise ValueError(f"Obsidian note {item_id} not found")
        
        content = file_path.read_text()
        title = file_path.stem
        
        # Infer domain from folder structure
        domain = None
        if "/" in item_id:
            folder = item_id.split("/")[0]
            domain = folder.replace("-", " ").title()
        
        return (title, content, domain)
    
    def get_item_metadata(self, item_id: str) -> Dict[str, Any]:
        file_path = self.vault_path / item_id
        if not file_path.exists():
            file_path = self.vault_path / f"{item_id}.md"
        
        if not file_path.exists():
            raise ValueError(f"Obsidian note {item_id} not found")
        
        stat = file_path.stat()
        return {
            "id": item_id,
            "title": file_path.stem,
            "last_edited_time": datetime.fromtimestamp(stat.st_mtime).isoformat(),
        }


# Unified sync function that works with any source
def sync_source_once(source: ContentSource) -> Dict[str, Any]:
    """
    Sync a content source to the graph.
    Works with any ContentSource implementation.
    """
    from notion_index_state import load_index_state, is_page_indexed
    from notion_page_index import add_lecture_for_source
    from services_lecture_ingestion import ingest_lecture
    from db_neo4j import get_neo4j_session
    
    stats = {
        "items_checked": 0,
        "items_ingested": 0,
        "nodes_created": 0,
        "nodes_updated": 0,
        "links_created": 0,
        "errors": [],
    }
    
    # Load index state (would need to be generalized)
    index_state = load_index_state()
    
    # Get all items from source
    items = source.list_items()
    stats["items_checked"] = len(items)
    
    # Get Neo4j session
    session_gen = get_neo4j_session()
    session = next(session_gen)
    
    try:
        for item in items:
            item_id = item["id"]
            
            # Check if indexed (would need generalization)
            if not is_page_indexed(item_id, index_state):
                continue
            
            try:
                # Get content
                title, text, domain = source.get_item_content(item_id)
                
                if not title or not text:
                    continue
                
                # Ingest (same for all sources!)
                result = ingest_lecture(
                    session=session,
                    lecture_title=title,
                    lecture_text=text,
                    domain=domain,
                )
                
                # Track mapping (would need generalization)
                add_lecture_for_source(source.source_type, item_id, result.lecture_id)
                
                stats["items_ingested"] += 1
                stats["nodes_created"] += len(result.nodes_created)
                stats["nodes_updated"] += len(result.nodes_updated)
                stats["links_created"] += len(result.links_created)
                
            except Exception as e:
                stats["errors"].append(f"Failed to ingest {item_id}: {str(e)}")
    
    finally:
        try:
            next(session_gen, None)
        except StopIteration:
            pass
    
    return stats


# Example usage:
if __name__ == "__main__":
    # Sync Notion
    notion = NotionSource()
    notion_stats = sync_source_once(notion)
    print(f"Notion sync: {notion_stats}")
    
    # Sync Obsidian (if configured)
    # obsidian = ObsidianSource("~/Documents/Obsidian")
    # obsidian_stats = sync_source_once(obsidian)
    # print(f"Obsidian sync: {obsidian_stats}")
