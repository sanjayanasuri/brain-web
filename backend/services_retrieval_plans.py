"""
Deterministic retrieval plans for each intent type.
"""
from typing import List, Dict, Any, Optional, Tuple
from neo4j import Session
import json
import re
from datetime import datetime, timedelta
from services_retrieval_helpers import (
    retrieve_focus_communities,
    retrieve_claims_for_community_ids,
    retrieve_top_claims_by_query_embedding,
    fetch_source_chunks_by_ids,
    build_evidence_subgraph_from_claim_ids,
    rank_concepts_for_explore,
)
from services_graphrag import find_shortest_path_edges
from services_search import semantic_search_nodes
from services_graph import get_neighbors_with_relationships
from services_branch_explorer import ensure_graph_scoping_initialized, get_active_graph_context
from models import RetrievalResult, RetrievalTraceStep, Intent

_COMPARE_TARGET_MIN_CONFIDENCE = 0.65


def _safe_float(value: Any, default: float = 0.0) -> float:
    try:
        return float(value)
    except Exception:
        return float(default)


def _clean_compare_target(value: Any) -> str:
    text = str(value or "").strip()
    if not text:
        return ""
    text = re.sub(r'^[\"\'`]+|[\"\'`]+$', "", text).strip()
    text = text.strip(" \t\n\r.,;:!?")
    return re.sub(r"\s+", " ", text)


def _dedupe_targets(targets: List[Any]) -> List[str]:
    out: List[str] = []
    seen = set()
    for target in targets:
        cleaned = _clean_compare_target(target)
        if not cleaned:
            continue
        key = cleaned.lower()
        if key in seen:
            continue
        seen.add(key)
        out.append(cleaned)
        if len(out) >= 2:
            break
    return out


def _extract_compare_targets_llm(query: str) -> List[str]:
    """
    Cheap LLM extraction for COMPARE intent target parsing.
    Returns [] when unavailable, low-confidence, or non-compare phrasing.
    """
    text = str(query or "").strip()
    if not text:
        return []

    try:
        from services_model_router import model_router, TASK_EXTRACT

        if not model_router.client:
            return []

        prompt = (
            "Extract the two entities/topics being compared in the query.\n"
            "Return strict JSON with keys:\n"
            "- target_a: string or null\n"
            "- target_b: string or null\n"
            "- is_compare: boolean\n"
            "- confidence: number between 0 and 1\n"
            "Rules:\n"
            "- If query is not a comparison request, set is_compare=false and targets=null.\n"
            "- Do not invent entities.\n"
            "- Keep targets concise and normalized.\n"
        )

        raw = model_router.completion(
            task_type=TASK_EXTRACT,
            messages=[
                {"role": "system", "content": prompt},
                {"role": "user", "content": json.dumps({"query": text})},
            ],
            response_format={"type": "json_object"},
            temperature=0.0,
            max_tokens=120,
        )

        parsed = json.loads(raw or "{}")
        if parsed.get("is_compare") is False:
            return []
        confidence = _safe_float(parsed.get("confidence"), 0.0)
        if confidence < _COMPARE_TARGET_MIN_CONFIDENCE:
            return []

        return _dedupe_targets([parsed.get("target_a"), parsed.get("target_b")])
    except Exception:
        return []


def _extract_compare_targets_regex(query: str) -> List[str]:
    """
    Deterministic parser for common compare phrasings.
    """
    text = str(query or "").strip()
    if not text:
        return []

    patterns = [
        r"(.+?)\s+(?:vs|versus)\s+(.+)",
        r"\bcompare\s+(.+?)\s+(?:and|to|with)\s+(.+)",
        r"\bdifference\s+between\s+(.+?)\s+and\s+(.+)",
    ]

    for pattern in patterns:
        match = re.search(pattern, text, flags=re.I)
        if not match:
            continue
        return _dedupe_targets([match.group(1), match.group(2)])

    return []


def _identify_compare_targets(query: str, session: Session) -> Tuple[List[str], str]:
    """
    Target extraction order: LLM (cheap) -> regex parser -> semantic fallback.
    """
    llm_targets = _extract_compare_targets_llm(query)
    if len(llm_targets) >= 2:
        return llm_targets[:2], "llm"

    regex_targets = _extract_compare_targets_regex(query)
    if len(regex_targets) >= 2:
        return regex_targets[:2], "regex"

    results = semantic_search_nodes(query, session, limit=2)
    semantic_targets = _dedupe_targets([r["node"].name for r in results[:2]])
    return semantic_targets, "semantic"


def run_plan(
    session: Session,
    query: str,
    intent: str,
    graph_id: str,
    branch_id: str,
    limit: int = 5,
    detail_level: str = "summary",
    ingestion_run_id: Optional[Any] = None
) -> RetrievalResult:
    """
    Run the appropriate retrieval plan based on intent.
    
    Args:
        session: Neo4j session
        query: User query
        intent: Intent string (from Intent enum)
        graph_id: Graph ID
        branch_id: Branch ID
        limit: General limit parameter
    
    Returns:
        RetrievalResult with trace and context
    """
    ensure_graph_scoping_initialized(session)
    
    intent_enum = Intent(intent)
    
    if intent_enum == Intent.DEFINITION_OVERVIEW:
        return plan_definition_overview(session, query, graph_id, branch_id, limit, detail_level, ingestion_run_id)
    elif intent_enum == Intent.TIMELINE:
        return plan_timeline(session, query, graph_id, branch_id, limit, detail_level, ingestion_run_id)
    elif intent_enum == Intent.CAUSAL_CHAIN:
        return plan_causal_chain(session, query, graph_id, branch_id, limit, detail_level, ingestion_run_id)
    elif intent_enum == Intent.COMPARE:
        return plan_compare(session, query, graph_id, branch_id, limit, detail_level, ingestion_run_id)
    elif intent_enum == Intent.WHO_NETWORK:
        return plan_who_network(session, query, graph_id, branch_id, limit, detail_level, ingestion_run_id)
    elif intent_enum == Intent.EVIDENCE_CHECK:
        return plan_evidence_check(session, query, graph_id, branch_id, limit, detail_level, ingestion_run_id)
    elif intent_enum == Intent.EXPLORE_NEXT:
        return plan_explore_next(session, query, graph_id, branch_id, limit, detail_level, ingestion_run_id)
    elif intent_enum == Intent.WHAT_CHANGED:
        return plan_what_changed(session, query, graph_id, branch_id, limit, detail_level, ingestion_run_id)
    elif intent_enum == Intent.SELF_KNOWLEDGE:
        return plan_self_knowledge(session, query, graph_id, branch_id, limit, detail_level, ingestion_run_id)
    else:
        # Fallback to definition overview
        return plan_definition_overview(session, query, graph_id, branch_id, limit, detail_level, ingestion_run_id)


def plan_definition_overview(
    session: Session,
    query: str,
    graph_id: str,
    branch_id: str,
    limit: int,
    detail_level: str = "summary",
    ingestion_run_id: Optional[Any] = None
) -> RetrievalResult:
    """Plan 1: DEFINITION_OVERVIEW"""
    trace = []
    
    # Step 1: Semantic search communities
    trace.append(RetrievalTraceStep(
        step="semantic_search_communities",
        params={"k": 2},
        counts={}
    ))
    communities = retrieve_focus_communities(session, graph_id, branch_id, query, k=2)
    trace[-1].counts = {"communities": len(communities)}
    
    if not communities:
        return _empty_result(Intent.DEFINITION_OVERVIEW.value, trace)
    
    community_ids = [c["community_id"] for c in communities]
    
    # Step 2: Pull claims
    trace.append(RetrievalTraceStep(
        step="retrieve_claims_for_communities",
        params={"limit_per": 15},
        counts={}
    ))
    claims = retrieve_claims_for_community_ids(
        session, graph_id, branch_id, community_ids, limit_per=15, ingestion_run_id=ingestion_run_id
    )
    trace[-1].counts = {"claims": len(claims)}
    
    if not claims:
        return _empty_result(Intent.DEFINITION_OVERVIEW.value, trace)
    
    claim_ids = [c["claim_id"] for c in claims[:30]]
    
    # Step 3: Build evidence subgraph
    trace.append(RetrievalTraceStep(
        step="build_evidence_subgraph",
        params={"max_concepts": 30},
        counts={}
    ))
    subgraph = build_evidence_subgraph_from_claim_ids(
        session, graph_id, branch_id, claim_ids, max_concepts=30
    )
    trace[-1].counts = {
        "concepts": len(subgraph.get("concepts", [])),
        "edges": len(subgraph.get("edges", []))
    }
    
    # Step 4: Fetch chunks for top claims
    trace.append(RetrievalTraceStep(
        step="fetch_chunks",
        params={"limit": 10},
        counts={}
    ))
    top_claim_chunk_ids = [c.get("chunk_id") for c in claims[:10] if c.get("chunk_id")]
    chunks = fetch_source_chunks_by_ids(session, graph_id, branch_id, top_claim_chunk_ids)
    trace[-1].counts = {"chunks": len(chunks)}
    
    # Rank concepts by claim mentions
    concept_mentions = {}
    for claim in claims:
        # Extract mentioned concepts from claim (if available)
        # For now, use concepts from subgraph
        pass
    
    focus_entities = subgraph.get("concepts", [])[:10]
    
    # Generate suggestions
    suggestions = [
        {"label": "Timeline", "query": f"Timeline of {query}", "intent": Intent.TIMELINE.value},
        {"label": "Causal Chain", "query": f"What caused {query}?", "intent": Intent.CAUSAL_CHAIN.value},
        {"label": "Explore Next", "query": f"Related topics to {query}", "intent": Intent.EXPLORE_NEXT.value},
    ]
    
    context = {
        "focus_entities": focus_entities,
        "focus_communities": communities,
        "claims": claims[:20],
        "chunks": chunks,
        "subgraph": subgraph,
        "suggestions": suggestions,
        "warnings": [],
    }
    
    return RetrievalResult(
        intent=Intent.DEFINITION_OVERVIEW.value,
        trace=trace,
        context=context
    )


def plan_timeline(
    session: Session,
    query: str,
    graph_id: str,
    branch_id: str,
    limit: int,
    detail_level: str = "summary",
    ingestion_run_id: Optional[Any] = None
) -> RetrievalResult:
    """Plan 2: TIMELINE"""
    trace = []
    
    # Step 1: Retrieve communities
    trace.append(RetrievalTraceStep(step="retrieve_communities", params={"k": 3}, counts={}))
    communities = retrieve_focus_communities(session, graph_id, branch_id, query, k=3)
    trace[-1].counts = {"communities": len(communities)}
    
    if not communities:
        return _empty_result(Intent.TIMELINE.value, trace)
    
    community_ids = [c["community_id"] for c in communities]
    
    # Step 2: Retrieve claims
    claims = retrieve_claims_for_community_ids(
        session, graph_id, branch_id, community_ids, limit_per=20, ingestion_run_id=ingestion_run_id
    )
    trace[-1].counts = {"claims": len(claims)}
    
    if not claims:
        return _empty_result(Intent.TIMELINE.value, trace)
    
    # Step 3: Fetch chunks
    trace.append(RetrievalTraceStep(step="fetch_chunks", params={}, counts={}))
    chunk_ids = [c.get("chunk_id") for c in claims if c.get("chunk_id")]
    chunks = fetch_source_chunks_by_ids(session, graph_id, branch_id, chunk_ids)
    trace[-1].counts = {"chunks": len(chunks)}
    
    # Step 4: Extract timestamps
    trace.append(RetrievalTraceStep(step="extract_timestamps", params={}, counts={}))
    timeline_items = []
    
    # Create chunk lookup
    chunk_map = {chunk["chunk_id"]: chunk for chunk in chunks}
    
    for claim in claims:
        chunk_id = claim.get("chunk_id")
        chunk = chunk_map.get(chunk_id) if chunk_id else None
        
        # Extract date from chunk metadata or text
        date_str = None
        if chunk:
            # Try metadata first
            metadata = chunk.get("metadata")
            if metadata:
                if isinstance(metadata, str):
                    import json
                    try:
                        metadata = json.loads(metadata)
                    except:
                        pass
                if isinstance(metadata, dict):
                    date_str = metadata.get("published_at") or metadata.get("date") or metadata.get("timestamp")
            
            # Try published_at from document
            if not date_str:
                date_str = chunk.get("published_at")
            
            # Try regex parse from text
            if not date_str and chunk.get("text"):
                text = chunk["text"]
                # Match YYYY, Month YYYY, or full dates
                date_match = re.search(r'\b(19|20)\d{2}\b', text)
                if date_match:
                    date_str = date_match.group(0)
        
        timeline_items.append({
            "date": date_str or "unknown",
            "claim_id": claim["claim_id"],
            "text": claim["text"],
            "chunk_id": chunk_id,
            "source_id": claim.get("source_id"),
        })
    
    # Sort by date (if available)
    timeline_items.sort(key=lambda x: (
        x["date"] if x["date"] != "unknown" and x["date"] else "9999"
    ))
    
    trace[-1].counts = {"timeline_items": len(timeline_items)}
    
    # Step 5: Build evidence subgraph
    trace.append(RetrievalTraceStep(step="build_evidence_subgraph", params={"max_concepts": 25}, counts={}))
    top_claim_ids = [c["claim_id"] for c in claims[:25]]
    subgraph = build_evidence_subgraph_from_claim_ids(
        session, graph_id, branch_id, top_claim_ids, max_concepts=25
    )
    trace[-1].counts = {
        "concepts": len(subgraph.get("concepts", [])),
        "edges": len(subgraph.get("edges", []))
    }
    
    context = {
        "focus_entities": subgraph.get("concepts", [])[:15],
        "focus_communities": communities,
        "claims": claims[:20],
        "chunks": chunks[:20],
        "subgraph": subgraph,
        "timeline_items": timeline_items[:30],
        "suggestions": [
            {"label": "Causal Chain", "query": f"What caused {query}?", "intent": Intent.CAUSAL_CHAIN.value},
            {"label": "Who Network", "query": f"Who was involved in {query}?", "intent": Intent.WHO_NETWORK.value},
        ],
        "warnings": [],
    }
    
    return RetrievalResult(
        intent=Intent.TIMELINE.value,
        trace=trace,
        context=context
    )


def plan_causal_chain(
    session: Session,
    query: str,
    graph_id: str,
    branch_id: str,
    limit: int,
    detail_level: str = "summary",
    ingestion_run_id: Optional[Any] = None
) -> RetrievalResult:
    """Plan 3: CAUSAL_CHAIN"""
    trace = []
    
    # Step 1: Retrieve communities
    trace.append(RetrievalTraceStep(step="retrieve_communities", params={"k": 3}, counts={}))
    communities = retrieve_focus_communities(session, graph_id, branch_id, query, k=3)
    trace[-1].counts = {"communities": len(communities)}
    
    if not communities:
        return _empty_result(Intent.CAUSAL_CHAIN.value, trace)
    
    community_ids = [c["community_id"] for c in communities]
    
    # Step 2: Retrieve claims
    trace.append(RetrievalTraceStep(step="retrieve_claims", params={"limit_per": 30}, counts={}))
    claims = retrieve_claims_for_community_ids(
        session, graph_id, branch_id, community_ids, limit_per=30, ingestion_run_id=ingestion_run_id
    )
    trace[-1].counts = {"claims": len(claims)}
    
    if not claims:
        return _empty_result(Intent.CAUSAL_CHAIN.value, trace)
    
    # Step 3: Build evidence subgraph
    trace.append(RetrievalTraceStep(step="build_evidence_subgraph", params={"max_concepts": 50}, counts={}))
    claim_ids = [c["claim_id"] for c in claims[:50]]
    subgraph = build_evidence_subgraph_from_claim_ids(
        session, graph_id, branch_id, claim_ids, max_concepts=50
    )
    trace[-1].counts = {
        "concepts": len(subgraph.get("concepts", [])),
        "edges": len(subgraph.get("edges", []))
    }
    
    concepts = subgraph.get("concepts", [])
    edges = subgraph.get("edges", [])
    
    # Step 4: Path extraction
    trace.append(RetrievalTraceStep(step="extract_causal_paths", params={}, counts={}))
    
    # Pick 2-3 anchor concepts (most relevant to query)
    # Use concept name similarity + claim mention count
    anchor_concepts = []
    if concepts:
        # Simple heuristic: top concepts by name similarity
        query_lower = query.lower()
        concept_scores = []
        for concept in concepts[:20]:
            name = concept.get("name", "").lower()
            score = 0
            for word in query_lower.split():
                if word in name:
                    score += 1
            concept_scores.append((concept, score))
        
        concept_scores.sort(key=lambda x: x[1], reverse=True)
        anchor_concepts = [c[0] for c, _ in concept_scores[:3]]
    
    # Find shortest paths between anchors
    causal_paths = []
    if len(anchor_concepts) >= 2:
        for i in range(len(anchor_concepts)):
            for j in range(i + 1, len(anchor_concepts)):
                src_id = anchor_concepts[i].get("node_id")
                dst_id = anchor_concepts[j].get("node_id")
                
                path_edges = find_shortest_path_edges(
                    session, graph_id, branch_id, src_id, dst_id, max_hops=4
                )
                
                if path_edges:
                    # Get supporting claim IDs for nodes in path
                    path_node_ids = set()
                    for edge in path_edges:
                        path_node_ids.add(edge["src"])
                        path_node_ids.add(edge["dst"])
                    
                    supporting_claim_ids = [
                        c["claim_id"] for c in claims
                        if any(node_id in path_node_ids for node_id in [])  # Simplified
                    ]
                    
                    causal_paths.append({
                        "nodes": list(path_node_ids),
                        "edges": path_edges,
                        "supporting_claim_ids": supporting_claim_ids[:10],
                    })
    
    trace[-1].counts = {"causal_paths": len(causal_paths)}
    
    # Step 5: Fetch chunks for path claims
    trace.append(RetrievalTraceStep(step="fetch_chunks", params={}, counts={}))
    path_claim_ids = []
    for path in causal_paths:
        path_claim_ids.extend(path.get("supporting_claim_ids", []))
    
    path_claims = [c for c in claims if c["claim_id"] in path_claim_ids[:20]]
    chunk_ids = [c.get("chunk_id") for c in path_claims if c.get("chunk_id")]
    chunks = fetch_source_chunks_by_ids(session, graph_id, branch_id, chunk_ids)
    trace[-1].counts = {"chunks": len(chunks)}
    
    context = {
        "focus_entities": concepts[:20],
        "focus_communities": communities,
        "claims": claims[:30],
        "chunks": chunks,
        "subgraph": subgraph,
        "causal_paths": causal_paths[:5],
        "suggestions": [],
        "warnings": [],
    }
    
    return RetrievalResult(
        intent=Intent.CAUSAL_CHAIN.value,
        trace=trace,
        context=context
    )


def plan_compare(
    session: Session,
    query: str,
    graph_id: str,
    branch_id: str,
    limit: int,
    detail_level: str = "summary",
    ingestion_run_id: Optional[Any] = None
) -> RetrievalResult:
    """Plan 4: COMPARE"""
    trace = []
    
    # Step 1: Identify two targets
    trace.append(RetrievalTraceStep(step="identify_targets", params={}, counts={}))

    targets, target_method = _identify_compare_targets(query, session)
    trace[-1].params = {"method": target_method}
    trace[-1].counts = {"targets": len(targets)}
    
    if len(targets) < 2:
        return _empty_result(Intent.COMPARE.value, trace, warning="Could not identify two targets for comparison")
    
    target_a, target_b = targets[0], targets[1]
    
    # Step 2: Retrieve communities for each target
    trace.append(RetrievalTraceStep(step="retrieve_communities_per_target", params={"k": 2}, counts={}))
    communities_a = retrieve_focus_communities(session, graph_id, branch_id, target_a, k=2)
    communities_b = retrieve_focus_communities(session, graph_id, branch_id, target_b, k=2)
    trace[-1].counts = {
        "communities_a": len(communities_a),
        "communities_b": len(communities_b)
    }
    
    all_community_ids = [c["community_id"] for c in communities_a + communities_b]
    
    # Step 3: Retrieve claims
    trace.append(RetrievalTraceStep(step="retrieve_claims", params={"limit_per": 20}, counts={}))
    claims_a = retrieve_claims_for_community_ids(
        session, graph_id, branch_id, [c["community_id"] for c in communities_a], limit_per=20, ingestion_run_id=ingestion_run_id
    )
    claims_b = retrieve_claims_for_community_ids(
        session, graph_id, branch_id, [c["community_id"] for c in communities_b], limit_per=20, ingestion_run_id=ingestion_run_id
    )
    all_claims = claims_a + claims_b
    trace[-1].counts = {"claims": len(all_claims)}
    
    # Step 4: Build subgraphs
    trace.append(RetrievalTraceStep(step="build_subgraphs", params={}, counts={}))
    claim_ids_a = [c["claim_id"] for c in claims_a[:30]]
    claim_ids_b = [c["claim_id"] for c in claims_b[:30]]
    
    subgraph_a = build_evidence_subgraph_from_claim_ids(
        session, graph_id, branch_id, claim_ids_a, max_concepts=25
    )
    subgraph_b = build_evidence_subgraph_from_claim_ids(
        session, graph_id, branch_id, claim_ids_b, max_concepts=25
    )
    
    concepts_a = {c["node_id"]: c for c in subgraph_a.get("concepts", [])}
    concepts_b = {c["node_id"]: c for c in subgraph_b.get("concepts", [])}
    
    # Compute overlap
    shared_concepts = [c for node_id, c in concepts_a.items() if node_id in concepts_b]
    shared_communities = [c for c in communities_a if c["community_id"] in [c2["community_id"] for c2 in communities_b]]
    
    trace[-1].counts = {
        "concepts_a": len(concepts_a),
        "concepts_b": len(concepts_b),
        "shared_concepts": len(shared_concepts)
    }
    
    # Step 5: Fetch chunks for differences
    trace.append(RetrievalTraceStep(step="fetch_chunks", params={}, counts={}))
    chunk_ids = [c.get("chunk_id") for c in all_claims[:20] if c.get("chunk_id")]
    chunks = fetch_source_chunks_by_ids(session, graph_id, branch_id, chunk_ids)
    trace[-1].counts = {"chunks": len(chunks)}
    
    context = {
        "focus_entities": list(concepts_a.values())[:10] + list(concepts_b.values())[:10],
        "focus_communities": communities_a + communities_b,
        "claims": all_claims[:30],
        "chunks": chunks,
        "subgraph": {
            "concepts": list(concepts_a.values()) + list(concepts_b.values()),
            "edges": subgraph_a.get("edges", []) + subgraph_b.get("edges", []),
        },
        "compare": {
            "A": {
                "name": target_a,
                "concepts": list(concepts_a.values())[:15],
                "communities": communities_a,
                "claims": claims_a[:15],
            },
            "B": {
                "name": target_b,
                "concepts": list(concepts_b.values())[:15],
                "communities": communities_b,
                "claims": claims_b[:15],
            },
            "overlaps": {
                "shared_concepts": shared_concepts[:10],
                "shared_communities": shared_communities,
            },
            "differences": {
                "unique_to_a": [c for node_id, c in concepts_a.items() if node_id not in concepts_b][:10],
                "unique_to_b": [c for node_id, c in concepts_b.items() if node_id not in concepts_a][:10],
            },
        },
        "suggestions": [],
        "warnings": [],
    }
    
    return RetrievalResult(
        intent=Intent.COMPARE.value,
        trace=trace,
        context=context
    )


def plan_who_network(
    session: Session,
    query: str,
    graph_id: str,
    branch_id: str,
    limit: int,
    detail_level: str = "summary",
    ingestion_run_id: Optional[Any] = None
) -> RetrievalResult:
    """Plan 5: WHO_NETWORK"""
    trace = []
    
    # Step 1: Semantic concept search for who/organization names
    trace.append(RetrievalTraceStep(step="semantic_search_concepts", params={"limit": 3}, counts={}))
    results = semantic_search_nodes(query, session, limit=3)
    top_nodes = [r["node"] for r in results]
    trace[-1].counts = {"concepts": len(top_nodes)}
    
    if not top_nodes:
        return _empty_result(Intent.WHO_NETWORK.value, trace)
    
    # Step 2: Get neighbors with relationships
    trace.append(RetrievalTraceStep(step="get_neighbors", params={"status": None}, counts={}))
    ego_node = top_nodes[0]
    neighbors = get_neighbors_with_relationships(session, ego_node.node_id, include_proposed="all")
    trace[-1].counts = {"neighbors": len(neighbors)}
    
    # Step 3: Retrieve claims mentioning these nodes
    trace.append(RetrievalTraceStep(step="retrieve_claims", params={}, counts={}))
    node_ids = [ego_node.node_id] + [n["concept"].node_id for n in neighbors[:10]]
    
    # Get communities for these nodes
    communities = retrieve_focus_communities(session, graph_id, branch_id, query, k=3)
    community_ids = [c["community_id"] for c in communities]
    
    claims = retrieve_claims_for_community_ids(
        session, graph_id, branch_id, community_ids, limit_per=20, ingestion_run_id=ingestion_run_id
    )
    trace[-1].counts = {"claims": len(claims)}
    
    # Step 4: Build evidence subgraph
    trace.append(RetrievalTraceStep(step="build_evidence_subgraph", params={}, counts={}))
    claim_ids = [c["claim_id"] for c in claims[:30]]
    subgraph = build_evidence_subgraph_from_claim_ids(
        session, graph_id, branch_id, claim_ids, max_concepts=40
    )
    trace[-1].counts = {
        "concepts": len(subgraph.get("concepts", [])),
        "edges": len(subgraph.get("edges", []))
    }
    
    # Step 5: Fetch chunks
    trace.append(RetrievalTraceStep(step="fetch_chunks", params={}, counts={}))
    chunk_ids = [c.get("chunk_id") for c in claims[:15] if c.get("chunk_id")]
    chunks = fetch_source_chunks_by_ids(session, graph_id, branch_id, chunk_ids)
    trace[-1].counts = {"chunks": len(chunks)}
    
    # Build network edges
    network_edges = []
    for neighbor in neighbors[:20]:
        network_edges.append({
            "source_id": ego_node.node_id,
            "target_id": neighbor["concept"].node_id,
            "predicate": neighbor.get("predicate"),
            "is_outgoing": neighbor.get("is_outgoing"),
            "status": neighbor.get("relationship_status"),
            "confidence": neighbor.get("relationship_confidence"),
        })
    
    focus_entities = [{
        "node_id": ego_node.node_id,
        "name": ego_node.name,
        "domain": ego_node.domain,
        "type": ego_node.type,
        "description": ego_node.description,
        "tags": ego_node.tags,
    }] + [{
        "node_id": n["concept"].node_id,
        "name": n["concept"].name,
        "domain": n["concept"].domain,
        "type": n["concept"].type,
        "description": n["concept"].description,
        "tags": n["concept"].tags,
    } for n in neighbors[:15]]
    
    context = {
        "focus_entities": focus_entities,
        "focus_communities": communities,
        "claims": claims[:20],
        "chunks": chunks,
        "subgraph": subgraph,
        "network_edges": network_edges,
        "suggestions": [],
        "warnings": [],
    }
    
    return RetrievalResult(
        intent=Intent.WHO_NETWORK.value,
        trace=trace,
        context=context
    )


def plan_evidence_check(
    session: Session,
    query: str,
    graph_id: str,
    branch_id: str,
    limit: int,
    detail_level: str = "summary",
    ingestion_run_id: Optional[Any] = None
) -> RetrievalResult:
    """Plan 6: EVIDENCE_CHECK"""
    trace = []
    
    # Step 1: Retrieve claims directly by query embedding
    trace.append(RetrievalTraceStep(step="retrieve_claims_by_embedding", params={"limit": 25}, counts={}))
    claims = retrieve_top_claims_by_query_embedding(
        session, graph_id, branch_id, query, limit=25, ingestion_run_id=ingestion_run_id
    )
    trace[-1].counts = {"claims": len(claims)}
    
    if not claims:
        return _empty_result(Intent.EVIDENCE_CHECK.value, trace)
    
    # Step 2: Fetch chunks (all)
    trace.append(RetrievalTraceStep(step="fetch_chunks", params={}, counts={}))
    chunk_ids = [c.get("chunk_id") for c in claims if c.get("chunk_id")]
    chunks = fetch_source_chunks_by_ids(session, graph_id, branch_id, chunk_ids)
    trace[-1].counts = {"chunks": len(chunks)}
    
    # Step 3: Compute source diversity
    trace.append(RetrievalTraceStep(step="compute_source_diversity", params={}, counts={}))
    source_ids = set(c.get("source_id") for c in claims if c.get("source_id"))
    trace[-1].counts = {"unique_sources": len(source_ids)}
    
    # Step 4: Identify supporting vs conflicting claims
    trace.append(RetrievalTraceStep(step="classify_claims", params={}, counts={}))
    
    # Heuristic: claims with negation words or high distance to centroid
    negation_words = ["not", "no", "never", "none", "cannot", "doesn't", "don't", "isn't", "wasn't"]
    supporting = []
    conflicting = []
    
    for claim in claims:
        text_lower = claim.get("text", "").lower()
        has_negation = any(word in text_lower for word in negation_words)
        
        if has_negation:
            conflicting.append(claim)
        else:
            supporting.append(claim)
    
    trace[-1].counts = {
        "supporting": len(supporting),
        "conflicting": len(conflicting)
    }
    
    # Step 5: Build evidence subgraph
    trace.append(RetrievalTraceStep(step="build_evidence_subgraph", params={}, counts={}))
    all_claim_ids = [c["claim_id"] for c in claims[:30]]
    subgraph = build_evidence_subgraph_from_claim_ids(
        session, graph_id, branch_id, all_claim_ids, max_concepts=30
    )
    trace[-1].counts = {
        "concepts": len(subgraph.get("concepts", [])),
        "edges": len(subgraph.get("edges", []))
    }
    
    context = {
        "focus_entities": subgraph.get("concepts", [])[:15],
        "focus_communities": [],
        "claims": claims[:25],
        "chunks": chunks,
        "subgraph": subgraph,
        "evidence": {
            "supporting": supporting[:15],
            "conflicting": conflicting[:10],
            "sources": list(source_ids)[:10],
        },
        "suggestions": [],
        "warnings": [],
    }
    
    return RetrievalResult(
        intent=Intent.EVIDENCE_CHECK.value,
        trace=trace,
        context=context
    )


def plan_explore_next(
    session: Session,
    query: str,
    graph_id: str,
    branch_id: str,
    limit: int,
    detail_level: str = "summary",
    ingestion_run_id: Optional[Any] = None
) -> RetrievalResult:
    """Plan 7: EXPLORE_NEXT"""
    trace = []
    
    # Step 1: Run DEFINITION_OVERVIEW plan first
    trace.append(RetrievalTraceStep(step="run_definition_overview", params={}, counts={}))
    overview_result = plan_definition_overview(session, query, graph_id, branch_id, limit, detail_level, ingestion_run_id)
    trace[-1].counts = {
        "concepts": len(overview_result.context.get("focus_entities", [])),
        "claims": len(overview_result.context.get("claims", []))
    }
    
    subgraph = overview_result.context.get("subgraph", {})
    concepts = subgraph.get("concepts", [])
    edges = subgraph.get("edges", [])
    
    # Step 2: Rank next nodes
    trace.append(RetrievalTraceStep(step="rank_next_nodes", params={}, counts={}))
    ranked_concepts = rank_concepts_for_explore(concepts, edges)
    trace[-1].counts = {"ranked_concepts": len(ranked_concepts)}
    
    # Step 3: Generate suggestions
    trace.append(RetrievalTraceStep(step="generate_suggestions", params={}, counts={}))
    suggestions = []
    
    for concept in ranked_concepts[:5]:
        name = concept.get("name", "")
        suggestions.append({
            "label": f"Explore {name}",
            "query": f"What is {name}?",
            "intent": Intent.DEFINITION_OVERVIEW.value,
        })
    
    trace[-1].counts = {"suggestions": len(suggestions)}
    
    context = {
        "focus_entities": ranked_concepts[:15],
        "focus_communities": overview_result.context.get("focus_communities", []),
        "claims": overview_result.context.get("claims", [])[:15],
        "chunks": overview_result.context.get("chunks", [])[:10],
        "subgraph": subgraph,
        "suggestions": suggestions,
        "warnings": [],
    }
    
    return RetrievalResult(
        intent=Intent.EXPLORE_NEXT.value,
        trace=trace,
        context=context
    )


def plan_what_changed(
    session: Session,
    query: str,
    graph_id: str,
    branch_id: str,
    limit: int,
    detail_level: str = "summary",
    since_days: int = 30
) -> RetrievalResult:
    """Plan 8: WHAT_CHANGED"""
    trace = []
    
    ensure_graph_scoping_initialized(session)
    
    # Step 1: Query for claims updated within window
    trace.append(RetrievalTraceStep(step="query_recent_claims", params={"since_days": since_days}, counts={}))
    
    cutoff_timestamp = int((datetime.utcnow() - timedelta(days=since_days)).timestamp() * 1000)
    
    query_cypher = """
    MATCH (g:GraphSpace {graph_id: $graph_id})
    MATCH (claim:Claim {graph_id: $graph_id})-[:BELONGS_TO]->(g)
    WHERE $branch_id IN COALESCE(claim.on_branches, [])
      AND (claim.updated_at >= $cutoff OR claim.created_at >= $cutoff)
    OPTIONAL MATCH (claim)-[:SUPPORTED_BY]->(chunk:SourceChunk {graph_id: $graph_id})
    RETURN claim.claim_id AS claim_id,
           claim.text AS text,
           COALESCE(claim.confidence, 0.5) AS confidence,
           claim.source_id AS source_id,
           claim.source_span AS source_span,
           claim.created_at AS created_at,
           claim.updated_at AS updated_at,
           chunk.chunk_id AS chunk_id
    ORDER BY COALESCE(claim.updated_at, claim.created_at) DESC
    LIMIT 50
    """
    
    result = session.run(
        query_cypher,
        graph_id=graph_id,
        branch_id=branch_id,
        cutoff=cutoff_timestamp
    )
    
    claims = []
    for record in result:
        claims.append({
            "claim_id": record["claim_id"],
            "text": record["text"],
            "confidence": record["confidence"],
            "source_id": record["source_id"],
            "source_span": record["source_span"],
            "chunk_id": record.get("chunk_id"),
            "created_at": record.get("created_at"),
            "updated_at": record.get("updated_at"),
        })
    
    trace[-1].counts = {"claims": len(claims)}
    
    if not claims:
        return _empty_result(Intent.WHAT_CHANGED.value, trace, warning=f"No claims updated in last {since_days} days")
    
    # Step 2: Retrieve associated chunks and concepts
    trace.append(RetrievalTraceStep(step="retrieve_chunks_and_concepts", params={}, counts={}))
    chunk_ids = [c.get("chunk_id") for c in claims if c.get("chunk_id")]
    chunks = fetch_source_chunks_by_ids(session, graph_id, branch_id, chunk_ids)
    
    claim_ids = [c["claim_id"] for c in claims]
    subgraph = build_evidence_subgraph_from_claim_ids(
        session, graph_id, branch_id, claim_ids, max_concepts=30
    )
    
    trace[-1].counts = {
        "chunks": len(chunks),
        "concepts": len(subgraph.get("concepts", []))
    }
    
    # Step 3: Identify new vs updated
    trace.append(RetrievalTraceStep(step="classify_changes", params={}, counts={}))
    new_claims = [c for c in claims if c.get("created_at") and c.get("created_at") >= cutoff_timestamp]
    updated_claims = [c for c in claims if c.get("updated_at") and c.get("updated_at") >= cutoff_timestamp and c not in new_claims]
    
    trace[-1].counts = {
        "new_claims": len(new_claims),
        "updated_claims": len(updated_claims)
    }
    
    context = {
        "focus_entities": subgraph.get("concepts", [])[:15],
        "focus_communities": [],
        "claims": claims[:30],
        "chunks": chunks[:20],
        "subgraph": subgraph,
        "deltas": {
            "new_claims": new_claims[:15],
            "updated_claims": updated_claims[:15],
            "new_concepts": [],  # Could be enhanced to detect new concepts
        },
        "suggestions": [],
        "warnings": [],
    }
    
    return RetrievalResult(
        intent=Intent.WHAT_CHANGED.value,
        trace=trace,
        context=context
    )


def plan_self_knowledge(
    session: Session,
    query: str,
    graph_id: str,
    branch_id: str,
    limit: int,
    detail_level: str = "summary",
    ingestion_run_id: Optional[Any] = None
) -> RetrievalResult:
    """Plan 9: SELF_KNOWLEDGE - Focusing on what the user already has in their graph."""
    trace = []
    
    # Step 1: Semantic search for nodes in the user's graph
    trace.append(RetrievalTraceStep(
        step="semantic_search_nodes",
        params={"limit": limit},
        counts={}
    ))
    # Note: semantic_search_nodes needs graph_id/branch_id for better results usually
    # but here we rely on the internal implementation's scoping if available.
    search_results = semantic_search_nodes(query, session, limit=limit)
    top_nodes = [r["node"] for r in search_results]
    trace[-1].counts = {"concepts": len(top_nodes)}
    
    if not top_nodes:
        # If no concepts found, try searching claims directly by embedding
        trace.append(RetrievalTraceStep(step="fallback_semantic_claims", params={"limit": 10}, counts={}))
        from services_retrieval_helpers import retrieve_top_claims_by_query_embedding
        claims = retrieve_top_claims_by_query_embedding(session, graph_id, branch_id, query, limit=10)
        trace[-1].counts = {"claims": len(claims)}
        
        if not claims:
            return _empty_result(Intent.SELF_KNOWLEDGE.value, trace)
            
        # Build subgraph from these claims
        subgraph = build_evidence_subgraph_from_claim_ids(session, graph_id, branch_id, [c["claim_id"] for c in claims])
        
        context = {
            "focus_entities": subgraph.get("concepts", [])[:10],
            "claims": claims,
            "chunks": fetch_source_chunks_by_ids(session, graph_id, branch_id, [c.get("chunk_id") for c in claims if c.get("chunk_id")]),
            "subgraph": subgraph,
            "suggestions": [],
            "warnings": ["No direct concepts found; showing semantically relevant notes."]
        }
        return RetrievalResult(intent=Intent.SELF_KNOWLEDGE.value, trace=trace, context=context)

    node_ids = [n.node_id for n in top_nodes]
    
    # Step 2: Get neighboring relationships for these nodes
    trace.append(RetrievalTraceStep(
        step="get_subgraph_for_nodes",
        params={"node_ids": node_ids},
        counts={}
    ))
    
    # Find all relationships between these nodes or their immediate neighbors with proper scoping
    subgraph_query = """
    MATCH (g:GraphSpace {graph_id: $graph_id})
    MATCH (n:Concept {graph_id: $graph_id})-[:BELONGS_TO]->(g)
    WHERE n.node_id IN $node_ids
      AND $branch_id IN COALESCE(n.on_branches, [])
    MATCH (n)-[r]-(m:Concept)-[:BELONGS_TO]->(g)
    WHERE $branch_id IN COALESCE(m.on_branches, [])
      AND $branch_id IN COALESCE(r.on_branches, [])
    RETURN n.node_id AS src_id, n.name AS src_name,
           m.node_id AS dst_id, m.name AS dst_name,
           type(r) AS predicate,
           COALESCE(r.confidence, 1.0) AS confidence
    LIMIT 50
    """
    subgraph_result = session.run(subgraph_query, graph_id=graph_id, branch_id=branch_id, node_ids=node_ids)
    
    concepts_dict = {n.node_id: {"node_id": n.node_id, "name": n.name, "domain": n.domain, "type": n.type} for n in top_nodes}
    edges = []
    
    for record in subgraph_result:
        src_id = record["src_id"]
        dst_id = record["dst_id"]
        
        if dst_id not in concepts_dict:
            concepts_dict[dst_id] = {
                "node_id": dst_id,
                "name": record["dst_name"],
                "type": "concept"
            }
            
        edges.append({
            "src": src_id,
            "dst": dst_id,
            "predicate": record["predicate"],
            "confidence": record["confidence"]
        })
    
    trace[-1].counts = {
        "concepts": len(concepts_dict),
        "edges": len(edges)
    }
    
    # Step 3: Fetch claims related to these concepts (using correct :MENTIONS relationship)
    trace.append(RetrievalTraceStep(
        step="retrieve_claims_for_concepts",
        params={"limit": 30},
        counts={}
    ))
    
    claims_query = """
    MATCH (g:GraphSpace {graph_id: $graph_id})
    MATCH (n:Concept {graph_id: $graph_id})-[:BELONGS_TO]->(g)
    WHERE n.node_id IN $node_ids
      AND $branch_id IN COALESCE(n.on_branches, [])
    MATCH (claim:Claim {graph_id: $graph_id})-[:MENTIONS]->(n)
    WHERE $branch_id IN COALESCE(claim.on_branches, [])
    RETURN claim.claim_id AS claim_id,
           claim.text AS text,
           claim.source_id AS source_id,
           claim.chunk_id AS chunk_id
    LIMIT 30
    """
    claims_result = session.run(claims_query, graph_id=graph_id, branch_id=branch_id, node_ids=list(concepts_dict.keys()))
    claims = []
    for record in claims_result:
        claims.append({
            "claim_id": record["claim_id"],
            "text": record["text"],
            "source_id": record.get("source_id"),
            "chunk_id": record.get("chunk_id")
        })
    
    # Hybrid Step: Also add semantic search for claims to be sure
    from services_retrieval_helpers import retrieve_top_claims_by_query_embedding
    semantic_claims = retrieve_top_claims_by_query_embedding(session, graph_id, branch_id, query, limit=10)
    # Merge and dedupe
    existing_claim_ids = {c["claim_id"] for c in claims}
    for sc in semantic_claims:
        if sc["claim_id"] not in existing_claim_ids:
            claims.append(sc)
            existing_claim_ids.add(sc["claim_id"])
    
    trace[-1].counts = {"claims": len(claims)}
    
    # Step 4: Fetch chunks if available
    trace.append(RetrievalTraceStep(step="fetch_chunks", params={}, counts={}))
    chunk_ids = [c.get("chunk_id") for c in claims if c.get("chunk_id")]
    chunks = fetch_source_chunks_by_ids(session, graph_id, branch_id, chunk_ids)
    trace[-1].counts = {"chunks": len(chunks)}
    
    context = {
        "focus_entities": list(concepts_dict.values())[:15],
        "claims": claims[:30],
        "chunks": chunks[:15],
        "subgraph": {
            "concepts": list(concepts_dict.values()),
            "edges": edges
        },
        "suggestions": [
            {"label": "Explore Connections", "query": f"How is {top_nodes[0].name} connected to other things?", "intent": Intent.WHO_NETWORK.value},
            {"label": "Detailed Timeline", "query": f"Timeline of {top_nodes[0].name}", "intent": Intent.TIMELINE.value}
        ],
        "warnings": []
    }
    
    return RetrievalResult(
        intent=Intent.SELF_KNOWLEDGE.value,
        trace=trace,
        context=context
    )


def _empty_result(intent: str, trace: List[RetrievalTraceStep], warning: str = "No results found") -> RetrievalResult:
    """Helper to create empty result."""
    return RetrievalResult(
        intent=intent,
        trace=trace,
        context={
            "focus_entities": [],
            "focus_communities": [],
            "claims": [],
            "chunks": [],
            "subgraph": {"concepts": [], "edges": []},
            "suggestions": [],
            "warnings": [warning],
        }
    )
