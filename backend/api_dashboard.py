"""
API endpoints for study dashboard and analytics.
"""
from typing import List, Dict, Any, Optional
from datetime import datetime
from fastapi import APIRouter, Depends, Query
from neo4j import Session
from db_neo4j import get_neo4j_session
from services_study_analytics import (
    get_study_time_by_domain,
    get_upcoming_exams,
    get_resume_points,
    get_study_recommendations,
    StudySession,
    UpcomingExam,
    StudyRecommendation,
    ResumePoint
)
from services_llm_recommendations import generate_study_plan_with_llm
from models import BaseModel

router = APIRouter(prefix="/dashboard", tags=["dashboard"])


class StudyTimeResponse(BaseModel):
    domain: str
    hours: float
    minutes: int
    total_ms: int


class ExamResponse(BaseModel):
    exam_id: str
    title: str
    date: str  # ISO format
    days_until: int
    required_concepts: List[str]
    domain: Optional[str] = None


class DocumentSuggestion(BaseModel):
    document_id: str
    title: str
    section: str
    url: str


class StudyRecommendationResponse(BaseModel):
    concept_id: str
    concept_name: str
    priority: str
    reason: str
    suggested_documents: List[DocumentSuggestion]
    estimated_time_min: int


class ResumePointResponse(BaseModel):
    document_id: str
    document_title: str
    block_id: Optional[str] = None
    segment_id: Optional[str] = None
    concept_id: Optional[str] = None
    last_accessed: str  # ISO format
    document_type: str
    url: str


class DashboardResponse(BaseModel):
    study_time_by_domain: List[StudyTimeResponse]
    upcoming_exams: List[ExamResponse]
    study_recommendations: List[StudyRecommendationResponse]
    resume_points: List[ResumePointResponse]
    total_study_hours: float
    days_looked_back: int


@router.get("/study-analytics", response_model=DashboardResponse)
def get_dashboard_data(
    days: int = Query(7, description="Number of days to look back for study time"),
    session: Session = Depends(get_neo4j_session),
):
    """
    Get comprehensive dashboard data including:
    - Study time by domain/subject
    - Upcoming exams and deadlines
    - Study recommendations
    - Resume points (where you left off)
    """
    # Get study time by domain
    domain_times = get_study_time_by_domain(session, days=days)
    
    study_time_responses = []
    total_ms = 0
    for domain, ms in domain_times.items():
        hours = ms / (1000 * 60 * 60)
        minutes = int((ms / (1000 * 60)) % 60)
        total_ms += ms
        study_time_responses.append(StudyTimeResponse(
            domain=domain,
            hours=round(hours, 1),
            minutes=minutes,
            total_ms=ms
        ))
    
    total_hours = total_ms / (1000 * 60 * 60)
    
    # Get upcoming exams
    exams = get_upcoming_exams(session, days_ahead=60)
    exam_responses = []
    for exam in exams:
        exam_responses.append(ExamResponse(
            exam_id=exam.exam_id,
            title=exam.title,
            date=exam.date.isoformat(),
            days_until=exam.days_until,
            required_concepts=exam.required_concepts,
            domain=exam.domain
        ))
    
    # Get study recommendations
    upcoming_exam = exams[0] if exams else None
    recommendations = get_study_recommendations(
        session,
        upcoming_exam=upcoming_exam,
        limit=10
    )
    
    # Enhance with LLM-powered recommendations if available
    try:
        llm_recommendations = generate_study_plan_with_llm(
            session,
            upcoming_exam=upcoming_exam,
            study_time_by_domain=domain_times
        )
        if llm_recommendations:
            # Merge LLM recommendations with gap-based ones
            recommendations = llm_recommendations + recommendations[:5]
    except Exception as e:
        print(f"LLM recommendations failed (non-critical): {e}")
    
    rec_responses = []
    for rec in recommendations[:10]:  # Limit to top 10
        rec_responses.append(StudyRecommendationResponse(
            concept_id=rec.concept_id,
            concept_name=rec.concept_name,
            priority=rec.priority,
            reason=rec.reason,
            suggested_documents=[
                DocumentSuggestion(**doc) for doc in rec.suggested_documents
            ],
            estimated_time_min=rec.estimated_time_min
        ))
    
    # Get resume points
    resume_points = get_resume_points(session, limit=5)
    resume_responses = []
    for rp in resume_points:
        # Build URL based on document type
        if rp.segment_id:
            url = f"/reader/segment?segment_id={rp.segment_id}"
        elif rp.document_id:
            url = f"/lecture-studio?lecture_id={rp.document_id}"
        else:
            url = "/"
        
        resume_responses.append(ResumePointResponse(
            document_id=rp.document_id,
            document_title=rp.document_title,
            block_id=rp.block_id,
            segment_id=rp.segment_id,
            concept_id=rp.concept_id,
            last_accessed=rp.last_accessed.isoformat(),
            document_type=rp.document_type,
            url=url
        ))
    
    return DashboardResponse(
        study_time_by_domain=study_time_responses,
        upcoming_exams=exam_responses,
        study_recommendations=rec_responses,
        resume_points=resume_responses,
        total_study_hours=round(total_hours, 1),
        days_looked_back=days
    )
