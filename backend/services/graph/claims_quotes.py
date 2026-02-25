"""
Source chunks, claims, quotes, evidence subgraph (GraphRAG).
"""
import json
from typing import List, Optional, Dict, Any

from neo4j import Session

from services_branch_explorer import ensure_graph_scoping_initialized, get_active_graph_context
from services_graph_helpers import (
    build_edge_visibility_where_clause as _build_edge_visibility_where_clause,
    normalize_include_proposed as _normalize_include_proposed,
)
from config import PROPOSED_VISIBILITY_THRESHOLD
from utils.timestamp import utcnow_ms


def upsert_source_chunk(
    session: Session,
    graph_id: str,
    branch_id: str,
    chunk_id: str,
    source_id: str,
    chunk_index: int,
    text: str,
    metadata: Optional[Dict[str, Any]] = None
) -> dict:
    """
    Create or update a SourceChunk node.
    
    Args:
        session: Neo4j session
        graph_id: Graph ID for scoping
        branch_id: Branch ID for scoping
        chunk_id: Unique chunk identifier
        source_id: Source identifier (e.g., lecture_id)
        chunk_index: Index of chunk within source
        text: Chunk text content
        metadata: Optional metadata dict (will be JSON stringified)
    
    Returns:
        dict with chunk_id and basic fields
    """
    ensure_graph_scoping_initialized(session)
    
    metadata_str = json.dumps(metadata) if metadata else None
    
    query = """
    MATCH (g:GraphSpace {graph_id: $graph_id})
    MERGE (s:SourceChunk {graph_id: $graph_id, chunk_id: $chunk_id})
    ON CREATE SET
        s.source_id = $source_id,
        s.chunk_index = $chunk_index,
        s.text = $text,
        s.metadata = $metadata,
        s.on_branches = [$branch_id],
        s.created_at = timestamp()
    ON MATCH SET
        s.source_id = $source_id,
        s.chunk_index = $chunk_index,
        s.text = $text,
        s.metadata = $metadata,
        s.on_branches = CASE
            WHEN s.on_branches IS NULL THEN [$branch_id]
            WHEN $branch_id IN s.on_branches THEN s.on_branches
            ELSE s.on_branches + $branch_id
        END,
        s.updated_at = timestamp()
    MERGE (s)-[:BELONGS_TO]->(g)
    WITH s, g
    // Create FROM_DOCUMENT relationship if source_id matches a SourceDocument
    OPTIONAL MATCH (d:SourceDocument {graph_id: $graph_id, doc_id: $source_id})
    WITH s, g, d
    FOREACH (x IN CASE WHEN d IS NOT NULL THEN [1] ELSE [] END |
        MERGE (s)-[:FROM_DOCUMENT]->(d)
    )
    RETURN s.chunk_id AS chunk_id,
           s.source_id AS source_id,
           s.chunk_index AS chunk_index
    """
    result = session.run(
        query,
        graph_id=graph_id,
        branch_id=branch_id,
        chunk_id=chunk_id,
        source_id=source_id,
        chunk_index=chunk_index,
        text=text,
        metadata=metadata_str
    )
    record = result.single()
    if not record:
        raise ValueError(f"Failed to create/update SourceChunk {chunk_id}")
    return record.data()


def upsert_claim(
    session: Session,
    graph_id: str,
    branch_id: str,
    claim_id: str,
    text: str,
    confidence: float,
    method: str,
    source_id: str,
    source_span: str,
    chunk_id: str,
    embedding: Optional[List[float]] = None,
    ingestion_run_id: Optional[str] = None,
    status: Optional[str] = None,
    evidence_ids: Optional[List[str]] = None,
    session_id: Optional[str] = None,
) -> dict:
    """
    Create or update a Claim node and link it to SourceChunk.
    
    Args:
        session: Neo4j session
        graph_id: Graph ID for scoping
        branch_id: Branch ID for scoping
        claim_id: Unique claim identifier
        text: Claim text
        confidence: Confidence score (0-1)
        method: Extraction method (e.g., "llm", "manual")
        source_id: Source identifier
        source_span: Source span description
        chunk_id: Chunk ID this claim is supported by
        embedding: Optional embedding vector
        ingestion_run_id: Optional ingestion run ID that created this claim
        status: Claim status ("PROPOSED", "VERIFIED", "REJECTED"). Defaults to "PROPOSED"
        evidence_ids: Optional list of evidence IDs (quote_ids, chunk_ids, etc.)
    
    Returns:
        dict with claim_id and basic fields
    """
    ensure_graph_scoping_initialized(session)
    
    # Default status to PROPOSED if not provided
    claim_status = status or "PROPOSED"
    
    # Build evidence_ids array (include chunk_id and any additional evidence)
    evidence_list = [chunk_id]
    if evidence_ids:
        evidence_list.extend(evidence_ids)
    # Deduplicate
    evidence_list = list(dict.fromkeys(evidence_list))  # Preserves order while deduplicating
    
    query = """
    MATCH (g:GraphSpace {graph_id: $graph_id})
    MERGE (c:Claim {graph_id: $graph_id, claim_id: $claim_id})
    ON CREATE SET
        c.text = $text,
        c.confidence = $confidence,
        c.method = $method,
        c.source_id = $source_id,
        c.source_span = $source_span,
        c.embedding = $embedding,
        c.ingestion_run_id = $ingestion_run_id,
        c.status = $status,
        c.evidence_ids = $evidence_ids,
        c.on_branches = [$branch_id],
        c.created_at = timestamp()
    ON MATCH SET
        c.text = $text,
        c.confidence = $confidence,
        c.method = $method,
        c.source_id = $source_id,
        c.source_span = $source_span,
        c.embedding = $embedding,
        c.ingestion_run_id = COALESCE(c.ingestion_run_id, $ingestion_run_id),
        c.status = COALESCE(c.status, $status),
        c.evidence_ids = CASE
            WHEN $evidence_ids IS NOT NULL THEN $evidence_ids
            WHEN c.evidence_ids IS NULL THEN $evidence_ids
            ELSE c.evidence_ids
        END,
        c.on_branches = CASE
            WHEN c.on_branches IS NULL THEN [$branch_id]
            WHEN $branch_id IN c.on_branches THEN c.on_branches
            ELSE c.on_branches + $branch_id
        END,
        c.updated_at = timestamp()
    MERGE (c)-[:BELONGS_TO]->(g)
    WITH c, g
    MATCH (s:SourceChunk {graph_id: $graph_id, chunk_id: $chunk_id})
    MERGE (c)-[:SUPPORTED_BY]->(s)
    RETURN c.claim_id AS claim_id,
           c.text AS text,
           c.confidence AS confidence,
           c.status AS status,
           c.evidence_ids AS evidence_ids
    """
    result = session.run(
        query,
        graph_id=graph_id,
        branch_id=branch_id,
        claim_id=claim_id,
        text=text,
        confidence=confidence,
        method=method,
        source_id=source_id,
        source_span=source_span,
        chunk_id=chunk_id,
        embedding=embedding,
        ingestion_run_id=ingestion_run_id,
        status=claim_status,
        evidence_ids=evidence_list,
    )
    record = result.single()
    if not record:
        raise ValueError(f"Failed to create/update Claim {claim_id}")
    
    # Emit event for claim upsert
    try:
        from events.emitter import emit_event
        from events.schema import EventType, ObjectRef
        from projectors.session_context import SessionContextProjector
        
        # Use provided session_id or fallback
        event_session_id = session_id or getattr(session, '_session_id', None) or "unknown"
        
        # Emit event
        emit_event(
            event_type=EventType.CLAIM_UPSERTED,
            session_id=event_session_id,
            object_ref=ObjectRef(type="claim", id=claim_id),
            payload={
                "claim_id": claim_id,
                "text": text[:200],  # Truncate for payload
                "confidence": confidence,
                "method": method,
                "source_id": source_id,
                "concept_ids": [],  # Could be extracted from claim mentions if needed
            },
        )
        
        # Projection is now handled asynchronously via background task queue
        # No need to update synchronously here
    except Exception:
        pass  # Don't fail on event emission
    
    return record.data()


def link_claim_mentions(
    session: Session,
    graph_id: str,
    claim_id: str,
    mentioned_node_ids: List[str]
) -> None:
    """
    Link a Claim to Concept nodes it mentions.
    
    Args:
        session: Neo4j session
        graph_id: Graph ID for scoping
        claim_id: Claim identifier
        mentioned_node_ids: List of Concept node_ids
    """
    if not mentioned_node_ids:
        return
    
    ensure_graph_scoping_initialized(session)
    
    query = """
    MATCH (c:Claim {graph_id: $graph_id, claim_id: $claim_id})
    UNWIND $mentioned_node_ids AS nid
    MATCH (x:Concept {graph_id: $graph_id, node_id: nid})
    MERGE (c)-[:MENTIONS]->(x)
    """
    session.run(
        query,
        graph_id=graph_id,
        claim_id=claim_id,
        mentioned_node_ids=mentioned_node_ids
    )


def upsert_quote(
    session: Session,
    graph_id: str,
    branch_id: str,
    quote_id: str,
    text: str,
    anchor: Dict[str, Any],
    source_doc_id: str,
    user_note: Optional[str] = None,
    tags: Optional[List[str]] = None,
    captured_at: Optional[int] = None
) -> dict:
    """
    Create or update a Quote node and link it to SourceDocument.
    
    Args:
        session: Neo4j session
        graph_id: Graph ID for scoping
        branch_id: Branch ID for scoping
        quote_id: Unique quote identifier
        text: Quote text content
        anchor: Anchor data (dict, stored as Neo4j map, not JSON string)
        source_doc_id: SourceDocument doc_id
        user_note: Optional user annotation
        tags: Optional tags list (stored as list[str], not JSON string)
        captured_at: Optional capture timestamp (defaults to now, Unix timestamp in ms)
    
    Returns:
        dict with quote_id, text, and captured_at
    """
    ensure_graph_scoping_initialized(session)
    
    if captured_at is None:
        captured_at = utcnow_ms()
    
    # Store anchor as Neo4j map (not JSON string)
    # Store tags as list[str] (not JSON string)
    query = """
    MATCH (g:GraphSpace {graph_id: $graph_id})
    MERGE (q:Quote {graph_id: $graph_id, quote_id: $quote_id})
    ON CREATE SET
        q.text = $text,
        q.anchor = $anchor,
        q.captured_at = $captured_at,
        q.user_note = $user_note,
        q.tags = $tags,
        q.on_branches = [$branch_id],
        q.created_at = timestamp()
    ON MATCH SET
        q.text = $text,
        q.anchor = $anchor,
        q.user_note = $user_note,
        q.tags = $tags,
        q.on_branches = CASE
            WHEN q.on_branches IS NULL THEN [$branch_id]
            WHEN $branch_id IN q.on_branches THEN q.on_branches
            ELSE q.on_branches + $branch_id
        END,
        q.updated_at = timestamp()
    MERGE (q)-[:BELONGS_TO]->(g)
    WITH q, g
    MATCH (d:SourceDocument {graph_id: $graph_id, doc_id: $source_doc_id})
    MERGE (q)-[:QUOTED_FROM]->(d)
    RETURN q.quote_id AS quote_id,
           q.text AS text,
           q.captured_at AS captured_at
    """
    result = session.run(
        query,
        graph_id=graph_id,
        branch_id=branch_id,
        quote_id=quote_id,
        text=text,
        anchor=anchor,  # Pass as dict, Neo4j driver will convert to map
        source_doc_id=source_doc_id,
        user_note=user_note,
        tags=tags,  # Pass as list, Neo4j driver will convert to list
        captured_at=captured_at
    )
    record = result.single()
    if not record:
        raise ValueError(f"Failed to create/update Quote {quote_id}")
    return record.data()


def link_concept_has_quote(
    session: Session,
    graph_id: str,
    branch_id: str,
    concept_id: str,
    quote_id: str
) -> None:
    """
    Create (Concept)-[:HAS_QUOTE]->(Quote) relationship.
    
    Args:
        session: Neo4j session
        graph_id: Graph ID for scoping
        branch_id: Branch ID for scoping
        concept_id: Concept node_id
        quote_id: Quote quote_id
    """
    ensure_graph_scoping_initialized(session)
    
    query = """
    MATCH (c:Concept {graph_id: $graph_id, node_id: $concept_id})
    MATCH (q:Quote {graph_id: $graph_id, quote_id: $quote_id})
    WHERE $branch_id IN COALESCE(c.on_branches, [])
      AND $branch_id IN COALESCE(q.on_branches, [])
    MERGE (c)-[:HAS_QUOTE]->(q)
    """
    session.run(query, graph_id=graph_id, branch_id=branch_id, concept_id=concept_id, quote_id=quote_id)


def link_concept_supported_by_claim(
    session: Session,
    graph_id: str,
    branch_id: str,
    concept_id: str,
    claim_id: str
) -> None:
    """
    Create (Concept)-[:SUPPORTED_BY]->(Claim) relationship.
    
    Args:
        session: Neo4j session
        graph_id: Graph ID for scoping
        branch_id: Branch ID for scoping
        concept_id: Concept node_id
        claim_id: Claim claim_id
    """
    ensure_graph_scoping_initialized(session)
    
    query = """
    MATCH (c:Concept {graph_id: $graph_id, node_id: $concept_id})
    MATCH (cl:Claim {graph_id: $graph_id, claim_id: $claim_id})
    WHERE $branch_id IN COALESCE(c.on_branches, [])
      AND $branch_id IN COALESCE(cl.on_branches, [])
    MERGE (c)-[:SUPPORTED_BY]->(cl)
    """
    session.run(query, graph_id=graph_id, branch_id=branch_id, concept_id=concept_id, claim_id=claim_id)


def link_claim_evidenced_by_quote(
    session: Session,
    graph_id: str,
    branch_id: str,
    claim_id: str,
    quote_id: str
) -> None:
    """
    Create (Claim)-[:EVIDENCED_BY]->(Quote) relationship and update evidence_ids.
    
    This is a required path for claim verification - quotes are the strongest evidence unit.
    
    Args:
        session: Neo4j session
        graph_id: Graph ID for scoping
        branch_id: Branch ID for scoping
        claim_id: Claim claim_id
        quote_id: Quote quote_id
    """
    ensure_graph_scoping_initialized(session)
    
    query = """
    MATCH (cl:Claim {graph_id: $graph_id, claim_id: $claim_id})
    MATCH (q:Quote {graph_id: $graph_id, quote_id: $quote_id})
    WHERE $branch_id IN COALESCE(cl.on_branches, [])
      AND $branch_id IN COALESCE(q.on_branches, [])
    MERGE (cl)-[:EVIDENCED_BY]->(q)
    WITH cl
    SET cl.evidence_ids = CASE
        WHEN cl.evidence_ids IS NULL THEN [$quote_id]
        WHEN $quote_id IN cl.evidence_ids THEN cl.evidence_ids
        ELSE cl.evidence_ids + $quote_id
    END
    """
    session.run(query, graph_id=graph_id, branch_id=branch_id, claim_id=claim_id, quote_id=quote_id)


def get_evidence_subgraph(
    session: Session,
    graph_id: str,
    claim_ids: List[str],
    max_concepts: int = 40,
    include_proposed: str = "auto"
) -> dict:
    """
    Get evidence subgraph: mentioned concepts + 1-hop neighbors.
    
    Args:
        session: Neo4j session
        graph_id: Graph ID for scoping
        claim_ids: List of claim IDs
        max_concepts: Maximum concepts to return
        include_proposed: Visibility policy for proposed edges:
            - "auto" (default): ACCEPTED + PROPOSED with confidence >= threshold
            - "all": ACCEPTED + all PROPOSED
            - "none": Only ACCEPTED
    
    Returns:
        dict with 'concepts' (list of Concept dicts) and 'edges' (list of relationship dicts)
    """
    ensure_graph_scoping_initialized(session)
    _, branch_id = get_active_graph_context(session)
    
    if not claim_ids:
        return {"concepts": [], "edges": []}
    
    include_proposed = _normalize_include_proposed(include_proposed)
    edge_visibility_clause = _build_edge_visibility_where_clause(include_proposed)
    
    params_base = {
        "graph_id": graph_id,
        "branch_id": branch_id,
        "include_proposed": include_proposed,
        "threshold": PROPOSED_VISIBILITY_THRESHOLD,
    }
    
    # Get mentioned concepts
    query_concepts = """
    MATCH (g:GraphSpace {graph_id: $graph_id})
    MATCH (claim:Claim {graph_id: $graph_id})-[:MENTIONS]->(c:Concept)-[:BELONGS_TO]->(g)
    WHERE claim.claim_id IN $claim_ids
      AND $branch_id IN COALESCE(c.on_branches, [])
      AND COALESCE(c.is_merged, false) = false
    WITH DISTINCT c
    LIMIT $max_concepts
    RETURN c.node_id AS node_id,
           c.name AS name,
           c.domain AS domain,
           c.type AS type,
           c.description AS description,
           c.tags AS tags
    """
    
    # Get 1-hop neighbors
    query_neighbors = f"""
    MATCH (g:GraphSpace {{graph_id: $graph_id}})
    MATCH (claim:Claim {{graph_id: $graph_id}})-[:MENTIONS]->(c:Concept)-[:BELONGS_TO]->(g)
    WHERE claim.claim_id IN $claim_ids
      AND $branch_id IN COALESCE(c.on_branches, [])
      AND COALESCE(c.is_merged, false) = false
    MATCH (c)-[r]-(n:Concept)-[:BELONGS_TO]->(g)
    WHERE $branch_id IN COALESCE(n.on_branches, [])
      AND $branch_id IN COALESCE(r.on_branches, [])
      AND COALESCE(n.is_merged, false) = false
      AND {edge_visibility_clause}
    WITH DISTINCT n, r, c
    LIMIT $max_concepts
    RETURN n.node_id AS node_id,
           n.name AS name,
           n.domain AS domain,
           n.type AS type,
           n.description AS description,
           n.tags AS tags,
           type(r) AS predicate,
           startNode(r).node_id = c.node_id AS is_outgoing
    """
    
    # Get mentioned concepts
    concept_result = session.run(
        query_concepts,
        **params_base,
        claim_ids=claim_ids,
        max_concepts=max_concepts
    )
    
    concepts = []
    concept_ids_seen = set()
    for record in concept_result:
        concept_ids_seen.add(record["node_id"])
        concepts.append({
            "node_id": record["node_id"],
            "name": record["name"],
            "domain": record["domain"],
            "type": record["type"],
            "description": record["description"],
            "tags": record["tags"],
        })
    
    # Get neighbors (only if we haven't hit the limit)
    if len(concepts) < max_concepts:
        neighbor_result = session.run(
            query_neighbors,
            **params_base,
            claim_ids=claim_ids,
            max_concepts=max_concepts - len(concepts)
        )
        
        for record in neighbor_result:
            node_id = record["node_id"]
            if node_id not in concept_ids_seen and len(concepts) < max_concepts:
                concept_ids_seen.add(node_id)
                concepts.append({
                    "node_id": node_id,
                    "name": record["name"],
                    "domain": record["domain"],
                    "type": record["type"],
                    "description": record["description"],
                    "tags": record["tags"],
                })
    
    # Get edges between mentioned concepts
    query_edges = f"""
    MATCH (g:GraphSpace {{graph_id: $graph_id}})
    MATCH (s:Concept {{graph_id: $graph_id}})-[:BELONGS_TO]->(g)
    MATCH (t:Concept {{graph_id: $graph_id}})-[:BELONGS_TO]->(g)
    MATCH (s)-[r]->(t)
    WHERE s.node_id IN $concept_ids
      AND t.node_id IN $concept_ids
      AND r.graph_id = $graph_id
      AND $branch_id IN COALESCE(r.on_branches, [])
      AND COALESCE(s.is_merged, false) = false
      AND COALESCE(t.is_merged, false) = false
      AND {edge_visibility_clause}
    RETURN s.node_id AS source_id,
           t.node_id AS target_id,
           type(r) AS predicate
    LIMIT 50
    """
    
    edge_result = session.run(
        query_edges,
        **params_base,
        concept_ids=list(concept_ids_seen)
    )
    
    edges = []
    for record in edge_result:
        edges.append({
            "source_id": record["source_id"],
            "target_id": record["target_id"],
            "predicate": record["predicate"],
        })
    
    return {
        "concepts": concepts,
        "edges": edges
    }


# Relationship review: see services.graph.relationships (imported above).
