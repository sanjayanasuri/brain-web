

from fastapi import APIRouter, HTTPException, Depends, Query, Request
from typing import List, Optional, Dict, Any
from pydantic import BaseModel
from pathlib import Path
import os
from datetime import datetime

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
from auth import require_auth

router = APIRouter(prefix="/admin", tags=["admin"])


class NotionPageIndexRequest(BaseModel):
    page_id: str
    include: bool


class NotionUnlinkPageRequest(BaseModel):
    page_id: str


@router.post("/import")
def run_import(auth: dict = Depends(require_auth)):
    """
    Admin-only endpoint: run CSV -> Neo4j import.
    
    Requires authentication.
    """
    try:
        import_csv_to_neo4j.main()
        # Invalidate graph overview cache so changes are immediately visible
        from cache_utils import invalidate_cache_pattern
        invalidate_cache_pattern("graph_overview")
        return {"status": "ok", "action": "import", "detail": "CSV import completed"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/export")
def run_export(
    per_graph: bool = Query(True, description="Also export separate CSV files for each graph"),
    auth: dict = Depends(require_auth),
):
    """
    Admin-only endpoint: export current Neo4j graph to CSV.
    
    Requires authentication.
    
    Args:
        per_graph: If True (default), exports separate CSV files for each graph
                  (e.g., nodes_G{graph_id}.csv) in addition to the combined files.
    """
    try:
        export_csv_from_neo4j.main(graph_id=None, export_per_graph=per_graph)
        return {
            "status": "ok",
            "action": "export",
            "per_graph": per_graph,
            "detail": "CSV export completed" + (" (including per-graph files)" if per_graph else "")
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/sync-notion")
def sync_notion_endpoint(
    force_full: bool = Query(False, description="If True, sync all pages regardless of last sync timestamp"),
    auth: dict = Depends(require_auth),
):
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
def list_notion_pages_with_index_status(auth: dict = Depends(require_auth)):
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
def toggle_page_indexing(payload: NotionPageIndexRequest, auth: dict = Depends(require_auth)):
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
def set_notion_index_mode(payload: dict, auth: dict = Depends(require_auth)):
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
def get_notion_index_state(auth: dict = Depends(require_auth)):
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
def get_notion_sync_history(limit: int = 20, auth: dict = Depends(require_auth)):
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
def unlink_notion_page(payload: NotionUnlinkPageRequest, auth: dict = Depends(require_auth)):
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
def get_notion_config_endpoint(
    session=Depends(get_neo4j_session),
    auth: dict = Depends(require_auth),
):
    """
    Get the Notion sync configuration.
    Returns which databases are configured for sync and whether auto-sync is enabled.
    """
    return get_notion_config(session)


@router.post("/notion-config", response_model=NotionConfig)
def update_notion_config_endpoint(
    config: NotionConfig,
    session=Depends(get_neo4j_session),
    auth: dict = Depends(require_auth),
):
    """
    Update the Notion sync configuration.
    Sets which databases should be synced and whether to enable auto-sync.
    """
    return update_notion_config(session, config)


@router.get("/graph-files/preview/{filename}")
def preview_graph_file(
    filename: str,
    lines: int = Query(10, ge=1, le=50, description="Number of lines to preview"),
    auth: dict = Depends(require_auth),
):
    """
    Preview the first few lines of a CSV file.
    
    Args:
        filename: Name of the CSV file to preview
        lines: Number of lines to return (default: 10, max: 50)
    
    Returns:
        Dictionary with:
        - filename: File name
        - total_lines: Total number of lines in file (approximate)
        - preview_lines: List of lines (first N lines)
        - headers: CSV headers if available
    """
    try:
        BASE_DIR = Path(__file__).resolve().parent
        GRAPH_DIR = BASE_DIR.parent / "graph"
        file_path = GRAPH_DIR / filename
        
        # Security: ensure file is in graph directory and is CSV
        if not file_path.exists():
            raise HTTPException(status_code=404, detail=f"File not found: {filename}")
        if file_path.suffix.lower() != '.csv':
            raise HTTPException(status_code=400, detail="Only CSV files can be previewed")
        if not str(file_path.resolve()).startswith(str(GRAPH_DIR.resolve())):
            raise HTTPException(status_code=403, detail="Access denied")
        
        import csv
        preview_lines = []
        headers = None
        total_lines = 0
        
        with file_path.open('r', encoding='utf-8') as f:
            reader = csv.reader(f)
            for i, row in enumerate(reader):
                total_lines += 1
                if i == 0:
                    headers = row
                if i < lines:
                    preview_lines.append(row)
        
        return {
            "filename": filename,
            "total_lines": total_lines,
            "preview_lines": preview_lines,
            "headers": headers,
            "previewed_lines": len(preview_lines)
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to preview file: {str(e)}")


@router.get("/graph-files/download/{filename}")
def download_graph_file(filename: str, auth: dict = Depends(require_auth)):
    """
    Download a CSV file from the graph directory.
    
    Args:
        filename: Name of the CSV file to download
    
    Returns:
        FileResponse with the CSV file
    """
    from fastapi.responses import FileResponse
    
    try:
        BASE_DIR = Path(__file__).resolve().parent
        GRAPH_DIR = BASE_DIR.parent / "graph"
        file_path = GRAPH_DIR / filename
        
        # Security checks
        if not file_path.exists():
            raise HTTPException(status_code=404, detail=f"File not found: {filename}")
        if file_path.suffix.lower() != '.csv':
            raise HTTPException(status_code=400, detail="Only CSV files can be downloaded")
        if not str(file_path.resolve()).startswith(str(GRAPH_DIR.resolve())):
            raise HTTPException(status_code=403, detail="Access denied")
        
        return FileResponse(
            path=str(file_path),
            filename=filename,
            media_type='text/csv',
            headers={"Content-Disposition": f'attachment; filename="{filename}"'}
        )
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to download file: {str(e)}")


@router.get("/graph-files")
def list_graph_files(auth: dict = Depends(require_auth)):
    """
    List all files in the graph directory with metadata.
    Useful for development/debugging to see which CSV files make up the knowledge graph.
    
    Returns:
        List of file objects with:
        - name: File name
        - path: Relative path from project root
        - size: File size in bytes
        - size_formatted: Human-readable file size
        - modified: Last modified timestamp (ISO format)
        - modified_formatted: Human-readable last modified time
        - type: File type (csv, etc.)
        - description: Description of what the file contains
    """
    try:
        # Get graph directory path (same logic as export script)
        BASE_DIR = Path(__file__).resolve().parent  # /backend
        GRAPH_DIR = BASE_DIR.parent / "graph"       # /graph
        
        if not GRAPH_DIR.exists():
            return {
                "status": "error",
                "message": f"Graph directory not found: {GRAPH_DIR}",
                "files": []
            }
        
        files = []
        
        # File descriptions mapping
        file_descriptions = {
            "nodes_semantic.csv": "All concept nodes from all graphs (combined)",
            "edges_semantic.csv": "All relationships from all graphs (combined)",
            "lecture_covers_export.csv": "Lecture-to-concept coverage mappings",
            "lecture_covers_L001.csv": "Lecture L001 coverage mappings",
            "lectures.csv": "Lecture metadata",
            "demo_nodes.csv": "Demo dataset - concept nodes",
            "demo_edges.csv": "Demo dataset - relationships",
        }
        
        # Helper to extract graph_id from per-graph filenames
        def get_graph_id_from_filename(filename: str) -> Optional[str]:
            """Extract graph_id from filenames like nodes_G0F87FFD7.csv"""
            import re
            match = re.match(r'^(nodes|edges)_G([A-Z0-9]+)\.csv$', filename)
            if match:
                return match.group(2)
            return None
        
        # Helper to get graph name from graph_id
        def get_graph_name(graph_id: str) -> Optional[str]:
            """Get graph name from graph_id"""
            try:
                from services_branch_explorer import list_graphs, get_driver
                driver = get_driver()
                with driver.session() as session:
                    graphs = list_graphs(session)
                    for graph in graphs:
                        if graph.get("graph_id") == graph_id:
                            return graph.get("name")
            except Exception:
                pass
            return None
        
        # Scan directory for CSV files
        for file_path in sorted(GRAPH_DIR.iterdir()):
            if not file_path.is_file():
                continue
            
            # Only show CSV files
            if file_path.suffix.lower() != '.csv':
                continue
            
            stat = file_path.stat()
            size = stat.st_size
            modified = datetime.fromtimestamp(stat.st_mtime)
            
            # Format file size
            if size < 1024:
                size_formatted = f"{size} B"
            elif size < 1024 * 1024:
                size_formatted = f"{size / 1024:.1f} KB"
            else:
                size_formatted = f"{size / (1024 * 1024):.1f} MB"
            
            # Format modified time
            modified_formatted = modified.strftime("%Y-%m-%d %H:%M:%S")
            
            # Check if file was recently modified (within last hour)
            time_since_modified = datetime.now() - modified
            recently_changed = time_since_modified.total_seconds() < 3600  # 1 hour
            
            file_name = file_path.name
            description = file_descriptions.get(file_name, "Graph data file")
            
            # Check if this is a per-graph file
            graph_id = get_graph_id_from_filename(file_name)
            graph_name = None
            if graph_id:
                graph_name = get_graph_name(graph_id)
                if graph_name:
                    description = f"Nodes for graph: {graph_name} (graph_id: {graph_id})" if file_name.startswith("nodes_") else f"Edges for graph: {graph_name} (graph_id: {graph_id})"
                else:
                    description = f"Nodes for graph_id: {graph_id}" if file_name.startswith("nodes_") else f"Edges for graph_id: {graph_id}"
            
            files.append({
                "name": file_name,
                "path": str(file_path.relative_to(BASE_DIR.parent)),  # Relative to project root
                "size": size,
                "size_formatted": size_formatted,
                "modified": modified.isoformat(),
                "modified_formatted": modified_formatted,
                "type": "csv",
                "description": description,
                "graph_id": graph_id,
                "graph_name": graph_name,
                "recently_changed": recently_changed
            })
        
        # Sort files: recently changed first, then by modified time (newest first)
        files.sort(key=lambda f: (not f.get("recently_changed", False), f["modified"]), reverse=True)
        
        return {
            "status": "ok",
            "graph_dir": str(GRAPH_DIR),
            "files": files,
            "total_files": len(files),
            "total_size": sum(f["size"] for f in files),
            "total_size_formatted": format(sum(f["size"] for f in files) / (1024 * 1024), ".1f") + " MB" if sum(f["size"] for f in files) > 1024 * 1024 else format(sum(f["size"] for f in files) / 1024, ".1f") + " KB"
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to list graph files: {str(e)}")
