"""
API endpoints for lecture management and ingestion.

Do not call backend endpoints from backend services. Use ingestion kernel/internal services to prevent ingestion path drift.
"""
from typing import List

from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks

from db_neo4j import get_neo4j_session
from models import (
    Lecture,
    LectureCreate,
    LectureStepCreate,
    LectureStep,
    LectureIngestRequest,
    LectureIngestResult,
    LectureSegment,
    Concept,
    Analogy,
)
from services_lectures import (
    create_lecture,
    get_lecture_by_id,
    add_lecture_step,
    get_lecture_steps,
)
from services_lecture_ingestion import ingest_lecture
from services_lecture_draft import draft_next_lecture
from services_sync import auto_export_csv

router = APIRouter(prefix="/lectures", tags=["lectures"])


@router.post("/ingest", response_model=LectureIngestResult)
def ingest_lecture_endpoint(
    payload: LectureIngestRequest,
    session=Depends(get_neo4j_session),
    background_tasks: BackgroundTasks = BackgroundTasks(),
):
    """
    Ingest a lecture by extracting concepts and relationships using LLM.
    
    This endpoint:
    1. Calls an LLM to extract nodes (concepts) and links (relationships) from the lecture text
    2. Upserts nodes into the graph (creates new or updates existing by name+domain)
    3. Creates relationships between concepts
    4. Returns the created/updated nodes and links
    
    The LLM extracts:
    - Concepts with name, description, domain, type, examples, tags
    - Relationships with source, target, predicate, explanation, confidence
    
    Nodes are matched by name (case-insensitive) and optionally domain.
    If a node exists, its description and tags are updated if the new ones are more detailed.
    """
    try:
        result = ingest_lecture(
            session=session,
            lecture_title=payload.lecture_title,
            lecture_text=payload.lecture_text,
            domain=payload.domain,
        )
        # Auto-export to CSV after ingestion
        auto_export_csv(background_tasks)
        return result
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        print(f"ERROR in lecture ingestion: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to ingest lecture: {str(e)}")


@router.post("/", response_model=Lecture)
def create_lecture_endpoint(
    payload: LectureCreate,
    session=Depends(get_neo4j_session),
    background_tasks: BackgroundTasks = BackgroundTasks()
):
    lecture = create_lecture(session, payload)
    # Auto-export to CSV after creating lecture
    auto_export_csv(background_tasks)
    return lecture


@router.get("/{lecture_id}", response_model=Lecture)
def read_lecture(lecture_id: str, session=Depends(get_neo4j_session)):
    lecture = get_lecture_by_id(session, lecture_id)
    if not lecture:
        raise HTTPException(status_code=404, detail="Lecture not found")
    return lecture


@router.post("/{lecture_id}/steps", response_model=LectureStep)
def add_lecture_step_endpoint(
    lecture_id: str,
    payload: LectureStepCreate,
    session=Depends(get_neo4j_session),
    background_tasks: BackgroundTasks = BackgroundTasks()
):
    try:
        step = add_lecture_step(session, lecture_id, payload)
        # Auto-export to CSV after adding lecture step
        auto_export_csv(background_tasks)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return step


@router.get("/{lecture_id}/steps", response_model=List[LectureStep])
def read_lecture_steps(lecture_id: str, session=Depends(get_neo4j_session)):
    steps = get_lecture_steps(session, lecture_id)
    if not steps:
        # Could be lecture missing or just no steps; we keep it simple for now.
        # Caller can check separately if they need to distinguish.
        return []
    return steps


@router.get("/segments/by-concept/{concept_name}", response_model=List[LectureSegment])
def get_segments_by_concept(concept_name: str, session=Depends(get_neo4j_session)):
    """
    Find all segments that cover a specific concept.
    This answers: "How have I explained [concept] before?"
    """
    from services_graph import _normalize_concept_from_db
    
    query = """
    MATCH (c:Concept)
    WHERE toLower(trim(c.name)) = toLower(trim($concept_name))
    MATCH (seg:LectureSegment)-[:COVERS]->(c)
    OPTIONAL MATCH (seg)-[:COVERS]->(other_c:Concept)
    OPTIONAL MATCH (seg)-[:USES_ANALOGY]->(a:Analogy)
    OPTIONAL MATCH (lec:Lecture {lecture_id: seg.lecture_id})
    RETURN seg.segment_id AS segment_id,
           seg.lecture_id AS lecture_id,
           seg.segment_index AS segment_index,
           seg.start_time_sec AS start_time_sec,
           seg.end_time_sec AS end_time_sec,
           seg.text AS text,
           seg.summary AS summary,
           seg.style_tags AS style_tags,
           lec.title AS lecture_title,
           collect(DISTINCT {
             node_id: other_c.node_id,
             name: other_c.name,
             domain: other_c.domain,
             type: other_c.type,
             description: other_c.description,
             tags: other_c.tags,
             notes_key: other_c.notes_key,
             lecture_key: other_c.lecture_key,
             url_slug: other_c.url_slug,
             lecture_sources: COALESCE(other_c.lecture_sources, []),
             created_by: other_c.created_by,
             last_updated_by: other_c.last_updated_by
           }) AS concepts,
           collect(DISTINCT {
             analogy_id: a.analogy_id,
             label: a.label,
             description: a.description,
             tags: a.tags
           }) AS analogies
    ORDER BY seg.lecture_id, seg.segment_index
    """
    records = session.run(query, concept_name=concept_name)

    segments: List[LectureSegment] = []
    for rec in records:
        seg_data = {
            "segment_id": rec["segment_id"],
            "lecture_id": rec["lecture_id"],
            "segment_index": rec["segment_index"] or 0,
            "start_time_sec": rec["start_time_sec"],
            "end_time_sec": rec["end_time_sec"],
            "text": rec["text"] or "",
            "summary": rec["summary"],
            "style_tags": rec["style_tags"] or [],
        }
        
        # Add lecture_title if available
        if rec.get("lecture_title"):
            seg_data["lecture_title"] = rec["lecture_title"]
        
        concepts = rec["concepts"] or []
        concept_models = []
        for c_data in concepts:
            if c_data and c_data.get("node_id"):
                concept_models.append(_normalize_concept_from_db(c_data))
        
        analogies = rec["analogies"] or []
        analogy_models = []
        for a_data in analogies:
            if a_data and a_data.get("analogy_id"):
                analogy_models.append(Analogy(**a_data))

        segments.append(
            LectureSegment(
                **seg_data,
                covered_concepts=concept_models,
                analogies=analogy_models,
            )
        )
    return segments


@router.get("/{lecture_id}/segments", response_model=List[LectureSegment])
def get_lecture_segments(lecture_id: str, session=Depends(get_neo4j_session)):
    """
    Get all segments for a lecture, including their covered concepts and analogies.
    """
    from services_graph import _normalize_concept_from_db
    
    query = """
    MATCH (lec:Lecture {lecture_id: $lecture_id})-[:HAS_SEGMENT]->(seg:LectureSegment)
    OPTIONAL MATCH (seg)-[:COVERS]->(c:Concept)
    OPTIONAL MATCH (seg)-[:USES_ANALOGY]->(a:Analogy)
    RETURN seg.segment_id AS segment_id,
           seg.lecture_id AS lecture_id,
           seg.segment_index AS segment_index,
           seg.start_time_sec AS start_time_sec,
           seg.end_time_sec AS end_time_sec,
           seg.text AS text,
           seg.summary AS summary,
           seg.style_tags AS style_tags,
           lec.title AS lecture_title,
           collect(DISTINCT {
             node_id: c.node_id,
             name: c.name,
             domain: c.domain,
             type: c.type,
             description: c.description,
             tags: c.tags,
             notes_key: c.notes_key,
             lecture_key: c.lecture_key,
             url_slug: c.url_slug,
             lecture_sources: COALESCE(c.lecture_sources, []),
             created_by: c.created_by,
             last_updated_by: c.last_updated_by
           }) AS concepts,
           collect(DISTINCT {
             analogy_id: a.analogy_id,
             label: a.label,
             description: a.description,
             tags: a.tags
           }) AS analogies
    ORDER BY seg.segment_index
    """
    records = session.run(query, lecture_id=lecture_id)

    segments: List[LectureSegment] = []
    for rec in records:
        # Extract segment data
        seg_data = {
            "segment_id": rec["segment_id"],
            "lecture_id": rec["lecture_id"] or lecture_id,
            "segment_index": rec["segment_index"] or 0,
            "start_time_sec": rec["start_time_sec"],
            "end_time_sec": rec["end_time_sec"],
            "text": rec["text"] or "",
            "summary": rec["summary"],
            "style_tags": rec["style_tags"] or [],
        }
        
        # Add lecture_title if available
        if rec.get("lecture_title"):
            seg_data["lecture_title"] = rec["lecture_title"]
        
        # Extract concepts (filter out None and empty dicts)
        concepts = rec["concepts"] or []
        concept_models = []
        for c_data in concepts:
            if c_data and c_data.get("node_id"):  # Only process if node_id exists
                concept_models.append(_normalize_concept_from_db(c_data))
        
        # Extract analogies (filter out None and empty dicts)
        analogies = rec["analogies"] or []
        analogy_models = []
        for a_data in analogies:
            if a_data and a_data.get("analogy_id"):  # Only process if analogy_id exists
                analogy_models.append(Analogy(**a_data))

        segments.append(
            LectureSegment(
                **seg_data,
                covered_concepts=concept_models,
                analogies=analogy_models,
            )
        )
    return segments

@router.post("/draft-next")
def draft_next_lecture_endpoint(
    payload: dict,
    session=Depends(get_neo4j_session),
):
    """
    Draft a follow-up lecture outline based on seed concepts and teaching style.
    
    Request body:
    {
        "seed_concepts": ["Concept Name 1", "Concept Name 2"],
        "source_lecture_id": "LECTURE_ABC123" (optional),
        "target_level": "intro" | "intermediate" | "advanced"
    }
    
    Response:
    {
        "outline": ["1. Section title", ...],
        "sections": [{"title": "...", "summary": "..."}, ...],
        "suggested_analogies": [{"label": "...", "description": "...", "target_concepts": [...]}, ...]
    }
    """
    try:
        seed_concepts = payload.get("seed_concepts", [])
        if not seed_concepts:
            raise HTTPException(status_code=400, detail="seed_concepts is required")
        
        source_lecture_id = payload.get("source_lecture_id")
        target_level = payload.get("target_level", "intermediate")
        
        if target_level not in ["intro", "intermediate", "advanced"]:
            target_level = "intermediate"
        
        result = draft_next_lecture(
            session=session,
            seed_concepts=seed_concepts,
            source_lecture_id=source_lecture_id,
            target_level=target_level,
        )
        
        return result
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        print(f"ERROR in draft-next lecture: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to draft lecture: {str(e)}")
