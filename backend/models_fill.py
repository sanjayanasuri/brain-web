"""
Models for the /fill command router (Phase E).

Additive only: does not affect existing chat/retrieval endpoints.
"""

from __future__ import annotations

from typing import Any, Dict, List, Literal, Optional

from pydantic import BaseModel, Field


FillKind = Literal["diagram", "link", "web", "unknown"]


class FillRequest(BaseModel):
    """
    Request to run a /fill command.

    command may be either:
    - Full user message starting with "/fill ..."
    - The command body after "/fill"
    """

    command: str = Field(..., description="Fill command string")
    graph_id: Optional[str] = None
    branch_id: Optional[str] = None
    limit: int = Field(default=5, ge=1, le=20)


class FillResponse(BaseModel):
    status: Literal["ok", "error"] = "ok"
    kind: FillKind = "unknown"
    artifact_id: Optional[str] = None
    answer: str = ""
    data: Dict[str, Any] = Field(default_factory=dict)
    warnings: List[str] = Field(default_factory=list)

