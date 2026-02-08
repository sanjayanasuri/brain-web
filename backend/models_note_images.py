"""
Models for whiteboard/photo note ingestion (Phase D).

Additive only: does not affect existing lecture ingestion or PDF ingestion flows.
"""

from __future__ import annotations

from typing import Any, Dict, List, Literal, Optional

from pydantic import BaseModel, Field


class OCRBBox(BaseModel):
    """
    Bounding box for an OCR block.

    - unit="px": x/y/w/h are pixels in the original image coordinate space.
    - unit="pct": x/y/w/h are normalized 0..1 fractions of image width/height.
    """

    x: float
    y: float
    w: float
    h: float
    unit: Literal["px", "pct"] = "px"
    image_width: Optional[int] = None
    image_height: Optional[int] = None


class OCRBlock(BaseModel):
    text: str = ""
    bbox: OCRBBox
    confidence: Optional[float] = None


class NoteImageIngestRequest(BaseModel):
    """Request for ingesting a whiteboard/photo note image."""

    image_data: str = Field(..., description="Base64 data URL (data:image/...;base64,...)")
    title: Optional[str] = Field(default="Whiteboard Photo", description="Display title")
    domain: Optional[str] = None

    graph_id: Optional[str] = None
    branch_id: Optional[str] = None

    # Optional OCR signals from client-side OCR (tesseract.js) to avoid server dependencies.
    ocr_hint: Optional[str] = None
    ocr_engine: Optional[str] = Field(default=None, description='e.g. "tesseract.js"')
    ocr_blocks: Optional[List[OCRBlock]] = None


class NoteImageBlock(BaseModel):
    text: str
    confidence: Optional[float] = None
    bbox: Dict[str, Any]
    anchor: Dict[str, Any]
    quote_id: Optional[str] = None


class NoteImageIngestResponse(BaseModel):
    status: str = "ok"
    graph_id: str
    branch_id: str
    artifact_id: str
    image_url: str
    extracted_text: str
    blocks: List[NoteImageBlock] = Field(default_factory=list)
    warnings: List[str] = Field(default_factory=list)

