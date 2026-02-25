# Graph, branch, snapshot explorer models.
from typing import Optional, List, Dict, Any

from pydantic import BaseModel


class GraphSummary(BaseModel):
    graph_id: str
    name: Optional[str] = None
    description: Optional[str] = None
    created_at: Optional[str] = None
    updated_at: Optional[str] = None
    node_count: int = 0
    edge_count: int = 0
    template_id: Optional[str] = None
    template_label: Optional[str] = None
    template_description: Optional[str] = None
    template_tags: Optional[List[str]] = None
    intent: Optional[str] = None
    tenant_id: Optional[str] = None


class GraphCreateRequest(BaseModel):
    name: str
    template_id: Optional[str] = None
    template_label: Optional[str] = None
    template_description: Optional[str] = None
    template_tags: Optional[List[str]] = None
    intent: Optional[str] = None


class GraphRenameRequest(BaseModel):
    name: str


class GraphListResponse(BaseModel):
    graphs: List[GraphSummary]
    active_graph_id: str
    active_branch_id: str


class GraphSelectResponse(BaseModel):
    active_graph_id: str
    active_branch_id: str
    graph: Dict[str, Any]


class BranchSummary(BaseModel):
    branch_id: str
    graph_id: str
    name: Optional[str] = None
    created_at: Optional[str] = None
    updated_at: Optional[str] = None
    source_node_id: Optional[str] = None
    tenant_id: Optional[str] = None


class BranchCreateRequest(BaseModel):
    name: str


class BranchForkRequest(BaseModel):
    depth: int = 2


class BranchCompareResponse(BaseModel):
    graph_id: str
    branch_id: str
    other_branch_id: str
    node_ids_only_in_branch: List[str] = []
    node_ids_only_in_other: List[str] = []
    links_only_in_branch: List[Dict[str, Any]] = []
    links_only_in_other: List[Dict[str, Any]] = []


class BranchLLMCompareRequest(BaseModel):
    branch_id: str
    other_branch_id: str
    question: Optional[str] = None


class BranchLLMCompareResponse(BaseModel):
    similarities: List[str] = []
    differences: List[str] = []
    contradictions: List[str] = []
    missing_steps: List[str] = []
    recommendations: List[str] = []


class SnapshotCreateRequest(BaseModel):
    name: str
    focused_node_id: Optional[str] = None
    layout: Optional[Dict[str, Any]] = None


class SnapshotSummary(BaseModel):
    snapshot_id: str
    graph_id: str
    branch_id: str
    name: str


class SnapshotListResponse(BaseModel):
    snapshots: List[SnapshotSummary]


class SnapshotRestoreResponse(BaseModel):
    status: str
    restored_branch_id: Optional[str] = None
    graph_id: str
    snapshot_id: str
