"""
API endpoints for Teaching Style Profile management.

Endpoints:
- GET /teaching-style: Get current teaching style profile
- POST /teaching-style: Update teaching style profile (partial update)
- POST /teaching-style/recompute: Recompute style from recent lectures
"""
from fastapi import APIRouter, Depends, HTTPException, Query
from db_neo4j import get_neo4j_session
from models import TeachingStyleProfile, TeachingStyleUpdateRequest
from services_teaching_style import get_teaching_style, update_teaching_style
from teaching_style_service import recompute_teaching_style_from_recent_lectures

router = APIRouter(prefix="/teaching-style", tags=["teaching-style"])


@router.get("", response_model=TeachingStyleProfile)
def get_teaching_style_endpoint(session=Depends(get_neo4j_session)):
    """
    Get the current teaching style profile.
    
    If no profile exists, creates and returns the default profile.
    Always returns a valid profile (never 500).
    """
    try:
        return get_teaching_style(session)
    except Exception as e:
        # Fallback to default if anything goes wrong
        from services_teaching_style import DEFAULT_STYLE
        return DEFAULT_STYLE


@router.post("", response_model=TeachingStyleProfile)
def update_teaching_style_endpoint(
    update: TeachingStyleUpdateRequest,
    session=Depends(get_neo4j_session),
):
    """
    Update the teaching style profile with partial updates.
    
    Only non-None fields in the request will be updated.
    Other fields remain unchanged.
    """
    try:
        return update_teaching_style(session, update)
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to update teaching style: {str(e)}"
        )


@router.post("/recompute", response_model=TeachingStyleProfile)
def recompute_teaching_style_endpoint(
    limit: int = Query(default=5, ge=1, le=20, description="Number of recent lectures to analyze"),
    session=Depends(get_neo4j_session),
):
    """
    Recompute teaching style from recent lectures.
    
    This endpoint:
    1. Fetches the N most recent lectures (default: 5)
    2. Extracts teaching style from each using LLM
    3. Aggregates styles into a unified profile
    4. Persists and returns the new profile
    
    Args:
        limit: Number of recent lectures to analyze (1-20, default 5)
    """
    try:
        return recompute_teaching_style_from_recent_lectures(session, limit=limit)
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to recompute teaching style: {str(e)}"
        )
