# Voice session and Supermemory integration models.
from datetime import datetime
from typing import Optional, Dict, Any

from pydantic import BaseModel, Field


class VoiceSession(BaseModel):
    session_id: str
    user_id: str
    tenant_id: str
    graph_id: str
    branch_id: str
    started_at: datetime = Field(default_factory=datetime.utcnow)
    ended_at: Optional[datetime] = None
    metadata: Dict[str, Any] = Field(default_factory=dict)
    total_duration_seconds: int = 0
    token_usage_estimate: int = 0


class VoiceSessionCreate(BaseModel):
    graph_id: str
    branch_id: str
    metadata: Optional[Dict[str, Any]] = None
    companion_session_id: Optional[str] = None


class UsageLog(BaseModel):
    user_id: str
    tenant_id: str
    action_type: str
    quantity: float
    timestamp: datetime = Field(default_factory=datetime.utcnow)
    metadata: Dict[str, Any] = Field(default_factory=dict)


class SupermemoryMemory(BaseModel):
    memory_id: str
    content: str
    source_url: Optional[str] = None
    metadata: Dict[str, Any] = Field(default_factory=dict)
    created_at: datetime = Field(default_factory=datetime.utcnow)


class MemorySyncEvent(BaseModel):
    sync_id: str
    user_id: str
    source: str
    memory_id: Optional[str] = None
    content_preview: str
    timestamp: datetime = Field(default_factory=datetime.utcnow)
    status: str = "synced"
