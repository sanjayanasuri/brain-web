"""
API endpoints for calendar events (native calendar functionality).
"""
from typing import List, Optional, Dict, Any
from datetime import datetime
from uuid import uuid4
import math
import logging
from fastapi import APIRouter, Depends, HTTPException, Query
from neo4j import Session
from db_neo4j import get_neo4j_session
from auth import require_auth, optional_auth
from models import (
    CalendarEvent,
    CalendarEventCreate,
    CalendarEventUpdate,
    CalendarEventListResponse,
)
from services_geocoding import search_locations

logger = logging.getLogger("brain_web")

router = APIRouter(prefix="/calendar", tags=["calendar"])


def haversine_distance(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """
    Calculate the great circle distance between two points on Earth (in miles).
    Uses the Haversine formula.
    """
    R = 3959  # Earth's radius in miles
    
    # Convert to radians
    lat1_rad = math.radians(lat1)
    lon1_rad = math.radians(lon1)
    lat2_rad = math.radians(lat2)
    lon2_rad = math.radians(lon2)
    
    # Haversine formula
    dlat = lat2_rad - lat1_rad
    dlon = lon2_rad - lon1_rad
    
    a = math.sin(dlat / 2) ** 2 + math.cos(lat1_rad) * math.cos(lat2_rad) * math.sin(dlon / 2) ** 2
    c = 2 * math.asin(math.sqrt(a))
    
    return R * c


# Common locations database with coordinates (latitude, longitude)
# Purdue University coordinates (West Lafayette, IN)
COMMON_LOCATIONS: Dict[str, List[Dict[str, Any]]] = {
    "purdue": [
        {"name": "WALC (Wilmeth Active Learning Center)", "lat": 40.4284, "lon": -86.9147},
        {"name": "Stewart Center", "lat": 40.4286, "lon": -86.9145},
        {"name": "Purdue Memorial Union", "lat": 40.4288, "lon": -86.9143},
        {"name": "Hicks Undergraduate Library", "lat": 40.4282, "lon": -86.9149},
        {"name": "Krannert Building", "lat": 40.4290, "lon": -86.9141},
        {"name": "Armstrong Hall", "lat": 40.4280, "lon": -86.9151},
        {"name": "Beering Hall", "lat": 40.4292, "lon": -86.9139},
        {"name": "Elliott Hall of Music", "lat": 40.4284, "lon": -86.9143},
        {"name": "Purdue Recreational Sports Center (CoRec)", "lat": 40.4278, "lon": -86.9153},
        {"name": "Mackey Arena", "lat": 40.4300, "lon": -86.9135},
        {"name": "Ross-Ade Stadium", "lat": 40.4310, "lon": -86.9125},
        {"name": "Purdue Airport", "lat": 40.4120, "lon": -86.9370},
        {"name": "Discovery Park", "lat": 40.4350, "lon": -86.9100},
        {"name": "Purdue Research Park", "lat": 40.4400, "lon": -86.9050},
        {"name": "Purdue Village", "lat": 40.4250, "lon": -86.9200},
        {"name": "Cary Quadrangle", "lat": 40.4270, "lon": -86.9160},
        {"name": "Tarkington Hall", "lat": 40.4260, "lon": -86.9170},
        {"name": "Wiley Hall", "lat": 40.4250, "lon": -86.9180},
        {"name": "Shreve Hall", "lat": 40.4240, "lon": -86.9190},
        {"name": "Earhart Hall", "lat": 40.4230, "lon": -86.9200},
        {"name": "Hawkins Hall", "lat": 40.4220, "lon": -86.9210},
        {"name": "Harrison Hall", "lat": 40.4210, "lon": -86.9220},
        {"name": "McCutcheon Hall", "lat": 40.4200, "lon": -86.9230},
        {"name": "Owen Hall", "lat": 40.4190, "lon": -86.9240},
        {"name": "Windsor Hall", "lat": 40.4180, "lon": -86.9250},
    ],
    "default": [
        # Generic common locations that users might search for
        {"name": "Library", "lat": 0.0, "lon": 0.0},
        {"name": "Student Center", "lat": 0.0, "lon": 0.0},
        {"name": "Main Building", "lat": 0.0, "lon": 0.0},
        {"name": "Gymnasium", "lat": 0.0, "lon": 0.0},
        {"name": "Cafeteria", "lat": 0.0, "lon": 0.0},
        {"name": "Auditorium", "lat": 0.0, "lon": 0.0},
        {"name": "Conference Room", "lat": 0.0, "lon": 0.0},
        {"name": "Parking Lot", "lat": 0.0, "lon": 0.0},
        {"name": "Office", "lat": 0.0, "lon": 0.0},
        {"name": "Classroom", "lat": 0.0, "lon": 0.0},
    ]
}


def _ensure_calendar_schema(session: Session):
    """Ensure calendar event nodes have proper constraints."""
    # Create unique constraint on event_id if it doesn't exist
    try:
        session.run("""
            CREATE CONSTRAINT calendar_event_id IF NOT EXISTS
            FOR (e:CalendarEvent) REQUIRE e.event_id IS UNIQUE
        """)
    except Exception:
        pass  # Constraint may already exist


def _node_to_event(node) -> CalendarEvent:
    """Convert Neo4j node to CalendarEvent model."""
    return CalendarEvent(
        event_id=node["event_id"],
        title=node["title"],
        description=node.get("description"),
        location=node.get("location"),
        start_date=node["start_date"],
        end_date=node.get("end_date"),
        start_time=node.get("start_time"),
        end_time=node.get("end_time"),
        all_day=node.get("all_day", True),
        color=node.get("color"),
        created_at=node.get("created_at"),
        updated_at=node.get("updated_at"),
    )


@router.post("/events", response_model=CalendarEvent)
def create_calendar_event(
    payload: CalendarEventCreate,
    auth: dict = Depends(require_auth),
    session: Session = Depends(get_neo4j_session),
):
    """Create a new calendar event."""
    try:
        _ensure_calendar_schema(session)
        
        event_id = f"CAL_{uuid4().hex[:10]}"
        now = datetime.utcnow().isoformat()
        
        # Default end_date to start_date if not provided
        end_date = payload.end_date or payload.start_date
        
        # Build properties dict, only including non-None values
        properties = {
            "event_id": event_id,
            "title": payload.title,
            "start_date": payload.start_date,
            "end_date": end_date,
            "all_day": payload.all_day,
            "created_at": now,
            "updated_at": now,
        }
        
        # Add optional fields only if they're not None
        if payload.description is not None:
            properties["description"] = payload.description
        if payload.location is not None:
            properties["location"] = payload.location
        if payload.start_time is not None:
            properties["start_time"] = payload.start_time
        if payload.end_time is not None:
            properties["end_time"] = payload.end_time
        if payload.color is not None:
            properties["color"] = payload.color
        
        # Build Cypher query dynamically
        prop_strings = [f"{k}: ${k}" for k in properties.keys()]
        query = f"""
        CREATE (e:CalendarEvent {{
            {', '.join(prop_strings)}
        }})
        RETURN e
        """
        
        logger.info(f"Creating calendar event: {event_id}, title: {payload.title}")
        result = session.run(query, **properties)
        
        record = result.single()
        if not record:
            logger.error(f"Failed to create calendar event: no record returned")
            raise HTTPException(status_code=500, detail="Failed to create calendar event - no record returned")
        
        return _node_to_event(record["e"])
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error creating calendar event: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to create calendar event: {str(e)}")


@router.get("/events", response_model=CalendarEventListResponse)
def list_calendar_events(
    start_date: Optional[str] = Query(None, description="Filter events from this date (YYYY-MM-DD)"),
    end_date: Optional[str] = Query(None, description="Filter events until this date (YYYY-MM-DD)"),
    auth: dict = Depends(require_auth),
    session: Session = Depends(get_neo4j_session),
):
    """List calendar events, optionally filtered by date range."""
    query = "MATCH (e:CalendarEvent)"
    params = {}
    
    # Build date filter if provided
    if start_date or end_date:
        conditions = []
        if start_date:
            conditions.append("e.end_date >= $start_date")
            params["start_date"] = start_date
        if end_date:
            conditions.append("e.start_date <= $end_date")
            params["end_date"] = end_date
        
        if conditions:
            query += " WHERE " + " AND ".join(conditions)
    
    query += " RETURN e ORDER BY e.start_date, e.start_time"
    
    result = session.run(query, **params)
    events = [_node_to_event(record["e"]) for record in result]
    
    return CalendarEventListResponse(events=events, total=len(events))


@router.get("/events/{event_id}", response_model=CalendarEvent)
def get_calendar_event(
    event_id: str,
    auth: dict = Depends(require_auth),
    session: Session = Depends(get_neo4j_session),
):
    """Get a specific calendar event by ID."""
    query = "MATCH (e:CalendarEvent {event_id: $event_id}) RETURN e"
    result = session.run(query, event_id=event_id)
    record = result.single()
    
    if not record:
        raise HTTPException(status_code=404, detail="Calendar event not found")
    
    return _node_to_event(record["e"])


@router.put("/events/{event_id}", response_model=CalendarEvent)
def update_calendar_event(
    event_id: str,
    payload: CalendarEventUpdate,
    auth: dict = Depends(require_auth),
    session: Session = Depends(get_neo4j_session),
):
    """Update a calendar event."""
    # First check if event exists
    check_query = "MATCH (e:CalendarEvent {event_id: $event_id}) RETURN e"
    check_result = session.run(check_query, event_id=event_id)
    if not check_result.single():
        raise HTTPException(status_code=404, detail="Calendar event not found")
    
    # Build update query dynamically based on provided fields
    update_fields = []
    params = {"event_id": event_id, "updated_at": datetime.utcnow().isoformat()}
    
    if payload.title is not None:
        update_fields.append("e.title = $title")
        params["title"] = payload.title
    if payload.description is not None:
        update_fields.append("e.description = $description")
        params["description"] = payload.description
    if payload.location is not None:
        update_fields.append("e.location = $location")
        params["location"] = payload.location
    if payload.start_date is not None:
        update_fields.append("e.start_date = $start_date")
        params["start_date"] = payload.start_date
    if payload.end_date is not None:
        update_fields.append("e.end_date = $end_date")
        params["end_date"] = payload.end_date
    if payload.start_time is not None:
        update_fields.append("e.start_time = $start_time")
        params["start_time"] = payload.start_time
    if payload.end_time is not None:
        update_fields.append("e.end_time = $end_time")
        params["end_time"] = payload.end_time
    if payload.all_day is not None:
        update_fields.append("e.all_day = $all_day")
        params["all_day"] = payload.all_day
    if payload.color is not None:
        update_fields.append("e.color = $color")
        params["color"] = payload.color
    
    if not update_fields:
        # No fields to update, just return the existing event
        return get_calendar_event(event_id, auth, session)
    
    update_fields.append("e.updated_at = $updated_at")
    
    query = f"""
    MATCH (e:CalendarEvent {{event_id: $event_id}})
    SET {', '.join(update_fields)}
    RETURN e
    """
    
    result = session.run(query, **params)
    record = result.single()
    
    if not record:
        raise HTTPException(status_code=500, detail="Failed to update calendar event")
    
    return _node_to_event(record["e"])


@router.delete("/events/{event_id}")
def delete_calendar_event(
    event_id: str,
    auth: dict = Depends(require_auth),
    session: Session = Depends(get_neo4j_session),
):
    """Delete a calendar event."""
    query = "MATCH (e:CalendarEvent {event_id: $event_id}) DELETE e RETURN e.event_id AS deleted_id"
    result = session.run(query, event_id=event_id)
    record = result.single()
    
    if not record:
        raise HTTPException(status_code=404, detail="Calendar event not found")
    
    return {"status": "deleted", "event_id": record["deleted_id"]}


@router.get("/locations/suggestions")
def get_location_suggestions(
    query: Optional[str] = Query(None, description="Search query for location suggestions (required)"),
    context: Optional[str] = Query(None, description="User context (e.g., 'purdue', 'default')"),
    current_lat: Optional[float] = Query(None, description="Current latitude for distance calculation"),
    current_lon: Optional[float] = Query(None, description="Current longitude for distance calculation"),
):
    """
    Get location suggestions based on query and current location.
    
    Uses real geocoding API (OpenStreetMap Nominatim) to search for actual places.
    Also includes common locations from the database if they match.
    
    Requires a query parameter - only returns suggestions that match the search.
    If current location is provided, locations are sorted by distance.
    """
    # Require query parameter - don't return all locations
    if not query or len(query.strip()) < 2:
        return {"suggestions": []}
    
    query_lower = query.strip().lower()
    results = []
    
    # 1. Search real locations using geocoding API
    try:
        geocoding_results = search_locations(
            query=query.strip(),
            limit=10,
            current_lat=current_lat,
            current_lon=current_lon,
            use_google=False,  # Use Nominatim (free), set to True for Google Places
        )
        
        # Format geocoding results
        for geo_result in geocoding_results:
            results.append({
                "name": geo_result["name"],
                "full_address": geo_result.get("full_address"),
                "distance": geo_result.get("distance"),
                "lat": geo_result.get("lat"),
                "lon": geo_result.get("lon"),
                "type": "geocoded",  # Mark as real location from geocoding
            })
    except Exception as e:
        logger.error(f"Error in geocoding search: {str(e)}")
    
    # 2. Also include common locations from database if they match
    all_locations = []
    
    # Add default locations
    all_locations.extend(COMMON_LOCATIONS.get("default", []))
    
    # Add context-specific locations if provided
    if context and context in COMMON_LOCATIONS:
        all_locations.extend(COMMON_LOCATIONS.get(context, []))
    
    # Also check if query suggests a specific context (e.g., "purdue", "walc")
    if "purdue" in query_lower or any(term in query_lower for term in ["walc", "mackey", "co-rec", "stewart", "krannert"]):
        all_locations.extend(COMMON_LOCATIONS.get("purdue", []))
    
    # Add matching common locations
    for loc in all_locations:
        loc_name = loc.get("name") if isinstance(loc, dict) else loc
        
        # Filter by query - must contain the query text
        if query_lower not in loc_name.lower():
            continue
        
        result_item = {
            "name": loc_name,
            "distance": None,
            "type": "common",  # Mark as common location
        }
        
        # Calculate distance if current location is provided and location has coordinates
        if current_lat is not None and current_lon is not None:
            if isinstance(loc, dict) and "lat" in loc and "lon" in loc:
                if loc["lat"] != 0.0 or loc["lon"] != 0.0:  # Skip locations without valid coordinates
                    distance = haversine_distance(
                        current_lat, current_lon,
                        loc["lat"], loc["lon"]
                    )
                    result_item["distance"] = round(distance, 1)
                    result_item["lat"] = loc["lat"]
                    result_item["lon"] = loc["lon"]
        
        results.append(result_item)
    
    # Sort results - prioritize geocoded results, then by distance/relevance
    if current_lat is not None and current_lon is not None:
        # Sort by: geocoded first, then distance, then relevance
        results.sort(key=lambda x: (
            0 if x.get("type") == "geocoded" else 1,  # Geocoded results first
            x["distance"] if x.get("distance") is not None else float('inf'),
            0 if x["name"].lower().startswith(query_lower) else 1,
            x["name"].lower().index(query_lower) if query_lower in x["name"].lower() else 999,
        ))
    else:
        # Sort by: geocoded first, then relevance
        results.sort(key=lambda x: (
            0 if x.get("type") == "geocoded" else 1,  # Geocoded results first
            0 if x["name"].lower().startswith(query_lower) else 1,
            x["name"].lower().index(query_lower) if query_lower in x["name"].lower() else 999,
            x["name"].lower()
        ))
    
    # Limit results
    return {"suggestions": results[:15]}
