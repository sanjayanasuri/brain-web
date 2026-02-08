"""
GraphRAG retrieval service for community-based context retrieval.
"""
from typing import Dict, List, Any, Optional, Tuple
from neo4j import Session
import math
import re

from services_search import embed_text, cosine_similarity, semantic_search_nodes
from services_graph import (
    get_claims_for_communities,
    get_evidence_subgraph,
    get_all_concepts,
)
from services_resources import get_resources_for_concept
from services_branch_explorer import ensure_graph_scoping_initialized, get_active_graph_context
from services_logging import log_graphrag_event
from verticals.base import RetrievalRequest, RetrievalResult
# Lazy import to avoid circular dependency with verticals.finance.retrieval


# ========== Part A: Utility Functions ==========

def mmr_select(
    items: List[Any],
    query_vec: List[float],
    item_vecs: List[Optional[List[float]]],
    item_relevance: List[float],
    k: int,
    lambda_mult: float = 0.65
) -> List[int]:
    """
    Maximal Marginal Relevance selection.
    
    Maximizes: lambda * rel(item) - (1-lambda) * max_sim(item, selected)
    
    Args:
        items: List of items to select from
        query_vec: Query embedding vector
        item_vecs: List of item embeddings (can be None for missing embeddings)
        item_relevance: List of relevance scores for each item
        k: Number of items to select
        lambda_mult: Lambda multiplier (0-1), higher = more relevance, lower = more diversity
    
    Returns:
        List of indices of selected items (deterministic, stable tie-breaking)
    """
    if k <= 0 or not items:
        return []
    
    n = len(items)
    if k >= n:
        return list(range(n))
    
    selected_indices = []
    remaining_indices = list(range(n))
    
    # Filter out items with missing embeddings or zero relevance
    valid_indices = []
    for i in range(n):
        if item_vecs[i] is not None and item_relevance[i] > 0:
            valid_indices.append(i)
    
    if not valid_indices:
        # Fallback: return top k by relevance
        sorted_indices = sorted(range(n), key=lambda i: item_relevance[i], reverse=True)
        return sorted_indices[:k]
    
    # Select first item: highest relevance
    first_idx = max(valid_indices, key=lambda i: item_relevance[i])
    selected_indices.append(first_idx)
    remaining_indices.remove(first_idx)
    valid_indices.remove(first_idx)
    
    # Select remaining items using MMR
    selected_embeddings = [item_vecs[first_idx]]
    
    for _ in range(min(k - 1, len(valid_indices))):
        if not valid_indices:
            break
        
        best_score = float('-inf')
        best_idx = None
        
        for candidate_idx in valid_indices:
            if item_vecs[candidate_idx] is None:
                continue
            
            # Relevance component
            rel_score = lambda_mult * item_relevance[candidate_idx]
            
            # Diversity penalty: max similarity to already selected
            max_sim = 0.0
            for sel_vec in selected_embeddings:
                if sel_vec is not None:
                    sim = cosine_similarity(item_vecs[candidate_idx], sel_vec)
                    max_sim = max(max_sim, sim)
            
            # MMR score
            mmr_score = rel_score - (1 - lambda_mult) * max_sim
            
            # Tie-breaking: prefer earlier items (deterministic)
            if mmr_score > best_score or (mmr_score == best_score and candidate_idx < best_idx):
                best_score = mmr_score
                best_idx = candidate_idx
        
        if best_idx is not None:
            selected_indices.append(best_idx)
            remaining_indices.remove(best_idx)
            valid_indices.remove(best_idx)
            if item_vecs[best_idx] is not None:
                selected_embeddings.append(item_vecs[best_idx])
        else:
            break
    
    # Sort selected indices for deterministic output
    selected_indices.sort()
    return selected_indices


def fetch_claims_with_mentions(
    session: Session,
    graph_id: str,
    branch_id: str,
    community_ids: List[str],
    limit_per_comm: int = 60,
    evidence_strictness: Optional[str] = None,
) -> List[Dict[str, Any]]:
    """
    Fetch claims with embeddings and mentioned concept node_ids.
    
    Args:
        session: Neo4j session
        graph_id: Graph ID
        branch_id: Branch ID
        community_ids: List of community IDs
        limit_per_comm: Max claims per community
        evidence_strictness: Optional strictness mode ("high", "medium", "low")
            - "high": Only VERIFIED claims (status = "VERIFIED")
            - "medium": VERIFIED + high-confidence PROPOSED (confidence >= 0.7)
            - "low": All claims (VERIFIED + all PROPOSED)
            - None: All claims (backward compatibility)
    
    Returns:
        List of claim dicts with: claim_id, text, confidence, source_id, source_span,
        embedding, mentioned_node_ids, community_id, status, evidence_ids
    """
    if not community_ids:
        return []
    
    # Build status filter clause based on strictness
    status_filter = ""
    if evidence_strictness == "high":
        status_filter = "AND COALESCE(claim.status, 'PROPOSED') = 'VERIFIED'"
    elif evidence_strictness == "medium":
        status_filter = """AND (
            COALESCE(claim.status, 'PROPOSED') = 'VERIFIED'
            OR (COALESCE(claim.status, 'PROPOSED') = 'PROPOSED' AND COALESCE(claim.confidence, 0.0) >= 0.7)
        )"""
    # "low" or None: no status filter (include all)
    
    # OPTIMIZED: Fetch all communities in a single batched query using UNWIND
    # This reduces database round trips from N queries to 1 query
    query = f"""
    MATCH (g:GraphSpace {{graph_id: $graph_id}})
    UNWIND $community_ids AS comm_id
    MATCH (k:Community {{graph_id: $graph_id, community_id: comm_id}})-[:BELONGS_TO]->(g)
    MATCH (c:Concept {{graph_id: $graph_id}})-[:IN_COMMUNITY]->(k)
    MATCH (claim:Claim {{graph_id: $graph_id}})-[:MENTIONS]->(c)
    WHERE $branch_id IN COALESCE(claim.on_branches, [])
      {status_filter}
    WITH k.community_id AS comm_id, claim
    ORDER BY comm_id, claim.confidence DESC
    WITH comm_id, collect(claim)[0..$limit] AS claims
    UNWIND claims AS claim
    OPTIONAL MATCH (claim)-[:MENTIONS]->(mentioned:Concept {{graph_id: $graph_id}})
    OPTIONAL MATCH (claim)-[:SUPPORTED_BY]->(chunk:SourceChunk {{graph_id: $graph_id}})
    OPTIONAL MATCH (claim)-[:EVIDENCED_BY]->(quote:Quote {{graph_id: $graph_id}})
    WITH comm_id, claim, 
         collect(DISTINCT mentioned.node_id) AS mentioned_node_ids, 
         chunk.chunk_id AS chunk_id,
         collect(DISTINCT quote.quote_id) AS quote_ids
    RETURN comm_id, 
           claim.claim_id AS claim_id,
           claim.text AS text,
           claim.confidence AS confidence,
           claim.source_id AS source_id,
           claim.source_span AS source_span,
           claim.embedding AS embedding,
           COALESCE(claim.status, 'PROPOSED') AS status,
           COALESCE(claim.evidence_ids, []) AS evidence_ids,
           chunk_id,
           quote_ids,
           mentioned_node_ids
    """
    
    all_claims = []
    # Single query for all communities instead of looping
    result = session.run(
        query,
        graph_id=graph_id,
        branch_id=branch_id,
        community_ids=community_ids,
        limit=limit_per_comm
    )
    
    for record in result:
        all_claims.append({
            "claim_id": record.get("claim_id"),
            "text": record.get("text"),
            "confidence": record.get("confidence", 0.5),
            "source_id": record.get("source_id"),
            "source_span": record.get("source_span"),
            "chunk_id": record.get("chunk_id"),
            "embedding": record.get("embedding"),
            "status": record.get("status", "PROPOSED"),
            "evidence_ids": record.get("evidence_ids", []),
            "quote_ids": record.get("quote_ids", []),
            "mentioned_node_ids": record.get("mentioned_node_ids", []),
            "community_id": record.get("comm_id"),
        })
    
    return all_claims


def detect_anchor_concepts(
    session: Session,
    graph_id: str,
    branch_id: str,
    question: str,
    question_embedding: List[float]
) -> Tuple[List[str], bool]:
    """
    Detect anchor concepts from question.
    
    Returns:
        Tuple of (anchor_node_ids, is_two_entity_question)
    """
    # Optimized: Use semantic_search_nodes which has disk caching
    # This prevents making sequential OpenAI calls for every concept in the graph
    try:
        results = semantic_search_nodes(question, session, limit=10)
    except Exception as e:
        print(f"[GraphRAG] ERROR: detect_anchor_concepts failed: {e}")
        return ([], False)
    
    if not results:
        return ([], False)
    
    # Check for two-entity question based on top scores
    high_scoring = [r for r in results if r["score"] > 0.35]
    is_two_entity = len(high_scoring) >= 2
    
    # Resolve quoted strings to node_ids (higher precision)
    quoted_strings = re.findall(r'"([^"]+)"', question) + re.findall(r"'([^']+)'", question)
    anchor_node_ids = []
    
    if quoted_strings:
        # Match quoted strings against result names
        for quoted in quoted_strings:
            quoted_lower = quoted.lower()
            for r in results:
                name_lower = r["node"].name.lower()
                if quoted_lower in name_lower or name_lower in quoted_lower:
                    anchor_node_ids.append(r["node"].node_id)
                    break
    
    # Fill in from semantic search results if not enough anchors from quotes
    limit = 2 if is_two_entity else 3
    for r in results:
        if len(anchor_node_ids) >= limit:
            break
        if r["node"].node_id not in anchor_node_ids:
            anchor_node_ids.append(r["node"].node_id)
    
    return (anchor_node_ids, is_two_entity)


def find_shortest_path_edges(
    session: Session,
    graph_id: str,
    branch_id: str,
    src_node_id: str,
    dst_node_id: str,
    max_hops: int = 4
) -> List[Dict[str, str]]:
    """
    Find shortest path edges between two concepts.
    
    Returns:
        List of edge dicts with: src, dst, rel
    """
    if src_node_id == dst_node_id:
        return []
    
    query = """
    MATCH (a:Concept {graph_id: $graph_id, node_id: $src})
    MATCH (b:Concept {graph_id: $graph_id, node_id: $dst})
    MATCH p = shortestPath((a)-[*..$max_hops]-(b))
    WHERE all(r IN relationships(p) WHERE $branch_id IN COALESCE(r.on_branches, []))
      AND all(n IN nodes(p) WHERE $branch_id IN COALESCE(n.on_branches, []))
    UNWIND relationships(p) AS r
    WITH startNode(r) AS s, endNode(r) AS t, type(r) AS rel
    RETURN DISTINCT s.node_id AS src, t.node_id AS dst, rel
    """
    
    try:
        result = session.run(
            query,
            graph_id=graph_id,
            branch_id=branch_id,
            src=src_node_id,
            dst=dst_node_id,
            max_hops=max_hops
        )
        edges = []
        for record in result:
            edges.append({
                "src": record["src"],
                "dst": record["dst"],
                "rel": record["rel"]
            })
        return edges
    except Exception as e:
        print(f"[GraphRAG] WARNING: Failed to find path from {src_node_id} to {dst_node_id}: {e}")
        return []


def semantic_search_communities(
    session: Session,
    graph_id: str,
    branch_id: str,
    query: str,
    limit: int = 5
) -> List[Dict[str, Any]]:
    """
    Perform semantic search over communities using summary embeddings.
    
    Args:
        session: Neo4j session
        graph_id: Graph ID
        branch_id: Branch ID
        query: Search query text
        limit: Maximum communities to return
    
    Returns:
        List of dicts with community_id, name, score, summary
    """
    ensure_graph_scoping_initialized(session)
    
    # Get query embedding
    try:
        query_embedding = embed_text(query)
    except Exception as e:
        print(f"[GraphRAG] ERROR: Failed to embed query: {e}")
        return []
    
    # Get all communities with summary_embedding
    query_cypher = """
    MATCH (g:GraphSpace {graph_id: $graph_id})
    MATCH (k:Community {graph_id: $graph_id})-[:BELONGS_TO]->(g)
    WHERE k.summary_embedding IS NOT NULL
    RETURN k.community_id AS community_id,
           k.name AS name,
           k.summary AS summary,
           k.summary_embedding AS summary_embedding
    """
    result = session.run(query_cypher, graph_id=graph_id)
    
    # Compute cosine similarity
    results = []
    for record in result:
        community_id = record["community_id"]
        name = record["name"]
        summary = record["summary"]
        summary_embedding = record["summary_embedding"]
        
        if not summary_embedding:
            continue
        
        try:
            score = cosine_similarity(query_embedding, summary_embedding)
            results.append({
                "community_id": community_id,
                "name": name,
                "score": score,
                "summary": summary,
            })
        except Exception as e:
            print(f"[GraphRAG] WARNING: Failed to compute similarity for {community_id}: {e}")
            continue
    
    # Sort by score descending
    results.sort(key=lambda x: x["score"], reverse=True)
    
    return results[:limit]


def retrieve_graphrag_context(
    session: Session,
    graph_id: str,
    branch_id: str,
    question: str,
    community_k: int = 5,
    claims_per_comm: int = 12,
    max_neighbors_per_concept: int = 8,
    evidence_strictness: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Retrieve GraphRAG context: communities -> claims -> evidence subgraph.
    Upgraded with MMR diversity selection and shortest-path evidence subgraph.
    
    Args:
        session: Neo4j session
        graph_id: Graph ID
        branch_id: Branch ID
        question: User question
        community_k: Number of top communities to retrieve
        claims_per_comm: Maximum claims per community
        max_neighbors_per_concept: Maximum neighbors per concept in evidence subgraph (legacy, not used)
        evidence_strictness: Optional strictness mode ("high", "medium", "low")
            - "high": Only VERIFIED claims
            - "medium": VERIFIED + high-confidence PROPOSED
            - "low": All claims (default)
    
    Returns:
        Dict with:
        - context_text: Formatted context string (or "no evidence" message if insufficient)
        - communities: List of community dicts
        - claims: List of claim dicts
        - concepts: List of concept dicts
        - edges: List of edge dicts
        - debug: Optional debug info
        - has_evidence: bool indicating if sufficient evidence was found
    """
    ensure_graph_scoping_initialized(session)
    
    # Step 1: Get question embedding
    try:
        question_embedding = embed_text(question)
    except Exception as e:
        print(f"[GraphRAG] ERROR: Failed to embed question: {e}")
        question_embedding = None
    
    # Step 2: Get top communities via semantic search
    print(f"[GraphRAG] Step 1: Retrieving top {community_k} communities")
    communities = semantic_search_communities(
        session=session,
        graph_id=graph_id,
        branch_id=branch_id,
        query=question,
        limit=community_k
    )
    
    if not communities:
        print("[GraphRAG] No communities found, returning empty context")
        return {
            "context_text": "No relevant communities found.",
            "communities": [],
            "claims": [],
            "concepts": [],
            "edges": [],
            "debug": None,
        }
    
    community_ids = [c["community_id"] for c in communities]
    print(f"[GraphRAG] Found {len(communities)} communities: {[c['name'] for c in communities]}")
    
    # Step 3: Detect anchor concepts (for two-entity questions)
    anchor_node_ids = []
    is_two_entity = False
    if question_embedding:
        anchor_node_ids, is_two_entity = detect_anchor_concepts(
            session=session,
            graph_id=graph_id,
            branch_id=branch_id,
            question=question,
            question_embedding=None
        )
        print(f"[GraphRAG] Detected {len(anchor_node_ids)} anchor concepts, is_two_entity={is_two_entity}")
    
    # Step 4: Fetch claims with embeddings and mentioned concepts
    print(f"[GraphRAG] Step 2: Fetching claims with embeddings for {len(community_ids)} communities (strictness: {evidence_strictness or 'low'})")
    candidate_limit = community_k * 60
    all_candidate_claims = fetch_claims_with_mentions(
        session=session,
        graph_id=graph_id,
        branch_id=branch_id,
        community_ids=community_ids,
        limit_per_comm=candidate_limit // len(community_ids) if community_ids else 60,
        evidence_strictness=evidence_strictness,
    )
    
    print(f"[GraphRAG] Found {len(all_candidate_claims)} candidate claims")
    
    # Check for insufficient evidence (especially in strict mode)
    has_evidence = len(all_candidate_claims) > 0
    if not has_evidence:
        print("[GraphRAG] WARNING: No claims found with current strictness settings")
        return {
            "context_text": "No evidence found for this query. Try:\n- Lowering evidence strictness\n- Expanding your knowledge graph\n- Using more exploratory search terms",
            "communities": communities,
            "claims": [],
            "concepts": [],
            "edges": [],
            "has_evidence": False,
            "debug": {
                "strictness": evidence_strictness,
                "communities_searched": len(community_ids),
                "reason": "no_claims_found"
            },
        }
    
    # Step 5: Compute combined relevance scores for claims
    print(f"[GraphRAG] Step 3: Computing claim relevance scores")
    claim_scores = []
    claim_embeddings = []
    
    for claim in all_candidate_claims:
        # Base relevance: similarity to question
        sim_q = 0.0
        if question_embedding and claim.get("embedding"):
            try:
                sim_q = cosine_similarity(question_embedding, claim["embedding"])
            except Exception as e:
                print(f"[GraphRAG] WARNING: Failed to compute similarity for claim {claim['claim_id']}: {e}")
        
        # Confidence component
        conf = claim.get("confidence", 0.5)
        
        # Combined score: 0.75 * sim_q + 0.25 * conf
        base_score = 0.75 * sim_q + 0.25 * conf
        
        # Connectivity boost for two-entity questions
        connectivity_boost = 0.0
        if is_two_entity and anchor_node_ids:
            mentioned_ids = claim.get("mentioned_node_ids", [])
            for anchor_id in anchor_node_ids:
                if anchor_id in mentioned_ids:
                    connectivity_boost += 0.10
            connectivity_boost = min(connectivity_boost, 0.20)  # Cap at 0.20
        
        final_score = base_score + connectivity_boost
        
        claim_scores.append(final_score)
        claim_embeddings.append(claim.get("embedding"))
    
    # Step 6: MMR selection
    print(f"[GraphRAG] Step 4: Applying MMR selection")
    final_k = min(community_k * claims_per_comm, 40)
    selected_indices = mmr_select(
        items=all_candidate_claims,
        query_vec=question_embedding if question_embedding else [],
        item_vecs=claim_embeddings,
        item_relevance=claim_scores,
        k=final_k,
        lambda_mult=0.70
    )
    
    selected_claims = [all_candidate_claims[i] for i in selected_indices]
    selected_claim_ids = [c["claim_id"] for c in selected_claims]
    
    print(f"[GraphRAG] Selected {len(selected_claims)} diverse claims via MMR")
    
    # Step 7: Build shortest-path evidence subgraph
    print(f"[GraphRAG] Step 5: Building shortest-path evidence subgraph")
    
    # Extract anchor concepts (if not already detected, use top concepts from claims)
    if not anchor_node_ids:
        # Count concept mentions in selected claims
        concept_mentions = {}
        for claim in selected_claims:
            for node_id in claim.get("mentioned_node_ids", []):
                concept_mentions[node_id] = concept_mentions.get(node_id, 0) + 1
        
        # Sort by frequency
        sorted_concepts = sorted(concept_mentions.items(), key=lambda x: x[1], reverse=True)
        anchor_node_ids = [node_id for node_id, _ in sorted_concepts[:3]]
    
    # Collect all mentioned concepts from selected claims
    all_mentioned_node_ids = set()
    for claim in selected_claims:
        all_mentioned_node_ids.update(claim.get("mentioned_node_ids", []))
    
    # Limit to top 30 by mention frequency
    concept_mentions = {}
    for claim in selected_claims:
        for node_id in claim.get("mentioned_node_ids", []):
            concept_mentions[node_id] = concept_mentions.get(node_id, 0) + 1
    
    sorted_mentioned = sorted(concept_mentions.items(), key=lambda x: x[1], reverse=True)
    candidate_concept_ids = [node_id for node_id, _ in sorted_mentioned[:30]]
    # Build path-based evidence graph
    path_edges = []
    path_node_ids = set()
    
    # Find shortest paths between anchor pairs
    max_path_queries = 10
    path_queries_made = 0
    
    if anchor_node_ids and len(anchor_node_ids) >= 2:
        for i in range(len(anchor_node_ids)):
            for j in range(i + 1, len(anchor_node_ids)):
                if path_queries_made >= max_path_queries:
                    break
                
                src_id = anchor_node_ids[i]
                dst_id = anchor_node_ids[j]
                
                edges = find_shortest_path_edges(
                    session=session,
                    graph_id=graph_id,
                    branch_id=branch_id,
                    src_node_id=src_id,
                    dst_node_id=dst_id,
                    max_hops=4
                )
                
                path_edges.extend(edges)
                for edge in edges:
                    path_node_ids.add(edge["src"])
                    path_node_ids.add(edge["dst"])
                
                path_queries_made += 1
                
                if path_queries_made >= max_path_queries:
                    break
    
    # Also find paths from anchors to top mentioned concepts
    if anchor_node_ids and path_queries_made < max_path_queries:
        for anchor_id in anchor_node_ids[:2]:  # Limit to top 2 anchors
            for concept_id in candidate_concept_ids[:5]:  # Top 5 mentioned
                if path_queries_made >= max_path_queries:
                    break
                if concept_id == anchor_id or concept_id in anchor_node_ids:
                    continue
                
                edges = find_shortest_path_edges(
                    session=session,
                    graph_id=graph_id,
                    branch_id=branch_id,
                    src_node_id=anchor_id,
                    dst_node_id=concept_id,
                    max_hops=4
                )
                
                path_edges.extend(edges)
                for edge in edges:
                    path_node_ids.add(edge["src"])
                    path_node_ids.add(edge["dst"])
                
                path_queries_made += 1
    
    # Add mentioned concepts from claims (if not already in path)
    path_node_ids.update(candidate_concept_ids)
    
    # Limit path edges to 80
    path_edges = path_edges[:80]
    
    # Fetch concept details for path nodes
    if path_node_ids:
        concept_query = """
        MATCH (c:Concept {graph_id: $graph_id})
        WHERE c.node_id IN $node_ids
          AND $branch_id IN COALESCE(c.on_branches, [])
        RETURN c.node_id AS node_id, c.name AS name, c.description AS description,
               c.tags AS tags, c.domain AS domain, c.type AS type
        LIMIT 25
        """
        concept_result = session.run(
            concept_query,
            graph_id=graph_id,
            branch_id=branch_id,
            node_ids=list(path_node_ids)
        )
        
        concepts = []
        for record in concept_result:
            concepts.append({
                "node_id": record["node_id"],
                "name": record["name"],
                "description": record.get("description"),
                "tags": record.get("tags"),
                "domain": record.get("domain"),
                "type": record.get("type"),
            })
    else:
        concepts = []
    
    # Convert path edges to standard format
    edges = []
    for edge in path_edges:
        edges.append({
            "source_id": edge["src"],
            "target_id": edge["dst"],
            "predicate": edge["rel"],
        })
    
    print(f"[GraphRAG] Evidence subgraph: {len(concepts)} concepts, {len(edges)} edges, {path_queries_made} path queries")
    
    # Step 8: Build context text with new formatting
    context_parts = []
    
    # Community Summaries section
    context_parts.append("## Community Summaries (Global Memory)")
    for comm in communities:
        context_parts.append(f"\n### {comm['name']}")
        if comm.get("summary"):
            summary = comm["summary"]
            if "Key Facts:" in summary:
                summary = summary.split("Key Facts:")[0].strip()
            # Truncate to ~1200 chars
            if len(summary) > 1200:
                summary = summary[:1200] + "..."
            context_parts.append(summary)
        context_parts.append("")
    
    # Diverse Supporting Claims section
    context_parts.append("## Diverse Supporting Claims (Evidence)")
    for claim in selected_claims:
        context_parts.append(f"\nClaim: {claim['text']}")
        context_parts.append(f"Confidence: {claim['confidence']:.2f}")
        source_info = claim.get('source_id', 'unknown')
        chunk_id = claim.get('chunk_id')
        source_span = claim.get('source_span')
        if chunk_id:
            source_info += f" (chunk_id: {chunk_id})"
        elif source_span:
            source_info += f" ({source_span})"
        context_parts.append(f"Source: {source_info}")
        
        # Get concept names for mentioned concepts
        mentioned_names = []
        if claim.get("mentioned_node_ids"):
            for node_id in claim["mentioned_node_ids"]:
                for concept in concepts:
                    if concept["node_id"] == node_id:
                        mentioned_names.append(concept["name"])
                        break
        if mentioned_names:
            context_parts.append(f"Mentioned concepts: {', '.join(mentioned_names)}")
        context_parts.append("")
    
    # Connection Subgraph section
    if anchor_node_ids or edges:
        context_parts.append("## Connection Subgraph (Paths)")
        
        if anchor_node_ids:
            anchor_names = []
            for node_id in anchor_node_ids:
                for concept in concepts:
                    if concept["node_id"] == node_id:
                        anchor_names.append(concept["name"])
                        break
            if anchor_names:
                context_parts.append(f"Anchor concepts: {', '.join(anchor_names)}")
        
        if edges:
            context_parts.append("\nEdges:")
            # Create a name map for quick lookup
            name_map = {c["node_id"]: c["name"] for c in concepts}
            for edge in edges[:80]:  # Cap at 80 edges
                src_name = name_map.get(edge["source_id"], edge["source_id"])
                dst_name = name_map.get(edge["target_id"], edge["target_id"])
                rel = edge.get("predicate", "RELATED_TO")
                context_parts.append(f"{src_name} --{rel}--> {dst_name}")
        context_parts.append("")
    
    # Relevant Concept Details section
    if concepts:
        context_parts.append("## Relevant Concept Details")
        for concept in concepts[:25]:  # Cap at 25
            context_parts.append(f"\n{concept['name']}")
            if concept.get("description"):
                context_parts.append(concept["description"])
            if concept.get("tags"):
                context_parts.append(f"Tags: {', '.join(concept['tags'])}")
            
            # Include resources attached to this concept
            try:
                resources = get_resources_for_concept(session, concept["node_id"])
                if resources:
                    # Filter for finance resources
                    finance_resources = [
                        r for r in resources
                        if r.source == "web" and r.metadata and isinstance(r.metadata, dict)
                    ]
                    if finance_resources:
                        for resource in finance_resources[:2]:  # Limit to 2 per concept
                            if resource.caption:
                                context_parts.append(f"Resource: {resource.caption[:200]}")  # Truncate long captions
                            # Include key metadata for finance resources
                            if resource.metadata:
                                meta = resource.metadata
                                if isinstance(meta, dict) and "output" in meta:
                                    output = meta.get("output", {})
                                else:
                                    output = meta
                                
                                price_data = output.get("price", {}) or {}
                                size_data = output.get("size", {}) or {}
                                if price_data.get("last_price") or size_data.get("market_cap"):
                                    finance_info = []
                                    if price_data.get("last_price"):
                                        finance_info.append(f"Price: {price_data.get('last_price')}")
                                    if size_data.get("market_cap"):
                                        finance_info.append(f"Market Cap: {size_data.get('market_cap')}")
                                    if finance_info:
                                        context_parts.append(" | ".join(finance_info))
            except Exception as e:
                # Don't fail retrieval if resource fetching fails
                print(f"[GraphRAG] WARNING: Failed to fetch resources for concept {concept['node_id']}: {e}")
            
            context_parts.append("")
    
    context_text = "\n".join(context_parts)
    
    # Build debug payload
    debug_info = {
        "anchor_concept_ids": anchor_node_ids,
        "selected_claim_ids": selected_claim_ids,
        "num_shortest_paths_found": path_queries_made,
        "num_nodes_in_evidence_graph": len(concepts),
        "num_edges_in_evidence_graph": len(edges),
        "is_two_entity_question": is_two_entity,
        "num_candidate_claims": len(all_candidate_claims),
        "num_selected_claims": len(selected_claims),
    }
    
    # Log the retrieval event
    try:
        log_graphrag_event(
            graph_id=graph_id,
            branch_id=branch_id,
            mode="graphrag",
            user_question=question,
            retrieved_communities=[c["community_id"] for c in communities],
            retrieved_claims=selected_claim_ids,
            response_length_tokens=None,
            metadata={
                "num_communities": len(communities),
                "num_claims": len(selected_claims),
                "num_concepts": len(concepts),
                "num_edges": len(edges),
                "anchor_concepts": anchor_node_ids,
                "is_two_entity": is_two_entity,
            }
        )
    except Exception as e:
        print(f"[GraphRAG] WARNING: Failed to log event: {e}")
    
    # Check if we have sufficient evidence (at least 3 claims with evidence)
    verified_claims = [c for c in selected_claims if c.get("status") == "VERIFIED"]
    has_evidence = len(selected_claims) >= 3 or len(verified_claims) > 0
    
    # Enhance with signal-aware retrieval
    try:
        from services_retrieval_signals import enhance_retrieval_with_signals, format_signal_context
        signal_info = enhance_retrieval_with_signals(
            session=session,
            concepts=concepts,
            include_reflections=True,
            include_emphasis=True,
        )
        signal_context = format_signal_context(signal_info)
        
        # Append signal context to formatted context
        if signal_context:
            context_text += "\n\n--- User Context ---\n" + signal_context
    except Exception as e:
        print(f"[GraphRAG] WARNING: Failed to enhance with signals: {e}")
        # Continue without signal enhancement
    
    return {
        "context_text": context_text,
        "communities": communities,
        "claims": selected_claims,
        "concepts": concepts,
        "edges": edges,
        "has_evidence": has_evidence,
        "debug": debug_info,
    }


def retrieve_context(
    req: RetrievalRequest,
    session: Session
) -> RetrievalResult:
    """
    Top-level vertical router for context retrieval.
    
    Routes to vertical-specific retrieval based on req.vertical.
    
    Args:
        req: RetrievalRequest with vertical and parameters
        session: Neo4j session
    
    Returns:
        RetrievalResult with context and metadata
    """
    if req.vertical == "finance":
        # Lazy import to avoid circular dependency
        from verticals.finance import retrieve as finance_retrieve
        return finance_retrieve(req, session)
    else:
        # General/classic mode: use existing retrieve_graphrag_context
        result_dict = retrieve_graphrag_context(
            session=session,
            graph_id=req.graph_id,
            branch_id=req.branch_id,
            question=req.query,
            community_k=req.max_communities,
            claims_per_comm=req.max_claims_per_community,
        )
        
        # Adapt to RetrievalResult format
        return RetrievalResult(
            mode="graphrag",
            vertical="general",
            lens="general",
            context_text=result_dict["context_text"],
            meta={
                "communities": len(result_dict.get("communities", [])),
                "claims": len(result_dict.get("claims", [])),
                "concepts": len(result_dict.get("concepts", [])),
                "edges": len(result_dict.get("edges", [])),
                "debug": result_dict.get("debug"),
            }
        )
