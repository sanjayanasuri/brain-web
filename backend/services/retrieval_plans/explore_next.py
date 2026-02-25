"""Plan 7: EXPLORE_NEXT."""
from typing import Any, Optional

from neo4j import Session

from services_retrieval_helpers import rank_concepts_for_explore
from models import RetrievalResult, RetrievalTraceStep, Intent

from .definition_overview import plan_definition_overview


def plan_explore_next(
    session: Session,
    query: str,
    graph_id: str,
    branch_id: str,
    limit: int,
    detail_level: str = "summary",
    ingestion_run_id: Optional[Any] = None,
) -> RetrievalResult:
    trace = []

    trace.append(RetrievalTraceStep(step="run_definition_overview", params={}, counts={}))
    overview_result = plan_definition_overview(session, query, graph_id, branch_id, limit, detail_level, ingestion_run_id)
    trace[-1].counts = {
        "concepts": len(overview_result.context.get("focus_entities", [])),
        "claims": len(overview_result.context.get("claims", [])),
    }

    subgraph = overview_result.context.get("subgraph", {})
    concepts = subgraph.get("concepts", [])
    edges = subgraph.get("edges", [])

    trace.append(RetrievalTraceStep(step="rank_next_nodes", params={}, counts={}))
    ranked_concepts = rank_concepts_for_explore(concepts, edges)
    trace[-1].counts = {"ranked_concepts": len(ranked_concepts)}

    trace.append(RetrievalTraceStep(step="generate_suggestions", params={}, counts={}))
    suggestions = []
    for concept in ranked_concepts[:5]:
        name = concept.get("name", "")
        suggestions.append({
            "label": f"Explore {name}",
            "query": f"What is {name}?",
            "intent": Intent.DEFINITION_OVERVIEW.value,
        })
    trace[-1].counts = {"suggestions": len(suggestions)}

    context = {
        "focus_entities": ranked_concepts[:15],
        "focus_communities": overview_result.context.get("focus_communities", []),
        "claims": overview_result.context.get("claims", [])[:15],
        "chunks": overview_result.context.get("chunks", [])[:10],
        "subgraph": subgraph,
        "suggestions": suggestions,
        "warnings": [],
    }

    return RetrievalResult(intent=Intent.EXPLORE_NEXT.value, trace=trace, context=context)
