# Ingestion run tracking models.
from typing import Optional, List, Dict, Any

from pydantic import BaseModel


class IngestionRun(BaseModel):
    run_id: str
    graph_id: str
    source_type: str
    source_label: Optional[str] = None
    status: str
    started_at: str
    completed_at: Optional[str] = None
    summary_counts: Optional[Dict[str, int]] = None
    error_count: Optional[int] = None
    errors: Optional[List[str]] = None
    undone_at: Optional[str] = None
    undo_mode: Optional[str] = None
    undo_summary: Optional[Dict[str, Any]] = None
    restored_at: Optional[str] = None


class IngestionRunCreate(BaseModel):
    source_type: str
    source_label: Optional[str] = None
    created_at: str
    focused_node_id: Optional[str] = None
