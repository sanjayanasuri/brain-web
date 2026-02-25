# Artifact (webpage) ingestion and graph preview models.
from typing import Optional, List, Dict, Any, Literal

from pydantic import BaseModel, Field


class Artifact(BaseModel):
    artifact_id: str
    graph_id: str
    branch_id: str
    artifact_type: Literal["webpage"]
    url: str
    title: Optional[str] = None
    domain: Optional[str] = None
    captured_at: int
    content_hash: str
    text: str
    metadata: Dict[str, Any] = Field(default_factory=dict)
    created_by_run_id: Optional[str] = None


class WebpageIngestRequest(BaseModel):
    url: str
    graph_id: str
    branch_id: str
    title: Optional[str] = None
    domain: Optional[str] = None
    text: str
    metadata: Optional[Dict[str, Any]] = None
    extract_claims: bool = False


class WebpageIngestResponse(BaseModel):
    artifact_id: str
    reused_existing: bool
    run_id: Optional[str] = None
    counts: Dict[str, int] = Field(default_factory=dict)


class ArtifactGraphPreview(BaseModel):
    id: str
    type: str = "artifact"
    url: str
    title: Optional[str] = None
    domain: Optional[str] = None


class ConceptGraphPreview(BaseModel):
    id: str
    type: str = "concept"
    name: str
    domain: Optional[str] = None
    description: Optional[str] = None


class GraphEdgePreview(BaseModel):
    source: str
    target: str
    type: str
    status: Optional[str] = None


class ArtifactViewResponse(BaseModel):
    artifact: Dict[str, Any]
    concepts: List[ConceptGraphPreview]
    nodes: List[Dict[str, Any]]
    edges: List[GraphEdgePreview]
