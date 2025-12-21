"""
Intent-based retrieval orchestrator endpoint.
"""
from fastapi import APIRouter, Depends
from models import RetrievalRequest, RetrievalResult, IntentResult, RetrievalTraceStep
from db_neo4j import get_neo4j_session
from services_intent_router import classify_intent
from services_retrieval_plans import run_plan
from services_branch_explorer import ensure_graph_scoping_initialized, get_active_graph_context
from services_logging import log_graphrag_event
from typing import Dict, Any, List, Optional
from neo4j import Session

router = APIRouter(prefix="/ai", tags=["ai"])


@router.post("/retrieve", response_model=RetrievalResult)
def retrieve_endpoint(
    payload: RetrievalRequest,
    session=Depends(get_neo4j_session)
):
    """
    Intent-based retrieval orchestrator.
    
    If intent is provided, skip router and run that plan directly.
    Otherwise: run router → plan.
    
    Returns RetrievalResult with intent, trace, and context.
    """
    ensure_graph_scoping_initialized(session)
    
    # Get graph_id and branch_id
    if payload.graph_id and payload.branch_id:
        graph_id = payload.graph_id
        branch_id = payload.branch_id
    else:
        graph_id, branch_id = get_active_graph_context(session)
    
    # Determine intent
    if payload.intent:
        # Use provided intent
        intent_result = IntentResult(
            intent=payload.intent,
            confidence=1.0,
            reasoning="Intent provided explicitly"
        )
    else:
        # Run intent router
        intent_result = classify_intent(payload.message, use_llm_fallback=True)
    
    intent = intent_result.intent
    
    # Run retrieval plan
    result = run_plan(
        session=session,
        query=payload.message,
        intent=intent,
        graph_id=graph_id,
        branch_id=branch_id,
        limit=payload.limit,
        detail_level=payload.detail_level
    )
    
    # Transform to summary mode if requested
    if payload.detail_level == "summary":
        result = _transform_to_summary_mode(result, payload)
    
    # Extract evidence_used from claims
    evidence_used = _extract_evidence_used(session, graph_id, branch_id, result.context)
    result.context["evidence_used"] = evidence_used
    
    # Log the retrieval event
    try:
        log_graphrag_event(
            graph_id=graph_id,
            branch_id=branch_id,
            mode="graphrag_intent",
            user_question=payload.message,
            retrieved_communities=[c.get("community_id") for c in result.context.get("focus_communities", [])],
            retrieved_claims=[c.get("claim_id") for c in result.context.get("claims", [])],
            metadata={
                "intent": intent,
                "intent_confidence": intent_result.confidence,
                "intent_reasoning": intent_result.reasoning,
                "trace_steps": len(result.trace),
                "plan_version": result.plan_version,
            }
        )
    except Exception as e:
        print(f"[Retrieval API] WARNING: Failed to log event: {e}")
    
    return result


def _transform_to_summary_mode(result: RetrievalResult, payload: RetrievalRequest) -> RetrievalResult:
    """
    Transform full retrieval result to summary mode with caps.
    
    Summary mode returns:
    - focus_entities: max 5 (id, name, domain, type only, no descriptions)
    - top_claims: max 5 (trimmed to ~200 chars)
    - top_sources: max 3
    - subgraph_preview: max 10 edges or omit
    - retrieval_meta: counts + ID lists only
    """
    context = result.context.copy()
    
    # Cap limits
    limit_entities = payload.limit_entities or 5
    limit_claims = payload.limit_claims or 5
    limit_sources = payload.limit_sources or 3
    limit_edges = 10
    
    # Transform focus_entities: strip descriptions, keep only id, name, domain, type
    if "focus_entities" in context:
        entities = context["focus_entities"][:limit_entities]
        context["focus_entities"] = [
            {
                "node_id": e.get("node_id"),
                "name": e.get("name"),
                "domain": e.get("domain", ""),
                "type": e.get("type", "concept"),
            }
            for e in entities
        ]
    
    # Transform claims: trim text to ~200 chars, max 5
    if "claims" in context:
        claims = context["claims"][:limit_claims]
        context["top_claims"] = [
            {
                "claim_id": c.get("claim_id"),
                "text": (c.get("text", "")[:200] + "...") if len(c.get("text", "")) > 200 else c.get("text", ""),
                "confidence": c.get("confidence", 0.5),
                "source_id": c.get("source_id"),
                "published_at": c.get("published_at"),
            }
            for c in claims
        ]
        # Keep claims array for backward compatibility but limit it
        context["claims"] = context["top_claims"]
    
    # Extract top sources: max 3
    if "claims" in context:
        source_map: Dict[str, Dict[str, Any]] = {}
        for claim in context.get("claims", []):
            source_id = claim.get("source_id")
            if source_id and source_id not in source_map:
                source_map[source_id] = {
                    "source_id": source_id,
                    "title": claim.get("source_title") or source_id,
                    "url": claim.get("source_url"),
                    "published_at": claim.get("published_at"),
                }
                if len(source_map) >= limit_sources:
                    break
        context["top_sources"] = list(source_map.values())
    
    # Transform subgraph: max 10 edges or omit
    if "subgraph" in context:
        subgraph = context["subgraph"]
        edges = subgraph.get("edges", [])[:limit_edges]
        context["subgraph_preview"] = {
            "edges": [
                {
                    "source_id": e.get("source_id") or e.get("src"),
                    "target_id": e.get("target_id") or e.get("dst"),
                    "predicate": e.get("predicate"),
                }
                for e in edges
            ]
        }
        # Keep full subgraph but mark as preview
        context["subgraph"] = context["subgraph_preview"]
    
    # Build retrieval_meta with counts and IDs only
    communities = context.get("focus_communities", [])
    claims = context.get("claims", [])
    entities = context.get("focus_entities", [])
    edges = context.get("subgraph", {}).get("edges", [])
    
    # Source breakdown counts
    source_breakdown: Dict[str, int] = {}
    for claim in claims:
        source_id = claim.get("source_id")
        if source_id:
            source_breakdown[source_id] = source_breakdown.get(source_id, 0) + 1
    
    context["retrieval_meta"] = {
        "schema_version": 1,  # Contract version for API compatibility
        "communities": len(communities),
        "claims": len(claims),
        "concepts": len(entities),
        "edges": len(edges),
        "claimIds": [c.get("claim_id") for c in claims[:20]],
        "communityIds": [c.get("community_id") for c in communities[:10]],
        "sourceBreakdown": source_breakdown,
        "topClaims": context.get("top_claims", [])[:5],  # Include top 5 claims for preview
    }
    
    # Cap trace to max 10 steps or summarize
    if len(result.trace) > 10:
        original_length = len(result.trace)
        result.trace = result.trace[:10]
        result.trace.append(RetrievalTraceStep(
            step="summary",
            params={},
            counts={"total_steps": original_length}
        ))
    
    # Remove chunks from summary mode
    if "chunks" in context:
        del context["chunks"]
    
    # Remove community summaries (keep only names)
    if "focus_communities" in context:
        communities = context["focus_communities"][:3]
        context["focus_communities"] = [
            {
                "community_id": c.get("community_id"),
                "name": c.get("name") or c.get("community_id"),
            }
            for c in communities
        ]
    
    result.context = context
    return result


def _extract_evidence_used(
    session: Session,
    graph_id: str,
    branch_id: str,
    context: Dict[str, Any]
) -> List[Dict[str, Any]]:
    """
    Extract evidence_used array from claims in context.
    
    Maps claims to evidence items with:
    - title, url, source, as_of, snippet
    - resource_id, concept_id if mapped to Resource nodes
    
    Returns up to 8 evidence items.
    """
    evidence_map: Dict[str, Dict[str, Any]] = {}
    claims = context.get("claims", []) or context.get("top_claims", [])
    
    if not claims:
        return []
    
    # Collect source_ids to fetch SourceDocument info in batch
    source_ids = set()
    for claim in claims[:20]:
        source_id = claim.get("source_id")
        if source_id:
            source_ids.add(source_id)
    
    # Fetch SourceDocument info for all source_ids
    source_doc_map: Dict[str, Dict[str, Any]] = {}
    if source_ids:
        query = """
        MATCH (g:GraphSpace {graph_id: $graph_id})
        MATCH (doc:SourceDocument {graph_id: $graph_id})-[:BELONGS_TO]->(g)
        WHERE doc.doc_id IN $source_ids
        RETURN doc.doc_id AS doc_id,
               doc.url AS url,
               doc.source AS source,
               doc.published_at AS published_at,
               doc.metadata AS metadata
        """
        try:
            result = session.run(query, graph_id=graph_id, source_ids=list(source_ids))
            for record in result:
                doc_id = record.get("doc_id")
                if doc_id:
                    # Extract title from metadata or use doc_id
                    metadata = record.get("metadata")
                    title = None
                    if metadata and isinstance(metadata, dict):
                        title = metadata.get("title") or metadata.get("name")
                    if not title:
                        # Try to infer from url or doc_id
                        url = record.get("url", "")
                        if url:
                            # Extract filename or last part of URL
                            title = url.split("/")[-1].split("?")[0] or doc_id
                        else:
                            title = doc_id
                    
                    source_doc_map[doc_id] = {
                        "url": record.get("url"),
                        "title": title,
                        "source": record.get("source", "web"),
                        "published_at": record.get("published_at"),
                    }
        except Exception as e:
            print(f"[Retrieval API] WARNING: Failed to fetch source documents: {e}")
    
    # Extract unique sources from claims (dedupe by source_id or url)
    for claim in claims[:20]:  # Process up to 20 claims
        source_id = claim.get("source_id")
        snippet = claim.get("text", "")[:200]  # First 200 chars as snippet
        
        # Get source document info
        source_doc = source_doc_map.get(source_id, {}) if source_id else {}
        source_url = claim.get("source_url") or source_doc.get("url")
        source_title = claim.get("source_title") or source_doc.get("title") or source_id or "Unknown source"
        published_at = claim.get("published_at") or source_doc.get("published_at")
        source_type = source_doc.get("source", "web")
        
        # Determine source type from claim metadata or source_id if not from doc
        if source_type == "web" and source_id:
            source_id_lower = str(source_id).lower()
            if "browser_use" in source_id_lower or "browser" in source_id_lower:
                source_type = "browser_use"
            elif "notion" in source_id_lower:
                source_type = "notion"
            elif "upload" in source_id_lower:
                source_type = "upload"
        
        # Use source_id as key, fallback to url
        key = source_id or source_url or source_title
        if not key or key in evidence_map:
            continue
        
        evidence_map[key] = {
            "title": source_title,
            "url": source_url,
            "source": source_type,
            "as_of": published_at,
            "snippet": snippet if snippet else None,
            "resource_id": None,
            "concept_id": None,
        }
        
        if len(evidence_map) >= 8:
            break
    
    # Try to map to Resource nodes by URL or source_id
    if evidence_map:
        evidence_list = list(evidence_map.values())
        _map_evidence_to_resources(session, graph_id, evidence_list)
    
    return list(evidence_map.values())[:8]


def _map_evidence_to_resources(
    session: Session,
    graph_id: str,
    evidence_list: List[Dict[str, Any]]
) -> None:
    """
    Try to map evidence items to Resource nodes by URL.
    If found, populate resource_id and concept_id.
    
    Note: Resources don't have graph_id scoping, so we match by URL only.
    """
    if not evidence_list:
        return
    
    # Build query to find Resources by URL
    urls = [e["url"] for e in evidence_list if e.get("url")]
    if not urls:
        return
    
    query = """
    MATCH (r:Resource)
    WHERE r.url IN $urls
    OPTIONAL MATCH (c:Concept {graph_id: $graph_id})-[:HAS_RESOURCE]->(r)
    RETURN r.resource_id AS resource_id,
           r.url AS url,
           r.source AS source,
           collect(DISTINCT c.node_id)[0] AS concept_id
    LIMIT 50
    """
    
    try:
        result = session.run(query, graph_id=graph_id, urls=urls)
        url_to_resource: Dict[str, Dict[str, Any]] = {}
        
        for record in result:
            url = record.get("url")
            if url:
                url_to_resource[url] = {
                    "resource_id": record.get("resource_id"),
                    "concept_id": record.get("concept_id"),
                    "source": record.get("source"),
                }
        
        # Update evidence items with resource mapping
        for evidence in evidence_list:
            url = evidence.get("url")
            if url and url in url_to_resource:
                mapping = url_to_resource[url]
                evidence["resource_id"] = mapping["resource_id"]
                evidence["concept_id"] = mapping["concept_id"]
                # Update source from Resource if available
                if mapping.get("source"):
                    evidence["source"] = mapping["source"]
    except Exception as e:
        print(f"[Retrieval API] WARNING: Failed to map evidence to resources: {e}")
        # Continue without resource mapping
