

from fastapi import APIRouter, HTTPException, Depends, Query
from typing import List, Optional
from pydantic import BaseModel

# Import the script modules as Python modules, not as CLI scripts
from scripts import import_csv_to_neo4j, export_csv_from_neo4j
from notion_sync import sync_once
from notion_index_state import load_index_state, is_page_indexed, set_page_indexed, set_index_mode
from notion_page_index import get_lectures_for_page, remove_page_from_index
from services_notion import list_notion_pages, list_notion_databases
from notion_wrapper import get_page_title
from config import NOTION_DATABASE_IDS
from notion_wrapper import get_database_pages
from services_graph import unlink_lecture, get_notion_config, update_notion_config
from db_neo4j import get_neo4j_session
from models import NotionConfig

router = APIRouter(prefix="/admin", tags=["admin"])


class NotionPageIndexRequest(BaseModel):
    page_id: str
    include: bool


class NotionUnlinkPageRequest(BaseModel):
    page_id: str


@router.post("/import")
def run_import():
    """
    Admin-only endpoint: run CSV -> Neo4j import.

    WARNING: This is powerful. In a real deployment, protect this with auth.
    """
    try:
        import_csv_to_neo4j.main()
        return {"status": "ok", "action": "import", "detail": "CSV import completed"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/export")
def run_export():
    """
    Admin-only endpoint: export current Neo4j graph to CSV.
    """
    try:
        export_csv_from_neo4j.main()
        return {"status": "ok", "action": "export", "detail": "CSV export completed"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/sync-notion")
def sync_notion_endpoint(force_full: bool = Query(False, description="If True, sync all pages regardless of last sync timestamp")):
    """
    Runs a single Notion sync cycle.
    Useful for manual testing before enabling background sync.
    
    Query params:
        force_full: If True, sync all pages regardless of last sync timestamp
    
    Returns:
        Dictionary with sync statistics:
        - pages_checked: Number of pages checked
        - pages_ingested: Number of pages successfully ingested
        - nodes_created: Total nodes created across all pages
        - nodes_updated: Total nodes updated across all pages
        - links_created: Total relationships created
        - errors: List of error messages (if any)
    """
    try:
        result = sync_once(force_full=force_full)
        return {
            "status": "ok",
            "action": "sync-notion",
            "force_full": force_full,
            **result
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Notion sync failed: {str(e)}")


@router.get("/notion/pages")
def list_notion_pages_with_index_status():
    """
    List all Notion pages from configured databases with their indexing status.
    
    Returns:
        List of page objects with:
        - page_id: Notion page ID
        - title: Page title
        - last_edited_time: Last edited timestamp
        - database_id: Database ID (if from database)
        - indexed: Whether the page is currently indexed
    """
    try:
        index_state = load_index_state()
        all_pages = []
        
        # Get pages from configured databases
        databases_to_process = []
        if NOTION_DATABASE_IDS:
            databases_to_process = [{"id": db_id} for db_id in NOTION_DATABASE_IDS]
        else:
            # Auto-discover databases
            try:
                databases_to_process = list_notion_databases()
            except Exception as e:
                print(f"Warning: Failed to list databases: {e}")
                databases_to_process = []
        
        # Process pages from databases
        for db_info in databases_to_process:
            db_id = db_info.get("id") if isinstance(db_info, dict) else db_info
            db_name = db_info.get("title") if isinstance(db_info, dict) else None
            
            try:
                db_pages = get_database_pages(db_id, filter_conditions=None)
                for page in db_pages:
                    page_id = page.get("id")
                    if not page_id:
                        continue
                    
                    title = get_page_title(page)
                    last_edited = page.get("last_edited_time", "")
                    
                    all_pages.append({
                        "page_id": page_id,
                        "title": title,
                        "last_edited_time": last_edited,
                        "database_id": db_id,
                        "database_name": db_name,
                        "indexed": is_page_indexed(page_id, index_state)
                    })
            except Exception as e:
                print(f"Error querying database {db_id}: {e}")
                continue
        
        # Also get standalone pages if no databases configured
        if not NOTION_DATABASE_IDS:
            try:
                page_list = list_notion_pages()
                for page_info in page_list:
                    page_id = page_info.get("id")
                    if not page_id:
                        continue
                    
                    # Check if it's actually a standalone page
                    try:
                        from notion_wrapper import get_page
                        full_page = get_page(page_id)
                        parent = full_page.get("parent", {})
                        if parent.get("type") == "database_id":
                            # Already processed above
                            continue
                    except Exception:
                        pass
                    
                    all_pages.append({
                        "page_id": page_id,
                        "title": page_info.get("title", "Untitled"),
                        "last_edited_time": "",
                        "database_id": None,
                        "database_name": None,
                        "indexed": is_page_indexed(page_id, index_state)
                    })
            except Exception as e:
                print(f"Warning: Failed to process standalone pages: {e}")
        
        return all_pages
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to list Notion pages: {str(e)}")


@router.post("/notion/pages/index")
def toggle_page_indexing(payload: NotionPageIndexRequest):
    """
    Toggle whether a Notion page should be indexed.
    
    Args:
        payload: Request with page_id and include (true to include, false to exclude)
    
    Returns:
        Updated state information
    """
    try:
        state = set_page_indexed(payload.page_id, payload.include)
        return {
            "status": "ok",
            "page_id": payload.page_id,
            "include": payload.include,
            "indexed": is_page_indexed(payload.page_id, state)
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to update page indexing: {str(e)}")


@router.post("/notion/index-mode")
def set_notion_index_mode(payload: dict):
    """
    Set the Notion indexing mode.
    
    Args:
        payload: {"mode": "allowlist" | "blocklist"}
    
    Returns:
        Updated state information
    """
    mode = payload.get("mode")
    if mode not in ["allowlist", "blocklist"]:
        raise HTTPException(status_code=400, detail="mode must be 'allowlist' or 'blocklist'")
    
    try:
        state = set_index_mode(mode)
        return {
            "status": "ok",
            "mode": state["mode"],
            "allow_count": len(state.get("allow", [])),
            "block_count": len(state.get("block", []))
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to set index mode: {str(e)}")


@router.get("/notion/index-state")
def get_notion_index_state():
    """
    Get the current Notion indexing state.
    
    Returns:
        Current state with mode, allow list, and block list
    """
    try:
        state = load_index_state()
        return {
            "mode": state.get("mode", "allowlist"),
            "allow": state.get("allow", []),
            "block": state.get("block", []),
            "allow_count": len(state.get("allow", [])),
            "block_count": len(state.get("block", []))
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to get index state: {str(e)}")


@router.get("/notion/sync-history")
def get_notion_sync_history(limit: int = 20):
    """
    Get recent Notion sync activity history.
    
    Args:
        limit: Maximum number of recent pages to return
    
    Returns:
        List of recent page sync activities with page info and status
    """
    try:
        from notion_page_index import get_all_page_mappings
        from notion_sync import load_last_sync_timestamp
        from notion_wrapper import get_page_title
        
        page_index = get_all_page_mappings()
        last_sync = load_last_sync_timestamp()
        
        # Convert to list and sort by last_ingested_at (most recent first)
        pages = []
        for page_id, page_info in page_index.items():
            page_title = page_info.get("page_title")
            
            # If page_title is missing, try to fetch it from Notion API
            if not page_title or page_title == "Untitled":
                try:
                    from notion_wrapper import get_page
                    page = get_page(page_id)
                    if page:
                        page_title = get_page_title(page)
                        # Update the index with the fetched title for future use
                        if page_title and page_title != "Untitled":
                            from notion_page_index import add_lecture_for_page
                            # Update just the title without changing lecture_ids
                            existing_lecture_ids = page_info.get("lecture_ids", [])
                            if existing_lecture_ids:
                                # Re-add with the title to update it
                                add_lecture_for_page(page_id, existing_lecture_ids[0], page_title)
                except Exception as e:
                    # If fetching fails, keep the existing title or use "Untitled"
                    print(f"Warning: Could not fetch title for page {page_id}: {e}")
                    pass
            
            pages.append({
                "page_id": page_id,
                "page_title": page_title or "Untitled",
                "lecture_ids": page_info.get("lecture_ids", []),
                "last_ingested_at": page_info.get("last_ingested_at"),
                "status": "synced" if page_info.get("last_ingested_at") else "not_synced"
            })
        
        # Sort by last_ingested_at descending
        pages.sort(key=lambda x: x.get("last_ingested_at") or "", reverse=True)
        
        return {
            "last_sync": last_sync.isoformat() if last_sync else None,
            "recent_pages": pages[:limit],
            "total_pages": len(pages)
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to get sync history: {str(e)}")


@router.post("/notion/unlink-page")
def unlink_notion_page(payload: NotionUnlinkPageRequest):
    """
    Unlink a Notion page from the graph by removing nodes that only came from it.
    
    Behavior:
    - Gets all lecture_ids associated with the page
    - For each lecture_id, calls unlink_lecture which:
        - Deletes nodes that only have that lecture_id as a source
        - Updates nodes with multiple sources by removing the lecture_id
    - Removes page from page index
    - Marks page as not indexed in index state
    
    Args:
        payload: Request with page_id
    
    Returns:
        Dictionary with stats: nodes_deleted, nodes_updated, relationships_deleted
    """
    try:
        page_id = payload.page_id
        
        # Get all lecture_ids for this page
        lecture_ids = get_lectures_for_page(page_id)
        
        if not lecture_ids:
            return {
                "status": "ok",
                "page_id": page_id,
                "lecture_ids": [],
                "nodes_deleted": 0,
                "nodes_updated": 0,
                "relationships_deleted": 0,
                "message": "No lectures found for this page"
            }
        
        # Get Neo4j session
        session_gen = get_neo4j_session()
        session = next(session_gen)
        
        try:
            # Aggregate stats across all lectures
            total_nodes_deleted = 0
            total_nodes_updated = 0
            total_relationships_deleted = 0
            
            # Unlink each lecture
            for lecture_id in lecture_ids:
                stats = unlink_lecture(session, lecture_id)
                total_nodes_deleted += stats["nodes_deleted"]
                total_nodes_updated += stats["nodes_updated"]
                total_relationships_deleted += stats["relationships_deleted"]
            
            # Remove page from index
            remove_page_from_index(page_id)
            
            # Mark page as not indexed
            set_page_indexed(page_id, False)
            
            return {
                "status": "ok",
                "page_id": page_id,
                "lecture_ids": lecture_ids,
                "nodes_deleted": total_nodes_deleted,
                "nodes_updated": total_nodes_updated,
                "relationships_deleted": total_relationships_deleted
            }
        finally:
            # Close session
            try:
                next(session_gen, None)
            except StopIteration:
                pass
            except Exception:
                pass
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to unlink page: {str(e)}")


@router.get("/notion-config", response_model=NotionConfig)
def get_notion_config_endpoint(session=Depends(get_neo4j_session)):
    """
    Get the Notion sync configuration.
    Returns which databases are configured for sync and whether auto-sync is enabled.
    """
    return get_notion_config(session)


@router.post("/notion-config", response_model=NotionConfig)
def update_notion_config_endpoint(config: NotionConfig, session=Depends(get_neo4j_session)):
    """
    Update the Notion sync configuration.
    Sets which databases should be synced and whether to enable auto-sync.
    """
    return update_notion_config(session, config)
