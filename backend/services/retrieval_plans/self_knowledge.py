"""Plan 9: SELF_KNOWLEDGE."""
from typing import Any, Optional

from neo4j import Session

from services_retrieval_helpers import (
    retrieve_top_claims_by_query_embedding,
    fetch_source_chunks_by_ids,
    build_evidence_subgraph_from_claim_ids,
)
from services_search import semantic_search_nodes
from models import RetrievalResult, RetrievalTraceStep, Intent

from .core import _empty_result


def plan_self_knowledge(
    session: Session,
    query: str,
    graph_id: str,
    branch_id: str,
    limit: int,
    detail_level: str = "summary",
    ingestion_run_id: Optional[Any] = None,
) -> RetrievalResult:
    trace = []

    trace.append(RetrievalTraceStep(step="semantic_search_nodes", params={"limit": limit}, counts={}))
    search_results = semantic_search_nodes(query, session, limit=limit)
    top_nodes = [r["node"] for r in search_results]
    trace[-1].counts = {"concepts": len(top_nodes)}

    if not top_nodes:
        trace.append(RetrievalTraceStep(step="fallback_semantic_claims", params={"limit": 10}, counts={}))
        claims = retrieve_top_claims_by_query_embedding(session, graph_id, branch_id, query, limit=10)
        trace[-1].counts = {"claims": len(claims)}

        if not claims:
            return _empty_result(Intent.SELF_KNOWLEDGE.value, trace)

        subgraph = build_evidence_subgraph_from_claim_ids(
            session, graph_id, branch_id, [c["claim_id"] for c in claims]
        )
        context = {
            "focus_entities": subgraph.get("concepts", [])[:10],
            "claims": claims,
            "chunks": fetch_source_chunks_by_ids(
                session, graph_id, branch_id,
                [c.get("chunk_id") for c in claims if c.get("chunk_id")],
            ),
            "subgraph": subgraph,
            "suggestions": [],
            "warnings": ["No direct concepts found; showing semantically relevant notes."],
        }
        return RetrievalResult(intent=Intent.SELF_KNOWLEDGE.value, trace=trace, context=context)

    node_ids = [n.node_id for n in top_nodes]

    trace.append(RetrievalTraceStep(step="get_subgraph_for_nodes", params={"node_ids": node_ids}, counts={}))
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

    concepts_dict = {
        n.node_id: {"node_id": n.node_id, "name": n.name, "domain": n.domain, "type": n.type}
        for n in top_nodes
    }
    edges = []
    for record in subgraph_result:
        src_id = record["src_id"]
        dst_id = record["dst_id"]
        if dst_id not in concepts_dict:
            concepts_dict[dst_id] = {
                "node_id": dst_id,
                "name": record["dst_name"],
                "type": "concept",
            }
        edges.append({
            "src": src_id,
            "dst": dst_id,
            "predicate": record["predicate"],
            "confidence": record["confidence"],
        })

    trace[-1].counts = {"concepts": len(concepts_dict), "edges": len(edges)}

    trace.append(RetrievalTraceStep(step="retrieve_claims_for_concepts", params={"limit": 30}, counts={}))
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
            "chunk_id": record.get("chunk_id"),
        })

    semantic_claims = retrieve_top_claims_by_query_embedding(session, graph_id, branch_id, query, limit=10)
    existing_claim_ids = {c["claim_id"] for c in claims}
    for sc in semantic_claims:
        if sc["claim_id"] not in existing_claim_ids:
            claims.append(sc)
            existing_claim_ids.add(sc["claim_id"])

    trace[-1].counts = {"claims": len(claims)}

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
            "edges": edges,
        },
        "suggestions": [
            {"label": "Explore Connections", "query": f"How is {top_nodes[0].name} connected to other things?", "intent": Intent.WHO_NETWORK.value},
            {"label": "Detailed Timeline", "query": f"Timeline of {top_nodes[0].name}", "intent": Intent.TIMELINE.value},
        ],
        "warnings": [],
    }

    return RetrievalResult(intent=Intent.SELF_KNOWLEDGE.value, trace=trace, context=context)
