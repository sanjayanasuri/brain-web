# Concept and relationship request/response models.
from datetime import datetime
from typing import Optional, List

from pydantic import BaseModel


class Concept(BaseModel):
    node_id: str
    name: str
    domain: str
    type: str

    description: Optional[str] = None
    tags: Optional[List[str]] = None
    notes_key: Optional[str] = None
    node_key: Optional[str] = None
    url_slug: Optional[str] = None

    tenant_id: Optional[str] = None
    graph_id: Optional[str] = None

    mastery_level: int = 0
    last_assessed: Optional[datetime] = None

    lecture_sources: List[str] = []
    created_by: Optional[str] = None
    last_updated_by: Optional[str] = None
    created_by_run_id: Optional[str] = None
    last_updated_by_run_id: Optional[str] = None
    aliases: List[str] = []


class ConceptCreate(BaseModel):
    name: str
    domain: str
    type: str = "concept"
    description: Optional[str] = None
    tags: Optional[List[str]] = None
    notes_key: Optional[str] = None
    lecture_key: Optional[str] = None
    url_slug: Optional[str] = None
    aliases: Optional[List[str]] = None

    lecture_sources: Optional[List[str]] = None
    created_by: Optional[str] = None
    last_updated_by: Optional[str] = None
    created_by_run_id: Optional[str] = None
    last_updated_by_run_id: Optional[str] = None


class ConceptUpdate(BaseModel):
    description: Optional[str] = None
    tags: Optional[List[str]] = None
    domain: Optional[str] = None
    type: Optional[str] = None
    aliases: Optional[List[str]] = None


class RelationshipCreate(BaseModel):
    source_name: str
    predicate: str
    target_name: str
