# services_lectures.py

from typing import List, Optional
from uuid import uuid4

from neo4j import Session

from models import Concept, Lecture, LectureCreate, LectureStep, LectureStepCreate
from services_branch_explorer import ensure_graph_scoping_initialized, get_active_graph_context


def create_lecture(session: Session, payload: LectureCreate) -> Lecture:
    """
    Create a Lecture node scoped to the active graph + branch.
    """
    ensure_graph_scoping_initialized(session)
    graph_id, branch_id = get_active_graph_context(session)

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
        raw_text: $raw_text
    })
    MERGE (l)-[:BELONGS_TO]->(g)
    RETURN l.lecture_id AS lecture_id,
           l.title AS title,
           l.description AS description,
           l.primary_concept AS primary_concept,
           l.level AS level,
           l.estimated_time AS estimated_time,
           l.slug AS slug,
           l.raw_text AS raw_text
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
    RETURN l.lecture_id AS lecture_id,
           l.title AS title,
           l.description AS description,
           l.primary_concept AS primary_concept,
           l.level AS level,
           l.estimated_time AS estimated_time,
           l.slug AS slug,
           l.raw_text AS raw_text
    LIMIT 1
    """
    record = session.run(query, graph_id=graph_id, branch_id=branch_id, lecture_id=lecture_id).single()
    if record:
        return Lecture(**record.data())
    
    # Fallback: non-graph-scoped lookup (for ingested lectures)
    # If graph-scoped lookup failed, try to find the lecture by ID only
    # This handles lectures created during ingestion that don't have graph scoping
    fallback_query = """
    MATCH (l:Lecture {lecture_id: $lecture_id})
    RETURN l.lecture_id AS lecture_id,
           l.title AS title,
           l.description AS description,
           l.primary_concept AS primary_concept,
           l.level AS level,
           l.estimated_time AS estimated_time,
           l.slug AS slug,
           l.raw_text AS raw_text
    LIMIT 1
    """
    fallback_record = session.run(fallback_query, lecture_id=lecture_id).single()
    if fallback_record:
        return Lecture(**fallback_record.data())
    
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
    ensure_graph_scoping_initialized(session)
    graph_id, branch_id = get_active_graph_context(session)

    # First try to get lectures in the active branch
    query = """
    MATCH (g:GraphSpace {graph_id: $graph_id})
    MATCH (l:Lecture {graph_id: $graph_id})-[:BELONGS_TO]->(g)
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
           count(DISTINCT seg) AS segment_count
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
        ))

    # If no lectures found in active branch, try to get all lectures in the graph
    # (this helps with lectures that might not have on_branches set properly)
    if len(lectures) == 0:
        fallback_query = """
        MATCH (g:GraphSpace {graph_id: $graph_id})
        MATCH (l:Lecture {graph_id: $graph_id})-[:BELONGS_TO]->(g)
        OPTIONAL MATCH (l)-[:HAS_SEGMENT]->(seg:LectureSegment)
        RETURN l.lecture_id AS lecture_id,
               l.title AS title,
               l.description AS description,
               l.primary_concept AS primary_concept,
               l.level AS level,
               l.estimated_time AS estimated_time,
               l.slug AS slug,
               l.raw_text AS raw_text,
               count(DISTINCT seg) AS segment_count
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


def update_lecture(session: Session, lecture_id: str, title: Optional[str] = None, raw_text: Optional[str] = None) -> Optional[Lecture]:
    """
    Update a lecture's title and/or raw_text.
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
           l.raw_text AS raw_text
    LIMIT 1
    """

    record = session.run(query, **params).single()
    if not record:
        return None
    return Lecture(**record.data())
