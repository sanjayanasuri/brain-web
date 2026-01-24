"""Lecture context linking service (Postgres-backed)."""
import json
import os
import re
import uuid
from dataclasses import dataclass
from datetime import datetime
from difflib import SequenceMatcher
from typing import Any, Dict, List, Optional, Tuple

try:
    import psycopg2
    from psycopg2.extras import RealDictCursor
    from psycopg2.pool import ThreadedConnectionPool
    PSYCOPG2_AVAILABLE = True
except ImportError:
    PSYCOPG2_AVAILABLE = False
    class ThreadedConnectionPool:
        def __init__(self, *args, **kwargs):
            pass
        def getconn(self):
            raise ImportError("psycopg2 not installed")
        def putconn(self, conn):
            pass
    RealDictCursor = None

from config import POSTGRES_CONNECTION_STRING
from events.store import get_event_store
from models_lecture_links import LectureLink, LectureSection

try:
    from services_logging import log_event
except ImportError:
    def log_event(event_type: str, data: dict):
        print(f"[Event] {event_type}: {data}")

try:
    from services_search import embed_text, cosine_similarity
    EMBEDDINGS_AVAILABLE = True
except Exception:
    EMBEDDINGS_AVAILABLE = False


DEFAULT_TOP_N = 5
MAX_SECTION_CHARS = 20000
MAX_CHUNK_CHARS = 2000
CHUNK_OVERLAP = 200
WEAK_CONFIDENCE_THRESHOLD = 0.55

_pool: Optional[ThreadedConnectionPool] = None


def _get_pool() -> ThreadedConnectionPool:
    if not PSYCOPG2_AVAILABLE:
        raise ImportError("psycopg2-binary is required for lecture linking")
    global _pool
    if _pool is None:
        _pool = ThreadedConnectionPool(1, 10, POSTGRES_CONNECTION_STRING)
    return _pool


def _init_db() -> None:
    if not PSYCOPG2_AVAILABLE:
        return
    pool = _get_pool()
    conn = pool.getconn()
    try:
        with conn.cursor() as cur:
            cur.execute("""
                CREATE TABLE IF NOT EXISTS lecture_documents (
                    id TEXT PRIMARY KEY,
                    title TEXT,
                    source_uri TEXT,
                    created_at TIMESTAMPTZ DEFAULT NOW(),
                    updated_at TIMESTAMPTZ DEFAULT NOW()
                );
            """)
            cur.execute("""
                CREATE TABLE IF NOT EXISTS lecture_sections (
                    id TEXT PRIMARY KEY,
                    lecture_document_id TEXT NOT NULL REFERENCES lecture_documents(id) ON DELETE CASCADE,
                    section_index INTEGER NOT NULL,
                    title TEXT,
                    raw_text TEXT NOT NULL,
                    source_uri TEXT,
                    created_at TIMESTAMPTZ DEFAULT NOW(),
                    updated_at TIMESTAMPTZ DEFAULT NOW()
                );
            """)
            cur.execute("""
                CREATE INDEX IF NOT EXISTS idx_lecture_sections_doc
                ON lecture_sections (lecture_document_id, section_index);
            """)
            cur.execute("""
                CREATE TABLE IF NOT EXISTS lecture_links (
                    id TEXT PRIMARY KEY,
                    chat_id TEXT NOT NULL,
                    source_type TEXT NOT NULL CHECK (source_type IN ('main_chat_event', 'branch', 'bridging_hint', 'notes_entry')),
                    source_id TEXT NOT NULL,
                    lecture_document_id TEXT NOT NULL REFERENCES lecture_documents(id) ON DELETE CASCADE,
                    lecture_section_id TEXT NOT NULL REFERENCES lecture_sections(id) ON DELETE CASCADE,
                    start_offset INTEGER NOT NULL,
                    end_offset INTEGER NOT NULL,
                    confidence_score REAL DEFAULT 0.0,
                    method TEXT NOT NULL CHECK (method IN ('keyword', 'embedding', 'hybrid')),
                    justification_text TEXT,
                    created_at TIMESTAMPTZ DEFAULT NOW(),
                    UNIQUE (chat_id, source_type, source_id, lecture_section_id, start_offset, end_offset)
                );
            """)
            cur.execute("""
                CREATE INDEX IF NOT EXISTS idx_lecture_links_source
                ON lecture_links (chat_id, source_type, source_id);
            """)
            cur.execute("""
                CREATE TABLE IF NOT EXISTS lecture_link_feedback (
                    id TEXT PRIMARY KEY,
                    lecture_link_id TEXT NOT NULL REFERENCES lecture_links(id) ON DELETE CASCADE,
                    action TEXT NOT NULL CHECK (action IN ('dismiss', 'helpful')),
                    created_at TIMESTAMPTZ DEFAULT NOW()
                );
            """)
            cur.execute("""
                CREATE INDEX IF NOT EXISTS idx_lecture_link_feedback_link
                ON lecture_link_feedback (lecture_link_id);
            """)
            conn.commit()
    except Exception as e:
        print(f"[Lecture Links] Database initialization skipped: {e}")
    finally:
        pool.putconn(conn)


if PSYCOPG2_AVAILABLE:
    try:
        _init_db()
    except Exception as e:
        print(f"[Lecture Links] Database initialization deferred: {e}")


@dataclass
class SectionCandidate:
    section: LectureSection
    score: float
    method: str


def _normalize_tokens(text: str) -> List[str]:
    cleaned = re.sub(r"[^a-z0-9\\s]", " ", (text or "").lower())
    return [t for t in cleaned.split() if t]


def _keyword_score(source_text: str, section_text: str, title: Optional[str]) -> float:
    source_tokens = set(_normalize_tokens(source_text))
    if not source_tokens:
        return 0.0
    section_tokens = set(_normalize_tokens(section_text))
    title_tokens = set(_normalize_tokens(title or ""))
    overlap = len(source_tokens & section_tokens)
    title_overlap = len(source_tokens & title_tokens)
    return (overlap + 0.25 * title_overlap) / max(len(source_tokens), 1)


def _build_chunks(section: LectureSection) -> List[Dict[str, Any]]:
    text = (section.raw_text or "")[:MAX_SECTION_CHARS]
    if len(text) <= MAX_CHUNK_CHARS:
        return [{
            "lecture_section_id": section.id,
            "section_index": section.section_index,
            "chunk_start": 0,
            "text": text,
        }]
    chunks = []
    start = 0
    while start < len(text):
        end = min(start + MAX_CHUNK_CHARS, len(text))
        chunks.append({
            "lecture_section_id": section.id,
            "section_index": section.section_index,
            "chunk_start": start,
            "text": text[start:end],
        })
        if end == len(text):
            break
        start = end - CHUNK_OVERLAP
    return chunks


def _parse_json_response(raw: str) -> Dict[str, Any]:
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        start = raw.find("{")
        end = raw.rfind("}")
        if start != -1 and end != -1 and end > start:
            return json.loads(raw[start:end + 1])
        raise


def _call_llm(prompt: str, payload: Dict[str, Any]) -> Dict[str, Any]:
    try:
        import openai
    except ImportError as e:
        raise RuntimeError("OpenAI library not installed") from e

    api_key = os.getenv("OPENAI_API_KEY")
    if not api_key:
        raise RuntimeError("OpenAI API key not configured")

    client = openai.OpenAI(api_key=api_key)
    response = client.chat.completions.create(
        model=os.getenv("LECTURE_LINK_MODEL", "gpt-4o-mini"),
        messages=[
            {"role": "system", "content": prompt},
            {"role": "user", "content": json.dumps(payload, ensure_ascii=True)},
        ],
        temperature=0.2,
        max_tokens=1400,
    )
    content = response.choices[0].message.content or "{}"
    return _parse_json_response(content)


def _repair_offsets(raw_text: str, start_offset: int, end_offset: int, anchor_text: str) -> Tuple[int, int]:
    text_len = len(raw_text)
    if start_offset < 0 or end_offset > text_len or start_offset >= end_offset:
        start_offset = max(0, min(start_offset, text_len))
        end_offset = max(start_offset + 1, min(end_offset, text_len))

    if anchor_text:
        snippet = raw_text[start_offset:end_offset]
        if anchor_text not in snippet:
            idx = raw_text.find(anchor_text)
            if idx == -1:
                idx = raw_text.lower().find(anchor_text.lower())
            if idx != -1:
                return idx, idx + len(anchor_text)

            # Fuzzy fallback: longest matching block.
            matcher = SequenceMatcher(None, raw_text, anchor_text)
            match = matcher.find_longest_match(0, len(raw_text), 0, len(anchor_text))
            if match.size >= min(40, max(10, len(anchor_text) // 3)):
                return match.a, match.a + match.size

    return start_offset, end_offset


def _resolve_with_llm(source_text: str, candidates: List[SectionCandidate]) -> List[Dict[str, Any]]:
    chunks: List[Dict[str, Any]] = []
    for candidate in candidates:
        chunks.extend(_build_chunks(candidate.section))

    prompt = (
        "You match a source text to lecture section chunks. "
        "Choose up to 3 best matches. Return JSON only."
    )
    payload = {
        "source_text": source_text[:4000],
        "chunks": [
            {
                "lecture_section_id": c["lecture_section_id"],
                "section_index": c["section_index"],
                "chunk_start": c["chunk_start"],
                "text": c["text"][:4000],
            }
            for c in chunks
        ],
        "response_schema": {
            "matches": [
                {
                    "lecture_section_id": "string",
                    "section_index": 0,
                    "chunk_start": 0,
                    "relative_start": 0,
                    "relative_end": 0,
                    "anchor_text": "string",
                    "confidence": 0.0,
                    "justification": "string",
                }
            ]
        }
    }

    try:
        result = _call_llm(prompt, payload)
    except Exception as e:
        log_event("lecture_link_failed", {"error": str(e), "stage": "llm"})
        return []

    matches = result.get("matches") if isinstance(result, dict) else None
    if not isinstance(matches, list):
        return []
    return matches[:3]


def _score_candidates(source_text: str, sections: List[LectureSection]) -> Tuple[List[SectionCandidate], str]:
    candidates: List[SectionCandidate] = []
    for section in sections:
        score = _keyword_score(source_text, section.raw_text, section.title)
        candidates.append(SectionCandidate(section=section, score=score, method="keyword"))

    candidates.sort(key=lambda c: (-c.score, c.section.id))

    use_embeddings = (
        EMBEDDINGS_AVAILABLE
        and os.getenv("LECTURE_LINK_USE_EMBEDDINGS", "false").lower() in ("true", "1", "yes")
    )
    if not use_embeddings or not candidates:
        return candidates, "keyword"

    top_for_embeddings = candidates[: min(20, len(candidates))]
    try:
        query_embedding = embed_text(source_text)
        updated: List[SectionCandidate] = []
        for candidate in top_for_embeddings:
            embedding = embed_text(candidate.section.raw_text[:2000])
            emb_score = cosine_similarity(query_embedding, embedding)
            hybrid_score = 0.4 * candidate.score + 0.6 * emb_score
            updated.append(SectionCandidate(section=candidate.section, score=hybrid_score, method="hybrid"))
        updated.sort(key=lambda c: (-c.score, c.section.id))
        return updated + candidates[len(top_for_embeddings):], "hybrid"
    except Exception:
        return candidates, "keyword"


def list_lecture_sections(lecture_document_ids: Optional[List[str]] = None) -> List[LectureSection]:
    pool = _get_pool()
    conn = pool.getconn()
    sections: List[LectureSection] = []
    try:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            if lecture_document_ids:
                cur.execute("""
                    SELECT *
                    FROM lecture_sections
                    WHERE lecture_document_id = ANY(%s)
                    ORDER BY lecture_document_id, section_index
                """, (lecture_document_ids,))
            else:
                cur.execute("""
                    SELECT *
                    FROM lecture_sections
                    ORDER BY lecture_document_id, section_index
                """)
            rows = cur.fetchall()
            for row in rows:
                sections.append(LectureSection(**row))
    finally:
        pool.putconn(conn)
    return sections


def get_lecture_section(lecture_document_id: str, section_id: str) -> Optional[LectureSection]:
    pool = _get_pool()
    conn = pool.getconn()
    try:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute("""
                SELECT *
                FROM lecture_sections
                WHERE lecture_document_id = %s AND id = %s
            """, (lecture_document_id, section_id))
            row = cur.fetchone()
            if not row:
                return None
            return LectureSection(**row)
    finally:
        pool.putconn(conn)


def upsert_lecture_document(document_id: str, title: Optional[str], source_uri: Optional[str]) -> None:
    pool = _get_pool()
    conn = pool.getconn()
    try:
        with conn.cursor() as cur:
            cur.execute("""
                INSERT INTO lecture_documents (id, title, source_uri, created_at, updated_at)
                VALUES (%s, %s, %s, NOW(), NOW())
                ON CONFLICT (id)
                DO UPDATE SET title = COALESCE(EXCLUDED.title, lecture_documents.title),
                              source_uri = COALESCE(EXCLUDED.source_uri, lecture_documents.source_uri),
                              updated_at = NOW()
            """, (document_id, title, source_uri))
            conn.commit()
    finally:
        pool.putconn(conn)


def upsert_lecture_sections(document_id: str, sections: List[Dict[str, Any]]) -> None:
    if not sections:
        return
    pool = _get_pool()
    conn = pool.getconn()
    try:
        with conn.cursor() as cur:
            for section in sections:
                section_id = section.get("id") or f"section-{uuid.uuid4().hex[:12]}"
                cur.execute("""
                    INSERT INTO lecture_sections (
                        id, lecture_document_id, section_index, title, raw_text, source_uri, created_at, updated_at
                    )
                    VALUES (%s, %s, %s, %s, %s, %s, NOW(), NOW())
                    ON CONFLICT (id)
                    DO UPDATE SET
                        lecture_document_id = EXCLUDED.lecture_document_id,
                        section_index = EXCLUDED.section_index,
                        title = EXCLUDED.title,
                        raw_text = EXCLUDED.raw_text,
                        source_uri = EXCLUDED.source_uri,
                        updated_at = NOW()
                """, (
                    section_id,
                    document_id,
                    section.get("section_index") or 0,
                    section.get("title"),
                    section.get("raw_text") or "",
                    section.get("source_uri"),
                ))
            conn.commit()
    finally:
        pool.putconn(conn)


def _fetch_main_chat_event_text(chat_id: str, source_id: str) -> Optional[str]:
    store = get_event_store()
    events = store.list_events(chat_id, limit=5000)
    for event in events:
        payload = event.payload or {}
        if event.event_id == source_id or payload.get("message_id") == source_id:
            return payload.get("answer") or payload.get("answer_summary") or payload.get("message")
    return None


def _fetch_branch_text(chat_id: str, branch_id: str) -> Optional[str]:
    pool = _get_pool()
    conn = pool.getconn()
    try:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute("""
                SELECT selected_text
                FROM contextual_branches
                WHERE id = %s AND chat_id = %s
            """, (branch_id, chat_id))
            row = cur.fetchone()
            anchor_text = row["selected_text"] if row else None

            cur.execute("""
                SELECT content
                FROM branch_messages
                WHERE branch_id = %s AND role = 'assistant'
                ORDER BY created_at DESC
                LIMIT 1
            """, (branch_id,))
            msg = cur.fetchone()
            if msg and msg.get("content"):
                return msg["content"]

            cur.execute("""
                SELECT content
                FROM branch_messages
                WHERE branch_id = %s
                ORDER BY created_at DESC
                LIMIT 1
            """, (branch_id,))
            msg = cur.fetchone()
            if msg and msg.get("content"):
                return msg["content"]
            return anchor_text
    finally:
        pool.putconn(conn)


def _fetch_bridging_hint_text(chat_id: str, hint_id: str) -> Optional[str]:
    pool = _get_pool()
    conn = pool.getconn()
    try:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute("""
                SELECT h.hint_text
                FROM bridging_hints h
                JOIN contextual_branches b ON b.id = h.branch_id
                WHERE h.id = %s AND b.chat_id = %s
            """, (hint_id, chat_id))
            row = cur.fetchone()
            return row["hint_text"] if row else None
    finally:
        pool.putconn(conn)


def _fetch_notes_entry_text(chat_id: str, entry_id: str) -> Optional[str]:
    pool = _get_pool()
    conn = pool.getconn()
    try:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute("""
                SELECT summary_text
                FROM notes_entries
                WHERE id = %s AND chat_id = %s
            """, (entry_id, chat_id))
            row = cur.fetchone()
            return row["summary_text"] if row else None
    finally:
        pool.putconn(conn)


def _fetch_source_text(chat_id: str, source_type: str, source_id: str) -> Optional[str]:
    if source_type == "main_chat_event":
        return _fetch_main_chat_event_text(chat_id, source_id)
    if source_type == "branch":
        return _fetch_branch_text(chat_id, source_id)
    if source_type == "bridging_hint":
        return _fetch_bridging_hint_text(chat_id, source_id)
    if source_type == "notes_entry":
        return _fetch_notes_entry_text(chat_id, source_id)
    return None


def resolve_lecture_links(
    chat_id: str,
    source_type: str,
    source_id: str,
    lecture_document_ids: Optional[List[str]] = None,
    top_n: int = DEFAULT_TOP_N,
) -> Tuple[List[LectureLink], bool]:
    if not PSYCOPG2_AVAILABLE:
        raise ImportError("psycopg2-binary is required for lecture linking")

    log_event("lecture_link_resolve_started", {
        "chat_id": chat_id,
        "source_type": source_type,
        "source_id": source_id,
    })

    source_text = _fetch_source_text(chat_id, source_type, source_id)
    if not source_text:
        log_event("lecture_link_failed", {
            "chat_id": chat_id,
            "source_type": source_type,
            "source_id": source_id,
            "error": "source_text_missing",
        })
        return [], True

    sections = list_lecture_sections(lecture_document_ids)
    if not sections and lecture_document_ids:
        for doc_id in lecture_document_ids:
            _hydrate_sections_from_neo4j(doc_id)
        sections = list_lecture_sections(lecture_document_ids)
    if not sections:
        log_event("lecture_link_failed", {
            "chat_id": chat_id,
            "source_type": source_type,
            "source_id": source_id,
            "error": "no_sections",
        })
        return [], True

    scored, method = _score_candidates(source_text, sections)
    candidates = scored[:max(top_n, 1)]
    llm_matches = _resolve_with_llm(source_text, candidates)

    links: List[LectureLink] = []
    now = datetime.utcnow()

    if not llm_matches:
        best = candidates[0]
        raw_text = best.section.raw_text
        idx = raw_text.lower().find(source_text.lower()[:80])
        if idx == -1:
            idx = 0
        start_offset = idx
        end_offset = min(idx + min(200, len(raw_text)), len(raw_text))
        links.append(LectureLink(
            id=f"link-{uuid.uuid4().hex[:12]}",
            chat_id=chat_id,
            source_type=source_type,
            source_id=source_id,
            lecture_document_id=best.section.lecture_document_id,
            lecture_section_id=best.section.id,
            start_offset=start_offset,
            end_offset=end_offset,
            confidence_score=min(0.4, best.score),
            method=method,
            justification_text="Fallback match (LLM unavailable).",
            created_at=now,
        ))
    else:
        for match in llm_matches:
            section_id = match.get("lecture_section_id")
            if not section_id:
                continue
            section = next((c.section for c in candidates if c.section.id == section_id), None)
            if not section:
                continue
            chunk_start = int(match.get("chunk_start") or 0)
            rel_start = int(match.get("relative_start") or 0)
            rel_end = int(match.get("relative_end") or 0)
            start_offset = chunk_start + rel_start
            end_offset = chunk_start + rel_end
            anchor_text = match.get("anchor_text") or ""
            if end_offset <= start_offset:
                end_offset = start_offset + max(1, min(len(anchor_text), 200))
            start_offset, end_offset = _repair_offsets(section.raw_text, start_offset, end_offset, anchor_text)
            confidence = float(match.get("confidence") or 0.0)
            links.append(LectureLink(
                id=f"link-{uuid.uuid4().hex[:12]}",
                chat_id=chat_id,
                source_type=source_type,
                source_id=source_id,
                lecture_document_id=section.lecture_document_id,
                lecture_section_id=section.id,
                start_offset=start_offset,
                end_offset=end_offset,
                confidence_score=max(0.0, min(confidence, 1.0)),
                method=method,
                justification_text=match.get("justification") or "",
                created_at=now,
            ))

    weak = not links or max(link.confidence_score for link in links) < WEAK_CONFIDENCE_THRESHOLD

    _persist_links(links)

    log_event("lecture_link_created", {
        "chat_id": chat_id,
        "source_type": source_type,
        "source_id": source_id,
        "count": len(links),
        "weak": weak,
    })
    log_event("lecture_link_confidence_distribution", {
        "chat_id": chat_id,
        "source_type": source_type,
        "source_id": source_id,
        "scores": [link.confidence_score for link in links],
    })

    return links, weak


def _persist_links(links: List[LectureLink]) -> None:
    if not links:
        return
    pool = _get_pool()
    conn = pool.getconn()
    try:
        with conn.cursor() as cur:
            for link in links:
                cur.execute("""
                    INSERT INTO lecture_links (
                        id, chat_id, source_type, source_id, lecture_document_id,
                        lecture_section_id, start_offset, end_offset, confidence_score,
                        method, justification_text, created_at
                    )
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                    ON CONFLICT (chat_id, source_type, source_id, lecture_section_id, start_offset, end_offset)
                    DO NOTHING
                """, (
                    link.id,
                    link.chat_id,
                    link.source_type,
                    link.source_id,
                    link.lecture_document_id,
                    link.lecture_section_id,
                    link.start_offset,
                    link.end_offset,
                    link.confidence_score,
                    link.method,
                    link.justification_text,
                    link.created_at or datetime.utcnow(),
                ))
            conn.commit()
    finally:
        pool.putconn(conn)


def list_lecture_links(chat_id: str, source_type: str, source_id: str) -> List[LectureLink]:
    pool = _get_pool()
    conn = pool.getconn()
    links: List[LectureLink] = []
    try:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute("""
                SELECT *
                FROM lecture_links
                WHERE chat_id = %s AND source_type = %s AND source_id = %s
                ORDER BY created_at DESC
            """, (chat_id, source_type, source_id))
            for row in cur.fetchall():
                links.append(LectureLink(**row))
    finally:
        pool.putconn(conn)
    return links


def save_lecture_link_feedback(link_id: str, action: str) -> None:
    pool = _get_pool()
    conn = pool.getconn()
    try:
        with conn.cursor() as cur:
            cur.execute("""
                INSERT INTO lecture_link_feedback (id, lecture_link_id, action, created_at)
                VALUES (%s, %s, %s, NOW())
            """, (f"feedback-{uuid.uuid4().hex[:12]}", link_id, action))
            conn.commit()
    finally:
        pool.putconn(conn)
    log_event("lecture_link_feedback_recorded", {
        "link_id": link_id,
        "action": action,
    })


def resolve_links_for_notes_entries(chat_id: str, updated_since: Optional[datetime] = None) -> None:
    pool = _get_pool()
    conn = pool.getconn()
    try:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            if updated_since:
                cur.execute("""
                    SELECT id
                    FROM notes_entries
                    WHERE chat_id = %s AND updated_at > %s
                """, (chat_id, updated_since))
            else:
                cur.execute("""
                    SELECT id
                    FROM notes_entries
                    WHERE chat_id = %s
                    ORDER BY updated_at DESC
                    LIMIT 20
                """, (chat_id,))
            rows = cur.fetchall()
            for row in rows:
                entry_id = row["id"]
                try:
                    resolve_lecture_links(
                        chat_id=chat_id,
                        source_type="notes_entry",
                        source_id=entry_id,
                    )
                except Exception as e:
                    log_event("lecture_link_failed", {
                        "chat_id": chat_id,
                        "source_type": "notes_entry",
                        "source_id": entry_id,
                        "error": str(e),
                    })
    finally:
        pool.putconn(conn)


def resolve_links_for_bridging_hints(chat_id: str, hint_ids: List[str]) -> None:
    for hint_id in hint_ids:
        try:
            resolve_lecture_links(
                chat_id=chat_id,
                source_type="bridging_hint",
                source_id=hint_id,
            )
        except Exception as e:
            log_event("lecture_link_failed", {
                "chat_id": chat_id,
                "source_type": "bridging_hint",
                "source_id": hint_id,
                "error": str(e),
            })


def _hydrate_sections_from_neo4j(lecture_id: str) -> None:
    try:
        from db_neo4j import get_driver, NEO4J_DATABASE
    except Exception:
        return

    try:
        driver = get_driver()
    except Exception:
        return

    sections: List[Dict[str, Any]] = []
    lecture_title: Optional[str] = None

    try:
        with driver.session(database=NEO4J_DATABASE) as session:
            result = session.run("""
                MATCH (l:Lecture {lecture_id: $lecture_id})
                OPTIONAL MATCH (l)-[:HAS_SEGMENT]->(seg:LectureSegment)
                RETURN l.title AS title,
                       l.raw_text AS raw_text,
                       seg.segment_id AS segment_id,
                       seg.segment_index AS segment_index,
                       seg.text AS text,
                       seg.summary AS summary
                ORDER BY seg.segment_index ASC
            """, lecture_id=lecture_id)
            records = list(result)
            if not records:
                return
            lecture_title = records[0].get("title")
            raw_text = records[0].get("raw_text")
            if records[0].get("segment_id"):
                for record in records:
                    sections.append({
                        "id": record.get("segment_id"),
                        "section_index": record.get("segment_index") or 0,
                        "title": record.get("summary"),
                        "raw_text": record.get("text") or "",
                    })
            elif raw_text:
                sections.append({
                    "id": f"section-{lecture_id}",
                    "section_index": 1,
                    "title": lecture_title,
                    "raw_text": raw_text,
                })
    except Exception:
        return

    if not sections:
        return

    try:
        upsert_lecture_document(lecture_id, lecture_title, None)
        upsert_lecture_sections(lecture_id, sections)
    except Exception:
        return
