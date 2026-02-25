from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel, Field

from auth import require_auth
from db_neo4j import get_neo4j_session
from services_refresh_bindings import (
    get_concept_refresh_binding,
    get_graph_refresh_defaults,
    run_concept_refresh,
    run_due_refreshes_for_active_context,
    run_due_refreshes_for_all_active_contexts,
    set_concept_refresh_binding,
    set_graph_refresh_defaults,
)

router = APIRouter(prefix="/refresh", tags=["refresh"])


class RefreshCheckConfigModel(BaseModel):
    check_id: Optional[str] = None
    kind: str
    query: str
    title: Optional[str] = None
    enabled: bool = True
    params: Dict[str, Any] = Field(default_factory=dict)


class RefreshBindingConfigModel(BaseModel):
    version: int = 1
    enabled: bool = False
    inherit_workspace_defaults: bool = True
    triggers: List[str] = Field(default_factory=lambda: ["manual"])
    ttl_seconds: int = Field(default=3600, ge=30, le=604800)
    checks: List[RefreshCheckConfigModel] = Field(default_factory=list)


class UpdateConceptRefreshBindingRequest(BaseModel):
    config: RefreshBindingConfigModel


class UpdateGraphRefreshDefaultsRequest(BaseModel):
    refresh_defaults: RefreshBindingConfigModel


class RunConceptRefreshRequest(BaseModel):
    trigger: str = Field(default="manual")
    force: bool = Field(default=False)


class RunDueRefreshesRequest(BaseModel):
    all_contexts: bool = False
    force: bool = False
    limit_contexts: int = Field(default=25, ge=1, le=500)
    limit_nodes_per_context: int = Field(default=10, ge=1, le=100)
    scan_limit_per_context: int = Field(default=200, ge=1, le=5000)


def _require_graph_identity(request: Request) -> tuple[str, str]:
    user_id = getattr(request.state, "user_id", None)
    tenant_id = getattr(request.state, "tenant_id", None)
    if not user_id or not tenant_id:
        raise HTTPException(status_code=401, detail="Authentication with tenant context is required")
    return str(user_id), str(tenant_id)


@router.get("/concepts/{concept_id}")
def get_concept_refresh_binding_endpoint(
    concept_id: str,
    request: Request,
    auth: dict = Depends(require_auth),
    session=Depends(get_neo4j_session),
):
    user_id, tenant_id = _require_graph_identity(request)
    try:
        return get_concept_refresh_binding(
            session=session,
            concept_id=concept_id,
            tenant_id=tenant_id,
            user_id=user_id,
        )
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to load refresh binding: {str(e)}")


@router.put("/concepts/{concept_id}")
def update_concept_refresh_binding_endpoint(
    concept_id: str,
    payload: UpdateConceptRefreshBindingRequest,
    request: Request,
    auth: dict = Depends(require_auth),
    session=Depends(get_neo4j_session),
):
    user_id, tenant_id = _require_graph_identity(request)
    try:
        return set_concept_refresh_binding(
            session=session,
            concept_id=concept_id,
            tenant_id=tenant_id,
            user_id=user_id,
            refresh_config=payload.config.dict(),
        )
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to update refresh binding: {str(e)}")


@router.post("/concepts/{concept_id}/run")
async def run_concept_refresh_endpoint(
    concept_id: str,
    payload: RunConceptRefreshRequest,
    request: Request,
    auth: dict = Depends(require_auth),
    session=Depends(get_neo4j_session),
):
    user_id, tenant_id = _require_graph_identity(request)
    try:
        return await run_concept_refresh(
            session=session,
            concept_id=concept_id,
            tenant_id=tenant_id,
            user_id=user_id,
            trigger=payload.trigger,
            force=payload.force,
        )
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to run refresh: {str(e)}")


@router.get("/graphs/{graph_id}")
def get_graph_refresh_defaults_endpoint(
    graph_id: str,
    request: Request,
    auth: dict = Depends(require_auth),
    session=Depends(get_neo4j_session),
):
    _, tenant_id = _require_graph_identity(request)
    try:
        return get_graph_refresh_defaults(session=session, graph_id=graph_id, tenant_id=tenant_id)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to load graph refresh defaults: {str(e)}")


@router.put("/graphs/{graph_id}")
def update_graph_refresh_defaults_endpoint(
    graph_id: str,
    payload: UpdateGraphRefreshDefaultsRequest,
    request: Request,
    auth: dict = Depends(require_auth),
    session=Depends(get_neo4j_session),
):
    _, tenant_id = _require_graph_identity(request)
    try:
        return set_graph_refresh_defaults(
            session=session,
            graph_id=graph_id,
            tenant_id=tenant_id,
            refresh_defaults=payload.refresh_defaults.dict(),
        )
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to update graph refresh defaults: {str(e)}")


@router.post("/scheduler/run-due")
async def run_due_refreshes_endpoint(
    payload: RunDueRefreshesRequest,
    request: Request,
    auth: dict = Depends(require_auth),
    session=Depends(get_neo4j_session),
):
    user_id, tenant_id = _require_graph_identity(request)
    try:
        if payload.all_contexts:
            # Keep this opt-in and admin-like by requiring an explicit env gate.
            import os

            if str(os.getenv("ENABLE_REFRESH_ALL_CONTEXTS_API", "")).lower() not in {"1", "true", "yes", "on"}:
                raise HTTPException(status_code=403, detail="All-context scheduled refresh API is disabled")
            return await run_due_refreshes_for_all_active_contexts(
                session=session,
                tenant_id=tenant_id,
                limit_contexts=payload.limit_contexts,
                limit_nodes_per_context=payload.limit_nodes_per_context,
                scan_limit_per_context=payload.scan_limit_per_context,
                force=payload.force,
            )

        return await run_due_refreshes_for_active_context(
            session=session,
            tenant_id=tenant_id,
            user_id=user_id,
            limit_nodes=payload.limit_nodes_per_context,
            scan_limit=payload.scan_limit_per_context,
            force=payload.force,
        )
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to run scheduled refreshes: {str(e)}")
