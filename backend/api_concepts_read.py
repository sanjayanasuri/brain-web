"""
Concepts API - read endpoints (search, get by name/slug/id, mentions, notes, cross-graph, neighbors, claims, sources).
"""
from fastapi import APIRouter, Depends, HTTPException, Query
from typing import List, Literal, Optional, Dict, Any
from datetime import datetime

from db_neo4j import get_neo4j_session
from cache_utils import get_cached, set_cached

from models import Concept, LectureMention
from services_graph import (
    get_concept_by_id,
    get_concept_by_name,
    get_concept_by_slug,
    get_all_concepts,
    get_neighbors,
    get_neighbors_with_relationships,
    get_nodes_missing_description,
    find_concept_gaps,
    get_graph_overview,
    get_cross_graph_instances,
    get_linked_cross_graph_instances,
)
from services_lecture_mentions import list_concept_mentions
from services_branch_explorer import ensure_graph_scoping_initialized, get_active_graph_context, set_active_graph
from auth import require_auth
from pydantic import BaseModel

router = APIRouter()


class ConceptNoteEntry(BaseModel):
    id: str
    chat_id: str
    section_id: str
    section_title: str
    summary_text: str
    source_type: str
    confidence_level: Optional[float] = 0.5
    created_at: datetime
    related_node_ids: Optional[List[str]] = []


# Route order: specific paths before /{node_id}

@router.get("/missing-descriptions", response_model=List[Concept])
def get_missing_descriptions(limit: int = 3, session=Depends(get_neo4j_session)):
    """
    Find concepts that are missing descriptions.
    
    PURPOSE:
    Identifies concepts that exist in the graph but don't have descriptions yet.
    This is useful for gap detection - finding areas where knowledge is incomplete.
    
    HOW IT'S USED:
    - Gaps View page uses this to show concepts that need descriptions
    - AI chat can suggest questions to fill these gaps
    - Helps users know what to learn/explain next
    
    EXAMPLE:
    If you have a concept "Neural Networks" but no description, this endpoint
    will return it so you can add a description.
    
    CONNECTS TO:
    - api_gaps.py - Uses this for comprehensive gap analysis
    - Frontend Gaps View - Displays these concepts to the user
    """
    return get_nodes_missing_description(session, limit)


@router.get("/gaps")
def get_concept_gaps_endpoint(limit: int = 5, session=Depends(get_neo4j_session)):
    """
    Find knowledge gaps in the graph.
    
    PURPOSE:
    Identifies concepts that represent gaps in your knowledge. Uses heuristics:
    - Concepts with short descriptions (less detail)
    - Concepts with low degree (few relationships to other concepts)
    
    WHY THIS MATTERS:
    A well-connected concept has many relationships and a detailed description.
    A gap is a concept that's isolated or poorly explained - indicating incomplete
    knowledge in that area.
    
    HOW IT'S USED:
    - Gaps View page shows these to help you know what to learn next
    - AI chat can suggest questions to fill these gaps
    - Helps prioritize what to study or explain
    
    EXAMPLE:
    If "Backpropagation" has only 1 relationship and a 10-word description,
    it's a gap. You should expand it with more connections and details.
    
    CONNECTS TO:
    - api_gaps.py - Uses this for comprehensive gap analysis
    - Frontend Gaps View - Displays gaps to the user
    """
    gap_names = find_concept_gaps(session, limit)
    return gap_names


@router.get("/search")
def search_concepts(
    q: str,
    graph_id: Optional[str] = None,
    limit: int = 20,
    session=Depends(get_neo4j_session)
):
    """
    Search for concepts by name (simple keyword search).
    
    PURPOSE:
    Allows users to find concepts by typing part of the name. This is a simple
    keyword search - for semantic search (finding by meaning), see api_ai.py.
    
    HOW IT WORKS:
    - Case-insensitive partial match
    - If you search "neural", it finds "Neural Networks", "Neural Architecture", etc.
    - Optionally filters by graph_id to only return concepts in that graph
    
    HOW IT'S USED:
    - GraphVisualization component uses this for the search bar
    - Users can quickly find concepts they're looking for
    - Command system uses this for "search" commands
    - Omnibox search uses this for concept search
    
    EXAMPLE:
    GET /concepts/search?q=neural&graph_id=my-graph&limit=8
    Returns: Concepts with "neural" in the name, limited to 8 results
    
    NOTE:
    For more intelligent search (finding concepts by meaning, not just name),
    use POST /ai/semantic-search which uses embeddings.
    
    CONNECTS TO:
    - Frontend GraphVisualization - Search functionality
    - Command system - "search" command
    - Omnibox - Concept search
    """
    # Set active graph if provided
    if graph_id:
        set_active_graph(session, graph_id)
        ensure_graph_scoping_initialized(session)
        graph_id_ctx, branch_id = get_active_graph_context(session)
        if graph_id_ctx != graph_id:
            # Graph not found, return empty results
            return {
                "query": q,
                "results": [],
                "count": 0
            }
    
    all_concepts = get_all_concepts(session)
    query_lower = q.lower()
    matched = [c for c in all_concepts if query_lower in c.name.lower()]
    
    # Apply limit
    matched = matched[:limit]
    
    return {
        "query": q,
        "results": matched,
        "count": len(matched)
    }


@router.get("/all/graph")
def get_all_graph_data(
    include_proposed: Literal["auto", "all", "none"] = Query("auto", description="Visibility policy: 'auto' (default), 'all', or 'none'"),
    session=Depends(get_neo4j_session),
    auth_ctx: Dict[str, Any] = Depends(require_auth)
):
    """
    Get the complete graph - all nodes and relationships.
    SECURED: Filters by tenant_id.
    """
    import logging
    logger = logging.getLogger("brain_web")
    
    # Extract tenant_id from auth context
    tenant_id = auth_ctx.get("tenant_id")
    
    try:
        nodes = get_all_concepts(session, tenant_id=tenant_id)
        relationships = get_all_relationships(session, include_proposed=include_proposed, tenant_id=tenant_id)
        logger.debug(f"Fetched {len(nodes)} nodes and {len(relationships)} relationships for tenant {tenant_id}")
        return {
            "nodes": nodes,
            "links": relationships,
        }
    except Exception as e:
        logger.error(f"Error fetching graph data: {e}", exc_info=True)
        # Return empty graph instead of crashing
        return {
            "nodes": [],
            "links": [],
        }


@router.get("/by-name/{name}", response_model=Concept)
def read_concept_by_name(name: str, session=Depends(get_neo4j_session)):
    """
    Get a concept by its name (exact match).
    
    PURPOSE:
    Find a concept when you know its exact name. Useful when you have the name
    but not the node_id.
    
    HOW IT'S USED:
    - Lecture ingestion uses this to find existing concepts by name
    - Notion sync uses this to match concepts
    - Command system uses this for "go <concept-name>" commands
    
    EXAMPLE:
    GET /concepts/by-name/Neural%20Networks
    Returns: The concept with name "Neural Networks"
    
    NOTE:
    This is case-sensitive for exact matching. For partial matching, use /search.
    
    CONNECTS TO:
    - Lecture ingestion - Finds existing concepts to update
    - Notion sync - Matches concepts by name
    - Command system - Navigation by name
    """
    concept = get_concept_by_name(session, name)
    if not concept:
        raise HTTPException(status_code=404, detail="Concept not found")
    return concept


@router.get("/by-slug/{slug}", response_model=Concept)
def read_concept_by_slug(slug: str, session=Depends(get_neo4j_session)):
    """
    Get a concept by its URL slug (Wikipedia-style).
    
    PURPOSE:
    Find a concept using its URL-friendly slug. This enables Wikipedia-style
    navigation with clean URLs like /concepts/transformer-architecture.
    
    HOW IT'S USED:
    - Concept pages use this for clean URLs
    - Graph visualization links to concept pages
    - Wikipedia-style navigation between concepts
    
    EXAMPLE:
    GET /concepts/by-slug/transformer-architecture
    Returns: The concept with url_slug "transformer-architecture"
    
    NOTE:
    Slugs are auto-generated from concept names when concepts are created.
    If a concept doesn't have a slug, use the node_id endpoint instead.
    
    CONNECTS TO:
    - Concept wiki pages - Clean URL routing
    - Graph visualization - Link to concept pages
    - Wikipedia-style navigation
    """
    concept = get_concept_by_slug(session, slug)
    if not concept:
        raise HTTPException(status_code=404, detail="Concept not found")
    return concept


@router.get("/{node_id}/mentions", response_model=List[LectureMention])
def list_concept_mentions_endpoint(node_id: str, session=Depends(get_neo4j_session)):
    """
    List all lecture mentions that link to this concept.
    """
    return list_concept_mentions(session, node_id)


@router.get("/{node_id}/notes", response_model=List[ConceptNoteEntry])
def get_concept_notes(
    node_id: str,
    limit: int = Query(20, ge=1, le=100, description="Maximum number of notes to return"),
    offset: int = Query(0, ge=0, description="Number of notes to skip"),
    session=Depends(get_neo4j_session),
    auth: Dict[str, Any] = Depends(require_auth),
):
    """
    Get notes entries linked to a concept node.
    
    PURPOSE:
    Returns all notes entries that have been linked to this concept via the
    related_node_ids array field. This shows learning notes that mention or
    relate to the concept.
    
    HOW IT WORKS:
    - Validates the concept exists in Neo4j (404 if not found)
    - Queries Postgres notes_entries table using GIN index on related_node_ids
    - Joins with notes_sections to get section titles
    - Returns most recent entries first
    
    HOW IT'S USED:
    - Concept detail pages can show related learning notes
    - Users can see what they've learned about a concept
    - Context panel can display notes alongside concept info
    
    EXAMPLE:
    GET /concepts/N00123456/notes?limit=10&offset=0
    Returns: List of notes entries linked to concept N00123456
    
    PERFORMANCE:
    Uses GIN index on related_node_ids for efficient array membership queries.
    """
    from services_notes_digest import _get_pool
    from psycopg2.extras import RealDictCursor
    
    # Validate concept exists
    concept = get_concept_by_id(session, node_id)
    if not concept:
        raise HTTPException(status_code=404, detail="Concept not found")
    
    # Query Postgres for linked notes entries
    try:
        pool = _get_pool()
        conn = pool.getconn()
        try:
            with conn.cursor(cursor_factory=RealDictCursor) as cur:
                cur.execute("""
                    SELECT
                        e.id,
                        e.chat_id,
                        e.section_id,
                        s.title AS section_title,
                        e.summary_text,
                        e.source_type,
                        e.confidence_level,
                        e.created_at,
                        e.related_node_ids
                    FROM notes_entries e
                    JOIN notes_sections s ON s.id = e.section_id
                    WHERE %(node_id)s = ANY(e.related_node_ids)
                    ORDER BY e.created_at DESC
                    LIMIT %(limit)s OFFSET %(offset)s
                """, {
                    "node_id": node_id,
                    "limit": limit,
                    "offset": offset
                })
                
                rows = cur.fetchall()
                return [ConceptNoteEntry(**dict(row)) for row in rows]
        finally:
            pool.putconn(conn)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to fetch notes: {str(e)}")


@router.get("/{node_id}", response_model=Concept)
def read_concept(node_id: str, session=Depends(get_neo4j_session)):
    """
    Get a concept by its node_id (the unique identifier).
    
    PURPOSE:
    The primary way to fetch a specific concept. Every concept has a unique
    node_id (format: NXXXXXXXX) that never changes.
    
    HOW IT'S USED:
    - GraphVisualization uses this when clicking a node
    - Concept Board page uses this to display concept details
    - Neighbor queries use this to get full concept data
    
    EXAMPLE:
    GET /concepts/N00123456
    Returns: The concept with node_id "N00123456"
    
    WHY NODE_ID vs NAME:
    - node_id is unique and never changes (even if name changes)
    - name can change, and multiple concepts might have similar names
    - node_id is the stable reference for relationships
    
    CONNECTS TO:
    - GraphVisualization - Node detail panel
    - Concept Board - Full concept view
    - All relationship operations - Use node_id for stability
    """
    concept = get_concept_by_id(session, node_id)
    if not concept:
        raise HTTPException(status_code=404, detail="Concept not found")
    return concept


@router.get("/{node_id}/cross-graph-instances")
def get_cross_graph_instances_endpoint(
    node_id: str,
    session=Depends(get_neo4j_session)
):
    """
    Get all instances of a concept across all graphs by matching the concept name.
    
    PURPOSE:
    Find where else a concept exists across different graph workspaces. This enables
    cross-graph navigation and discovery of related concepts in different contexts.
    
    HOW IT WORKS:
    - Takes a node_id and finds the concept's name
    - Searches all graphs for concepts with the same name
    - Returns all instances with their graph context
    
    EXAMPLE:
    GET /concepts/N55D928BF/cross-graph-instances
    Returns: All instances of "TSMC" across all graphs (multiple workspaces, templates, etc.)
    
    USE CASES:
    - Show "Also seen in: [graph_name]" in concept view
    - Navigate between graph instances of the same concept
    - Discover related concepts in different contexts
    
    CONNECTS TO:
    - ContextPanel - Cross-graph instance display
    - Concept Board - Cross-graph navigation
    - GraphVisualization - Instance discovery
    """
    try:
        result = get_cross_graph_instances(session, node_id)
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to get cross-graph instances: {str(e)}")

@router.get("/{node_id}/linked-instances")
def get_linked_instances_endpoint(
    node_id: str,
    session=Depends(get_neo4j_session),
    auth_ctx: Dict[str, Any] = Depends(require_auth)
):
    """
    Get all cross-graph instances that are explicitly linked via CROSS_GRAPH_LINK relationships.
    
    PURPOSE:
    Find instances that have been explicitly linked (not just same name). This shows
    user-created or system-detected relationships between concepts across graphs.
    
    EXAMPLE:
    GET /concepts/N55D928BF/linked-instances
    Returns: All instances linked to this concept via CROSS_GRAPH_LINK
    """
    try:
        instances = get_linked_cross_graph_instances(session, node_id)
        return {"instances": instances, "total": len(instances)}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to get linked instances: {str(e)}")

@router.get("/{node_id}/neighbors", response_model=List[Concept])
def read_neighbors(
    node_id: str,
    include_proposed: Literal["auto", "all", "none"] = Query("all", description="Visibility policy: 'all' (default, show all), 'auto' (threshold-based), or 'none' (ACCEPTED only)"),
    status: Optional[str] = Query(None, description="Filter by relationship status: 'ACCEPTED', 'PROPOSED', or None (show all)"),
    session=Depends(get_neo4j_session)
):
    """
    Get all concepts connected to a given concept (neighbors).
    
    PURPOSE:
    Finds all concepts that have a relationship with the given concept. This is
    essential for graph exploration - seeing what's connected to what.
    
    HOW IT WORKS:
    - Finds all relationships where the concept is either source or target
    - Returns the other concepts (neighbors)
    - Doesn't include relationship types, just the concepts
    
    HOW IT'S USED:
    - GraphVisualization uses this for lazy loading (load neighbors on click)
    - Graph exploration - "What's connected to this concept?"
    - AI chat uses this to get context around relevant concepts
    
    EXAMPLE:
    GET /concepts/N00123456/neighbors
    Returns: All concepts connected to N00123456
    
    PERFORMANCE:
    This enables lazy loading - instead of loading the entire graph, load
    neighbors on-demand when clicking nodes. Much faster for large graphs.
    
    CONNECTS TO:
    - GraphVisualization - Lazy loading on node click
    - AI chat - Gets context around relevant concepts
    - Graph exploration - Discover related concepts
    """
    # If status is explicitly provided, map it to include_proposed
    if status == "ACCEPTED":
        include_proposed = "none"
    elif status == "PROPOSED":
        include_proposed = "all"  # Will need to filter to PROPOSED only in the query
    # If status is None, use include_proposed as-is (defaults to "all" to show everything)
    
    return get_neighbors(session, node_id, include_proposed=include_proposed)


@router.get("/{node_id}/neighbors-with-relationships")
def read_neighbors_with_relationships(
    node_id: str,
    include_proposed: Literal["auto", "all", "none"] = Query("all", description="Visibility policy: 'all' (default, show all), 'auto' (threshold-based), or 'none' (ACCEPTED only)"),
    status: Optional[str] = Query(None, description="Filter by relationship status: 'ACCEPTED', 'PROPOSED', or None (show all)"),
    session=Depends(get_neo4j_session)
):
    """
    Get neighbors with relationship metadata.
    
    PURPOSE:
    Like /neighbors, but includes relationship types (predicates) and direction.
    This is what the graph visualization actually needs to render edges properly.
    
    HOW IT WORKS:
    - Returns neighbors with their relationship types
    - Includes direction (is_outgoing: true/false)
    - Includes predicate (relationship type)
    - Includes relationship status, confidence, and method for styling proposed edges
    
    WHY THIS EXISTS:
    Graph visualization needs to know:
    - Which concepts are connected
    - What type of relationship (DEPENDS_ON, RELATED_TO, etc.)
    - Direction (A → B or B → A)
    - Status (ACCEPTED/PROPOSED) for visual styling
    
    HOW IT'S USED:
    - GraphVisualization uses this to render edges with correct types/colors
    - Shows relationship labels on edges
    - Enables filtering by relationship type
    - Can style proposed edges differently (e.g., dashed lines)
    
    EXAMPLE:
    GET /concepts/N00123456/neighbors-with-relationships
    Returns: [
      {
        "concept": {...},
        "predicate": "DEPENDS_ON",
        "is_outgoing": true,
        "relationship_status": "ACCEPTED",
        "relationship_confidence": 0.95,
        "relationship_method": "llm"
      },
      ...
    ]
    
    CONNECTS TO:
    - GraphVisualization - Edge rendering with types
    - Graph rendering - Proper edge visualization
    - fetchGraphData() in api-client.ts - Recursive graph loading
    
    Cached for 1 minute to improve performance.
    """
    # If status is explicitly provided, map it to include_proposed
    if status == "ACCEPTED":
        include_proposed = "none"
    elif status == "PROPOSED":
        include_proposed = "all"  # Will need to filter to PROPOSED only in the query
    # If status is None, use include_proposed as-is (defaults to "all" to show everything)
    
    # Try cache first
    cache_key = ("neighbors_with_relationships", node_id, include_proposed, status)
    cached_result = get_cached(*cache_key, ttl_seconds=60)
    if cached_result is not None:
        return cached_result
    
    result = get_neighbors_with_relationships(session, node_id, include_proposed=include_proposed)
    
    # Cache the result
    set_cached(cache_key[0], result, *cache_key[1:], ttl_seconds=60)
    return result

@router.get("/{node_id}/claims")
def get_claims_for_concept(
    node_id: str,
    limit: int = Query(50, description="Maximum number of claims to return"),
    session=Depends(get_neo4j_session)
):
    """
    Get all claims that mention this concept.
    
    Returns claims with confidence, source, and metadata.
    """
    ensure_graph_scoping_initialized(session)
    graph_id, branch_id = get_active_graph_context(session)
    
    query = """
    MATCH (g:GraphSpace {graph_id: $graph_id})
    MATCH (c:Concept {graph_id: $graph_id, node_id: $node_id})-[:BELONGS_TO]->(g)
    MATCH (claim:Claim {graph_id: $graph_id})-[:MENTIONS]->(c)
    WHERE $branch_id IN COALESCE(claim.on_branches, [])
    OPTIONAL MATCH (claim)-[:SUPPORTED_BY]->(chunk:SourceChunk {graph_id: $graph_id})
    OPTIONAL MATCH (chunk)-[:FROM_DOCUMENT]->(doc:SourceDocument {graph_id: $graph_id})
    RETURN claim.claim_id AS claim_id,
           claim.text AS text,
           COALESCE(claim.confidence, 0.5) AS confidence,
           claim.source_id AS source_id,
           claim.source_span AS source_span,
           claim.method AS method,
           chunk.chunk_id AS chunk_id,
           doc.source AS source_type,
           doc.url AS source_url,
           doc.doc_type AS doc_type
    ORDER BY claim.confidence DESC
    LIMIT $limit
    """
    
    result = session.run(
        query,
        graph_id=graph_id,
        branch_id=branch_id,
        node_id=node_id,
        limit=limit
    )
    
    claims = []
    for record in result:
        claims.append({
            "claim_id": record["claim_id"],
            "text": record["text"],
            "confidence": record["confidence"],
            "source_id": record["source_id"],
            "source_span": record["source_span"],
            "method": record["method"],
            "chunk_id": record["chunk_id"],
            "source_type": record["source_type"],
            "source_url": record["source_url"],
            "doc_type": record["doc_type"],
        })
    
@router.get("/{node_id}/sources")
def get_sources_for_concept(
    node_id: str,
    limit: int = Query(100, description="Maximum number of sources to return"),
    session=Depends(get_neo4j_session)
):
    """
    Get all source chunks and documents that mention this concept.
    
    Returns sources grouped by source_type with timeline information.
    """
    ensure_graph_scoping_initialized(session)
    graph_id, branch_id = get_active_graph_context(session)
    
    query = """
    MATCH (g:GraphSpace {graph_id: $graph_id})
    MATCH (c:Concept {graph_id: $graph_id, node_id: $node_id})-[:BELONGS_TO]->(g)
    MATCH (claim:Claim {graph_id: $graph_id})-[:MENTIONS]->(c)
    WHERE $branch_id IN COALESCE(claim.on_branches, [])
    OPTIONAL MATCH (claim)-[:SUPPORTED_BY]->(chunk:SourceChunk {graph_id: $graph_id})
    OPTIONAL MATCH (chunk)-[:FROM_DOCUMENT]->(doc:SourceDocument {graph_id: $graph_id})
    WITH DISTINCT doc, chunk, claim
    WHERE doc IS NOT NULL
    RETURN doc.doc_id AS doc_id,
           doc.source AS source_type,
           doc.external_id AS external_id,
           doc.url AS url,
           doc.doc_type AS doc_type,
           doc.published_at AS published_at,
           doc.metadata AS metadata,
           collect(DISTINCT {
             chunk_id: chunk.chunk_id,
             chunk_index: chunk.chunk_index,
             text_preview: substring(chunk.text, 0, 200)
           }) AS chunks,
           count(DISTINCT claim) AS claim_count
    ORDER BY published_at DESC
    LIMIT $limit
    """
    
    result = session.run(
        query,
        graph_id=graph_id,
        branch_id=branch_id,
        node_id=node_id,
        limit=limit
    )
    
    sources = []
    for record in result:
        sources.append({
            "doc_id": record["doc_id"],
            "source_type": record["source_type"],
            "external_id": record["external_id"],
            "url": record["url"],
            "doc_type": record["doc_type"],
            "published_at": record["published_at"],
            "metadata": record["metadata"],
            "chunks": record["chunks"],
            "claim_count": record["claim_count"],
        })
    
    return sources
@router.get("/relationship/check")
def check_relationship_endpoint(
    source_id: str = Query(..., description="Source concept node_id"),
    target_id: str = Query(..., description="Target concept node_id"),
    predicate: str = Query(..., description="Relationship type to check"),
    session=Depends(get_neo4j_session)
):
    """
    Check if a relationship exists between two concepts.
    
    PURPOSE:
    Used by frontend to determine if "Connect to next" button should be disabled.
    
    RETURNS:
    - exists: true if relationship exists (ACCEPTED or PROPOSED), false otherwise
    """
    exists = relationship_exists(session, source_id, target_id, predicate)
    return {"exists": exists}


