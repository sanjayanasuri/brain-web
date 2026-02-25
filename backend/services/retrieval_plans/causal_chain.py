"""Plan 3: CAUSAL_CHAIN."""
from typing import Any, Optional

from neo4j import Session

from services_retrieval_helpers import (
    retrieve_focus_communities,
    retrieve_claims_for_community_ids,
    fetch_source_chunks_by_ids,
    build_evidence_subgraph_from_claim_ids,
)
from services_graphrag import find_shortest_path_edges
from models import RetrievalResult, RetrievalTraceStep, Intent

from .core import _empty_result


def plan_causal_chain(
    session: Session,
    query: str,
    graph_id: str,
    branch_id: str,
    limit: int,
    detail_level: str = "summary",
    ingestion_run_id: Optional[Any] = None,
) -> RetrievalResult:
    trace = []

    trace.append(RetrievalTraceStep(step="retrieve_communities", params={"k": 3}, counts={}))
    communities = retrieve_focus_communities(session, graph_id, branch_id, query, k=3)
    trace[-1].counts = {"communities": len(communities)}

    if not communities:
        return _empty_result(Intent.CAUSAL_CHAIN.value, trace)

    community_ids = [c["community_id"] for c in communities]

    trace.append(RetrievalTraceStep(step="retrieve_claims", params={"limit_per": 30}, counts={}))
    claims = retrieve_claims_for_community_ids(
        session, graph_id, branch_id, community_ids, limit_per=30, ingestion_run_id=ingestion_run_id
    )
    trace[-1].counts = {"claims": len(claims)}

    if not claims:
        return _empty_result(Intent.CAUSAL_CHAIN.value, trace)

    trace.append(RetrievalTraceStep(step="build_evidence_subgraph", params={"max_concepts": 50}, counts={}))
    claim_ids = [c["claim_id"] for c in claims[:50]]
    subgraph = build_evidence_subgraph_from_claim_ids(
        session, graph_id, branch_id, claim_ids, max_concepts=50
    )
    trace[-1].counts = {
        "concepts": len(subgraph.get("concepts", [])),
        "edges": len(subgraph.get("edges", [])),
    }

    concepts = subgraph.get("concepts", [])
    edges = subgraph.get("edges", [])

    trace.append(RetrievalTraceStep(step="extract_causal_paths", params={}, counts={}))
    anchor_concepts = []
    if concepts:
        query_lower = query.lower()
        concept_scores = []
        for concept in concepts[:20]:
            name = concept.get("name", "").lower()
            score = sum(1 for word in query_lower.split() if word in name)
            concept_scores.append((concept, score))
        concept_scores.sort(key=lambda x: x[1], reverse=True)
        anchor_concepts = [c[0] for c, _ in concept_scores[:3]]

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
                    path_node_ids = set()
                    for edge in path_edges:
                        path_node_ids.add(edge["src"])
                        path_node_ids.add(edge["dst"])
                    supporting_claim_ids = [
                        c["claim_id"] for c in claims
                        if any(node_id in path_node_ids for node_id in [])
                    ]
                    causal_paths.append({
                        "nodes": list(path_node_ids),
                        "edges": path_edges,
                        "supporting_claim_ids": supporting_claim_ids[:10],
                    })

    trace[-1].counts = {"causal_paths": len(causal_paths)}

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

    return RetrievalResult(intent=Intent.CAUSAL_CHAIN.value, trace=trace, context=context)
