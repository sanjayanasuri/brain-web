"""
Notion auto-sync service for Brain Web
Polls Notion databases for updated pages and ingests them as lectures

Do not call backend endpoints from backend services. Use ingestion kernel/internal services to prevent ingestion path drift.
"""
import json
from datetime import datetime, timezone
from pathlib import Path
from typing import List, Dict, Any, Optional, Tuple
from neo4j import Session

from service_notion_wrapper import get_page, get_page_blocks, get_database_pages, extract_plaintext_from_blocks, get_page_title, get_page_domain
from services_ingestion_kernel import ingest_artifact
from models_ingestion_kernel import ArtifactInput, IngestionActions, IngestionPolicy
from services_notion import list_notion_databases, list_notion_pages
from config import NOTION_DATABASE_IDS
from db_neo4j import get_neo4j_session
from service_notion_index_state import load_index_state, is_page_indexed, set_page_indexed
from service_notion_page_index import add_lecture_for_page

# State file for tracking last sync timestamp
SYNC_STATE_FILE = Path(__file__).parent / "notion_sync_state.json"


def load_last_sync_timestamp() -> Optional[datetime]:
    """
    Load the last sync timestamp from local state file.
    
    Returns:
        datetime object or None if no previous sync
    """
    if not SYNC_STATE_FILE.exists():
        return None
    
    try:
        with open(SYNC_STATE_FILE, "r") as f:
            data = json.load(f)
            timestamp_str = data.get("last_sync_timestamp")
            if timestamp_str:
                # Parse ISO format timestamp
                return datetime.fromisoformat(timestamp_str.replace("Z", "+00:00"))
    except Exception as e:
        print(f"Warning: Failed to load sync state: {e}")
    
    return None


def save_last_sync_timestamp(dt: datetime) -> None:
    """
    Save the last sync timestamp to local state file.
    
    Args:
        dt: datetime object to save
    """
    try:
        # Ensure timezone-aware
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        
        data = {
            "last_sync_timestamp": dt.isoformat(),
        }
        
        with open(SYNC_STATE_FILE, "w") as f:
            json.dump(data, f, indent=2)
    except Exception as e:
        print(f"Warning: Failed to save sync state: {e}")


def find_updated_pages_since(timestamp: Optional[datetime]) -> List[Dict[str, Any]]:
    """
    Find all pages in tracked databases that were updated since the given timestamp.
    
    If NOTION_DATABASE_IDS is empty, automatically discovers and processes ALL databases
    and standalone pages that the Notion integration has access to.
    
    Args:
        timestamp: datetime to compare against (None means get all pages)
    
    Returns:
        List of page objects from Notion
    """
    all_pages = []
    
    # Determine which databases to process
    databases_to_process = []
    
    if NOTION_DATABASE_IDS:
        # Use explicitly configured databases
        print(f"[Notion Sync] Using {len(NOTION_DATABASE_IDS)} configured database(s)")
        databases_to_process = [{"id": db_id} for db_id in NOTION_DATABASE_IDS]
    else:
        # Auto-discover all databases
        print("[Notion Sync] No databases configured - auto-discovering all databases...")
        try:
            databases_to_process = list_notion_databases()
            print(f"[Notion Sync] Found {len(databases_to_process)} database(s)")
        except Exception as e:
            print(f"[Notion Sync] Warning: Failed to list databases: {e}")
            databases_to_process = []
    
    # Process pages from databases
    for db_info in databases_to_process:
        db_id = db_info.get("id") if isinstance(db_info, dict) else db_info
        db_name = db_info.get("title") if isinstance(db_info, dict) else None
        try:
            # Query all pages from database
            # Note: Notion API doesn't support filtering by last_edited_time directly
            # So we query all pages and filter in Python
            all_db_pages = get_database_pages(db_id, filter_conditions=None)
            
            # Filter pages updated since timestamp
            if timestamp:
                filtered_pages = []
                skipped_old = 0
                for page in all_db_pages:
                    last_edited = page.get("last_edited_time")
                    if last_edited:
                        # Parse Notion's timestamp format
                        try:
                            # Notion returns ISO format strings
                            page_time = datetime.fromisoformat(last_edited.replace("Z", "+00:00"))
                            if page_time > timestamp:
                                filtered_pages.append(page)
                            else:
                                skipped_old += 1
                        except Exception:
                            # If parsing fails, include the page to be safe
                            filtered_pages.append(page)
                    else:
                        # If no last_edited_time, include it to be safe
                        filtered_pages.append(page)
                pages = filtered_pages
                if skipped_old > 0:
                    print(f"[Notion Sync] Filtered out {skipped_old} page(s) from database '{db_name or db_id}' (not updated since last sync)")
            else:
                # No timestamp filter - return all pages
                pages = all_db_pages
            
            all_pages.extend(pages)
            db_label = db_name or db_id
            print(f"[Notion Sync] Found {len(pages)} updated pages in database '{db_label}'")
        except Exception as e:
            print(f"[Notion Sync] Error querying database {db_id}: {e}")
            continue
    
    # If no databases configured, also process standalone pages (not in databases)
    if not NOTION_DATABASE_IDS:
        print("[Notion Sync] Processing standalone pages (not in databases)...")
        try:
            # Get list of all pages (this includes both database pages and standalone pages)
            page_list = list_notion_pages()
            
            # Fetch full page objects and filter by timestamp
            standalone_pages = []
            skipped_timestamp = 0
            skipped_database = 0
            for page_info in page_list:
                page_id = page_info.get("id")
                if not page_id:
                    continue
                
                try:
                    # Get full page object
                    full_page = get_page(page_id)
                    
                    # Check if it's actually a standalone page (not in a database)
                    parent = full_page.get("parent", {})
                    if parent.get("type") == "database_id":
                        # This page is in a database, skip it (already processed above)
                        skipped_database += 1
                        continue
                    
                    # Filter by timestamp if provided
                    if timestamp:
                        last_edited = full_page.get("last_edited_time")
                        if last_edited:
                            try:
                                page_time = datetime.fromisoformat(last_edited.replace("Z", "+00:00"))
                                if page_time <= timestamp:
                                    # Page not updated since last sync, skip
                                    skipped_timestamp += 1
                                    continue
                            except Exception:
                                # If parsing fails, include the page to be safe
                                pass
                    
                    standalone_pages.append(full_page)
                except Exception as e:
                    print(f"[Notion Sync] Warning: Could not fetch page {page_id}: {e}")
                    continue
            
            if skipped_timestamp > 0 or skipped_database > 0:
                print(f"[Notion Sync] Filtered out: {skipped_timestamp} pages (not updated since last sync), {skipped_database} pages (in databases)")
            
            all_pages.extend(standalone_pages)
            print(f"[Notion Sync] Found {len(standalone_pages)} standalone page(s)")
        except Exception as e:
            print(f"[Notion Sync] Warning: Failed to process standalone pages: {e}")
    
    print(f"[Notion Sync] Total pages to process: {len(all_pages)}")
    return all_pages


def page_to_lecture(page: Dict[str, Any], database_name: Optional[str] = None, is_standalone: bool = False) -> Tuple[str, str, Optional[str]]:
    """
    Convert a Notion page to lecture format (title, text, domain).
    
    Args:
        page: Notion page object
        database_name: Optional database name for domain inference
        is_standalone: Whether this is a standalone page (not in a database)
    
    Returns:
        Tuple of (title, text, domain)
    """
    # Extract title
    title = get_page_title(page)
    
    # Extract domain
    domain = get_page_domain(page, database_name)
    
    # Extract text content
    page_id = page.get("id")
    if not page_id:
        text = ""
    else:
        try:
            blocks = get_page_blocks(page_id)
            text = extract_plaintext_from_blocks(blocks)
        except Exception as e:
            print(f"Warning: Failed to extract blocks from page {page_id}: {e}")
            text = ""
    
    # Fallback if no text extracted
    if not text.strip():
        text = f"Content from Notion page: {title}"
    
    return (title, text, domain)


def sync_once(force_full: bool = False) -> Dict[str, Any]:
    """
    Perform a single sync cycle:
    1. Load last sync timestamp (or use None if force_full=True)
    2. Find updated pages
    3. Convert each to lecture and ingest
    4. Save new sync timestamp
    
    Args:
        force_full: If True, sync all pages regardless of last sync timestamp
    
    Returns:
        Dictionary with sync statistics
    """
    stats = {
        "pages_checked": 0,
        "pages_ingested": 0,
        "nodes_created": 0,
        "nodes_updated": 0,
        "links_created": 0,
        "errors": [],
        "pages_processed": [],  # List of {page_id, page_title, lecture_id, status}
    }
    
    # Load last sync timestamp
    if force_full:
        last_sync = None
        print("[Notion Sync] Force full sync - processing all pages")
    else:
        last_sync = load_last_sync_timestamp()
        if last_sync:
            print(f"[Notion Sync] Last sync was at {last_sync.isoformat()}")
        else:
            print("[Notion Sync] No previous sync found - will sync all pages")
    
    # Find updated pages
    updated_pages = find_updated_pages_since(last_sync)
    stats["pages_checked"] = len(updated_pages)
    
    if not updated_pages:
        print("[Notion Sync] No updated pages found")
        # Still update timestamp to current time
        save_last_sync_timestamp(datetime.now(timezone.utc))
        return stats
    
    # Load index state to check which pages should be ingested
    index_state = load_index_state()
    
    # Get Neo4j session using the generator pattern
    session_gen = get_neo4j_session()
    session = next(session_gen)
    
    try:
        # Process each page
        skipped_not_indexed = 0
        for page in updated_pages:
            page_id = page.get("id", "unknown")
            try:
                # Check if this page should be indexed
                if not is_page_indexed(page_id, index_state):
                    # If in allowlist mode, automatically add new pages to allowlist
                    if index_state.get("mode", "allowlist") == "allowlist":
                        print(f"[Notion Sync] Auto-adding new page {page_id} to allowlist")
                        index_state = set_page_indexed(page_id, True, index_state)
                    else:
                        skipped_not_indexed += 1
                        print(f"[Notion Sync] Skipping page {page_id}: blocked in blocklist")
                        continue
                
                # Determine if this is a standalone page (not from a database)
                # Standalone pages won't have database context
                is_standalone = "parent" in page and page.get("parent", {}).get("type") != "database_id"
                
                # Convert page to lecture
                title, text, domain = page_to_lecture(page, is_standalone=is_standalone)
                
                if not title or not text:
                    print(f"[Notion Sync] Skipping page {page_id}: empty title or text")
                    continue
                
                print(f"[Notion Sync] Ingesting page: {title}")
                
                # Ingest via unified kernel
                artifact_input = ArtifactInput(
                    artifact_type="notion_page",
                    source_id=page_id,
                    title=title,
                    text=text,
                    domain=domain,
                    actions=IngestionActions(
                        run_lecture_extraction=True,
                        run_chunk_and_claims=True,
                        embed_claims=True,
                        create_lecture_node=True,
                        create_artifact_node=True,
                    ),
                    policy=IngestionPolicy(local_only=True)
                )

                result = ingest_artifact(
                    session=session,
                    payload=artifact_input,
                )
                
                stats["pages_ingested"] += 1
                stats["nodes_created"] += len(result.nodes_created)
                stats["nodes_updated"] += len(result.nodes_updated)
                stats["links_created"] += len(result.links_created)
                
                # Track page -> lecture mapping
                add_lecture_for_page(page_id, result.lecture_id, title)
                
                # Track in stats for UI display
                stats["pages_processed"].append({
                    "page_id": page_id,
                    "page_title": title,
                    "lecture_id": result.lecture_id,
                    "status": "success",
                    "nodes_created": len(result.nodes_created),
                    "links_created": len(result.links_created),
                })
                
                print(f"[Notion Sync] ✓ Ingested '{title}': {len(result.nodes_created)} nodes created, {len(result.links_created)} links created")
                
            except Exception as e:
                error_msg = f"Failed to ingest page {page_id}: {str(e)}"
                stats["errors"].append(error_msg)
                
                # Track failed page in stats
                page_title = page.get("title", "Unknown")
                if isinstance(page_title, list) and len(page_title) > 0:
                    page_title = page_title[0].get("plain_text", "Unknown")
                elif isinstance(page_title, dict):
                    page_title = page_title.get("plain_text", "Unknown")
                
                stats["pages_processed"].append({
                    "page_id": page_id,
                    "page_title": page_title,
                    "lecture_id": None,
                    "status": "error",
                    "error": str(e),
                })
                
                print(f"[Notion Sync] ✗ {error_msg}")
                continue
        
        if skipped_not_indexed > 0:
            print(f"[Notion Sync] Skipped {skipped_not_indexed} page(s) not in allowlist")
        
        # Save new sync timestamp
        save_last_sync_timestamp(datetime.now(timezone.utc))
        
    finally:
        # Close session by consuming the generator
        try:
            next(session_gen, None)
        except StopIteration:
            pass
        except Exception:
            pass  # Generator already closed
    
    return stats
