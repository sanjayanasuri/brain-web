# PDF extraction and page models.
from datetime import datetime
from typing import Optional, List, Dict, Any

from pydantic import BaseModel, Field


class PDFMetadata(BaseModel):
    title: Optional[str] = None
    author: Optional[str] = None
    subject: Optional[str] = None
    creator: Optional[str] = None
    producer: Optional[str] = None
    creation_date: Optional[datetime] = None
    modification_date: Optional[datetime] = None
    page_count: int = 0
    is_scanned: bool = False
    has_tables: bool = False
    has_images: bool = False


class PDFPage(BaseModel):
    page_number: int
    text: str
    has_table: bool = False
    has_image: bool = False
    table_count: int = 0
    image_count: int = 0
    metadata: Dict[str, Any] = Field(default_factory=dict)


class PDFExtractionResult(BaseModel):
    full_text: str
    pages: List[PDFPage]
    metadata: PDFMetadata
    extraction_method: str
    warnings: List[str] = Field(default_factory=list)
    errors: List[str] = Field(default_factory=list)
