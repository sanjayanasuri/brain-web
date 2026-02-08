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
from cache_utils import get_cached, set_cached
from typing import Dict, Any, List, Optional
from neo4j import Session
import hashlib
from auth import require_auth
from audit_log import log_retrieval_access
from fastapi import Request

router = APIRouter(prefix="/ai", tags=["ai"])


def fetch_trail_context(
    session: Session,
    graph_id: str,
    branch_id: str,
    trail_id: str,
    limit: int = 8
) -> Dict[str, Any]:
    """
    Fetch last N TrailSteps for the trail_id ordered by index desc.
    
    Returns:
        { "trail_id": ..., "steps": [...], "summary": "1-3 sentence deterministic summary" }
    
    Summary rules:
    - Prefer last 1–2 "page/quote/concept" steps
    - Include key titles/ref_ids
    - No LLM call. Deterministic string assembly only.
    """
    query = """
    MATCH (t:Trail {graph_id: $graph_id, trail_id: $trail_id})
    WHERE $branch_id IN COALESCE(t.on_branches, [])
    MATCH (t)-[:HAS_STEP]->(s:TrailStep {graph_id: $graph_id})
    WHERE $branch_id IN COALESCE(s.on_branches, [])
    RETURN s.step_id AS step_id,
           s.index AS index,
           s.kind AS kind,
           s.ref_id AS ref_id,
           s.title AS title,
           s.created_at AS created_at
    ORDER BY s.index DESC
    LIMIT $limit
    """
    result = session.run(query, graph_id=graph_id, branch_id=branch_id, trail_id=trail_id, limit=limit)
    
    steps = []
    for record in result:
        steps.append({
            "step_id": record.get("step_id"),
            "index": record.get("index"),
            "kind": record.get("kind"),
            "ref_id": record.get("ref_id"),
            "title": record.get("title"),
            "created_at": record.get("created_at"),
        })
    
    # Build deterministic summary
    summary_parts = []
    # Prefer last 1-2 page/quote/concept steps
    relevant_steps = [s for s in steps if s["kind"] in ["page", "quote", "concept"]][:2]
    if relevant_steps:
        for step in relevant_steps:
            kind = step["kind"]
            ref_id = step["ref_id"]
            title = step.get("title")
            if title:
                summary_parts.append(f"{kind.title()}: {title}")
            else:
                summary_parts.append(f"{kind.title()}: {ref_id[:50]}")
    
    summary = ". ".join(summary_parts) if summary_parts else f"Trail with {len(steps)} steps"
    
    return {
        "trail_id": trail_id,
        "steps": steps,
        "summary": summary,
    }


def fetch_focus_context(
    session: Session,
    graph_id: str,
    branch_id: str,
    focus_concept_id: Optional[str] = None,
    focus_quote_id: Optional[str] = None,
    focus_page_url: Optional[str] = None
) -> Dict[str, Any]:
    """
    Fetch focus context based on focus_concept_id, focus_quote_id, or focus_page_url.
    
    Returns structured dict with IDs for trace.
    """
    result: Dict[str, Any] = {
        "focus_type": None,
        "concept": None,
        "quotes": [],
        "claims": [],
        "sources": [],
    }
    
    if focus_concept_id:
        # Fetch concept + top quotes + top claims for that concept
        query = """
        MATCH (c:Concept {graph_id: $graph_id, node_id: $concept_id})
        WHERE $branch_id IN COALESCE(c.on_branches, [])
        OPTIONAL MATCH (c)-[:HAS_QUOTE]->(q:Quote {graph_id: $graph_id})
        WHERE $branch_id IN COALESCE(q.on_branches, [])
        OPTIONAL MATCH (c)-[:SUPPORTED_BY]->(cl:Claim {graph_id: $graph_id})
        WHERE $branch_id IN COALESCE(cl.on_branches, [])
        OPTIONAL MATCH (q)-[:QUOTED_FROM]->(d:SourceDocument {graph_id: $graph_id})
        RETURN c.node_id AS concept_id,
               c.name AS concept_name,
               collect(DISTINCT {
                   quote_id: q.quote_id,
                   text: q.text,
                   source_url: d.url,
                   source_title: d.title
               })[0..5] AS quotes,
               collect(DISTINCT {
                   claim_id: cl.claim_id,
                   text: cl.text,
                   confidence: cl.confidence
               })[0..5] AS claims
        LIMIT 1
        """
        try:
            query_result = session.run(query, graph_id=graph_id, branch_id=branch_id, concept_id=focus_concept_id)
            record = query_result.single()
            if record:
                result["focus_type"] = "concept"
                result["concept"] = {
                    "concept_id": record.get("concept_id"),
                    "name": record.get("concept_name"),
                }
                result["quotes"] = [q for q in record.get("quotes", []) if q.get("quote_id")]
                result["claims"] = [c for c in record.get("claims", []) if c.get("claim_id")]
        except Exception as e:
            print(f"[Retrieval API] WARNING: Failed to fetch focus concept context: {e}")
    
    elif focus_quote_id:
        # Fetch quote text + source url + attached concepts
        query = """
        MATCH (q:Quote {graph_id: $graph_id, quote_id: $quote_id})
        WHERE $branch_id IN COALESCE(q.on_branches, [])
        OPTIONAL MATCH (q)-[:QUOTED_FROM]->(d:SourceDocument {graph_id: $graph_id})
        OPTIONAL MATCH (c:Concept {graph_id: $graph_id})-[r:HAS_QUOTE]->(q)
        WHERE $branch_id IN COALESCE(c.on_branches, [])
        RETURN q.quote_id AS quote_id,
               q.text AS text,
               d.url AS source_url,
               d.title AS source_title,
               collect(DISTINCT {node_id: c.node_id, name: c.name}) AS attached_concepts
        LIMIT 1
        """
        try:
            query_result = session.run(query, graph_id=graph_id, branch_id=branch_id, quote_id=focus_quote_id)
            record = query_result.single()
            if record:
                result["focus_type"] = "quote"
                result["quotes"] = [{
                    "quote_id": record.get("quote_id"),
                    "text": record.get("text"),
                    "source_url": record.get("source_url"),
                    "source_title": record.get("source_title"),
                }]
                result["concept"] = None
                attached = record.get("attached_concepts", [])
                if attached:
                    result["concept"] = attached[0]  # Use first attached concept
        except Exception as e:
            print(f"[Retrieval API] WARNING: Failed to fetch focus quote context: {e}")
    
    elif focus_page_url:
        # Fetch quotes by source url (capped)
        query = """
        MATCH (d:SourceDocument {graph_id: $graph_id})
        WHERE d.url = $url
        MATCH (q:Quote {graph_id: $graph_id})-[r:QUOTED_FROM]->(d)
        WHERE $branch_id IN COALESCE(q.on_branches, [])
        RETURN q.quote_id AS quote_id,
               q.text AS text,
               d.url AS source_url,
               d.title AS source_title
        LIMIT 10
        """
        try:
            query_result = session.run(query, graph_id=graph_id, branch_id=branch_id, url=focus_page_url)
            quotes = []
            for record in query_result:
                quotes.append({
                    "quote_id": record.get("quote_id"),
                    "text": record.get("text"),
                    "source_url": record.get("source_url"),
                    "source_title": record.get("source_title"),
                })
            if quotes:
                result["focus_type"] = "page"
                result["quotes"] = quotes
                result["sources"] = [{
                    "url": quotes[0].get("source_url"),
                    "title": quotes[0].get("source_title"),
                }]
        except Exception as e:
            print(f"[Retrieval API] WARNING: Failed to fetch focus page context: {e}")
    
    return result


@router.post("/retrieve", response_model=RetrievalResult)
def retrieve_endpoint(
    payload: RetrievalRequest,
    request: Request,
    auth: dict = Depends(require_auth),
    session=Depends(get_neo4j_session),
):
    """
    Intent-based retrieval orchestrator.
    
    If intent is provided, skip router and run that plan directly.
    Otherwise: run router → plan.
    
    Returns RetrievalResult with intent, trace, and context.
    
    Cached for 2 minutes to improve performance for repeated queries.
    """
    ensure_graph_scoping_initialized(session)
    
    # Get graph_id and branch_id
    if payload.graph_id and payload.branch_id:
        graph_id = payload.graph_id
        branch_id = payload.branch_id
    else:
        graph_id, branch_id = get_active_graph_context(session)
    
    # Build cache key (exclude trail_id and focus_* from cache key since they're session-specific)
    message_hash = hashlib.md5(payload.message.encode()).hexdigest()[:8]
    cache_key = (
        "retrieve",
        graph_id or "",
        branch_id or "",
        message_hash,
        payload.intent or "",
        payload.limit or 5,
        payload.detail_level or "summary",
        payload.limit_claims or 0,
        payload.limit_entities or 0,
        payload.limit_sources or 0,
    )
    
    # Try cache first (2 minute TTL for retrieval operations)
    # Skip cache if trail_id or focus_* are provided (session-specific)
    if not payload.trail_id and not payload.focus_concept_id and not payload.focus_quote_id and not payload.focus_page_url:
        cached_result = get_cached(*cache_key, ttl_seconds=120)
        if cached_result is not None:
            # Convert dict back to RetrievalResult
            try:
                return RetrievalResult(**cached_result)
            except Exception as e:
                print(f"[Retrieval API] WARNING: Failed to deserialize cached result: {e}")
                # Continue with fresh retrieval
    
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
    
    # Phase B: Fetch trail and focus context if provided (non-blocking - don't fail if slow)
    trail_context = None
    focus_context = None
    
    # Fetch trail and focus context in parallel if both are needed
    if payload.trail_id or (payload.focus_concept_id or payload.focus_quote_id or payload.focus_page_url):
        try:
            if payload.trail_id:
                trail_context = fetch_trail_context(session, graph_id, branch_id, payload.trail_id, limit=8)
                result.context["session_context"] = trail_context
            
            if payload.focus_concept_id or payload.focus_quote_id or payload.focus_page_url:
                focus_context = fetch_focus_context(
                    session,
                    graph_id,
                    branch_id,
                    payload.focus_concept_id,
                    payload.focus_quote_id,
                    payload.focus_page_url
                )
                result.context["focus_context"] = focus_context
        except Exception as e:
            print(f"[Retrieval API] WARNING: Failed to fetch session/focus context: {e}")
            # Continue without context - don't fail the whole request
    
    # Populate trace IDs for frontend
    trace_ids: Dict[str, Any] = {
        "used_trail_step_ids": [],
        "used_quote_ids": [],
        "used_claim_ids": [],
        "used_concept_ids": [],
        "used_source_urls": [],
    }
    
    # Collect IDs from trail context
    if trail_context:
        trace_ids["used_trail_step_ids"] = [s["step_id"] for s in trail_context.get("steps", [])]
    
    # Collect IDs from focus context
    if focus_context:
        if focus_context.get("concept"):
            trace_ids["used_concept_ids"].append(focus_context["concept"].get("concept_id"))
        trace_ids["used_quote_ids"].extend([q.get("quote_id") for q in focus_context.get("quotes", []) if q.get("quote_id")])
        trace_ids["used_claim_ids"].extend([c.get("claim_id") for c in focus_context.get("claims", []) if c.get("claim_id")])
        trace_ids["used_source_urls"].extend([s.get("url") for s in focus_context.get("sources", []) if s.get("url")])
    
    # Collect IDs from retrieval result context
    if result.context.get("focus_entities"):
        trace_ids["used_concept_ids"].extend([e.get("node_id") for e in result.context["focus_entities"] if e.get("node_id")])
    if result.context.get("claims"):
        trace_ids["used_claim_ids"].extend([c.get("claim_id") for c in result.context["claims"] if c.get("claim_id")])
    if result.context.get("evidence_used"):
        trace_ids["used_source_urls"].extend([e.get("url") for e in result.context["evidence_used"] if e.get("url")])
    
    # Deduplicate lists
    trace_ids["used_trail_step_ids"] = list(set(trace_ids["used_trail_step_ids"]))
    trace_ids["used_quote_ids"] = list(set(trace_ids["used_quote_ids"]))
    trace_ids["used_claim_ids"] = list(set(trace_ids["used_claim_ids"]))
    trace_ids["used_concept_ids"] = list(set(trace_ids["used_concept_ids"]))
    trace_ids["used_source_urls"] = list(set(trace_ids["used_source_urls"]))
    
    # Attach trace IDs to result context
    result.context["trace_ids"] = trace_ids
    
    # Cache result if no session-specific context (trail_id/focus_*)
    if not payload.trail_id and not payload.focus_concept_id and not payload.focus_quote_id and not payload.focus_page_url:
        try:
            # Convert RetrievalResult to dict for caching
            result_dict = {
                "intent": result.intent,
                "trace": [step.dict() if hasattr(step, 'dict') else step for step in result.trace],
                "context": result.context,
                "plan_version": result.plan_version,
            }
            set_cached(*cache_key, result_dict, ttl_seconds=120)
        except Exception as e:
            print(f"[Retrieval API] WARNING: Failed to cache result: {e}")
    
    # Log the retrieval event (non-blocking - don't fail if logging fails)
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
        
        # Audit log: track data access for security/compliance
        log_retrieval_access(
            request=request,
            graph_id=graph_id,
            branch_id=branch_id,
            intent=intent,
            evidence_ids=trace_ids.get("used_claim_ids", []),
            concept_ids=trace_ids.get("used_concept_ids", []),
        )
    except Exception as e:
        print(f"[Retrieval API] WARNING: Failed to log event: {e}")
    
    # Emit event for chat message creation
    try:
        from events.emitter import emit_event
        from events.schema import EventType, ObjectRef
        from projectors.session_context import SessionContextProjector
        
        session_id = getattr(request.state, "session_id", None) or "unknown"
        actor_id = getattr(request.state, "user_id", None)
        
        # Extract mentioned concepts from result
        mentioned_concepts = []
        if result.context.get("focus_entities"):
            for entity in result.context["focus_entities"][:10]:  # Top 10
                mentioned_concepts.append({
                    "concept_id": entity.get("node_id"),
                    "name": entity.get("name"),
                })
        
        # Emit event
        emit_event(
            event_type=EventType.CHAT_MESSAGE_CREATED,
            session_id=session_id,
            actor_id=actor_id,
            payload={
                "message": payload.message[:500],  # Truncate for payload
                "intent": intent,
                "answer_summary": result.context.get("summary", "")[:500],
                "mentioned_concepts": mentioned_concepts,
                "evidence_count": len(result.context.get("evidence_used", [])),
            },
            trace_id=getattr(request.state, "request_id", None),
        )
        
        # Projection is now handled asynchronously via background task queue
        # No need to update synchronously here
    except Exception:
        pass  # Don't fail on event emission
    
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
            if "notion" in source_id_lower:
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
