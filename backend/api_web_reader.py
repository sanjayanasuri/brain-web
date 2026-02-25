from typing import Optional, Dict, Any, List
from uuid import uuid4
import re
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
    annotation_type: str = Field(..., pattern="^(highlight|note|link_concept|save_memory|check_result|explain_thread)$")
    note: Optional[str] = None
    concept_id: Optional[str] = None
    metadata: Dict[str, Any] = Field(default_factory=dict)


class ReaderCheckRequest(BaseModel):
    query: str
    snippet_text: str
    user_answer: str
    doc_id: Optional[str] = None
    url: Optional[str] = None


class ReaderExplainRequest(BaseModel):
    query: str
    snippet_text: str
    question: Optional[str] = None
    doc_id: Optional[str] = None
    url: Optional[str] = None


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


def _key_terms(text: str, limit: int = 8) -> List[str]:
    stop = {"the","and","for","with","that","this","from","into","about","have","your","their","what","when","where","while","were","been","also","will","just","than","them","they","then"}
    toks = re.findall(r"[a-zA-Z][a-zA-Z0-9_\-]{2,}", (text or "").lower())
    freq: Dict[str, int] = {}
    for t in toks:
        if t in stop:
            continue
        freq[t] = freq.get(t, 0) + 1
    ranked = sorted(freq.items(), key=lambda kv: kv[1], reverse=True)
    return [k for k, _ in ranked[:limit]]


@router.post("/reader/check")
def check_understanding(payload: ReaderCheckRequest, auth=Depends(require_auth)) -> Dict[str, Any]:
    expected = _key_terms(payload.snippet_text, limit=8)
    ans_terms = set(_key_terms(payload.user_answer, limit=20))
    overlap = len(set(expected) & ans_terms)
    ratio = overlap / max(1, len(expected))

    if ratio >= 0.35:
        verdict = "correct"
        feedback = "Nice — you captured the core idea well."
    elif ratio >= 0.18:
        verdict = "partial"
        feedback = "You’re close. You got part of it, but missed a key point."
    else:
        verdict = "incorrect"
        feedback = "Not quite yet. Let’s tighten the core concept."

    execute_update(
        """
        INSERT INTO web_reader_annotations (id, user_id, tenant_id, doc_id, url, chunk_id, annotation_type, note, metadata)
        VALUES (%s, %s, %s, %s, %s, NULL, 'check_result', %s, %s::jsonb)
        """,
        (
            f"wra_{uuid4().hex[:12]}",
            str(auth.user_id),
            str(auth.tenant_id),
            payload.doc_id,
            payload.url,
            f"{verdict}: {payload.user_answer[:240]}",
            __import__("json").dumps({"query": payload.query, "ratio": ratio, "expected_terms": expected[:6]}),
        ),
    )

    return {
        "verdict": verdict,
        "feedback": feedback,
        "score": ratio,
        "expected_terms": expected[:6],
        "next_prompt": "Explain this snippet in one sentence as if teaching a friend.",
    }


@router.post("/reader/explain")
def explain_snippet(payload: ReaderExplainRequest, auth=Depends(require_auth), session=Depends(get_neo4j_session)) -> Dict[str, Any]:
    reader = build_reader_view(
        session=session,
        user_id=str(auth.user_id),
        tenant_id=str(auth.tenant_id),
        query=payload.query,
        url=payload.url,
        doc_id=payload.doc_id,
        limit=3,
    )

    context_bits = []
    for s in (reader.get("snippets") or [])[:2]:
        context_bits.append((s.get("text") or "")[:220])

    q = (payload.question or "").strip()
    explanation = (
        "Here’s the key idea from this section:\n\n"
        f"{payload.snippet_text[:420]}\n\n"
        "In context of the article, this matters because:\n"
        + ("\n".join([f"- {b}" for b in context_bits]) if context_bits else "- it supports the article’s main claim.")
    )
    if q:
        explanation += f"\n\nAbout your question: {q}\nThink of it as connecting this local claim to the broader argument and your current focus ({payload.query})."

    execute_update(
        """
        INSERT INTO web_reader_annotations (id, user_id, tenant_id, doc_id, url, chunk_id, annotation_type, note, metadata)
        VALUES (%s, %s, %s, %s, %s, NULL, 'explain_thread', %s, %s::jsonb)
        """,
        (
            f"wra_{uuid4().hex[:12]}",
            str(auth.user_id),
            str(auth.tenant_id),
            payload.doc_id,
            payload.url,
            (q or payload.snippet_text[:220]),
            __import__("json").dumps({"query": payload.query}),
        ),
    )

    return {"explanation": explanation}
