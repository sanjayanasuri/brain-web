"""Data models for contextual branching (span-anchored clarification threads."""
from typing import Optional, List, Dict, Any
from datetime import datetime
from pydantic import BaseModel, Field
import hashlib


class AnchorSpan(BaseModel):
    """Represents a text span selection within a parent message."""
    start_offset: int = Field(..., description="Character offset where selection starts")
    end_offset: int = Field(..., description="Character offset where selection ends")
    selected_text: str = Field(..., description="The actual selected text")
    selected_text_hash: str = Field(..., description="SHA256 hash of selected text for idempotency")
    parent_message_id: str = Field(..., description="ID of the parent message containing this span")
    
    @classmethod
    def create(cls, start_offset: int, end_offset: int, selected_text: str, parent_message_id: str) -> "AnchorSpan":
        """Create an AnchorSpan with computed hash."""
        text_hash = hashlib.sha256(selected_text.encode('utf-8')).hexdigest()
        return cls(
            start_offset=start_offset,
            end_offset=end_offset,
            selected_text=selected_text,
            selected_text_hash=text_hash,
            parent_message_id=parent_message_id
        )


class BranchMessage(BaseModel):
    """A message within a branch thread."""
    id: str
    branch_id: str
    role: str = Field(..., description="'user' or 'assistant'")
    content: str
    timestamp: datetime
    created_at: Optional[datetime] = None


class BridgingHint(BaseModel):
    """A hint that bridges the clarified concept back to the original response."""
    id: str
    branch_id: str
    hint_text: str
    target_offset: int = Field(..., description="Character offset in parent message where this hint applies")
    created_at: datetime


class BridgingHintSet(BaseModel):
    """Collection of bridging hints for a branch."""
    branch_id: str
    hints: List[BridgingHint]
    created_at: datetime


class BranchThread(BaseModel):
    """A contextual branch thread anchored to a span in a parent message."""
    id: str
    anchor: AnchorSpan
    # Optional: non-text anchors (e.g., bbox lasso on ink canvas). Additive only.
    anchor_kind: str = Field(default="text_span", description="'text_span' (default) or 'anchor_ref'")
    anchor_ref: Optional[Dict[str, Any]] = Field(default=None, description="Unified AnchorRef JSON (if anchor_kind='anchor_ref')")
    anchor_snippet_data_url: Optional[str] = Field(default=None, description="Optional data URL preview for bbox anchors")
    messages: List[BranchMessage]
    bridging_hints: Optional[BridgingHintSet] = None
    created_at: datetime
    updated_at: datetime
    parent_message_id: str = Field(..., description="ID of parent message (same as anchor.parent_message_id)")
    parent_message_version: int = Field(default=1, description="Version of parent message when branch was created")
    is_archived: bool = Field(default=False, description="Whether this branch is archived")
    archived_at: Optional[datetime] = Field(default=None, description="When this branch was archived")
    chat_id: Optional[str] = Field(default=None, description="Chat session id for digest linkage")


class BranchCreateRequest(BaseModel):
    """Request to create a new branch from a text span."""
    parent_message_id: str
    parent_message_content: str = Field(..., description="Full content of parent message for context")
    start_offset: int
    end_offset: int
    selected_text: str
    chat_id: Optional[str] = Field(default=None, description="Chat session id for digest linkage")


class BranchMessageRequest(BaseModel):
    """Request to send a message in a branch."""
    content: str


class BranchResponse(BaseModel):
    """Response containing branch metadata and messages."""
    branch: BranchThread
    messages: List[BranchMessage]


class MessageBranchesResponse(BaseModel):
    """Response listing all branches for a message."""
    message_id: str
    branches: List[BranchThread]


class BridgingHintsResponse(BaseModel):
    """Response containing bridging hints."""
    branch_id: str
    hints: List[BridgingHint]
