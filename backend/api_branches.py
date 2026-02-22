from fastapi import APIRouter, Depends, HTTPException, Request

from db_neo4j import get_neo4j_session
from auth import require_auth
from models import (
    BranchCompareResponse,
    BranchCreateRequest,
    BranchForkRequest,
    BranchLLMCompareRequest,
    BranchLLMCompareResponse,
)
from services_branch_explorer import get_active_graph_context, set_active_branch
from services_branches import compare_branches, create_branch, fork_branch_from_node, get_branch_graph, list_branches
from services_branch_ai import llm_compare_branches

router = APIRouter(prefix="/branches", tags=["branches"])


def _require_graph_identity(request: Request) -> tuple[str, str]:
    user_id = getattr(request.state, "user_id", None)
    tenant_id = getattr(request.state, "tenant_id", None)
    if not user_id or not tenant_id:
        raise HTTPException(status_code=401, detail="Authentication with tenant context is required")
    return str(user_id), str(tenant_id)


@router.get("/")
def list_branches_endpoint(
    request: Request,
    auth: dict = Depends(require_auth),
    session=Depends(get_neo4j_session),
):
    user_id, tenant_id = _require_graph_identity(request)
    graph_id, active_branch_id = get_active_graph_context(
        session,
        tenant_id=tenant_id,
        user_id=user_id,
    )
    branches = list_branches(session, tenant_id=tenant_id, user_id=user_id)
    return {"graph_id": graph_id, "active_branch_id": active_branch_id, "branches": branches}


@router.post("/create")
def create_branch_endpoint(
    payload: BranchCreateRequest,
    request: Request,
    auth: dict = Depends(require_auth),
    session=Depends(get_neo4j_session),
):
    user_id, tenant_id = _require_graph_identity(request)
    b = create_branch(session, payload.name, tenant_id=tenant_id, user_id=user_id)
    return b


@router.post("/{branch_id}/select")
def select_branch_endpoint(
    branch_id: str,
    request: Request,
    auth: dict = Depends(require_auth),
    session=Depends(get_neo4j_session),
):
    try:
        user_id, tenant_id = _require_graph_identity(request)
        graph_id, active_branch_id = set_active_branch(
            session,
            branch_id,
            tenant_id=tenant_id,
            user_id=user_id,
        )
        return {"graph_id": graph_id, "active_branch_id": active_branch_id}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/{branch_id}/fork-from-node/{node_id}")
def fork_from_node_endpoint(
    branch_id: str,
    node_id: str,
    payload: BranchForkRequest,
    request: Request,
    auth: dict = Depends(require_auth),
    session=Depends(get_neo4j_session),
):
    try:
        user_id, tenant_id = _require_graph_identity(request)
        return fork_branch_from_node(
            session,
            branch_id=branch_id,
            node_id=node_id,
            depth=payload.depth,
            tenant_id=tenant_id,
            user_id=user_id,
        )
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/{branch_id}/paths")
def get_paths_endpoint(
    branch_id: str,
    request: Request,
    auth: dict = Depends(require_auth),
    session=Depends(get_neo4j_session),
):
    try:
        user_id, tenant_id = _require_graph_identity(request)
        return get_branch_graph(session, branch_id, tenant_id=tenant_id, user_id=user_id)
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/{branch_id}/compare/{other_branch_id}", response_model=BranchCompareResponse)
def compare_endpoint(
    branch_id: str,
    other_branch_id: str,
    request: Request,
    auth: dict = Depends(require_auth),
    session=Depends(get_neo4j_session),
):
    try:
        user_id, tenant_id = _require_graph_identity(request)
        return compare_branches(
            session,
            branch_id,
            other_branch_id,
            tenant_id=tenant_id,
            user_id=user_id,
        )
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/compare", response_model=BranchLLMCompareResponse)
def llm_compare_endpoint(
    payload: BranchLLMCompareRequest,
    request: Request,
    auth: dict = Depends(require_auth),
    session=Depends(get_neo4j_session),
):
    try:
        user_id, tenant_id = _require_graph_identity(request)
        a = get_branch_graph(session, payload.branch_id, tenant_id=tenant_id, user_id=user_id)
        b = get_branch_graph(session, payload.other_branch_id, tenant_id=tenant_id, user_id=user_id)
        data = llm_compare_branches(branch_a_graph=a, branch_b_graph=b, question=payload.question)
        return data
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))
