# backend/routers/analytics.py
"""
Analytics API endpoints for Phase 4.
Provides performance trends, concept mastery, recommendations, and session history.
"""

from fastapi import APIRouter, Depends, HTTPException
from typing import List, Dict, Optional
from pydantic import BaseModel

from auth import require_auth
from services.analytics import (
    get_user_trends,
    get_concept_mastery,
    get_learning_velocity,
    identify_weak_areas,
    get_session_stats
)
from services.recommendations import (
    get_active_recommendations,
    dismiss_recommendation as dismiss_rec
)


router = APIRouter(prefix="/analytics", tags=["analytics"])


# Response Models

class PerformanceTrend(BaseModel):
    date: str
    avg_score: float
    task_count: int
    session_count: int
    mode_distribution: Optional[Dict[str, int]]
    moving_avg: float


class ConceptMastery(BaseModel):
    concept_name: str
    mastery_score: float
    exposure_count: int
    success_count: int
    success_rate: float
    last_seen: Optional[str]


class LearningVelocity(BaseModel):
    weekly_improvement: float
    trend: str  # 'improving', 'declining', 'stable', 'insufficient_data'
    current_avg: float
    previous_avg: float


class WeakArea(BaseModel):
    concept: Optional[str] = None
    task_type: Optional[str] = None
    score: float


class WeakAreas(BaseModel):
    weak_concepts: List[WeakArea]
    weak_task_types: List[WeakArea]


class SessionStats(BaseModel):
    total_sessions: int
    completed_sessions: int
    completion_rate: float
    total_tasks: int
    avg_tasks_per_session: float
    avg_score: float


class Recommendation(BaseModel):
    id: str
    type: str
    priority: str
    message: str
    action: Optional[str]
    params: Optional[Dict]
    created_at: str


# Endpoints

@router.get("/trends", response_model=List[PerformanceTrend])
async def get_performance_trends(
    days: int = 30,
    auth: dict = Depends(require_auth),
):
    """
    Get performance trends over time.
    
    Args:
        days: Number of days to retrieve (default 30)
    
    Returns:
        List of daily performance records
    """
    user_id = auth.get("user_id")
    tenant_id = auth.get("tenant_id")
    if not user_id or not tenant_id:
        raise HTTPException(status_code=401, detail="Authentication required")
    try:
        trends = get_user_trends(
            user_id=str(user_id),
            tenant_id=str(tenant_id),
            days=days
        )
        return trends
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/mastery", response_model=List[ConceptMastery])
async def get_mastery_levels(
    limit: Optional[int] = None,
    auth: dict = Depends(require_auth),
):
    """
    Get concept mastery levels.
    
    Args:
        limit: Max number of concepts to return
    
    Returns:
        List of concepts with mastery scores
    """
    user_id = auth.get("user_id")
    tenant_id = auth.get("tenant_id")
    if not user_id or not tenant_id:
        raise HTTPException(status_code=401, detail="Authentication required")
    try:
        mastery = get_concept_mastery(
            user_id=str(user_id),
            tenant_id=str(tenant_id),
            limit=limit
        )
        return mastery
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/velocity", response_model=LearningVelocity)
async def get_velocity(
    auth: dict = Depends(require_auth),
):
    """
    Get learning velocity (rate of improvement).
    
    Returns:
        Learning velocity metrics
    """
    user_id = auth.get("user_id")
    tenant_id = auth.get("tenant_id")
    if not user_id or not tenant_id:
        raise HTTPException(status_code=401, detail="Authentication required")
    try:
        velocity = get_learning_velocity(
            user_id=str(user_id),
            tenant_id=str(tenant_id)
        )
        return velocity
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/weak-areas", response_model=WeakAreas)
async def get_weak_areas(
    auth: dict = Depends(require_auth),
):
    """
    Identify weak areas (concepts and task types).
    
    Returns:
        Weak concepts and task types
    """
    user_id = auth.get("user_id")
    tenant_id = auth.get("tenant_id")
    if not user_id or not tenant_id:
        raise HTTPException(status_code=401, detail="Authentication required")
    try:
        weak_areas = identify_weak_areas(
            user_id=str(user_id),
            tenant_id=str(tenant_id)
        )
        return weak_areas
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/stats", response_model=SessionStats)
async def get_stats(
    auth: dict = Depends(require_auth),
):
    """
    Get aggregate session statistics.
    
    Returns:
        Session stats (total, completion rate, avg score, etc.)
    """
    user_id = auth.get("user_id")
    tenant_id = auth.get("tenant_id")
    if not user_id or not tenant_id:
        raise HTTPException(status_code=401, detail="Authentication required")
    try:
        stats = get_session_stats(
            user_id=str(user_id),
            tenant_id=str(tenant_id)
        )
        return stats
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/recommendations", response_model=List[Recommendation])
async def get_recommendations(
    limit: int = 5,
    auth: dict = Depends(require_auth),
):
    """
    Get personalized recommendations.
    
    Args:
        limit: Max number of recommendations to return
    
    Returns:
        List of active recommendations
    """
    user_id = auth.get("user_id")
    tenant_id = auth.get("tenant_id")
    if not user_id or not tenant_id:
        raise HTTPException(status_code=401, detail="Authentication required")
    try:
        recs = get_active_recommendations(
            user_id=str(user_id),
            tenant_id=str(tenant_id),
            limit=limit
        )
        return recs
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/recommendations/{rec_id}/dismiss")
async def dismiss_recommendation(
    rec_id: str,
    auth: dict = Depends(require_auth),
):
    """
    Dismiss a recommendation.
    
    Args:
        rec_id: Recommendation UUID
    
    Returns:
        Success message
    """
    user_id = auth.get("user_id")
    tenant_id = auth.get("tenant_id")
    if not user_id or not tenant_id:
        raise HTTPException(status_code=401, detail="Authentication required")
    try:
        dismiss_rec(
            recommendation_id=rec_id,
            user_id=str(user_id),
            tenant_id=str(tenant_id)
        )
        return {"message": "Recommendation dismissed"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
