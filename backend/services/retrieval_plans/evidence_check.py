"""Plan 6: EVIDENCE_CHECK."""
from typing import Any, Optional

from neo4j import Session

from services_retrieval_helpers import (
    retrieve_top_claims_by_query_embedding,
    fetch_source_chunks_by_ids,
    build_evidence_subgraph_from_claim_ids,
)
from models import RetrievalResult, RetrievalTraceStep, Intent

from .core import _empty_result


def plan_evidence_check(
    session: Session,
    query: str,
    graph_id: str,
    branch_id: str,
    limit: int,
    detail_level: str = "summary",
    ingestion_run_id: Optional[Any] = None,
) -> RetrievalResult:
    trace = []

    trace.append(RetrievalTraceStep(step="retrieve_claims_by_embedding", params={"limit": 25}, counts={}))
    claims = retrieve_top_claims_by_query_embedding(
        session, graph_id, branch_id, query, limit=25, ingestion_run_id=ingestion_run_id
    )
    trace[-1].counts = {"claims": len(claims)}

    if not claims:
        return _empty_result(Intent.EVIDENCE_CHECK.value, trace)

    trace.append(RetrievalTraceStep(step="fetch_chunks", params={}, counts={}))
    chunk_ids = [c.get("chunk_id") for c in claims if c.get("chunk_id")]
    chunks = fetch_source_chunks_by_ids(session, graph_id, branch_id, chunk_ids)
    trace[-1].counts = {"chunks": len(chunks)}

    trace.append(RetrievalTraceStep(step="compute_source_diversity", params={}, counts={}))
    source_ids = set(c.get("source_id") for c in claims if c.get("source_id"))
    trace[-1].counts = {"unique_sources": len(source_ids)}

    trace.append(RetrievalTraceStep(step="classify_claims", params={}, counts={}))
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
    trace[-1].counts = {"supporting": len(supporting), "conflicting": len(conflicting)}

    trace.append(RetrievalTraceStep(step="build_evidence_subgraph", params={}, counts={}))
    all_claim_ids = [c["claim_id"] for c in claims[:30]]
    subgraph = build_evidence_subgraph_from_claim_ids(
        session, graph_id, branch_id, all_claim_ids, max_concepts=30
    )
    trace[-1].counts = {
        "concepts": len(subgraph.get("concepts", [])),
        "edges": len(subgraph.get("edges", [])),
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

    return RetrievalResult(intent=Intent.EVIDENCE_CHECK.value, trace=trace, context=context)
