"""Pydantic models for Learning Notes Digest."""
from datetime import datetime
from typing import List, Optional

from pydantic import BaseModel, Field


class NotesEntry(BaseModel):
    """Single note entry with provenance."""
    id: str
    section_id: str
    chat_id: str
    source_type: str = Field(..., description="main_chat | branch_chat | bridging_hint")
    source_message_ids: List[str] = Field(default_factory=list)
    related_branch_id: Optional[str] = None
    related_anchor_ids: Optional[List[str]] = None
    summary_text: str
    confidence_level: float = Field(default=0.5, ge=0.0, le=1.0)
    concept_label: Optional[str] = Field(default=None, description="Concept label for grouping")
    related_node_ids: List[str] = Field(default_factory=list, description="Neo4j concept node IDs linked to this entry")
    created_at: datetime
    updated_at: datetime


class NotesSection(BaseModel):
    """Section grouping entries by learning intent."""
    id: str
    digest_id: str
    title: str
    position: int
    entries: List[NotesEntry] = Field(default_factory=list)
    created_at: datetime
    updated_at: datetime


class NotesDigest(BaseModel):
    """Digest for a chat session."""
    id: str
    chat_id: str
    sections: List[NotesSection] = Field(default_factory=list)
    created_at: datetime
    last_updated_at: Optional[datetime] = None
    last_processed_message_id: Optional[str] = None
    last_processed_at: Optional[datetime] = None


class NotesUpdateRequest(BaseModel):
    """Request to update notes digest incrementally."""
    trigger_source: Optional[str] = Field(
        default="manual",
        description="manual | branch_closed | bridging_hints"
    )
    branch_id: Optional[str] = Field(default=None, description="Limit update to a branch when provided.")


class NotesUpdateResponse(BaseModel):
    """Response after updating notes digest."""
    status: str
    entries_added: int = 0
    entries_refined: int = 0
    digest: NotesDigest


class NotesHistoryEntry(BaseModel):
    """History snapshot of a digest update."""
    id: str
    digest_id: str
    trigger_source: Optional[str] = None
    created_at: datetime
    snapshot: NotesDigest
