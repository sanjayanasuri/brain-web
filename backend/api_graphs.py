from fastapi import APIRouter, Depends, HTTPException

from db_neo4j import get_neo4j_session
from models import GraphCreateRequest, GraphListResponse, GraphRenameRequest, GraphSelectResponse
from services_branch_explorer import (
    create_graph,
    delete_graph,
    list_graphs,
    rename_graph,
    set_active_graph,
    get_active_graph_context,
)

router = APIRouter(prefix="/graphs", tags=["graphs"])


@router.get("/", response_model=GraphListResponse)
def list_graphs_endpoint(session=Depends(get_neo4j_session)):
    graphs = list_graphs(session)
    active_graph_id, active_branch_id = get_active_graph_context(session)
    return {
        "graphs": graphs,
        "active_graph_id": active_graph_id,
        "active_branch_id": active_branch_id,
    }


@router.post("/", response_model=GraphSelectResponse)
def create_graph_endpoint(payload: GraphCreateRequest, session=Depends(get_neo4j_session)):
    g = create_graph(session, payload.name)
    active_graph_id, active_branch_id = set_active_graph(session, g["graph_id"])
    return {
        "active_graph_id": active_graph_id,
        "active_branch_id": active_branch_id,
        "graph": g,
    }


@router.post("/{graph_id}/select", response_model=GraphSelectResponse)
def select_graph_endpoint(graph_id: str, session=Depends(get_neo4j_session)):
    try:
        active_graph_id, active_branch_id = set_active_graph(session, graph_id)
        return {
            "active_graph_id": active_graph_id,
            "active_branch_id": active_branch_id,
            "graph": {"graph_id": active_graph_id},
        }
    except Exception as e:
        raise HTTPException(status_code=404, detail=str(e))


@router.patch("/{graph_id}", response_model=GraphSelectResponse)
def rename_graph_endpoint(graph_id: str, payload: GraphRenameRequest, session=Depends(get_neo4j_session)):
    try:
        g = rename_graph(session, graph_id, payload.name)
        active_graph_id, active_branch_id = get_active_graph_context(session)
        return {
            "active_graph_id": active_graph_id,
            "active_branch_id": active_branch_id,
            "graph": g,
        }
    except Exception as e:
        raise HTTPException(status_code=404, detail=str(e))


@router.delete("/{graph_id}")
def delete_graph_endpoint(graph_id: str, session=Depends(get_neo4j_session)):
    try:
        delete_graph(session, graph_id)
        return {"status": "ok"}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
