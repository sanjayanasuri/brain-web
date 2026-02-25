"""
Concepts API - write endpoints (create, update, pin, relationship, propose, delete, cleanup).
"""
from fastapi import APIRouter, Depends, HTTPException, Query, BackgroundTasks
from typing import Optional, Dict, Any
from datetime import datetime
import uuid

from db_neo4j import get_neo4j_session
from cache_utils import invalidate_cache_pattern

from models import Concept, ConceptCreate, ConceptUpdate, RelationshipCreate
from services_graph import (
    get_concept_by_id,
    create_concept,
    update_concept,
    create_relationship,
    create_relationship_by_ids,
    delete_concept,
    delete_relationship,
    relationship_exists,
    delete_test_concepts,
    link_cross_graph_instances,
)
from services_branch_explorer import ensure_graph_scoping_initialized, get_active_graph_context, set_active_graph
from services_sync import auto_export_csv
from auth import require_auth

router = APIRouter()


@router.post("/{node_id}/link-cross-graph")
def link_cross_graph_instances_endpoint(
    node_id: str,
    target_node_id: str = Query(..., description="Node ID of the target concept instance to link to"),
    link_type: str = Query("user_linked", description="Type of link: 'user_linked', 'manual_merge', 'auto_detected'"),
    session=Depends(get_neo4j_session),
    auth_ctx: Dict[str, Any] = Depends(require_auth),
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
    Links TSMC in one graph to TSMC in another graph
    
    USE CASES:
    - User manually links related concepts across graphs
    - Merge workflow maintains graph-specific context
    - Cross-graph relationship discovery
    
    
    CONNECTS TO:
    - ContextPanel - Manual linking UI
    - Merge workflow - Cross-graph merge
    """
    # Extract user_id from auth context
    user_id = auth_ctx.get("user_id", "unknown_user")
    
    try:
        result = link_cross_graph_instances(
            session,
            node_id,
            target_node_id,
            link_type=link_type,
            linked_by=user_id
        )
        return result
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to link cross-graph instances: {str(e)}")


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

@router.post("/{node_id}/pin")
def pin_concept_endpoint(
    node_id: str,
    pinned: bool = Query(True),
    session=Depends(get_neo4j_session)
):
    """
    Pin or unpin a concept in the graph.
    
    PURPOSE:
    Allows users to highlight important concepts for quick access. 
    Pinned concepts can be prioritized in search and UI.
    
    HOW IT WORKS:
    - Updates 'pinned' property on the Concept node in Neo4j.
    - Emits a CONCEPT_PINNED activity event.
    """
    ensure_graph_scoping_initialized(session)
    graph_id, branch_id = get_active_graph_context(session)
    
    # Update Neo4j
    query = """
    MATCH (c:Concept {graph_id: $graph_id, node_id: $node_id})
    SET c.pinned = $pinned
    RETURN c.name AS name
    """
    result = session.run(query, graph_id=graph_id, node_id=node_id, pinned=pinned)
    record = result.single()
    if not record:
        raise HTTPException(status_code=404, detail="Concept not found")
    
    # Emit ActivityEvent
    try:
        event_id = str(uuid.uuid4())
        now = datetime.utcnow().isoformat() + "Z"
        session.run(
            """
            CREATE (e:ActivityEvent {
                id: $id,
                user_id: $user_id,
                graph_id: $graph_id,
                type: 'CONCEPT_PINNED',
                payload: $payload,
                created_at: $created_at
            })
            """,
            id=event_id,
            user_id="system", 
            graph_id=graph_id,
            payload={"node_id": node_id, "concept_name": record["name"], "pinned": pinned},
            created_at=now
        )
    except Exception as e:
         import logging
         logging.getLogger("brain_web").warning(f"Failed to emit CONCEPT_PINNED event: {e}")
        
    return {"status": "ok", "pinned": pinned, "name": record["name"]}
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

