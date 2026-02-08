# backend/routers/analytics.py
"""
Analytics API endpoints for Phase 4.
Provides performance trends, concept mastery, recommendations, and session history.
"""

from fastapi import APIRouter, Depends, HTTPException
from typing import List, Dict, Optional
from pydantic import BaseModel

from auth import get_current_user, User
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
    current_user: User = Depends(get_current_user)
):
    """
    Get performance trends over time.
    
    Args:
        days: Number of days to retrieve (default 30)
    
    Returns:
        List of daily performance records
    """
    try:
        trends = get_user_trends(
            user_id=current_user.id,
            tenant_id=current_user.tenant_id,
            days=days
        )
        return trends
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/mastery", response_model=List[ConceptMastery])
async def get_mastery_levels(
    limit: Optional[int] = None,
    current_user: User = Depends(get_current_user)
):
    """
    Get concept mastery levels.
    
    Args:
        limit: Max number of concepts to return
    
    Returns:
        List of concepts with mastery scores
    """
    try:
        mastery = get_concept_mastery(
            user_id=current_user.id,
            tenant_id=current_user.tenant_id,
            limit=limit
        )
        return mastery
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/velocity", response_model=LearningVelocity)
async def get_velocity(
    current_user: User = Depends(get_current_user)
):
    """
    Get learning velocity (rate of improvement).
    
    Returns:
        Learning velocity metrics
    """
    try:
        velocity = get_learning_velocity(
            user_id=current_user.id,
            tenant_id=current_user.tenant_id
        )
        return velocity
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/weak-areas", response_model=WeakAreas)
async def get_weak_areas(
    current_user: User = Depends(get_current_user)
):
    """
    Identify weak areas (concepts and task types).
    
    Returns:
        Weak concepts and task types
    """
    try:
        weak_areas = identify_weak_areas(
            user_id=current_user.id,
            tenant_id=current_user.tenant_id
        )
        return weak_areas
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/stats", response_model=SessionStats)
async def get_stats(
    current_user: User = Depends(get_current_user)
):
    """
    Get aggregate session statistics.
    
    Returns:
        Session stats (total, completion rate, avg score, etc.)
    """
    try:
        stats = get_session_stats(
            user_id=current_user.id,
            tenant_id=current_user.tenant_id
        )
        return stats
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/recommendations", response_model=List[Recommendation])
async def get_recommendations(
    limit: int = 5,
    current_user: User = Depends(get_current_user)
):
    """
    Get personalized recommendations.
    
    Args:
        limit: Max number of recommendations to return
    
    Returns:
        List of active recommendations
    """
    try:
        recs = get_active_recommendations(
            user_id=current_user.id,
            tenant_id=current_user.tenant_id,
            limit=limit
        )
        return recs
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/recommendations/{rec_id}/dismiss")
async def dismiss_recommendation(
    rec_id: str,
    current_user: User = Depends(get_current_user)
):
    """
    Dismiss a recommendation.
    
    Args:
        rec_id: Recommendation UUID
    
    Returns:
        Success message
    """
    try:
        dismiss_rec(
            recommendation_id=rec_id,
            user_id=current_user.id,
            tenant_id=current_user.tenant_id
        )
        return {"message": "Recommendation dismissed"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
