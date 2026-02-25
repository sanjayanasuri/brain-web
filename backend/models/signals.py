# Learning state engine signal models.
from typing import Optional, List, Dict, Any

from pydantic import BaseModel, Field
from enum import Enum


class SignalType(str, Enum):
    TEXT_AUTHORING = "TEXT_AUTHORING"
    SPAN_LINK = "SPAN_LINK"
    EMPHASIS = "EMPHASIS"
    FILE_INGESTION = "FILE_INGESTION"
    VOICE_CAPTURE = "VOICE_CAPTURE"
    VOICE_COMMAND = "VOICE_COMMAND"
    QUESTION = "QUESTION"
    TIME = "TIME"
    ASSESSMENT = "ASSESSMENT"
    VOICE_CONVERSATION = "VOICE_CONVERSATION"


class Signal(BaseModel):
    signal_id: str
    signal_type: SignalType
    timestamp: int
    graph_id: str
    branch_id: str
    document_id: Optional[str] = None
    block_id: Optional[str] = None
    concept_id: Optional[str] = None
    payload: Dict[str, Any] = Field(default_factory=dict)
    session_id: Optional[str] = None
    user_id: Optional[str] = None
    created_at: Optional[str] = None


class TextAuthoringSignal(BaseModel):
    block_id: str
    text: str
    block_type: Optional[str] = None
    document_id: Optional[str] = None


class SpanLinkSignal(BaseModel):
    block_id: str
    start_offset: int
    end_offset: int
    surface_text: str
    concept_id: str
    context_note: Optional[str] = None
    document_id: Optional[str] = None


class EmphasisSignal(BaseModel):
    block_id: str
    start_offset: int
    end_offset: int
    emphasis_type: str
    text: str
    document_id: Optional[str] = None


class FileIngestionSignal(BaseModel):
    file_id: str
    file_type: str
    file_name: str
    document_id: Optional[str] = None
    metadata: Optional[Dict[str, Any]] = None


class VoiceCaptureSignal(BaseModel):
    transcript: str
    block_id: Optional[str] = None
    concept_id: Optional[str] = None
    classification: Optional[str] = None
    document_id: Optional[str] = None


class VoiceCommandSignal(BaseModel):
    transcript: str
    intent: str
    params: Optional[Dict[str, Any]] = None
    task_id: Optional[str] = None
    document_id: Optional[str] = None
    block_id: Optional[str] = None
    concept_id: Optional[str] = None


class QuestionSignal(BaseModel):
    question: str
    context_block_id: Optional[str] = None
    context_concept_id: Optional[str] = None


class TimeSignal(BaseModel):
    document_id: Optional[str] = None
    block_id: Optional[str] = None
    concept_id: Optional[str] = None
    duration_ms: int
    action: str


class AssessmentSignal(BaseModel):
    assessment_id: str
    assessment_type: str
    question_id: Optional[str] = None
    question_text: str
    required_concepts: List[str] = []
    user_answer: Optional[str] = None
    correct: Optional[bool] = None


class SignalCreate(BaseModel):
    signal_type: SignalType
    document_id: Optional[str] = None
    block_id: Optional[str] = None
    concept_id: Optional[str] = None
    payload: Dict[str, Any] = Field(default_factory=dict)
    session_id: Optional[str] = None


class SignalListResponse(BaseModel):
    signals: List[Signal]
    total: int
