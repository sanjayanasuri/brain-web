from fastapi import APIRouter, Depends, HTTPException, Query, Request
from typing import Optional, List
from neo4j import Session

from db_neo4j import get_neo4j_session
from auth import require_auth
from models import GraphCreateRequest, GraphListResponse, GraphRenameRequest, GraphSelectResponse, Concept
from services_branch_explorer import (
    create_graph,
    delete_graph,
    list_graphs,
    rename_graph,
    set_active_graph,
    get_active_graph_context,
    ensure_graph_scoping_initialized,
)
from services_graph import (
    get_graph_overview,
    get_neighbors_with_relationships,
    get_concept_by_id,
    _normalize_concept_from_db,
    _normalize_include_proposed,
    _build_edge_visibility_where_clause,
)
from cache_utils import get_cached, set_cached, invalidate_cache_pattern

router = APIRouter(prefix="/graphs", tags=["graphs"])


@router.get("/", response_model=GraphListResponse)
def list_graphs_endpoint(
    request: Request,
    session=Depends(get_neo4j_session),
):
    tenant_id = getattr(request.state, "tenant_id", None)
    graphs = list_graphs(session, tenant_id=tenant_id)
    active_graph_id, active_branch_id = get_active_graph_context(session, tenant_id=tenant_id)
    return {
        "graphs": graphs,
        "active_graph_id": active_graph_id,
        "active_branch_id": active_branch_id,
    }


@router.post("/", response_model=GraphSelectResponse)
def create_graph_endpoint(
    payload: GraphCreateRequest,
    request: Request,
    auth: dict = Depends(require_auth),
    session=Depends(get_neo4j_session),
):
    tenant_id = getattr(request.state, "tenant_id", None)
    g = create_graph(
        session,
        payload.name,
        template_id=payload.template_id,
        template_label=payload.template_label,
        template_description=payload.template_description,
        template_tags=payload.template_tags,
        intent=payload.intent,
        tenant_id=tenant_id,
    )
    active_graph_id, active_branch_id = set_active_graph(session, g["graph_id"])
    return {
        "active_graph_id": active_graph_id,
        "active_branch_id": active_branch_id,
        "graph": g,
    }


@router.post("/{graph_id}/select", response_model=GraphSelectResponse)
def select_graph_endpoint(
    graph_id: str,
    request: Request,
    auth: dict = Depends(require_auth),
    session=Depends(get_neo4j_session),
):
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
def rename_graph_endpoint(
    graph_id: str,
    payload: GraphRenameRequest,
    request: Request,
    auth: dict = Depends(require_auth),
    session=Depends(get_neo4j_session),
):
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
def delete_graph_endpoint(
    graph_id: str,
    request: Request,
    auth: dict = Depends(require_auth),
    session=Depends(get_neo4j_session),
):
    try:
        delete_graph(session, graph_id)
        return {"status": "ok"}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/{graph_id}/overview")
def get_graph_overview_endpoint(
    graph_id: str,
    request: Request,
    limit_nodes: int = 300,
    limit_edges: int = 600,
    include_proposed: str = "auto",
    session=Depends(get_neo4j_session),
):
    """
    Get a lightweight overview of the graph with top nodes by degree.
    
    Returns a sampled subset of the graph for fast initial loading.
    Cached for 2 minutes to improve performance.
    """
    # Try cache first (cache key includes all parameters)
    cache_key = ("graph_overview", graph_id, limit_nodes, limit_edges, include_proposed)
    cached_result = get_cached(*cache_key, ttl_seconds=120)
    if cached_result is not None:
        return cached_result
    
    try:
        # Set the active graph context
        set_active_graph(session, graph_id)
        ensure_graph_scoping_initialized(session)
        
        result = get_graph_overview(session, limit_nodes=limit_nodes, limit_edges=limit_edges, include_proposed=include_proposed)
        response = {
            "nodes": result["nodes"],
            "edges": result["edges"],
            "meta": result["meta"]
        }
        
        # Log for debugging if no nodes found
        if len(response["nodes"]) == 0:
            import sys
            graph_id_actual, branch_id_actual = get_active_graph_context(session)
            print(f"[DEBUG] Graph {graph_id} overview returned 0 nodes (active context: graph_id={graph_id_actual}, branch_id={branch_id_actual})", file=sys.stderr)
        
        # Cache the result
        set_cached(cache_key[0], response, *cache_key[1:], ttl_seconds=120)
        return response
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/{graph_id}/neighbors")
def get_graph_neighbors_endpoint(
    graph_id: str,
    concept_id: str,
    request: Request,
    hops: int = 1,
    limit: int = 80,
    include_proposed: str = "auto",
    auth: dict = Depends(require_auth),
    session=Depends(get_neo4j_session),
):
    """
    Get neighbors of a concept within a specific graph.
    
    Returns the center node and its neighbors with relationships.
    Cached for 1 minute to improve performance.
    """
    # Try cache first
    cache_key = ("graph_neighbors", graph_id, concept_id, hops, limit, include_proposed)
    cached_result = get_cached(*cache_key, ttl_seconds=60)
    if cached_result is not None:
        return cached_result
    
    try:
        # Set the active graph context
        set_active_graph(session, graph_id)
        ensure_graph_scoping_initialized(session)
        
        # Get the center node
        center = get_concept_by_id(session, concept_id)
        if not center:
            raise HTTPException(status_code=404, detail=f"Concept {concept_id} not found")
        
        # Get neighbors (only 1-hop for now)
        neighbors_with_rels = get_neighbors_with_relationships(session, concept_id, include_proposed=include_proposed)
        
        # Limit results
        if limit > 0:
            neighbors_with_rels = neighbors_with_rels[:limit]
        
        # Extract nodes and edges
        nodes = [center]
        edges = []
        node_ids = {center.node_id}
        
        for item in neighbors_with_rels:
            neighbor = item["concept"]
            if neighbor.node_id not in node_ids:
                nodes.append(neighbor)
                node_ids.add(neighbor.node_id)
            
            # Create edge
            source_id = concept_id if item["is_outgoing"] else neighbor.node_id
            target_id = neighbor.node_id if item["is_outgoing"] else concept_id
            
            edges.append({
                "source_id": source_id,
                "target_id": target_id,
                "predicate": item["predicate"],
                "status": item.get("relationship_status", "ACCEPTED"),
                "confidence": item.get("relationship_confidence", 0.0),
                "method": item.get("relationship_method", "unknown"),
                "rationale": item.get("relationship_rationale"),
                "relationship_source_id": item.get("relationship_source_id"),
                "chunk_id": item.get("relationship_chunk_id"),
            })
        
        response = {
            "center": center,
            "nodes": nodes,
            "edges": edges,
        }
        
        # Cache the result
        set_cached(cache_key[0], response, *cache_key[1:], ttl_seconds=60)
        return response
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/{graph_id}/concepts")
def list_graph_concepts_endpoint(
    graph_id: str,
    query: Optional[str] = Query(None, description="Search query for concept name"),
    domain: Optional[str] = Query(None, description="Filter by domain"),
    type: Optional[str] = Query(None, description="Filter by type"),
    sort: str = Query("alphabetical", description="Sort order: 'alphabetical', 'degree', 'recent'"),
    limit: int = Query(50, ge=1, le=200, description="Maximum number of concepts to return"),
    offset: int = Query(0, ge=0, description="Offset for pagination"),
    session: Session = Depends(get_neo4j_session),
):
    """
    List concepts in a graph with filtering, sorting, and pagination.
    
    Returns a paginated list of concepts with optional filters and sorting.
    """
    try:
        # Set the active graph context
        set_active_graph(session, graph_id)
        ensure_graph_scoping_initialized(session)
        
        # Get the active graph context (should match graph_id after set_active_graph)
        graph_id_ctx, branch_id = get_active_graph_context(session)
        # Use the context graph_id to ensure consistency (in case set_active_graph adjusted it)
        # If they don't match, log it but continue with the context graph_id
        if graph_id_ctx != graph_id:
            import logging
            logger = logging.getLogger("brain_web")
            logger.warning(f"Graph ID mismatch: requested {graph_id}, got {graph_id_ctx} from context")
        actual_graph_id = graph_id_ctx
        
        # Build WHERE clause for filters
        where_clauses = [
            "$branch_id IN COALESCE(c.on_branches, [])",
            "COALESCE(c.is_merged, false) = false"
        ]
        
        params = {
            "graph_id": actual_graph_id,
            "branch_id": branch_id,
        }
        
        if query:
            where_clauses.append("toLower(c.name) CONTAINS toLower($query)")
            params["query"] = query
        
        if domain:
            where_clauses.append("c.domain = $domain")
            params["domain"] = domain
        
        if type:
            where_clauses.append("c.type = $type")
            params["type"] = type
        
        where_clause = " AND ".join(where_clauses)
        
        # Build the query - always include degree for potential sorting/display
        if sort == "degree":
            # Sort by degree
            cypher_query = f"""
            MATCH (g:GraphSpace {{graph_id: $graph_id}})
            MATCH (c:Concept)-[:BELONGS_TO]->(g)
            WHERE {where_clause}
            OPTIONAL MATCH (c)-[r]-(n:Concept)-[:BELONGS_TO]->(g)
            WHERE $branch_id IN COALESCE(r.on_branches, [])
              AND $branch_id IN COALESCE(n.on_branches, [])
            WITH c, count(DISTINCT r) AS degree
            RETURN c.node_id AS node_id,
                   c.name AS name,
                   c.domain AS domain,
                   c.type AS type,
                   c.description AS description,
                   c.tags AS tags,
                   c.notes_key AS notes_key,
                   c.lecture_key AS lecture_key,
                   c.url_slug AS url_slug,
                   COALESCE(c.lecture_sources, []) AS lecture_sources,
                   c.created_by AS created_by,
                   c.last_updated_by AS last_updated_by,
                   degree
            ORDER BY degree DESC, c.name ASC
            SKIP $offset
            LIMIT $limit
            """
        elif sort == "recent":
            # Note: We don't have event log yet, so fall back to alphabetical
            # This can be enhanced later when event log is available
            cypher_query = f"""
            MATCH (g:GraphSpace {{graph_id: $graph_id}})
            MATCH (c:Concept)-[:BELONGS_TO]->(g)
            WHERE {where_clause}
            OPTIONAL MATCH (c)-[r]-(n:Concept)-[:BELONGS_TO]->(g)
            WHERE $branch_id IN COALESCE(r.on_branches, [])
              AND $branch_id IN COALESCE(n.on_branches, [])
            WITH c, count(DISTINCT r) AS degree
            RETURN c.node_id AS node_id,
                   c.name AS name,
                   c.domain AS domain,
                   c.type AS type,
                   c.description AS description,
                   c.tags AS tags,
                   c.notes_key AS notes_key,
                   c.lecture_key AS lecture_key,
                   c.url_slug AS url_slug,
                   COALESCE(c.lecture_sources, []) AS lecture_sources,
                   c.created_by AS created_by,
                   c.last_updated_by AS last_updated_by,
                   degree
            ORDER BY c.name ASC
            SKIP $offset
            LIMIT $limit
            """
        else:  # alphabetical
            cypher_query = f"""
            MATCH (g:GraphSpace {{graph_id: $graph_id}})
            MATCH (c:Concept)-[:BELONGS_TO]->(g)
            WHERE {where_clause}
            OPTIONAL MATCH (c)-[r]-(n:Concept)-[:BELONGS_TO]->(g)
            WHERE $branch_id IN COALESCE(r.on_branches, [])
              AND $branch_id IN COALESCE(n.on_branches, [])
            WITH c, count(DISTINCT r) AS degree
            RETURN c.node_id AS node_id,
                   c.name AS name,
                   c.domain AS domain,
                   c.type AS type,
                   c.description AS description,
                   c.tags AS tags,
                   c.notes_key AS notes_key,
                   c.lecture_key AS lecture_key,
                   c.url_slug AS url_slug,
                   COALESCE(c.lecture_sources, []) AS lecture_sources,
                   c.created_by AS created_by,
                   c.last_updated_by AS last_updated_by,
                   degree
            ORDER BY c.name ASC
            SKIP $offset
            LIMIT $limit
            """
        
        params["offset"] = offset
        params["limit"] = limit
        
        result = session.run(cypher_query, **params)
        
        # Get total count for pagination
        count_query = f"""
        MATCH (g:GraphSpace {{graph_id: $graph_id}})
        MATCH (c:Concept)-[:BELONGS_TO]->(g)
        WHERE {where_clause}
        RETURN count(c) AS total
        """
        count_result = session.run(count_query, **{k: v for k, v in params.items() if k not in ["offset", "limit"]})
        total = count_result.single()["total"] if count_result.peek() else 0
        
        # Format response with degree
        items = []
        for record in result:
            concept = _normalize_concept_from_db(record.data())
            item = {
                "concept_id": concept.node_id,
                "name": concept.name,
                "domain": concept.domain,
                "type": concept.type,
            }
            # Add degree if available
            if "degree" in record:
                item["degree"] = record["degree"]
            items.append(item)
        
        return {
            "items": items,
            "total": total,
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
