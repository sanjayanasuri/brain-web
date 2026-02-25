"""
Unified content pipeline domain models.

These models map 1:1 onto the Postgres tables created in `db_postgres.init_postgres_db()`:
- content_items
- content_analyses
- transcript_chunks
- thoughts

Phase 0 goal: lock a single canonical "ContentItem" contract that all future
ingestion sources (URL clipper, social, pasted text, screenshots, audio) map into.
"""

from __future__ import annotations

from datetime import datetime
from enum import Enum
from typing import Any, Dict, List, Optional
from uuid import UUID

from pydantic import BaseModel, Field


class ContentItemType(str, Enum):
    article = "article"
    social_post = "social_post"
    social_comment = "social_comment"
    snippet = "snippet"
    transcript = "transcript"


class ContentItemStatus(str, Enum):
    created = "created"
    extracted = "extracted"
    extracted_partial = "extracted_partial"
    analyzed = "analyzed"
    failed = "failed"


class ContentItem(BaseModel):
    id: UUID
    user_id: UUID
    type: ContentItemType

    source_url: Optional[str] = None
    source_platform: Optional[str] = None
    title: Optional[str] = None

    raw_text: Optional[str] = None
    raw_html: Optional[str] = None
    raw_media_url: Optional[str] = None

    extracted_text: Optional[str] = None
    status: ContentItemStatus = ContentItemStatus.created

    created_at: datetime
    updated_at: datetime


class ContentAnalysis(BaseModel):
    id: UUID
    content_item_id: UUID

    model: str
    summary_short: Optional[str] = None
    summary_long: Optional[str] = None

    key_points: List[str] = Field(default_factory=list)
    entities: List[Dict[str, Any]] = Field(default_factory=list)
    topics: List[Dict[str, Any]] = Field(default_factory=list)
    questions: List[str] = Field(default_factory=list)
    action_items: List[str] = Field(default_factory=list)
    analysis_json: Dict[str, Any] = Field(default_factory=dict)

    created_at: datetime


class TranscriptSpeaker(str, Enum):
    user = "user"
    assistant = "assistant"


class TranscriptChunk(BaseModel):
    id: UUID
    content_item_id: UUID

    chunk_index: int
    speaker: TranscriptSpeaker
    text: str

    start_ms: Optional[int] = None
    end_ms: Optional[int] = None

    created_at: datetime


class ThoughtType(str, Enum):
    question = "question"
    decision = "decision"
    insight = "insight"


class Thought(BaseModel):
    id: UUID
    user_id: UUID

    text: str
    type: ThoughtType

    source_content_item_id: UUID
    source_chunk_id: Optional[UUID] = None

    created_at: datetime

