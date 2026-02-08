"""
Unified cross-modal primitives (ArtifactRef + AnchorRef) for incremental refactors.

Goal: provide a small, stable contract that can *wrap* existing entities
without renaming/migrating them yet.

This is intentionally additive: existing endpoints/models remain unchanged.
"""

from __future__ import annotations

from hashlib import sha256
import json
from typing import Annotated, Literal, Optional, Union

from pydantic import BaseModel, Field


ArtifactNamespace = Literal["neo4j", "postgres", "events", "frontend"]
ArtifactType = Literal[
    # Neo4j graph objects
    "artifact",
    "source_document",
    "quote",
    "claim",
    "concept",
    "lecture",
    "lecture_segment",
    "resource",
    # Relational / session objects
    "contextual_branch",
    "voice_session",
    "study_session",
    # UI/session timeline objects
    "chat_message",
    "voice_transcript_chunk",
]


class ArtifactRef(BaseModel):
    """
    Global reference to "something" the user can cite across modalities.

    - namespace/type/id identify the storage system + entity type.
    - graph_id/branch_id allow optional scoping when the entity is graph-bound.
    - version is for immutable views (e.g., chat message v3, PDF snapshot v2).
    """

    namespace: ArtifactNamespace
    type: ArtifactType
    id: str
    version: Optional[int] = None
    graph_id: Optional[str] = None
    branch_id: Optional[str] = None


# -----------------------
# Anchor selectors
# -----------------------


class TextOffsetsSelector(BaseModel):
    kind: Literal["text_offsets"] = "text_offsets"
    start_offset: int = Field(..., ge=0)
    end_offset: int = Field(..., gt=0)


class TextQuoteSelector(BaseModel):
    """
    Web-annotation style selector ("exact/prefix/suffix"), used by browser capture.
    """

    kind: Literal["text_quote"] = "text_quote"
    exact: str
    prefix: Optional[str] = ""
    suffix: Optional[str] = ""


class BBoxSelector(BaseModel):
    kind: Literal["bbox"] = "bbox"
    x: float
    y: float
    w: float
    h: float
    unit: Literal["px", "pct"] = "px"
    page: Optional[int] = None  # for PDFs
    image_width: Optional[int] = None
    image_height: Optional[int] = None


class TimeRangeSelector(BaseModel):
    kind: Literal["time_range"] = "time_range"
    start_ms: int = Field(..., ge=0)
    end_ms: int = Field(..., gt=0)


AnchorSelector = Annotated[
    Union[TextOffsetsSelector, TextQuoteSelector, BBoxSelector, TimeRangeSelector],
    Field(discriminator="kind"),
]


class AnchorRef(BaseModel):
    """
    Reference to an anchored span/region/time-range within an artifact.

    anchor_id is deterministic from (artifact_ref + selector).
    """

    anchor_id: str
    artifact: ArtifactRef
    selector: AnchorSelector
    preview: Optional[str] = None

    @classmethod
    def create(
        cls,
        *,
        artifact: ArtifactRef,
        selector: AnchorSelector,
        preview: Optional[str] = None,
    ) -> "AnchorRef":
        anchor_id = compute_anchor_id(artifact=artifact, selector=selector)
        return cls(anchor_id=anchor_id, artifact=artifact, selector=selector, preview=preview)


def _stable_json(value: object) -> str:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def compute_anchor_id(*, artifact: ArtifactRef, selector: AnchorSelector) -> str:
    """
    Compute a deterministic anchor id.

    This enables idempotent anchor creation across:
    - contextual branches (text offsets in chat messages)
    - browser capture (text quote selectors)
    - ink lasso / image regions (bbox)
    - voice transcript ranges (time ranges)
    """

    key_payload = {
        "artifact": artifact.model_dump(mode="json"),
        "selector": selector.model_dump(mode="json"),
    }
    digest = sha256(_stable_json(key_payload).encode("utf-8")).hexdigest()[:16].upper()
    return f"ANCH_{digest}"

