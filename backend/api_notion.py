"""
API router for Notion integration endpoints
"""
from fastapi import APIRouter, HTTPException
from typing import List, Optional, Literal
from pydantic import BaseModel

from models import LectureIngestResult
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
) -> List[LectureIngestResult]:
    """
    Bulk-ingest specific pages into the graph.
    
    Args:
        payload: Request with page_ids list and optional domain
    
    Returns:
        List of LectureIngestResult for each successfully ingested page
    """
    results: List[LectureIngestResult] = []
    errors: List[str] = []
    
    for pid in payload.page_ids:
        try:
            res = ingest_notion_page_as_lecture(pid, domain=payload.domain)
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
) -> List[LectureIngestResult]:
    """
    Ingest everything of a given type. Start with pages-only.
    
    Args:
        payload: Request with mode and optional domain
    
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
            res = ingest_notion_page_as_lecture(pid, domain=payload.domain)
            results.append(res)
        except Exception as e:
            # Collect errors but continue processing other pages
            error_msg = f"Failed to ingest page {pid}: {str(e)}"
            errors.append(error_msg)
            print(f"ERROR: {error_msg}")
    
    # Log summary
    print(f"[Notion Ingest All] Processed {len(page_ids)} pages: {len(results)} succeeded, {len(errors)} failed")
    
    return results
