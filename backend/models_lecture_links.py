from datetime import datetime
from typing import List, Optional, Literal

from pydantic import BaseModel, Field


SourceType = Literal["main_chat_event", "branch", "bridging_hint", "notes_entry"]
LinkMethod = Literal["keyword", "embedding", "hybrid"]


class LectureDocument(BaseModel):
    id: str
    title: Optional[str] = None
    source_uri: Optional[str] = None
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None


class LectureSection(BaseModel):
    id: str
    lecture_document_id: str
    section_index: int
    title: Optional[str] = None
    raw_text: str
    source_uri: Optional[str] = None
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None


class LectureLink(BaseModel):
    id: str
    chat_id: str
    source_type: SourceType
    source_id: str
    lecture_document_id: str
    lecture_section_id: str
    start_offset: int
    end_offset: int
    confidence_score: float = Field(ge=0.0, le=1.0)
    method: LinkMethod
    justification_text: str
    created_at: Optional[datetime] = None


class LectureLinkResolveRequest(BaseModel):
    chat_id: str
    source_type: SourceType
    source_id: str
    lecture_document_ids: Optional[List[str]] = None
    top_n: Optional[int] = Field(default=5, ge=1, le=20)


class LectureLinkResolveResponse(BaseModel):
    links: List[LectureLink]
    weak: bool = False


class LectureLinkFeedbackRequest(BaseModel):
    action: Literal["dismiss", "helpful"]


class LectureSectionResponse(BaseModel):
    section: LectureSection
