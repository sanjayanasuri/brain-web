"""
API endpoints for lecture management and ingestion.

Do not call backend endpoints from backend services. Use ingestion kernel/internal services to prevent ingestion path drift.
"""
from typing import List
import uuid
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks

from db_neo4j import get_neo4j_session
from auth import require_auth
from models import (
    Lecture,
    LectureCreate,
    LectureUpdate,
    LectureStepCreate,
    LectureStep,
    LectureIngestRequest,
    HandwritingIngestRequest,
    LectureIngestResult,
    LectureSegment,
    LectureSegmentUpdate,
    LectureBlock,
    LectureBlocksUpsertRequest,
    LectureMention,
    Concept,
    Analogy,
    NotebookPage,
    NotebookPageUpdate,
    FreeformCanvasCaptureRequest,
    FreeformCanvasCaptureResponse,
)
from services_lectures import (
    create_lecture,
    get_lecture_by_id,
    update_lecture,
    add_lecture_step,
    get_lecture_steps,
    list_lectures,
    get_notebook_pages,
    upsert_notebook_page,
)
from services_graph import update_lecture_segment
from services_lecture_blocks import upsert_lecture_blocks, list_lecture_blocks
from services_lecture_ingestion import ingest_handwriting
from services_lecture_mentions import list_lecture_mentions
from services_lecture_draft import draft_next_lecture
from services_sync import auto_export_csv
from services_ingestion_kernel import ingest_artifact
from models_ingestion_kernel import ArtifactInput, IngestionActions, IngestionPolicy
from services_branch_explorer import get_active_graph_context
from cache_utils import get_cached, set_cached, invalidate_cache_pattern

import logging
logger = logging.getLogger(__name__)

router = APIRouter(prefix="/lectures", tags=["lectures"])


@router.post("/ingest", response_model=LectureIngestResult)
def ingest_lecture_endpoint(
    payload: LectureIngestRequest,
    session=Depends(get_neo4j_session),
    background_tasks: BackgroundTasks = BackgroundTasks(),
    auth: dict = Depends(require_auth),
):
    """
    Ingest a lecture by extracting concepts and relationships using LLM.
    
    This endpoint:
    1. SAVES the lecture immediately (prioritizing data persistence)
    2. Processes AI extraction in background (non-blocking)
    3. Returns the lecture with AI processing status
    
    The lecture is always saved, even if AI processing fails.
    AI processing extracts:
    - Concepts with name, description, domain, type, examples, tags
    - Relationships with source, target, predicate, explanation, confidence
    
    Nodes are matched by name (case-insensitive) and optionally domain.
    If a node exists, its description and tags are updated if the new ones are more detailed.
    """
    tenant_id = auth.get("tenant_id")
    # Step 1: Save lecture immediately (prioritize persistence)
    try:
        lecture = create_lecture(
            session=session,
            payload=LectureCreate(
                title=payload.lecture_title,
                description=None,
                raw_text=payload.lecture_text,
            ),
            tenant_id=tenant_id,
        )
        print(f"[Lecture Ingestion] ✓ Saved lecture {lecture.lecture_id} immediately")
    except Exception as e:
        logger.error(f"Failed to save lecture: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to save lecture: {str(e)}")
    
    # Step 2: Construct ArtifactInput for unified kernel
    artifact_input = ArtifactInput(
        artifact_type="lecture",
        title=payload.lecture_title,
        domain=payload.domain or "General",
        text=payload.lecture_text,
        existing_artifact_id=lecture.lecture_id,
        actions=IngestionActions(
            run_lecture_extraction=True,
            run_chunk_and_claims=True,
            embed_claims=True,
            create_lecture_node=True,
            create_artifact_node=False, # Already created by create_lecture
        ),
        policy=IngestionPolicy(
            local_only=True,
            max_chars=200_000,
            min_chars=100,
        )
    )
    
    # Step 3: Call unified ingestion kernel
    try:
        result = ingest_artifact(session, artifact_input, tenant_id=tenant_id)
    except Exception as e:
        logger.error(f"Unified ingestion failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))
    
    # Step 4: Map to LectureIngestResult
    out = LectureIngestResult(
        lecture_id=result.lecture_id or lecture.lecture_id,
        nodes_created=result.nodes_created,
        nodes_updated=result.nodes_updated,
        links_created=result.links_created,
        segments=result.segments,
        run_id=result.run_id,
        created_concept_ids=result.created_concept_ids,
        updated_concept_ids=result.updated_concept_ids,
        created_relationship_count=result.created_relationship_count,
        created_claim_ids=result.created_claim_ids,
        reused_existing=result.reused_existing,
    )
    
    # Auto-export to CSV after ingestion
    auto_export_csv(background_tasks)
    invalidate_cache_pattern("lectures")
    
    # Emit ActivityEvent for ingestion start
    try:
        event_id = str(uuid.uuid4())
        now = datetime.utcnow().isoformat() + "Z"
        session.run(
            """
            CREATE (e:ActivityEvent {
                id: $id,
                user_id: $user_id,
                graph_id: $graph_id,
                type: 'INGESTION_STARTED',
                payload: $payload,
                created_at: $created_at
            })
            """,
            id=event_id,
            user_id=auth.get("user_id"),
            graph_id=get_active_graph_context(session, tenant_id=tenant_id)[0],
            payload={"lecture_id": out.lecture_id, "title": payload.lecture_title},
            created_at=now
        )
    except Exception as e:
        logger.warning(f"Failed to emit INGESTION_STARTED event: {e}")

    return out


@router.post("/ingest-ink", response_model=LectureIngestResult)
def ingest_ink_endpoint(
    payload: HandwritingIngestRequest,
    session=Depends(get_neo4j_session),
):
    """
    Ingest handwritten notes or sketches from a canvas image.
    Uses GPT-4o Vision for transcription and graph extraction.
    """
    try:
        result = ingest_handwriting(session, payload)
        return result
    except Exception as e:
        print(f"ERROR: Handwriting ingestion failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/", response_model=List[Lecture])
def list_lectures_endpoint(session=Depends(get_neo4j_session)):
    """
    List all lectures in the active graph + branch.
    """
    cache_key = ("lectures", "list")
    cached = get_cached(*cache_key)
    if cached:
        return [Lecture(**l) for l in cached]
        
    lectures = list_lectures(session)
    set_cached(cache_key[0], [l.dict() for l in lectures], *cache_key[1:], ttl_seconds=300)
    return lectures


@router.post("/", response_model=Lecture)
def create_lecture_endpoint(
    payload: LectureCreate,
    session=Depends(get_neo4j_session),
    background_tasks: BackgroundTasks = BackgroundTasks()
):
    lecture = create_lecture(session, payload)
    # Auto-export to CSV after creating lecture
    auto_export_csv(background_tasks)
    # Invalidate lecture-related caches
    invalidate_cache_pattern("lectures")
    return lecture


@router.get("/{lecture_id}", response_model=Lecture)
def read_lecture(lecture_id: str, session=Depends(get_neo4j_session)):
    cache_key = ("lectures", "detail", lecture_id)
    cached = get_cached(*cache_key)
    if cached:
        return Lecture(**cached)
        
    lecture = get_lecture_by_id(session, lecture_id)
    if not lecture:
        raise HTTPException(status_code=404, detail="Lecture not found")
    
    set_cached(cache_key[0], lecture.dict(), *cache_key[1:], ttl_seconds=600)
    return lecture


@router.put("/{lecture_id}", response_model=Lecture)
def update_lecture_endpoint(
    lecture_id: str,
    payload: LectureUpdate,
    session=Depends(get_neo4j_session),
    background_tasks: BackgroundTasks = BackgroundTasks()
):
    """
    Update a lecture's title, raw_text, metadata_json, and/or annotations.
    This endpoint is used by the editor for auto-save and manual updates.
    """
    lecture = update_lecture(
        session=session,
        lecture_id=lecture_id,
        title=payload.title,
        raw_text=payload.raw_text,
        metadata_json=payload.metadata_json,
        annotations=payload.annotations,
    )
    if not lecture:
        raise HTTPException(status_code=404, detail="Lecture not found")
    # Auto-export to CSV after updating lecture
    auto_export_csv(background_tasks)
    # Invalidate lecture-related caches
    invalidate_cache_pattern("lectures")
    return lecture


@router.post("/{lecture_id}/blocks", response_model=List[LectureBlock])
def upsert_blocks_endpoint(
    lecture_id: str,
    payload: LectureBlocksUpsertRequest,
    session=Depends(get_neo4j_session),
):
    """
    Upsert lecture blocks with stable block IDs.
    """
    return upsert_lecture_blocks(session, lecture_id, payload.blocks)


@router.get("/{lecture_id}/blocks", response_model=List[LectureBlock])
def list_blocks_endpoint(lecture_id: str, session=Depends(get_neo4j_session)):
    """
    List lecture blocks by lecture ID.
    """
    return list_lecture_blocks(session, lecture_id)


@router.get("/{lecture_id}/mentions", response_model=List[LectureMention])
def list_mentions_endpoint(lecture_id: str, session=Depends(get_neo4j_session)):
    """
    List linked mentions for a lecture.
    """
    cache_key = ("lectures", "mentions", lecture_id)
    cached = get_cached(*cache_key)
    if cached:
        return [LectureMention(**m) for m in cached]

    mentions = list_lecture_mentions(session, lecture_id)
    set_cached(cache_key[0], [m.dict() for m in mentions], *cache_key[1:], ttl_seconds=300)
    return mentions


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
        # Invalidate steps/outline cache
        invalidate_cache_pattern(f"lectures:steps:{lecture_id}")
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return step


@router.get("/{lecture_id}/steps", response_model=List[LectureStep])
def read_lecture_steps(lecture_id: str, session=Depends(get_neo4j_session)):
    cache_key = ("lectures", "steps", lecture_id)
    cached = get_cached(*cache_key)
    if cached:
        return [LectureStep(**s) for s in cached]

    steps = get_lecture_steps(session, lecture_id)
    if not steps:
        return []
    
    set_cached(cache_key[0], [s.dict() for s in steps], *cache_key[1:], ttl_seconds=600)
    return steps


@router.get("/{lecture_id}/pages", response_model=List[NotebookPage])
def read_notebook_pages(lecture_id: str, session=Depends(get_neo4j_session)):
    """
    Get all notebook pages for a lecture.
    """
    return get_notebook_pages(session, lecture_id)


@router.post("/{lecture_id}/pages", response_model=NotebookPage)
def update_notebook_page_endpoint(
    lecture_id: str,
    payload: NotebookPage,
    session=Depends(get_neo4j_session),
    background_tasks: BackgroundTasks = BackgroundTasks()
):
    """
    Create or update a notebook page.
    """
    page = upsert_notebook_page(
        session=session,
        lecture_id=lecture_id,
        page_number=payload.page_number,
        content=payload.content,
        ink_data=payload.ink_data,
        paper_type=payload.paper_type
    )
    # Auto-export to CSV after updating
    auto_export_csv(background_tasks)
    return page


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
           seg.ink_url AS ink_url,
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


def get_lecture_segments(lecture_id: str, session) -> List[LectureSegment]:
    from services_graph import _normalize_concept_from_db
    
    query = """
    MATCH (l:Lecture {lecture_id: $lecture_id})
    MATCH (l)-[:HAS_SEGMENT]->(seg:LectureSegment)
    OPTIONAL MATCH (seg)-[:COVERS]->(c:Concept)
    OPTIONAL MATCH (seg)-[:USES_ANALOGY]->(a:Analogy)
    RETURN seg.segment_id AS segment_id,
           l.lecture_id AS lecture_id,
           seg.segment_index AS segment_index,
           seg.start_time_sec AS start_time_sec,
           seg.end_time_sec AS end_time_sec,
           seg.text AS text,
           seg.summary AS summary,
           seg.style_tags AS style_tags,
           l.title AS lecture_title,
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
def get_lecture_segments_endpoint(lecture_id: str, session=Depends(get_neo4j_session)):
    """
    Get all segments for a lecture, including their covered concepts and analogies.
    """
    cache_key = ("lectures", "segments", lecture_id)
    cached = get_cached(*cache_key)
    if cached:
        return [LectureSegment(**s) for s in cached]
        
    segments = get_lecture_segments(lecture_id, session) # Note: order of args in function is (lecture_id, session)
    set_cached(cache_key[0], [s.dict() for s in segments], *cache_key[1:], ttl_seconds=600)
    return segments


@router.get("/{lecture_id}/pages", response_model=List[NotebookPage])
def read_notebook_pages_endpoint(lecture_id: str, session=Depends(get_neo4j_session)):
    """
    Get all notebook pages for a lecture.
    """
    cache_key = ("lectures", "pages", lecture_id)
    cached = get_cached(*cache_key)
    if cached:
        return [NotebookPage(**p) for p in cached]
        
    pages = read_notebook_pages(lecture_id, session)
    set_cached(cache_key[0], [p.dict() for p in pages], *cache_key[1:], ttl_seconds=600)
    return pages


@router.put("/segments/{segment_id}", response_model=LectureSegment)
def update_segment_endpoint(
    segment_id: str,
    payload: LectureSegmentUpdate,
    session=Depends(get_neo4j_session),
    background_tasks: BackgroundTasks = BackgroundTasks()
):
    """
    Update a lecture segment's text and/or other fields.
    This endpoint is used by the segment reader for saving edited text.
    """
    updated = update_lecture_segment(
        session=session,
        segment_id=segment_id,
        text=payload.text,
        summary=payload.summary,
        start_time_sec=payload.start_time_sec,
        end_time_sec=payload.end_time_sec,
        style_tags=payload.style_tags,
    )
    if not updated:
        raise HTTPException(status_code=404, detail="Segment not found")
    
    # Auto-export to CSV after updating segment
    auto_export_csv(background_tasks)
    
    # Fetch the full segment with concepts and analogies to return
    from services_graph import _normalize_concept_from_db
    
    query = """
    MATCH (seg:LectureSegment {segment_id: $segment_id})
    OPTIONAL MATCH (seg)-[:COVERS]->(c:Concept)
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
    LIMIT 1
    """
    record = session.run(query, segment_id=segment_id).single()
    if not record:
        raise HTTPException(status_code=404, detail="Segment not found")
    
    seg_data = {
        "segment_id": record["segment_id"],
        "lecture_id": record["lecture_id"],
        "segment_index": record["segment_index"] or 0,
        "start_time_sec": record["start_time_sec"],
        "end_time_sec": record["end_time_sec"],
        "text": record["text"] or "",
        "summary": record["summary"],
        "style_tags": record["style_tags"] or [],
    }
    
    if record.get("lecture_title"):
        seg_data["lecture_title"] = record["lecture_title"]
    
    concepts = record["concepts"] or []
    concept_models = []
    for c_data in concepts:
        if c_data and c_data.get("node_id"):
            concept_models.append(_normalize_concept_from_db(c_data))
    
    analogies = record["analogies"] or []
    analogy_models = []
    for a_data in analogies:
        if a_data and a_data.get("analogy_id"):
            analogy_models.append(Analogy(**a_data))
    
    return LectureSegment(
        **seg_data,
        covered_concepts=concept_models,
        analogies=analogy_models,
    )


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
    except HTTPException:
        raise
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        print(f"ERROR in draft-next lecture: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to draft lecture: {str(e)}")


@router.post("/freeform-capture", response_model=FreeformCanvasCaptureResponse)
def freeform_canvas_capture(
    payload: FreeformCanvasCaptureRequest,
    session=Depends(get_neo4j_session),
    auth: dict = Depends(require_auth),
):
    """
    Analyze a freeform canvas and produce a structured knowledge graph capture.
    Strokes are analyzed geometrically; enclosed shapes -> concept nodes,
    arrows -> directed links, text -> notes. A Markdown transcript is produced.
    """
    try:
        from services_freeform_canvas import capture_freeform_canvas

        tenant_id = auth.get("tenant_id")
        return capture_freeform_canvas(session, payload, tenant_id=tenant_id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        print(f"ERROR in freeform canvas capture: {e}")
        raise HTTPException(status_code=500, detail=f"Freeform canvas capture failed: {str(e)}")
    
    # Emit ActivityEvent for canvas capture
    try:
        tenant_id = auth.get("tenant_id")
        user_id = auth.get("user_id")
        graph_id, _ = get_active_graph_context(session, tenant_id=tenant_id)
        
        event_id = str(uuid.uuid4())
        now = datetime.utcnow().isoformat() + "Z"
        session.run(
            """
            CREATE (e:ActivityEvent {
                id: $id,
                user_id: $user_id,
                graph_id: $graph_id,
                type: 'CANVAS_CAPTURED',
                payload: $payload,
                created_at: $created_at
            })
            """,
            id=event_id,
            user_id=user_id,
            graph_id=graph_id,
            payload={"title": payload.title or "Untitled Canvas"},
            created_at=now
        )
    except Exception as e:
        logger.warning(f"Failed to emit CANVAS_CAPTURED event: {e}")
