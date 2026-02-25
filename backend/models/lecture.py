# Lecture, ingestion, segments, and related request/response models.
from datetime import datetime
from typing import Optional, List, Dict, Any

from pydantic import BaseModel

from .concept import Concept


class Lecture(BaseModel):
    lecture_id: str
    title: str
    description: Optional[str] = None
    primary_concept: Optional[str] = None
    level: Optional[str] = None
    estimated_time: Optional[int] = None
    slug: Optional[str] = None
    raw_text: Optional[str] = None
    metadata_json: Optional[str] = None
    annotations: Optional[str] = None
    segment_count: Optional[int] = None


class LectureCreate(BaseModel):
    title: str
    description: Optional[str] = None
    primary_concept: Optional[str] = None
    level: Optional[str] = None
    estimated_time: Optional[int] = None
    slug: Optional[str] = None
    raw_text: Optional[str] = None
    metadata_json: Optional[str] = None
    annotations: Optional[str] = None


class LectureUpdate(BaseModel):
    title: Optional[str] = None
    raw_text: Optional[str] = None
    metadata_json: Optional[str] = None
    annotations: Optional[str] = None


class NotebookPage(BaseModel):
    page_id: str
    lecture_id: str
    page_number: int
    content: str
    ink_data: List[Dict[str, Any]]
    paper_type: str = "ruled"
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None


class NotebookPageUpdate(BaseModel):
    content: Optional[str] = None
    ink_data: Optional[List[Dict[str, Any]]] = None
    paper_type: Optional[str] = None


class LectureStepCreate(BaseModel):
    concept_id: str
    step_order: int


class LectureStep(BaseModel):
    lecture_id: str
    step_order: int
    concept: Concept


class ExtractedNode(BaseModel):
    name: str
    description: Optional[str] = None
    domain: Optional[str] = None
    type: Optional[str] = "concept"
    examples: List[str] = []
    tags: List[str] = []
    aliases: List[str] = []


class ExtractedLink(BaseModel):
    source_name: str
    target_name: str
    predicate: str
    explanation: Optional[str] = None
    confidence: float = 0.8


class HierarchicalTopic(BaseModel):
    name: str
    concepts: List[str] = []
    subtopics: List["HierarchicalTopic"] = []


HierarchicalTopic.model_rebuild()


class LectureExtraction(BaseModel):
    lecture_title: str
    nodes: List[ExtractedNode]
    links: List[ExtractedLink]
    structure: Optional[List[HierarchicalTopic]] = None


class LectureIngestRequest(BaseModel):
    lecture_title: str
    lecture_text: str
    domain: Optional[str] = None


class HandwritingIngestRequest(BaseModel):
    image_data: str
    ocr_hint: Optional[str] = None
    lecture_title: Optional[str] = "Handwritten Notes"
    domain: Optional[str] = None


class FreeformCanvasCaptureRequest(BaseModel):
    canvas_id: str
    canvas_title: str = "Freeform Canvas"
    domain: Optional[str] = None
    strokes_json: str
    text_blocks_json: str
    drawing_blocks_json: Optional[str] = None
    phases_json: Optional[str] = None
    ocr_hint: Optional[str] = None


class Analogy(BaseModel):
    analogy_id: str
    label: str
    description: Optional[str] = None
    tags: Optional[List[str]] = None


class LectureSegment(BaseModel):
    segment_id: str
    lecture_id: str
    segment_index: int
    start_time_sec: Optional[float] = None
    end_time_sec: Optional[float] = None
    text: str
    summary: Optional[str] = None
    style_tags: Optional[List[str]] = None
    covered_concepts: List[Concept] = []
    analogies: List[Analogy] = []
    lecture_title: Optional[str] = None
    ink_url: Optional[str] = None


class LectureSegmentUpdate(BaseModel):
    text: Optional[str] = None
    summary: Optional[str] = None
    start_time_sec: Optional[float] = None
    end_time_sec: Optional[float] = None
    style_tags: Optional[List[str]] = None


class LectureBlock(BaseModel):
    block_id: str
    lecture_id: str
    block_index: int
    block_type: str
    text: str
    bbox: Optional[Dict[str, float]] = None


class LectureBlockUpsert(BaseModel):
    block_id: Optional[str] = None
    block_index: int
    block_type: str
    text: str
    bbox: Optional[Dict[str, float]] = None


class LectureBlocksUpsertRequest(BaseModel):
    blocks: List[LectureBlockUpsert]


class LectureMention(BaseModel):
    mention_id: str
    lecture_id: str
    block_id: str
    start_offset: int
    end_offset: int
    surface_text: str
    concept: Concept
    context_note: Optional[str] = None
    sense_label: Optional[str] = None
    lecture_title: Optional[str] = None
    block_text: Optional[str] = None


class LectureMentionCreate(BaseModel):
    lecture_id: str
    block_id: str
    start_offset: int
    end_offset: int
    surface_text: str
    concept_id: str
    context_note: Optional[str] = None
    sense_label: Optional[str] = None


class LectureMentionUpdate(BaseModel):
    concept_id: Optional[str] = None
    start_offset: Optional[int] = None
    end_offset: Optional[int] = None
    surface_text: Optional[str] = None
    context_note: Optional[str] = None
    sense_label: Optional[str] = None


class LectureIngestResult(BaseModel):
    lecture_id: str
    nodes_created: List[Concept]
    nodes_updated: List[Concept]
    links_created: List[dict]
    segments: List[LectureSegment] = []
    run_id: Optional[str] = None
    created_concept_ids: List[str] = []
    updated_concept_ids: List[str] = []
    created_relationship_count: int = 0
    created_claim_ids: List[str] = []
    reused_existing: bool = False


class FreeformCanvasCaptureResponse(BaseModel):
    lecture_id: str
    nodes_created: List[Concept]
    nodes_updated: List[Concept]
    links_created: List[dict]
    segments: List[LectureSegment] = []
    transcript: str
    run_id: str
