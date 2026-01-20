"""
Service for study analytics and dashboard data.

Tracks:
- Time spent studying by subject/domain
- Upcoming exams and deadlines
- Study recommendations based on gaps
- Resume points (where user left off)
"""
from typing import List, Dict, Any, Optional
from datetime import datetime, timedelta
from neo4j import Session
# Note: We query signals directly via Cypher
from services_branch_explorer import get_active_graph_context, ensure_graph_scoping_initialized
from models import SignalType, TimeSignal, AssessmentSignal
import logging

logger = logging.getLogger("brain_web")


class StudySession:
    """Represents a study session with time tracking."""
    def __init__(self, domain: str, duration_ms: int, document_id: Optional[str] = None, 
                 concept_id: Optional[str] = None, timestamp: int = 0):
        self.domain = domain
        self.duration_ms = duration_ms
        self.document_id = document_id
        self.concept_id = concept_id
        self.timestamp = timestamp


class UpcomingExam:
    """Represents an upcoming exam or deadline."""
    def __init__(self, exam_id: str, title: str, date: datetime, days_until: int,
                 required_concepts: List[str], domain: Optional[str] = None):
        self.exam_id = exam_id
        self.title = title
        self.date = date
        self.days_until = days_until
        self.required_concepts = required_concepts
        self.domain = domain


class StudyRecommendation:
    """Represents a study recommendation."""
    def __init__(self, concept_id: str, concept_name: str, priority: str, reason: str,
                 suggested_documents: List[Dict[str, Any]], estimated_time_min: int):
        self.concept_id = concept_id
        self.concept_name = concept_name
        self.priority = priority  # "high", "medium", "low"
        self.reason = reason
        self.suggested_documents = suggested_documents  # [{document_id, title, section, url}]
        self.estimated_time_min = estimated_time_min


class ResumePoint:
    """Represents where user left off."""
    def __init__(self, document_id: str, document_title: str, last_accessed: datetime,
                 block_id: Optional[str] = None, segment_id: Optional[str] = None, 
                 concept_id: Optional[str] = None, document_type: str = "lecture"):
        self.document_id = document_id
        self.document_title = document_title
        self.block_id = block_id
        self.segment_id = segment_id
        self.concept_id = concept_id
        self.last_accessed = last_accessed
        self.document_type = document_type


def get_study_time_by_domain(
    session: Session,
    days: int = 7,
    graph_id: Optional[str] = None,
    branch_id: Optional[str] = None
) -> Dict[str, int]:
    """
    Get total study time (in milliseconds) grouped by domain/subject.
    
    Args:
        session: Neo4j session
        days: Number of days to look back
        graph_id: Optional graph ID filter
        branch_id: Optional branch ID filter
    
    Returns:
        Dict mapping domain -> total_ms
    """
    ensure_graph_scoping_initialized(session)
    if not graph_id or not branch_id:
        graph_id, branch_id = get_active_graph_context(session)
    
    cutoff_timestamp = int((datetime.utcnow() - timedelta(days=days)).timestamp() * 1000)
    
    # Query TimeSignal signals
    # Note: payload is stored as JSON string, we'll parse it in Python
    query = """
    MATCH (s:Signal)
    WHERE s.signal_type = $signal_type
      AND s.graph_id = $graph_id
      AND ($branch_id IN COALESCE(s.on_branches, []) OR s.branch_id = $branch_id)
      AND s.timestamp >= $cutoff_timestamp
      AND s.payload IS NOT NULL
    
    // Try to get domain from concept
    OPTIONAL MATCH (c:Concept {node_id: s.concept_id, graph_id: $graph_id})
    
    // Try to get domain from document/lecture
    OPTIONAL MATCH (d:Lecture {lecture_id: s.document_id})
    
    RETURN s.payload AS payload,
           COALESCE(c.domain, 'General') AS domain
    """
    
    result = session.run(
        query,
        signal_type=SignalType.TIME.value,
        graph_id=graph_id,
        branch_id=branch_id,
        cutoff_timestamp=cutoff_timestamp
    )
    
    import json
    domain_times: Dict[str, int] = {}
    
    for record in result:
        payload_raw = record["payload"]
        domain = record["domain"] or "General"
        
        # Parse payload
        try:
            if isinstance(payload_raw, str):
                payload = json.loads(payload_raw)
            else:
                payload = payload_raw or {}
            
            action = payload.get("action", "")
            duration_ms = payload.get("duration_ms", 0)
            
            # Only count valid time signals
            if action in ["read", "write", "review", "revisit"] and duration_ms:
                domain_times[domain] = domain_times.get(domain, 0) + int(duration_ms)
        except Exception as e:
            logger.warning(f"Failed to parse signal payload: {e}")
            continue
    
    return domain_times


def get_upcoming_exams(
    session: Session,
    graph_id: Optional[str] = None,
    branch_id: Optional[str] = None,
    days_ahead: int = 60
) -> List[UpcomingExam]:
    """
    Get upcoming exams and deadlines from AssessmentSignal signals.
    
    Args:
        session: Neo4j session
        graph_id: Optional graph ID filter
        branch_id: Optional branch ID filter
        days_ahead: How many days ahead to look
    
    Returns:
        List of UpcomingExam objects
    """
    ensure_graph_scoping_initialized(session)
    if not graph_id or not branch_id:
        graph_id, branch_id = get_active_graph_context(session)
    
    cutoff_date = datetime.utcnow() + timedelta(days=days_ahead)
    cutoff_timestamp = int(cutoff_date.timestamp() * 1000)
    
    # Query AssessmentSignal signals for exams
    query = """
    MATCH (s:Signal)
    WHERE s.signal_type = $signal_type
      AND s.graph_id = $graph_id
      AND ($branch_id IN COALESCE(s.on_branches, []) OR s.branch_id = $branch_id)
      AND s.timestamp <= $cutoff_timestamp
      AND s.payload IS NOT NULL
    
    RETURN s.payload AS payload
    LIMIT 100
    """
    
    result = session.run(
        query,
        signal_type=SignalType.ASSESSMENT.value,
        graph_id=graph_id,
        branch_id=branch_id,
        cutoff_timestamp=cutoff_timestamp
    )
    
    import json
    exams = []
    now = datetime.utcnow()
    
    for record in result:
        payload_raw = record["payload"]
        
        # Parse payload
        try:
            if isinstance(payload_raw, str):
                payload = json.loads(payload_raw)
            else:
                payload = payload_raw or {}
            
            # Check if it's an exam and not archived
            if payload.get("assessment_type") != "exam":
                continue
            if payload.get("archived", False):
                continue
            
            exam_id = payload.get("assessment_id")
            title = payload.get("exam_title") or "Untitled Exam"
            exam_date_str = payload.get("exam_date")
            required_concepts = payload.get("required_concepts") or []
            domain = payload.get("domain")
            
            if not exam_id or not exam_date_str:
                continue
            
            # Parse exam date (could be ISO string or timestamp)
            if isinstance(exam_date_str, (int, float)):
                exam_date = datetime.fromtimestamp(exam_date_str / 1000)
            else:
                exam_date = datetime.fromisoformat(exam_date_str.replace('Z', '+00:00'))
            
            days_until = (exam_date - now).days
            
            if days_until >= 0:  # Only future exams
                exams.append(UpcomingExam(
                    exam_id=exam_id,
                    title=title,
                    date=exam_date,
                    days_until=days_until,
                    required_concepts=required_concepts,
                    domain=domain
                ))
        except Exception as e:
            logger.warning(f"Failed to parse exam signal: {e}")
            continue
    
    return sorted(exams, key=lambda x: x.days_until)


def get_resume_points(
    session: Session,
    limit: int = 5,
    graph_id: Optional[str] = None,
    branch_id: Optional[str] = None
) -> List[ResumePoint]:
    """
    Get recent documents/lectures where user was working (resume points).
    
    Args:
        session: Neo4j session
        limit: Maximum number of resume points
        graph_id: Optional graph ID filter
        branch_id: Optional branch ID filter
    
    Returns:
        List of ResumePoint objects, sorted by most recent
    """
    ensure_graph_scoping_initialized(session)
    if not graph_id or not branch_id:
        graph_id, branch_id = get_active_graph_context(session)
    
    # Get most recent TimeSignal or TextAuthoringSignal for documents
    query = """
    MATCH (s:Signal)
    WHERE s.signal_type IN [$time_type, $text_type]
      AND s.graph_id = $graph_id
      AND ($branch_id IN COALESCE(s.on_branches, []) OR s.branch_id = $branch_id)
      AND s.document_id IS NOT NULL
    WITH s.document_id AS doc_id, MAX(s.timestamp) AS last_timestamp
    ORDER BY last_timestamp DESC
    LIMIT $limit
    
    MATCH (s2:Signal)
    WHERE s2.document_id = doc_id
      AND s2.timestamp = last_timestamp
      AND s2.graph_id = $graph_id
    
    // Get document title
    OPTIONAL MATCH (lec:Lecture {lecture_id: doc_id})
    
    RETURN DISTINCT
      doc_id AS document_id,
      COALESCE(lec.title, 'Untitled Document') AS document_title,
      s2.block_id AS block_id,
      s2.payload AS payload,
      s2.concept_id AS concept_id,
      last_timestamp AS last_accessed,
      'lecture' AS document_type
    ORDER BY last_timestamp DESC
    """
    
    result = session.run(
        query,
        time_type=SignalType.TIME.value,
        text_type=SignalType.TEXT_AUTHORING.value,
        graph_id=graph_id,
        branch_id=branch_id,
        limit=limit
    )
    
    import json
    resume_points = []
    for record in result:
        last_timestamp = record["last_accessed"]
        try:
            last_accessed = datetime.fromtimestamp(last_timestamp / 1000)
        except:
            last_accessed = datetime.utcnow()
        
        # Parse payload for segment_id
        segment_id = None
        payload_raw = record.get("payload")
        if payload_raw:
            try:
                if isinstance(payload_raw, str):
                    payload = json.loads(payload_raw)
                else:
                    payload = payload_raw or {}
                segment_id = payload.get("segment_id")
            except:
                pass
        
        resume_points.append(ResumePoint(
            document_id=record["document_id"],
            document_title=record["document_title"],
            block_id=record.get("block_id"),
            segment_id=segment_id,
            concept_id=record.get("concept_id"),
            last_accessed=last_accessed,
            document_type=record.get("document_type", "lecture")
        ))
    
    return resume_points


def get_study_recommendations(
    session: Session,
    upcoming_exam: Optional[UpcomingExam] = None,
    limit: int = 10,
    graph_id: Optional[str] = None,
    branch_id: Optional[str] = None
) -> List[StudyRecommendation]:
    """
    Get study recommendations based on gaps, upcoming exams, and weak concepts.
    
    This is a simplified version - in production, you'd use LLM to analyze
    study patterns, concept coverage, and exam requirements.
    
    Args:
        session: Neo4j session
        upcoming_exam: Optional exam to prioritize recommendations for
        limit: Maximum number of recommendations
        graph_id: Optional graph ID filter
        branch_id: Optional branch ID filter
    
    Returns:
        List of StudyRecommendation objects
    """
    ensure_graph_scoping_initialized(session)
    if not graph_id or not branch_id:
        graph_id, branch_id = get_active_graph_context(session)
    
    # Get concepts with low coverage or weak understanding
    # This is a placeholder - you'd enhance this with actual gap analysis
    query = """
    MATCH (c:Concept)
    WHERE c.graph_id = $graph_id
    OPTIONAL MATCH (c)<-[:MENTIONS]-(claim:Claim)
    OPTIONAL MATCH (c)<-[:COVERS]-(seg:LectureSegment)
    WITH c, 
         COUNT(DISTINCT claim) AS claim_count,
         COUNT(DISTINCT seg) AS segment_count
    WHERE claim_count < 3 OR segment_count < 2  // Low coverage
    RETURN c.node_id AS concept_id,
           c.name AS concept_name,
           c.domain AS domain,
           claim_count,
           segment_count
    ORDER BY claim_count ASC, segment_count ASC
    LIMIT $limit
    """
    
    result = session.run(
        query,
        graph_id=graph_id,
        branch_id=branch_id,
        limit=limit
    )
    
    recommendations = []
    for record in result:
        concept_id = record["concept_id"]
        concept_name = record["concept_name"]
        domain = record.get("domain", "General")
        
        # Get segments/lectures that cover this concept
        seg_query = """
        MATCH (c:Concept {node_id: $concept_id})<-[:COVERS]-(seg:LectureSegment)
        MATCH (lec:Lecture {lecture_id: seg.lecture_id})
        RETURN lec.lecture_id AS document_id,
               lec.title AS title,
               seg.segment_index AS section_index,
               seg.text AS section_text
        ORDER BY seg.segment_index
        LIMIT 3
        """
        seg_result = session.run(seg_query, concept_id=concept_id)
        
        suggested_docs = []
        for seg_rec in seg_result:
            suggested_docs.append({
                "document_id": seg_rec["document_id"],
                "title": seg_rec["title"],
                "section": f"Segment {seg_rec.get('section_index', 0)}",
                "url": f"/reader/segment?lecture_id={seg_rec['document_id']}&segment_index={seg_rec.get('section_index', 0)}"
            })
        
        # Determine priority
        if upcoming_exam and concept_id in (upcoming_exam.required_concepts or []):
            priority = "high"
            reason = f"Required for {upcoming_exam.title} in {upcoming_exam.days_until} days"
        elif record["claim_count"] == 0:
            priority = "high"
            reason = "No coverage yet - needs study"
        else:
            priority = "medium"
            reason = f"Low coverage ({record['claim_count']} claims, {record['segment_count']} segments)"
        
        recommendations.append(StudyRecommendation(
            concept_id=concept_id,
            concept_name=concept_name,
            priority=priority,
            reason=reason,
            suggested_documents=suggested_docs,
            estimated_time_min=30  # Default estimate
        ))
    
    return recommendations
