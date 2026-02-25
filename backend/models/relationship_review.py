# Relationship review and proposed-edge models.
from typing import Optional, List

from pydantic import BaseModel, ConfigDict


class RelationshipEdge(BaseModel):
    src_node_id: str
    dst_node_id: str
    rel_type: str


class RelationshipReviewItem(BaseModel):
    model_config = ConfigDict(protected_namespaces=())

    src_node_id: str
    src_name: str
    dst_node_id: str
    dst_name: str
    rel_type: str
    confidence: float
    method: str
    rationale: Optional[str] = None
    source_id: Optional[str] = None
    chunk_id: Optional[str] = None
    claim_id: Optional[str] = None
    model_version: Optional[str] = None
    created_at: Optional[int] = None
    updated_at: Optional[int] = None
    reviewed_at: Optional[int] = None
    reviewed_by: Optional[str] = None


class RelationshipReviewListResponse(BaseModel):
    relationships: List[RelationshipReviewItem]
    total: int
    graph_id: str
    status: str


class RelationshipAcceptRequest(BaseModel):
    graph_id: Optional[str] = None
    edges: List[RelationshipEdge]
    reviewed_by: Optional[str] = None


class RelationshipRejectRequest(BaseModel):
    graph_id: Optional[str] = None
    edges: List[RelationshipEdge]
    reviewed_by: Optional[str] = None


class RelationshipEditRequest(BaseModel):
    graph_id: Optional[str] = None
    src_node_id: str
    dst_node_id: str
    old_rel_type: str
    new_rel_type: str
    reviewed_by: Optional[str] = None


class RelationshipReviewActionResponse(BaseModel):
    status: str
    action: str
    count: int
    graph_id: str
