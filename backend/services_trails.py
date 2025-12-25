"""
Service for Trails: Session paths and visual reasoning layer.

Phase 4: Lightweight navigation layer on top of the knowledge graph.
"""
from typing import List, Dict, Any, Optional
from neo4j import Session
from uuid import uuid4
import datetime

from services_branch_explorer import (
    ensure_graph_scoping_initialized,
    get_active_graph_context,
)


def create_trail(
    session: Session,
    graph_id: str,
    branch_id: str,
    title: str,
    pinned: bool = False
) -> Dict[str, Any]:
    """
    Create a new Trail node.
    
    Args:
        session: Neo4j session
        graph_id: Graph ID for scoping
        branch_id: Branch ID for scoping
        title: Trail title
        pinned: Whether trail is pinned
    
    Returns:
        dict with trail_id, title, status, created_at
    """
    ensure_graph_scoping_initialized(session)
    
    trail_id = f"TRAIL_{uuid4().hex[:16].upper()}"
    now_ts = int(datetime.datetime.utcnow().timestamp() * 1000)  # milliseconds
    
    query = """
    MATCH (g:GraphSpace {graph_id: $graph_id})
    MERGE (t:Trail {graph_id: $graph_id, trail_id: $trail_id})
    ON CREATE SET
        t.title = $title,
        t.status = $status,
        t.pinned = $pinned,
        t.on_branches = [$branch_id],
        t.created_at = $now_ts,
        t.updated_at = $now_ts
    ON MATCH SET
        t.title = $title,
        t.status = $status,
        t.pinned = $pinned,
        t.on_branches = CASE
            WHEN t.on_branches IS NULL THEN [$branch_id]
            WHEN $branch_id IN t.on_branches THEN t.on_branches
            ELSE t.on_branches + $branch_id
        END,
        t.updated_at = $now_ts
    MERGE (t)-[:BELONGS_TO]->(g)
    RETURN t.trail_id AS trail_id,
           t.title AS title,
           t.status AS status,
           t.created_at AS created_at
    """
    result = session.run(
        query,
        graph_id=graph_id,
        branch_id=branch_id,
        trail_id=trail_id,
        title=title,
        status="active",
        pinned=pinned,
        now_ts=now_ts
    )
    record = result.single()
    if not record:
        raise ValueError(f"Failed to create Trail {trail_id}")
    return record.data()


def append_step(
    session: Session,
    graph_id: str,
    branch_id: str,
    trail_id: str,
    kind: str,
    ref_id: str,
    title: Optional[str] = None,
    note: Optional[str] = None,
    meta: Optional[Dict[str, Any]] = None
) -> Dict[str, Any]:
    """
    Append a TrailStep to a Trail.
    
    Args:
        session: Neo4j session
        graph_id: Graph ID for scoping
        branch_id: Branch ID for scoping
        trail_id: Trail ID
        kind: Step kind ("page"|"quote"|"concept"|"claim"|"search")
        ref_id: Reference ID (URL, quote_id, concept_id, claim_id, or query string)
        title: Optional step title
        note: Optional note
        meta: Optional metadata dict
    
    Returns:
        dict with step_id, index
    """
    ensure_graph_scoping_initialized(session)
    
    # Get current max index for this trail
    max_index_query = """
    MATCH (t:Trail {graph_id: $graph_id, trail_id: $trail_id})
    WHERE $branch_id IN COALESCE(t.on_branches, [])
    OPTIONAL MATCH (t)-[:HAS_STEP]->(s:TrailStep {graph_id: $graph_id})
    WHERE $branch_id IN COALESCE(s.on_branches, [])
    RETURN COALESCE(MAX(s.index), -1) AS max_index
    """
    max_result = session.run(
        max_index_query,
        graph_id=graph_id,
        branch_id=branch_id,
        trail_id=trail_id
    )
    max_record = max_result.single()
    next_index = (max_record.data().get("max_index", -1) + 1) if max_record else 0
    
    step_id = f"STEP_{uuid4().hex[:16].upper()}"
    now_ts = int(datetime.datetime.utcnow().timestamp() * 1000)
    
    # Create step
    query = """
    MATCH (t:Trail {graph_id: $graph_id, trail_id: $trail_id})
    WHERE $branch_id IN COALESCE(t.on_branches, [])
    MERGE (s:TrailStep {graph_id: $graph_id, step_id: $step_id})
    ON CREATE SET
        s.trail_id = $trail_id,
        s.index = $index,
        s.kind = $kind,
        s.ref_id = $ref_id,
        s.title = $title,
        s.note = $note,
        s.meta = $meta,
        s.on_branches = [$branch_id],
        s.created_at = $now_ts
    ON MATCH SET
        s.trail_id = $trail_id,
        s.index = $index,
        s.kind = $kind,
        s.ref_id = $ref_id,
        s.title = $title,
        s.note = $note,
        s.meta = $meta,
        s.on_branches = CASE
            WHEN s.on_branches IS NULL THEN [$branch_id]
            WHEN $branch_id IN s.on_branches THEN s.on_branches
            ELSE s.on_branches + $branch_id
        END
    MERGE (t)-[:HAS_STEP]->(s)
    WITH t, s
    SET t.updated_at = $now_ts
    RETURN s.step_id AS step_id,
           s.index AS index
    """
    result = session.run(
        query,
        graph_id=graph_id,
        branch_id=branch_id,
        trail_id=trail_id,
        step_id=step_id,
        index=next_index,
        kind=kind,
        ref_id=ref_id,
        title=title,
        note=note,
        meta=meta,
        now_ts=now_ts
    )
    record = result.single()
    if not record:
        raise ValueError(f"Failed to append step to Trail {trail_id}")
    
    # Optionally create reference relationships
    _create_step_references(session, graph_id, branch_id, step_id, kind, ref_id)
    
    return record.data()


def _create_step_references(
    session: Session,
    graph_id: str,
    branch_id: str,
    step_id: str,
    kind: str,
    ref_id: str
) -> None:
    """Create REFERENCES relationships from TrailStep to graph nodes where possible."""
    if kind == "quote":
        query = """
        MATCH (s:TrailStep {graph_id: $graph_id, step_id: $step_id})
        MATCH (q:Quote {graph_id: $graph_id, quote_id: $ref_id})
        WHERE $branch_id IN COALESCE(s.on_branches, [])
          AND $branch_id IN COALESCE(q.on_branches, [])
        MERGE (s)-[:REFERENCES]->(q)
        """
        session.run(query, graph_id=graph_id, branch_id=branch_id, step_id=step_id, ref_id=ref_id)
    elif kind == "concept":
        query = """
        MATCH (s:TrailStep {graph_id: $graph_id, step_id: $step_id})
        MATCH (c:Concept {graph_id: $graph_id, node_id: $ref_id})
        WHERE $branch_id IN COALESCE(s.on_branches, [])
          AND $branch_id IN COALESCE(c.on_branches, [])
        MERGE (s)-[:REFERENCES]->(c)
        """
        session.run(query, graph_id=graph_id, branch_id=branch_id, step_id=step_id, ref_id=ref_id)
    elif kind == "claim":
        query = """
        MATCH (s:TrailStep {graph_id: $graph_id, step_id: $step_id})
        MATCH (cl:Claim {graph_id: $graph_id, claim_id: $ref_id})
        WHERE $branch_id IN COALESCE(s.on_branches, [])
          AND $branch_id IN COALESCE(cl.on_branches, [])
        MERGE (s)-[:REFERENCES]->(cl)
        """
        session.run(query, graph_id=graph_id, branch_id=branch_id, step_id=step_id, ref_id=ref_id)
    elif kind == "page":
        # Try to match SourceDocument by URL
        query = """
        MATCH (s:TrailStep {graph_id: $graph_id, step_id: $step_id})
        MATCH (d:SourceDocument {graph_id: $graph_id, url: $ref_id})
        WHERE $branch_id IN COALESCE(s.on_branches, [])
          AND $branch_id IN COALESCE(d.on_branches, [])
        MERGE (s)-[:REFERENCES]->(d)
        """
        session.run(query, graph_id=graph_id, branch_id=branch_id, step_id=step_id, ref_id=ref_id)


def get_trail(
    session: Session,
    graph_id: str,
    branch_id: str,
    trail_id: str
) -> Dict[str, Any]:
    """
    Get a trail with all its steps, ordered by index.
    
    Args:
        session: Neo4j session
        graph_id: Graph ID for scoping
        branch_id: Branch ID for scoping
        trail_id: Trail ID
    
    Returns:
        dict with trail info and ordered steps
    """
    ensure_graph_scoping_initialized(session)
    
    query = """
    MATCH (t:Trail {graph_id: $graph_id, trail_id: $trail_id})
    WHERE $branch_id IN COALESCE(t.on_branches, [])
    OPTIONAL MATCH (t)-[:HAS_STEP]->(s:TrailStep {graph_id: $graph_id})
    WHERE $branch_id IN COALESCE(s.on_branches, [])
    RETURN t.trail_id AS trail_id,
           t.title AS title,
           t.status AS status,
           t.pinned AS pinned,
           t.created_at AS created_at,
           t.updated_at AS updated_at,
           collect({
               step_id: s.step_id,
               index: s.index,
               kind: s.kind,
               ref_id: s.ref_id,
               title: s.title,
               note: s.note,
               meta: s.meta,
               created_at: s.created_at
           }) AS steps
    ORDER BY s.index
    """
    result = session.run(query, graph_id=graph_id, branch_id=branch_id, trail_id=trail_id)
    record = result.single()
    if not record:
        return {}
    
    data = record.data()
    # Sort steps by index (in case ordering is off)
    steps = sorted([s for s in data.get("steps", []) if s.get("step_id")], key=lambda x: x.get("index", 0))
    
    return {
        "trail_id": data.get("trail_id"),
        "title": data.get("title"),
        "status": data.get("status"),
        "pinned": data.get("pinned", False),
        "created_at": data.get("created_at"),
        "updated_at": data.get("updated_at"),
        "steps": steps,
    }


def archive_trail(
    session: Session,
    graph_id: str,
    branch_id: str,
    trail_id: str
) -> Dict[str, Any]:
    """Archive a trail (set status to 'archived')."""
    ensure_graph_scoping_initialized(session)
    now_ts = int(datetime.datetime.utcnow().timestamp() * 1000)
    
    query = """
    MATCH (t:Trail {graph_id: $graph_id, trail_id: $trail_id})
    WHERE $branch_id IN COALESCE(t.on_branches, [])
    SET t.status = 'archived',
        t.updated_at = $now_ts
    RETURN t.trail_id AS trail_id,
           t.status AS status
    """
    result = session.run(query, graph_id=graph_id, branch_id=branch_id, trail_id=trail_id, now_ts=now_ts)
    record = result.single()
    if not record:
        raise ValueError(f"Trail {trail_id} not found")
    return record.data()


def resume_trail(
    session: Session,
    graph_id: str,
    branch_id: str,
    trail_id: str
) -> Dict[str, Any]:
    """Resume a trail (set status to 'active' and return last step)."""
    ensure_graph_scoping_initialized(session)
    now_ts = int(datetime.datetime.utcnow().timestamp() * 1000)
    
    query = """
    MATCH (t:Trail {graph_id: $graph_id, trail_id: $trail_id})
    WHERE $branch_id IN COALESCE(t.on_branches, [])
    OPTIONAL MATCH (t)-[:HAS_STEP]->(s:TrailStep {graph_id: $graph_id})
    WHERE $branch_id IN COALESCE(s.on_branches, [])
    WITH t, s
    ORDER BY s.index DESC
    LIMIT 1
    SET t.status = 'active',
        t.updated_at = $now_ts
    RETURN t.trail_id AS trail_id,
           t.status AS status,
           s.step_id AS last_step_id,
           s.index AS last_step_index,
           s.kind AS last_step_kind,
           s.ref_id AS last_step_ref_id
    """
    result = session.run(query, graph_id=graph_id, branch_id=branch_id, trail_id=trail_id, now_ts=now_ts)
    record = result.single()
    if not record:
        raise ValueError(f"Trail {trail_id} not found")
    return record.data()


def trail_to_subgraph(
    session: Session,
    graph_id: str,
    branch_id: str,
    trail_id: str,
    max_nodes: int = 50,
    max_edges: int = 100
) -> Dict[str, Any]:
    """
    Convert a trail to a subgraph (nodes and edges).
    
    Rules:
    - Start from referenced Concept nodes in the trail
    - Include their Quotes and Claims (evidence) up to caps
    - Include Concept–Concept edges that exist in the graph
    - Do NOT call LLM (deterministic materialization)
    
    Args:
        session: Neo4j session
        graph_id: Graph ID for scoping
        branch_id: Branch ID for scoping
        trail_id: Trail ID
        max_nodes: Maximum nodes to return
        max_edges: Maximum edges to return
    
    Returns:
        dict with nodes, edges, and included_step_ids
    """
    ensure_graph_scoping_initialized(session)
    
    # Get all concept IDs referenced in trail steps
    concept_refs_query = """
    MATCH (t:Trail {graph_id: $graph_id, trail_id: $trail_id})
    WHERE $branch_id IN COALESCE(t.on_branches, [])
    MATCH (t)-[:HAS_STEP]->(s:TrailStep {graph_id: $graph_id})
    WHERE $branch_id IN COALESCE(s.on_branches, [])
      AND s.kind = 'concept'
    RETURN DISTINCT s.ref_id AS concept_id,
           s.step_id AS step_id
    """
    concept_refs = session.run(concept_refs_query, graph_id=graph_id, branch_id=branch_id, trail_id=trail_id)
    concept_ids = [record.data()["concept_id"] for record in concept_refs]
    
    if not concept_ids:
        return {"nodes": [], "edges": [], "included_step_ids": []}
    
    # Build subgraph query
    # Start with concepts, then expand to quotes, claims, and relationships
    subgraph_query = """
    MATCH (g:GraphSpace {graph_id: $graph_id})
    // Get referenced concepts
    MATCH (c:Concept {graph_id: $graph_id})
    WHERE c.node_id IN $concept_ids
      AND $branch_id IN COALESCE(c.on_branches, [])
    
    // Get quotes attached to these concepts
    OPTIONAL MATCH (c)-[:HAS_QUOTE]->(q:Quote {graph_id: $graph_id})
    WHERE $branch_id IN COALESCE(q.on_branches, [])
    
    // Get claims supported by these concepts
    OPTIONAL MATCH (c)-[:SUPPORTED_BY]->(cl:Claim {graph_id: $graph_id})
    WHERE $branch_id IN COALESCE(cl.on_branches, [])
    
    // Get concept-concept relationships
    OPTIONAL MATCH (c)-[r]->(c2:Concept {graph_id: $graph_id})
    WHERE $branch_id IN COALESCE(c2.on_branches, [])
      AND $branch_id IN COALESCE(r.on_branches, [])
      AND c2.node_id IN $concept_ids
    
    // Get claims' evidence quotes
    OPTIONAL MATCH (cl)-[:EVIDENCED_BY]->(q2:Quote {graph_id: $graph_id})
    WHERE $branch_id IN COALESCE(q2.on_branches, [])
    
    WITH c, q, cl, c2, r, q2
    LIMIT $max_nodes
    
    RETURN DISTINCT
        collect(DISTINCT {
            id: c.node_id,
            label: 'Concept',
            name: c.name,
            description: c.description,
            domain: c.domain
        }) AS concepts,
        collect(DISTINCT {
            id: q.quote_id,
            label: 'Quote',
            text: q.text,
            quote_id: q.quote_id
        }) AS quotes,
        collect(DISTINCT {
            id: cl.claim_id,
            label: 'Claim',
            text: cl.text,
            claim_id: cl.claim_id,
            confidence: cl.confidence
        }) AS claims,
        collect(DISTINCT {
            id: q2.quote_id,
            label: 'Quote',
            text: q2.text,
            quote_id: q2.quote_id
        }) AS evidence_quotes
    """
    
    result = session.run(
        subgraph_query,
        graph_id=graph_id,
        branch_id=branch_id,
        concept_ids=concept_ids,
        max_nodes=max_nodes
    )
    record = result.single()
    if not record:
        return {"nodes": [], "edges": [], "included_step_ids": []}
    
    data = record.data()
    nodes = []
    node_ids = set()
    
    # Add concepts
    for concept in data.get("concepts", []):
        if concept.get("id") and concept["id"] not in node_ids:
            nodes.append(concept)
            node_ids.add(concept["id"])
    
    # Add quotes
    for quote in data.get("quotes", []):
        if quote.get("id") and quote["id"] not in node_ids:
            nodes.append(quote)
            node_ids.add(quote["id"])
    
    # Add evidence quotes
    for quote in data.get("evidence_quotes", []):
        if quote.get("id") and quote["id"] not in node_ids:
            nodes.append(quote)
            node_ids.add(quote["id"])
    
    # Add claims
    for claim in data.get("claims", []):
        if claim.get("id") and claim["id"] not in node_ids:
            nodes.append(claim)
            node_ids.add(claim["id"])
    
    # Cap nodes
    nodes = nodes[:max_nodes]
    
    # Get edges
    edges_query = """
    MATCH (g:GraphSpace {graph_id: $graph_id})
    MATCH (source)-[r]->(target)
    WHERE source.graph_id = $graph_id
      AND target.graph_id = $graph_id
      AND $branch_id IN COALESCE(source.on_branches, [])
      AND $branch_id IN COALESCE(target.on_branches, [])
      AND $branch_id IN COALESCE(r.on_branches, [])
      AND (
        (source:Concept AND source.node_id IN $concept_ids AND target:Concept AND target.node_id IN $concept_ids)
        OR (source:Concept AND source.node_id IN $concept_ids AND target:Quote)
        OR (source:Concept AND source.node_id IN $concept_ids AND target:Claim)
        OR (source:Claim AND target:Quote)
      )
    RETURN DISTINCT
        CASE
            WHEN source:Concept THEN source.node_id
            WHEN source:Claim THEN source.claim_id
            WHEN source:Quote THEN source.quote_id
        END AS source_id,
        CASE
            WHEN target:Concept THEN target.node_id
            WHEN target:Claim THEN target.claim_id
            WHEN target:Quote THEN target.quote_id
        END AS target_id,
        type(r) AS relationship_type,
        COALESCE(r.confidence, 0.0) AS confidence,
        r.justification AS justification,
        r.rationale AS rationale
    LIMIT $max_edges
    """
    
    edges_result = session.run(
        edges_query,
        graph_id=graph_id,
        branch_id=branch_id,
        concept_ids=concept_ids,
        max_edges=max_edges
    )
    
    edges = []
    for edge_record in edges_result:
        edge_data = edge_record.data()
        edges.append({
            "source_id": edge_data.get("source_id"),
            "target_id": edge_data.get("target_id"),
            "relationship_type": edge_data.get("relationship_type"),
            "confidence": edge_data.get("confidence"),
            "justification": edge_data.get("justification") or edge_data.get("rationale"),
        })
    
    edges = edges[:max_edges]
    
    # Get step IDs that contributed to this subgraph
    step_ids_query = """
    MATCH (t:Trail {graph_id: $graph_id, trail_id: $trail_id})
    WHERE $branch_id IN COALESCE(t.on_branches, [])
    MATCH (t)-[:HAS_STEP]->(s:TrailStep {graph_id: $graph_id})
    WHERE $branch_id IN COALESCE(s.on_branches, [])
      AND (
        (s.kind = 'concept' AND s.ref_id IN $concept_ids)
        OR (s.kind = 'quote' AND s.ref_id IN [q.quote_id | q IN $quotes])
        OR (s.kind = 'claim' AND s.ref_id IN [c.claim_id | c IN $claims])
      )
    RETURN collect(DISTINCT s.step_id) AS step_ids
    """
    
    # Extract quote and claim IDs from nodes
    quote_ids = [n["id"] for n in nodes if n.get("label") == "Quote"]
    claim_ids = [n["id"] for n in nodes if n.get("label") == "Claim"]
    
    step_ids_result = session.run(
        step_ids_query,
        graph_id=graph_id,
        branch_id=branch_id,
        trail_id=trail_id,
        concept_ids=concept_ids,
        quotes=[{"quote_id": qid} for qid in quote_ids],
        claims=[{"claim_id": cid} for cid in claim_ids]
    )
    step_ids_record = step_ids_result.single()
    included_step_ids = step_ids_record.data().get("step_ids", []) if step_ids_record else []
    
    return {
        "nodes": nodes,
        "edges": edges,
        "included_step_ids": included_step_ids,
    }

