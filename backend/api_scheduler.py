"""
API endpoints for Smart Scheduler feature.

Provides CRUD operations for tasks and plan suggestions.
"""
from typing import List, Optional, Dict, Any
from datetime import datetime, timedelta, timezone
from uuid import uuid4
import logging
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from neo4j import Session
from db_neo4j import get_neo4j_session
from auth import require_auth
from models import (
    Task,
    TaskCreate,
    TaskUpdate,
    TaskListResponse,
    PlanSuggestion,
    SuggestionsResponse,
    SuggestionGroupedByDay,
    FreeBlock,
    FreeBlocksResponse,
)
from services_scheduler import (
    get_calendar_events,
    get_tasks as get_tasks_service,
    compute_free_blocks,
    build_plan_suggestions,
    finalize_reasons,
    WORKDAY_RULES,
    Event,
    Task as TaskInternal,
    FreeBlock as FreeBlockInternal,
    SuggestionDraft,
)

logger = logging.getLogger("brain_web")

# Split into two routers to match API requirements
tasks_router = APIRouter(prefix="/tasks", tags=["tasks"])
schedule_router = APIRouter(prefix="/schedule", tags=["scheduler"])


def _ensure_task_schema(session: Session):
    """Ensure Task and PlanSuggestion nodes have proper constraints."""
    try:
        session.run("""
            CREATE CONSTRAINT task_id IF NOT EXISTS
            FOR (t:Task) REQUIRE t.id IS UNIQUE
        """)
    except Exception:
        pass  # Constraint may already exist
    
    try:
        session.run("""
            CREATE CONSTRAINT suggestion_id IF NOT EXISTS
            FOR (s:PlanSuggestion) REQUIRE s.id IS UNIQUE
        """)
    except Exception:
        pass


def _node_to_task(node) -> Task:
    """Convert Neo4j node to Task model."""
    return Task(
        id=node["id"],
        title=node["title"],
        notes=node.get("notes"),
        estimated_minutes=node.get("estimated_minutes", 60),
        due_date=node.get("due_date"),
        priority=node.get("priority", "medium"),
        energy=node.get("energy", "med"),
        tags=node.get("tags", []),
        preferred_time_windows=node.get("preferred_time_windows"),
        dependencies=node.get("dependencies", []),
        location=node.get("location"),
        location_lat=node.get("location_lat"),
        location_lon=node.get("location_lon"),
        created_at=node.get("created_at"),
        updated_at=node.get("updated_at"),
    )


def _node_to_suggestion(node, task_title: str) -> PlanSuggestion:
    """Convert Neo4j node to PlanSuggestion model."""
    return PlanSuggestion(
        id=node["id"],
        task_id=node["task_id"],
        task_title=task_title,
        start=node["start"],
        end=node["end"],
        confidence=node.get("confidence", 0.5),
        reasons=node.get("reasons", []),
        status=node.get("status", "suggested"),
        created_at=node.get("created_at"),
    )


# Task CRUD endpoints

@tasks_router.get("", response_model=TaskListResponse)
def list_tasks(
    range_days: int = Query(7, alias="range", description="Number of days to look ahead"),
    request: Request = None,
    auth: dict = Depends(require_auth),
    session: Session = Depends(get_neo4j_session),
):
    """List tasks for the current session."""
    try:
        session_id = getattr(request.state, "session_id", None) or "default"
        
        _ensure_task_schema(session)
        
        start_dt = datetime.utcnow()
        end_dt = start_dt + timedelta(days=range_days)
        
        tasks_internal = get_tasks_service(session, session_id, start_dt, end_dt)
        
        # Convert to API models
        tasks = []
        for task_internal in tasks_internal:
            # Fetch full node to get all properties
            query = """
            MATCH (t:Task {id: $task_id, session_id: $session_id})
            RETURN t
            """
            result = session.run(query, task_id=task_internal.id, session_id=session_id)
            record = result.single()
            if record:
                tasks.append(_node_to_task(record["t"]))
        
        return TaskListResponse(tasks=tasks, total=len(tasks))
    except Exception as e:
        logger.error(f"Error listing tasks: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to list tasks: {str(e)}")


@tasks_router.post("", response_model=Task)
def create_task(
    payload: TaskCreate,
    request: Request = None,
    auth: dict = Depends(require_auth),
    session: Session = Depends(get_neo4j_session),
):
    """Create a new task."""
    try:
        session_id = getattr(request.state, "session_id", None) or "default"
        
        _ensure_task_schema(session)
        
        task_id = f"TASK_{uuid4().hex[:10]}"
        now = datetime.utcnow().isoformat()
        
        properties = {
            "id": task_id,
            "session_id": session_id,
            "title": payload.title,
            "estimated_minutes": payload.estimated_minutes,
            "priority": payload.priority,
            "energy": payload.energy,
            "tags": payload.tags or [],
            "dependencies": payload.dependencies or [],
            "created_at": now,
            "updated_at": now,
        }
        
        if payload.notes is not None:
            properties["notes"] = payload.notes
        if payload.due_date is not None:
            properties["due_date"] = payload.due_date
        if payload.preferred_time_windows is not None:
            properties["preferred_time_windows"] = payload.preferred_time_windows
        if payload.location is not None:
            properties["location"] = payload.location
        if payload.location_lat is not None:
            properties["location_lat"] = payload.location_lat
        if payload.location_lon is not None:
            properties["location_lon"] = payload.location_lon
        
        prop_strings = [f"{k}: ${k}" for k in properties.keys()]
        query = f"""
        CREATE (t:Task {{
            {', '.join(prop_strings)}
        }})
        RETURN t
        """
        
        result = session.run(query, **properties)
        record = result.single()
        
        if not record:
            raise HTTPException(status_code=500, detail="Failed to create task")
        
        return _node_to_task(record["t"])
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error creating task: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to create task: {str(e)}")


@tasks_router.patch("/{task_id}", response_model=Task)
def update_task(
    task_id: str,
    payload: TaskUpdate,
    request: Request = None,
    auth: dict = Depends(require_auth),
    session: Session = Depends(get_neo4j_session),
):
    """Update a task."""
    try:
        session_id = getattr(request.state, "session_id", None) or "default"
        
        # Check if task exists
        check_query = "MATCH (t:Task {id: $task_id, session_id: $session_id}) RETURN t"
        check_result = session.run(check_query, task_id=task_id, session_id=session_id)
        if not check_result.single():
            raise HTTPException(status_code=404, detail="Task not found")
        
        # Build update query
        update_fields = []
        params = {"task_id": task_id, "session_id": session_id, "updated_at": datetime.utcnow().isoformat()}
        
        if payload.title is not None:
            update_fields.append("t.title = $title")
            params["title"] = payload.title
        if payload.notes is not None:
            update_fields.append("t.notes = $notes")
            params["notes"] = payload.notes
        if payload.estimated_minutes is not None:
            update_fields.append("t.estimated_minutes = $estimated_minutes")
            params["estimated_minutes"] = payload.estimated_minutes
        if payload.due_date is not None:
            update_fields.append("t.due_date = $due_date")
            params["due_date"] = payload.due_date
        if payload.priority is not None:
            update_fields.append("t.priority = $priority")
            params["priority"] = payload.priority
        if payload.energy is not None:
            update_fields.append("t.energy = $energy")
            params["energy"] = payload.energy
        if payload.tags is not None:
            update_fields.append("t.tags = $tags")
            params["tags"] = payload.tags
        if payload.preferred_time_windows is not None:
            update_fields.append("t.preferred_time_windows = $preferred_time_windows")
            params["preferred_time_windows"] = payload.preferred_time_windows
        if payload.dependencies is not None:
            update_fields.append("t.dependencies = $dependencies")
            params["dependencies"] = payload.dependencies
        if payload.location is not None:
            update_fields.append("t.location = $location")
            params["location"] = payload.location
        if payload.location_lat is not None:
            update_fields.append("t.location_lat = $location_lat")
            params["location_lat"] = payload.location_lat
        if payload.location_lon is not None:
            update_fields.append("t.location_lon = $location_lon")
            params["location_lon"] = payload.location_lon
        
        if not update_fields:
            # No fields to update, just return the existing task
            query = "MATCH (t:Task {id: $task_id, session_id: $session_id}) RETURN t"
            result = session.run(query, task_id=task_id, session_id=session_id)
            record = result.single()
            return _node_to_task(record["t"])
        
        update_fields.append("t.updated_at = $updated_at")
        
        query = f"""
        MATCH (t:Task {{id: $task_id, session_id: $session_id}})
        SET {', '.join(update_fields)}
        RETURN t
        """
        
        result = session.run(query, **params)
        record = result.single()
        
        if not record:
            raise HTTPException(status_code=500, detail="Failed to update task")
        
        return _node_to_task(record["t"])
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error updating task: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to update task: {str(e)}")


@tasks_router.delete("/{task_id}")
def delete_task(
    task_id: str,
    request: Request = None,
    auth: dict = Depends(require_auth),
    session: Session = Depends(get_neo4j_session),
):
    """Delete a task."""
    try:
        session_id = getattr(request.state, "session_id", None) or "default"
        
        query = """
        MATCH (t:Task {id: $task_id, session_id: $session_id})
        DETACH DELETE t
        RETURN t.id AS deleted_id
        """
        result = session.run(query, task_id=task_id, session_id=session_id)
        record = result.single()
        
        if not record:
            raise HTTPException(status_code=404, detail="Task not found")
        
        return {"status": "deleted", "task_id": record["deleted_id"]}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error deleting task: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to delete task: {str(e)}")


# Free blocks endpoint

@schedule_router.get("/free-blocks", response_model=FreeBlocksResponse)
def list_free_blocks(
    start: str = Query(..., description="Start date/time (ISO format)"),
    end: str = Query(..., description="End date/time (ISO format)"),
    request: Request = None,
    auth: dict = Depends(require_auth),
    session: Session = Depends(get_neo4j_session),
):
    """List free time blocks for a date range."""
    try:
        session_id = getattr(request.state, "session_id", None) or "default"
        
        start_dt = datetime.fromisoformat(start.replace("Z", "+00:00"))
        end_dt = datetime.fromisoformat(end.replace("Z", "+00:00"))
        
        # Get calendar events
        events = get_calendar_events(session, session_id, start_dt, end_dt)
        
        # Compute free blocks
        free_blocks = compute_free_blocks(events, start_dt, end_dt)
        
        # Convert to API models
        blocks = [
            FreeBlock(
                start=b.start_iso,
                end=b.end_iso,
                duration_minutes=b.duration_minutes,
                date=b.date,
            )
            for b in free_blocks
        ]
        
        return FreeBlocksResponse(blocks=blocks, total=len(blocks))
    except Exception as e:
        logger.error(f"Error listing free blocks: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to list free blocks: {str(e)}")


# Suggestions endpoints

@schedule_router.post("/suggestions", response_model=SuggestionsResponse)
def generate_suggestions(
    start: str = Query(..., description="Start date/time (ISO format)"),
    end: str = Query(..., description="End date/time (ISO format)"),
    request: Request = None,
    auth: dict = Depends(require_auth),
    session: Session = Depends(get_neo4j_session),
):
    """Generate and persist plan suggestions for a date range."""
    try:
        session_id = getattr(request.state, "session_id", None) or "default"
        
        _ensure_task_schema(session)
        
        # Parse ISO datetime strings and normalize to naive UTC datetimes
        # This ensures all datetimes are comparable (all naive)
        try:
            from dateutil import parser as date_parser
            start_dt = date_parser.parse(start)
            end_dt = date_parser.parse(end)
        except ImportError:
            # Fallback to fromisoformat if dateutil not available
            start_str = start.replace("Z", "+00:00")
            end_str = end.replace("Z", "+00:00")
            start_dt = datetime.fromisoformat(start_str)
            end_dt = datetime.fromisoformat(end_str)
        
        # Convert to UTC if timezone-aware, then make naive (since we work with UTC internally)
        # All datetime operations in scheduler use naive UTC datetimes
        if start_dt.tzinfo is not None:
            start_dt = start_dt.astimezone(timezone.utc).replace(tzinfo=None)
        if end_dt.tzinfo is not None:
            end_dt = end_dt.astimezone(timezone.utc).replace(tzinfo=None)
        
        logger.info(f"Parsed date range: {start_dt} to {end_dt} (naive UTC)")
        
        # Get calendar events
        events = get_calendar_events(session, session_id, start_dt, end_dt)
        logger.info(f"[Scheduler] Found {len(events)} calendar events for date range")
        
        # Get tasks
        tasks_internal = get_tasks_service(session, session_id, start_dt, end_dt)
        logger.info(f"[Scheduler] Found {len(tasks_internal)} tasks for date range (session_id: {session_id})")
        if tasks_internal:
            for task in tasks_internal:
                logger.info(f"[Scheduler] Task: {task.title} (due: {task.due_date}, priority: {task.priority})")
        
        # Compute free blocks
        free_blocks = compute_free_blocks(events, start_dt, end_dt)
        logger.info(f"[Scheduler] Computed {len(free_blocks)} free time blocks")
        
        # Build suggestions
        drafts = build_plan_suggestions(tasks_internal, free_blocks, events)
        logger.info(f"[Scheduler] Generated {len(drafts)} schedule suggestions")
        
        # Delete old suggestions in this time window with status="suggested"
        delete_query = """
        MATCH (s:PlanSuggestion {session_id: $session_id, status: 'suggested'})
        WHERE s.start >= $start AND s.end <= $end
        DELETE s
        """
        session.run(delete_query, session_id=session_id, start=start_dt.isoformat(), end=end_dt.isoformat())
        
        # Persist suggestions
        now = datetime.utcnow().isoformat()
        suggestions = []
        
        # Get task titles for finalization
        task_titles = {t.id: t.title for t in tasks_internal}
        
        for draft in drafts:
            suggestion_id = f"SUG_{uuid4().hex[:10]}"
            
            # Finalize reasons
            task = next((t for t in tasks_internal if t.id == draft.task_id), None)
            block = next((b for b in free_blocks if b.start <= draft.start <= b.end), None)
            if task and block:
                reasons = finalize_reasons(draft, task, block)
            else:
                reasons = draft.reason_tags[:3]  # Fallback
            
            # Persist to Neo4j
            query = """
            CREATE (s:PlanSuggestion {
                id: $id,
                session_id: $session_id,
                task_id: $task_id,
                start: $start,
                end: $end,
                confidence: $confidence,
                reasons: $reasons,
                status: $status,
                created_at: $created_at
            })
            RETURN s
            """
            
            session.run(
                query,
                id=suggestion_id,
                session_id=session_id,
                task_id=draft.task_id,
                start=draft.start.isoformat(),
                end=draft.end.isoformat(),
                confidence=draft.confidence,
                reasons=reasons,
                status="suggested",
                created_at=now,
            )
            
            suggestions.append(PlanSuggestion(
                id=suggestion_id,
                task_id=draft.task_id,
                task_title=draft.task_title,
                start=draft.start.isoformat(),
                end=draft.end.isoformat(),
                confidence=draft.confidence,
                reasons=reasons,
                status="suggested",
                created_at=now,
            ))
        
        # Group by day
        suggestions_by_day: Dict[str, List[PlanSuggestion]] = {}
        for sug in suggestions:
            date_str = datetime.fromisoformat(sug.start).date().isoformat()
            if date_str not in suggestions_by_day:
                suggestions_by_day[date_str] = []
            suggestions_by_day[date_str].append(sug)
        
        # Sort by start time within each day
        for date_str in suggestions_by_day:
            suggestions_by_day[date_str].sort(key=lambda s: s.start)
        
        grouped = [
            SuggestionGroupedByDay(date=date, suggestions=sugs)
            for date, sugs in sorted(suggestions_by_day.items())
        ]
        
        return SuggestionsResponse(suggestions_by_day=grouped, total=len(suggestions))
    except Exception as e:
        logger.error(f"Error generating suggestions: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to generate suggestions: {str(e)}")


@schedule_router.get("/suggestions", response_model=SuggestionsResponse)
def list_suggestions(
    start: str = Query(..., description="Start date/time (ISO format)"),
    end: str = Query(..., description="End date/time (ISO format)"),
    request: Request = None,
    auth: dict = Depends(require_auth),
    session: Session = Depends(get_neo4j_session),
):
    """List existing suggestions for a date range."""
    try:
        session_id = getattr(request.state, "session_id", None) or "default"
        
        start_dt = datetime.fromisoformat(start.replace("Z", "+00:00"))
        end_dt = datetime.fromisoformat(end.replace("Z", "+00:00"))
        
        query = """
        MATCH (s:PlanSuggestion {session_id: $session_id})
        WHERE s.start >= $start AND s.end <= $end
        OPTIONAL MATCH (t:Task {id: s.task_id, session_id: $session_id})
        RETURN s, t.title AS task_title
        ORDER BY s.start
        """
        
        result = session.run(
            query,
            session_id=session_id,
            start=start_dt.isoformat(),
            end=end_dt.isoformat(),
        )
        
        suggestions = []
        for record in result:
            node = record["s"]
            task_title = record["task_title"] or "Unknown Task"
            suggestions.append(_node_to_suggestion(node, task_title))
        
        # Group by day
        suggestions_by_day: Dict[str, List[PlanSuggestion]] = {}
        for sug in suggestions:
            date_str = datetime.fromisoformat(sug.start).date().isoformat()
            if date_str not in suggestions_by_day:
                suggestions_by_day[date_str] = []
            suggestions_by_day[date_str].append(sug)
        
        # Sort by start time within each day
        for date_str in suggestions_by_day:
            suggestions_by_day[date_str].sort(key=lambda s: s.start)
        
        grouped = [
            SuggestionGroupedByDay(date=date, suggestions=sugs)
            for date, sugs in sorted(suggestions_by_day.items())
        ]
        
        return SuggestionsResponse(suggestions_by_day=grouped, total=len(suggestions))
    except Exception as e:
        logger.error(f"Error listing suggestions: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to list suggestions: {str(e)}")


@schedule_router.post("/suggestions/{suggestion_id}/accept")
def accept_suggestion(
    suggestion_id: str,
    request: Request = None,
    auth: dict = Depends(require_auth),
    session: Session = Depends(get_neo4j_session),
):
    """Accept a suggestion (change status to 'accepted')."""
    try:
        session_id = getattr(request.state, "session_id", None) or "default"
        
        query = """
        MATCH (s:PlanSuggestion {id: $id, session_id: $session_id})
        SET s.status = 'accepted', s.updated_at = $updated_at
        RETURN s
        """
        
        result = session.run(
            query,
            id=suggestion_id,
            session_id=session_id,
            updated_at=datetime.utcnow().isoformat(),
        )
        
        if not result.single():
            raise HTTPException(status_code=404, detail="Suggestion not found")
        
        return {"status": "accepted", "suggestion_id": suggestion_id}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error accepting suggestion: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to accept suggestion: {str(e)}")


@schedule_router.post("/suggestions/{suggestion_id}/reject")
def reject_suggestion(
    suggestion_id: str,
    request: Request = None,
    auth: dict = Depends(require_auth),
    session: Session = Depends(get_neo4j_session),
):
    """Reject a suggestion (change status to 'rejected')."""
    try:
        session_id = getattr(request.state, "session_id", None) or "default"
        
        query = """
        MATCH (s:PlanSuggestion {id: $id, session_id: $session_id})
        SET s.status = 'rejected', s.updated_at = $updated_at
        RETURN s
        """
        
        result = session.run(
            query,
            id=suggestion_id,
            session_id=session_id,
            updated_at=datetime.utcnow().isoformat(),
        )
        
        if not result.single():
            raise HTTPException(status_code=404, detail="Suggestion not found")
        
        return {"status": "rejected", "suggestion_id": suggestion_id}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error rejecting suggestion: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to reject suggestion: {str(e)}")


@schedule_router.post("/suggestions/{suggestion_id}/complete")
def complete_suggestion(
    suggestion_id: str,
    request: Request = None,
    auth: dict = Depends(require_auth),
    session: Session = Depends(get_neo4j_session),
):
    """Mark a suggestion as completed (change status to 'completed')."""
    try:
        session_id = getattr(request.state, "session_id", None) or "default"
        
        query = """
        MATCH (s:PlanSuggestion {id: $id, session_id: $session_id})
        SET s.status = 'completed', s.updated_at = $updated_at
        RETURN s
        """
        
        result = session.run(
            query,
            id=suggestion_id,
            session_id=session_id,
            updated_at=datetime.utcnow().isoformat(),
        )
        
        if not result.single():
            raise HTTPException(status_code=404, detail="Suggestion not found")
        
        return {"status": "completed", "suggestion_id": suggestion_id}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error completing suggestion: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to complete suggestion: {str(e)}")
