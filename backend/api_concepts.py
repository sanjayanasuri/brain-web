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


from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks
from typing import List

# Every time a client hits an API endpoint, FastAPI opens a fresh connection to Neo4j. It runs the query. Then, closes the connection.
# This avoids sharing one long-lived session across requests. Futhermore, it prevents race conditions. 
# If requests shared the same session, queries could interfere with other. Two users writing at the same time might overwrite each others text. 

# Neo4j sessions are not thread-safe. A session can only be used by one thread at a time.
#  If two threads try to use the same session, they may overwrite each other's in-memory state. 
# A race condition is when two operations happen at the same time and the final outcomes is dependent on who wins the race. 
# If request A reads a value of 5, request B reads a value of 5 but both try to increment it to 6, only one increment is correctly saved. 

from db_neo4j import get_neo4j_session

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
    delete_test_concepts,
    get_nodes_missing_description,
    find_concept_gaps,
)

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
def search_concepts(q: str, session=Depends(get_neo4j_session)):
    """
    Search for concepts by name (simple keyword search).
    
    PURPOSE:
    Allows users to find concepts by typing part of the name. This is a simple
    keyword search - for semantic search (finding by meaning), see api_ai.py.
    
    HOW IT WORKS:
    - Case-insensitive partial match
    - If you search "neural", it finds "Neural Networks", "Neural Architecture", etc.
    
    HOW IT'S USED:
    - GraphVisualization component uses this for the search bar
    - Users can quickly find concepts they're looking for
    - Command system uses this for "search" commands
    
    EXAMPLE:
    GET /concepts/search?q=neural
    Returns: All concepts with "neural" in the name
    
    NOTE:
    For more intelligent search (finding concepts by meaning, not just name),
    use POST /ai/semantic-search which uses embeddings.
    
    CONNECTS TO:
    - Frontend GraphVisualization - Search functionality
    - Command system - "search" command
    """
    all_concepts = get_all_concepts(session)
    query_lower = q.lower()
    matched = [c for c in all_concepts if query_lower in c.name.lower()]
    return {
        "query": q,
        "results": matched,
        "count": len(matched)
    }


@router.get("/all/graph")
def get_all_graph_data(session=Depends(get_neo4j_session)):
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
    nodes = get_all_concepts(session)
    relationships = get_all_relationships(session)
    return {
        "nodes": nodes,
        "links": relationships,
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


@router.post("/", response_model=Concept)
def create_concept_endpoint(
    payload: ConceptCreate,
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
    concept = create_concept(session, payload)
    # Auto-export to CSV after creating node
    auto_export_csv(background_tasks)
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
    # Auto-export to CSV after updating
    auto_export_csv(background_tasks)
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
    # Auto-export to CSV after creating relationship
    auto_export_csv(background_tasks)
    return {"status": "ok"}


@router.get("/{node_id}/neighbors", response_model=List[Concept])
def read_neighbors(node_id: str, session=Depends(get_neo4j_session)):
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
    return get_neighbors(session, node_id)


@router.get("/{node_id}/neighbors-with-relationships")
def read_neighbors_with_relationships(node_id: str, session=Depends(get_neo4j_session)):
    """
    Get neighbors with relationship metadata.
    
    PURPOSE:
    Like /neighbors, but includes relationship types (predicates) and direction.
    This is what the graph visualization actually needs to render edges properly.
    
    HOW IT WORKS:
    - Returns neighbors with their relationship types
    - Includes direction (is_outgoing: true/false)
    - Includes predicate (relationship type)
    
    WHY THIS EXISTS:
    Graph visualization needs to know:
    - Which concepts are connected
    - What type of relationship (DEPENDS_ON, RELATED_TO, etc.)
    - Direction (A → B or B → A)
    
    HOW IT'S USED:
    - GraphVisualization uses this to render edges with correct types/colors
    - Shows relationship labels on edges
    - Enables filtering by relationship type
    
    EXAMPLE:
    GET /concepts/N00123456/neighbors-with-relationships
    Returns: [
      {
        "concept": {...},
        "predicate": "DEPENDS_ON",
        "is_outgoing": true
      },
      ...
    ]
    
    CONNECTS TO:
    - GraphVisualization - Edge rendering with types
    - Graph rendering - Proper edge visualization
    - fetchGraphData() in api-client.ts - Recursive graph loading
    """
    return get_neighbors_with_relationships(session, node_id)


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
