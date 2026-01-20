"""
Smart Scheduler service for generating task-to-calendar suggestions.

This module provides deterministic scheduling logic that:
- Reads calendar events from Neo4j
- Computes free time blocks
- Matches tasks to blocks considering duration, deadlines, energy, and location
- Generates suggestions with auditable reasoning
"""
from typing import List, Dict, Any, Optional, Tuple
from datetime import datetime, timedelta
from dataclasses import dataclass
import logging
from neo4j import Session

logger = logging.getLogger("brain_web")


@dataclass
class Event:
    """Internal representation of a calendar event."""
    start: datetime
    end: datetime
    location: Optional[str] = None
    location_lat: Optional[float] = None
    location_lon: Optional[float] = None


@dataclass
class Task:
    """Internal representation of a task."""
    id: str
    title: str
    estimated_minutes: int
    due_date: Optional[str] = None
    priority: str = "medium"
    energy: str = "med"
    tags: List[str] = None
    preferred_time_windows: Optional[List[str]] = None
    dependencies: List[str] = None
    location: Optional[str] = None
    location_lat: Optional[float] = None
    location_lon: Optional[float] = None

    def __post_init__(self):
        if self.tags is None:
            self.tags = []
        if self.dependencies is None:
            self.dependencies = []


@dataclass
class FreeBlock:
    """A free time block available for scheduling."""
    start: datetime
    end: datetime
    duration_minutes: int
    date: str  # ISO date string

    @property
    def start_iso(self) -> str:
        return self.start.isoformat()

    @property
    def end_iso(self) -> str:
        return self.end.isoformat()


@dataclass
class SuggestionDraft:
    """A draft suggestion before finalization."""
    task_id: str
    task_title: str
    start: datetime
    end: datetime
    confidence: float
    reason_tags: List[str]  # Tags for deterministic reasoning
    chunk_suffix: str = ""  # e.g., "(Part 1/2)" for split tasks


# Workday rules (hardcoded but configurable)
WORKDAY_RULES = {
    "working_hours_start": 8,  # 8:00 AM
    "working_hours_end": 22,  # 10:00 PM
    "minimum_block_minutes": 25,
    "buffer_minutes": 10,  # Buffer before/after events
    "high_energy_cutoff_hour": 20,  # Avoid high energy tasks after 8:30 PM
    "high_energy_cutoff_minute": 30,
    "travel_time_per_mile_minutes": 2,  # Average 2 minutes per mile
    "default_travel_time_minutes": 15,  # Default if location unknown
}


def get_calendar_events(
    session: Session,
    session_id: str,
    start_dt: datetime,
    end_dt: datetime,
) -> List[Event]:
    """
    Retrieve calendar events for a given date range.
    
    Args:
        session: Neo4j session
        session_id: User session ID (for future scoping if needed)
        start_dt: Start datetime
        end_dt: End datetime
    
    Returns:
        List of Event objects
    """
    start_date = start_dt.date().isoformat()
    end_date = end_dt.date().isoformat()
    
    query = """
    MATCH (e:CalendarEvent)
    WHERE e.end_date >= $start_date AND e.start_date <= $end_date
    RETURN e
    ORDER BY e.start_date, e.start_time
    """
    
    result = session.run(query, start_date=start_date, end_date=end_date)
    events = []
    
    for record in result:
        node = record["e"]
        start_date_str = node.get("start_date")
        end_date_str = node.get("end_date") or start_date_str
        start_time_str = node.get("start_time")
        end_time_str = node.get("end_time")
        all_day = node.get("all_day", True)
        
        # Parse dates
        try:
            start_date_obj = datetime.fromisoformat(start_date_str).date()
            end_date_obj = datetime.fromisoformat(end_date_str).date()
        except (ValueError, AttributeError):
            logger.warning(f"Invalid date format in calendar event: {start_date_str}")
            continue
        
        # Parse times if provided
        if start_time_str and not all_day:
            try:
                # Handle both "HH:MM" and full ISO datetime formats
                if "T" in start_time_str or " " in start_time_str:
                    start_dt_obj = datetime.fromisoformat(start_time_str.replace(" ", "T"))
                    # Convert to naive if timezone-aware
                    if start_dt_obj.tzinfo is not None:
                        start_dt_obj = start_dt_obj.replace(tzinfo=None)
                else:
                    # Assume "HH:MM" format
                    start_dt_obj = datetime.combine(start_date_obj, datetime.strptime(start_time_str, "%H:%M").time())
            except (ValueError, AttributeError):
                logger.warning(f"Invalid time format: {start_time_str}")
                start_dt_obj = datetime.combine(start_date_obj, datetime.min.time())
        else:
            start_dt_obj = datetime.combine(start_date_obj, datetime.min.time())
        
        if end_time_str and not all_day:
            try:
                if "T" in end_time_str or " " in end_time_str:
                    end_dt_obj = datetime.fromisoformat(end_time_str.replace(" ", "T"))
                    # Convert to naive if timezone-aware
                    if end_dt_obj.tzinfo is not None:
                        end_dt_obj = end_dt_obj.replace(tzinfo=None)
                else:
                    end_dt_obj = datetime.combine(end_date_obj, datetime.strptime(end_time_str, "%H:%M").time())
            except (ValueError, AttributeError):
                # Default to 1 hour after start
                end_dt_obj = start_dt_obj + timedelta(hours=1)
        else:
            if all_day:
                # All-day events end at end of day
                end_dt_obj = datetime.combine(end_date_obj, datetime.max.time().replace(microsecond=0))
            else:
                # Default to 1 hour after start
                end_dt_obj = start_dt_obj + timedelta(hours=1)
        
        # Only include events that overlap with our time range
        if end_dt_obj >= start_dt and start_dt_obj <= end_dt:
            location = node.get("location")
            # Try to extract coordinates from location if available
            # For now, we'll rely on geocoding when needed
            events.append(Event(
                start=start_dt_obj,
                end=end_dt_obj,
                location=location,
            ))
    
    return events


def get_tasks(
    session: Session,
    session_id: str,
    start_dt: datetime,
    end_dt: datetime,
) -> List[Task]:
    """
    Retrieve tasks for a given date range.
    
    Includes tasks with due dates in range, or no due date.
    
    Args:
        session: Neo4j session
        session_id: User session ID
        start_dt: Start datetime
        end_dt: End datetime
    
    Returns:
        List of Task objects
    """
    start_date = start_dt.date().isoformat()
    end_date = end_dt.date().isoformat()
    
    query = """
    MATCH (t:Task {session_id: $session_id})
    WHERE t.due_date IS NULL OR (t.due_date >= $start_date AND t.due_date <= $end_date)
    RETURN t
    ORDER BY 
        CASE t.priority
            WHEN 'high' THEN 1
            WHEN 'medium' THEN 2
            WHEN 'low' THEN 3
            ELSE 4
        END,
        CASE WHEN t.due_date IS NULL THEN 1 ELSE 0 END,
        t.due_date ASC,
        t.created_at ASC
    """
    
    result = session.run(query, session_id=session_id, start_date=start_date, end_date=end_date)
    tasks = []
    
    for record in result:
        node = record["t"]
        tasks.append(Task(
            id=node.get("id"),
            title=node.get("title", ""),
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
        ))
    
    return tasks


def compute_travel_time(
    from_lat: Optional[float],
    from_lon: Optional[float],
    to_lat: Optional[float],
    to_lon: Optional[float],
) -> int:
    """
    Compute travel time in minutes between two locations.
    
    Uses Haversine formula for distance, then estimates travel time.
    Falls back to default if coordinates unavailable.
    """
    if not all([from_lat, from_lon, to_lat, to_lon]):
        return WORKDAY_RULES["default_travel_time_minutes"]
    
    import math
    
    # Haversine distance in miles
    R = 3959  # Earth's radius in miles
    lat1_rad = math.radians(from_lat)
    lon1_rad = math.radians(from_lon)
    lat2_rad = math.radians(to_lat)
    lon2_rad = math.radians(to_lon)
    
    dlat = lat2_rad - lat1_rad
    dlon = lon2_rad - lon1_rad
    
    a = math.sin(dlat / 2) ** 2 + math.cos(lat1_rad) * math.cos(lat2_rad) * math.sin(dlon / 2) ** 2
    c = 2 * math.asin(math.sqrt(a))
    distance_miles = R * c
    
    # Estimate travel time (2 minutes per mile average)
    travel_minutes = int(distance_miles * WORKDAY_RULES["travel_time_per_mile_minutes"])
    
    # Minimum travel time
    return max(travel_minutes, 5)


def compute_free_blocks(
    events: List[Event],
    start_dt: datetime,
    end_dt: datetime,
    workday_rules: Dict[str, Any] = None,
) -> List[FreeBlock]:
    """
    Compute free time blocks by subtracting events from working hours.
    
    Args:
        events: List of calendar events
        start_dt: Start datetime
        end_dt: End datetime
        workday_rules: Optional override for workday rules
    
    Returns:
        List of FreeBlock objects
    """
    if workday_rules is None:
        workday_rules = WORKDAY_RULES
    
    buffer_minutes = workday_rules["buffer_minutes"]
    min_block = workday_rules["minimum_block_minutes"]
    work_start_hour = workday_rules["working_hours_start"]
    work_end_hour = workday_rules["working_hours_end"]
    
    # Sort events by start time
    sorted_events = sorted(events, key=lambda e: e.start)
    
    free_blocks = []
    current_date = start_dt.date()
    end_date = end_dt.date()
    
    while current_date <= end_date:
        # Working hours for this day
        day_start = datetime.combine(current_date, datetime.min.time().replace(hour=work_start_hour))
        day_end = datetime.combine(current_date, datetime.min.time().replace(hour=work_end_hour))
        
        # Clamp to requested range
        if day_start < start_dt:
            day_start = start_dt
        if day_end > end_dt:
            day_end = end_dt
        
        # Find events on this day
        day_events = [e for e in sorted_events if e.start.date() == current_date or e.end.date() == current_date]
        
        # Build occupied time ranges (with buffers)
        occupied = []
        for event in day_events:
            # Add buffer before and after
            event_start = event.start - timedelta(minutes=buffer_minutes)
            event_end = event.end + timedelta(minutes=buffer_minutes)
            
            # Clamp to day bounds
            event_start = max(event_start, day_start)
            event_end = min(event_end, day_end)
            
            if event_start < event_end:
                occupied.append((event_start, event_end))
        
        # Merge overlapping occupied ranges
        if occupied:
            occupied.sort()
            merged = [occupied[0]]
            for start, end in occupied[1:]:
                last_start, last_end = merged[-1]
                if start <= last_end:
                    merged[-1] = (last_start, max(end, last_end))
                else:
                    merged.append((start, end))
            occupied = merged
        
        # Generate free blocks
        current_time = day_start
        for occ_start, occ_end in occupied:
            if current_time < occ_start:
                block_duration = int((occ_start - current_time).total_seconds() / 60)
                if block_duration >= min_block:
                    free_blocks.append(FreeBlock(
                        start=current_time,
                        end=occ_start,
                        duration_minutes=block_duration,
                        date=current_date.isoformat(),
                    ))
            current_time = max(current_time, occ_end)
        
        # Check for free time after last event
        if current_time < day_end:
            block_duration = int((day_end - current_time).total_seconds() / 60)
            if block_duration >= min_block:
                free_blocks.append(FreeBlock(
                    start=current_time,
                    end=day_end,
                    duration_minutes=block_duration,
                    date=current_date.isoformat(),
                ))
        
        # Move to next day
        current_date += timedelta(days=1)
    
    return free_blocks


def score_task_block(
    task: Task,
    block: FreeBlock,
    previous_event: Optional[Event] = None,
    next_event: Optional[Event] = None,
    context_rules: Dict[str, Any] = None,
) -> Tuple[float, List[str]]:
    """
    Score how well a task fits into a time block.
    
    Returns:
        Tuple of (score 0.0-1.0, list of reason tags)
    """
    if context_rules is None:
        context_rules = WORKDAY_RULES
    
    score = 1.0
    reasons = []
    
    # Duration fit
    task_duration = task.estimated_minutes
    block_duration = block.duration_minutes
    
    # Account for travel time if location is involved
    travel_time = 0
    if task.location_lat and task.location_lon and previous_event:
        if previous_event.location_lat and previous_event.location_lon:
            travel_time = compute_travel_time(
                previous_event.location_lat,
                previous_event.location_lon,
                task.location_lat,
                task.location_lon,
            )
        elif previous_event.location:
            # Unknown previous location, use default
            travel_time = context_rules["default_travel_time_minutes"]
    
    available_duration = block_duration - travel_time
    
    if task_duration <= available_duration:
        # Perfect fit or room to spare
        fit_ratio = task_duration / available_duration if available_duration > 0 else 1.0
        score *= 0.9 + (0.1 * fit_ratio)  # Prefer tighter fits
        reasons.append("duration_fit")
    else:
        # Task is too long, but we can split it
        if task_duration <= block_duration * 2:
            score *= 0.7  # Can be split into 2 parts
            reasons.append("needs_split")
        else:
            score *= 0.3  # Poor fit
            reasons.append("poor_duration_fit")
    
    # Deadline urgency
    if task.due_date:
        due_date = datetime.fromisoformat(task.due_date).date()
        block_date = block.start.date()
        days_until_due = (due_date - block_date).days
        
        if days_until_due < 0:
            score *= 0.1  # Already overdue
            reasons.append("overdue")
        elif days_until_due == 0:
            score *= 1.2  # Due today - boost
            reasons.append("due_today")
        elif days_until_due <= 2:
            score *= 1.1  # Due soon - slight boost
            reasons.append("due_soon")
    
    # Energy match
    block_hour = block.start.hour
    block_minute = block.start.minute
    
    if task.energy == "high":
        cutoff_hour = context_rules["high_energy_cutoff_hour"]
        cutoff_minute = context_rules["high_energy_cutoff_minute"]
        if block_hour > cutoff_hour or (block_hour == cutoff_hour and block_minute >= cutoff_minute):
            score *= 0.6  # Penalize high energy tasks late in day
            reasons.append("late_high_energy")
        else:
            reasons.append("energy_match")
    elif task.energy == "low":
        if block_hour >= 20:
            reasons.append("low_energy_evening")  # Good for evening
        else:
            reasons.append("energy_match")
    
    # Priority boost
    if task.priority == "high":
        score *= 1.15
        reasons.append("high_priority")
    elif task.priority == "low":
        score *= 0.9
        reasons.append("low_priority")
    
    # Clamp score
    score = max(0.0, min(1.0, score))
    
    return score, reasons


def finalize_reasons(draft: SuggestionDraft, task: Task, block: FreeBlock) -> List[str]:
    """
    Convert reason tags into 1-3 human-readable reasoning bullets.
    
    Deterministic - no LLM required.
    """
    bullets = []
    reason_tags = set(draft.reason_tags)
    
    # Priority reasoning
    if "high_priority" in reason_tags:
        bullets.append(f"High priority task")
    elif "low_priority" in reason_tags:
        bullets.append(f"Lower priority, fits available time")
    
    # Deadline reasoning
    if "due_today" in reason_tags:
        bullets.append(f"Due today - urgent scheduling")
    elif "due_soon" in reason_tags:
        bullets.append(f"Due soon - timely placement")
    elif "overdue" in reason_tags:
        bullets.append(f"Overdue - immediate attention needed")
    
    # Duration reasoning
    if "duration_fit" in reason_tags:
        fit_pct = int((task.estimated_minutes / block.duration_minutes) * 100) if block.duration_minutes > 0 else 0
        bullets.append(f"Fits {fit_pct}% of available {block.duration_minutes}min block")
    elif "needs_split" in reason_tags:
        bullets.append(f"Task split across multiple blocks")
    
    # Energy reasoning
    if "energy_match" in reason_tags:
        time_of_day = "morning" if block.start.hour < 12 else "afternoon" if block.start.hour < 17 else "evening"
        bullets.append(f"{task.energy.capitalize()} energy task fits {time_of_day} slot")
    elif "late_high_energy" in reason_tags:
        bullets.append(f"High energy task scheduled late (limited options)")
    
    # Limit to 3 bullets
    return bullets[:3]


def build_plan_suggestions(
    tasks: List[Task],
    free_blocks: List[FreeBlock],
    events: List[Event],
    context_rules: Dict[str, Any] = None,
) -> List[SuggestionDraft]:
    """
    Build plan suggestions using greedy assignment with chunking.
    
    Args:
        tasks: List of tasks to schedule
        free_blocks: List of available time blocks
        events: List of calendar events (for travel time calculation)
        context_rules: Optional override for workday rules
    
    Returns:
        List of SuggestionDraft objects
    """
    if context_rules is None:
        context_rules = WORKDAY_RULES
    
    suggestions = []
    used_blocks = set()  # Track which blocks have been used
    task_remaining_time = {task.id: task.estimated_minutes for task in tasks}
    
    # Sort tasks by priority and deadline
    sorted_tasks = sorted(tasks, key=lambda t: (
        0 if t.priority == "high" else 1 if t.priority == "medium" else 2,
        datetime.fromisoformat(t.due_date).date() if t.due_date else datetime.max.date(),
    ))
    
    # Build event lookup for travel time
    events_by_time = sorted(events, key=lambda e: e.start)
    
    for task in sorted_tasks:
        if task_remaining_time[task.id] <= 0:
            continue
        
        # Find best matching blocks
        candidates = []
        
        for i, block in enumerate(free_blocks):
            if i in used_blocks:
                continue
            
            # Find previous/next events for travel time
            prev_event = None
            next_event = None
            for event in events_by_time:
                if event.end <= block.start:
                    prev_event = event
                elif event.start >= block.end:
                    next_event = event
                    break
            
            score, reason_tags = score_task_block(task, block, prev_event, next_event, context_rules)
            
            if score > 0.3:  # Minimum threshold
                candidates.append((score, i, block, reason_tags))
        
        # Sort by score descending
        candidates.sort(key=lambda x: x[0], reverse=True)
        
        # Assign task to blocks (may need multiple blocks if task is long)
        remaining_minutes = task_remaining_time[task.id]
        chunk_num = 1
        
        for score, block_idx, block, reason_tags in candidates:
            if remaining_minutes <= 0:
                break
            
            if block_idx in used_blocks:
                continue
            
            block_duration = block.duration_minutes
            
            # Account for travel time
            travel_time = 0
            if task.location_lat and task.location_lon:
                # Find previous event for travel time
                for event in events_by_time:
                    if event.end <= block.start:
                        if event.location_lat and event.location_lon:
                            travel_time = compute_travel_time(
                                event.location_lat,
                                event.location_lon,
                                task.location_lat,
                                task.location_lon,
                            )
                            break
                        elif event.location:
                            travel_time = context_rules["default_travel_time_minutes"]
                            break
            
            available_duration = block_duration - travel_time
            
            if remaining_minutes <= available_duration:
                # Task fits in this block
                chunk_suffix = f" (Part {chunk_num})" if task_remaining_time[task.id] != task.estimated_minutes else ""
                suggestions.append(SuggestionDraft(
                    task_id=task.id,
                    task_title=task.title + chunk_suffix,
                    start=block.start + timedelta(minutes=travel_time),
                    end=block.start + timedelta(minutes=travel_time + remaining_minutes),
                    confidence=score,
                    reason_tags=reason_tags,
                    chunk_suffix=chunk_suffix,
                ))
                used_blocks.add(block_idx)
                remaining_minutes = 0
                break
            elif available_duration >= context_rules["minimum_block_minutes"]:
                # Split task - use this block for a chunk
                chunk_suffix = f" (Part {chunk_num})"
                suggestions.append(SuggestionDraft(
                    task_id=task.id,
                    task_title=task.title + chunk_suffix,
                    start=block.start + timedelta(minutes=travel_time),
                    end=block.start + timedelta(minutes=travel_time + available_duration),
                    confidence=score * 0.8,  # Slightly lower confidence for split tasks
                    reason_tags=reason_tags + ["split_chunk"],
                    chunk_suffix=chunk_suffix,
                ))
                used_blocks.add(block_idx)
                remaining_minutes -= available_duration
                chunk_num += 1
    
    return suggestions
