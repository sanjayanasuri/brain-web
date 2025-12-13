from fastapi import APIRouter, Depends, HTTPException

from db_neo4j import get_neo4j_session
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


@router.get("/")
def list_branches_endpoint(session=Depends(get_neo4j_session)):
    graph_id, active_branch_id = get_active_graph_context(session)
    branches = list_branches(session)
    return {"graph_id": graph_id, "active_branch_id": active_branch_id, "branches": branches}


@router.post("/create")
def create_branch_endpoint(payload: BranchCreateRequest, session=Depends(get_neo4j_session)):
    b = create_branch(session, payload.name)
    return b


@router.post("/{branch_id}/select")
def select_branch_endpoint(branch_id: str, session=Depends(get_neo4j_session)):
    try:
        graph_id, active_branch_id = set_active_branch(session, branch_id)
        return {"graph_id": graph_id, "active_branch_id": active_branch_id}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/{branch_id}/fork-from-node/{node_id}")
def fork_from_node_endpoint(
    branch_id: str,
    node_id: str,
    payload: BranchForkRequest,
    session=Depends(get_neo4j_session),
):
    try:
        return fork_branch_from_node(session, branch_id=branch_id, node_id=node_id, depth=payload.depth)
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/{branch_id}/paths")
def get_paths_endpoint(branch_id: str, session=Depends(get_neo4j_session)):
    try:
        return get_branch_graph(session, branch_id)
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/{branch_id}/compare/{other_branch_id}", response_model=BranchCompareResponse)
def compare_endpoint(branch_id: str, other_branch_id: str, session=Depends(get_neo4j_session)):
    try:
        return compare_branches(session, branch_id, other_branch_id)
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/compare", response_model=BranchLLMCompareResponse)
def llm_compare_endpoint(payload: BranchLLMCompareRequest, session=Depends(get_neo4j_session)):
    try:
        a = get_branch_graph(session, payload.branch_id)
        b = get_branch_graph(session, payload.other_branch_id)
        data = llm_compare_branches(branch_a_graph=a, branch_b_graph=b, question=payload.question)
        return data
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))
