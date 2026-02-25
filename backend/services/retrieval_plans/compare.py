"""Plan 4: COMPARE."""
from typing import Any, Optional

from neo4j import Session

from services_retrieval_helpers import (
    retrieve_focus_communities,
    retrieve_claims_for_community_ids,
    fetch_source_chunks_by_ids,
    build_evidence_subgraph_from_claim_ids,
)
from models import RetrievalResult, RetrievalTraceStep, Intent

from .core import _empty_result, _identify_compare_targets


def plan_compare(
    session: Session,
    query: str,
    graph_id: str,
    branch_id: str,
    limit: int,
    detail_level: str = "summary",
    ingestion_run_id: Optional[Any] = None,
) -> RetrievalResult:
    trace = []

    trace.append(RetrievalTraceStep(step="identify_targets", params={}, counts={}))
    targets, target_method = _identify_compare_targets(query, session)
    trace[-1].params = {"method": target_method}
    trace[-1].counts = {"targets": len(targets)}

    if len(targets) < 2:
        return _empty_result(Intent.COMPARE.value, trace, warning="Could not identify two targets for comparison")

    target_a, target_b = targets[0], targets[1]

    trace.append(RetrievalTraceStep(step="retrieve_communities_per_target", params={"k": 2}, counts={}))
    communities_a = retrieve_focus_communities(session, graph_id, branch_id, target_a, k=2)
    communities_b = retrieve_focus_communities(session, graph_id, branch_id, target_b, k=2)
    trace[-1].counts = {
        "communities_a": len(communities_a),
        "communities_b": len(communities_b),
    }

    trace.append(RetrievalTraceStep(step="retrieve_claims", params={"limit_per": 20}, counts={}))
    claims_a = retrieve_claims_for_community_ids(
        session, graph_id, branch_id, [c["community_id"] for c in communities_a], limit_per=20, ingestion_run_id=ingestion_run_id
    )
    claims_b = retrieve_claims_for_community_ids(
        session, graph_id, branch_id, [c["community_id"] for c in communities_b], limit_per=20, ingestion_run_id=ingestion_run_id
    )
    all_claims = claims_a + claims_b
    trace[-1].counts = {"claims": len(all_claims)}

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
    shared_concepts = [c for node_id, c in concepts_a.items() if node_id in concepts_b]
    shared_communities = [c for c in communities_a if c["community_id"] in [c2["community_id"] for c2 in communities_b]]

    trace[-1].counts = {
        "concepts_a": len(concepts_a),
        "concepts_b": len(concepts_b),
        "shared_concepts": len(shared_concepts),
    }

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

    return RetrievalResult(intent=Intent.COMPARE.value, trace=trace, context=context)
