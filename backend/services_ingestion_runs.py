"""
Service functions for managing IngestionRun records in Neo4j.

IngestionRun tracks a single user-triggered ingestion operation and tags
all objects created/updated during that run.
"""
from typing import Optional, List, Dict, Any
from uuid import uuid4
from datetime import datetime
import json
from neo4j import Session

from models import IngestionRun, IngestionRunCreate
from services_branch_explorer import (
    ensure_graph_scoping_initialized,
    get_active_graph_context,
)


def _parse_summary_counts(value: Any) -> Optional[Dict[str, int]]:
    """Parse summary_counts from JSON string or return dict if already parsed."""
    if value is None:
        return None
    if isinstance(value, dict):
        return value
    if isinstance(value, str):
        try:
            return json.loads(value)
        except json.JSONDecodeError:
            return None
    return None


def _parse_undo_summary(value: Any) -> Optional[Dict[str, Any]]:
    """Parse undo_summary from JSON string or return dict if already parsed."""
    if value is None:
        return None
    if isinstance(value, dict):
        return value
    if isinstance(value, str):
        try:
            return json.loads(value)
        except json.JSONDecodeError:
            return None
    return None


def create_ingestion_run(
    session: Session,
    source_type: str,
    source_label: Optional[str] = None,
) -> IngestionRun:
    """
    Create a new ingestion run record.
    
    Args:
        session: Neo4j session
        source_type: Type of ingestion ("LECTURE" | "NOTION" | "FINANCE" | "UPLOAD" | "URL")
        source_label: Optional label (e.g., lecture title, ticker)
    
    Returns:
        IngestionRun with run_id and initial status
    """
    ensure_graph_scoping_initialized(session)
    graph_id, branch_id = get_active_graph_context(session)
    
    run_id = str(uuid4())
    started_at = datetime.utcnow().isoformat()
    
    query = """
    CREATE (r:IngestionRun {
        run_id: $run_id,
        graph_id: $graph_id,
        source_type: $source_type,
        source_label: $source_label,
        status: 'RUNNING',
        started_at: $started_at
    })
    RETURN r.run_id AS run_id,
           r.graph_id AS graph_id,
           r.source_type AS source_type,
           r.source_label AS source_label,
           r.status AS status,
           r.started_at AS started_at,
           r.completed_at AS completed_at,
           r.summary_counts AS summary_counts,
           r.error_count AS error_count,
           r.errors AS errors,
           r.undone_at AS undone_at,
           r.undo_mode AS undo_mode,
           r.undo_summary AS undo_summary,
           r.restored_at AS restored_at
    """
    
    result = session.run(
        query,
        run_id=run_id,
        graph_id=graph_id,
        source_type=source_type,
        source_label=source_label,
        started_at=started_at,
    )
    record = result.single()
    if not record:
        raise ValueError("Failed to create ingestion run")
    
    return IngestionRun(
        run_id=record["run_id"],
        graph_id=record["graph_id"],
        source_type=record["source_type"],
        source_label=record["source_label"],
        status=record["status"],
        started_at=record["started_at"],
        completed_at=record["completed_at"],
        summary_counts=_parse_summary_counts(record.get("summary_counts")),
        error_count=record["error_count"],
        errors=record["errors"],
        undone_at=record.get("undone_at"),
        undo_mode=record.get("undo_mode"),
        undo_summary=_parse_undo_summary(record.get("undo_summary")),
        restored_at=record.get("restored_at"),
    )


def update_ingestion_run_status(
    session: Session,
    run_id: str,
    status: str,
    summary_counts: Optional[Dict[str, int]] = None,
    error_count: Optional[int] = None,
    errors: Optional[List[str]] = None,
    trigger_community_build: bool = False,
) -> None:
    """
    Update an ingestion run's status and summary.
    
    Args:
        session: Neo4j session
        run_id: Run ID
        status: New status ("COMPLETED" | "PARTIAL" | "FAILED")
        summary_counts: Optional dict with counts
        error_count: Optional error count
        errors: Optional list of error messages
        trigger_community_build: If True and status is COMPLETED/PARTIAL with new concepts/claims, trigger community build
    """
    ensure_graph_scoping_initialized(session)
    graph_id, _ = get_active_graph_context(session)
    
    completed_at = datetime.utcnow().isoformat()
    
    set_clauses = [
        "r.status = $status",
        "r.completed_at = $completed_at",
    ]
    
    params = {
        "run_id": run_id,
        "graph_id": graph_id,
        "status": status,
        "completed_at": completed_at,
    }
    
    if summary_counts is not None:
        # Neo4j requires JSON strings for complex types, not dictionaries
        # Store as JSON string to avoid Neo4j Map type error
        # Convert dict to JSON string explicitly
        summary_counts_json = json.dumps(summary_counts)
        # Ensure it's actually a string, not a dict
        if not isinstance(summary_counts_json, str):
            raise ValueError(f"summary_counts must be convertible to JSON string, got {type(summary_counts_json)}")
        set_clauses.append("r.summary_counts = $summary_counts_str")
        params["summary_counts_str"] = summary_counts_json
    
    if error_count is not None:
        set_clauses.append("r.error_count = $error_count")
        params["error_count"] = error_count
    
    if errors is not None:
        set_clauses.append("r.errors = $errors")
        params["errors"] = errors
    
    query = f"""
    MATCH (r:IngestionRun {{run_id: $run_id, graph_id: $graph_id}})
    SET {', '.join(set_clauses)}
    RETURN 1
    """
    
    # Debug: Verify summary_counts_str is actually a string if present
    if "summary_counts_str" in params:
        if not isinstance(params["summary_counts_str"], str):
            raise ValueError(
                f"summary_counts_str must be a string, got {type(params['summary_counts_str'])}: {params['summary_counts_str']}"
            )
    
    session.run(query, **params)
    
    # Trigger community build if requested and conditions are met
    if trigger_community_build and status in ("COMPLETED", "PARTIAL"):
        # Check if we have new concepts or claims that would benefit from community rebuild
        should_build = False
        if summary_counts:
            concepts_created = summary_counts.get("concepts_created", 0) or summary_counts.get("concepts_updated", 0) or 0
            claims_created = summary_counts.get("claims_created", 0) or 0
            # Trigger if we created/updated concepts or claims
            should_build = concepts_created > 0 or claims_created > 0
        
        if should_build:
            try:
                from services_community_build import trigger_community_build
                graph_id, branch_id = get_active_graph_context(session)
                # Run in background (non-blocking) - use a new session to avoid transaction conflicts
                from db_neo4j import get_driver
                driver = get_driver()
                with driver.session() as build_session:
                    trigger_community_build(
                        session=build_session,
                        graph_id=graph_id,
                        branch_id=branch_id,
                    )
            except Exception as e:
                # Don't fail the ingestion if community build fails
                import logging
                logger = logging.getLogger("brain_web")
                logger.warning(f"[Ingestion Run] Failed to trigger community build after ingestion: {e}")


def get_ingestion_run(session: Session, run_id: str) -> Optional[IngestionRun]:
    """
    Get an ingestion run by ID.
    
    Args:
        session: Neo4j session
        run_id: Run ID
    
    Returns:
        IngestionRun or None if not found
    """
    ensure_graph_scoping_initialized(session)
    graph_id, _ = get_active_graph_context(session)
    
    query = """
    MATCH (r:IngestionRun {run_id: $run_id, graph_id: $graph_id})
    RETURN r.run_id AS run_id,
           r.graph_id AS graph_id,
           r.source_type AS source_type,
           r.source_label AS source_label,
           r.status AS status,
           r.started_at AS started_at,
           r.completed_at AS completed_at,
           r.summary_counts AS summary_counts,
           r.error_count AS error_count,
           r.errors AS errors,
           r.undone_at AS undone_at,
           r.undo_mode AS undo_mode,
           r.undo_summary AS undo_summary,
           r.restored_at AS restored_at
    """
    
    result = session.run(query, run_id=run_id, graph_id=graph_id)
    record = result.single()
    if not record:
        return None
    
    return IngestionRun(
        run_id=record["run_id"],
        graph_id=record["graph_id"],
        source_type=record["source_type"],
        source_label=record["source_label"],
        status=record["status"],
        started_at=record["started_at"],
        completed_at=record["completed_at"],
        summary_counts=_parse_summary_counts(record.get("summary_counts")),
        error_count=record["error_count"],
        errors=record["errors"],
    )


def list_ingestion_runs(
    session: Session,
    limit: int = 20,
    offset: int = 0,
) -> List[IngestionRun]:
    """
    List ingestion runs for the current graph, ordered by started_at DESC.
    
    Args:
        session: Neo4j session
        limit: Maximum number of runs to return
        offset: Offset for pagination
    
    Returns:
        List of IngestionRun objects
    """
    ensure_graph_scoping_initialized(session)
    graph_id, _ = get_active_graph_context(session)
    
    query = """
    MATCH (r:IngestionRun {graph_id: $graph_id})
    RETURN r.run_id AS run_id,
           r.graph_id AS graph_id,
           r.source_type AS source_type,
           r.source_label AS source_label,
           r.status AS status,
           r.started_at AS started_at,
           r.completed_at AS completed_at,
           r.summary_counts AS summary_counts,
           r.error_count AS error_count,
           r.errors AS errors,
           r.undone_at AS undone_at,
           r.undo_mode AS undo_mode,
           r.undo_summary AS undo_summary,
           r.restored_at AS restored_at
    ORDER BY r.started_at DESC
    SKIP $offset
    LIMIT $limit
    """
    
    result = session.run(query, graph_id=graph_id, offset=offset, limit=limit)
    runs = []
    for record in result:
        runs.append(IngestionRun(
            run_id=record["run_id"],
            graph_id=record["graph_id"],
            source_type=record["source_type"],
            source_label=record["source_label"],
            status=record["status"],
            started_at=record["started_at"],
            completed_at=record["completed_at"],
            summary_counts=_parse_summary_counts(record.get("summary_counts")),
            error_count=record["error_count"],
            errors=record["errors"],
            undone_at=record.get("undone_at"),
            undo_mode=record.get("undo_mode"),
            undo_summary=_parse_undo_summary(record.get("undo_summary")),
            restored_at=record.get("restored_at"),
        ))
    return runs


def get_ingestion_run_changes(session: Session, run_id: str) -> Dict[str, Any]:
    """
    Get a change manifest for an ingestion run.
    
    Returns concepts created/updated, resources created, and relationships proposed by this run.
    
    Args:
        session: Neo4j session
        run_id: Ingestion run ID
    
    Returns:
        Dict with:
        - run: IngestionRun object
        - concepts_created: List of concepts created by this run
        - concepts_updated: List of concepts updated by this run
        - resources_created: List of resources created by this run
        - relationships_proposed: List of relationships proposed by this run
    """
    ensure_graph_scoping_initialized(session)
    graph_id, _ = get_active_graph_context(session)
    
    # Get the run
    run = get_ingestion_run(session, run_id)
    if not run:
        raise ValueError(f"Ingestion run {run_id} not found")
    
    # Get concepts created by this run
    concepts_created_query = """
    MATCH (c:Concept)
    WHERE c.graph_id = $graph_id
      AND c.created_by_run_id = $run_id
    RETURN c.node_id AS concept_id,
           c.name AS name,
           c.domain AS domain,
           c.type AS type
    ORDER BY c.name
    """
    
    # Get concepts updated by this run
    concepts_updated_query = """
    MATCH (c:Concept)
    WHERE c.graph_id = $graph_id
      AND c.last_updated_by_run_id = $run_id
      AND c.created_by_run_id <> $run_id
    RETURN c.node_id AS concept_id,
           c.name AS name,
           c.domain AS domain,
           c.type AS type
    ORDER BY c.name
    """
    
    # Get resources created by this run
    resources_created_query = """
    MATCH (r:Resource)
    WHERE r.ingestion_run_id = $run_id
    OPTIONAL MATCH (r)-[:HAS_RESOURCE]-(c:Concept)
    RETURN r.resource_id AS resource_id,
           r.title AS title,
           r.kind AS source_type,
           c.node_id AS concept_id
    ORDER BY r.title
    """
    
    # Get relationships proposed by this run
    relationships_proposed_query = """
    MATCH (s:Concept)-[r]->(t:Concept)
    WHERE r.graph_id = $graph_id
      AND r.ingestion_run_id = $run_id
    RETURN r AS relationship,
           s.node_id AS from_concept_id,
           t.node_id AS to_concept_id,
           type(r) AS predicate,
           COALESCE(r.status, 'PROPOSED') AS status
    ORDER BY r.created_at DESC
    """
    
    concepts_created = []
    for record in session.run(concepts_created_query, graph_id=graph_id, run_id=run_id):
        concepts_created.append({
            "concept_id": record["concept_id"],
            "name": record["name"],
            "domain": record["domain"],
            "type": record["type"],
        })
    
    concepts_updated = []
    for record in session.run(concepts_updated_query, graph_id=graph_id, run_id=run_id):
        concepts_updated.append({
            "concept_id": record["concept_id"],
            "name": record["name"],
            "domain": record["domain"],
            "type": record["type"],
        })
    
    resources_created = []
    for record in session.run(resources_created_query, run_id=run_id):
        resources_created.append({
            "resource_id": record["resource_id"],
            "title": record["title"] or "Untitled",
            "source_type": record["source_type"] or "unknown",
            "concept_id": record["concept_id"],
        })
    
    relationships_proposed = []
    for record in session.run(relationships_proposed_query, graph_id=graph_id, run_id=run_id):
        rel = record["relationship"]
        relationships_proposed.append({
            "relationship_id": f"{record['from_concept_id']}-{record['to_concept_id']}-{record['predicate']}",
            "from_concept_id": record["from_concept_id"],
            "to_concept_id": record["to_concept_id"],
            "predicate": record["predicate"],
            "status": record["status"],
        })
    
    return {
        "run": run.dict(),
        "concepts_created": concepts_created,
        "concepts_updated": concepts_updated,
        "resources_created": resources_created,
        "relationships_proposed": relationships_proposed,
    }


def undo_ingestion_run(
    session: Session,
    run_id: str,
    mode: str = "SAFE",
) -> Dict[str, Any]:
    """
    Undo an ingestion run by archiving its outputs.
    
    Args:
        session: Neo4j session
        run_id: Ingestion run ID
        mode: "SAFE" (archive concepts/resources when safe) or "RELATIONSHIPS_ONLY" (only relationships)
    
    Returns:
        Dict with archived counts and skipped items
    """
    ensure_graph_scoping_initialized(session)
    graph_id, _ = get_active_graph_context(session)
    
    # Verify run exists
    run = get_ingestion_run(session, run_id)
    if not run:
        raise ValueError(f"Ingestion run {run_id} not found")
    
    archived_at = datetime.utcnow().isoformat()
    archived_reason = "UNDO_RUN"
    
    archived_counts = {
        "relationships": 0,
        "concepts": 0,
        "resources": 0,
    }
    skipped_items = {
        "concepts": [],
        "resources": [],
        "relationships": [],
    }
    
    # 1. Always archive PROPOSED relationships created by this run
    archive_relationships_query = """
    MATCH (s:Concept)-[r]->(t:Concept)
    WHERE r.graph_id = $graph_id
      AND r.ingestion_run_id = $run_id
      AND COALESCE(r.status, 'PROPOSED') = 'PROPOSED'
      AND COALESCE(r.archived, false) = false
    SET r.archived = true,
        r.archived_at = $archived_at,
        r.archived_reason = $archived_reason,
        r.archived_by_run_id = $run_id
    RETURN count(r) AS count
    """
    result = session.run(
        archive_relationships_query,
        graph_id=graph_id,
        run_id=run_id,
        archived_at=archived_at,
        archived_reason=archived_reason,
    )
    record = result.single()
    if record:
        archived_counts["relationships"] = record["count"] or 0
    
    if mode == "SAFE":
        # 2. Archive concepts created by this run, but only if safe
        # Safe means:
        # - created_by_run_id == run_id
        # - last_updated_by_run_id is null or == run_id (not updated by later runs)
        # - Not connected to ACCEPTED relationships created by other runs
        
        # First, find concepts created by this run
        concepts_to_check_query = """
        MATCH (c:Concept)
        WHERE c.graph_id = $graph_id
          AND c.created_by_run_id = $run_id
          AND COALESCE(c.archived, false) = false
        RETURN c.node_id AS concept_id,
               c.name AS name,
               c.last_updated_by_run_id AS last_updated_by_run_id
        """
        
        for record in session.run(concepts_to_check_query, graph_id=graph_id, run_id=run_id):
            concept_id = record["concept_id"]
            name = record["name"]
            last_updated_by_run_id = record["last_updated_by_run_id"]
            
            # Check if safe to archive
            is_safe = True
            reason = None
            
            # Check if updated by a later run
            if last_updated_by_run_id and last_updated_by_run_id != run_id:
                is_safe = False
                reason = "Updated by later run"
            
            # Check if connected to ACCEPTED relationships from other runs
            if is_safe:
                check_relationships_query = """
                MATCH (c:Concept {node_id: $concept_id})
                MATCH (c)-[r]-(other:Concept)
                WHERE r.graph_id = $graph_id
                  AND COALESCE(r.status, 'ACCEPTED') = 'ACCEPTED'
                  AND r.ingestion_run_id <> $run_id
                  AND r.ingestion_run_id IS NOT NULL
                RETURN count(r) AS count
                """
                rel_result = session.run(
                    check_relationships_query,
                    concept_id=concept_id,
                    graph_id=graph_id,
                    run_id=run_id,
                )
                rel_record = rel_result.single()
                if rel_record and (rel_record["count"] or 0) > 0:
                    is_safe = False
                    reason = "Connected to ACCEPTED relationships from other runs"
            
            if is_safe:
                # Archive the concept
                archive_concept_query = """
                MATCH (c:Concept {node_id: $concept_id})
                WHERE c.graph_id = $graph_id
                  AND COALESCE(c.archived, false) = false
                SET c.archived = true,
                    c.archived_at = $archived_at,
                    c.archived_reason = $archived_reason,
                    c.archived_by_run_id = $run_id
                RETURN count(c) AS count
                """
                archive_result = session.run(
                    archive_concept_query,
                    concept_id=concept_id,
                    graph_id=graph_id,
                    archived_at=archived_at,
                    archived_reason=archived_reason,
                    run_id=run_id,
                )
                archive_record = archive_result.single()
                if archive_record and (archive_record["count"] or 0) > 0:
                    archived_counts["concepts"] += 1
            else:
                skipped_items["concepts"].append({
                    "concept_id": concept_id,
                    "reason": reason or "Unknown reason",
                })
        
        # 3. Archive resources created by this run, but only if safe
        # Safe means:
        # - ingestion_run_id == run_id
        # - Not linked to concepts that are not archived (or were created by later runs)
        
        resources_to_check_query = """
        MATCH (r:Resource)
        WHERE r.ingestion_run_id = $run_id
          AND COALESCE(r.archived, false) = false
        OPTIONAL MATCH (r)<-[:HAS_RESOURCE]-(c:Concept)
        RETURN r.resource_id AS resource_id,
               r.title AS title,
               collect(c.node_id) AS concept_ids,
               collect(c.created_by_run_id) AS concept_created_by_runs
        """
        
        for record in session.run(resources_to_check_query, run_id=run_id):
            resource_id = record["resource_id"]
            title = record["title"] or "Untitled"
            concept_ids = [cid for cid in record["concept_ids"] if cid]
            concept_created_by_runs = [rid for rid in record["concept_created_by_runs"] if rid]
            
            is_safe = True
            reason = None
            
            # Check if linked to concepts created by later runs
            if concept_ids:
                for cid, c_run_id in zip(concept_ids, concept_created_by_runs):
                    if c_run_id and c_run_id != run_id:
                        # Check if this concept was created by a later run
                        check_concept_query = """
                        MATCH (c:Concept {node_id: $concept_id})
                        WHERE c.created_by_run_id = $c_run_id
                        RETURN count(c) AS count
                        """
                        check_result = session.run(
                            check_concept_query,
                            concept_id=cid,
                            c_run_id=c_run_id,
                        )
                        check_record = check_result.single()
                        if check_record and (check_record["count"] or 0) > 0:
                            is_safe = False
                            reason = f"Linked to concept created by later run"
                            break
            
            if is_safe:
                # Archive the resource
                archive_resource_query = """
                MATCH (r:Resource {resource_id: $resource_id})
                WHERE COALESCE(r.archived, false) = false
                SET r.archived = true,
                    r.archived_at = $archived_at,
                    r.archived_reason = $archived_reason,
                    r.archived_by_run_id = $run_id
                RETURN count(r) AS count
                """
                archive_result = session.run(
                    archive_resource_query,
                    resource_id=resource_id,
                    archived_at=archived_at,
                    archived_reason=archived_reason,
                    run_id=run_id,
                )
                archive_record = archive_result.single()
                if archive_record and (archive_record["count"] or 0) > 0:
                    archived_counts["resources"] += 1
            else:
                skipped_items["resources"].append({
                    "resource_id": resource_id,
                    "reason": reason or "Unknown reason",
                })
    
    # Update run record with undo metadata
    # Convert to JSON string to avoid Neo4j Map type error
    undo_summary_dict = {
        "archived": archived_counts,
        "skipped": skipped_items,
    }
    undo_summary_json = json.dumps(undo_summary_dict)
    
    update_run_query = """
    MATCH (r:IngestionRun {run_id: $run_id, graph_id: $graph_id})
    SET r.undone_at = $undone_at,
        r.undo_mode = $undo_mode,
        r.undo_summary = $undo_summary_json
    RETURN 1
    """
    session.run(
        update_run_query,
        run_id=run_id,
        graph_id=graph_id,
        undone_at=archived_at,
        undo_mode=mode,
        undo_summary_json=undo_summary_json,
    )
    
    return {
        "run_id": run_id,
        "archived": archived_counts,
        "skipped": skipped_items,
    }


def restore_ingestion_run(
    session: Session,
    run_id: str,
) -> Dict[str, Any]:
    """
    Restore archived items from an ingestion run.
    
    Args:
        session: Neo4j session
        run_id: Ingestion run ID
    
    Returns:
        Dict with restored counts and skipped items (if conflicts exist)
    """
    ensure_graph_scoping_initialized(session)
    graph_id, _ = get_active_graph_context(session)
    
    # Verify run exists
    run = get_ingestion_run(session, run_id)
    if not run:
        raise ValueError(f"Ingestion run {run_id} not found")
    
    restored_at = datetime.utcnow().isoformat()
    
    restored_counts = {
        "relationships": 0,
        "concepts": 0,
        "resources": 0,
    }
    skipped_items = {
        "concepts": [],
        "resources": [],
        "relationships": [],
    }
    
    # 1. Restore relationships
    restore_relationships_query = """
    MATCH (s:Concept)-[r]->(t:Concept)
    WHERE r.graph_id = $graph_id
      AND r.archived_by_run_id = $run_id
      AND r.archived_reason = 'UNDO_RUN'
      AND COALESCE(r.archived, false) = true
    SET r.archived = false,
        r.archived_at = null,
        r.archived_reason = null,
        r.archived_by_run_id = null
    RETURN count(r) AS count
    """
    result = session.run(
        restore_relationships_query,
        graph_id=graph_id,
        run_id=run_id,
    )
    record = result.single()
    if record:
        restored_counts["relationships"] = record["count"] or 0
    
    # 2. Restore concepts
    restore_concepts_query = """
    MATCH (c:Concept)
    WHERE c.graph_id = $graph_id
      AND c.archived_by_run_id = $run_id
      AND c.archived_reason = 'UNDO_RUN'
      AND COALESCE(c.archived, false) = true
    SET c.archived = false,
        c.archived_at = null,
        c.archived_reason = null,
        c.archived_by_run_id = null
    RETURN count(c) AS count
    """
    result = session.run(restore_concepts_query, graph_id=graph_id, run_id=run_id)
    record = result.single()
    if record:
        restored_counts["concepts"] = record["count"] or 0
    
    # 3. Restore resources
    restore_resources_query = """
    MATCH (r:Resource)
    WHERE r.archived_by_run_id = $run_id
      AND r.archived_reason = 'UNDO_RUN'
      AND COALESCE(r.archived, false) = true
    SET r.archived = false,
        r.archived_at = null,
        r.archived_reason = null,
        r.archived_by_run_id = null
    RETURN count(r) AS count
    """
    result = session.run(restore_resources_query, run_id=run_id)
    record = result.single()
    if record:
        restored_counts["resources"] = record["count"] or 0
    
    # Update run record
    update_run_query = """
    MATCH (r:IngestionRun {run_id: $run_id, graph_id: $graph_id})
    SET r.restored_at = $restored_at
    RETURN 1
    """
    session.run(
        update_run_query,
        run_id=run_id,
        graph_id=graph_id,
        restored_at=restored_at,
    )
    
    return {
        "run_id": run_id,
        "restored": restored_counts,
        "skipped": skipped_items,
    }

