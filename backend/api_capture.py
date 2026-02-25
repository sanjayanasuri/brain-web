"""Minimal capture inbox API for unified quick capture and promotion."""
from __future__ import annotations

import json
from datetime import datetime
from uuid import uuid4
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from auth import require_auth
from db_postgres import execute_query, execute_update
from db_neo4j import get_neo4j_session

router = APIRouter(prefix="/capture", tags=["capture"])


class CaptureCreateRequest(BaseModel):
    content: str = Field(..., min_length=2, max_length=10000)
    source: str = Field(default="text")  # text|voice|note|file
    metadata: Dict[str, Any] = Field(default_factory=dict)


class CaptureItem(BaseModel):
    id: str
    source: str
    content: str
    status: str
    metadata: Dict[str, Any] = Field(default_factory=dict)
    created_at: Optional[str] = None


class PromoteRequest(BaseModel):
    target: str = Field(..., pattern="^(task|concept|memory)$")
    title: Optional[str] = None


@router.post("", response_model=CaptureItem)
def create_capture(payload: CaptureCreateRequest, auth=Depends(require_auth)):
    cap_id = f"cap_{uuid4().hex[:12]}"
    now = datetime.utcnow().isoformat()
    execute_update(
        """
        INSERT INTO capture_inbox (id, user_id, tenant_id, source, content, status, metadata, created_at, updated_at)
        VALUES (%s, %s, %s, %s, %s, 'new', %s::jsonb, %s, %s)
        """,
        (
            cap_id,
            str(auth.user_id),
            str(auth.tenant_id),
            payload.source,
            payload.content,
            json.dumps(payload.metadata or {}),
            now,
            now,
        ),
    )
    return CaptureItem(
        id=cap_id,
        source=payload.source,
        content=payload.content,
        status="new",
        metadata=payload.metadata or {},
        created_at=now,
    )


@router.get("", response_model=List[CaptureItem])
def list_capture(status: str = "new", limit: int = 20, auth=Depends(require_auth)):
    rows = execute_query(
        """
        SELECT id, source, content, status, metadata, created_at
        FROM capture_inbox
        WHERE user_id=%s AND tenant_id=%s AND (%s='all' OR status=%s)
        ORDER BY created_at DESC
        LIMIT %s
        """,
        (str(auth.user_id), str(auth.tenant_id), status, status, max(1, min(limit, 100))),
    ) or []
    return [
        CaptureItem(
            id=r.get("id"),
            source=r.get("source"),
            content=r.get("content"),
            status=r.get("status"),
            metadata=r.get("metadata") or {},
            created_at=(r.get("created_at").isoformat() if hasattr(r.get("created_at"), "isoformat") else r.get("created_at")),
        )
        for r in rows
    ]


@router.post("/{capture_id}/promote")
def promote_capture(capture_id: str, payload: PromoteRequest, neo4j=Depends(get_neo4j_session), auth=Depends(require_auth)):
    rows = execute_query(
        "SELECT id, content, metadata FROM capture_inbox WHERE id=%s AND user_id=%s AND tenant_id=%s LIMIT 1",
        (capture_id, str(auth.user_id), str(auth.tenant_id)),
    ) or []
    if not rows:
        raise HTTPException(status_code=404, detail="Capture not found")

    item = rows[0]
    content = str(item.get("content") or "").strip()

    result: Dict[str, Any] = {"ok": True, "target": payload.target}

    if payload.target == "task":
        task_id = f"TASK_{uuid4().hex[:10]}"
        title = (payload.title or content[:120]).strip()
        now = datetime.utcnow().isoformat()
        neo4j.run(
            """
            CREATE (t:Task {
              id: $id,
              session_id: $session_id,
              tenant_id: $tenant_id,
              title: $title,
              notes: $notes,
              estimated_minutes: 45,
              priority: 'medium',
              energy: 'med',
              tags: ['capture'],
              dependencies: [],
              created_at: $created_at,
              updated_at: $updated_at
            })
            """,
            id=task_id,
            session_id="default",
            tenant_id=str(auth.tenant_id),
            title=title,
            notes=content,
            created_at=now,
            updated_at=now,
        )
        result.update({"task_id": task_id, "title": title})

    elif payload.target == "memory":
        # Soft promotion marker; memory engine can process this capture source later.
        result.update({"memory_marked": True})

    elif payload.target == "concept":
        # Minimal placeholder: mark as concept candidate for later concept extraction pipeline.
        result.update({"concept_candidate": True})

    execute_update(
        """
        UPDATE capture_inbox
        SET status='promoted',
            metadata = COALESCE(metadata, '{}'::jsonb) || %s::jsonb,
            updated_at=NOW()
        WHERE id=%s AND user_id=%s AND tenant_id=%s
        """,
        (json.dumps({"promoted_to": payload.target, **result}), capture_id, str(auth.user_id), str(auth.tenant_id)),
    )

    return result
