"""Reader/relevance service for ingested web documents."""
from __future__ import annotations

from typing import Any, Dict, List, Optional
import re

from db_postgres import execute_query
from services_search import embed_text, cosine_similarity
from services_branch_explorer import ensure_graph_scoping_initialized, get_active_graph_context


def _tokenize(text: str) -> set[str]:
    return set(re.findall(r"[a-zA-Z][a-zA-Z0-9_\-]{2,}", (text or "").lower()))


def _interest_terms(user_id: str, tenant_id: str, limit: int = 12) -> List[str]:
    rows = execute_query(
        "SELECT profile_json FROM interest_profiles WHERE user_id=%s AND tenant_id=%s LIMIT 1",
        (str(user_id), str(tenant_id)),
    ) or []
    if not rows:
        return []
    profile = rows[0].get("profile_json") or {}
    kws = profile.get("keywords") or []
    return [str(k.get("term")) for k in kws[:limit] if k.get("term")]


def _memory_terms(user_id: str, tenant_id: str, limit: int = 8) -> List[str]:
    rows = execute_query(
        """
        SELECT fact_value
        FROM user_profile_facts
        WHERE user_id=%s AND tenant_id=%s AND active=TRUE
        ORDER BY confidence DESC, updated_at DESC
        LIMIT %s
        """,
        (str(user_id), str(tenant_id), limit),
    ) or []
    return [str(r.get("fact_value") or "") for r in rows if r.get("fact_value")]


def _fetch_document_and_chunks(session, *, url: Optional[str], doc_id: Optional[str]) -> Dict[str, Any]:
    ensure_graph_scoping_initialized(session)
    graph_id, _ = get_active_graph_context(session)

    if doc_id:
        doc_q = """
        MATCH (d:SourceDocument {graph_id: $graph_id, doc_id: $doc_id})
        RETURN d.doc_id AS doc_id, d.url AS url, d.metadata AS metadata, d.status AS status
        LIMIT 1
        """
        doc_rec = session.run(doc_q, graph_id=graph_id, doc_id=doc_id).single()
    else:
        doc_q = """
        MATCH (d:SourceDocument {graph_id: $graph_id})
        WHERE d.url = $url
        RETURN d.doc_id AS doc_id, d.url AS url, d.metadata AS metadata, d.status AS status
        ORDER BY d.updated_at DESC
        LIMIT 1
        """
        doc_rec = session.run(doc_q, graph_id=graph_id, url=url).single()

    if not doc_rec:
        return {"doc": None, "chunks": []}

    d = doc_rec.data()
    chunk_q = """
    MATCH (d:SourceDocument {graph_id: $graph_id, doc_id: $doc_id})
    OPTIONAL MATCH (s:SourceChunk {graph_id: $graph_id})-[:FROM_DOCUMENT]->(d)
    OPTIONAL MATCH (c:Claim {graph_id: $graph_id})-[:SUPPORTED_BY]->(s)
    RETURN s.chunk_id AS chunk_id,
           s.text AS text,
           collect(DISTINCT c.claim) AS claims
    LIMIT 200
    """
    rows = session.run(chunk_q, graph_id=graph_id, doc_id=d.get("doc_id"))
    chunks = []
    for r in rows:
        text = r.get("text")
        if not text:
            continue
        chunks.append({
            "chunk_id": r.get("chunk_id"),
            "text": text,
            "claims": [c for c in (r.get("claims") or []) if c],
        })
    return {"doc": d, "chunks": chunks}


def _score_snippet(*, query: str, text: str, query_vec: Optional[List[float]], text_vec: Optional[List[float]], interest_terms: List[str], memory_terms: List[str], rank_idx: int) -> Dict[str, float]:
    q_tokens = _tokenize(query)
    t_tokens = _tokenize(text)
    overlap = len(q_tokens & t_tokens) / max(1, len(q_tokens))

    sem = 0.0
    if query_vec is not None and text_vec is not None:
        sem = max(0.0, min(1.0, cosine_similarity(query_vec, text_vec)))

    interest_overlap = 0.0
    if interest_terms:
        i_hits = sum(1 for t in interest_terms if t.lower() in text.lower())
        interest_overlap = min(1.0, i_hits / max(1, min(6, len(interest_terms))))

    memory_overlap = 0.0
    if memory_terms:
        m_hits = sum(1 for t in memory_terms if t and t.lower() in text.lower())
        memory_overlap = min(1.0, m_hits / max(1, min(5, len(memory_terms))))

    recency_proxy = max(0.0, 1.0 - 0.08 * rank_idx)

    score = 0.35 * sem + 0.25 * overlap + 0.20 * interest_overlap + 0.10 * memory_overlap + 0.10 * recency_proxy
    return {
        "score": max(0.0, min(1.0, score)),
        "semantic": sem,
        "query_match": overlap,
        "interest_match": interest_overlap,
        "memory_match": memory_overlap,
        "recency": recency_proxy,
    }


def build_reader_view(*, session, user_id: str, tenant_id: str, query: str, url: Optional[str] = None, doc_id: Optional[str] = None, limit: int = 5) -> Dict[str, Any]:
    fetched = _fetch_document_and_chunks(session, url=url, doc_id=doc_id)
    doc = fetched.get("doc")
    chunks = fetched.get("chunks") or []

    if not doc:
        return {
            "found": False,
            "reason": "Document not found in ingested sources",
            "scoring_policy": "R=0.35 semantic + 0.25 query + 0.20 interest + 0.10 memory + 0.10 recency",
            "snippets": [],
        }

    interest_terms = _interest_terms(user_id, tenant_id)
    memory_terms = _memory_terms(user_id, tenant_id)
    q_vec = embed_text(query) if query else None

    scored = []
    for i, c in enumerate(chunks):
        text = str(c.get("text") or "").strip()
        if len(text) < 20:
            continue
        t_vec = embed_text(text[:1200]) if q_vec is not None else None
        s = _score_snippet(
            query=query,
            text=text,
            query_vec=q_vec,
            text_vec=t_vec,
            interest_terms=interest_terms,
            memory_terms=memory_terms,
            rank_idx=i,
        )
        scored.append({
            "chunk_id": c.get("chunk_id"),
            "text": text,
            "claims": c.get("claims") or [],
            "score": s["score"],
            "breakdown": s,
            "why": [
                "matches your query" if s["query_match"] > 0.1 else None,
                "aligned with your interests" if s["interest_match"] > 0.1 else None,
                "aligned with your memory/profile" if s["memory_match"] > 0.1 else None,
            ],
        })

    scored.sort(key=lambda x: x["score"], reverse=True)
    top = scored[: max(1, min(limit, 12))]
    for t in top:
        t["why"] = [w for w in t["why"] if w]

    relevance = (sum(x["score"] for x in top) / len(top)) if top else 0.0

    return {
        "found": True,
        "document": {
            "doc_id": doc.get("doc_id"),
            "url": doc.get("url"),
            "title": (doc.get("metadata") or {}).get("title") if isinstance(doc.get("metadata"), dict) else None,
            "status": doc.get("status"),
        },
        "relevance": relevance,
        "scoring_policy": "R=0.35 semantic + 0.25 query + 0.20 interest + 0.10 memory + 0.10 recency",
        "snippets": top,
        "interest_terms": interest_terms[:8],
    }
