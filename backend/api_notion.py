"""
API router for Notion integration endpoints
"""
from fastapi import APIRouter, HTTPException, Depends
from fastapi.responses import StreamingResponse
from typing import List, Optional, Literal, Dict, Any
from pydantic import BaseModel
from neo4j import Session
import asyncio
import json
import time
from concurrent.futures import ThreadPoolExecutor, as_completed

from models import LectureIngestResult
from db_neo4j import get_neo4j_session, get_driver
from services_notion import (
    list_notion_pages,
    list_notion_databases,
    ingest_notion_page_as_lecture,
)


class NotionIngestPagesRequest(BaseModel):
    page_ids: List[str]
    domain: Optional[str] = "Software Engineering"


class NotionIngestAllRequest(BaseModel):
    mode: Literal["pages", "databases", "both"] = "pages"
    domain: Optional[str] = "Software Engineering"

router = APIRouter(prefix="/notion", tags=["notion"])


@router.get("/summary")
def notion_summary():
    """
    Return a summary of what we find in Notion:
    - pages: [{id, title, url}]
    - databases: [{id, title, url}]
    """
    try:
        return {
            "pages": list_notion_pages(),
            "databases": list_notion_databases(),
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to list Notion content: {str(e)}")


@router.post("/ingest-pages")
def notion_ingest_pages(
    payload: NotionIngestPagesRequest,
    session: Session = Depends(get_neo4j_session),
) -> List[LectureIngestResult]:
    """
    Bulk-ingest specific pages into the graph.
    
    Args:
        payload: Request with page_ids list and optional domain
        session: Neo4j session
    
    Returns:
        List of LectureIngestResult for each successfully ingested page
    """
    results: List[LectureIngestResult] = []
    errors: List[str] = []
    
    for pid in payload.page_ids:
        try:
            res = ingest_notion_page_as_lecture(session, pid, domain=payload.domain)
            results.append(res)
        except Exception as e:
            # Collect errors but continue processing other pages
            error_msg = f"Failed to ingest page {pid}: {str(e)}"
            errors.append(error_msg)
            print(f"ERROR: {error_msg}")
    
    # If all pages failed, raise an error
    if len(results) == 0 and len(errors) > 0:
        raise HTTPException(
            status_code=500,
            detail=f"All pages failed to ingest. Errors: {'; '.join(errors)}"
        )
    
    # If some succeeded, return results (errors are logged but not raised)
    return results


@router.post("/ingest-all")
def notion_ingest_all(
    payload: NotionIngestAllRequest,
    session: Session = Depends(get_neo4j_session),
) -> List[LectureIngestResult]:
    """
    Ingest everything of a given type. Start with pages-only.
    
    Args:
        payload: Request with mode and optional domain
        session: Neo4j session
    
    Returns:
        List of LectureIngestResult for each successfully ingested item
    """
    items = []
    
    if payload.mode in ("pages", "both"):
        try:
            items.extend(list_notion_pages())
        except Exception as e:
            raise HTTPException(
                status_code=500,
                detail=f"Failed to list Notion pages: {str(e)}"
            )
    
    # TODO: Support database ingestion later
    if payload.mode in ("databases", "both"):
        # For now, just list databases but don't ingest them
        # databases = list_notion_databases()
        pass
    
    if not items:
        return []
    
    page_ids = [p["id"] for p in items]
    results: List[LectureIngestResult] = []
    errors: List[str] = []
    
    for pid in page_ids:
        try:
            res = ingest_notion_page_as_lecture(session, pid, domain=payload.domain)
            results.append(res)
        except Exception as e:
            # Collect errors but continue processing other pages
            error_msg = f"Failed to ingest page {pid}: {str(e)}"
            errors.append(error_msg)
            print(f"ERROR: {error_msg}")
    
    # Log summary
    print(f"[Notion Ingest All] Processed {len(page_ids)} pages: {len(results)} succeeded, {len(errors)} failed")
    
    return results


class NotionIngestAllParallelRequest(BaseModel):
    mode: Literal["pages", "databases", "both"] = "pages"
    domain: Optional[str] = "Software Engineering"
    max_workers: Optional[int] = 5  # Number of parallel workers
    use_parallel: bool = True  # Toggle between parallel and sequential


def _ingest_page_with_session(page_id: str, domain: Optional[str]) -> Dict[str, Any]:
    """Helper function to ingest a single page with its own session."""
    from config import NEO4J_DATABASE
    driver = get_driver()
    session = driver.session(database=NEO4J_DATABASE)
    try:
        result = ingest_notion_page_as_lecture(session, page_id, domain=domain)
        return {
            "page_id": page_id,
            "success": True,
            "result": result,
            "error": None
        }
    except Exception as e:
        return {
            "page_id": page_id,
            "success": False,
            "result": None,
            "error": str(e)
        }
    finally:
        session.close()


@router.post("/ingest-all-parallel")
def notion_ingest_all_parallel(
    payload: NotionIngestAllParallelRequest,
) -> StreamingResponse:
    """
    Ingest all Notion pages with parallel processing and progress updates.
    
    Uses Server-Sent Events (SSE) to stream progress updates to the client.
    Processes pages in parallel with configurable concurrency.
    
    Args:
        payload: Request with mode, domain, and parallel processing options
        session_factory: Neo4j session factory (dependency)
    
    Returns:
        StreamingResponse with SSE events containing progress updates
    """
    def generate():
        items = []
        
        # Get list of pages
        try:
            if payload.mode in ("pages", "both"):
                items.extend(list_notion_pages())
        except Exception as e:
            yield f"data: {json.dumps({'type': 'error', 'message': f'Failed to list Notion pages: {str(e)}'})}\n\n"
            return
        
        if not items:
            yield f"data: {json.dumps({'type': 'complete', 'total': 0, 'processed': 0, 'succeeded': 0, 'failed': 0, 'results': []})}\n\n"
            return
        
        page_ids = [p["id"] for p in items]
        total = len(page_ids)
        
        # Send initial progress
        yield f"data: {json.dumps({'type': 'start', 'total': total, 'message': f'Starting ingestion of {total} pages...'})}\n\n"
        
        results: List[LectureIngestResult] = []
        errors: List[str] = []
        processed = 0
        
        if payload.use_parallel and payload.max_workers and payload.max_workers > 1:
            # Parallel processing
            max_workers = min(payload.max_workers, total)  # Don't exceed total pages
            
            with ThreadPoolExecutor(max_workers=max_workers) as executor:
                # Submit all tasks
                future_to_page = {
                    executor.submit(_ingest_page_with_session, pid, payload.domain): pid
                    for pid in page_ids
                }
                
                # Process as they complete
                for future in as_completed(future_to_page):
                    page_id = future_to_page[future]
                    processed += 1
                    
                    try:
                        page_result = future.result()
                        if page_result["success"]:
                            results.append(page_result["result"])
                            yield f"data: {json.dumps({'type': 'progress', 'processed': processed, 'total': total, 'current_page': page_id, 'success': True, 'message': f'✓ Processed page {processed}/{total}'})}\n\n"
                        else:
                            errors.append(page_result["error"])
                            error_msg = page_result.get("error", "Unknown error")
                            yield f"data: {json.dumps({'type': 'progress', 'processed': processed, 'total': total, 'current_page': page_id, 'success': False, 'message': f'✗ Failed page {processed}/{total}: {error_msg}'})}\n\n"
                    except Exception as e:
                        error_msg = f"Failed to ingest page {page_id}: {str(e)}"
                        errors.append(error_msg)
                        yield f"data: {json.dumps({'type': 'progress', 'processed': processed, 'total': total, 'current_page': page_id, 'success': False, 'message': f'✗ Error on page {processed}/{total}'})}\n\n"
        else:
            # Sequential processing (original behavior)
            session = next(session_factory())
            try:
                for pid in page_ids:
                    processed += 1
                    try:
                        res = ingest_notion_page_as_lecture(session, pid, domain=payload.domain)
                        results.append(res)
                        yield f"data: {json.dumps({'type': 'progress', 'processed': processed, 'total': total, 'current_page': pid, 'success': True, 'message': f'✓ Processed page {processed}/{total}'})}\n\n"
                    except Exception as e:
                        error_msg = f"Failed to ingest page {pid}: {str(e)}"
                        errors.append(error_msg)
                        yield f"data: {json.dumps({'type': 'progress', 'processed': processed, 'total': total, 'current_page': pid, 'success': False, 'message': f'✗ Failed page {processed}/{total}'})}\n\n"
            finally:
                session.close()
        
        # Send completion event
        total_nodes = sum((r.nodes_created or []) + (r.nodes_updated or []) for r in results)
        total_links = sum(r.links_created or [] for r in results)
        total_segments = sum(r.segments or [] for r in results)
        
        yield f"data: {json.dumps({'type': 'complete', 'total': total, 'processed': processed, 'succeeded': len(results), 'failed': len(errors), 'results': [r.dict() for r in results], 'summary': {'nodes': total_nodes, 'links': total_links, 'segments': total_segments}, 'errors': errors})}\n\n"
    
    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",  # Disable nginx buffering
        }
    )
