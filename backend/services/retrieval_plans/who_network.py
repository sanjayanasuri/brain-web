"""Plan 5: WHO_NETWORK."""
from typing import Any, Optional

from neo4j import Session

from services_retrieval_helpers import (
    retrieve_focus_communities,
    retrieve_claims_for_community_ids,
    fetch_source_chunks_by_ids,
    build_evidence_subgraph_from_claim_ids,
)
from services_search import semantic_search_nodes
from services_graph import get_neighbors_with_relationships
from models import RetrievalResult, RetrievalTraceStep, Intent

from .core import _empty_result


def plan_who_network(
    session: Session,
    query: str,
    graph_id: str,
    branch_id: str,
    limit: int,
    detail_level: str = "summary",
    ingestion_run_id: Optional[Any] = None,
) -> RetrievalResult:
    trace = []

    trace.append(RetrievalTraceStep(step="semantic_search_concepts", params={"limit": 3}, counts={}))
    results = semantic_search_nodes(query, session, limit=3)
    top_nodes = [r["node"] for r in results]
    trace[-1].counts = {"concepts": len(top_nodes)}

    if not top_nodes:
        return _empty_result(Intent.WHO_NETWORK.value, trace)

    trace.append(RetrievalTraceStep(step="get_neighbors", params={"status": None}, counts={}))
    ego_node = top_nodes[0]
    neighbors = get_neighbors_with_relationships(session, ego_node.node_id, include_proposed="all")
    trace[-1].counts = {"neighbors": len(neighbors)}

    trace.append(RetrievalTraceStep(step="retrieve_claims", params={}, counts={}))
    node_ids = [ego_node.node_id] + [n["concept"].node_id for n in neighbors[:10]]
    communities = retrieve_focus_communities(session, graph_id, branch_id, query, k=3)
    community_ids = [c["community_id"] for c in communities]
    claims = retrieve_claims_for_community_ids(
        session, graph_id, branch_id, community_ids, limit_per=20, ingestion_run_id=ingestion_run_id
    )
    trace[-1].counts = {"claims": len(claims)}

    trace.append(RetrievalTraceStep(step="build_evidence_subgraph", params={}, counts={}))
    claim_ids = [c["claim_id"] for c in claims[:30]]
    subgraph = build_evidence_subgraph_from_claim_ids(
        session, graph_id, branch_id, claim_ids, max_concepts=40
    )
    trace[-1].counts = {
        "concepts": len(subgraph.get("concepts", [])),
        "edges": len(subgraph.get("edges", [])),
    }

    trace.append(RetrievalTraceStep(step="fetch_chunks", params={}, counts={}))
    chunk_ids = [c.get("chunk_id") for c in claims[:15] if c.get("chunk_id")]
    chunks = fetch_source_chunks_by_ids(session, graph_id, branch_id, chunk_ids)
    trace[-1].counts = {"chunks": len(chunks)}

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

    focus_entities = [
        {
            "node_id": ego_node.node_id,
            "name": ego_node.name,
            "domain": ego_node.domain,
            "type": ego_node.type,
            "description": ego_node.description,
            "tags": ego_node.tags,
        }
    ] + [
        {
            "node_id": n["concept"].node_id,
            "name": n["concept"].name,
            "domain": n["concept"].domain,
            "type": n["concept"].type,
            "description": n["concept"].description,
            "tags": n["concept"].tags,
        }
        for n in neighbors[:15]
    ]

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

    return RetrievalResult(intent=Intent.WHO_NETWORK.value, trace=trace, context=context)
