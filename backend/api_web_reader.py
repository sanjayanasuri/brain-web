from typing import Optional, Dict, Any, List
from uuid import uuid4
from pydantic import BaseModel, Field
from fastapi import APIRouter, Depends, HTTPException

from auth import require_auth
from db_neo4j import get_neo4j_session
from db_postgres import execute_query, execute_update
from services_web_reader import build_reader_view

router = APIRouter(prefix="/web", tags=["web-reader"])


class ReaderRequest(BaseModel):
    query: str = Field(..., min_length=2)
    url: Optional[str] = None
    doc_id: Optional[str] = None
    limit: int = 5


class ReaderAnnotationRequest(BaseModel):
    doc_id: Optional[str] = None
    url: Optional[str] = None
    chunk_id: Optional[str] = None
    annotation_type: str = Field(..., pattern="^(highlight|note|link_concept|save_memory)$")
    note: Optional[str] = None
    concept_id: Optional[str] = None
    metadata: Dict[str, Any] = Field(default_factory=dict)


@router.post("/reader")
def web_reader(payload: ReaderRequest, auth=Depends(require_auth), session=Depends(get_neo4j_session)):
    if not payload.url and not payload.doc_id:
        raise HTTPException(status_code=400, detail="Provide url or doc_id")

    return build_reader_view(
        session=session,
        user_id=str(auth.user_id),
        tenant_id=str(auth.tenant_id),
        query=payload.query,
        url=payload.url,
        doc_id=payload.doc_id,
        limit=payload.limit,
    )


@router.post("/reader/annotate")
def annotate_reader(payload: ReaderAnnotationRequest, auth=Depends(require_auth)):
    if not payload.doc_id and not payload.url:
        raise HTTPException(status_code=400, detail="Provide doc_id or url")

    ann_id = f"wra_{uuid4().hex[:12]}"
    execute_update(
        """
        INSERT INTO web_reader_annotations (
            id, user_id, tenant_id, doc_id, url, chunk_id, annotation_type, note, concept_id, metadata
        ) VALUES (
            %s, %s, %s, %s, %s, %s, %s, %s, %s, %s::jsonb
        )
        """,
        (
            ann_id,
            str(auth.user_id),
            str(auth.tenant_id),
            payload.doc_id,
            payload.url,
            payload.chunk_id,
            payload.annotation_type,
            payload.note,
            payload.concept_id,
            __import__("json").dumps(payload.metadata or {}),
        ),
    )
    return {"ok": True, "annotation_id": ann_id}


@router.get("/reader/annotations")
def list_reader_annotations(doc_id: Optional[str] = None, url: Optional[str] = None, limit: int = 50, auth=Depends(require_auth)) -> List[Dict[str, Any]]:
    rows = execute_query(
        """
        SELECT id, doc_id, url, chunk_id, annotation_type, note, concept_id, metadata, created_at
        FROM web_reader_annotations
        WHERE user_id=%s AND tenant_id=%s
          AND (%s IS NULL OR doc_id=%s)
          AND (%s IS NULL OR url=%s)
        ORDER BY created_at DESC
        LIMIT %s
        """,
        (str(auth.user_id), str(auth.tenant_id), doc_id, doc_id, url, url, max(1, min(limit, 200))),
    ) or []
    return rows
