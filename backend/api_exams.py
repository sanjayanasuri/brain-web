"""
API endpoints for exam and assessment management.
"""
from typing import List, Optional
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, Query
from neo4j import Session
from db_neo4j import get_neo4j_session
from models import SignalType, SignalCreate, AssessmentSignal
from services_signals import create_signal
from services_branch_explorer import get_active_graph_context, ensure_graph_scoping_initialized
from pydantic import BaseModel, Field
from uuid import uuid4

router = APIRouter(prefix="/exams", tags=["exams"])


class ExamCreate(BaseModel):
    """Request to create an exam."""
    title: str
    exam_date: str  # ISO format date string
    assessment_type: str = "exam"  # "exam", "homework", "practice"
    required_concepts: List[str] = Field(default_factory=list)  # Concept IDs or names
    domain: Optional[str] = None
    description: Optional[str] = None


class ExamUpdate(BaseModel):
    """Request to update an exam."""
    title: Optional[str] = None
    exam_date: Optional[str] = None
    required_concepts: Optional[List[str]] = None
    domain: Optional[str] = None
    description: Optional[str] = None


class ExamResponse(BaseModel):
    """Exam response model."""
    exam_id: str
    title: str
    exam_date: str  # ISO format
    assessment_type: str
    required_concepts: List[str]
    domain: Optional[str] = None
    description: Optional[str] = None
    days_until: int
    created_at: str


@router.post("/", response_model=ExamResponse)
def create_exam(
    payload: ExamCreate,
    session: Session = Depends(get_neo4j_session),
):
    """
    Create a new exam/assessment with a deadline.
    
    Creates an AssessmentSignal with exam date information.
    """
    ensure_graph_scoping_initialized(session)
    graph_id, branch_id = get_active_graph_context(session)
    
    exam_id = f"EXAM_{uuid4().hex[:8].upper()}"
    
    # Parse exam date
    try:
        exam_date = datetime.fromisoformat(payload.exam_date.replace('Z', '+00:00'))
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Invalid exam_date format: {e}")
    
    # Calculate days until
    now = datetime.utcnow()
    days_until = (exam_date - now).days
    
    # Create AssessmentSignal
    signal_payload = {
        "assessment_id": exam_id,
        "assessment_type": payload.assessment_type,
        "exam_title": payload.title,
        "exam_date": payload.exam_date,
        "required_concepts": payload.required_concepts,
        "domain": payload.domain,
        "description": payload.description,
    }
    
    try:
        signal = create_signal(
            session,
            SignalCreate(
                signal_type=SignalType.ASSESSMENT,
                payload=signal_payload,
                session_id=None,  # Will be set from request if available
            )
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to create exam signal: {str(e)}")
    
    return ExamResponse(
        exam_id=exam_id,
        title=payload.title,
        exam_date=payload.exam_date,
        assessment_type=payload.assessment_type,
        required_concepts=payload.required_concepts,
        domain=payload.domain,
        description=payload.description,
        days_until=days_until,
        created_at=datetime.utcnow().isoformat(),
    )


@router.get("/", response_model=List[ExamResponse])
def list_exams(
    days_ahead: int = Query(60, description="How many days ahead to look"),
    session: Session = Depends(get_neo4j_session),
):
    """
    List all upcoming exams.
    """
    from services_study_analytics import get_upcoming_exams
    
    exams = get_upcoming_exams(session, days_ahead=days_ahead)
    
    return [
        ExamResponse(
            exam_id=exam.exam_id,
            title=exam.title,
            exam_date=exam.date.isoformat(),
            assessment_type="exam",
            required_concepts=exam.required_concepts,
            domain=exam.domain,
            description=None,
            days_until=exam.days_until,
            created_at=exam.date.isoformat(),  # Approximate
        )
        for exam in exams
    ]


@router.put("/{exam_id}", response_model=ExamResponse)
def update_exam(
    exam_id: str,
    payload: ExamUpdate,
    session: Session = Depends(get_neo4j_session),
):
    """
    Update an existing exam.
    
    Note: This updates the AssessmentSignal payload. In a production system,
    you might want to store exams as separate nodes for better querying.
    """
    ensure_graph_scoping_initialized(session)
    graph_id, branch_id = get_active_graph_context(session)
    
    # Find the signal - exam_id is stored in payload.assessment_id, not signal_id
    # We need to search by payload content
    query = """
    MATCH (s:Signal {graph_id: $graph_id})
    WHERE s.signal_type = $signal_type
      AND ($branch_id IN COALESCE(s.on_branches, []) OR s.branch_id = $branch_id)
      AND s.payload IS NOT NULL
    
    RETURN s.signal_id AS signal_id, s.payload AS payload_raw, s.timestamp AS timestamp
    LIMIT 100
    """
    
    result = session.run(
        query,
        exam_id=exam_id,
        graph_id=graph_id,
        branch_id=branch_id,
        signal_type=SignalType.ASSESSMENT.value
    )
    
    import json
    signal_id = None
    payload_dict = None
    
    # Find the signal with matching exam_id in payload
    for record in result:
        payload_raw = record["payload_raw"]
        try:
            if isinstance(payload_raw, str):
                payload = json.loads(payload_raw)
            else:
                payload = payload_raw or {}
            
            if payload.get("assessment_id") == exam_id and not payload.get("archived", False):
                signal_id = record["signal_id"]
                payload_dict = payload
                break
        except:
            continue
    
    if not signal_id or not payload_dict:
        raise HTTPException(status_code=404, detail="Exam not found")
    
    if payload.title is not None:
        payload_dict["exam_title"] = payload.title
    if payload.exam_date is not None:
        payload_dict["exam_date"] = payload.exam_date
    if payload.required_concepts is not None:
        payload_dict["required_concepts"] = payload.required_concepts
    if payload.domain is not None:
        payload_dict["domain"] = payload.domain
    if payload.description is not None:
        payload_dict["description"] = payload.description
    
    # Update signal
    update_query = """
    MATCH (s:Signal {signal_id: $signal_id, graph_id: $graph_id})
    SET s.payload = $payload
    RETURN s.payload AS payload, s.timestamp AS timestamp
    """
    
    session.run(update_query, signal_id=signal_id, graph_id=graph_id, payload=json.dumps(payload_dict))
    
    # Parse exam date for days_until
    exam_date_str = payload_dict.get("exam_date") or payload.exam_date
    if exam_date_str:
        exam_date = datetime.fromisoformat(exam_date_str.replace('Z', '+00:00'))
        days_until = (exam_date - datetime.utcnow()).days
    else:
        days_until = 0
    
    return ExamResponse(
        exam_id=exam_id,
        title=payload_dict.get("exam_title", "Untitled"),
        exam_date=payload_dict.get("exam_date", ""),
        assessment_type=payload_dict.get("assessment_type", "exam"),
        required_concepts=payload_dict.get("required_concepts", []),
        domain=payload_dict.get("domain"),
        description=payload_dict.get("description"),
        days_until=days_until,
        created_at=datetime.fromtimestamp(record["timestamp"] / 1000).isoformat() if record.get("timestamp") else datetime.utcnow().isoformat(),
    )


@router.delete("/{exam_id}")
def delete_exam(
    exam_id: str,
    session: Session = Depends(get_neo4j_session),
):
    """
    Delete an exam (marks the signal as archived).
    """
    ensure_graph_scoping_initialized(session)
    graph_id, branch_id = get_active_graph_context(session)
    
    # Find signal by payload.assessment_id
    find_query = """
    MATCH (s:Signal {graph_id: $graph_id})
    WHERE s.signal_type = $signal_type
      AND ($branch_id IN COALESCE(s.on_branches, []) OR s.branch_id = $branch_id)
      AND s.payload IS NOT NULL
    
    RETURN s.signal_id AS signal_id, s.payload AS payload_raw
    LIMIT 100
    """
    
    find_result = session.run(
        find_query,
        exam_id=exam_id,
        graph_id=graph_id,
        branch_id=branch_id,
        signal_type=SignalType.ASSESSMENT.value
    )
    
    import json
    signal_id = None
    payload_dict = None
    
    # Find the signal with matching exam_id in payload
    for record in find_result:
        payload_raw = record["payload_raw"]
        try:
            if isinstance(payload_raw, str):
                payload = json.loads(payload_raw)
            else:
                payload = payload_raw or {}
            
            if payload.get("assessment_id") == exam_id:
                signal_id = record["signal_id"]
                payload_dict = payload
                break
        except:
            continue
    
    if not signal_id or not payload_dict:
        raise HTTPException(status_code=404, detail="Exam not found")
    
    # Update payload to mark as archived
    payload_dict["archived"] = True
    
    query = """
    MATCH (s:Signal {signal_id: $signal_id, graph_id: $graph_id})
    SET s.payload = $payload
    RETURN s.signal_id AS signal_id
    """
    
    result = session.run(
        query,
        signal_id=signal_id,
        graph_id=graph_id,
        payload=json.dumps(payload_dict)
    )
    
    if not result.single():
        raise HTTPException(status_code=404, detail="Exam not found")
    
    return {"status": "deleted", "exam_id": exam_id}
