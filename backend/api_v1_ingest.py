"""
Phase 1 ingestion API (unified content pipeline).

Endpoints:
- POST /v1/ingest/url
- POST /v1/ingest/text
- POST /v1/ingest/upload

All endpoints:
- Require authentication (JWT Bearer or X-API-Key)
- Apply per-user ingest rate limiting
- Create a ContentItem in `created` status
- Enqueue async jobs for extraction + analysis + embedding + graph upserts
"""

from __future__ import annotations

import logging
from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from pydantic import BaseModel, Field

from auth import require_auth
from config import INGEST_RATE_LIMIT_PER_MINUTE
from models_content_pipeline import ContentItemType
from services_content_pipeline_queue import enqueue_content_pipeline_job
from services_content_pipeline_store import create_content_item
from services_rate_limit import allow_fixed_window
from storage import save_file

logger = logging.getLogger("brain_web")

router = APIRouter(prefix="/v1/ingest", tags=["ingest"])


def _require_uuid(value: str, *, field_name: str) -> str:
    try:
        UUID(str(value))
        return str(value)
    except Exception:
        raise HTTPException(status_code=400, detail=f"Invalid {field_name} (expected UUID)")


def _enforce_ingest_rate_limit(*, tenant_id: str, user_id: str) -> None:
    allowed = allow_fixed_window(
        key=f"ingest:{tenant_id}:{user_id}",
        limit_per_min=int(INGEST_RATE_LIMIT_PER_MINUTE),
    )
    if not allowed:
        raise HTTPException(status_code=429, detail="Rate limited")


class IngestResponse(BaseModel):
    content_item_id: str


class IngestUrlRequest(BaseModel):
    url: str = Field(..., min_length=3)
    type_hint: Optional[ContentItemType] = None
    note: Optional[str] = None


@router.post("/url", response_model=IngestResponse)
def ingest_url(payload: IngestUrlRequest, auth: dict = Depends(require_auth)) -> IngestResponse:
    user_id = _require_uuid(str(auth.get("user_id")), field_name="user_id")
    tenant_id = str(auth.get("tenant_id") or "").strip()
    if not tenant_id:
        raise HTTPException(status_code=401, detail="Tenant context missing")

    _enforce_ingest_rate_limit(tenant_id=tenant_id, user_id=user_id)

    content_type = payload.type_hint or ContentItemType.article
    content_item_id = create_content_item(
        user_id=user_id,
        type=content_type.value,
        source_url=payload.url.strip(),
        source_platform=None,
        title=None,
        raw_text=(payload.note or None),
    )

    enqueue_content_pipeline_job(
        job_type="extract_content",
        content_item_id=content_item_id,
        user_id=user_id,
        tenant_id=tenant_id,
    )

    return IngestResponse(content_item_id=content_item_id)


class IngestTextRequest(BaseModel):
    text: str = Field(..., min_length=1)
    type: ContentItemType
    source_url: Optional[str] = None
    source_platform: Optional[str] = None
    title: Optional[str] = None
    note: Optional[str] = None


@router.post("/text", response_model=IngestResponse)
def ingest_text(payload: IngestTextRequest, auth: dict = Depends(require_auth)) -> IngestResponse:
    user_id = _require_uuid(str(auth.get("user_id")), field_name="user_id")
    tenant_id = str(auth.get("tenant_id") or "").strip()
    if not tenant_id:
        raise HTTPException(status_code=401, detail="Tenant context missing")

    _enforce_ingest_rate_limit(tenant_id=tenant_id, user_id=user_id)

    content_item_id = create_content_item(
        user_id=user_id,
        type=payload.type.value,
        source_url=payload.source_url.strip() if payload.source_url else None,
        source_platform=payload.source_platform.strip() if payload.source_platform else None,
        title=payload.title.strip() if payload.title else None,
        raw_text=payload.text,
    )

    enqueue_content_pipeline_job(
        job_type="extract_content",
        content_item_id=content_item_id,
        user_id=user_id,
        tenant_id=tenant_id,
    )

    return IngestResponse(content_item_id=content_item_id)


@router.post("/upload", response_model=IngestResponse)
async def ingest_upload(
    file: UploadFile = File(...),
    type: ContentItemType = Form(...),
    source_url: Optional[str] = Form(None),
    source_platform: Optional[str] = Form(None),
    title: Optional[str] = Form(None),
    auth: dict = Depends(require_auth),
) -> IngestResponse:
    user_id = _require_uuid(str(auth.get("user_id")), field_name="user_id")
    tenant_id = str(auth.get("tenant_id") or "").strip()
    if not tenant_id:
        raise HTTPException(status_code=401, detail="Tenant context missing")

    _enforce_ingest_rate_limit(tenant_id=tenant_id, user_id=user_id)

    content = await file.read()
    if not content:
        raise HTTPException(status_code=400, detail="Empty upload")

    url_path, _storage_path = save_file(content, file.filename or "upload", tenant_id=tenant_id)
    content_item_id = create_content_item(
        user_id=user_id,
        type=type.value,
        source_url=source_url.strip() if source_url else None,
        source_platform=source_platform.strip() if source_platform else None,
        title=title.strip() if title else None,
        raw_media_url=url_path,
    )

    enqueue_content_pipeline_job(
        job_type="extract_content",
        content_item_id=content_item_id,
        user_id=user_id,
        tenant_id=tenant_id,
    )

    return IngestResponse(content_item_id=content_item_id)

