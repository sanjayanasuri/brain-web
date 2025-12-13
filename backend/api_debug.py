"""
Debug API endpoints for inspecting stored answers, feedback, and revisions.

These endpoints are only available in non-production environments.
"""

from fastapi import APIRouter, Depends, HTTPException
from typing import List, Dict, Any, Optional
import os

from db_neo4j import get_neo4j_session
from services_graph import get_recent_answers, get_answer_detail
from neo4j import Session

router = APIRouter(prefix="/debug", tags=["debug"])


def check_debug_enabled():
    """Check if debug endpoints should be enabled."""
    env = os.getenv("NODE_ENV", "development")
    if env == "production":
        raise HTTPException(status_code=403, detail="Debug endpoints are disabled in production")
    return True


@router.get("/answers/recent")
def get_recent_answers_endpoint(
    limit: int = 10,
    session: Session = Depends(get_neo4j_session),
    _: bool = Depends(check_debug_enabled),
) -> List[Dict[str, Any]]:
    """
    Get recent answers with feedback and revision flags.
    Only available in non-production environments.
    """
    return get_recent_answers(session, limit=limit)


@router.get("/answers/{answer_id}")
def get_answer_detail_endpoint(
    answer_id: str,
    session: Session = Depends(get_neo4j_session),
    _: bool = Depends(check_debug_enabled),
) -> Dict[str, Any]:
    """
    Get full answer details including feedback and revisions.
    Only available in non-production environments.
    """
    detail = get_answer_detail(session, answer_id)
    if not detail:
        raise HTTPException(status_code=404, detail=f"Answer {answer_id} not found")
    return detail
