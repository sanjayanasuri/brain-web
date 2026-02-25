# Entity merge review models.
from typing import Optional, List, Dict, Any

from pydantic import BaseModel


class MergeCandidateItem(BaseModel):
    candidate_id: str
    score: float
    method: str
    rationale: str
    status: str
    created_at: Optional[int] = None
    updated_at: Optional[int] = None
    reviewed_at: Optional[int] = None
    reviewed_by: Optional[str] = None
    src_concept: Dict[str, Any]
    dst_concept: Dict[str, Any]


class MergeCandidateListResponse(BaseModel):
    candidates: List[MergeCandidateItem]
    total: int
    graph_id: str
    status: str


class MergeCandidateAcceptRequest(BaseModel):
    graph_id: str
    candidate_ids: List[str]
    reviewed_by: Optional[str] = None


class MergeCandidateRejectRequest(BaseModel):
    graph_id: str
    candidate_ids: List[str]
    reviewed_by: Optional[str] = None


class MergeExecuteRequest(BaseModel):
    graph_id: str
    keep_node_id: str
    merge_node_id: str
    reviewed_by: Optional[str] = None


class MergeExecuteResponse(BaseModel):
    status: str
    keep_node_id: str
    merge_node_id: str
    relationships_redirected: int
    relationships_skipped: int
    relationships_deleted: int
    graph_id: str
