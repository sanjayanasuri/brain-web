# services_lectures.py

from typing import List, Optional, Any, Dict
from uuid import uuid4

from neo4j import Session

from models import Concept, Lecture, LectureCreate, LectureStep, LectureStepCreate, NotebookPage
from services_branch_explorer import ensure_graph_scoping_initialized, get_active_graph_context


def create_lecture(session: Session, payload: LectureCreate, tenant_id: Optional[str] = None) -> Lecture:
    """
    Create a Lecture node scoped to the active graph + branch.
    """
    ensure_graph_scoping_initialized(session)
    graph_id, branch_id = get_active_graph_context(session, tenant_id=tenant_id)

    lecture_id = f"L{uuid4().hex[:8].upper()}"

    query = """
    MATCH (g:GraphSpace {graph_id: $graph_id})
    CREATE (l:Lecture {
        lecture_id: $lecture_id,
        graph_id: $graph_id,
        on_branches: [$branch_id],
        title: $title,
        description: $description,
        primary_concept: $primary_concept,
        level: $level,
        estimated_time: $estimated_time,
        slug: $slug,
        raw_text: $raw_text,
        annotations: $annotations,
        tenant_id: $tenant_id
    })
    MERGE (l)-[:BELONGS_TO]->(g)
    RETURN l.lecture_id AS lecture_id,
           l.title AS title,
           l.description AS description,
           l.primary_concept AS primary_concept,
           l.level AS level,
           l.estimated_time AS estimated_time,
           l.slug AS slug,
           l.raw_text AS raw_text,
           l.annotations AS annotations
    """

    params = {
        "graph_id": graph_id,
        "branch_id": branch_id,
        "lecture_id": lecture_id,
        "title": payload.title,
        "description": payload.description,
        "primary_concept": payload.primary_concept,
        "level": payload.level,
        "estimated_time": payload.estimated_time,
        "slug": payload.slug,
        "raw_text": payload.raw_text,
        "annotations": payload.annotations,
        "tenant_id": tenant_id,
    }

    record = session.run(query, **params).single()
    return Lecture(**record.data())


def get_lecture_by_id(session: Session, lecture_id: str) -> Optional[Lecture]:
    """
    Get a lecture by ID. First tries graph-scoped lookup, then falls back to
    non-graph-scoped lookup for ingested lectures that don't have graph_id.
    """
    ensure_graph_scoping_initialized(session)
    graph_id, branch_id = get_active_graph_context(session)

    # First try: graph-scoped lookup (for lectures created via API)
    query = """
    MATCH (g:GraphSpace {graph_id: $graph_id})
    MATCH (l:Lecture {lecture_id: $lecture_id, graph_id: $graph_id})-[:BELONGS_TO]->(g)
    WHERE $branch_id IN COALESCE(l.on_branches, [])
    OPTIONAL MATCH (l)-[:HAS_SEGMENT]->(seg:LectureSegment)
    RETURN l.lecture_id AS lecture_id,
           l.title AS title,
           l.description AS description,
           l.primary_concept AS primary_concept,
           l.level AS level,
           l.estimated_time AS estimated_time,
           l.slug AS slug,
           l.raw_text AS raw_text,
           l.metadata_json AS metadata_json,
           l.annotations AS annotations,
           count(DISTINCT seg) AS segment_count
    LIMIT 1
    """
    record = session.run(query, graph_id=graph_id, branch_id=branch_id, lecture_id=lecture_id).single()
    if record:
        data = record.data()
        data["segment_count"] = data.get("segment_count", 0) or 0
        return Lecture(**data)
    
    # Fallback: non-graph-scoped lookup (for ingested lectures)
    # If graph-scoped lookup failed, try to find the lecture by ID only
    # This handles lectures created during ingestion that don't have graph scoping
    fallback_query = """
    MATCH (l:Lecture {lecture_id: $lecture_id})
    OPTIONAL MATCH (l)-[:HAS_SEGMENT]->(seg:LectureSegment)
    RETURN l.lecture_id AS lecture_id,
           l.title AS title,
           l.description AS description,
           l.primary_concept AS primary_concept,
           l.level AS level,
           l.estimated_time AS estimated_time,
           l.slug AS slug,
           l.raw_text AS raw_text,
           l.metadata_json AS metadata_json,
           l.annotations AS annotations,
           count(DISTINCT seg) AS segment_count
    LIMIT 1
    """
    fallback_record = session.run(fallback_query, lecture_id=lecture_id).single()
    if fallback_record:
        data = fallback_record.data()
        data["segment_count"] = data.get("segment_count", 0) or 0
        return Lecture(**data)
    
    return None


def add_lecture_step(session: Session, lecture_id: str, payload: LectureStepCreate) -> LectureStep:
    """
    Create or update a COVERS relationship between a Lecture and a Concept,
    scoped to the active graph + branch.
    """
    ensure_graph_scoping_initialized(session)
    graph_id, branch_id = get_active_graph_context(session)

    query = """
    MATCH (g:GraphSpace {graph_id: $graph_id})
    MATCH (l:Lecture {lecture_id: $lecture_id, graph_id: $graph_id})-[:BELONGS_TO]->(g)
    MATCH (c:Concept {node_id: $concept_id, graph_id: $graph_id})-[:BELONGS_TO]->(g)
    WHERE $branch_id IN COALESCE(l.on_branches, [])
      AND $branch_id IN COALESCE(c.on_branches, [])
    MERGE (l)-[r:COVERS {graph_id: $graph_id}]->(c)
    SET r.step_order = $step_order,
        r.on_branches = CASE
          WHEN r.on_branches IS NULL THEN [$branch_id]
          WHEN $branch_id IN r.on_branches THEN r.on_branches
          ELSE r.on_branches + $branch_id
        END
    RETURN l.lecture_id AS lecture_id,
           r.step_order AS step_order,
           c.node_id AS node_id,
           c.name AS name,
           c.domain AS domain,
           c.type AS type,
           c.notes_key AS notes_key,
           c.lecture_key AS lecture_key,
           c.url_slug AS url_slug
    """

    params = {
        "graph_id": graph_id,
        "branch_id": branch_id,
        "lecture_id": lecture_id,
        "concept_id": payload.concept_id,
        "step_order": payload.step_order,
    }

    record = session.run(query, **params).single()
    if not record:
        raise ValueError("Lecture or Concept not found (or not in active graph/branch)")

    concept = Concept(
        node_id=record["node_id"],
        name=record["name"],
        domain=record["domain"],
        type=record["type"],
        notes_key=record["notes_key"],
        lecture_key=record["lecture_key"],
        url_slug=record["url_slug"],
    )

    return LectureStep(
        lecture_id=record["lecture_id"],
        step_order=record["step_order"],
        concept=concept,
    )


def list_lectures(session: Session) -> List[Lecture]:
    """
    List all lectures in the active graph + branch.
    If no lectures found in the active branch, also check other branches in the same graph.
    """
    graph_id, branch_id = get_active_graph_context(session)

    # First try to get lectures in the active branch
    # First try to get lectures in the active branch
    # Optimized query using count{} subquery for segments
    query = """
    MATCH (g:GraphSpace {graph_id: $graph_id})
    MATCH (l:Lecture {graph_id: $graph_id})-[:BELONGS_TO]->(g)
    WHERE $branch_id IN COALESCE(l.on_branches, [])
    RETURN l.lecture_id AS lecture_id,
           l.title AS title,
           l.description AS description,
           l.primary_concept AS primary_concept,
           l.level AS level,
           l.estimated_time AS estimated_time,
           l.slug AS slug,
           l.raw_text AS raw_text,
           l.metadata_json AS metadata_json,
           count { (l)-[:HAS_SEGMENT]->(:LectureSegment) } AS segment_count
    ORDER BY l.title
    """

    result = session.run(query, graph_id=graph_id, branch_id=branch_id)
    lectures: List[Lecture] = []

    for record in result:
        lectures.append(Lecture(
            lecture_id=record["lecture_id"],
            title=record["title"],
            description=record["description"],
            primary_concept=record["primary_concept"],
            level=record["level"],
            estimated_time=record["estimated_time"],
            slug=record["slug"],
            raw_text=record.get("raw_text"),
            metadata_json=record.get("metadata_json"),
            segment_count=record.get("segment_count", 0) or 0,
        ))

    # If no lectures found in active branch, try to get all lectures in the graph
    # (this helps with lectures that might not have on_branches set properly)
    if len(lectures) == 0:
        fallback_query = """
        MATCH (g:GraphSpace {graph_id: $graph_id})
        MATCH (l:Lecture {graph_id: $graph_id})-[:BELONGS_TO]->(g)
        RETURN l.lecture_id AS lecture_id,
               l.title AS title,
               l.description AS description,
               l.primary_concept AS primary_concept,
               l.level AS level,
               l.estimated_time AS estimated_time,
               l.slug AS slug,
               l.raw_text AS raw_text,
               l.metadata_json AS metadata_json,
               count { (l)-[:HAS_SEGMENT]->(:LectureSegment) } AS segment_count
        ORDER BY l.title
        """
        fallback_result = session.run(fallback_query, graph_id=graph_id)
        for record in fallback_result:
            lectures.append(Lecture(
                lecture_id=record["lecture_id"],
                title=record["title"],
                description=record["description"],
                primary_concept=record["primary_concept"],
                level=record["level"],
                estimated_time=record["estimated_time"],
                slug=record["slug"],
                raw_text=record.get("raw_text"),
                metadata_json=record.get("metadata_json"),
                segment_count=record.get("segment_count", 0) or 0,
            ))

    return lectures


def get_lecture_steps(session: Session, lecture_id: str) -> List[LectureStep]:
    """
    Return all concepts covered by a lecture in the active graph + branch.
    """
    ensure_graph_scoping_initialized(session)
    graph_id, branch_id = get_active_graph_context(session)

    query = """
    MATCH (g:GraphSpace {graph_id: $graph_id})
    MATCH (l:Lecture {lecture_id: $lecture_id, graph_id: $graph_id})-[:BELONGS_TO]->(g)
    WHERE $branch_id IN COALESCE(l.on_branches, [])
    MATCH (l)-[r:COVERS]->(c:Concept {graph_id: $graph_id})-[:BELONGS_TO]->(g)
    WHERE r.graph_id = $graph_id
      AND $branch_id IN COALESCE(r.on_branches, [])
      AND $branch_id IN COALESCE(c.on_branches, [])
    RETURN l.lecture_id AS lecture_id,
           r.step_order AS step_order,
           c.node_id AS node_id,
           c.name AS name,
           c.domain AS domain,
           c.type AS type,
           c.notes_key AS notes_key,
           c.lecture_key AS lecture_key,
           c.url_slug AS url_slug
    ORDER BY r.step_order ASC
    """

    result = session.run(query, graph_id=graph_id, branch_id=branch_id, lecture_id=lecture_id)
    steps: List[LectureStep] = []

    for record in result:
        concept = Concept(
            node_id=record["node_id"],
            name=record["name"],
            domain=record["domain"],
            type=record["type"],
            notes_key=record["notes_key"],
            lecture_key=record["lecture_key"],
            url_slug=record["url_slug"],
        )
        steps.append(
            LectureStep(
                lecture_id=record["lecture_id"],
                step_order=record["step_order"],
                concept=concept,
            )
        )

    return steps


def update_lecture(session: Session, lecture_id: str, title: Optional[str] = None, slug: Optional[str] = None, raw_text: Optional[str] = None, metadata_json: Optional[str] = None, annotations: Optional[str] = None) -> Optional[Lecture]:
    """
    Update a lecture's title, raw_text, metadata_json, and/or annotations.
    Returns the updated lecture or None if not found.
    """
    ensure_graph_scoping_initialized(session)
    graph_id, branch_id = get_active_graph_context(session)

    # Build SET clauses dynamically
    set_clauses = []
    params = {
        "graph_id": graph_id,
        "branch_id": branch_id,
        "lecture_id": lecture_id,
    }

    if title is not None:
        set_clauses.append("l.title = $title")
        params["title"] = title

    if raw_text is not None:
        set_clauses.append("l.raw_text = $raw_text")
        params["raw_text"] = raw_text

    if metadata_json is not None:
        set_clauses.append("l.metadata_json = $metadata_json")
        params["metadata_json"] = metadata_json

    if annotations is not None:
        set_clauses.append("l.annotations = $annotations")
        params["annotations"] = annotations

    if not set_clauses:
        # Nothing to update, just return the lecture
        return get_lecture_by_id(session, lecture_id)

    query = f"""
    MATCH (g:GraphSpace {{graph_id: $graph_id}})
    MATCH (l:Lecture {{lecture_id: $lecture_id, graph_id: $graph_id}})-[:BELONGS_TO]->(g)
    WHERE $branch_id IN COALESCE(l.on_branches, [])
    SET {', '.join(set_clauses)}
    RETURN l.lecture_id AS lecture_id,
           l.title AS title,
           l.description AS description,
           l.primary_concept AS primary_concept,
           l.level AS level,
           l.estimated_time AS estimated_time,
           l.slug AS slug,
           l.raw_text AS raw_text,
           l.metadata_json AS metadata_json,
           l.annotations AS annotations
    LIMIT 1
    """

    record = session.run(query, **params).single()
    if not record:
        return None
    return Lecture(**record.data())


def get_notebook_pages(session: Session, lecture_id: str) -> List[NotebookPage]:
    """
    Get all notebook pages for a lecture, ordered by page number.
    """
    ensure_graph_scoping_initialized(session)
    graph_id, _ = get_active_graph_context(session)

    query = """
    MATCH (g:GraphSpace {graph_id: $graph_id})
    MATCH (l:Lecture {lecture_id: $lecture_id, graph_id: $graph_id})-[:HAS_PAGE]->(p:NotebookPage)
    RETURN p.page_id AS page_id,
           p.lecture_id AS lecture_id,
           p.page_number AS page_number,
           p.content AS content,
           COALESCE(p.ink_data, "[]") AS ink_data_json,
           p.paper_type AS paper_type,
           p.created_at AS created_at,
           p.updated_at AS updated_at
    ORDER BY p.page_number
    """
    results = session.run(query, graph_id=graph_id, lecture_id=lecture_id)
    
    pages = []
    import json
    for rec in results:
        data = rec.data()
        # Convert ink_data from JSON string back to list
        ink_data_json = data.pop("ink_data_json", "[]")
        try:
            data["ink_data"] = json.loads(ink_data_json)
        except:
            data["ink_data"] = []
        pages.append(NotebookPage(**data))
    
    return pages


def upsert_notebook_page(session: Session, lecture_id: str, page_number: int, content: str, ink_data: List[Dict[str, Any]], paper_type: str = "ruled") -> NotebookPage:
    """
    Create or update a notebook page.
    """
    ensure_graph_scoping_initialized(session)
    graph_id, _ = get_active_graph_context(session)
    
    import json
    ink_data_json = json.dumps(ink_data)
    
    # Try to find existing page by number
    query = """
    MATCH (g:GraphSpace {graph_id: $graph_id})
    MATCH (l:Lecture {lecture_id: $lecture_id, graph_id: $graph_id})
    MERGE (l)-[:HAS_PAGE]->(p:NotebookPage {lecture_id: $lecture_id, page_number: $page_number})
    ON CREATE SET p.page_id = $page_id,
                  p.created_at = datetime(),
                  p.updated_at = datetime(),
                  p.content = $content,
                  p.ink_data = $ink_data_json,
                  p.paper_type = $paper_type
    ON MATCH SET p.content = $content,
                 p.ink_data = $ink_data_json,
                 p.paper_type = $paper_type,
                 p.updated_at = datetime()
    RETURN p.page_id AS page_id,
           p.lecture_id AS lecture_id,
           p.page_number AS page_number,
           p.content AS content,
           p.ink_data AS ink_data_json,
           p.paper_type AS paper_type,
           p.created_at AS created_at,
           p.updated_at AS updated_at
    """
    
    page_id = f"PAGE_{uuid4().hex[:8].upper()}"
    params = {
        "graph_id": graph_id,
        "lecture_id": lecture_id,
        "page_number": page_number,
        "page_id": page_id,
        "content": content,
        "ink_data_json": ink_data_json,
        "paper_type": paper_type
    }
    
    rec = session.run(query, **params).single()
    data = rec.data()
    ink_data_json = data.pop("ink_data_json", "[]")
    data["ink_data"] = json.loads(ink_data_json)
    return NotebookPage(**data)
