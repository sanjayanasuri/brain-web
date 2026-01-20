"""
Service for generating exportable research memos with citations.

Formats retrieval results into a structured research memo with proper citations.
"""
from typing import Dict, Any, List, Optional
from datetime import datetime
from neo4j import Session

from services_graphrag import retrieve_graphrag_context
from services_branch_explorer import get_active_graph_context


def format_citation(evidence: Dict[str, Any], index: int) -> str:
    """
    Format a single citation entry.
    
    Args:
        evidence: Evidence dict with url, title, source_id, etc.
        index: Citation number
    
    Returns:
        Formatted citation string
    """
    url = evidence.get("url", "")
    title = evidence.get("title", evidence.get("source_id", "Unknown Source"))
    source = evidence.get("source", "")
    published_at = evidence.get("published_at")
    
    citation_parts = [f"[{index}]"]
    
    if title:
        citation_parts.append(title)
    
    if source:
        citation_parts.append(f"({source})")
    
    if published_at:
        if isinstance(published_at, (int, float)):
            dt = datetime.fromtimestamp(published_at)
            citation_parts.append(f"- {dt.strftime('%Y-%m-%d')}")
        elif isinstance(published_at, str):
            citation_parts.append(f"- {published_at}")
    
    if url:
        citation_parts.append(f"<{url}>")
    
    return " ".join(citation_parts)


def generate_research_memo(
    session: Session,
    query: str,
    graph_id: Optional[str] = None,
    branch_id: Optional[str] = None,
    evidence_strictness: str = "medium",
    include_claims: bool = True,
    include_concepts: bool = True,
) -> Dict[str, Any]:
    """
    Generate a research memo from a query.
    
    Args:
        session: Neo4j session
        query: Research question/query
        graph_id: Optional graph ID
        branch_id: Optional branch ID
        evidence_strictness: Evidence strictness mode
        include_claims: Whether to include claims in memo
        include_concepts: Whether to include concept details
    
    Returns:
        Dict with:
        - memo_text: Formatted memo text (markdown)
        - citations: List of citation dicts
        - metadata: Dict with query, timestamp, etc.
    """
    if not graph_id or not branch_id:
        graph_id, branch_id = get_active_graph_context(session)
    
    # Retrieve context
    context_result = retrieve_graphrag_context(
        session=session,
        graph_id=graph_id,
        branch_id=branch_id,
        question=query,
        evidence_strictness=evidence_strictness,
    )
    
    if not context_result.get("has_evidence", True):
        return {
            "memo_text": f"# Research Memo\n\n## Query\n{query}\n\n## Result\nNo evidence found for this query.",
            "citations": [],
            "metadata": {
                "query": query,
                "timestamp": datetime.utcnow().isoformat() + "Z",
                "has_evidence": False,
            },
        }
    
    # Extract evidence
    claims = context_result.get("claims", [])
    evidence_used = []
    citation_map = {}  # url -> citation index
    
    # Collect unique evidence sources
    for claim in claims:
        source_id = claim.get("source_id")
        source_span = claim.get("source_span", "")
        chunk_id = claim.get("chunk_id")
        
        # Try to get source document URL
        if source_id:
            # Query for source document
            doc_query = """
            MATCH (d:SourceDocument {doc_id: $source_id})
            RETURN d.url AS url,
                   d.title AS title,
                   d.source AS source,
                   d.published_at AS published_at
            LIMIT 1
            """
            doc_result = session.run(doc_query, source_id=source_id)
            doc_record = doc_result.single()
            
            if doc_record:
                url = doc_record.get("url", "")
                title = doc_record.get("title", source_id)
                source = doc_record.get("source", "")
                published_at = doc_record.get("published_at")
                
                if url and url not in citation_map:
                    citation_index = len(citation_map) + 1
                    citation_map[url] = citation_index
                    evidence_used.append({
                        "url": url,
                        "title": title,
                        "source": source,
                        "published_at": published_at,
                        "source_id": source_id,
                        "index": citation_index,
                    })
    
    # Build memo text
    memo_lines = [
        "# Research Memo",
        "",
        f"**Generated:** {datetime.utcnow().strftime('%Y-%m-%d %H:%M:%S UTC')}",
        "",
        "## Query",
        query,
        "",
    ]
    
    # Add summary/context
    context_text = context_result.get("context_text", "")
    if context_text:
        memo_lines.extend([
            "## Summary",
            context_text,
            "",
        ])
    
    # Add claims with citations
    if include_claims and claims:
        memo_lines.extend([
            "## Key Findings",
            "",
        ])
        
        for i, claim in enumerate(claims[:20], 1):  # Limit to top 20 claims
            claim_text = claim.get("text", "")
            source_id = claim.get("source_id")
            confidence = claim.get("confidence", 0.0)
            status = claim.get("status", "PROPOSED")
            
            # Find citation index
            citation_refs = []
            if source_id:
                doc_query = """
                MATCH (d:SourceDocument {doc_id: $source_id})
                RETURN d.url AS url
                LIMIT 1
                """
                doc_result = session.run(doc_query, source_id=source_id)
                doc_record = doc_result.single()
                if doc_record:
                    url = doc_record.get("url")
                    if url and url in citation_map:
                        citation_refs.append(f"[{citation_map[url]}]")
            
            # Format claim
            claim_line = f"{i}. {claim_text}"
            if citation_refs:
                claim_line += f" {', '.join(citation_refs)}"
            if status == "VERIFIED":
                claim_line += " ✓"
            
            memo_lines.append(claim_line)
        
        memo_lines.append("")
    
    # Add concepts if requested
    if include_concepts:
        concepts = context_result.get("concepts", [])
        if concepts:
            memo_lines.extend([
                "## Related Concepts",
                "",
            ])
            for concept in concepts[:10]:  # Limit to top 10
                name = concept.get("name", "")
                description = concept.get("description", "")
                if name:
                    memo_lines.append(f"- **{name}**")
                    if description:
                        memo_lines.append(f"  {description}")
            memo_lines.append("")
    
    # Add citations section
    if evidence_used:
        memo_lines.extend([
            "## Citations",
            "",
        ])
        for evidence in sorted(evidence_used, key=lambda x: x["index"]):
            citation_text = format_citation(evidence, evidence["index"])
            memo_lines.append(citation_text)
    
    memo_text = "\n".join(memo_lines)
    
    return {
        "memo_text": memo_text,
        "citations": evidence_used,
        "metadata": {
            "query": query,
            "timestamp": datetime.utcnow().isoformat() + "Z",
            "has_evidence": True,
            "claims_count": len(claims),
            "concepts_count": len(context_result.get("concepts", [])),
            "evidence_strictness": evidence_strictness,
        },
    }

