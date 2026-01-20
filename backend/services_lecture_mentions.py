from typing import List, Optional
from uuid import uuid4

from neo4j import Session

from models import Concept, LectureMention, LectureMentionCreate, LectureMentionUpdate
from services_branch_explorer import ensure_graph_scoping_initialized, get_active_graph_context


def _map_concept(record: dict) -> Concept:
    return Concept(
        node_id=record["concept_id"],
        name=record["concept_name"],
        domain=record["concept_domain"],
        type=record["concept_type"],
        description=record.get("concept_description"),
        tags=record.get("concept_tags"),
        notes_key=record.get("concept_notes_key"),
        node_key=record.get("concept_node_key"),
        url_slug=record.get("concept_url_slug"),
        lecture_sources=record.get("concept_lecture_sources") or [],
        created_by=record.get("concept_created_by"),
        last_updated_by=record.get("concept_last_updated_by"),
    )


def _map_mention(record: dict) -> LectureMention:
    return LectureMention(
        mention_id=record["mention_id"],
        lecture_id=record["lecture_id"],
        block_id=record["block_id"],
        start_offset=record["start_offset"],
        end_offset=record["end_offset"],
        surface_text=record["surface_text"],
        context_note=record.get("context_note"),
        sense_label=record.get("sense_label"),
        lecture_title=record.get("lecture_title"),
        block_text=record.get("block_text"),
        concept=_map_concept(record),
    )


def create_lecture_mention(session: Session, payload: LectureMentionCreate) -> LectureMention:
    ensure_graph_scoping_initialized(session)
    graph_id, branch_id = get_active_graph_context(session)
    mention_id = f"MNT_{uuid4().hex[:10]}"

    query = """
    MATCH (g:GraphSpace {graph_id: $graph_id})
    MATCH (l:Lecture {lecture_id: $lecture_id})
    MATCH (b:LectureBlock {block_id: $block_id, graph_id: $graph_id})
    MATCH (c:Concept {node_id: $concept_id, graph_id: $graph_id})-[:BELONGS_TO]->(g)
    MERGE (m:LectureMention {mention_id: $mention_id})
      ON CREATE SET m.graph_id = $graph_id,
                    m.lecture_id = $lecture_id,
                    m.block_id = $block_id,
                    m.start_offset = $start_offset,
                    m.end_offset = $end_offset,
                    m.surface_text = $surface_text,
                    m.context_note = $context_note,
                    m.sense_label = $sense_label,
                    m.on_branches = [$branch_id],
                    m.created_at = datetime()
      ON MATCH SET  m.start_offset = $start_offset,
                    m.end_offset = $end_offset,
                    m.surface_text = $surface_text,
                    m.context_note = $context_note,
                    m.sense_label = $sense_label,
                    m.updated_at = datetime(),
                    m.on_branches = CASE
                      WHEN m.on_branches IS NULL THEN [$branch_id]
                      WHEN $branch_id IN m.on_branches THEN m.on_branches
                      ELSE m.on_branches + $branch_id
                    END
    MERGE (m)-[:BELONGS_TO]->(g)
    MERGE (l)-[:HAS_MENTION]->(m)
    MERGE (m)-[:IN_BLOCK]->(b)
    MERGE (m)-[:REFERS_TO]->(c)
    RETURN m.mention_id AS mention_id,
           m.lecture_id AS lecture_id,
           m.block_id AS block_id,
           m.start_offset AS start_offset,
           m.end_offset AS end_offset,
           m.surface_text AS surface_text,
           m.context_note AS context_note,
           m.sense_label AS sense_label,
           l.title AS lecture_title,
           b.text AS block_text,
           c.node_id AS concept_id,
           c.name AS concept_name,
           c.domain AS concept_domain,
           c.type AS concept_type,
           c.description AS concept_description,
           c.tags AS concept_tags,
           c.notes_key AS concept_notes_key,
           c.node_key AS concept_node_key,
           c.url_slug AS concept_url_slug,
           COALESCE(c.lecture_sources, []) AS concept_lecture_sources,
           c.created_by AS concept_created_by,
           c.last_updated_by AS concept_last_updated_by
    """
    record = session.run(
        query,
        graph_id=graph_id,
        branch_id=branch_id,
        lecture_id=payload.lecture_id,
        block_id=payload.block_id,
        concept_id=payload.concept_id,
        mention_id=mention_id,
        start_offset=payload.start_offset,
        end_offset=payload.end_offset,
        surface_text=payload.surface_text,
        context_note=payload.context_note,
        sense_label=payload.sense_label,
    ).single()
    if not record:
        raise ValueError("Failed to create lecture mention.")
    return _map_mention(record.data())


def get_lecture_mention(session: Session, mention_id: str) -> Optional[LectureMention]:
    ensure_graph_scoping_initialized(session)
    graph_id, branch_id = get_active_graph_context(session)

    query = """
    MATCH (m:LectureMention {mention_id: $mention_id, graph_id: $graph_id})
    WHERE $branch_id IN COALESCE(m.on_branches, [])
    OPTIONAL MATCH (m)-[:IN_BLOCK]->(b:LectureBlock)
    OPTIONAL MATCH (l:Lecture {lecture_id: m.lecture_id})
    MATCH (m)-[:REFERS_TO]->(c:Concept {graph_id: $graph_id})
    RETURN m.mention_id AS mention_id,
           m.lecture_id AS lecture_id,
           m.block_id AS block_id,
           m.start_offset AS start_offset,
           m.end_offset AS end_offset,
           m.surface_text AS surface_text,
           m.context_note AS context_note,
           m.sense_label AS sense_label,
           l.title AS lecture_title,
           b.text AS block_text,
           c.node_id AS concept_id,
           c.name AS concept_name,
           c.domain AS concept_domain,
           c.type AS concept_type,
           c.description AS concept_description,
           c.tags AS concept_tags,
           c.notes_key AS concept_notes_key,
           c.node_key AS concept_node_key,
           c.url_slug AS concept_url_slug,
           COALESCE(c.lecture_sources, []) AS concept_lecture_sources,
           c.created_by AS concept_created_by,
           c.last_updated_by AS concept_last_updated_by
    """
    record = session.run(
        query,
        mention_id=mention_id,
        graph_id=graph_id,
        branch_id=branch_id,
    ).single()
    if not record:
        return None
    return _map_mention(record.data())


def update_lecture_mention(
    session: Session,
    mention_id: str,
    payload: LectureMentionUpdate,
) -> Optional[LectureMention]:
    ensure_graph_scoping_initialized(session)
    graph_id, branch_id = get_active_graph_context(session)

    set_clauses = []
    params = {
        "mention_id": mention_id,
        "graph_id": graph_id,
        "branch_id": branch_id,
    }

    if payload.start_offset is not None:
        set_clauses.append("m.start_offset = $start_offset")
        params["start_offset"] = payload.start_offset
    if payload.end_offset is not None:
        set_clauses.append("m.end_offset = $end_offset")
        params["end_offset"] = payload.end_offset
    if payload.surface_text is not None:
        set_clauses.append("m.surface_text = $surface_text")
        params["surface_text"] = payload.surface_text
    if payload.context_note is not None:
        set_clauses.append("m.context_note = $context_note")
        params["context_note"] = payload.context_note
    if payload.sense_label is not None:
        set_clauses.append("m.sense_label = $sense_label")
        params["sense_label"] = payload.sense_label

    if set_clauses:
        set_clauses.append("m.updated_at = datetime()")
        query = f"""
        MATCH (m:LectureMention {{mention_id: $mention_id, graph_id: $graph_id}})
        WHERE $branch_id IN COALESCE(m.on_branches, [])
        SET {', '.join(set_clauses)}
        RETURN m.mention_id AS mention_id
        """
        session.run(query, **params)

    if payload.concept_id is not None:
        rel_query = """
        MATCH (m:LectureMention {mention_id: $mention_id, graph_id: $graph_id})
        WHERE $branch_id IN COALESCE(m.on_branches, [])
        OPTIONAL MATCH (m)-[r:REFERS_TO]->(:Concept)
        DELETE r
        WITH m
        MATCH (g:GraphSpace {graph_id: $graph_id})
        MATCH (c:Concept {node_id: $concept_id, graph_id: $graph_id})-[:BELONGS_TO]->(g)
        MERGE (m)-[:REFERS_TO]->(c)
        RETURN m.mention_id AS mention_id
        """
        session.run(
            rel_query,
            mention_id=mention_id,
            graph_id=graph_id,
            branch_id=branch_id,
            concept_id=payload.concept_id,
        )

    return get_lecture_mention(session, mention_id)


def delete_lecture_mention(session: Session, mention_id: str) -> bool:
    ensure_graph_scoping_initialized(session)
    graph_id, branch_id = get_active_graph_context(session)

    query = """
    MATCH (m:LectureMention {mention_id: $mention_id, graph_id: $graph_id})
    WHERE $branch_id IN COALESCE(m.on_branches, [])
    DETACH DELETE m
    RETURN count(m) AS deleted
    """
    record = session.run(
        query,
        mention_id=mention_id,
        graph_id=graph_id,
        branch_id=branch_id,
    ).single()
    if not record:
        return False
    return record.get("deleted", 0) > 0


def list_lecture_mentions(session: Session, lecture_id: str) -> List[LectureMention]:
    ensure_graph_scoping_initialized(session)
    graph_id, branch_id = get_active_graph_context(session)

    query = """
    MATCH (l:Lecture {lecture_id: $lecture_id})-[:HAS_MENTION]->(m:LectureMention {graph_id: $graph_id})
    WHERE $branch_id IN COALESCE(m.on_branches, [])
    OPTIONAL MATCH (m)-[:IN_BLOCK]->(b:LectureBlock)
    MATCH (m)-[:REFERS_TO]->(c:Concept {graph_id: $graph_id})
    RETURN m.mention_id AS mention_id,
           m.lecture_id AS lecture_id,
           m.block_id AS block_id,
           m.start_offset AS start_offset,
           m.end_offset AS end_offset,
           m.surface_text AS surface_text,
           m.context_note AS context_note,
           m.sense_label AS sense_label,
           l.title AS lecture_title,
           b.text AS block_text,
           c.node_id AS concept_id,
           c.name AS concept_name,
           c.domain AS concept_domain,
           c.type AS concept_type,
           c.description AS concept_description,
           c.tags AS concept_tags,
           c.notes_key AS concept_notes_key,
           c.node_key AS concept_node_key,
           c.url_slug AS concept_url_slug,
           COALESCE(c.lecture_sources, []) AS concept_lecture_sources,
           c.created_by AS concept_created_by,
           c.last_updated_by AS concept_last_updated_by
    ORDER BY m.created_at DESC
    """
    result = session.run(
        query,
        lecture_id=lecture_id,
        graph_id=graph_id,
        branch_id=branch_id,
    )
    mentions: List[LectureMention] = []
    for record in result:
        mentions.append(_map_mention(record.data()))
    return mentions


def list_concept_mentions(session: Session, concept_id: str) -> List[LectureMention]:
    ensure_graph_scoping_initialized(session)
    graph_id, branch_id = get_active_graph_context(session)

    query = """
    MATCH (m:LectureMention {graph_id: $graph_id})-[:REFERS_TO]->(c:Concept {node_id: $concept_id, graph_id: $graph_id})
    WHERE $branch_id IN COALESCE(m.on_branches, [])
    OPTIONAL MATCH (m)-[:IN_BLOCK]->(b:LectureBlock)
    OPTIONAL MATCH (l:Lecture {lecture_id: m.lecture_id})
    RETURN m.mention_id AS mention_id,
           m.lecture_id AS lecture_id,
           m.block_id AS block_id,
           m.start_offset AS start_offset,
           m.end_offset AS end_offset,
           m.surface_text AS surface_text,
           m.context_note AS context_note,
           m.sense_label AS sense_label,
           l.title AS lecture_title,
           b.text AS block_text,
           c.node_id AS concept_id,
           c.name AS concept_name,
           c.domain AS concept_domain,
           c.type AS concept_type,
           c.description AS concept_description,
           c.tags AS concept_tags,
           c.notes_key AS concept_notes_key,
           c.node_key AS concept_node_key,
           c.url_slug AS concept_url_slug,
           COALESCE(c.lecture_sources, []) AS concept_lecture_sources,
           c.created_by AS concept_created_by,
           c.last_updated_by AS concept_last_updated_by
    ORDER BY m.created_at DESC
    """
    result = session.run(
        query,
        concept_id=concept_id,
        graph_id=graph_id,
        branch_id=branch_id,
    )
    mentions: List[LectureMention] = []
    for record in result:
        mentions.append(_map_mention(record.data()))
    return mentions
