"""
API endpoints for finance data ingestion.

Do not call backend endpoints from backend services. Use ingestion kernel/internal services to prevent ingestion path drift.
"""
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from typing import List, Optional
from neo4j import Session

from db_neo4j import get_neo4j_session
from services_finance_ingestion import ingest_finance_sources
from services_branch_explorer import (
    ensure_graph_scoping_initialized,
    get_active_graph_context,
)

router = APIRouter(prefix="/finance", tags=["finance"])


class FinanceIngestRequest(BaseModel):
    """Request to ingest finance sources."""
    ticker: str
    since_days: int = 30
    limit: int = 20
    connectors: List[str] = ["edgar", "ir", "news"]
    mode: str = "graphrag"  # For future use


class FinanceIngestResponse(BaseModel):
    """Response from finance ingestion."""
    documents_fetched: int
    chunks_created: int
    claims_created: int
    proposed_edges_created: int
    errors: List[str]
    ingested_docs: List[dict]
    run_id: Optional[str] = None  # ingestion_run_id for this ingestion


@router.post("/ingest", response_model=FinanceIngestResponse)
def ingest_finance_endpoint(
    request: FinanceIngestRequest,
    session: Session = Depends(get_neo4j_session)
):
    """
    Ingest finance data from configured sources (EDGAR, IR, News RSS).
    
    Args:
        request: FinanceIngestRequest with ticker and options
        session: Neo4j session (dependency)
    
    Returns:
        FinanceIngestResponse with ingestion results
    """
    try:
        # Ensure graph scoping is initialized
        ensure_graph_scoping_initialized(session)
        graph_id, branch_id = get_active_graph_context(session)
        
        # Validate connectors
        valid_connectors = ["edgar", "ir", "news"]
        connectors = [c for c in request.connectors if c in valid_connectors]
        if not connectors:
            raise HTTPException(
                status_code=400,
                detail=f"At least one valid connector required. Valid: {valid_connectors}"
            )
        
        # Run ingestion
        result = ingest_finance_sources(
            session=session,
            graph_id=graph_id,
            branch_id=branch_id,
            ticker=request.ticker,
            since_days=request.since_days,
            limit=request.limit,
            connectors=connectors
        )
        
        return FinanceIngestResponse(**result)
    
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Finance ingestion failed: {str(e)}"
        )
