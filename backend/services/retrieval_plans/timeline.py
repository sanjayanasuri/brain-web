"""Plan 2: TIMELINE."""
import json
import re
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


def plan_timeline(
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
        return _empty_result(Intent.TIMELINE.value, trace)

    community_ids = [c["community_id"] for c in communities]

    trace.append(RetrievalTraceStep(step="retrieve_claims", params={"limit_per": 20}, counts={}))
    claims = retrieve_claims_for_community_ids(
        session, graph_id, branch_id, community_ids, limit_per=20, ingestion_run_id=ingestion_run_id
    )
    trace[-1].counts = {"claims": len(claims)}

    if not claims:
        return _empty_result(Intent.TIMELINE.value, trace)

    trace.append(RetrievalTraceStep(step="fetch_chunks", params={}, counts={}))
    chunk_ids = [c.get("chunk_id") for c in claims if c.get("chunk_id")]
    chunks = fetch_source_chunks_by_ids(session, graph_id, branch_id, chunk_ids)
    trace[-1].counts = {"chunks": len(chunks)}

    trace.append(RetrievalTraceStep(step="extract_timestamps", params={}, counts={}))
    timeline_items = []
    chunk_map = {chunk["chunk_id"]: chunk for chunk in chunks}

    for claim in claims:
        chunk_id = claim.get("chunk_id")
        chunk = chunk_map.get(chunk_id) if chunk_id else None

        date_str = None
        if chunk:
            metadata = chunk.get("metadata")
            if metadata:
                if isinstance(metadata, str):
                    try:
                        metadata = json.loads(metadata)
                    except Exception:
                        pass
                if isinstance(metadata, dict):
                    date_str = metadata.get("published_at") or metadata.get("date") or metadata.get("timestamp")
            if not date_str:
                date_str = chunk.get("published_at")
            if not date_str and chunk.get("text"):
                text = chunk["text"]
                date_match = re.search(r"\b(19|20)\d{2}\b", text)
                if date_match:
                    date_str = date_match.group(0)

        timeline_items.append({
            "date": date_str or "unknown",
            "claim_id": claim["claim_id"],
            "text": claim["text"],
            "chunk_id": chunk_id,
            "source_id": claim.get("source_id"),
        })

    timeline_items.sort(key=lambda x: (x["date"] if x["date"] != "unknown" and x["date"] else "9999"))
    trace[-1].counts = {"timeline_items": len(timeline_items)}

    trace.append(RetrievalTraceStep(step="build_evidence_subgraph", params={"max_concepts": 25}, counts={}))
    top_claim_ids = [c["claim_id"] for c in claims[:25]]
    subgraph = build_evidence_subgraph_from_claim_ids(
        session, graph_id, branch_id, top_claim_ids, max_concepts=25
    )
    trace[-1].counts = {
        "concepts": len(subgraph.get("concepts", [])),
        "edges": len(subgraph.get("edges", [])),
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

    return RetrievalResult(intent=Intent.TIMELINE.value, trace=trace, context=context)
