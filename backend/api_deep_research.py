from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks
from pydantic import BaseModel
from typing import Optional, List, Dict, Any
from auth import require_auth
from services_deep_research import perform_deep_research
import logging

router = APIRouter(prefix="/deep-research", tags=["deep-research"])
logger = logging.getLogger("brain_web")

class DeepResearchRequest(BaseModel):
    topic: str
    breadth: int = 3
    depth: int = 1
    intent: str = "auto"
    graph_id: Optional[str] = None
    branch_id: Optional[str] = None
    use_exa_research: bool = False
    exa_research_wait: bool = True
    exa_research_timeout_seconds: int = 300
    exa_research_model: Optional[str] = None

class DeepResearchResponse(BaseModel):
    status: str
    message: str
    data: Optional[Dict[str, Any]] = None

@router.post("/run", response_model=DeepResearchResponse)
async def run_deep_research(
    payload: DeepResearchRequest,
    current_user: dict = Depends(require_auth)
):
    """
    Trigger a Deep Research run.
    This performs live search, ingestion, and analysis.
    """
    logger.info(f"[Deep Research] Received request for topic: '{payload.topic}' (depth={payload.depth}, breadth={payload.breadth})")
    try:
        result = await perform_deep_research(
            topic=payload.topic,
            breadth=payload.breadth,
            depth=payload.depth,
            intent=payload.intent,
            graph_id=payload.graph_id,
            branch_id=payload.branch_id,
            use_exa_research=payload.use_exa_research,
            exa_research_wait=payload.exa_research_wait,
            exa_research_timeout_seconds=payload.exa_research_timeout_seconds,
            exa_research_model=payload.exa_research_model,
        )
        
        return DeepResearchResponse(
            status="completed",
            message=f"Deep research completed for '{payload.topic}'",
            data=result
        )
        
    except Exception as e:
        logger.error(f"Deep Research endpoint failed: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))
