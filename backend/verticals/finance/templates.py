"""
Finance output templates per lens.
"""
from verticals.finance.schema import FinanceLens


def render_finance_answer_template(lens: FinanceLens) -> str:
    """
    Return a system message / response skeleton for the given finance lens.
    
    Args:
        lens: Finance lens name
    
    Returns:
        Template string with structured sections
    """
    templates = {
        "fundamentals": """You are analyzing financial fundamentals. Structure your answer as:

## Snapshot (Last 4 Quarters)
- Revenue, GM, Op Margin, EPS (if available in graph)
- Key metrics and trends

## Trend Notes
- What moved and why
- Quarter-over-quarter and year-over-year changes

## Guidance + Deltas
- Management guidance vs actuals
- Guidance revisions and implications

## What to Watch Next Quarter
- Key metrics to monitor
- Expected changes

## Evidence
- Top claims with sources and confidence scores
- Source citations

Be specific and cite evidence from the graph context.""",

        "catalysts": """You are analyzing recent catalysts and events. Structure your answer as:

## What Changed Recently (Ranked by Recency + Confidence)
- Recent events, news, announcements
- SEC filings, analyst actions
- Market-moving developments

## Why It Matters (Mechanism)
- How each catalyst affects the company
- Direct and indirect impacts

## Second-Order Effects
- Impact on competitors
- Impact on suppliers/customers
- Market implications

## Open Questions / What Would Falsify
- What would change the thesis
- Key uncertainties
- Monitoring signals

Cite specific claims with sources and timestamps when available.""",

        "competition": """You are analyzing competitive positioning. Structure your answer as:

## Competitive Map
- Direct competitors vs adjacent players
- Market positioning

## Differentiators (Claims Supported)
- Unique advantages
- Evidence-backed differentiators

## Switching Costs / Moats
- Barriers to entry
- Competitive moats
- Customer lock-in factors

## Where Competitors Win
- Areas where competitors have advantages
- Market segments competitors dominate

Cite specific claims and evidence from the graph context.""",

        "risks": """You are analyzing risks and vulnerabilities. Structure your answer as:

## Risk Register
For each risk:
- Mechanism: How the risk manifests
- Severity: Impact assessment
- Evidence: Supporting claims and sources

## Mitigations / Hedges
- How the company addresses risks
- Risk management strategies
(Note: Not investment advice)

## Monitoring Signals
- Early warning indicators
- Metrics to track
- Red flags

Be specific and cite evidence. Do not provide investment advice.""",

        "narrative": """You are analyzing the investment narrative and thesis. Structure your answer as:

## Core Thesis
- Main investment story
- Central narrative

## Supporting Pillars
- Key supporting arguments
- Evidence-backed claims

## Weak Points / Counterarguments
- Potential flaws in the thesis
- Contradictory evidence
- Alternative narratives

## "If X Happens, Thesis Changes"
- Key scenarios that would alter the thesis
- Tipping points
- Critical assumptions

Cite specific claims and evidence. Present balanced analysis."""
    }
    
    return templates.get(lens, templates["catalysts"])
