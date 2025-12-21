"""
Finance lens router: maps queries to analysis lenses.
"""
from typing import Optional
from verticals.finance.schema import FinanceLens, FINANCE_LENSES


def route_lens(query: str, explicit_lens: Optional[str] = None) -> FinanceLens:
    """
    Route a query to a finance lens using keyword matching.
    
    Args:
        query: User query text
        explicit_lens: Explicitly specified lens (takes precedence)
    
    Returns:
        Finance lens name
    """
    if explicit_lens and explicit_lens in FINANCE_LENSES:
        return explicit_lens
    
    query_lower = query.lower()
    query_tokens = query_lower.split()
    
    # Fundamentals keywords
    fundamentals_keywords = [
        "revenue", "margin", "eps", "guidance", "quarter", "q/q", "y/y",
        "balance sheet", "cash flow", "earnings", "profit", "loss", "ebitda",
        "operating margin", "gross margin", "net margin", "roi", "roe",
        "financials", "financial", "performance", "results", "quarterly", "annual"
    ]
    
    # Catalysts keywords
    catalysts_keywords = [
        "news", "today", "recent", "rumor", "announcement", "lawsuit", "sec",
        "downgrade", "upgrade", "rating", "analyst", "initiated", "coverage",
        "breaking", "update", "latest", "just", "now", "happened", "event",
        "catalyst", "catalysts"
    ]
    
    # Competition keywords
    competition_keywords = [
        "competitor", "vs", "compare", "amd", "intel", "market share", "moat",
        "competitive", "competition", "rival", "versus", "against", "better than",
        "worse than", "differentiator", "advantage", "disadvantage"
    ]
    
    # Risks keywords
    risks_keywords = [
        "risk", "downside", "regulation", "export controls", "supply chain",
        "concentration", "threat", "vulnerability", "concern", "warning",
        "caution", "danger", "problem", "issue", "challenge", "headwind"
    ]
    
    # Narrative keywords
    narrative_keywords = [
        "strategy", "positioning", "thesis", "what is becoming", "long term",
        "story", "narrative", "vision", "future", "direction", "outlook",
        "trajectory", "path", "plan", "roadmap", "evolution"
    ]
    
    # Count keyword matches
    fundamentals_score = sum(1 for kw in fundamentals_keywords if kw in query_lower)
    catalysts_score = sum(1 for kw in catalysts_keywords if kw in query_lower)
    competition_score = sum(1 for kw in competition_keywords if kw in query_lower)
    risks_score = sum(1 for kw in risks_keywords if kw in query_lower)
    narrative_score = sum(1 for kw in narrative_keywords if kw in query_lower)
    
    # If query is very short (likely just a company name), default to catalysts
    if len(query_tokens) <= 6 and max(fundamentals_score, catalysts_score, competition_score, risks_score, narrative_score) == 0:
        return "catalysts"
    
    # Return lens with highest score
    scores = {
        "fundamentals": fundamentals_score,
        "catalysts": catalysts_score,
        "competition": competition_score,
        "risks": risks_score,
        "narrative": narrative_score,
    }
    
    max_score = max(scores.values())
    if max_score > 0:
        # Return the lens with the highest score
        for lens, score in scores.items():
            if score == max_score:
                return lens
    
    # Default to catalysts for ambiguous queries
    return "catalysts"


def route_lens_llm(query: str) -> FinanceLens:
    """
    Route a query to a finance lens using LLM (stub for future implementation).
    
    Args:
        query: User query text
    
    Returns:
        Finance lens name
    """
    # TODO: Implement LLM-based routing
    return route_lens(query)
