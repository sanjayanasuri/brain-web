"""Plan 8: WHAT_CHANGED."""
from datetime import datetime, timedelta

from neo4j import Session

from services_branch_explorer import ensure_graph_scoping_initialized
from services_retrieval_helpers import fetch_source_chunks_by_ids, build_evidence_subgraph_from_claim_ids
from models import RetrievalResult, RetrievalTraceStep, Intent

from .core import _empty_result


def plan_what_changed(
    session: Session,
    query: str,
    graph_id: str,
    branch_id: str,
    limit: int,
    detail_level: str = "summary",
    since_days: int = 30,
) -> RetrievalResult:
    trace = []

    ensure_graph_scoping_initialized(session)

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
        cutoff=cutoff_timestamp,
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

    trace.append(RetrievalTraceStep(step="retrieve_chunks_and_concepts", params={}, counts={}))
    chunk_ids = [c.get("chunk_id") for c in claims if c.get("chunk_id")]
    chunks = fetch_source_chunks_by_ids(session, graph_id, branch_id, chunk_ids)
    claim_ids = [c["claim_id"] for c in claims]
    subgraph = build_evidence_subgraph_from_claim_ids(
        session, graph_id, branch_id, claim_ids, max_concepts=30
    )
    trace[-1].counts = {
        "chunks": len(chunks),
        "concepts": len(subgraph.get("concepts", [])),
    }

    trace.append(RetrievalTraceStep(step="classify_changes", params={}, counts={}))
    new_claims = [c for c in claims if c.get("created_at") and c.get("created_at") >= cutoff_timestamp]
    updated_claims = [
        c for c in claims
        if c.get("updated_at") and c.get("updated_at") >= cutoff_timestamp and c not in new_claims
    ]
    trace[-1].counts = {"new_claims": len(new_claims), "updated_claims": len(updated_claims)}

    context = {
        "focus_entities": subgraph.get("concepts", [])[:15],
        "focus_communities": [],
        "claims": claims[:30],
        "chunks": chunks[:20],
        "subgraph": subgraph,
        "deltas": {
            "new_claims": new_claims[:15],
            "updated_claims": updated_claims[:15],
            "new_concepts": [],
        },
        "suggestions": [],
        "warnings": [],
    }

    return RetrievalResult(intent=Intent.WHAT_CHANGED.value, trace=trace, context=context)
