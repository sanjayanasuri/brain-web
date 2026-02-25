from typing import List, Optional, Dict, Any, Tuple
from neo4j import Session
import datetime
import json
import time
from uuid import uuid4

from models import (
    Concept, ConceptCreate, RelationshipCreate,
    ResponseStyleProfile, ResponseStyleProfileWrapper,
    ExplanationFeedback, FeedbackSummary,
    FocusArea, UserProfile, NotionConfig,
    AnswerRecord, Revision, UIPreferences,
    ConversationSummary, LearningTopic
)

from services_branch_explorer import (
    ensure_graph_scoping_initialized,
    get_active_graph_context,
)
from services_graph_helpers import (
    build_edge_visibility_where_clause as _build_edge_visibility_where_clause,
    build_tenant_filter_clause as _build_tenant_filter_clause,
    get_tenant_scoped_graph_context as _get_tenant_scoped_graph_context,
    normalize_include_proposed as _normalize_include_proposed,
    resolve_required_tenant_id as _resolve_required_tenant_id,
)

from config import PROPOSED_VISIBILITY_THRESHOLD
from utils.timestamp import utcnow_ms, utcnow_iso

from services_user import get_user_by_id, update_user
from services.graph.artifacts import (
    canonicalize_url,
    normalize_text_for_hash,
    create_or_get_artifact,
    link_artifact_mentions_concept,
    get_artifact,
)
from services.graph.communities import (
    upsert_community,
    set_concept_community_memberships,
    get_claims_for_communities,
)
from services.graph.relationships import (
    create_relationship,
    get_all_relationships,
    create_relationship_by_ids,
    delete_relationship,
    relationship_exists,
    create_or_update_proposed_relationship,
    get_proposed_relationships,
    accept_relationships,
    reject_relationships,
    edit_relationship,
)
from services.graph.concepts import (
    _normalize_concept_from_db,
    get_concept_by_name,
    get_concept_by_id,
    get_concept_by_slug,
    create_concept,
    update_concept,
    get_neighbors,
    get_neighbors_with_relationships,
    get_all_concepts,
    get_graph_overview,
    delete_concept,
    delete_test_concepts,
    get_nodes_missing_description,
    get_neighbors_for_nodes,
    unlink_lecture,
    get_cross_graph_instances,
    link_cross_graph_instances,
    get_linked_cross_graph_instances,
    update_concept_mastery,
    get_concept_mastery,
)
from services.graph.profiles import (
    get_response_style_profile,
    update_response_style_profile,
    store_answer,
    store_style_feedback,
    get_style_feedback_examples,
    store_revision,
    get_recent_answers,
    get_answer_detail,
    get_example_answers,
    store_feedback,
    get_recent_feedback_summary,
)
from services.graph.memory import (
    store_conversation_summary,
    get_recent_conversation_summaries,
    upsert_learning_topic,
    get_active_learning_topics,
)
from services.graph.user_profile import (
    get_focus_areas,
    upsert_focus_area,
    set_focus_area_active,
    get_user_profile,
    update_user_profile,
    patch_user_profile,
    update_episodic_context,
)
from services.graph.claims_quotes import (
    upsert_source_chunk,
    upsert_claim,
    link_claim_mentions,
    upsert_quote,
    link_concept_has_quote,
    link_concept_supported_by_claim,
    link_claim_evidenced_by_quote,
    get_evidence_subgraph,
)


# Artifact functions: see services.graph.artifacts (imported above).
# Relationship functions: see services.graph.relationships (imported above).
# Concept functions: see services.graph.concepts (imported above).
# Profile/answers/feedback: see services.graph.profiles (imported above).
# Memory: see services.graph.memory (imported above).
# User profile/focus areas: see services.graph.user_profile (imported above).
# Claims/quotes/evidence: see services.graph.claims_quotes (imported above).


def find_concept_gaps(session: Session, limit: int = 5) -> List[str]:
    """
    Find concept gaps in the knowledge graph.
    Very simple heuristic for now:
    - Concepts with very short descriptions
    - Concepts with very low degree (few relationships)
    
    Returns a list of concept names that represent gaps.
    """
    ensure_graph_scoping_initialized(session)
    graph_id, branch_id = get_active_graph_context(session)
    query = """
    MATCH (g:GraphSpace {graph_id: $graph_id})
    MATCH (c:Concept)-[:BELONGS_TO]->(g)
    WHERE $branch_id IN COALESCE(c.on_branches, [])
    OPTIONAL MATCH (c)-[r]-(:Concept)-[:BELONGS_TO]->(g)
    WITH c, count(r) AS degree
    WHERE (c.description IS NULL OR size(c.description) < 60) OR degree < 2
    RETURN c.name AS name
    LIMIT $limit
    """
    records = session.run(query, graph_id=graph_id, branch_id=branch_id, limit=limit)
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


def get_ui_preferences(session: Session) -> UIPreferences:
    """
    Get UI preferences (lens system, etc.) from Neo4j.
    If none exists, return default preferences.
    """
    query = """
    MERGE (m:Meta {key: 'ui_preferences'})
    ON CREATE SET m.value = $default_value
    RETURN m.value AS value
    """
    default = {
        "active_lens": "NONE"
    }
    default_json = json.dumps(default)
    record = session.run(query, default_value=default_json).single()
    if record and record["value"]:
        value = record["value"]
        if isinstance(value, str):
            prefs_dict = json.loads(value)
        else:
            prefs_dict = value
        return UIPreferences(**prefs_dict)
    else:
        return UIPreferences(**default)


def update_ui_preferences(session: Session, prefs: UIPreferences) -> UIPreferences:
    """
    Update UI preferences (lens system, etc.) in Neo4j.
    """
    query = """
    MERGE (m:Meta {key: 'ui_preferences'})
    SET m.value = $value
    RETURN m.value AS value
    """
    # Serialize to JSON string for Neo4j storage
    value_json = json.dumps(prefs.dict())
    record = session.run(query, value=value_json).single()
    # Deserialize JSON string back to dict
    value = record["value"]
    if isinstance(value, str):
        prefs_dict = json.loads(value)
    else:
        prefs_dict = value
    return UIPreferences(**prefs_dict)


# ---------- Lecture Segment and Analogy Functions ----------

def get_or_create_analogy(
    session: Session,
    label: str,
    description: Optional[str] = None,
    tags: Optional[List[str]] = None,
    tenant_id: Optional[str] = None,
) -> dict:
    """
    Get or create an Analogy node by label (case-insensitive).
    Returns: dict with analogy_id, label, description, tags.
    """
    from uuid import uuid4
    
    tags = tags or []
    analogy_id = f"ANALOGY_{uuid4().hex[:8]}"

    # Merge tags: combine existing and new tags, removing duplicates
    # SCOPED BY TENANT_ID to prevent leaks
    query = """
    MERGE (a:Analogy {label_lower: toLower($label), tenant_id: $tenant_id})
      ON CREATE SET a.analogy_id = $analogy_id,
                    a.label = $label,
                    a.label_lower = toLower($label),
                    a.description = $description,
                    a.tags = $tags,
                    a.created_at = datetime(),
                    a.tenant_id = $tenant_id
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
        tenant_id=tenant_id
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
    ink_url: Optional[str] = None,
    tenant_id: Optional[str] = None,
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
                    seg.ink_url        = $ink_url,
                    seg.created_at     = datetime()
      ON MATCH SET  seg.text           = $text,
                    seg.summary        = $summary,
                    seg.start_time_sec = $start_time_sec,
                    seg.end_time_sec   = $end_time_sec,
                    seg.style_tags     = $style_tags,
                    seg.ink_url        = $ink_url,
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
        ink_url=ink_url,
    )
    return result.single().data()


def update_lecture_segment(
    session: Session,
    segment_id: str,
    text: Optional[str] = None,
    summary: Optional[str] = None,
    start_time_sec: Optional[float] = None,
    end_time_sec: Optional[float] = None,
    style_tags: Optional[List[str]] = None,
) -> Optional[dict]:
    """
    Update a LectureSegment node by segment_id.
    Returns: dict with segment_id and updated fields, or None if not found.
    """
    # Build SET clauses dynamically
    set_clauses = []
    params = {
        "segment_id": segment_id,
    }

    if text is not None:
        set_clauses.append("seg.text = $text")
        params["text"] = text

    if summary is not None:
        set_clauses.append("seg.summary = $summary")
        params["summary"] = summary

    if start_time_sec is not None:
        set_clauses.append("seg.start_time_sec = $start_time_sec")
        params["start_time_sec"] = start_time_sec

    if end_time_sec is not None:
        set_clauses.append("seg.end_time_sec = $end_time_sec")
        params["end_time_sec"] = end_time_sec

    if style_tags is not None:
        set_clauses.append("seg.style_tags = $style_tags")
        params["style_tags"] = style_tags

    if not set_clauses:
        # Nothing to update
        return None

    # Always update the updated_at timestamp
    set_clauses.append("seg.updated_at = datetime()")

    query = f"""
    MATCH (seg:LectureSegment {{segment_id: $segment_id}})
    SET {', '.join(set_clauses)}
    RETURN seg.segment_id AS segment_id,
           seg.lecture_id AS lecture_id,
           seg.segment_index AS segment_index,
           seg.text AS text,
           seg.summary AS summary,
           seg.start_time_sec AS start_time_sec,
           seg.end_time_sec AS end_time_sec,
           seg.style_tags AS style_tags
    LIMIT 1
    """
    result = session.run(query, **params)
    record = result.single()
    if not record:
        return None
    return record.data()


def link_segment_to_concept(
    session: Session,
    segment_id: str,
    concept_id: str,
    tenant_id: Optional[str] = None,
) -> None:
    """
    Create (Segment)-[:COVERS]->(Concept).
    """
    query = """
    MATCH (seg:LectureSegment {segment_id: $segment_id})
    WHERE seg.tenant_id = $tenant_id OR ($tenant_id IS NULL AND seg.tenant_id IS NULL)
    MATCH (c:Concept {node_id: $concept_id})
    MERGE (seg)-[:COVERS]->(c)
    """
    session.run(query, segment_id=segment_id, concept_id=concept_id, tenant_id=tenant_id)


def link_segment_to_analogy(
    session: Session,
    segment_id: str,
    analogy_id: str,
    tenant_id: Optional[str] = None,
) -> None:
    """
    Create (Segment)-[:USES_ANALOGY]->(Analogy).
    """
    query = """
    MATCH (seg:LectureSegment {segment_id: $segment_id})
    WHERE seg.tenant_id = $tenant_id OR ($tenant_id IS NULL AND seg.tenant_id IS NULL)
    MATCH (a:Analogy {analogy_id: $analogy_id})
    MERGE (seg)-[:USES_ANALOGY]->(a)
    """
    session.run(query, segment_id=segment_id, analogy_id=analogy_id, tenant_id=tenant_id)


def upsert_merge_candidate(
    session: Session,
    graph_id: str,
    candidate_id: str,
    src_node_id: str,
    dst_node_id: str,
    score: float,
    method: str,
    rationale: str,
    status: str = "PROPOSED"
) -> None:
    """
    Create or update a MergeCandidate node.
    
    Args:
        session: Neo4j session
        graph_id: Graph ID for scoping
        candidate_id: Deterministic candidate identifier
        src_node_id: Source Concept node_id
        dst_node_id: Destination Concept node_id
        score: Similarity score (0-1)
        method: Detection method ("string" | "embedding" | "llm" | "hybrid")
        rationale: Short explanation text
        status: Status ("PROPOSED" | "ACCEPTED" | "REJECTED")
    """
    ensure_graph_scoping_initialized(session)
    
    query = """
    MATCH (g:GraphSpace {graph_id: $graph_id})
    MATCH (a:Concept {graph_id: $graph_id, node_id: $src_node_id})
    MATCH (b:Concept {graph_id: $graph_id, node_id: $dst_node_id})
    MERGE (m:MergeCandidate {graph_id: $graph_id, candidate_id: $candidate_id})
    ON CREATE SET
        m.src_node_id = $src_node_id,
        m.dst_node_id = $dst_node_id,
        m.score = $score,
        m.method = $method,
        m.rationale = $rationale,
        m.status = $status,
        m.created_at = timestamp()
    ON MATCH SET
        m.src_node_id = $src_node_id,
        m.dst_node_id = $dst_node_id,
        m.score = $score,
        m.method = $method,
        m.rationale = $rationale,
        m.status = $status,
        m.updated_at = timestamp()
    MERGE (m)-[:BELONGS_TO]->(g)
    MERGE (m)-[:MERGE_SRC]->(a)
    MERGE (m)-[:MERGE_DST]->(b)
    RETURN 1
    """
    
    session.run(
        query,
        graph_id=graph_id,
        candidate_id=candidate_id,
        src_node_id=src_node_id,
        dst_node_id=dst_node_id,
        score=score,
        method=method,
        rationale=rationale,
        status=status
    )


def list_merge_candidates(
    session: Session,
    graph_id: str,
    status: str = "PROPOSED",
    limit: int = 50,
    offset: int = 0
) -> List[dict]:
    """
    List merge candidates for review.
    
    Args:
        session: Neo4j session
        graph_id: Graph ID for scoping
        status: Status filter ("PROPOSED", "ACCEPTED", "REJECTED")
        limit: Maximum number of candidates to return
        offset: Offset for pagination
    
    Returns:
        List of candidate dicts with full concept details
    """
    ensure_graph_scoping_initialized(session)
    
    query = """
    MATCH (g:GraphSpace {graph_id: $graph_id})
    MATCH (m:MergeCandidate {graph_id: $graph_id, status: $status})-[:BELONGS_TO]->(g)
    MATCH (m)-[:MERGE_SRC]->(src:Concept {graph_id: $graph_id})
    MATCH (m)-[:MERGE_DST]->(dst:Concept {graph_id: $graph_id})
    RETURN m.candidate_id AS candidate_id,
           m.score AS score,
           m.method AS method,
           m.rationale AS rationale,
           m.status AS status,
           m.created_at AS created_at,
           m.updated_at AS updated_at,
           m.reviewed_at AS reviewed_at,
           m.reviewed_by AS reviewed_by,
           src.node_id AS src_node_id,
           src.name AS src_name,
           src.description AS src_description,
           src.tags AS src_tags,
           dst.node_id AS dst_node_id,
           dst.name AS dst_name,
           dst.description AS dst_description,
           dst.tags AS dst_tags
    ORDER BY m.score DESC, m.created_at DESC
    SKIP $offset
    LIMIT $limit
    """
    
    result = session.run(
        query,
        graph_id=graph_id,
        status=status,
        offset=offset,
        limit=limit
    )
    
    candidates = []
    for record in result:
        candidates.append({
            "candidate_id": record["candidate_id"],
            "score": record["score"],
            "method": record["method"],
            "rationale": record["rationale"],
            "status": record["status"],
            "created_at": record["created_at"],
            "updated_at": record["updated_at"],
            "reviewed_at": record["reviewed_at"],
            "reviewed_by": record["reviewed_by"],
            "src_concept": {
                "node_id": record["src_node_id"],
                "name": record["src_name"],
                "description": record["src_description"],
                "tags": record["src_tags"] or [],
            },
            "dst_concept": {
                "node_id": record["dst_node_id"],
                "name": record["dst_name"],
                "description": record["dst_description"],
                "tags": record["dst_tags"] or [],
            },
        })
    
    return candidates


def set_merge_candidate_status(
    session: Session,
    graph_id: str,
    candidate_ids: List[str],
    status: str,
    reviewed_by: Optional[str] = None
) -> int:
    """
    Update status of one or more merge candidates.
    
    Args:
        session: Neo4j session
        graph_id: Graph ID for scoping
        candidate_ids: List of candidate IDs to update
        status: New status ("PROPOSED" | "ACCEPTED" | "REJECTED")
        reviewed_by: Reviewer identifier (optional)
    
    Returns:
        Number of candidates updated
    """
    if not candidate_ids:
        return 0
    
    ensure_graph_scoping_initialized(session)
    
    current_timestamp = int(datetime.datetime.now().timestamp() * 1000)  # milliseconds
    
    set_clauses = [
        "m.status = $status",
        "m.updated_at = $updated_at",
        "m.reviewed_at = $updated_at"
    ]
    
    params = {
        "graph_id": graph_id,
        "candidate_ids": candidate_ids,
        "status": status,
        "updated_at": current_timestamp,
    }
    
    if reviewed_by:
        set_clauses.append("m.reviewed_by = $reviewed_by")
        params["reviewed_by"] = reviewed_by
    
    query = f"""
    MATCH (m:MergeCandidate {{graph_id: $graph_id, candidate_id: $candidate_id}})
    SET {', '.join(set_clauses)}
    RETURN count(m) AS updated
    """
    
    updated_count = 0
    for candidate_id in candidate_ids:
        result = session.run(
            query,
            graph_id=graph_id,
            candidate_id=candidate_id,
            **{k: v for k, v in params.items() if k != "candidate_ids"}
        )
        record = result.single()
        if record and record["updated"] > 0:
            updated_count += 1
    
    return updated_count


