# Resource (image, PDF, link) models attached to concepts.
from typing import Optional, Dict, Any

from pydantic import BaseModel


class Resource(BaseModel):
    resource_id: str
    kind: str
    url: str
    title: Optional[str] = None
    mime_type: Optional[str] = None
    caption: Optional[str] = None
    source: Optional[str] = None
    metadata: Optional[Dict[str, Any]] = None
    created_at: Optional[str] = None
    ingestion_run_id: Optional[str] = None


class ResourceCreate(BaseModel):
    kind: str
    url: str
    title: Optional[str] = None
    mime_type: Optional[str] = None
    caption: Optional[str] = None
    source: Optional[str] = "upload"
    metadata: Optional[Dict[str, Any]] = None
    ingestion_run_id: Optional[str] = None
