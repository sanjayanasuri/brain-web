"""
This is the core of the system. This file manages the nodes and relationships.
It allows graph queries to be made. Finding Neighbors, searching for nodes, detecting gaps in your knowledge. 
"""

# We use fastAPI in the backend. FastAPI is built to be quick. It is simple to write. 
# Designed for building JSON-first APIs. 
# Python dictionaries are automatically converted into JSON. 
# JSON is a universal data format, so every client can read it. 
# Every browser, application, and API communicates using JSON, not Python objects. 
# Your Python data automatically becomes web-friendly.

# Within Python, you could use Django, but it's bigger. Flaks requires more setup. 
# In JS/TS, you could use Express.js as well. But we're going with Python.

# Also, by default, fastAPI is asynchronous. The server can handle many requests at the same time without blocking. 
# When your code is waiting on Network I/O, fastAPI can switch to another request instead of sititng idle. 
# Asynchrous nature allows one worker to serve many users at once without waiting around. 


from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks, Query
from typing import List, Literal, Optional

# Every time a client hits an API endpoint, FastAPI opens a fresh connection to Neo4j. It runs the query. Then, closes the connection.
# This avoids sharing one long-lived session across requests. Futhermore, it prevents race conditions. 
# If requests shared the same session, queries could interfere with other. Two users writing at the same time might overwrite each others text. 

# Neo4j sessions are not thread-safe. A session can only be used by one thread at a time.
#  If two threads try to use the same session, they may overwrite each other's in-memory state. 
# A race condition is when two operations happen at the same time and the final outcomes is dependent on who wins the race. 
# If request A reads a value of 5, request B reads a value of 5 but both try to increment it to 6, only one increment is correctly saved. 

from db_neo4j import get_neo4j_session
from cache_utils import get_cached, set_cached, invalidate_cache_pattern

# Auto-export to CSV after mutations (backup system)
from services_sync import auto_export_csv

# We are using models defined in models.py within the Backend. 
# We import Concept, ConceptCreate, ConceptUpdate, and RelationshipCreate.
# 
# - ConceptCreate (line 24): For creating new concepts (no node_id, it's auto-generated)
# - ConceptUpdate (line 40): For partial updates (all fields optional)
# - RelationshipCreate (line 48): For creating relationships between concepts
# 
# Pydantic models provide:
# - Automatic validation (ensures data types are correct)
# - Automatic JSON serialization (converts Python objects to JSON)
# - Type hints (helps with IDE autocomplete and type checking)
# 
# See backend/models.py lines 5-52 for the full definitions
from models import Concept, ConceptCreate, ConceptUpdate, RelationshipCreate

# Business logic functions - the actual graph operations
from services_graph import (
    get_concept_by_id,
    get_concept_by_name,
    create_concept,
    update_concept,
    create_relationship,
    create_relationship_by_ids,
    get_neighbors,
    get_neighbors_with_relationships,
    get_all_concepts,
    get_all_relationships,
    delete_concept,
    delete_relationship,
    relationship_exists,
    delete_test_concepts,
    get_nodes_missing_description,
    find_concept_gaps,
)
from services_branch_explorer import ensure_graph_scoping_initialized, get_active_graph_context

# Create FastAPI router - all endpoints will be under /concepts
router = APIRouter(prefix="/concepts", tags=["concepts"])


# ============================================================================
# ROUTE ORDERING NOTE:
# ============================================================================
# IMPORTANT: Specific routes (like /missing-descriptions) must come BEFORE
# parameterized routes (like /{node_id}). Otherwise FastAPI will match
# "missing-descriptions" as a node_id and try to find a concept with that ID.
# ============================================================================

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
    from services_branch_explorer import set_active_graph, ensure_graph_scoping_initialized, get_active_graph_context
    
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
    session=Depends(get_neo4j_session)
):
    """
    Get the complete graph - all nodes and relationships.
    
    PURPOSE:
    Returns everything in the knowledge graph. This is the main endpoint for
    initial graph visualization - it loads the entire graph at once.
    
    WHY IT EXISTS:
    The frontend graph visualization needs to know all nodes and relationships
    to render the interactive graph. This endpoint provides that data.
    
    HOW IT'S USED:
    - GraphVisualization component calls this on initial load
    - Shows the complete knowledge graph in the UI
    - Users can see all their knowledge at once
    
    PERFORMANCE NOTE:
    For large graphs, this might be slow. Consider using /concepts/{node_id}/neighbors
    for lazy loading (load neighbors on-demand when clicking nodes).
    
    CONNECTS TO:
    - Frontend GraphVisualization - Initial graph load
    - Graph rendering - Provides data for react-force-graph-2d
    """
    import logging
    logger = logging.getLogger("brain_web")
    
    try:
        nodes = get_all_concepts(session)
        relationships = get_all_relationships(session, include_proposed=include_proposed)
        logger.info(f"Fetched {len(nodes)} nodes and {len(relationships)} relationships")
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
    Returns: All instances of "TSMC" across all graphs (Personal Finance, Default, etc.)
    
    USE CASES:
    - Show "Also seen in: [graph_name]" in concept view
    - Navigate between graph instances of the same concept
    - Discover related concepts in different contexts
    
    CONNECTS TO:
    - ContextPanel - Cross-graph instance display
    - Concept Board - Cross-graph navigation
    - GraphVisualization - Instance discovery
    """
    from services_graph import get_cross_graph_instances
    try:
        result = get_cross_graph_instances(session, node_id)
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to get cross-graph instances: {str(e)}")


@router.post("/{node_id}/link-cross-graph")
def link_cross_graph_instances_endpoint(
    node_id: str,
    target_node_id: str = Query(..., description="Node ID of the target concept instance to link to"),
    link_type: str = Query("user_linked", description="Type of link: 'user_linked', 'manual_merge', 'auto_detected'"),
    session=Depends(get_neo4j_session)
):
    """
    Create a bidirectional CROSS_GRAPH_LINK relationship between two concept instances
    in different graphs.
    
    PURPOSE:
    Explicitly link related concepts across graphs. This creates a visible connection
    that shows concepts are related even though they exist in different graph contexts.
    
    HOW IT WORKS:
    - Creates a CROSS_GRAPH_LINK relationship between two nodes
    - Both nodes must have the same name
    - Both nodes must be in different graphs
    - Relationship is bidirectional
    
    EXAMPLE:
    POST /concepts/N55D928BF/link-cross-graph?target_node_id=NC53B0A1D&link_type=user_linked
    Links TSMC in Personal Finance graph to TSMC in Default graph
    
    USE CASES:
    - User manually links related concepts across graphs
    - Merge workflow maintains graph-specific context
    - Cross-graph relationship discovery
    
    CONNECTS TO:
    - ContextPanel - Manual linking UI
    - Merge workflow - Cross-graph merge
    """
    from services_graph import link_cross_graph_instances
    try:
        result = link_cross_graph_instances(
            session,
            node_id,
            target_node_id,
            link_type=link_type,
            linked_by="user"  # TODO: Get from auth context
        )
        return result
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to link cross-graph instances: {str(e)}")


@router.get("/{node_id}/linked-instances")
def get_linked_instances_endpoint(
    node_id: str,
    session=Depends(get_neo4j_session)
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
    from services_graph import get_linked_cross_graph_instances
    try:
        instances = get_linked_cross_graph_instances(session, node_id)
        return {"instances": instances, "total": len(instances)}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to get linked instances: {str(e)}")


@router.post("/", response_model=Concept)
def create_concept_endpoint(
    payload: ConceptCreate,
    graph_id: Optional[str] = Query(None, description="Optional graph_id to explicitly specify which graph to add the concept to"),
    session=Depends(get_neo4j_session),
    background_tasks: BackgroundTasks = BackgroundTasks()
):
    """
    Create a new concept in the knowledge graph.
    
    PURPOSE:
    Adds a new node to the graph. This is how new knowledge enters the system
    (besides lecture ingestion which does this automatically).
    
    HOW IT WORKS:
    - Takes ConceptCreate payload (name, domain, type, description, etc.)
    - Generates a unique node_id (format: NXXXXXXXX)
    - Stores in Neo4j database
    - Auto-exports to CSV for backup
    
    HOW IT'S USED:
    - Users can manually create concepts via the UI
    - Command system: "add node <name>"
    - Lecture ingestion creates concepts automatically (via services)
    
    EXAMPLE:
    POST /concepts/
    Body: {"name": "Transformer", "domain": "AI", "type": "concept", ...}
    Returns: Created concept with auto-generated node_id
    
    CSV BACKUP:
    After creating, automatically exports to CSV in the background. This ensures
    your graph is backed up to files in the graph/ directory.
    
    CONNECTS TO:
    - GraphVisualization - Manual concept creation
    - Lecture ingestion - Creates concepts from text
    - Notion sync - Creates concepts from pages
    - services_sync.py - CSV backup system
    """
    # In future: check if already exists
    # Handle graph context setting
    from services_branch_explorer import set_active_graph
    
    import logging
    logger = logging.getLogger("brain_web")
    
    if graph_id:
        # Use explicitly provided graph_id to set the active graph context
        # This ensures the concept is created in the correct graph
        logger.info(f"[create_concept_endpoint] Setting active graph to: {graph_id}")
        set_active_graph(session, graph_id)
    # Otherwise, use active graph context (already set, e.g., via selectGraph endpoint)
    
    # Verify active graph context before creating
    ensure_graph_scoping_initialized(session)
    active_graph_id, active_branch_id = get_active_graph_context(session)
    logger.info(f"[create_concept_endpoint] Creating concept '{payload.name}' in graph: {active_graph_id} (requested: {graph_id})")
    
    concept = create_concept(session, payload)
    logger.info(f"[create_concept_endpoint] Created concept '{concept.name}' with node_id: {concept.node_id}")
    # Invalidate graph overview cache (new node added)
    invalidate_cache_pattern("graph_overview")
    # Auto-export to CSV after creating node - only export the graph that was modified
    auto_export_csv(background_tasks, export_per_graph=True, graph_id=active_graph_id)
    return concept


@router.put("/{node_id}", response_model=Concept)
def update_concept_endpoint(
    node_id: str,
    payload: ConceptUpdate,
    session=Depends(get_neo4j_session),
    background_tasks: BackgroundTasks = BackgroundTasks()
):
    """
    Update an existing concept (partial update).
    
    PURPOSE:
    Modify a concept's properties without replacing everything. Only the fields
    you provide will be updated - others remain unchanged.
    
    HOW IT WORKS:
    - Uses ConceptUpdate model (all fields optional)
    - Only updates fields that are provided (not None)
    - Preserves existing values for fields not in the update
    
    HOW IT'S USED:
    - Concept Board page - Edit concept description, tags, etc.
    - Users can refine concept details over time
    - Lecture ingestion updates concepts if new data is better
    
    EXAMPLE:
    PUT /concepts/N00123456
    Body: {"description": "A type of neural network architecture"}
    Only updates description, everything else stays the same
    
    CSV BACKUP:
    Auto-exports to CSV after update to keep backup in sync.
    
    CONNECTS TO:
    - Concept Board - Edit concept details
    - Lecture ingestion - Updates concepts with better descriptions
    - services_sync.py - CSV backup system
    """
    update_dict = payload.dict(exclude_unset=True)
    concept = update_concept(session, node_id, update_dict)
    # Invalidate cache for this node and graph overview
    invalidate_cache_pattern("neighbors_with_relationships")
    invalidate_cache_pattern("graph_overview")
    # Get the graph_id from the concept to export only that graph
    graph_id_for_export = concept.graph_id if hasattr(concept, 'graph_id') else None
    # Auto-export to CSV after updating - only export the graph that was modified
    auto_export_csv(background_tasks, export_per_graph=True, graph_id=graph_id_for_export)
    return concept


@router.post("/relationship")
def create_relationship_endpoint(
    payload: RelationshipCreate,
    session=Depends(get_neo4j_session),
    background_tasks: BackgroundTasks = BackgroundTasks()
):
    """
    Create a relationship between two concepts (by name).
    
    PURPOSE:
    Connects two concepts in the graph. Relationships are the "edges" that make
    it a graph - they show how concepts relate to each other.
    
    HOW IT WORKS:
    - Takes source_name, target_name, and predicate (relationship type)
    - Finds both concepts by name
    - Creates a directed relationship: source → target
    
    RELATIONSHIP TYPES (predicates):
    - RELATED_TO: General relationship
    - DEPENDS_ON: One concept depends on another
    - PREREQUISITE_FOR: One is a prerequisite for the other
    - HAS_COMPONENT: One contains the other
    - And more (see prompts.py for full list)
    
    HOW IT'S USED:
    - Users can manually link concepts in the graph
    - Command system: "link <source> <target> <predicate>"
    - Lecture ingestion creates relationships automatically
    
    EXAMPLE:
    POST /concepts/relationship
    Body: {
      "source_name": "Neural Networks",
      "target_name": "Backpropagation",
      "predicate": "USES"
    }
    Creates: Neural Networks →[USES]→ Backpropagation
    
    CSV BACKUP:
    Auto-exports to CSV after creating relationship.
    
    CONNECTS TO:
    - GraphVisualization - Manual relationship creation
    - Lecture ingestion - Creates relationships from text
    - Graph rendering - Relationships appear as edges
    """
    # In future: validate predicate, ensure both nodes exist
    create_relationship(session, payload)
    # Invalidate cache for both nodes' neighbors
    invalidate_cache_pattern("neighbors_with_relationships")
    invalidate_cache_pattern("graph_neighbors")
    # Get active graph context to export only that graph
    active_graph_id, _ = get_active_graph_context(session)
    # Auto-export to CSV after creating relationship - only export the graph that was modified
    auto_export_csv(background_tasks, export_per_graph=True, graph_id=active_graph_id)
    return {"status": "ok"}


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
           doc.doc_type AS doc_type,
           doc.company_ticker AS company_ticker
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
            "company_ticker": record["company_ticker"],
        })
    
    return claims


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
           doc.company_ticker AS company_ticker,
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
            "company_ticker": record["company_ticker"],
            "published_at": record["published_at"],
            "metadata": record["metadata"],
            "chunks": record["chunks"],
            "claim_count": record["claim_count"],
        })
    
    return sources


@router.post("/relationship-by-ids")
def create_relationship_by_ids_endpoint(
    source_id: str,
    target_id: str,
    predicate: str,
    session=Depends(get_neo4j_session)
):
    """
    Create a relationship between two concepts (by node_id).
    
    PURPOSE:
    Same as /relationship, but uses node_ids instead of names. This is more
    reliable because node_ids are unique and stable (names can change).
    
    WHY TWO ENDPOINTS:
    - /relationship (by name): Easier for users, uses concept names
    - /relationship-by-ids (by ID): More reliable, uses stable IDs
    
    HOW IT'S USED:
    - Frontend uses this when it already has node_ids (from graph visualization)
    - More reliable than name-based matching
    - Used by command system when linking selected nodes
    
    EXAMPLE:
    POST /concepts/relationship-by-ids?source_id=N001&target_id=N002&predicate=RELATED_TO
    Creates: N001 →[RELATED_TO]→ N002
    
    CONNECTS TO:
    - GraphVisualization - Linking selected nodes
    - Command system - "relink" command with IDs
    - More reliable than name-based relationships
    """
    create_relationship_by_ids(session, source_id, target_id, predicate)
    return {"status": "ok", "message": f"Relationship {predicate} created from {source_id} to {target_id}"}


@router.post("/relationship/propose")
def propose_relationship_endpoint(
    source_id: str = Query(..., description="Source concept node_id"),
    target_id: str = Query(..., description="Target concept node_id"),
    predicate: str = Query(..., description="Relationship type (e.g., PREREQUISITE_FOR, DEPENDS_ON)"),
    rationale: Optional[str] = Query(None, description="Optional rationale for the proposal"),
    session=Depends(get_neo4j_session)
):
    """
    Propose a relationship between two concepts (by node_id).
    
    PURPOSE:
    Creates a PROPOSED relationship that can be reviewed and accepted/rejected later.
    Used by path runner to suggest connections between adjacent steps.
    
    HOW IT WORKS:
    - Checks if relationship already exists (ACCEPTED or PROPOSED)
    - If exists, returns error
    - If not, creates relationship with status=PROPOSED
    
    EXAMPLE:
    POST /concepts/relationship/propose?source_id=N001&target_id=N002&predicate=PREREQUISITE_FOR&rationale=Proposed+from+suggested+path
    Creates: N001 →[PREREQUISITE_FOR]→ N002 (status: PROPOSED)
    
    CONNECTS TO:
    - PathRunner - "Connect to next" action
    - Review system - Proposed relationships appear in /review
    """
    # Check if relationship already exists
    if relationship_exists(session, source_id, target_id, predicate):
        raise HTTPException(
            status_code=400,
            detail=f"Relationship {predicate} already exists between {source_id} and {target_id}"
        )
    
    # Create proposed relationship
    create_relationship_by_ids(
        session,
        source_id,
        target_id,
        predicate,
        status="PROPOSED",
        method="human",
        rationale=rationale or "Proposed from suggested path"
    )
    return {
        "status": "ok",
        "message": f"Proposed relationship {predicate} from {source_id} to {target_id}",
        "exists": False
    }


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


@router.delete("/{node_id}")
def delete_concept_endpoint(
    node_id: str,
    session=Depends(get_neo4j_session),
    background_tasks: BackgroundTasks = BackgroundTasks()
):
    """
    Delete a concept from the graph.
    
    PURPOSE:
    Removes a concept and all its relationships. Use with caution - this is
    permanent (though CSV backup can restore).
    
    HOW IT WORKS:
    - Deletes the concept node
    - Deletes all relationships connected to it
    - Auto-exports to CSV (backup reflects deletion)
    
    HOW IT'S USED:
    - Users can delete concepts they no longer need
    - Command system: "delete node <name>"
    - Cleanup operations
    
    WARNING:
    This is permanent! The concept and all its relationships are removed.
    However, CSV backup can restore if needed.
    
    CSV BACKUP:
    Auto-exports to CSV after deletion to keep backup in sync.
    
    CONNECTS TO:
    - GraphVisualization - Delete node functionality
    - Command system - "delete" command
    - Cleanup operations
    """
    deleted = delete_concept(session, node_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Concept not found")
    # Invalidate all caches (node deleted affects graph structure)
    invalidate_cache_pattern("neighbors_with_relationships")
    invalidate_cache_pattern("graph_neighbors")
    invalidate_cache_pattern("graph_overview")
    # Auto-export to CSV after deleting node
    auto_export_csv(background_tasks)
    return {"status": "ok", "message": f"Concept {node_id} deleted"}


@router.delete("/relationship")
def delete_relationship_endpoint(
    source_id: str,
    target_id: str,
    predicate: str,
    session=Depends(get_neo4j_session),
    background_tasks: BackgroundTasks = BackgroundTasks()
):
    """
    Delete a specific relationship between two concepts.
    
    PURPOSE:
    Removes a relationship without deleting the concepts themselves. Useful
    when you want to break a connection but keep both concepts.
    
    HOW IT WORKS:
    - Finds the specific relationship (source →[predicate]→ target)
    - Deletes only that relationship
    - Concepts remain, just not connected anymore
    
    HOW IT'S USED:
    - Users can remove incorrect relationships
    - Refining the graph structure
    - Fixing mistakes in relationships
    
    EXAMPLE:
    DELETE /concepts/relationship?source_id=N001&target_id=N002&predicate=RELATED_TO
    Removes: N001 →[RELATED_TO]→ N002 (but keeps both concepts)
    
    CSV BACKUP:
    Auto-exports to CSV after deletion.
    
    CONNECTS TO:
    - GraphVisualization - Remove edge functionality
    - Graph refinement - Fixing relationship mistakes
    """
    deleted = delete_relationship(session, source_id, target_id, predicate)
    if not deleted:
        raise HTTPException(status_code=404, detail="Relationship not found")
    # Invalidate cache for both nodes' neighbors
    invalidate_cache_pattern("neighbors_with_relationships")
    invalidate_cache_pattern("graph_neighbors")
    # Auto-export to CSV after deleting relationship
    auto_export_csv(background_tasks)
    return {"status": "ok", "message": f"Relationship {predicate} deleted"}


@router.post("/cleanup-test-data")
def cleanup_test_data(session=Depends(get_neo4j_session)):
    """
    Cleanup utility: Delete all test concepts.
    
    PURPOSE:
    Development utility to remove test data. Identifies test concepts (usually
    by name pattern or tags) and deletes them.
    
    HOW IT'S USED:
    - During development to clean up test data
    - After running tests that create test concepts
    - Keeping the graph clean
    
    NOTE:
    This is a development utility. In production, you might want to protect
    this endpoint or remove it entirely.
    
    CONNECTS TO:
    - Test suite - Cleanup after tests
    - Development workflow - Keeping graph clean
    """
    count = delete_test_concepts(session)
    return {"status": "ok", "message": f"Deleted {count} test concepts"}


# Smoke tests for include_proposed parameter:
# curl "http://localhost:8000/concepts/all/graph?include_proposed=auto"
# curl "http://localhost:8000/concepts/all/graph?include_proposed=all"
# curl "http://localhost:8000/concepts/all/graph?include_proposed=none"
# curl "http://localhost:8000/concepts/N12345678/neighbors-with-relationships?include_proposed=auto"
