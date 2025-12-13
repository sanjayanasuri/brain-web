from typing import List, Optional, Dict, Any
from neo4j import Session
import datetime
import json

from models import (
    Concept, ConceptCreate, RelationshipCreate,
    ResponseStyleProfile, ResponseStyleProfileWrapper,
    ExplanationFeedback, FeedbackSummary,
    FocusArea, UserProfile, NotionConfig,
    AnswerRecord, Revision
)

from services_branch_explorer import (
    ensure_graph_scoping_initialized,
    get_active_graph_context,
)


def _normalize_concept_from_db(record_data: Dict[str, Any]) -> Concept:
    """
    Normalize concept data from Neo4j, handling backward compatibility.
    If lecture_key exists but lecture_sources doesn't, migrate it.
    """
    data = dict(record_data)
    
    # Backward compatibility: if lecture_key exists but lecture_sources doesn't
    if data.get("lecture_key") and not data.get("lecture_sources"):
        lecture_key = data["lecture_key"]
        data["lecture_sources"] = [lecture_key]
        if not data.get("created_by"):
            data["created_by"] = lecture_key
        if not data.get("last_updated_by"):
            data["last_updated_by"] = lecture_key
    
    # Ensure lecture_sources is a list (default to empty)
    if "lecture_sources" not in data or data["lecture_sources"] is None:
        data["lecture_sources"] = []
    
    return Concept(**data)


def get_concept_by_name(session: Session, name: str) -> Optional[Concept]:
    ensure_graph_scoping_initialized(session)
    graph_id, branch_id = get_active_graph_context(session)
    query = """
    MATCH (g:GraphSpace {graph_id: $graph_id})
    MATCH (c:Concept {name: $name})-[:BELONGS_TO]->(g)
    WHERE $branch_id IN COALESCE(c.on_branches, [])
    RETURN c.node_id AS node_id,
           c.name AS name,
           c.domain AS domain,
           c.type AS type,
           c.description AS description,
           c.tags AS tags,
           c.notes_key AS notes_key,
           c.lecture_key AS lecture_key,
           c.url_slug AS url_slug,
           COALESCE(c.lecture_sources, []) AS lecture_sources,
           c.created_by AS created_by,
           c.last_updated_by AS last_updated_by
    LIMIT 1
    """
    result = session.run(query, name=name, graph_id=graph_id, branch_id=branch_id)
    record = result.single()
    if not record:
        return None
    return _normalize_concept_from_db(record.data())


def get_concept_by_id(session: Session, node_id: str) -> Optional[Concept]:
    ensure_graph_scoping_initialized(session)
    graph_id, branch_id = get_active_graph_context(session)
    query = """
    MATCH (g:GraphSpace {graph_id: $graph_id})
    MATCH (c:Concept {node_id: $node_id})-[:BELONGS_TO]->(g)
    WHERE $branch_id IN COALESCE(c.on_branches, [])
    RETURN c.node_id AS node_id,
           c.name AS name,
           c.domain AS domain,
           c.type AS type,
           c.description AS description,
           c.tags AS tags,
           c.notes_key AS notes_key,
           c.lecture_key AS lecture_key,
           c.url_slug AS url_slug,
           COALESCE(c.lecture_sources, []) AS lecture_sources,
           c.created_by AS created_by,
           c.last_updated_by AS last_updated_by
    LIMIT 1
    """
    record = session.run(query, node_id=node_id, graph_id=graph_id, branch_id=branch_id).single()
    if not record:
        return None
    return _normalize_concept_from_db(record.data())


def create_concept(session: Session, payload: ConceptCreate) -> Concept:
    """
    Creates a concept node with a generated node_id if not present.
    For now, node_id is just a UUID string.
    """
    from uuid import uuid4

    node_id = f"N{uuid4().hex[:8].upper()}"
    
    # Handle backward compatibility: if lecture_key is provided but lecture_sources is not
    lecture_sources = payload.lecture_sources or []
    if payload.lecture_key and not lecture_sources:
        lecture_sources = [payload.lecture_key]
    
    created_by = payload.created_by
    if not created_by and lecture_sources:
        created_by = lecture_sources[0]
    
    last_updated_by = payload.last_updated_by
    if not last_updated_by and lecture_sources:
        last_updated_by = lecture_sources[-1]
    
    ensure_graph_scoping_initialized(session)
    graph_id, branch_id = get_active_graph_context(session)
    
    query = """
    MATCH (g:GraphSpace {graph_id: $graph_id})
    MERGE (c:Concept {graph_id: $graph_id, name: $name})
    ON CREATE SET
        c.node_id = $node_id,
        c.domain = $domain,
        c.type = $type,
        c.description = $description,
        c.tags = $tags,
        c.notes_key = $notes_key,
        c.lecture_key = $lecture_key,
        c.url_slug = $url_slug,
        c.lecture_sources = $lecture_sources,
        c.created_by = $created_by,
        c.last_updated_by = $last_updated_by,
        c.on_branches = [$branch_id]
    ON MATCH SET
        c.on_branches = CASE
            WHEN c.on_branches IS NULL THEN [$branch_id]
            WHEN $branch_id IN c.on_branches THEN c.on_branches
            ELSE c.on_branches + $branch_id
        END
    MERGE (c)-[:BELONGS_TO]->(g)
    RETURN c.node_id AS node_id,
           c.name AS name,
           c.domain AS domain,
           c.type AS type,
           c.description AS description,
           c.tags AS tags,
           c.notes_key AS notes_key,
           c.lecture_key AS lecture_key,
           c.url_slug AS url_slug,
           COALESCE(c.lecture_sources, []) AS lecture_sources,
           c.created_by AS created_by,
           c.last_updated_by AS last_updated_by
    """
    params = {
        "node_id": node_id,
        "name": payload.name,
        "domain": payload.domain,
        "type": payload.type,
        "description": payload.description,
        "tags": payload.tags,
        "notes_key": payload.notes_key,
        "lecture_key": payload.lecture_key,
        "url_slug": payload.url_slug,
        "lecture_sources": lecture_sources,
        "created_by": created_by,
        "last_updated_by": last_updated_by,
        "graph_id": graph_id,
        "branch_id": branch_id,
    }
    record = session.run(query, **params).single()
    return _normalize_concept_from_db(record.data())


def update_concept(session: Session, node_id: str, update: Dict[str, Any]) -> Concept:
    """
    Update a concept with partial updates.
    Only updates fields that are provided (non-None).
    """
    # Build SET clause dynamically based on provided fields
    set_clauses = []
    params = {"node_id": node_id}
    
    if update.get("description") is not None:
        set_clauses.append("c.description = $description")
        params["description"] = update["description"]
    
    if update.get("tags") is not None:
        set_clauses.append("c.tags = $tags")
        params["tags"] = update["tags"]
    
    if update.get("domain") is not None:
        set_clauses.append("c.domain = $domain")
        params["domain"] = update["domain"]
    
    if update.get("type") is not None:
        set_clauses.append("c.type = $type")
        params["type"] = update["type"]
    
    if not set_clauses:
        # No updates provided, just return the current concept
        return get_concept_by_id(session, node_id)
    
    ensure_graph_scoping_initialized(session)
    graph_id, branch_id = get_active_graph_context(session)
    
    query = f"""
    MATCH (g:GraphSpace {{graph_id: $graph_id}})
    MATCH (c:Concept {{node_id: $node_id}})-[:BELONGS_TO]->(g)
    WHERE $branch_id IN COALESCE(c.on_branches, [])
    SET {', '.join(set_clauses)}
    RETURN c.node_id AS node_id,
           c.name AS name,
           c.domain AS domain,
           c.type AS type,
           c.description AS description,
           c.tags AS tags,
           c.notes_key AS notes_key,
           c.lecture_key AS lecture_key,
           c.url_slug AS url_slug,
           COALESCE(c.lecture_sources, []) AS lecture_sources,
           c.created_by AS created_by,
           c.last_updated_by AS last_updated_by
    """
    params["graph_id"] = graph_id
    params["branch_id"] = branch_id
    result = session.run(query, **params)
    record = result.single()
    if not record:
        raise ValueError(f"Concept with node_id {node_id} not found")
    return _normalize_concept_from_db(record.data())


def create_relationship(session: Session, payload: RelationshipCreate) -> None:
    """
    Creates or merges a relationship between two concepts by name.
    """
    ensure_graph_scoping_initialized(session)
    graph_id, branch_id = get_active_graph_context(session)
    query = """
    MATCH (g:GraphSpace {graph_id: $graph_id})
    MATCH (s:Concept {name: $source_name})-[:BELONGS_TO]->(g)
    MATCH (t:Concept {name: $target_name})-[:BELONGS_TO]->(g)
    WHERE $branch_id IN COALESCE(s.on_branches, []) AND $branch_id IN COALESCE(t.on_branches, [])
    MERGE (s)-[r:`%s`]->(t)
    SET r.graph_id = COALESCE(r.graph_id, $graph_id),
        r.on_branches = CASE
            WHEN r.on_branches IS NULL THEN [$branch_id]
            WHEN $branch_id IN r.on_branches THEN r.on_branches
            ELSE r.on_branches + $branch_id
        END
    RETURN 1
    """ % payload.predicate  # simple for now; later sanitize

    session.run(
        query,
        source_name=payload.source_name,
        target_name=payload.target_name,
        graph_id=graph_id,
        branch_id=branch_id,
    )


def get_neighbors(session: Session, node_id: str) -> List[Concept]:
    """
    Returns direct neighbors of a concept node.
    """
    ensure_graph_scoping_initialized(session)
    graph_id, branch_id = get_active_graph_context(session)
    query = """
    MATCH (g:GraphSpace {graph_id: $graph_id})
    MATCH (c:Concept {node_id: $node_id})-[:BELONGS_TO]->(g)
    MATCH (c)-[r]-(n:Concept)-[:BELONGS_TO]->(g)
    WHERE $branch_id IN COALESCE(c.on_branches, [])
      AND $branch_id IN COALESCE(n.on_branches, [])
      AND $branch_id IN COALESCE(r.on_branches, [])
    RETURN DISTINCT n.node_id AS node_id,
                    n.name AS name,
                    n.domain AS domain,
                    n.type AS type,
                    n.description AS description,
                    n.tags AS tags,
                    n.notes_key AS notes_key,
                    n.lecture_key AS lecture_key,
                    n.url_slug AS url_slug,
                    COALESCE(n.lecture_sources, []) AS lecture_sources,
                    n.created_by AS created_by,
                    n.last_updated_by AS last_updated_by
    """
    result = session.run(query, node_id=node_id, graph_id=graph_id, branch_id=branch_id)
    return [_normalize_concept_from_db(record.data()) for record in result]


def get_neighbors_with_relationships(session: Session, node_id: str) -> List[dict]:
    """
    Returns direct neighbors with their relationship types.
    Returns a list of dicts with 'concept' and 'predicate' keys.
    """
    ensure_graph_scoping_initialized(session)
    graph_id, branch_id = get_active_graph_context(session)
    query = """
    MATCH (g:GraphSpace {graph_id: $graph_id})
    MATCH (c:Concept {node_id: $node_id})-[:BELONGS_TO]->(g)
    MATCH (c)-[r]-(n:Concept)-[:BELONGS_TO]->(g)
    WHERE $branch_id IN COALESCE(c.on_branches, [])
      AND $branch_id IN COALESCE(n.on_branches, [])
      AND $branch_id IN COALESCE(r.on_branches, [])
    RETURN DISTINCT n.node_id AS node_id,
                    n.name AS name,
                    n.domain AS domain,
                    n.type AS type,
                    n.description AS description,
                    n.tags AS tags,
                    n.notes_key AS notes_key,
                    n.lecture_key AS lecture_key,
                    n.url_slug AS url_slug,
                    COALESCE(n.lecture_sources, []) AS lecture_sources,
                    n.created_by AS created_by,
                    n.last_updated_by AS last_updated_by,
                    type(r) AS predicate,
                    startNode(r).node_id = $node_id AS is_outgoing
    """
    result = session.run(query, node_id=node_id, graph_id=graph_id, branch_id=branch_id)
    return [
        {
            "concept": _normalize_concept_from_db({k: v for k, v in record.data().items() if k not in ["predicate", "is_outgoing"]}),
            "predicate": record.data()["predicate"],
            "is_outgoing": record.data()["is_outgoing"],
        }
        for record in result
    ]


def get_all_concepts(session: Session) -> List[Concept]:
    """
    Returns all Concept nodes in the database.
    """
    ensure_graph_scoping_initialized(session)
    graph_id, branch_id = get_active_graph_context(session)
    query = """
    MATCH (g:GraphSpace {graph_id: $graph_id})
    MATCH (c:Concept)-[:BELONGS_TO]->(g)
    WHERE $branch_id IN COALESCE(c.on_branches, [])
    RETURN c.node_id AS node_id,
           c.name AS name,
           c.domain AS domain,
           c.type AS type,
           c.description AS description,
           c.tags AS tags,
           c.notes_key AS notes_key,
           c.lecture_key AS lecture_key,
           c.url_slug AS url_slug,
           COALESCE(c.lecture_sources, []) AS lecture_sources,
           c.created_by AS created_by,
           c.last_updated_by AS last_updated_by
    ORDER BY c.node_id
    """
    result = session.run(query, graph_id=graph_id, branch_id=branch_id)
    return [_normalize_concept_from_db(record.data()) for record in result]


def get_all_relationships(session: Session) -> List[dict]:
    """
    Returns all relationships between Concept nodes.
    Returns a list of dicts with source_id, target_id, and predicate.
    """
    ensure_graph_scoping_initialized(session)
    graph_id, branch_id = get_active_graph_context(session)
    query = """
    MATCH (g:GraphSpace {graph_id: $graph_id})
    MATCH (s:Concept)-[:BELONGS_TO]->(g)
    MATCH (t:Concept)-[:BELONGS_TO]->(g)
    MATCH (s)-[r]->(t)
    WHERE r.graph_id = $graph_id
      AND $branch_id IN COALESCE(r.on_branches, [])
      AND $branch_id IN COALESCE(s.on_branches, [])
      AND $branch_id IN COALESCE(t.on_branches, [])
    RETURN s.node_id AS source_id,
           t.node_id AS target_id,
           type(r) AS predicate
    """
    result = session.run(query, graph_id=graph_id, branch_id=branch_id)
    return [
        {
            "source_id": record.data()["source_id"],
            "target_id": record.data()["target_id"],
            "predicate": record.data()["predicate"],
        }
        for record in result
    ]


def create_relationship_by_ids(session: Session, source_id: str, target_id: str, predicate: str) -> None:
    """
    Creates a relationship between two concepts by their node_ids.
    """
    ensure_graph_scoping_initialized(session)
    graph_id, branch_id = get_active_graph_context(session)
    query = """
    MATCH (g:GraphSpace {graph_id: $graph_id})
    MATCH (s:Concept {node_id: $source_id})-[:BELONGS_TO]->(g)
    MATCH (t:Concept {node_id: $target_id})-[:BELONGS_TO]->(g)
    WHERE $branch_id IN COALESCE(s.on_branches, []) AND $branch_id IN COALESCE(t.on_branches, [])
    MERGE (s)-[r:`%s`]->(t)
    SET r.graph_id = COALESCE(r.graph_id, $graph_id),
        r.on_branches = CASE
            WHEN r.on_branches IS NULL THEN [$branch_id]
            WHEN $branch_id IN r.on_branches THEN r.on_branches
            ELSE r.on_branches + $branch_id
        END
    RETURN 1
    """ % predicate  # simple for now; later sanitize

    session.run(query, source_id=source_id, target_id=target_id, graph_id=graph_id, branch_id=branch_id)


def delete_concept(session: Session, node_id: str) -> bool:
    """
    Deletes a concept node and all its relationships.
    Returns True if deleted, False if not found.
    """
    ensure_graph_scoping_initialized(session)
    graph_id, branch_id = get_active_graph_context(session)
    query = """
    MATCH (g:GraphSpace {graph_id: $graph_id})
    MATCH (c:Concept {node_id: $node_id})-[:BELONGS_TO]->(g)
    WHERE $branch_id IN COALESCE(c.on_branches, [])
    DETACH DELETE c
    RETURN count(c) as deleted
    """
    result = session.run(query, node_id=node_id, graph_id=graph_id, branch_id=branch_id)
    record = result.single()
    return record and record["deleted"] > 0


def delete_relationship(session: Session, source_id: str, target_id: str, predicate: str) -> bool:
    """
    Deletes a specific relationship between two concepts.
    Returns True if deleted, False if not found.
    """
    ensure_graph_scoping_initialized(session)
    graph_id, branch_id = get_active_graph_context(session)
    query = """
    MATCH (g:GraphSpace {graph_id: $graph_id})
    MATCH (s:Concept {node_id: $source_id})-[:BELONGS_TO]->(g)
    MATCH (t:Concept {node_id: $target_id})-[:BELONGS_TO]->(g)
    MATCH (s)-[r]->(t)
    WHERE type(r) = $predicate
      AND r.graph_id = $graph_id
      AND $branch_id IN COALESCE(r.on_branches, [])
    WITH r, count(r) AS matched
    DELETE r
    RETURN matched as deleted
    """
    result = session.run(query, source_id=source_id, target_id=target_id, predicate=predicate, graph_id=graph_id, branch_id=branch_id)
    record = result.single()
    return record and record["deleted"] > 0


def delete_test_concepts(session: Session) -> int:
    """
    Deletes all test concepts (those with "Test" or "Isolated Concept" in name).
    Returns the number of deleted nodes.
    """
    query = """
    MATCH (c:Concept)
    WHERE c.name CONTAINS 'Test' OR c.name CONTAINS 'Isolated Concept' OR c.domain = 'Testing'
    DETACH DELETE c
    RETURN count(c) as deleted
    """
    result = session.run(query)
    record = result.single()
    return record["deleted"] if record else 0


def get_nodes_missing_description(session: Session, limit: int = 3) -> List[Concept]:
    """
    Returns concepts that are missing descriptions.
    """
    query = """
    MATCH (c:Concept)
    WHERE c.description IS NULL OR c.description = ""
    RETURN c.node_id AS node_id,
           c.name AS name,
           c.domain AS domain,
           c.type AS type,
           c.description AS description,
           c.tags AS tags,
           c.notes_key AS notes_key,
           c.lecture_key AS lecture_key,
           c.url_slug AS url_slug,
           COALESCE(c.lecture_sources, []) AS lecture_sources,
           c.created_by AS created_by,
           c.last_updated_by AS last_updated_by
    LIMIT $limit
    """
    result = session.run(query, limit=limit)
    return [_normalize_concept_from_db(record.data()) for record in result]


def get_neighbors_for_nodes(session: Session, node_ids: List[str]) -> dict:
    """
    Returns a mapping of node_id -> list of neighbor node_ids for building context.
    """
    if not node_ids:
        return {}
    
    query = """
    MATCH (c:Concept)-[r]-(n:Concept)
    WHERE c.node_id IN $node_ids
    RETURN c.node_id AS source_id, collect(DISTINCT n.node_id) AS neighbor_ids
    """
    result = session.run(query, node_ids=node_ids)
    return {record["source_id"]: record["neighbor_ids"] for record in result}


def unlink_lecture(session: Session, lecture_id: str) -> dict:
    """
    Remove a lecture as a source from all nodes.
    
    Behavior:
    - For each Concept node that has lecture_id in lecture_sources:
        - If len(lecture_sources) == 1:
            - delete the node and all relationships connected to it
        - Else:
            - remove lecture_id from lecture_sources
            - if created_by == lecture_id:
                  - set created_by to some remaining source (e.g. first lecture_sources element)
            - if last_updated_by == lecture_id:
                  - set last_updated_by to the latest remaining source
    
    Args:
        session: Neo4j session
        lecture_id: Lecture ID to unlink
    
    Returns:
        Dictionary with stats: nodes_deleted, nodes_updated, relationships_deleted
    """
    stats = {
        "nodes_deleted": 0,
        "nodes_updated": 0,
        "relationships_deleted": 0
    }
    
    # Step 1: Find and delete concepts where lecture_id is the only source
    # Handle backward compatibility: also check lecture_key
    delete_query = """
    MATCH (c:Concept)
    WHERE (
      ($lecture_id IN COALESCE(c.lecture_sources, []) AND size(COALESCE(c.lecture_sources, [])) = 1)
      OR (c.lecture_key = $lecture_id AND (c.lecture_sources IS NULL OR size(COALESCE(c.lecture_sources, [])) = 0))
    )
    WITH c, size((c)--()) AS rel_count
    DETACH DELETE c
    RETURN count(c) AS deleted_count, sum(rel_count) AS deleted_rels
    """
    result = session.run(delete_query, lecture_id=lecture_id)
    record = result.single()
    if record:
        stats["nodes_deleted"] = record["deleted_count"] or 0
        stats["relationships_deleted"] = record["deleted_rels"] or 0
    
    # Step 2: Update concepts with multiple sources
    # First, get all concepts that need updating
    # Handle backward compatibility: also check lecture_key
    find_query = """
    MATCH (c:Concept)
    WHERE (
      ($lecture_id IN COALESCE(c.lecture_sources, []) AND size(COALESCE(c.lecture_sources, [])) > 1)
      OR (c.lecture_key = $lecture_id AND c.lecture_sources IS NOT NULL AND size(COALESCE(c.lecture_sources, [])) > 1)
    )
    RETURN c.node_id AS node_id,
           COALESCE(c.lecture_sources, CASE WHEN c.lecture_key = $lecture_id THEN [c.lecture_key] ELSE [] END) AS lecture_sources,
           COALESCE(c.created_by, c.lecture_key) AS created_by,
           COALESCE(c.last_updated_by, c.lecture_key) AS last_updated_by
    """
    result = session.run(find_query, lecture_id=lecture_id)
    nodes_to_update = [record.data() for record in result]
    
    # Update each node
    for node_data in nodes_to_update:
        node_id = node_data["node_id"]
        lecture_sources = node_data.get("lecture_sources") or []
        created_by = node_data.get("created_by")
        last_updated_by = node_data.get("last_updated_by")
        
        # Remove lecture_id from sources
        updated_sources = [s for s in lecture_sources if s != lecture_id]
        
        # Update created_by if it was the lecture_id
        updated_created_by = created_by
        if created_by == lecture_id and updated_sources:
            updated_created_by = updated_sources[0]  # Use first remaining source
        elif not updated_created_by and updated_sources:
            updated_created_by = updated_sources[0]  # Fallback if created_by was null
        
        # Update last_updated_by if it was the lecture_id
        updated_last_updated_by = last_updated_by
        if last_updated_by == lecture_id and updated_sources:
            updated_last_updated_by = updated_sources[-1]  # Use last remaining source
        elif not updated_last_updated_by and updated_sources:
            updated_last_updated_by = updated_sources[-1]  # Fallback if last_updated_by was null
        
        # Update the node
        update_query = """
        MATCH (c:Concept {node_id: $node_id})
        SET c.lecture_sources = $lecture_sources,
            c.created_by = $created_by,
            c.last_updated_by = $last_updated_by
        RETURN 1
        """
        session.run(
            update_query,
            node_id=node_id,
            lecture_sources=updated_sources,
            created_by=updated_created_by,
            last_updated_by=updated_last_updated_by
        )
        stats["nodes_updated"] += 1
    
    return stats


# ---------- Personalization Service Functions ----------

def get_response_style_profile(session: Session) -> ResponseStyleProfileWrapper:
    """
    Fetch the current response style profile from Neo4j.
    If none exists, return a sensible default.
    This profile shapes how Brain Web answers questions.
    """
    query = """
    MERGE (m:Meta {key: 'response_style_profile'})
    ON CREATE SET m.value = $default_value
    RETURN m.value AS value
    """
    default = {
        "tone": "intuitive, grounded, exploratory, conversational but technical",
        "teaching_style": "analogy-first, zoom-out then zoom-in, highlight big picture first",
        "sentence_structure": "short, minimal filler, no dramatic flourishes",
        "explanation_order": [
            "big picture",
            "core concept definition",
            "example/analogy",
            "connection to adjacent concepts",
            "common pitfalls",
            "summary"
        ],
        "forbidden_styles": ["overly formal", "glib", "generic", "high-level nothingness", "GPT-polish"],
    }
    # Serialize default to JSON string for Neo4j storage
    default_json = json.dumps(default)
    record = session.run(query, default_value=default_json).single()
    if record and record["value"]:
        # Deserialize JSON string back to dict
        value = record["value"]
        if isinstance(value, str):
            profile_dict = json.loads(value)
        else:
            profile_dict = value
        profile = ResponseStyleProfile(**profile_dict)
    else:
        profile = ResponseStyleProfile(**default)
    return ResponseStyleProfileWrapper(id="default", profile=profile)


def update_response_style_profile(session: Session, wrapper: ResponseStyleProfileWrapper) -> ResponseStyleProfileWrapper:
    """
    Update the response style profile in Neo4j.
    """
    query = """
    MERGE (m:Meta {key: 'response_style_profile'})
    SET m.value = $value
    RETURN m.value AS value
    """
    # Serialize to JSON string for Neo4j storage
    value_json = json.dumps(wrapper.profile.dict())
    record = session.run(query, value=value_json).single()
    # Deserialize JSON string back to dict
    value = record["value"]
    if isinstance(value, str):
        profile_dict = json.loads(value)
    else:
        profile_dict = value
    profile = ResponseStyleProfile(**profile_dict)
    return ResponseStyleProfileWrapper(id=wrapper.id, profile=profile)


def store_answer(session: Session, answer: AnswerRecord) -> None:
    """
    Store an answer record in Neo4j.
    """
    query = """
    CREATE (a:AnswerRecord {
        answer_id: $answer_id,
        question: $question,
        raw_answer: $raw_answer,
        used_node_ids: $used_node_ids,
        created_at: $created_at
    })
    """
    answer_dict = answer.dict()
    if isinstance(answer_dict.get('created_at'), datetime.datetime):
        answer_dict['created_at'] = answer_dict['created_at'].isoformat()
    session.run(query, **answer_dict)


def store_revision(session: Session, revision: Revision) -> None:
    """
    Store a user-rewritten answer as a Revision node linked to the AnswerRecord.
    """
    query = """
    MATCH (a:AnswerRecord {answer_id: $answer_id})
    CREATE (r:Revision {
        answer_id: $answer_id,
        user_rewritten_answer: $user_rewritten_answer,
        created_at: $created_at
    })
    CREATE (a)-[:HAS_REVISION]->(r)
    """
    revision_dict = revision.dict()
    if isinstance(revision_dict.get('created_at'), datetime.datetime):
        revision_dict['created_at'] = revision_dict['created_at'].isoformat()
    session.run(query, **revision_dict)


def get_recent_answers(session: Session, limit: int = 10) -> List[Dict[str, Any]]:
    """
    Get recent answers with feedback and revision flags.
    """
    query = """
    MATCH (a:AnswerRecord)
    OPTIONAL MATCH (a)-[:HAS_REVISION]->(r:Revision)
    OPTIONAL MATCH (f:Feedback {answer_id: a.answer_id})
    WITH a, 
         COUNT(DISTINCT r) > 0 AS has_revision,
         COUNT(DISTINCT f) > 0 AS has_feedback
    ORDER BY a.created_at DESC
    LIMIT $limit
    RETURN a.answer_id AS answer_id,
           a.question AS question,
           a.raw_answer AS raw_answer,
           a.created_at AS created_at,
           has_feedback,
           has_revision
    """
    records = session.run(query, limit=limit)
    results = []
    for rec in records:
        results.append({
            "answer_id": rec["answer_id"],
            "question": rec["question"],
            "raw_answer": rec["raw_answer"],
            "created_at": rec["created_at"],
            "has_feedback": rec["has_feedback"],
            "has_revision": rec["has_revision"],
        })
    return results


def get_answer_detail(session: Session, answer_id: str) -> Optional[Dict[str, Any]]:
    """
    Get full answer details including feedback and revisions.
    """
    query = """
    MATCH (a:AnswerRecord {answer_id: $answer_id})
    OPTIONAL MATCH (f:Feedback {answer_id: $answer_id})
    OPTIONAL MATCH (a)-[:HAS_REVISION]->(r:Revision)
    RETURN a,
           collect(DISTINCT {rating: f.rating, reason: f.reasoning, created_at: f.created_at}) AS feedback,
           collect(DISTINCT {user_rewritten_answer: r.user_rewritten_answer, created_at: r.created_at}) AS revisions
    """
    record = session.run(query, answer_id=answer_id).single()
    if not record:
        return None
    
    a = record["a"]
    feedback = [f for f in record["feedback"] if f.get("rating") is not None]
    revisions = [r for r in record["revisions"] if r.get("user_rewritten_answer")]
    
    return {
        "answer": {
            "answer_id": a.get("answer_id"),
            "question": a.get("question"),
            "raw_answer": a.get("raw_answer"),
            "used_node_ids": a.get("used_node_ids", []),
            "created_at": a.get("created_at"),
        },
        "feedback": feedback,
        "revisions": revisions,
    }


def get_example_answers(session: Session, limit: int = 5) -> List[Dict[str, Any]]:
    """
    Get recent user-rewritten answers to use as style examples.
    Returns answers with their revisions for style guidance.
    """
    query = """
    MATCH (a:AnswerRecord)-[:HAS_REVISION]->(r:Revision)
    WITH a, r
    ORDER BY r.created_at DESC
    LIMIT $limit
    RETURN a.question AS question,
           r.user_rewritten_answer AS answer,
           a.answer_id AS answer_id
    """
    records = session.run(query, limit=limit)
    results = []
    for rec in records:
        results.append({
            "question": rec["question"],
            "answer": rec["answer"],
            "answer_id": rec["answer_id"],
        })
    return results


def store_feedback(session: Session, fb: ExplanationFeedback) -> None:
    """
    Store feedback as a node in Neo4j.
    Feedback is used to improve future responses through feedback loops.
    """
    query = """
    CREATE (f:Feedback {
        answer_id: $answer_id,
        question: $question,
        rating: $rating,
        reasoning: $reasoning,
        created_at: $created_at
    })
    """
    # Convert datetime to ISO format string for Neo4j storage
    fb_dict = fb.dict()
    if isinstance(fb_dict.get('created_at'), datetime.datetime):
        fb_dict['created_at'] = fb_dict['created_at'].isoformat()
    session.run(query, **fb_dict)


def get_recent_feedback_summary(session: Session, limit: int = 50) -> FeedbackSummary:
    """
    Aggregate recent feedback to guide future responses.
    Returns a summary of positive/negative feedback and common reasons.
    """
    query = """
    MATCH (f:Feedback)
    WITH f
    ORDER BY f.created_at DESC
    LIMIT $limit
    RETURN collect(f) AS feedback
    """
    record = session.run(query, limit=limit).single()
    feedback_nodes = record["feedback"] if record and record["feedback"] else []

    total = len(feedback_nodes)
    positive = sum(1 for f in feedback_nodes if f.get("rating", 0) > 0)
    negative = sum(1 for f in feedback_nodes if f.get("rating", 0) < 0)
    reasons: Dict[str, int] = {}
    for f in feedback_nodes:
        reason = f.get("reasoning") or "unspecified"
        reasons[reason] = reasons.get(reason, 0) + 1

    return FeedbackSummary(
        total=total,
        positive=positive,
        negative=negative,
        common_reasons=reasons,
    )


def get_focus_areas(session: Session) -> List[FocusArea]:
    """
    Get all focus areas from Neo4j.
    Focus areas represent current learning themes that bias answers.
    """
    query = """
    MATCH (f:FocusArea)
    RETURN f
    """
    records = session.run(query)
    areas = []
    for rec in records:
        node = rec["f"]
        areas.append(FocusArea(
            id=node.get("id") or node.get("name", ""),
            name=node.get("name", ""),
            description=node.get("description"),
            active=node.get("active", True),
        ))
    return areas


def upsert_focus_area(session: Session, fa: FocusArea) -> FocusArea:
    """
    Create or update a focus area in Neo4j.
    """
    query = """
    MERGE (f:FocusArea {id: $id})
    SET f.name = $name,
        f.description = $description,
        f.active = $active
    RETURN f
    """
    rec = session.run(query, **fa.dict()).single()
    node = rec["f"]
    return FocusArea(
        id=node.get("id", fa.id),
        name=node.get("name", fa.name),
        description=node.get("description"),
        active=node.get("active", True),
    )


def set_focus_area_active(session: Session, focus_id: str, active: bool) -> FocusArea:
    """
    Toggle the active status of a focus area.
    """
    query = """
    MATCH (f:FocusArea {id: $focus_id})
    SET f.active = $active
    RETURN f
    """
    rec = session.run(query, focus_id=focus_id, active=active).single()
    if not rec:
        raise ValueError(f"Focus area with id {focus_id} not found")
    node = rec["f"]
    return FocusArea(
        id=node.get("id", focus_id),
        name=node.get("name", ""),
        description=node.get("description"),
        active=node.get("active", True),
    )


def get_user_profile(session: Session) -> UserProfile:
    """
    Get the user profile from Neo4j.
    If none exists, create a default one.
    The profile encodes background, interests, weak spots, and learning preferences.
    """
    query = """
    MERGE (u:UserProfile {id: 'default'})
    ON CREATE SET u.name = 'Sanjay',
                  u.background = [],
                  u.interests = [],
                  u.weak_spots = [],
                  u.learning_preferences = $empty_json
    RETURN u
    """
    # Use empty JSON object string for learning_preferences
    empty_json = json.dumps({})
    rec = session.run(query, empty_json=empty_json).single()
    u = rec["u"]
    # Deserialize learning_preferences if it's a JSON string
    learning_prefs = u.get("learning_preferences", {})
    if isinstance(learning_prefs, str):
        learning_prefs = json.loads(learning_prefs)
    return UserProfile(
        id=u.get("id", "default"),
        name=u.get("name", "Sanjay"),
        background=u.get("background", []),
        interests=u.get("interests", []),
        weak_spots=u.get("weak_spots", []),
        learning_preferences=learning_prefs,
    )


def update_user_profile(session: Session, profile: UserProfile) -> UserProfile:
    """
    Update the user profile in Neo4j.
    """
    query = """
    MERGE (u:UserProfile {id: $id})
    SET u.name = $name,
        u.background = $background,
        u.interests = $interests,
        u.weak_spots = $weak_spots,
        u.learning_preferences = $learning_preferences
    RETURN u
    """
    profile_dict = profile.dict()
    # Serialize learning_preferences to JSON string
    profile_dict["learning_preferences"] = json.dumps(profile_dict["learning_preferences"])
    rec = session.run(query, **profile_dict).single()
    u = rec["u"]
    # Deserialize learning_preferences if it's a JSON string
    learning_prefs = u.get("learning_preferences", {})
    if isinstance(learning_prefs, str):
        learning_prefs = json.loads(learning_prefs)
    return UserProfile(
        id=u.get("id", "default"),
        name=u.get("name", "Sanjay"),
        background=u.get("background", []),
        interests=u.get("interests", []),
        weak_spots=u.get("weak_spots", []),
        learning_preferences=learning_prefs,
    )


def find_concept_gaps(session: Session, limit: int = 5) -> List[str]:
    """
    Find concept gaps in the knowledge graph.
    Very simple heuristic for now:
    - Concepts with very short descriptions
    - Concepts with very low degree (few relationships)
    
    Returns a list of concept names that represent gaps.
    """
    query = """
    MATCH (c:Concept)
    OPTIONAL MATCH (c)-[r]-()
    WITH c, count(r) AS degree
    WHERE (c.description IS NULL OR size(c.description) < 60) OR degree < 2
    RETURN c.name AS name
    LIMIT $limit
    """
    records = session.run(query, limit=limit)
    return [r["name"] for r in records]


def get_notion_config(session: Session) -> NotionConfig:
    """
    Get the Notion sync configuration from Neo4j.
    If none exists, return a default configuration.
    """
    query = """
    MERGE (m:Meta {key: 'notion_config'})
    ON CREATE SET m.value = $default_value
    RETURN m.value AS value
    """
    default = {
        "database_ids": [],
        "enable_auto_sync": False
    }
    default_json = json.dumps(default)
    record = session.run(query, default_value=default_json).single()
    value = record["value"]
    if isinstance(value, str):
        config_dict = json.loads(value)
    else:
        config_dict = value
    return NotionConfig(**config_dict)


def update_notion_config(session: Session, config: NotionConfig) -> NotionConfig:
    """
    Update the Notion sync configuration in Neo4j.
    """
    query = """
    MERGE (m:Meta {key: 'notion_config'})
    SET m.value = $value
    RETURN m.value AS value
    """
    # Serialize to JSON string for Neo4j storage
    value_json = json.dumps(config.dict())
    record = session.run(query, value=value_json).single()
    # Deserialize JSON string back to dict
    value = record["value"]
    if isinstance(value, str):
        config_dict = json.loads(value)
    else:
        config_dict = value
    return NotionConfig(**config_dict)


# ---------- Lecture Segment and Analogy Functions ----------

def get_or_create_analogy(
    session: Session,
    label: str,
    description: Optional[str] = None,
    tags: Optional[List[str]] = None,
) -> dict:
    """
    Get or create an Analogy node by label (case-insensitive).
    Returns: dict with analogy_id, label, description, tags.
    """
    from uuid import uuid4
    
    tags = tags or []
    analogy_id = f"ANALOGY_{uuid4().hex[:8]}"

    # Merge tags: combine existing and new tags, removing duplicates
    query = """
    MERGE (a:Analogy {label_lower: toLower($label)})
      ON CREATE SET a.analogy_id = $analogy_id,
                    a.label = $label,
                    a.label_lower = toLower($label),
                    a.description = $description,
                    a.tags = $tags,
                    a.created_at = datetime()
      ON MATCH SET a.description = coalesce(a.description, $description),
                   a.tags = CASE 
                     WHEN $tags IS NULL OR size($tags) = 0 THEN a.tags
                     ELSE [tag IN a.tags WHERE tag IS NOT NULL] + 
                          [tag IN $tags WHERE tag IS NOT NULL AND NOT tag IN a.tags]
                   END
    RETURN a.analogy_id AS analogy_id,
           a.label        AS label,
           a.description  AS description,
           COALESCE(a.tags, []) AS tags
    """
    result = session.run(
        query,
        label=label,
        analogy_id=analogy_id,
        description=description,
        tags=tags,
    )
    record = result.single()
    if not record:
        # Fallback: create with provided data
        return {
            "analogy_id": analogy_id,
            "label": label,
            "description": description,
            "tags": tags,
        }
    return record.data()


def create_lecture_segment(
    session: Session,
    lecture_id: str,
    segment_index: int,
    text: str,
    summary: Optional[str],
    start_time_sec: Optional[float],
    end_time_sec: Optional[float],
    style_tags: Optional[List[str]] = None,
) -> dict:
    """
    Create a LectureSegment node and attach it to the Lecture node.
    Returns: dict with segment_id and basic fields.
    """
    from uuid import uuid4
    
    segment_id = f"SEG_{uuid4().hex[:10]}"
    style_tags = style_tags or []

    query = """
    MATCH (lec:Lecture {lecture_id: $lecture_id})
    MERGE (seg:LectureSegment {segment_id: $segment_id})
      ON CREATE SET seg.lecture_id     = $lecture_id,
                    seg.segment_index  = $segment_index,
                    seg.text           = $text,
                    seg.summary        = $summary,
                    seg.start_time_sec = $start_time_sec,
                    seg.end_time_sec   = $end_time_sec,
                    seg.style_tags     = $style_tags,
                    seg.created_at     = datetime()
      ON MATCH SET  seg.text           = $text,
                    seg.summary        = $summary,
                    seg.start_time_sec = $start_time_sec,
                    seg.end_time_sec   = $end_time_sec,
                    seg.style_tags     = $style_tags,
                    seg.updated_at     = datetime()
    MERGE (lec)-[:HAS_SEGMENT]->(seg)
    RETURN seg.segment_id AS segment_id,
           seg.lecture_id AS lecture_id,
           seg.segment_index AS segment_index
    """
    result = session.run(
        query,
        lecture_id=lecture_id,
        segment_id=segment_id,
        segment_index=segment_index,
        text=text,
        summary=summary,
        start_time_sec=start_time_sec,
        end_time_sec=end_time_sec,
        style_tags=style_tags,
    )
    return result.single().data()


def link_segment_to_concept(
    session: Session,
    segment_id: str,
    concept_id: str
) -> None:
    """
    Create (Segment)-[:COVERS]->(Concept).
    """
    query = """
    MATCH (seg:LectureSegment {segment_id: $segment_id})
    MATCH (c:Concept {node_id: $concept_id})
    MERGE (seg)-[:COVERS]->(c)
    """
    session.run(query, segment_id=segment_id, concept_id=concept_id)


def link_segment_to_analogy(
    session: Session,
    segment_id: str,
    analogy_id: str
) -> None:
    """
    Create (Segment)-[:USES_ANALOGY]->(Analogy).
    """
    query = """
    MATCH (seg:LectureSegment {segment_id: $segment_id})
    MATCH (a:Analogy {analogy_id: $analogy_id})
    MERGE (seg)-[:USES_ANALOGY]->(a)
    """
    session.run(query, segment_id=segment_id, analogy_id=analogy_id)
