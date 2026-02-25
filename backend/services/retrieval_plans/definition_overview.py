"""Plan 1: DEFINITION_OVERVIEW."""
from typing import Any, Optional

from neo4j import Session

from services_retrieval_helpers import (
    retrieve_focus_communities,
    retrieve_claims_for_community_ids,
    fetch_source_chunks_by_ids,
    build_evidence_subgraph_from_claim_ids,
)
from models import RetrievalResult, RetrievalTraceStep, Intent

from .core import _empty_result


def plan_definition_overview(
    session: Session,
    query: str,
    graph_id: str,
    branch_id: str,
    limit: int,
    detail_level: str = "summary",
    ingestion_run_id: Optional[Any] = None,
) -> RetrievalResult:
    trace = []

    trace.append(RetrievalTraceStep(step="semantic_search_communities", params={"k": 2}, counts={}))
    communities = retrieve_focus_communities(session, graph_id, branch_id, query, k=2)
    trace[-1].counts = {"communities": len(communities)}

    if not communities:
        return _empty_result(Intent.DEFINITION_OVERVIEW.value, trace)

    community_ids = [c["community_id"] for c in communities]

    trace.append(RetrievalTraceStep(step="retrieve_claims_for_communities", params={"limit_per": 15}, counts={}))
    claims = retrieve_claims_for_community_ids(
        session, graph_id, branch_id, community_ids, limit_per=15, ingestion_run_id=ingestion_run_id
    )
    trace[-1].counts = {"claims": len(claims)}

    if not claims:
        return _empty_result(Intent.DEFINITION_OVERVIEW.value, trace)

    claim_ids = [c["claim_id"] for c in claims[:30]]

    trace.append(RetrievalTraceStep(step="build_evidence_subgraph", params={"max_concepts": 30}, counts={}))
    subgraph = build_evidence_subgraph_from_claim_ids(
        session, graph_id, branch_id, claim_ids, max_concepts=30
    )
    trace[-1].counts = {
        "concepts": len(subgraph.get("concepts", [])),
        "edges": len(subgraph.get("edges", [])),
    }

    trace.append(RetrievalTraceStep(step="fetch_chunks", params={"limit": 10}, counts={}))
    top_claim_chunk_ids = [c.get("chunk_id") for c in claims[:10] if c.get("chunk_id")]
    chunks = fetch_source_chunks_by_ids(session, graph_id, branch_id, top_claim_chunk_ids)
    trace[-1].counts = {"chunks": len(chunks)}

    focus_entities = subgraph.get("concepts", [])[:10]

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
        context=context,
    )
