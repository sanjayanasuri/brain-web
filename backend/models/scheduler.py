# Smart scheduler (todo tasks and plan suggestions) models.
from typing import Optional, List

from pydantic import BaseModel, Field


class TodoTask(BaseModel):
    """A todo task that can be scheduled."""
    id: str
    title: str
    notes: Optional[str] = None
    estimated_minutes: int
    due_date: Optional[str] = None
    priority: str = "medium"
    energy: str = "med"
    tags: List[str] = Field(default_factory=list)
    preferred_time_windows: Optional[List[str]] = None
    dependencies: List[str] = Field(default_factory=list)
    location: Optional[str] = None
    location_lat: Optional[float] = None
    location_lon: Optional[float] = None
    created_at: Optional[str] = None
    updated_at: Optional[str] = None


class TodoTaskCreate(BaseModel):
    title: str
    notes: Optional[str] = None
    estimated_minutes: int
    due_date: Optional[str] = None
    priority: str = "medium"
    energy: str = "med"
    tags: Optional[List[str]] = None
    preferred_time_windows: Optional[List[str]] = None
    dependencies: Optional[List[str]] = None
    location: Optional[str] = None
    location_lat: Optional[float] = None
    location_lon: Optional[float] = None


class TodoTaskUpdate(BaseModel):
    title: Optional[str] = None
    notes: Optional[str] = None
    estimated_minutes: Optional[int] = None
    due_date: Optional[str] = None
    priority: Optional[str] = None
    energy: Optional[str] = None
    tags: Optional[List[str]] = None
    preferred_time_windows: Optional[List[str]] = None
    dependencies: Optional[List[str]] = None
    location: Optional[str] = None
    location_lat: Optional[float] = None
    location_lon: Optional[float] = None


class PlanSuggestion(BaseModel):
    id: str
    task_id: str
    task_title: str
    start: str
    end: str
    confidence: float
    reasons: List[str]
    status: str
    created_at: Optional[str] = None


class FreeBlock(BaseModel):
    start: str
    end: str
    duration_minutes: int
    date: str


class SuggestionGroupedByDay(BaseModel):
    date: str
    suggestions: List[PlanSuggestion]


class SuggestionsResponse(BaseModel):
    suggestions_by_day: List[SuggestionGroupedByDay]
    total: int


class TodoTaskListResponse(BaseModel):
    tasks: List[TodoTask]
    total: int


class FreeBlocksResponse(BaseModel):
    blocks: List[FreeBlock]
    total: int
