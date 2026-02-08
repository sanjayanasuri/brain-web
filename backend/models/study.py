# backend/models/study.py
"""
Pydantic models for the adaptive learning orchestration system.
Phase 1: Context building and clarification.
"""

from typing import List, Optional, Dict, Any
from pydantic import BaseModel, Field


# ---------- Phase 1: Context Building ----------

class ContextRequest(BaseModel):
    """Request to build context from a selection."""
    selection_id: str = Field(..., description="ID of the selection (quote_id or artifact_id)")
    radius: int = Field(default=2, description="Number of surrounding blocks to include")
    include_related: bool = Field(default=True, description="Include linked lecture sections and concepts")


class Excerpt(BaseModel):
    """A grounded excerpt from notes/lectures."""
    excerpt_id: str = Field(..., description="Stable ID for this excerpt")
    content: str = Field(..., description="Text content of the excerpt")
    source_type: str = Field(..., description="Type of source: 'note', 'lecture', 'artifact', 'quote'")
    source_id: str = Field(..., description="ID of the source document")
    relevance_score: float = Field(..., description="Relevance to selection (0-1)")
    metadata: Optional[Dict[str, Any]] = Field(default=None, description="Additional metadata (title, url, etc.)")


class ContextPack(BaseModel):
    """Complete context package for a selection."""
    excerpts: List[Excerpt] = Field(default_factory=list, description="Grounded excerpts sorted by relevance")
    concepts: List[str] = Field(default_factory=list, description="Related concept IDs")
    metadata: Optional[Dict[str, Any]] = Field(default=None, description="Additional context metadata")


class ClarifyRequest(BaseModel):
    """Request to clarify a selection."""
    selection_id: str = Field(..., description="ID of the selection to clarify")
    radius: int = Field(default=2, description="Context radius")
    include_related: bool = Field(default=True, description="Include related content")


class ClarifyResponse(BaseModel):
    """Response from clarification endpoint."""
    explanation: str = Field(..., description="Grounded explanation of the selection")
    context_pack: ContextPack = Field(..., description="Context used for clarification")
    citations: List[str] = Field(default_factory=list, description="Citation IDs used in explanation")


# ---------- Phase 2: Sessions, Tasks, Attempts ----------

class StudySession(BaseModel):
    """A guided study session with multiple tasks."""
    id: str = Field(..., description="Session UUID")
    user_id: str = Field(..., description="User ID")
    tenant_id: str = Field(..., description="Tenant ID")
    graph_id: Optional[str] = Field(default=None, description="Graph ID")
    branch_id: Optional[str] = Field(default=None, description="Branch ID")
    topic_id: Optional[str] = Field(default=None, description="Linked concept node_id")
    selection_id: Optional[str] = Field(default=None, description="Originating quote_id")
    intent: str = Field(..., description="Session intent: 'clarify', 'practice', 'review'")
    current_mode: str = Field(default="explain", description="Current mode: 'explain', 'typing', 'voice'")
    mode_inertia: float = Field(default=0.5, description="Mode inertia score (0-1)")
    started_at: str = Field(..., description="ISO timestamp")
    ended_at: Optional[str] = Field(default=None, description="ISO timestamp")
    metadata: Optional[Dict[str, Any]] = Field(default=None, description="Additional metadata")


class TaskSpec(BaseModel):
    """Specification for a study task."""
    task_id: str = Field(..., description="Task UUID")
    task_type: str = Field(..., description="Task type: 'clarify', 'define_example', 'explain_back', 'multiple_choice'")
    prompt: str = Field(..., description="Task prompt for user")
    rubric_json: Dict[str, Any] = Field(..., description="Scoring rubric")
    context_pack: ContextPack = Field(..., description="Context for this task")
    compatible_modes: List[str] = Field(..., description="Compatible modes: ['explain', 'typing']")
    disruption_cost: float = Field(default=0.3, description="Cost of switching to this task (0-1)")


class AttemptRequest(BaseModel):
    """Request to submit a task attempt."""
    response_text: str = Field(..., description="User's response")
    self_confidence: Optional[float] = Field(default=None, description="User's self-assessment (0-1)")


class EvaluationResult(BaseModel):
    """Result of evaluating a task attempt."""
    score_json: Dict[str, float] = Field(..., description="Scores by dimension (each 0-1)")
    composite_score: float = Field(..., description="Weighted composite score (0-1)")
    feedback_text: str = Field(..., description="Constructive feedback")
    gap_concepts: List[str] = Field(default_factory=list, description="Missing/weak concept IDs")


class StartSessionRequest(BaseModel):
    """Request to start a study session."""
    intent: str = Field(..., description="Session intent: 'clarify', 'practice', 'review'")
    topic_id: Optional[str] = Field(default=None, description="Concept node_id to study")
    selection_id: Optional[str] = Field(default=None, description="Quote_id to start from")
    current_mode: str = Field(default="explain", description="Starting mode")


class StartSessionResponse(BaseModel):
    """Response from starting a session."""
    session_id: str = Field(..., description="Session UUID")
    initial_task: TaskSpec = Field(..., description="First task in session")
    mode_state: Dict[str, Any] = Field(..., description="Current mode state")


class NextTaskResponse(BaseModel):
    """Response from getting next task."""
    task_spec: TaskSpec = Field(..., description="Next task specification")
    mode_state: Dict[str, Any] = Field(..., description="Current mode state")


class AttemptResponse(BaseModel):
    """Response from submitting an attempt."""
    evaluation: EvaluationResult = Field(..., description="Evaluation result")
    suggested_next: Optional[Dict[str, str]] = Field(default=None, description="Optional next task suggestion")
    mode_state: Dict[str, Any] = Field(..., description="Updated mode state")


class SessionSummary(BaseModel):
    """Summary of a completed session."""
    session_id: str
    tasks_completed: int
    avg_score: float
    duration_seconds: int
    concepts_covered: List[str]
