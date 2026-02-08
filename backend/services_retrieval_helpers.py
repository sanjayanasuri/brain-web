"""
Shared helper functions for intent-based retrieval plans.
"""
from typing import List, Dict, Any, Optional
from neo4j import Session
from services_graphrag import semantic_search_communities
from services_graph import (
    get_claims_for_communities,
    get_evidence_subgraph,
)
from services_search import embed_text, cosine_similarity
from services_branch_explorer import ensure_graph_scoping_initialized, get_active_graph_context


def retrieve_focus_communities(
    session: Session,
    graph_id: str,
    branch_id: str,
    query: str,
    k: int = 3
) -> List[Dict[str, Any]]:
    """
    Retrieve top communities by semantic search.
    
    Args:
        session: Neo4j session
        graph_id: Graph ID
        branch_id: Branch ID
        query: Search query
        k: Number of communities to return
    
    Returns:
        List of community dicts with community_id, name, summary, score
    """
    ensure_graph_scoping_initialized(session)
    return semantic_search_communities(
        session=session,
        graph_id=graph_id,
        branch_id=branch_id,
        query=query,
        limit=k
    )


def retrieve_claims_for_community_ids(
    session: Session,
    graph_id: str,
    branch_id: str,
    community_ids: List[str],
    limit_per: int = 30,
    ingestion_run_id: Optional[Any] = None
) -> List[Dict[str, Any]]:
    """
    Retrieve claims for given community IDs.
    
    Args:
        session: Neo4j session
        graph_id: Graph ID
        branch_id: Branch ID
        community_ids: List of community IDs
        limit_per: Max claims per community
        ingestion_run_id: Optional run ID or list of IDs filter
    
    Returns:
        Flattened list of claim dicts
    """
    ensure_graph_scoping_initialized(session)
    claims_by_comm = get_claims_for_communities(
        session=session,
        graph_id=graph_id,
        community_ids=community_ids,
        limit_per_comm=limit_per,
        ingestion_run_id=ingestion_run_id
    )
    
    # Flatten
    all_claims = []
    for comm_id, claims in claims_by_comm.items():
        for claim in claims:
            claim["community_id"] = comm_id
            all_claims.append(claim)
    
    return all_claims


def retrieve_top_claims_by_query_embedding(
    session: Session,
    graph_id: str,
    branch_id: str,
    query: str,
    limit: int = 30,
    ingestion_run_id: Optional[Any] = None
) -> List[Dict[str, Any]]:
    """
    Retrieve top claims by embedding similarity to query.
    
    Args:
        session: Neo4j session
        graph_id: Graph ID
        branch_id: Branch ID
        query: Query text
        limit: Max claims to return
        ingestion_run_id: Optional run ID or list of IDs filter
    
    Returns:
        List of claim dicts sorted by similarity
    """
    ensure_graph_scoping_initialized(session)
    
    # Normalize ingestion_run_id to a list for Cypher IN operator
    run_ids = None
    if ingestion_run_id:
        run_ids = ingestion_run_id if isinstance(ingestion_run_id, list) else [ingestion_run_id]

    # Get query embedding
    try:
        query_embedding = embed_text(query)
    except Exception as e:
        print(f"[Retrieval Helpers] Failed to embed query: {e}")
        return []
    
    # Fetch claims with embeddings
    query_cypher = """
    MATCH (g:GraphSpace {graph_id: $graph_id})
    MATCH (claim:Claim {graph_id: $graph_id})-[:BELONGS_TO]->(g)
    WHERE $branch_id IN COALESCE(claim.on_branches, [])
      AND claim.embedding IS NOT NULL
      AND ($run_ids IS NULL OR claim.ingestion_run_id IN $run_ids)
    OPTIONAL MATCH (claim)-[:SUPPORTED_BY]->(chunk:SourceChunk {graph_id: $graph_id})
    RETURN claim.claim_id AS claim_id,
           claim.text AS text,
           COALESCE(claim.confidence, 0.5) AS confidence,
           claim.source_id AS source_id,
           claim.source_span AS source_span,
           claim.embedding AS embedding,
           chunk.chunk_id AS chunk_id
    LIMIT 200
    """
    
    result = session.run(
        query_cypher,
        graph_id=graph_id,
        branch_id=branch_id,
        run_ids=run_ids
    )
    
    claims_with_scores = []
    for record in result:
        claim_embedding = record.get("embedding")
        if not claim_embedding:
            continue
        
        try:
            similarity = cosine_similarity(query_embedding, claim_embedding)
            claims_with_scores.append({
                "claim_id": record["claim_id"],
                "text": record["text"],
                "confidence": record["confidence"],
                "source_id": record["source_id"],
                "source_span": record["source_span"],
                "chunk_id": record.get("chunk_id"),
                "similarity": similarity,
            })
        except Exception as e:
            print(f"[Retrieval Helpers] Failed to compute similarity: {e}")
            continue
    
    # Sort by similarity
    claims_with_scores.sort(key=lambda x: x["similarity"], reverse=True)
    return claims_with_scores[:limit]


def fetch_source_chunks_by_ids(
    session: Session,
    graph_id: str,
    branch_id: str,
    chunk_ids: List[str]
) -> List[Dict[str, Any]]:
    """
    Fetch source chunks by chunk IDs.
    
    Args:
        session: Neo4j session
        graph_id: Graph ID
        branch_id: Branch ID
        chunk_ids: List of chunk IDs
    
    Returns:
        List of chunk dicts
    """
    if not chunk_ids:
        return []
    
    ensure_graph_scoping_initialized(session)
    
    query = """
    MATCH (g:GraphSpace {graph_id: $graph_id})
    MATCH (chunk:SourceChunk {graph_id: $graph_id})-[:BELONGS_TO]->(g)
    WHERE chunk.chunk_id IN $chunk_ids
      AND $branch_id IN COALESCE(chunk.on_branches, [])
    OPTIONAL MATCH (chunk)-[:FROM_DOCUMENT]->(doc:SourceDocument {graph_id: $graph_id})
    RETURN chunk.chunk_id AS chunk_id,
           chunk.source_id AS source_id,
           chunk.chunk_index AS chunk_index,
           chunk.text AS text,
           chunk.metadata AS metadata,
           doc.doc_id AS doc_id,
           doc.source AS source_type,
           doc.url AS url,
           doc.published_at AS published_at
    """
    
    result = session.run(
        query,
        graph_id=graph_id,
        branch_id=branch_id,
        chunk_ids=chunk_ids
    )
    
    chunks = []
    for record in result:
        chunks.append({
            "chunk_id": record["chunk_id"],
            "source_id": record["source_id"],
            "chunk_index": record.get("chunk_index"),
            "text": record.get("text", ""),
            "metadata": record.get("metadata"),
            "doc_id": record.get("doc_id"),
            "source_type": record.get("source_type"),
            "url": record.get("url"),
            "published_at": record.get("published_at"),
        })
    
    return chunks


def build_evidence_subgraph_from_claim_ids(
    session: Session,
    graph_id: str,
    branch_id: str,
    claim_ids: List[str],
    max_concepts: int = 50,
    include_proposed: str = "auto"
) -> Dict[str, Any]:
    """
    Build evidence subgraph from claim IDs.
    
    Args:
        session: Neo4j session
        graph_id: Graph ID
        branch_id: Branch ID
        claim_ids: List of claim IDs
        max_concepts: Max concepts to include
        include_proposed: Edge visibility policy
    
    Returns:
        Dict with 'concepts' and 'edges' lists
    """
    ensure_graph_scoping_initialized(session)
    return get_evidence_subgraph(
        session=session,
        graph_id=graph_id,
        claim_ids=claim_ids,
        max_concepts=max_concepts,
        include_proposed=include_proposed
    )


def rank_concepts_for_explore(
    concepts: List[Dict[str, Any]],
    edges: List[Dict[str, Any]]
) -> List[Dict[str, Any]]:
    """
    Rank concepts for exploration based on graph potential and gaps.
    
    Args:
        concepts: List of concept dicts
        edges: List of edge dicts
    
    Returns:
        Ranked list of concepts
    """
    # Build degree map
    degree_map = {}
    for edge in edges:
        src = edge.get("source_id")
        dst = edge.get("target_id")
        degree_map[src] = degree_map.get(src, 0) + 1
        degree_map[dst] = degree_map.get(dst, 0) + 1
    
    # Score each concept
    scored_concepts = []
    for concept in concepts:
        node_id = concept.get("node_id")
        degree = degree_map.get(node_id, 0)
        has_description = bool(concept.get("description"))
        
        # Score: high degree + missing description = high potential
        score = degree * 2 + (0 if has_description else 10)
        
        scored_concepts.append({
            **concept,
            "explore_score": score,
            "degree": degree,
            "has_description": has_description,
        })
    
    # Sort by score descending
    scored_concepts.sort(key=lambda x: x["explore_score"], reverse=True)
    return scored_concepts
