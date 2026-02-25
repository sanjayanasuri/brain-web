"""
Relationship CRUD and review (proposed, accept, reject, edit).
"""
from typing import Any, Dict, List, Optional

from neo4j import Session

from models import RelationshipCreate
from services_branch_explorer import ensure_graph_scoping_initialized, get_active_graph_context
from services_graph_helpers import (
    build_edge_visibility_where_clause as _build_edge_visibility_where_clause,
    get_tenant_scoped_graph_context as _get_tenant_scoped_graph_context,
    normalize_include_proposed as _normalize_include_proposed,
)
from config import PROPOSED_VISIBILITY_THRESHOLD
from utils.timestamp import utcnow_ms


def create_relationship(
    session: Session, payload: RelationshipCreate, tenant_id: Optional[str] = None
) -> None:
    """Create or merge a relationship between two concepts by name."""
    ensure_graph_scoping_initialized(session)
    graph_id, branch_id = get_active_graph_context(session, tenant_id=tenant_id)
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
    """ % payload.predicate
    session.run(
        query,
        source_name=payload.source_name,
        target_name=payload.target_name,
        graph_id=graph_id,
        branch_id=branch_id,
    )


def get_all_relationships(
    session: Session,
    include_proposed: str = "auto",
    tenant_id: Optional[str] = None,
) -> List[dict]:
    """Return all relationships between Concept nodes."""
    ensure_graph_scoping_initialized(session)
    graph_id, branch_id, resolved_tenant_id = _get_tenant_scoped_graph_context(
        session, tenant_id=tenant_id
    )
    include_proposed = _normalize_include_proposed(include_proposed)
    edge_visibility_clause = _build_edge_visibility_where_clause(include_proposed)
    params = {
        "graph_id": graph_id,
        "branch_id": branch_id,
        "tenant_id": resolved_tenant_id,
        "include_proposed": include_proposed,
        "threshold": PROPOSED_VISIBILITY_THRESHOLD,
    }
    query = f"""
    MATCH (g:GraphSpace {{graph_id: $graph_id, tenant_id: $tenant_id}})
    MATCH (s:Concept)-[:BELONGS_TO]->(g)
    MATCH (t:Concept)-[:BELONGS_TO]->(g)
    MATCH (s)-[r]->(t)
    WHERE r.graph_id = $graph_id
      AND $branch_id IN COALESCE(r.on_branches, [])
      AND $branch_id IN COALESCE(s.on_branches, [])
      AND $branch_id IN COALESCE(t.on_branches, [])
      AND {edge_visibility_clause}
    RETURN s.node_id AS source_id,
           t.node_id AS target_id,
           type(r) AS predicate,
           COALESCE(r.status, 'ACCEPTED') AS status,
           COALESCE(r.confidence, 0.0) AS confidence,
           COALESCE(r.method, 'unknown') AS method,
           r.rationale AS rationale,
           r.source_id AS relationship_source_id,
           r.chunk_id AS chunk_id
    """
    result = session.run(query, **params)
    return [
        {
            "source_id": record.data()["source_id"],
            "target_id": record.data()["target_id"],
            "predicate": record.data()["predicate"],
            "status": record.data()["status"],
            "confidence": record.data()["confidence"],
            "method": record.data()["method"],
            "rationale": record.data()["rationale"],
            "relationship_source_id": record.data()["relationship_source_id"],
            "chunk_id": record.data()["chunk_id"],
        }
        for record in result
    ]


def create_relationship_by_ids(
    session: Session,
    source_id: str,
    target_id: str,
    predicate: str,
    status: str = "ACCEPTED",
    confidence: Optional[float] = None,
    method: Optional[str] = None,
    source_id_meta: Optional[str] = None,
    chunk_id: Optional[str] = None,
    claim_id: Optional[str] = None,
    rationale: Optional[str] = None,
    model_version: Optional[str] = None,
    ingestion_run_id: Optional[str] = None,
    tenant_id: Optional[str] = None,
) -> None:
    """Create a relationship between two concepts by node_ids."""
    ensure_graph_scoping_initialized(session)
    graph_id, branch_id = get_active_graph_context(session, tenant_id=tenant_id)
    set_clauses = [
        "r.graph_id = COALESCE(r.graph_id, $graph_id)",
        """r.on_branches = CASE
            WHEN r.on_branches IS NULL THEN [$branch_id]
            WHEN $branch_id IN r.on_branches THEN r.on_branches
            ELSE r.on_branches + $branch_id
        END""",
        "r.status = $status",
        "r.created_at = COALESCE(r.created_at, timestamp())",
        "r.updated_at = timestamp()",
    ]
    params = {
        "source_id": source_id,
        "target_id": target_id,
        "graph_id": graph_id,
        "branch_id": branch_id,
        "status": status,
    }
    if confidence is not None:
        set_clauses.append("r.confidence = $confidence")
        params["confidence"] = confidence
    if method is not None:
        set_clauses.append("r.method = $method")
        params["method"] = method
    if source_id_meta is not None:
        set_clauses.append("r.source_id = $source_id_meta")
        params["source_id_meta"] = source_id_meta
    if chunk_id is not None:
        set_clauses.append("r.chunk_id = $chunk_id")
        params["chunk_id"] = chunk_id
    if claim_id is not None:
        set_clauses.append("r.claim_id = $claim_id")
        params["claim_id"] = claim_id
    if rationale is not None:
        set_clauses.append("r.rationale = $rationale")
        params["rationale"] = rationale
    if model_version is not None:
        set_clauses.append("r.model_version = $model_version")
        params["model_version"] = model_version
    if ingestion_run_id is not None:
        set_clauses.append("r.ingestion_run_id = $ingestion_run_id")
        params["ingestion_run_id"] = ingestion_run_id
    query = f"""
    MATCH (g:GraphSpace {{graph_id: $graph_id}})
    MATCH (s:Concept {{node_id: $source_id}})-[:BELONGS_TO]->(g)
    MATCH (t:Concept {{node_id: $target_id}})-[:BELONGS_TO]->(g)
    WHERE $branch_id IN COALESCE(s.on_branches, []) AND $branch_id IN COALESCE(t.on_branches, [])
    MERGE (s)-[r:`{predicate}`]->(t)
    SET {', '.join(set_clauses)}
    RETURN 1
    """
    session.run(query, **params)


def relationship_exists(
    session: Session, source_id: str, target_id: str, predicate: str
) -> bool:
    """Check if a relationship exists between two concepts with the given predicate."""
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
      AND COALESCE(r.status, 'ACCEPTED') IN ['ACCEPTED', 'PROPOSED']
    RETURN count(r) > 0 AS exists
    """
    result = session.run(
        query,
        source_id=source_id,
        target_id=target_id,
        predicate=predicate,
        graph_id=graph_id,
        branch_id=branch_id,
    )
    record = result.single()
    return record and record["exists"]


def delete_relationship(
    session: Session, source_id: str, target_id: str, predicate: str
) -> bool:
    """Delete a specific relationship. Returns True if deleted, False if not found."""
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
    result = session.run(
        query,
        source_id=source_id,
        target_id=target_id,
        predicate=predicate,
        graph_id=graph_id,
        branch_id=branch_id,
    )
    record = result.single()
    return record and record["deleted"] > 0


def create_or_update_proposed_relationship(
    session: Session,
    graph_id: str,
    src_node_id: str,
    dst_node_id: str,
    rel_type: str,
    meta: Dict[str, Any],
) -> None:
    """Create or update a proposed relationship with metadata."""
    ensure_graph_scoping_initialized(session)
    _, branch_id = get_active_graph_context(session)
    status = meta.get("status", "PROPOSED")
    confidence = meta.get("confidence")
    method = meta.get("method")
    source_id_meta = meta.get("source_id")
    chunk_id = meta.get("chunk_id")
    claim_id = meta.get("claim_id")
    rationale = meta.get("rationale")
    model_version = meta.get("model_version")
    set_clauses = [
        "r.graph_id = COALESCE(r.graph_id, $graph_id)",
        """r.on_branches = CASE
            WHEN r.on_branches IS NULL THEN [$branch_id]
            WHEN $branch_id IN r.on_branches THEN r.on_branches
            ELSE r.on_branches + $branch_id
        END""",
        "r.status = $status",
        "r.updated_at = timestamp()",
        "r.created_at = COALESCE(r.created_at, timestamp())",
    ]
    params = {
        "graph_id": graph_id,
        "branch_id": branch_id,
        "src_node_id": src_node_id,
        "dst_node_id": dst_node_id,
        "status": status,
    }
    if confidence is not None:
        set_clauses.append("r.confidence = $confidence")
        params["confidence"] = confidence
    if method is not None:
        set_clauses.append("r.method = $method")
        params["method"] = method
    if source_id_meta is not None:
        set_clauses.append("r.source_id = $source_id_meta")
        params["source_id_meta"] = source_id_meta
    if chunk_id is not None:
        set_clauses.append("r.chunk_id = $chunk_id")
        params["chunk_id"] = chunk_id
    if claim_id is not None:
        set_clauses.append("r.claim_id = $claim_id")
        params["claim_id"] = claim_id
    if rationale is not None:
        set_clauses.append("r.rationale = $rationale")
        params["rationale"] = rationale
    if model_version is not None:
        set_clauses.append("r.model_version = $model_version")
        params["model_version"] = model_version
    query = f"""
    MATCH (g:GraphSpace {{graph_id: $graph_id}})
    MATCH (s:Concept {{node_id: $src_node_id}})-[:BELONGS_TO]->(g)
    MATCH (t:Concept {{node_id: $dst_node_id}})-[:BELONGS_TO]->(g)
    WHERE $branch_id IN COALESCE(s.on_branches, []) AND $branch_id IN COALESCE(t.on_branches, [])
    MERGE (s)-[r:`{rel_type}`]->(t)
    SET {', '.join(set_clauses)}
    RETURN 1
    """
    session.run(query, **params)


def get_proposed_relationships(
    session: Session,
    graph_id: str,
    status: str = "PROPOSED",
    limit: int = 50,
    offset: int = 0,
    ingestion_run_id: Optional[str] = None,
    include_archived: bool = False,
) -> List[dict]:
    """Get relationships for review, filtered by status."""
    ensure_graph_scoping_initialized(session)
    _, branch_id = get_active_graph_context(session)
    where_clauses = [
        "r.graph_id = $graph_id",
        "$branch_id IN COALESCE(r.on_branches, [])",
        "$branch_id IN COALESCE(s.on_branches, [])",
        "$branch_id IN COALESCE(t.on_branches, [])",
        "COALESCE(r.status, 'ACCEPTED') = $status",
    ]
    if not include_archived:
        where_clauses.append("COALESCE(r.archived, false) = false")
        where_clauses.append("COALESCE(s.archived, false) = false")
        where_clauses.append("COALESCE(t.archived, false) = false")
    params = {
        "graph_id": graph_id,
        "branch_id": branch_id,
        "status": status,
        "offset": offset,
        "limit": limit,
    }
    if ingestion_run_id:
        where_clauses.append("r.ingestion_run_id = $ingestion_run_id")
        params["ingestion_run_id"] = ingestion_run_id
    query = f"""
    MATCH (g:GraphSpace {{graph_id: $graph_id}})
    MATCH (s:Concept)-[:BELONGS_TO]->(g)
    MATCH (t:Concept)-[:BELONGS_TO]->(g)
    MATCH (s)-[r]->(t)
    WHERE {' AND '.join(where_clauses)}
    RETURN s.node_id AS src_node_id,
           s.name AS src_name,
           t.node_id AS dst_node_id,
           t.name AS dst_name,
           type(r) AS rel_type,
           COALESCE(r.confidence, 0.5) AS confidence,
           COALESCE(r.method, 'unknown') AS method,
           r.rationale AS rationale,
           r.source_id AS source_id,
           r.chunk_id AS chunk_id,
           r.claim_id AS claim_id,
           r.model_version AS model_version,
           r.created_at AS created_at,
           r.updated_at AS updated_at,
           r.reviewed_at AS reviewed_at,
           r.reviewed_by AS reviewed_by
    ORDER BY r.created_at DESC
    SKIP $offset
    LIMIT $limit
    """
    result = session.run(query, **params)
    return [
        {
            "src_node_id": record["src_node_id"],
            "src_name": record["src_name"],
            "dst_node_id": record["dst_node_id"],
            "dst_name": record["dst_name"],
            "rel_type": record["rel_type"],
            "confidence": record["confidence"],
            "method": record["method"],
            "rationale": record["rationale"],
            "source_id": record["source_id"],
            "chunk_id": record["chunk_id"],
            "claim_id": record["claim_id"],
            "model_version": record["model_version"],
            "created_at": record["created_at"],
            "updated_at": record["updated_at"],
            "reviewed_at": record["reviewed_at"],
            "reviewed_by": record["reviewed_by"],
        }
        for record in result
    ]


def accept_relationships(
    session: Session,
    graph_id: str,
    edges: List[dict],
    reviewed_by: Optional[str] = None,
) -> int:
    """Accept one or more relationships. Returns count accepted."""
    ensure_graph_scoping_initialized(session)
    _, branch_id = get_active_graph_context(session)
    if not edges:
        return 0
    current_timestamp = utcnow_ms()
    accepted_count = 0
    for edge in edges:
        query = """
        MATCH (g:GraphSpace {graph_id: $graph_id})
        MATCH (s:Concept {node_id: $src_node_id})-[:BELONGS_TO]->(g)
        MATCH (t:Concept {node_id: $dst_node_id})-[:BELONGS_TO]->(g)
        MATCH (s)-[r]->(t)
        WHERE type(r) = $rel_type
          AND r.graph_id = $graph_id
          AND $branch_id IN COALESCE(r.on_branches, [])
        SET r.status = 'ACCEPTED',
            r.reviewed_at = $reviewed_at,
            r.updated_at = $reviewed_at
        """
        params = {
            "graph_id": graph_id,
            "branch_id": branch_id,
            "src_node_id": edge["src_node_id"],
            "dst_node_id": edge["dst_node_id"],
            "rel_type": edge["rel_type"],
            "reviewed_at": current_timestamp,
        }
        if reviewed_by:
            query = query.rstrip() + ",\n            r.reviewed_by = $reviewed_by"
            params["reviewed_by"] = reviewed_by
        query = query + "\n        RETURN count(r) AS updated"
        result = session.run(query, **params)
        record = result.single()
        if record and record["updated"] > 0:
            accepted_count += 1
    return accepted_count


def reject_relationships(
    session: Session,
    graph_id: str,
    edges: List[dict],
    reviewed_by: Optional[str] = None,
) -> int:
    """Reject one or more relationships. Returns count rejected."""
    ensure_graph_scoping_initialized(session)
    _, branch_id = get_active_graph_context(session)
    if not edges:
        return 0
    current_timestamp = utcnow_ms()
    rejected_count = 0
    for edge in edges:
        query = """
        MATCH (g:GraphSpace {graph_id: $graph_id})
        MATCH (s:Concept {node_id: $src_node_id})-[:BELONGS_TO]->(g)
        MATCH (t:Concept {node_id: $dst_node_id})-[:BELONGS_TO]->(g)
        MATCH (s)-[r]->(t)
        WHERE type(r) = $rel_type
          AND r.graph_id = $graph_id
          AND $branch_id IN COALESCE(r.on_branches, [])
        SET r.status = 'REJECTED',
            r.reviewed_at = $reviewed_at,
            r.updated_at = $reviewed_at
        """
        params = {
            "graph_id": graph_id,
            "branch_id": branch_id,
            "src_node_id": edge["src_node_id"],
            "dst_node_id": edge["dst_node_id"],
            "rel_type": edge["rel_type"],
            "reviewed_at": current_timestamp,
        }
        if reviewed_by:
            query = query.rstrip() + ",\n            r.reviewed_by = $reviewed_by"
            params["reviewed_by"] = reviewed_by
        query = query + "\n        RETURN count(r) AS updated"
        result = session.run(query, **params)
        record = result.single()
        if record and record["updated"] > 0:
            rejected_count += 1
    return rejected_count


def edit_relationship(
    session: Session,
    graph_id: str,
    src_node_id: str,
    dst_node_id: str,
    old_rel_type: str,
    new_rel_type: str,
    reviewed_by: Optional[str] = None,
) -> bool:
    """Edit a relationship by changing its type (reject old, create new). Returns True if successful."""
    ensure_graph_scoping_initialized(session)
    _, branch_id = get_active_graph_context(session)
    current_timestamp = utcnow_ms()
    reject_query = """
    MATCH (g:GraphSpace {graph_id: $graph_id})
    MATCH (s:Concept {node_id: $src_node_id})-[:BELONGS_TO]->(g)
    MATCH (t:Concept {node_id: $dst_node_id})-[:BELONGS_TO]->(g)
    MATCH (s)-[r]->(t)
    WHERE type(r) = $old_rel_type
      AND r.graph_id = $graph_id
      AND $branch_id IN COALESCE(r.on_branches, [])
    SET r.status = 'REJECTED',
        r.reviewed_at = $reviewed_at,
        r.updated_at = $reviewed_at
    """
    reject_params = {
        "graph_id": graph_id,
        "branch_id": branch_id,
        "src_node_id": src_node_id,
        "dst_node_id": dst_node_id,
        "old_rel_type": old_rel_type,
        "reviewed_at": current_timestamp,
    }
    if reviewed_by:
        reject_query = reject_query.rstrip() + ",\n        r.reviewed_by = $reviewed_by"
        reject_params["reviewed_by"] = reviewed_by
    reject_query = reject_query + "\n    RETURN r"
    old_rel_result = session.run(reject_query, **reject_params)
    old_rel_record = old_rel_result.single()
    if not old_rel_record:
        return False
    old_rel = old_rel_record["r"]
    if hasattr(old_rel, "items"):
        old_rel = dict(old_rel)
    else:
        old_rel = dict(old_rel) if old_rel else {}
    create_query = f"""
    MATCH (g:GraphSpace {{graph_id: $graph_id}})
    MATCH (s:Concept {{node_id: $src_node_id}})-[:BELONGS_TO]->(g)
    MATCH (t:Concept {{node_id: $dst_node_id}})-[:BELONGS_TO]->(g)
    WHERE $branch_id IN COALESCE(s.on_branches, []) AND $branch_id IN COALESCE(t.on_branches, [])
    MERGE (s)-[r:`{new_rel_type}`]->(t)
    SET r.graph_id = $graph_id,
        r.on_branches = CASE
            WHEN r.on_branches IS NULL THEN [$branch_id]
            WHEN $branch_id IN r.on_branches THEN r.on_branches
            ELSE r.on_branches + $branch_id
        END,
        r.status = 'ACCEPTED',
        r.method = 'human',
        r.created_at = timestamp(),
        r.updated_at = timestamp(),
        r.reviewed_at = $reviewed_at
    """
    create_params = {
        "graph_id": graph_id,
        "branch_id": branch_id,
        "src_node_id": src_node_id,
        "dst_node_id": dst_node_id,
        "reviewed_at": current_timestamp,
    }
    if old_rel.get("confidence") is not None:
        create_query = create_query.rstrip() + ",\n        r.confidence = $confidence"
        create_params["confidence"] = old_rel.get("confidence")
    if old_rel.get("source_id"):
        create_query = create_query.rstrip() + ",\n        r.source_id = $source_id"
        create_params["source_id"] = old_rel.get("source_id")
    if old_rel.get("chunk_id"):
        create_query = create_query.rstrip() + ",\n        r.chunk_id = $chunk_id"
        create_params["chunk_id"] = old_rel.get("chunk_id")
    if old_rel.get("claim_id"):
        create_query = create_query.rstrip() + ",\n        r.claim_id = $claim_id"
        create_params["claim_id"] = old_rel.get("claim_id")
    if old_rel.get("rationale"):
        create_query = create_query.rstrip() + ",\n        r.rationale = $rationale"
        create_params["rationale"] = old_rel.get("rationale")
    if reviewed_by:
        create_query = create_query.rstrip() + ",\n        r.reviewed_by = $reviewed_by"
        create_params["reviewed_by"] = reviewed_by
    create_query = create_query.rstrip() + ",\n        r.supersedes_rel_type = $old_rel_type"
    create_params["old_rel_type"] = old_rel_type
    create_query = create_query + "\n    RETURN 1"
    session.run(create_query, **create_params)
    return True
