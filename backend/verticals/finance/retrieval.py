"""
Finance retrieval policy: anchor company → relevant communities → claims → evidence subgraph.
"""
from typing import Dict, Any, Optional, List
from neo4j import Session
from datetime import datetime, timedelta

from verticals.base import RetrievalRequest, RetrievalResult
from verticals.finance.lenses import route_lens
from verticals.finance.templates import render_finance_answer_template
from services_graphrag import semantic_search_communities
from services_graph import (
    get_claims_for_communities,
    get_evidence_subgraph,
    get_all_concepts,
    get_concept_by_name,
)
from services_resources import get_resources_for_concept
from services_search import semantic_search_nodes, embed_text, cosine_similarity
from services_branch_explorer import ensure_graph_scoping_initialized


def detect_anchor_company(
    session: Session,
    graph_id: str,
    branch_id: str,
    query: str
) -> tuple[Optional[str], Optional[str]]:
    """
    Detect company/ticker entity from query.
    
    Handles formats:
    - "TICKER: query" - extracts ticker from prefix
    - Short queries (<= 6 tokens) - treats as company name/ticker
    - Longer queries - uses semantic search but prefers Company type concepts
    
    Returns:
        Tuple of (anchor_node_id, anchor_name) or (None, None)
    """
    ensure_graph_scoping_initialized(session)
    
    # Step 1: Check for "TICKER: query" format
    if ":" in query:
        parts = query.split(":", 1)
        potential_ticker = parts[0].strip().upper()
        # Check if it looks like a ticker (1-5 uppercase letters)
        if len(potential_ticker) <= 5 and potential_ticker.isalpha() and potential_ticker.isupper():
            ticker = potential_ticker
            print(f"[Finance Retrieval] Detected ticker format: {ticker}")
            
            # Search for company concepts by ticker
            # First, try exact name match
            concept = get_concept_by_name(session, ticker)
            if concept:
                if concept.type and "company" in concept.type.lower():
                    return (concept.node_id, concept.name)
                return (concept.node_id, concept.name)
            
            # Search for concepts that might be the company (e.g., "Apple Inc" for AAPL)
            # Look for concepts with Company type that might match
            all_concepts = get_all_concepts(session)
            for concept in all_concepts:
                if concept.type and "company" in concept.type.lower():
                    # Check if ticker appears in concept name or if concept name might be the company
                    concept_name_upper = concept.name.upper()
                    if ticker in concept_name_upper or concept_name_upper.startswith(ticker):
                        return (concept.node_id, concept.name)
            
            # If no concept found, search for claims/sources with this ticker to find related concepts
            # This is a fallback - ideally the company concept should exist
            print(f"[Finance Retrieval] No concept found for ticker {ticker}, will use ticker as anchor name")
            # Return ticker as anchor name even if no concept exists
            # The retrieval will use it in the enhanced query
            return (None, ticker)
    
    query_tokens = query.split()
    
    # Step 2: If query is short, treat as company name/ticker
    if len(query_tokens) <= 6:
        # Try exact name match first
        anchor_name = query.strip()
        concept = get_concept_by_name(session, anchor_name)
        if concept:
            # Prefer "Company" type if available
            if concept.type and "company" in concept.type.lower():
                return (concept.node_id, concept.name)
            # Otherwise use any match
            return (concept.node_id, concept.name)
        
        # Try case-insensitive partial match
        all_concepts = get_all_concepts(session)
        query_lower = query.lower()
        for concept in all_concepts:
            if query_lower in concept.name.lower() or concept.name.lower() in query_lower:
                if concept.type and "company" in concept.type.lower():
                    return (concept.node_id, concept.name)
        
        # Fallback: use first partial match
        for concept in all_concepts:
            if query_lower in concept.name.lower() or concept.name.lower() in query_lower:
                return (concept.node_id, concept.name)
    
    # Step 3: For longer queries, use semantic search but prefer Company type
    try:
        search_results = semantic_search_nodes(query, session, limit=10)
        if search_results:
            # Prefer "Company" type
            for result in search_results:
                concept = result["node"]
                if concept.type and "company" in concept.type.lower():
                    return (concept.node_id, concept.name)
            # Fallback to top result
            top_result = search_results[0]
            return (top_result["node"].node_id, top_result["node"].name)
    except Exception as e:
        print(f"[Finance Retrieval] WARNING: Semantic search failed: {e}")
    
    return (None, None)


def filter_claims_by_recency(
    claims: List[Dict[str, Any]],
    recency_days: Optional[int],
    session: Session,
    graph_id: str
) -> List[Dict[str, Any]]:
    """
    Filter claims by recency if recency_days is set.
    
    Note: This is a stub - actual implementation would check SourceChunk metadata
    for timestamps. For now, we skip filtering but keep the param wired.
    """
    if recency_days is None:
        return claims
    
    # TODO: Implement actual recency filtering based on SourceChunk metadata
    # For now, return all claims
    print(f"[Finance Retrieval] Recency filtering requested ({recency_days} days) but not yet implemented")
    return claims


def filter_claims_by_strictness(
    claims: List[Dict[str, Any]],
    strictness: str
) -> List[Dict[str, Any]]:
    """
    Filter claims by evidence strictness.
    
    Args:
        claims: List of claim dicts with 'confidence' field
        strictness: "high", "medium", or "low"
    
    Returns:
        Filtered list of claims
    """
    thresholds = {
        "high": 0.75,
        "medium": 0.55,
        "low": 0.0,
    }
    
    threshold = thresholds.get(strictness, 0.55)
    
    filtered = [
        claim for claim in claims
        if claim.get("confidence", 0.0) >= threshold
    ]
    
    return filtered


def get_claims_for_communities_with_ticker(
    session: Session,
    graph_id: str,
    branch_id: str,
    community_ids: List[str],
    ticker: Optional[str],
    limit_per_comm: int = 30
) -> Dict[str, List[Dict[str, Any]]]:
    """
    Get claims for communities, optionally filtered by ticker.
    
    Args:
        session: Neo4j session
        graph_id: Graph ID
        branch_id: Branch ID
        community_ids: List of community IDs
        ticker: Optional ticker to filter by (e.g., "AAPL")
        limit_per_comm: Max claims per community
    
    Returns:
        Dict mapping community_id to list of claim dicts with company_ticker
    """
    ensure_graph_scoping_initialized(session)
    
    if not community_ids:
        return {}
    
    # Build query with optional ticker filter
    if ticker:
        query = """
        MATCH (g:GraphSpace {graph_id: $graph_id})
        MATCH (k:Community {graph_id: $graph_id, community_id: $comm_id})-[:BELONGS_TO]->(g)
        MATCH (c:Concept {graph_id: $graph_id})-[:IN_COMMUNITY]->(k)
        MATCH (claim:Claim {graph_id: $graph_id})-[:MENTIONS]->(c)
        WHERE $branch_id IN COALESCE(claim.on_branches, [])
        OPTIONAL MATCH (claim)-[:SUPPORTED_BY]->(chunk:SourceChunk {graph_id: $graph_id})
        OPTIONAL MATCH (chunk)-[:FROM_DOCUMENT]->(doc:SourceDocument {graph_id: $graph_id})
        WITH k.community_id AS comm_id, claim, doc.company_ticker AS company_ticker
        WHERE company_ticker = $ticker
        WITH comm_id, claim, company_ticker
        ORDER BY claim.confidence DESC
        WITH comm_id, collect({claim: claim, company_ticker: company_ticker})[0..$limit] AS claim_data
        RETURN comm_id, claim_data
        """
    else:
        query = """
        MATCH (g:GraphSpace {graph_id: $graph_id})
        MATCH (k:Community {graph_id: $graph_id, community_id: $comm_id})-[:BELONGS_TO]->(g)
        MATCH (c:Concept {graph_id: $graph_id})-[:IN_COMMUNITY]->(k)
        MATCH (claim:Claim {graph_id: $graph_id})-[:MENTIONS]->(c)
        WHERE $branch_id IN COALESCE(claim.on_branches, [])
        OPTIONAL MATCH (claim)-[:SUPPORTED_BY]->(chunk:SourceChunk {graph_id: $graph_id})
        OPTIONAL MATCH (chunk)-[:FROM_DOCUMENT]->(doc:SourceDocument {graph_id: $graph_id})
        WITH k.community_id AS comm_id, claim, doc.company_ticker AS company_ticker
        WITH comm_id, claim, company_ticker
        ORDER BY claim.confidence DESC
        WITH comm_id, collect({claim: claim, company_ticker: company_ticker})[0..$limit] AS claim_data
        RETURN comm_id, claim_data
        """
    
    results = {}
    
    for comm_id in community_ids:
        params = {
            "graph_id": graph_id,
            "branch_id": branch_id,
            "comm_id": comm_id,
            "limit": limit_per_comm
        }
        if ticker:
            params["ticker"] = ticker.upper()
        
        result = session.run(query, **params)
        record = result.single()
        if record:
            claims = []
            for item in record["claim_data"]:
                claim_node = item["claim"]
                claims.append({
                    "claim_id": claim_node.get("claim_id"),
                    "text": claim_node.get("text"),
                    "confidence": claim_node.get("confidence"),
                    "source_id": claim_node.get("source_id"),
                    "source_span": claim_node.get("source_span"),
                    "company_ticker": item.get("company_ticker"),
                })
            results[comm_id] = claims
        else:
            results[comm_id] = []
    
    return results


def retrieve(
    req: RetrievalRequest,
    session: Session
) -> RetrievalResult:
    """
    Finance retrieval: anchor company → relevant communities → claims → evidence subgraph.
    
    Args:
        req: RetrievalRequest with finance-specific parameters
        session: Neo4j session
    
    Returns:
        RetrievalResult with finance-optimized context
    """
    ensure_graph_scoping_initialized(session)
    
    # Step 1: Route lens
    lens = route_lens(req.query, req.lens)
    print(f"[Finance Retrieval] Routed to lens: {lens}")
    
    # Step 2: Detect anchor company
    anchor_node_id, anchor_name = detect_anchor_company(
        session, req.graph_id, req.branch_id, req.query
    )
    print(f"[Finance Retrieval] Anchor: {anchor_name} (node_id: {anchor_node_id})")
    
    # Step 3: Community retrieval
    # Build enhanced query: anchor_name + lens + original_query (without ticker prefix if present)
    # Strip ticker prefix from original query if it exists
    query_text = req.query
    if anchor_name and ":" in req.query:
        parts = req.query.split(":", 1)
        if len(parts) == 2 and parts[0].strip().upper() == anchor_name.upper():
            query_text = parts[1].strip()  # Use the part after the colon
    
    enhanced_query = f"{anchor_name or req.query}\n{lens}\n{query_text}"
    
    communities = semantic_search_communities(
        session=session,
        graph_id=req.graph_id,
        branch_id=req.branch_id,
        query=enhanced_query,
        limit=req.max_communities
    )
    
    if not communities:
        print("[Finance Retrieval] No communities found, returning empty context")
        template = render_finance_answer_template(lens)
        return RetrievalResult(
            mode="graphrag",
            vertical="finance",
            lens=lens,
            context_text=f"{template}\n\nNo relevant communities found.",
            meta={
                "anchor_node_id": anchor_node_id,
                "anchor_name": anchor_name,
                "communities": [],
                "claims": [],
                "concepts": [],
                "edges": [],
            }
        )
    
    community_ids = [c["community_id"] for c in communities]
    print(f"[Finance Retrieval] Found {len(communities)} communities: {[c['name'] for c in communities]}")
    
    # Step 4: Claim retrieval with ticker filtering
    # Extract ticker from anchor_name if it's a ticker (uppercase, 1-5 letters)
    ticker_for_filter = None
    if anchor_name and anchor_name.isupper() and len(anchor_name) <= 5 and anchor_name.isalpha():
        ticker_for_filter = anchor_name
        print(f"[Finance Retrieval] Filtering claims by ticker: {ticker_for_filter}")
    
    claims_by_comm = get_claims_for_communities_with_ticker(
        session=session,
        graph_id=req.graph_id,
        branch_id=req.branch_id,
        community_ids=community_ids,
        ticker=ticker_for_filter,
        limit_per_comm=req.max_claims_per_community
    )
    
    # Flatten claims from all communities
    all_claims = []
    for comm_id, claims in claims_by_comm.items():
        for claim in claims:
            claim["community_id"] = comm_id
            all_claims.append(claim)
    
    ticker_count = sum(1 for c in all_claims if c.get("company_ticker") == ticker_for_filter) if ticker_for_filter else 0
    print(f"[Finance Retrieval] Found {len(all_claims)} total claims" + (f" ({ticker_count} with ticker {ticker_for_filter})" if ticker_for_filter else ""))
    
    # Apply recency filtering (stub for now)
    all_claims = filter_claims_by_recency(
        all_claims, req.recency_days, session, req.graph_id
    )
    
    # Apply evidence strictness filtering
    all_claims = filter_claims_by_strictness(all_claims, req.evidence_strictness)
    print(f"[Finance Retrieval] After strictness filtering: {len(all_claims)} claims")
    
    # Limit to top claims globally (by confidence)
    all_claims.sort(key=lambda c: c.get("confidence", 0.0), reverse=True)
    top_claims = all_claims[:req.max_claims_per_community * req.max_communities]
    top_claim_ids = [c["claim_id"] for c in top_claims]
    
    # Step 5: Evidence subgraph
    include_proposed_str = "all" if req.include_proposed_edges else "none"
    evidence_subgraph = get_evidence_subgraph(
        session=session,
        graph_id=req.graph_id,
        claim_ids=top_claim_ids[:40],  # Cap at 40 for performance
        max_concepts=req.max_concepts,
        include_proposed=include_proposed_str
    )
    
    concepts = evidence_subgraph.get("concepts", [])
    edges = evidence_subgraph.get("edges", [])
    print(f"[Finance Retrieval] Evidence subgraph: {len(concepts)} concepts, {len(edges)} edges")
    
    # Step 6: Build finance-optimized context string
    context_parts = []
    
    # Anchor section
    if anchor_name:
        context_parts.append(f"## Anchor Company: {anchor_name}")
        if anchor_node_id:
            context_parts.append(f"Node ID: {anchor_node_id}")
        context_parts.append("")
    
    # Resources section (finance snapshots from Browser Use)
    if anchor_node_id:
        resources = get_resources_for_concept(session, anchor_node_id)
        finance_resources = [
            r for r in resources
            if r.source == "browser_use" and r.metadata and isinstance(r.metadata, dict)
        ]
        if finance_resources:
            context_parts.append("## Finance Snapshots")
            for resource in finance_resources[:3]:  # Limit to top 3 snapshots
                context_parts.append(f"\n### {resource.title or 'Finance Snapshot'}")
                if resource.caption:
                    context_parts.append(resource.caption)
                
                # Extract key fields from metadata_json for finance resources
                if resource.metadata:
                    meta = resource.metadata
                    # Check if it's a finance tracker output
                    if isinstance(meta, dict) and "output" in meta:
                        output = meta.get("output", {})
                    else:
                        output = meta
                    
                    # Extract compact finance data
                    price_data = output.get("price", {}) or {}
                    size_data = output.get("size", {}) or {}
                    news_data = output.get("news", []) or []
                    
                    finance_lines = []
                    if price_data.get("last_price"):
                        finance_lines.append(f"Price: {price_data.get('last_price')}")
                    if size_data.get("market_cap"):
                        finance_lines.append(f"Market Cap: {size_data.get('market_cap')}")
                    if price_data.get("change_1w"):
                        finance_lines.append(f"1w Change: {price_data.get('change_1w')}")
                    if price_data.get("change_1m"):
                        finance_lines.append(f"1m Change: {price_data.get('change_1m')}")
                    if price_data.get("as_of") or size_data.get("as_of"):
                        as_of = price_data.get("as_of") or size_data.get("as_of")
                        finance_lines.append(f"As of: {as_of}")
                    
                    if finance_lines:
                        context_parts.append(" | ".join(finance_lines))
                    
                    # Include top news URLs
                    if news_data:
                        top_news = news_data[:3]
                        news_urls = [n.get("url") for n in top_news if n.get("url")]
                        if news_urls:
                            context_parts.append(f"News: {', '.join(news_urls[:2])}")  # Top 2 URLs
                
                context_parts.append("")
    
    # Lens section
    context_parts.append(f"## Analysis Lens: {lens}")
    context_parts.append("")
    
    # Community summaries
    context_parts.append("## Community Summaries")
    for comm in communities:
        context_parts.append(f"\n### {comm['name']}")
        if comm.get("summary"):
            summary = comm["summary"]
            if len(summary) > 800:
                summary = summary[:800] + "..."
            context_parts.append(summary)
        context_parts.append("")
    
    # Top claims
    context_parts.append("## Top Claims (with Confidence + Sources)")
    for claim in top_claims[:30]:  # Limit to top 30 for context
        context_parts.append(f"\n**Claim:** {claim['text']}")
        context_parts.append(f"Confidence: {claim.get('confidence', 0.0):.2f}")
        source_info = claim.get('source_id', 'unknown')
        source_span = claim.get('source_span')
        if source_span:
            source_info += f" ({source_span})"
        context_parts.append(f"Source: {source_info}")
        context_parts.append("")
    
    # Evidence subgraph (compact)
    if concepts or edges:
        context_parts.append("## Evidence Subgraph")
        if concepts:
            context_parts.append(f"\n**Concepts ({len(concepts)}):**")
            concept_names = [c.get("name", "unknown") for c in concepts[:20]]
            context_parts.append(", ".join(concept_names))
        if edges:
            context_parts.append(f"\n**Edges ({len(edges)}):**")
            # Create name map
            name_map = {c.get("node_id"): c.get("name", "unknown") for c in concepts}
            for edge in edges[:30]:  # Limit to 30 edges
                src_name = name_map.get(edge.get("source_id"), edge.get("source_id", "unknown"))
                dst_name = name_map.get(edge.get("target_id"), edge.get("target_id", "unknown"))
                rel = edge.get("predicate", "RELATED_TO")
                context_parts.append(f"{src_name} --{rel}--> {dst_name}")
        context_parts.append("")
    
    # Instruction template
    template = render_finance_answer_template(lens)
    context_parts.append("## Instructions")
    context_parts.append(template)
    
    context_text = "\n".join(context_parts)
    
    # Build meta
    meta = {
        "anchor_node_id": anchor_node_id,
        "anchor_name": anchor_name,
        "lens": lens,
        "communities": [
            {
                "community_id": c["community_id"],
                "name": c["name"],
                "score": c.get("score", 0.0),
            }
            for c in communities
        ],
        "claim_counts": {
            "total": len(all_claims),
            "after_strictness": len(top_claims),
            "in_subgraph": len(top_claim_ids),
        },
        "concepts": len(concepts),
        "edges": len(edges),
    }
    
    return RetrievalResult(
        mode="graphrag",
        vertical="finance",
        lens=lens,
        context_text=context_text,
        meta=meta
    )
