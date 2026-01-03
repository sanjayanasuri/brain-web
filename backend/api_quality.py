"""
API endpoints for quality metrics (coverage, freshness, graph health).
"""
from fastapi import APIRouter, Depends, HTTPException, Query
from typing import Optional, List
from pydantic import BaseModel
from neo4j import Session
from db_neo4j import get_neo4j_session
from services_quality import (
    compute_concept_coverage,
    compute_evidence_freshness,
    compute_graph_health,
    compute_narrative_metrics
)

router = APIRouter(prefix="/quality", tags=["quality"])


class NarrativeMetricsRequest(BaseModel):
    concept_ids: List[str]


@router.get("/concepts/{concept_id}")
def get_concept_quality(
    concept_id: str,
    graph_id: Optional[str] = Query(None, description="Graph ID (optional, uses active if not provided)"),
    session: Session = Depends(get_neo4j_session)
):
    """
    Get quality metrics for a concept.
    
    Returns:
        {
            "concept_id": str,
            "coverage_score": int (0-100),
            "coverage_breakdown": {
                "has_description": bool,
                "evidence_count": int,
                "degree": int,
                "reviewed_ratio": Optional[float]
            },
            "freshness": {
                "level": "Fresh" | "Aging" | "Stale" | "No evidence",
                "newest_evidence_at": Optional[str]
            }
        }
    """
    try:
        coverage = compute_concept_coverage(session, concept_id, graph_id)
        freshness = compute_evidence_freshness(session, concept_id)
        
        return {
            "concept_id": concept_id,
            "coverage_score": coverage["coverage_score"],
            "coverage_breakdown": coverage["coverage_breakdown"],
            "freshness": freshness
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to compute concept quality: {str(e)}")


@router.get("/graphs/{graph_id}")
def get_graph_quality(
    graph_id: str,
    session: Session = Depends(get_neo4j_session)
):
    """
    Get quality metrics for a graph.
    
    Returns:
        {
            "graph_id": str,
            "health": "HEALTHY" | "NEEDS_ATTENTION" | "POOR",
            "stats": {
                "concepts_total": int,
                "missing_description_pct": float,
                "no_evidence_pct": float,
                "stale_evidence_pct": float,
                "proposed_relationships_count": int
            }
        }
    """
    try:
        health = compute_graph_health(session, graph_id)
        
        return {
            "graph_id": graph_id,
            "health": health["health"],
            "stats": health["stats"]
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to compute graph quality: {str(e)}")


@router.post("/narrative-metrics")
def get_narrative_metrics(
    request: NarrativeMetricsRequest,
    graph_id: Optional[str] = Query(None, description="Graph ID (optional, uses active if not provided)"),
    session: Session = Depends(get_neo4j_session)
):
    """
    Get narrative metrics (recency, mention frequency, centrality) for a list of concepts.
    
    Request body: { "concept_ids": ["N001", "N002", ...] }
    
    Returns:
        {
            "concept_id": {
                "recencyWeight": float (0-1),
                "mentionFrequency": float (0-1),
                "centralityDelta": float (0-1)
            },
            ...
        }
    """
    try:
        metrics = compute_narrative_metrics(session, request.concept_ids, graph_id)
        return metrics
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to compute narrative metrics: {str(e)}")

