from typing import Optional
from pydantic import BaseModel, Field
from fastapi import APIRouter, Depends, HTTPException

from auth import require_auth
from db_neo4j import get_neo4j_session
from services_web_reader import build_reader_view

router = APIRouter(prefix="/web", tags=["web-reader"])


class ReaderRequest(BaseModel):
    query: str = Field(..., min_length=2)
    url: Optional[str] = None
    doc_id: Optional[str] = None
    limit: int = 5


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
