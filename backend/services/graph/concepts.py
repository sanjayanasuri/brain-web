"""
Concept CRUD, neighbors, graph overview, unlink_lecture, cross-graph, mastery.
"""
from typing import List, Optional, Dict, Any
from neo4j import Session

from models import Concept, ConceptCreate
from services_branch_explorer import ensure_graph_scoping_initialized, get_active_graph_context
from services_graph_helpers import (
    build_edge_visibility_where_clause as _build_edge_visibility_where_clause,
    build_tenant_filter_clause as _build_tenant_filter_clause,
    get_tenant_scoped_graph_context as _get_tenant_scoped_graph_context,
    normalize_include_proposed as _normalize_include_proposed,
)
from config import PROPOSED_VISIBILITY_THRESHOLD
from utils.timestamp import utcnow_ms, utcnow_iso
from utils.slug import generate_slug, ensure_unique_slug


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
    
    # Ensure run_id fields are present (default to None)
    if "created_by_run_id" not in data:
        data["created_by_run_id"] = None
    if "last_updated_by_run_id" not in data:
        data["last_updated_by_run_id"] = None
    
    # Ensure aliases is a list (default to empty)
    if "aliases" not in data or data["aliases"] is None:
        data["aliases"] = []
    
    return Concept(**data)


def get_concept_by_name(session: Session, name: str, include_archived: bool = False, tenant_id: Optional[str] = None) -> Optional[Concept]:
    """
    Find a concept by name (exact match) or by alias (normalized match).
    Phase 2: Now checks both name and aliases field.
    
    Args:
        session: Neo4j session
        name: Concept name to search for
        include_archived: Whether to include archived concepts
        tenant_id: Optional tenant_id for multi-tenant isolation
    """
    ensure_graph_scoping_initialized(session)
    graph_id, branch_id, resolved_tenant_id = _get_tenant_scoped_graph_context(session, tenant_id=tenant_id)
    where_clauses = [
        "$branch_id IN COALESCE(c.on_branches, [])"
    ]
    if not include_archived:
        where_clauses.append("COALESCE(c.archived, false) = false")
    
    # Add tenant filtering
    tenant_filter = _build_tenant_filter_clause(resolved_tenant_id)
    
    # Normalize name for matching
    normalized_name = name.lower().strip()
    
    params = {
        "name": name,
        "normalized_name": normalized_name,
        "graph_id": graph_id,
        "branch_id": branch_id,
        "tenant_id": resolved_tenant_id,
    }
    
    query = f"""
    MATCH (g:GraphSpace {{graph_id: $graph_id}})
    {tenant_filter}
    MATCH (c:Concept)-[:BELONGS_TO]->(g)
    WHERE {' AND '.join(where_clauses)}
      AND (
        c.name = $name
        OR toLower(trim(c.name)) = $normalized_name
        OR $normalized_name IN [alias IN COALESCE(c.aliases, []) | toLower(trim(alias))]
      )
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
           COALESCE(c.aliases, []) AS aliases,
           c.created_by AS created_by,
           c.last_updated_by AS last_updated_by
    LIMIT 1
    """
    result = session.run(query, **params)
    record = result.single()
    if not record:
        return None
    return _normalize_concept_from_db(record.data())


def get_concept_by_id(
    session: Session,
    node_id: str,
    include_archived: bool = False,
    tenant_id: Optional[str] = None,
) -> Optional[Concept]:
    ensure_graph_scoping_initialized(session)
    graph_id, branch_id, tenant_id = _get_tenant_scoped_graph_context(session, tenant_id=tenant_id)
    where_clauses = [
        "$branch_id IN COALESCE(c.on_branches, [])"
    ]
    if not include_archived:
        where_clauses.append("COALESCE(c.archived, false) = false")
    
    query = f"""
    MATCH (g:GraphSpace {{graph_id: $graph_id}})
    WHERE g.tenant_id = $tenant_id
    MATCH (c:Concept {{node_id: $node_id}})-[:BELONGS_TO]->(g)
    WHERE {' AND '.join(where_clauses)}
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
           COALESCE(c.aliases, []) AS aliases,
           c.created_by AS created_by,
           c.last_updated_by AS last_updated_by
    LIMIT 1
    """
    record = session.run(query, node_id=node_id, graph_id=graph_id, branch_id=branch_id, tenant_id=tenant_id).single()
    if not record:
        return None
    return _normalize_concept_from_db(record.data())


def get_concept_by_slug(session: Session, slug: str, include_archived: bool = False, tenant_id: Optional[str] = None) -> Optional[Concept]:
    """Get a concept by its URL slug (Wikipedia-style)."""
    ensure_graph_scoping_initialized(session)
    graph_id, branch_id, resolved_tenant_id = _get_tenant_scoped_graph_context(session, tenant_id=tenant_id)
    where_clauses = [
        "c.url_slug = $slug",
        "$branch_id IN COALESCE(c.on_branches, [])"
    ]
    if not include_archived:
        where_clauses.append("COALESCE(c.archived, false) = false")
    
    query = f"""
    MATCH (g:GraphSpace {{graph_id: $graph_id}})
    WHERE g.tenant_id = $tenant_id
    MATCH (c:Concept)-[:BELONGS_TO]->(g)
    WHERE {' AND '.join(where_clauses)}
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
           COALESCE(c.aliases, []) AS aliases,
           c.created_by AS created_by,
           c.last_updated_by AS last_updated_by
    LIMIT 1
    """
    record = session.run(query, slug=slug, graph_id=graph_id, branch_id=branch_id, tenant_id=resolved_tenant_id).single()
    if not record:
        return None
    return _normalize_concept_from_db(record.data())


def create_concept(session: Session, payload: ConceptCreate, tenant_id: Optional[str] = None) -> Concept:
    """
    Creates a concept node with a generated node_id if not present.
    For now, node_id is just a UUID string.
    """
    from uuid import uuid4

    node_id = f"N{uuid4().hex[:8].upper()}"
    
    # Auto-generate slug if not provided
    if not payload.url_slug:
        base_slug = generate_slug(payload.name)
        url_slug = ensure_unique_slug(session, base_slug)
    else:
        url_slug = payload.url_slug
    
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
    graph_id, branch_id = get_active_graph_context(session, tenant_id=tenant_id)
    
    # Build ON CREATE SET clause with run_id tracking
    on_create_set = [
        "c.node_id = $node_id",
        "c.domain = $domain",
        "c.type = $type",
        "c.description = $description",
        "c.tags = $tags",
        "c.notes_key = $notes_key",
        "c.lecture_key = $lecture_key",
        "c.url_slug = $url_slug",
        "c.lecture_sources = $lecture_sources",
        "c.created_by = $created_by",
        "c.last_updated_by = $last_updated_by",
        "c.on_branches = [$branch_id]",
        "c.aliases = $aliases",
    ]
    
    # Add run_id tracking only on CREATE (don't overwrite existing created_by_run_id)
    if payload.created_by_run_id:
        on_create_set.append("c.created_by_run_id = $created_by_run_id")
    
    # Build ON MATCH SET clause with run_id tracking for updates
    on_match_set = [
        """c.on_branches = CASE
            WHEN c.on_branches IS NULL THEN [$branch_id]
            WHEN $branch_id IN c.on_branches THEN c.on_branches
            ELSE c.on_branches + $branch_id
        END""",
    ]
    
    # Set last_updated_by_run_id on updates (but preserve created_by_run_id)
    if payload.last_updated_by_run_id:
        on_match_set.append("c.last_updated_by_run_id = $last_updated_by_run_id")
    
    query = f"""
    MATCH (g:GraphSpace {{graph_id: $graph_id}})
    MERGE (c:Concept {{graph_id: $graph_id, name: $name}})
    ON CREATE SET {', '.join(on_create_set)}
    ON MATCH SET {', '.join(on_match_set)}
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
           COALESCE(c.aliases, []) AS aliases,
           c.created_by AS created_by,
           c.last_updated_by AS last_updated_by,
           c.created_by_run_id AS created_by_run_id,
           c.last_updated_by_run_id AS last_updated_by_run_id,
           c.graph_id AS graph_id
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
        "url_slug": url_slug,
        "lecture_sources": lecture_sources,
        "created_by": created_by,
        "last_updated_by": last_updated_by,
        "aliases": payload.aliases or [],
        "graph_id": graph_id,
        "branch_id": branch_id,
    }
    
    if payload.created_by_run_id:
        params["created_by_run_id"] = payload.created_by_run_id
    if payload.last_updated_by_run_id:
        params["last_updated_by_run_id"] = payload.last_updated_by_run_id
    
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
    
    if update.get("aliases") is not None:
        set_clauses.append("c.aliases = $aliases")
        params["aliases"] = update["aliases"]
    
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
           COALESCE(c.aliases, []) AS aliases,
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


# Artifact functions: see services.graph.artifacts (imported above).

def get_neighbors(
    session: Session,
    node_id: str,
    include_proposed: str = "auto",
    tenant_id: Optional[str] = None,
) -> List[Concept]:
    """
    Returns direct neighbors of a concept node, excluding merged nodes.
    
    Args:
        session: Neo4j session
        node_id: Concept node_id
        include_proposed: Visibility policy for proposed edges:
            - "auto" (default): ACCEPTED + PROPOSED with confidence >= threshold
            - "all": ACCEPTED + all PROPOSED
            - "none": Only ACCEPTED
    """
    ensure_graph_scoping_initialized(session)
    graph_id, branch_id, resolved_tenant_id = _get_tenant_scoped_graph_context(session, tenant_id=tenant_id)
    
    include_proposed = _normalize_include_proposed(include_proposed)
    edge_visibility_clause = _build_edge_visibility_where_clause(include_proposed)
    
    params = {
        "node_id": node_id,
        "graph_id": graph_id,
        "branch_id": branch_id,
        "tenant_id": resolved_tenant_id,
        "include_proposed": include_proposed,
        "threshold": PROPOSED_VISIBILITY_THRESHOLD,
    }
    
    query = f"""
    MATCH (g:GraphSpace {{graph_id: $graph_id}})
    WHERE g.tenant_id = $tenant_id
    MATCH (c:Concept {{node_id: $node_id}})-[:BELONGS_TO]->(g)
    MATCH (c)-[r]-(n:Concept)-[:BELONGS_TO]->(g)
    WHERE $branch_id IN COALESCE(c.on_branches, [])
      AND $branch_id IN COALESCE(n.on_branches, [])
      AND $branch_id IN COALESCE(r.on_branches, [])
      AND COALESCE(n.is_merged, false) = false
      AND {edge_visibility_clause}
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
    result = session.run(query, **params)
    return [_normalize_concept_from_db(record.data()) for record in result]


def get_neighbors_with_relationships(
    session: Session,
    node_id: str,
    include_proposed: str = "auto",
    tenant_id: Optional[str] = None,
) -> List[dict]:
    """
    Returns direct neighbors with their relationship types, excluding merged nodes.
    Returns a list of dicts with 'concept', 'predicate', 'is_outgoing', 'relationship_status',
    'relationship_confidence', and 'relationship_method' keys.
    
    Args:
        session: Neo4j session
        node_id: Concept node_id
        include_proposed: Visibility policy for proposed edges:
            - "auto" (default): ACCEPTED + PROPOSED with confidence >= threshold
            - "all": ACCEPTED + all PROPOSED
            - "none": Only ACCEPTED
    """
    ensure_graph_scoping_initialized(session)
    graph_id, branch_id, resolved_tenant_id = _get_tenant_scoped_graph_context(session, tenant_id=tenant_id)
    
    include_proposed = _normalize_include_proposed(include_proposed)
    edge_visibility_clause = _build_edge_visibility_where_clause(include_proposed)
    
    params = {
        "node_id": node_id,
        "graph_id": graph_id,
        "branch_id": branch_id,
        "tenant_id": resolved_tenant_id,
        "include_proposed": include_proposed,
        "threshold": PROPOSED_VISIBILITY_THRESHOLD,
    }
    
    query = f"""
    MATCH (g:GraphSpace {{graph_id: $graph_id}})
    WHERE g.tenant_id = $tenant_id
    MATCH (c:Concept {{node_id: $node_id}})-[:BELONGS_TO]->(g)
    MATCH (c)-[r]-(n:Concept)-[:BELONGS_TO]->(g)
    WHERE $branch_id IN COALESCE(c.on_branches, [])
      AND $branch_id IN COALESCE(n.on_branches, [])
      AND $branch_id IN COALESCE(r.on_branches, [])
      AND COALESCE(n.is_merged, false) = false
      AND {edge_visibility_clause}
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
                    startNode(r).node_id = $node_id AS is_outgoing,
                    COALESCE(r.status, 'ACCEPTED') AS relationship_status,
                    COALESCE(r.confidence, 0.0) AS relationship_confidence,
                    COALESCE(r.method, 'unknown') AS relationship_method,
                    r.rationale AS relationship_rationale,
                    r.source_id AS relationship_source_id,
                    r.chunk_id AS relationship_chunk_id
    """
    result = session.run(query, **params)
    return [
        {
            "concept": _normalize_concept_from_db({k: v for k, v in record.data().items() if k not in ["predicate", "is_outgoing", "relationship_status", "relationship_confidence", "relationship_method"]}),
            "predicate": record.data()["predicate"],
            "is_outgoing": record.data()["is_outgoing"],
            "relationship_status": record.data()["relationship_status"],
            "relationship_confidence": record.data()["relationship_confidence"],
            "relationship_method": record.data()["relationship_method"],
            "relationship_rationale": record.data()["relationship_rationale"],
            "relationship_source_id": record.data()["relationship_source_id"],
            "relationship_chunk_id": record.data()["relationship_chunk_id"],
        }
        for record in result
    ]


def get_all_concepts(session: Session, tenant_id: Optional[str] = None) -> List[Concept]:
    """
    Returns all Concept nodes in the database, excluding merged nodes.
    """
    ensure_graph_scoping_initialized(session)
    graph_id, branch_id, resolved_tenant_id = _get_tenant_scoped_graph_context(session, tenant_id=tenant_id)
    
    # Try the scoped query first
    query = """
    MATCH (g:GraphSpace {graph_id: $graph_id, tenant_id: $tenant_id})
    MATCH (c:Concept)-[:BELONGS_TO]->(g)
    WHERE $branch_id IN COALESCE(c.on_branches, [])
      AND COALESCE(c.is_merged, false) = false
    RETURN c.node_id AS node_id,
           c.name AS name,
           c.domain AS domain,
           c.type AS type,
           c.description AS description,
           c.tags AS tags,
           c.notes_key AS notes_key,
           c.lecture_key AS lecture_key,
           c.url_slug AS url_slug,
           c.graph_id AS graph_id,
           COALESCE(c.tenant_id, g.tenant_id) AS tenant_id,
           COALESCE(c.lecture_sources, []) AS lecture_sources,
           COALESCE(c.aliases, []) AS aliases,
           c.created_by AS created_by,
           c.last_updated_by AS last_updated_by
    ORDER BY c.node_id
    """
    result = session.run(query, graph_id=graph_id, branch_id=branch_id, tenant_id=resolved_tenant_id)
    concepts = [_normalize_concept_from_db(record.data()) for record in result]
    
    return concepts


def get_graph_overview(
    session: Session,
    limit_nodes: int = 300,
    limit_edges: int = 600,
    include_proposed: str = "auto",
    tenant_id: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Returns a lightweight overview of the graph with top nodes by degree.
    
    Args:
        session: Neo4j session
        limit_nodes: Maximum number of nodes to return
        limit_edges: Maximum number of edges to return
        include_proposed: Visibility policy for proposed edges
    
    Returns:
        Dict with 'nodes', 'edges', and 'meta' keys
    """
    ensure_graph_scoping_initialized(session)
    graph_id, branch_id, resolved_tenant_id = _get_tenant_scoped_graph_context(session, tenant_id=tenant_id)
    
    include_proposed = _normalize_include_proposed(include_proposed)
    edge_visibility_clause = _build_edge_visibility_where_clause(include_proposed)
    
    params = {
        "graph_id": graph_id,
        "branch_id": branch_id,
        "tenant_id": resolved_tenant_id,
        "limit_nodes": limit_nodes,
        "limit_edges": limit_edges,
        "include_proposed": include_proposed,
        "threshold": PROPOSED_VISIBILITY_THRESHOLD,
    }
    
    # Get top nodes by degree (most connected)
    # Also include nodes with 0 degree to ensure isolated nodes are visible
    # Debug: First check if GraphSpace exists and count nodes
    debug_query = """
    MATCH (g:GraphSpace {graph_id: $graph_id, tenant_id: $tenant_id})
    OPTIONAL MATCH (c:Concept)-[:BELONGS_TO]->(g)
    RETURN count(c) AS total_nodes, count(DISTINCT c.on_branches) AS branch_variants
    """
    debug_result = session.run(debug_query, graph_id=graph_id)
    debug_data = debug_result.single()
    if debug_data:
        total_nodes = debug_data.get("total_nodes", 0)
        branch_variants = debug_data.get("branch_variants", 0)
        # Log for debugging (can be removed later)
        import sys
        print(f"[DEBUG] Graph {graph_id}: {total_nodes} total nodes, branch_id={branch_id}, branch_variants={branch_variants}", file=sys.stderr)
    
    # Query strategy: Ensure isolated nodes (degree = 0) are ALWAYS included
    # This is critical for sparse graphs where nodes may not have relationships yet
    # We use a UNION to get both connected nodes AND isolated nodes separately
    query = f"""
    // First part: Get connected nodes (degree > 0), ordered by degree
    MATCH (g:GraphSpace {{graph_id: $graph_id, tenant_id: $tenant_id}})
    MATCH (c:Concept)-[:BELONGS_TO]->(g)
    WHERE $branch_id IN COALESCE(c.on_branches, [])
      AND COALESCE(c.is_merged, false) = false
    OPTIONAL MATCH (c)-[r]-(n:Concept)-[:BELONGS_TO]->(g)
    WHERE $branch_id IN COALESCE(r.on_branches, [])
      AND $branch_id IN COALESCE(n.on_branches, [])
      AND {edge_visibility_clause}
    WITH c, count(DISTINCT r) AS degree
    WHERE degree > 0
    WITH c, degree
    ORDER BY degree DESC, c.node_id ASC
    LIMIT $limit_nodes
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
    
    UNION
    
    // Second part: Get ALL isolated nodes (degree = 0) - always include these
    // Use a simpler approach: get all nodes, then filter out those that have relationships
    MATCH (g:GraphSpace {{graph_id: $graph_id, tenant_id: $tenant_id}})
    MATCH (c:Concept)-[:BELONGS_TO]->(g)
    WHERE $branch_id IN COALESCE(c.on_branches, [])
      AND COALESCE(c.is_merged, false) = false
    WITH c
    OPTIONAL MATCH (c)-[r]-(n:Concept)-[:BELONGS_TO]->(g)
    WHERE $branch_id IN COALESCE(r.on_branches, [])
      AND $branch_id IN COALESCE(n.on_branches, [])
      AND {edge_visibility_clause}
    WITH c, count(DISTINCT r) AS degree
    WHERE degree = 0
    WITH c
    ORDER BY c.node_id ASC
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
    result = session.run(query, **params)
    nodes = [_normalize_concept_from_db({k: v for k, v in record.data().items() if k != "degree"}) for record in result]
    node_ids = {node.node_id for node in nodes}
    
    # Enhanced debugging for isolated nodes issue
    import sys
    print(f"[DEBUG] Query returned {len(nodes)} nodes for graph_id={graph_id}, branch_id={branch_id}", file=sys.stderr)
    if len(nodes) == 0:
        # Check if nodes exist at all
        check_query = """
        MATCH (g:GraphSpace {graph_id: $graph_id, tenant_id: $tenant_id})
        OPTIONAL MATCH (c:Concept)-[:BELONGS_TO]->(g)
        RETURN count(c) AS total_nodes,
               collect(c.node_id)[0..5] AS sample_node_ids,
               collect(c.on_branches)[0..5] AS sample_branches
        """
        check_result = session.run(check_query, graph_id=graph_id, tenant_id=resolved_tenant_id)
        check_data = check_result.single()
        if check_data:
            total = check_data.get("total_nodes", 0)
            sample_ids = check_data.get("sample_node_ids", [])
            sample_branches = check_data.get("sample_branches", [])
            print(f"[DEBUG] Graph {graph_id} has {total} total nodes", file=sys.stderr)
            print(f"[DEBUG] Sample node_ids: {sample_ids}", file=sys.stderr)
            print(f"[DEBUG] Sample on_branches: {sample_branches}", file=sys.stderr)
            print(f"[DEBUG] Query branch_id filter: {branch_id}", file=sys.stderr)
    else:
        print(f"[DEBUG] Found nodes: {[n.node_id for n in nodes[:5]]}", file=sys.stderr)
    
    # Get edges among the selected nodes
    if len(node_ids) > 0:
        edge_query = f"""
        MATCH (g:GraphSpace {{graph_id: $graph_id, tenant_id: $tenant_id}})
        MATCH (s:Concept)-[:BELONGS_TO]->(g)
        MATCH (t:Concept)-[:BELONGS_TO]->(g)
        MATCH (s)-[r]->(t)
        WHERE r.graph_id = $graph_id
          AND s.node_id IN $node_ids
          AND t.node_id IN $node_ids
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
        LIMIT $limit_edges
        """
        edge_result = session.run(edge_query, node_ids=list(node_ids), **params)
        edges = [
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
            for record in edge_result
        ]
    else:
        edges = []
    
    # Get total counts for metadata
    count_query = """
    MATCH (g:GraphSpace {graph_id: $graph_id, tenant_id: $tenant_id})
    MATCH (c:Concept)-[:BELONGS_TO]->(g)
    WHERE $branch_id IN COALESCE(c.on_branches, [])
      AND COALESCE(c.is_merged, false) = false
    RETURN count(c) AS total_nodes
    """
    count_result = session.run(count_query, **params)
    total_nodes = count_result.single()["total_nodes"] if count_result.peek() else 0
    
    return {
        "nodes": nodes,
        "edges": edges,
        "meta": {
            "node_count": total_nodes,
            "edge_count": len(edges),
            "sampled": len(nodes) < total_nodes if total_nodes > 0 else False,
        }
    }


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


def delete_test_concepts(session: Session) -> int:
    """
    Deletes all test concepts (those with "Test" or "Isolated Concept" in name).
    Returns the number of deleted nodes.
    """
    ensure_graph_scoping_initialized(session)
    graph_id, branch_id = get_active_graph_context(session)
    query = """
    MATCH (g:GraphSpace {graph_id: $graph_id})
    MATCH (c:Concept)-[:BELONGS_TO]->(g)
    WHERE ($branch_id IN COALESCE(c.on_branches, []))
      AND (c.name CONTAINS 'Test' OR c.name CONTAINS 'Isolated Concept' OR c.domain = 'Testing')
    DETACH DELETE c
    RETURN count(c) as deleted
    """
    result = session.run(query, graph_id=graph_id, branch_id=branch_id)
    record = result.single()
    return record["deleted"] if record else 0


def get_nodes_missing_description(session: Session, limit: int = 3) -> List[Concept]:
    """
    Returns concepts that are missing descriptions.
    """
    ensure_graph_scoping_initialized(session)
    graph_id, branch_id = get_active_graph_context(session)
    query = """
    MATCH (g:GraphSpace {graph_id: $graph_id})
    MATCH (c:Concept)-[:BELONGS_TO]->(g)
    WHERE ($branch_id IN COALESCE(c.on_branches, []))
      AND (c.description IS NULL OR c.description = "")
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
    result = session.run(query, graph_id=graph_id, branch_id=branch_id, limit=limit)
    return [_normalize_concept_from_db(record.data()) for record in result]


def get_neighbors_for_nodes(session: Session, node_ids: List[str], include_proposed: str = "auto") -> dict:
    """
    Returns a mapping of node_id -> list of neighbor node_ids for building context.
    Properly scoped to graph, branch, excludes merged nodes, and respects visibility policy.
    
    Args:
        session: Neo4j session
        node_ids: List of concept node_ids
        include_proposed: Visibility policy for proposed edges:
            - "auto" (default): ACCEPTED + PROPOSED with confidence >= threshold
            - "all": ACCEPTED + all PROPOSED
            - "none": Only ACCEPTED
    """
    if not node_ids:
        return {}
    
    ensure_graph_scoping_initialized(session)
    graph_id, branch_id = get_active_graph_context(session)
    
    include_proposed = _normalize_include_proposed(include_proposed)
    edge_visibility_clause = _build_edge_visibility_where_clause(include_proposed)
    
    params = {
        "node_ids": node_ids,
        "graph_id": graph_id,
        "branch_id": branch_id,
        "include_proposed": include_proposed,
        "threshold": PROPOSED_VISIBILITY_THRESHOLD,
    }
    
    query = f"""
    MATCH (g:GraphSpace {{graph_id: $graph_id}})
    MATCH (c:Concept {{graph_id: $graph_id}})-[:BELONGS_TO]->(g)
    WHERE c.node_id IN $node_ids
      AND $branch_id IN COALESCE(c.on_branches, [])
      AND COALESCE(c.is_merged, false) = false
    MATCH (c)-[r]-(n:Concept {{graph_id: $graph_id}})-[:BELONGS_TO]->(g)
    WHERE $branch_id IN COALESCE(n.on_branches, [])
      AND $branch_id IN COALESCE(r.on_branches, [])
      AND COALESCE(n.is_merged, false) = false
      AND {edge_visibility_clause}
    RETURN c.node_id AS source_id, collect(DISTINCT n.node_id) AS neighbor_ids
    """
    result = session.run(query, **params)
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

def get_cross_graph_instances(session: Session, node_id: str) -> Dict[str, Any]:
    """
    Find all instances of a concept across all graphs by matching the concept name.
    Returns instances from all graphs where a concept with the same name exists.
    
    Args:
        session: Neo4j session
        node_id: The node_id of the concept to find cross-graph instances for
    
    Returns:
        Dict with concept_name and list of instances across graphs
    """
    # First, get the concept name from the given node_id
    query_get_name = """
    MATCH (c:Concept {node_id: $node_id})
    RETURN c.name AS name
    LIMIT 1
    """
    result = session.run(query_get_name, node_id=node_id)
    record = result.single()
    if not record:
        return {"concept_name": "", "instances": [], "total_instances": 0}
    
    concept_name = record["name"]
    
    # Now find all instances with the same name across all graphs
    query_find_instances = """
    MATCH (c:Concept {name: $concept_name})
    MATCH (c)-[:BELONGS_TO]->(g:GraphSpace)
    RETURN c.node_id AS node_id,
           c.name AS name,
           c.domain AS domain,
           c.type AS type,
           c.description AS description,
           c.graph_id AS graph_id,
           g.name AS graph_name,
           c.created_by AS created_by,
           c.last_updated_by AS last_updated_by
    ORDER BY g.name, c.node_id
    """
    
    result = session.run(query_find_instances, concept_name=concept_name)
    instances = []
    for record in result:
        instances.append({
            "node_id": record["node_id"],
            "name": record["name"],
            "domain": record["domain"],
            "type": record["type"],
            "description": record["description"],
            "graph_id": record["graph_id"],
            "graph_name": record["graph_name"] or record["graph_id"],
            "created_by": record["created_by"],
            "last_updated_by": record["last_updated_by"],
        })
    
    return {
        "concept_name": concept_name,
        "instances": instances,
        "total_instances": len(instances)
    }


def link_cross_graph_instances(
    session: Session,
    source_node_id: str,
    target_node_id: str,
    link_type: str = "user_linked",
    linked_by: Optional[str] = None
) -> Dict[str, Any]:
    """
    Create a bidirectional CROSS_GRAPH_LINK relationship between two concept instances
    in different graphs. This allows users to explicitly link related concepts across graphs.
    
    Args:
        session: Neo4j session
        source_node_id: Node ID of first concept instance
        target_node_id: Node ID of second concept instance
        link_type: Type of link ("user_linked", "manual_merge", "auto_detected")
        linked_by: User identifier who created the link
    
    Returns:
        Dict with link information
    """
    from datetime import datetime
    
    # Verify both nodes exist and are in different graphs
    query_verify = """
    MATCH (c1:Concept {node_id: $source_node_id})
    MATCH (c2:Concept {node_id: $target_node_id})
    RETURN c1.graph_id AS source_graph_id,
           c2.graph_id AS target_graph_id,
           c1.name AS source_name,
           c2.name AS target_name
    """
    result = session.run(query_verify, source_node_id=source_node_id, target_node_id=target_node_id)
    record = result.single()
    
    if not record:
        raise ValueError("One or both concepts not found")
    
    if record["source_graph_id"] == record["target_graph_id"]:
        raise ValueError("Cannot link concepts in the same graph")
    
    if record["source_name"] != record["target_name"]:
        raise ValueError("Cannot link concepts with different names")
    
    # Create bidirectional CROSS_GRAPH_LINK relationship
    query_link = """
    MATCH (c1:Concept {node_id: $source_node_id})
    MATCH (c2:Concept {node_id: $target_node_id})
    MERGE (c1)-[r:CROSS_GRAPH_LINK]-(c2)
    SET r.link_type = $link_type,
        r.linked_at = $linked_at,
        r.linked_by = $linked_by
    RETURN r
    """
    
    linked_at = utcnow_iso()
    session.run(
        query_link,
        source_node_id=source_node_id,
        target_node_id=target_node_id,
        link_type=link_type,
        linked_at=linked_at,
        linked_by=linked_by or "system"
    )
    
    return {
        "source_node_id": source_node_id,
        "target_node_id": target_node_id,
        "source_graph_id": record["source_graph_id"],
        "target_graph_id": record["target_graph_id"],
        "link_type": link_type,
        "linked_at": linked_at,
        "linked_by": linked_by or "system"
    }


def get_linked_cross_graph_instances(session: Session, node_id: str) -> List[Dict[str, Any]]:
    """
    Get all cross-graph instances that are explicitly linked via CROSS_GRAPH_LINK relationships.
    
    Args:
        session: Neo4j session
        node_id: Node ID to find linked instances for
    
    Returns:
        List of linked instances with link metadata
    """
    query = """
    MATCH (c:Concept {node_id: $node_id})-[r:CROSS_GRAPH_LINK]-(linked:Concept)
    MATCH (linked)-[:BELONGS_TO]->(g:GraphSpace)
    RETURN linked.node_id AS node_id,
           linked.name AS name,
           linked.domain AS domain,
           linked.type AS type,
           linked.description AS description,
           linked.graph_id AS graph_id,
           g.name AS graph_name,
           r.link_type AS link_type,
           r.linked_at AS linked_at,
           r.linked_by AS linked_by
    ORDER BY g.name
    """
    
    result = session.run(query, node_id=node_id)
    instances = []
    for record in result:
        instances.append({
            "node_id": record["node_id"],
            "name": record["name"],
            "domain": record["domain"],
            "type": record["type"],
            "description": record["description"],
            "graph_id": record["graph_id"],
            "graph_name": record["graph_name"] or record["graph_id"],
            "link_type": record["link_type"],
            "linked_at": record["linked_at"],
            "linked_by": record["linked_by"],
        })
    
    return instances


def update_concept_mastery(
    session: Session,
    graph_id: str,
    node_id: str,
    mastery_level: int
) -> bool:
    """
    Update the mastery level for a concept.
    
    Args:
        session: Neo4j session
        graph_id: Graph ID
        node_id: Concept node ID
        mastery_level: New mastery level (0-100)
    
    Returns:
        True if updated, False otherwise
    """
    ensure_graph_scoping_initialized(session)
    
    now_ts = utcnow_ms()
    
    query = """
    MATCH (g:GraphSpace {graph_id: $graph_id})
    MATCH (n:Concept {graph_id: $graph_id})-[:BELONGS_TO]->(g)
    WHERE n.node_id = $node_id
    SET n.mastery_level = $mastery_level,
        n.last_assessed = $now_ts
    RETURN count(n) AS count
    """
    
    result = session.run(
        query,
        graph_id=graph_id,
        node_id=node_id,
        mastery_level=mastery_level,
        now_ts=now_ts
    )
    
    record = result.single()
    return record["count"] > 0 if record else False


def get_concept_mastery(session: Session, graph_id: str, concept_name: str) -> int:
    """
    Fetch the current mastery score for a concept by name.
    """
    query = """
    MATCH (g:GraphSpace {id: $graph_id})-[:CONTAINS]->(c:Concept)
    WHERE toLower(c.name) = toLower($name)
    RETURN c.mastery_score as score
    LIMIT 1
    """
    result = session.run(query, graph_id=graph_id, name=concept_name).single()
    
    if result and result["score"] is not None:
        return int(result["score"])
    return 0

