"""
Content pipeline job handlers.

Phase 1 MVP:
- `extract_content` supports raw_text -> extracted_text (fast path).
- `analyze_content` creates a clearly-labeled heuristic analysis placeholder.
- `embed_content` and `upsert_graph_links` are best-effort stubs (no-ops for now).

All handlers must be idempotent and safe to retry.
"""

from __future__ import annotations

import logging
import time
from typing import List, Literal, Optional

from pydantic import BaseModel, Field

from services_content_pipeline_store import (
    get_content_item,
    insert_content_analysis_heuristic,
    update_content_item_status,
)

logger = logging.getLogger("brain_web")

JobType = Literal["extract_content", "analyze_content", "embed_content", "upsert_graph_links"]


class ContentPipelineJob(BaseModel):
    job_id: str
    job_type: JobType
    content_item_id: str
    user_id: str
    tenant_id: str
    attempt: int = 0
    created_at_s: float = Field(default_factory=lambda: time.time())


class FollowUpJob(BaseModel):
    job_type: JobType
    content_item_id: str
    user_id: str
    tenant_id: str
    delay_s: int = 0


def _heuristic_summary(text: str, *, max_chars: int) -> str:
    t = " ".join((text or "").strip().split())
    if len(t) <= max_chars:
        return t
    return t[: max_chars - 1].rstrip() + "…"


def handle_extract_content(job: ContentPipelineJob) -> List[FollowUpJob]:
    item = get_content_item(content_item_id=job.content_item_id)
    if not item:
        logger.info(f"[content_pipeline] extract_content: missing item {job.content_item_id}")
        return []

    # Idempotency: if already extracted/analyzed, do nothing.
    status = str(item.get("status") or "")
    if status in ("extracted", "extracted_partial", "analyzed"):
        return [FollowUpJob(job_type="analyze_content", content_item_id=job.content_item_id, user_id=job.user_id, tenant_id=job.tenant_id)]

    raw_text = (item.get("raw_text") or "").strip()
    if raw_text:
        update_content_item_status(content_item_id=job.content_item_id, status="extracted", extracted_text=raw_text)
    else:
        # No extraction implemented yet for URL/media — keep the item usable and retryable.
        update_content_item_status(content_item_id=job.content_item_id, status="extracted_partial")

    return [
        FollowUpJob(job_type="analyze_content", content_item_id=job.content_item_id, user_id=job.user_id, tenant_id=job.tenant_id)
    ]


def handle_analyze_content(job: ContentPipelineJob) -> List[FollowUpJob]:
    item = get_content_item(content_item_id=job.content_item_id)
    if not item:
        logger.info(f"[content_pipeline] analyze_content: missing item {job.content_item_id}")
        return []

    status = str(item.get("status") or "")
    if status == "analyzed":
        return [
            FollowUpJob(job_type="embed_content", content_item_id=job.content_item_id, user_id=job.user_id, tenant_id=job.tenant_id),
            FollowUpJob(job_type="upsert_graph_links", content_item_id=job.content_item_id, user_id=job.user_id, tenant_id=job.tenant_id),
        ]

    extracted_text = (item.get("extracted_text") or "").strip()
    if not extracted_text:
        # Nothing to analyze yet.
        return []

    summary_short = _heuristic_summary(extracted_text, max_chars=400)
    summary_long = _heuristic_summary(extracted_text, max_chars=2000)
    insert_content_analysis_heuristic(
        content_item_id=job.content_item_id,
        summary_short=summary_short,
        summary_long=summary_long,
    )
    update_content_item_status(content_item_id=job.content_item_id, status="analyzed")

    return [
        FollowUpJob(job_type="embed_content", content_item_id=job.content_item_id, user_id=job.user_id, tenant_id=job.tenant_id),
        FollowUpJob(job_type="upsert_graph_links", content_item_id=job.content_item_id, user_id=job.user_id, tenant_id=job.tenant_id),
    ]


def handle_embed_content(job: ContentPipelineJob) -> List[FollowUpJob]:
    # Best-effort stub; real embedding/upsert comes in Phase 3/4.
    return []


def handle_upsert_graph_links(job: ContentPipelineJob) -> List[FollowUpJob]:
    # Best-effort stub; real Neo4j upsert/linking comes in Phase 3.
    return []


def run_content_pipeline_job(job: ContentPipelineJob) -> List[FollowUpJob]:
    if job.job_type == "extract_content":
        return handle_extract_content(job)
    if job.job_type == "analyze_content":
        return handle_analyze_content(job)
    if job.job_type == "embed_content":
        return handle_embed_content(job)
    if job.job_type == "upsert_graph_links":
        return handle_upsert_graph_links(job)
    return []

