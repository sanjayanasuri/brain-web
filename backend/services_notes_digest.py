"""Service layer for Learning Notes Digest operations."""
import json
import os
import re
import uuid
from datetime import datetime
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
from models_notes_digest import NotesDigest, NotesSection, NotesEntry, NotesHistoryEntry
from prompts_notes_digest import INCREMENTAL_NOTES_DIGEST_PROMPT

try:
    from services_logging import log_event
except ImportError:
    def log_event(event_type: str, data: dict):
        print(f"[Event] {event_type}: {data}")

try:
    from services_graph import get_all_concepts
    from models import Concept
    from services_resource_ai import extract_concepts_from_text
    GRAPH_AVAILABLE = True
except ImportError:
    GRAPH_AVAILABLE = False
    Concept = None


DEFAULT_SECTION_TITLES = [
    "Core Questions Asked",
    "Concepts Clarified",
    "Confusions Resolved",
    "Key Explanations",
    "Open Questions / Follow-ups",
]

MAX_MAIN_CHAT_EVENTS = 20
MAX_BRANCH_MESSAGES = 40
MAX_BRIDGING_HINTS = 20

_pool: Optional[ThreadedConnectionPool] = None


def _get_pool():
    if not PSYCOPG2_AVAILABLE:
        raise ImportError("psycopg2-binary is required for notes digest")
    global _pool
    if _pool is None:
        _pool = ThreadedConnectionPool(1, 10, POSTGRES_CONNECTION_STRING)
    return _pool


def _init_db():
    """Initialize database schema for notes digest."""
    if not PSYCOPG2_AVAILABLE:
        return
    pool = _get_pool()
    conn = pool.getconn()
    try:
        with conn.cursor() as cur:
            cur.execute("""
                CREATE TABLE IF NOT EXISTS notes_digests (
                    id TEXT PRIMARY KEY,
                    chat_id TEXT NOT NULL UNIQUE,
                    created_at TIMESTAMPTZ DEFAULT NOW(),
                    last_updated_at TIMESTAMPTZ,
                    last_processed_message_id TEXT,
                    last_processed_at TIMESTAMPTZ
                );
            """)
            cur.execute("""
                CREATE TABLE IF NOT EXISTS notes_sections (
                    id TEXT PRIMARY KEY,
                    digest_id TEXT NOT NULL REFERENCES notes_digests(id) ON DELETE CASCADE,
                    title TEXT NOT NULL,
                    position INTEGER NOT NULL DEFAULT 0,
                    created_at TIMESTAMPTZ DEFAULT NOW(),
                    updated_at TIMESTAMPTZ DEFAULT NOW(),
                    UNIQUE (digest_id, title)
                );
            """)
            cur.execute("""
                CREATE TABLE IF NOT EXISTS notes_entries (
                    id TEXT PRIMARY KEY,
                    section_id TEXT NOT NULL REFERENCES notes_sections(id) ON DELETE CASCADE,
                    chat_id TEXT NOT NULL,
                    source_type TEXT NOT NULL CHECK (source_type IN ('main_chat', 'branch_chat', 'bridging_hint')),
                    source_message_ids TEXT[] NOT NULL,
                    related_branch_id TEXT,
                    related_anchor_ids TEXT[],
                    summary_text TEXT NOT NULL,
                    confidence_level REAL DEFAULT 0.5,
                    concept_label TEXT,
                    related_node_ids TEXT[] DEFAULT '{}'::text[],
                    created_at TIMESTAMPTZ DEFAULT NOW(),
                    updated_at TIMESTAMPTZ DEFAULT NOW()
                );
            """)
            cur.execute("""
                CREATE TABLE IF NOT EXISTS notes_digest_history (
                    id TEXT PRIMARY KEY,
                    digest_id TEXT NOT NULL REFERENCES notes_digests(id) ON DELETE CASCADE,
                    trigger_source TEXT,
                    snapshot JSONB NOT NULL,
                    created_at TIMESTAMPTZ DEFAULT NOW()
                );
            """)
            cur.execute("""
                CREATE INDEX IF NOT EXISTS idx_notes_digests_chat_id
                ON notes_digests (chat_id);
            """)
            cur.execute("""
                CREATE INDEX IF NOT EXISTS idx_notes_sections_digest_id
                ON notes_sections (digest_id, position);
            """)
            cur.execute("""
                CREATE INDEX IF NOT EXISTS idx_notes_entries_section_id
                ON notes_entries (section_id);
            """)
            cur.execute("""
                CREATE INDEX IF NOT EXISTS idx_notes_entries_chat_id
                ON notes_entries (chat_id);
            """)
            cur.execute("""
                CREATE INDEX IF NOT EXISTS idx_notes_entries_branch_id
                ON notes_entries (related_branch_id);
            """)
            cur.execute("""
                CREATE INDEX IF NOT EXISTS idx_notes_entries_related_node_ids_gin
                ON notes_entries USING GIN (related_node_ids);
            """)
            conn.commit()
    finally:
        pool.putconn(conn)


if PSYCOPG2_AVAILABLE:
    try:
        _init_db()
    except Exception as e:
        print(f"[Notes Digest] Database initialization deferred: {e}")


def _extract_related_node_ids_for_entry(text: str, concepts: List[Concept]) -> List[str]:
    """
    Extract related node IDs from text by matching against known concepts.
    
    Uses deterministic matching first (exact/alias match), then optionally
    uses LLM extraction to find additional concept names that are mapped back
    to known concepts.
    
    Args:
        text: The summary text to analyze
        concepts: List of Concept objects from Neo4j
        
    Returns:
        List of unique node_ids (strings) that match concepts found in text
    """
    if not text or not concepts:
        return []
    
    # Build lookup map: normalized name/alias -> node_id
    lookup_map: Dict[str, str] = {}
    for concept in concepts:
        # Normalize concept name
        normalized_name = concept.name.lower().strip()
        if normalized_name:
            lookup_map[normalized_name] = concept.node_id
        
        # Add aliases to lookup map
        for alias in (concept.aliases or []):
            normalized_alias = alias.lower().strip()
            if normalized_alias:
                lookup_map[normalized_alias] = concept.node_id
    
    matched_node_ids = set()
    text_lower = text.lower()
    
    # Deterministic pass: check for concept names/aliases as substrings
    # Use word boundaries for alphanumeric-only aliases to avoid false matches
    for normalized_term, node_id in lookup_map.items():
        # Simple word boundary check for alphanumeric terms
        if normalized_term.replace(" ", "").isalnum():
            # Simple word boundary check
            pattern = r'\b' + re.escape(normalized_term) + r'\b'
            if re.search(pattern, text_lower, re.IGNORECASE):
                matched_node_ids.add(node_id)
        else:
            # For non-alphanumeric terms, use simple substring match
            if normalized_term in text_lower:
                matched_node_ids.add(node_id)
    
    # LLM assist pass (optional)
    if GRAPH_AVAILABLE:
        try:
            extracted_names = extract_concepts_from_text(text)
            if extracted_names:
                for name in extracted_names:
                    if not isinstance(name, str):
                        continue
                    normalized_name = name.lower().strip()
                    if normalized_name in lookup_map:
                        matched_node_ids.add(lookup_map[normalized_name])
        except Exception as e:
            # Silently fail LLM extraction - deterministic matching is primary
            pass
    
    return sorted(list(matched_node_ids))


def _normalize_text(text: str) -> List[str]:
    cleaned = re.sub(r"[^a-z0-9\\s]", " ", (text or "").lower())
    return [t for t in cleaned.split() if t]


def _jaccard_similarity(a: str, b: str) -> float:
    tokens_a = set(_normalize_text(a))
    tokens_b = set(_normalize_text(b))
    if not tokens_a or not tokens_b:
        return 0.0
    intersection = tokens_a.intersection(tokens_b)
    union = tokens_a.union(tokens_b)
    return len(intersection) / max(len(union), 1)


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
        model="gpt-4o-mini",
        messages=[
            {"role": "system", "content": prompt},
            {"role": "user", "content": json.dumps(payload, ensure_ascii=True)}
        ],
        temperature=0.2,
        max_tokens=1400,
    )
    content = response.choices[0].message.content or "{}"
    return _parse_json_response(content)


def _row_to_entry(row: dict) -> NotesEntry:
    return NotesEntry(
        id=row["id"],
        section_id=row["section_id"],
        chat_id=row["chat_id"],
        source_type=row["source_type"],
        source_message_ids=row.get("source_message_ids") or [],
        related_branch_id=row.get("related_branch_id"),
        related_anchor_ids=row.get("related_anchor_ids"),
        summary_text=row["summary_text"],
        confidence_level=row.get("confidence_level") or 0.5,
        concept_label=row.get("concept_label"),
        related_node_ids=row.get("related_node_ids") or [],
        created_at=row["created_at"],
        updated_at=row["updated_at"],
    )


def _row_to_section(row: dict, entries: List[NotesEntry]) -> NotesSection:
    return NotesSection(
        id=row["id"],
        digest_id=row["digest_id"],
        title=row["title"],
        position=row["position"],
        entries=entries,
        created_at=row["created_at"],
        updated_at=row["updated_at"],
    )


def _row_to_digest(row: dict, sections: List[NotesSection]) -> NotesDigest:
    return NotesDigest(
        id=row["id"],
        chat_id=row["chat_id"],
        sections=sections,
        created_at=row["created_at"],
        last_updated_at=row.get("last_updated_at"),
        last_processed_message_id=row.get("last_processed_message_id"),
        last_processed_at=row.get("last_processed_at"),
    )


def _ensure_default_sections(digest_id: str) -> None:
    pool = _get_pool()
    conn = pool.getconn()
    try:
        with conn.cursor() as cur:
            for position, title in enumerate(DEFAULT_SECTION_TITLES):
                cur.execute("""
                    INSERT INTO notes_sections (id, digest_id, title, position, created_at, updated_at)
                    VALUES (%s, %s, %s, %s, NOW(), NOW())
                    ON CONFLICT (digest_id, title) DO NOTHING
                """, (
                    f"section-{uuid.uuid4().hex[:12]}",
                    digest_id,
                    title,
                    position
                ))
            conn.commit()
    finally:
        pool.putconn(conn)


def get_or_create_digest(chat_id: str) -> NotesDigest:
    if not PSYCOPG2_AVAILABLE:
        raise ImportError("psycopg2-binary is required for notes digest")
    pool = _get_pool()
    conn = pool.getconn()
    try:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute("SELECT * FROM notes_digests WHERE chat_id = %s", (chat_id,))
            row = cur.fetchone()
            if not row:
                digest_id = f"digest-{uuid.uuid4().hex[:12]}"
                cur.execute("""
                    INSERT INTO notes_digests (id, chat_id, created_at)
                    VALUES (%s, %s, NOW())
                """, (digest_id, chat_id))
                conn.commit()
                _ensure_default_sections(digest_id)
            else:
                digest_id = row["id"]
        return get_digest(chat_id)
    finally:
        pool.putconn(conn)


def get_digest(chat_id: str) -> NotesDigest:
    if not PSYCOPG2_AVAILABLE:
        raise ImportError("psycopg2-binary is required for notes digest")
    pool = _get_pool()
    conn = pool.getconn()
    try:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute("SELECT * FROM notes_digests WHERE chat_id = %s", (chat_id,))
            digest_row = cur.fetchone()
            if not digest_row:
                raise ValueError("Digest not found")

            cur.execute("""
                SELECT * FROM notes_sections
                WHERE digest_id = %s
                ORDER BY position ASC, created_at ASC
            """, (digest_row["id"],))
            section_rows = cur.fetchall()

            cur.execute("""
                SELECT * FROM notes_entries
                WHERE chat_id = %s
                ORDER BY created_at ASC
            """, (chat_id,))
            entry_rows = cur.fetchall()

            entries_by_section: Dict[str, List[NotesEntry]] = {}
            for row in entry_rows:
                entry = _row_to_entry(row)
                entries_by_section.setdefault(entry.section_id, []).append(entry)

            sections = [
                _row_to_section(row, entries_by_section.get(row["id"], []))
                for row in section_rows
            ]

            return _row_to_digest(digest_row, sections)
    finally:
        pool.putconn(conn)


def _get_section_map(digest: NotesDigest) -> Dict[str, NotesSection]:
    return {section.title.lower(): section for section in digest.sections}


def _get_entry_map(digest: NotesDigest) -> Dict[str, NotesEntry]:
    return {entry.id: entry for section in digest.sections for entry in section.entries}


def _find_similar_entry(section: NotesSection, concept_label: Optional[str], summary_text: str) -> Optional[NotesEntry]:
    normalized_label = (concept_label or "").strip().lower()
    for entry in section.entries:
        if normalized_label and entry.concept_label:
            if entry.concept_label.strip().lower() == normalized_label:
                return entry
        similarity = _jaccard_similarity(entry.summary_text, summary_text)
        if similarity >= 0.8:
            return entry
    return None


def _merge_ids(existing: Optional[List[str]], incoming: Optional[List[str]]) -> List[str]:
    existing = existing or []
    incoming = incoming or []
    combined = list(dict.fromkeys(existing + incoming))
    return combined


def _collect_main_chat_events(chat_id: str, after_ts: Optional[datetime]) -> List[Dict[str, Any]]:
    store = get_event_store()
    events = store.list_events(chat_id, after_ts=after_ts, limit=MAX_MAIN_CHAT_EVENTS * 2)
    items = []
    for event in events:
        event_type = getattr(event, "event_type", None)
        event_type_value = event_type.value if hasattr(event_type, "value") else event_type
        if event_type_value != "ChatMessageCreated":
            continue
        payload = event.payload or {}
        assistant_response = payload.get("answer") or payload.get("answer_summary") or ""
        items.append({
            "event_id": event.event_id,
            "occurred_at": event.occurred_at.isoformat(),
            "user_message": payload.get("message", ""),
            "assistant_response": assistant_response,
            "assistant_summary": payload.get("answer_summary", ""),
            "mentioned_concepts": payload.get("mentioned_concepts", []),
        })
    return items[:MAX_MAIN_CHAT_EVENTS]


def _collect_branch_data(
    chat_id: str,
    after_ts: Optional[datetime],
    branch_id: Optional[str],
    include_full_branch: bool
) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]]]:
    pool = _get_pool()
    conn = pool.getconn()
    branch_messages: List[Dict[str, Any]] = []
    bridging_hints: List[Dict[str, Any]] = []
    try:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            branch_filter_clause = ""
            params: List[Any] = []
            if branch_id:
                branch_filter_clause = "AND b.id = %s"
                params.append(branch_id)
            else:
                branch_filter_clause = "AND b.chat_id = %s"
                params.append(chat_id)

            time_filter_clause = ""
            if after_ts and not include_full_branch:
                time_filter_clause = "AND m.created_at > %s"
                params.append(after_ts)

            cur.execute(f"""
                SELECT m.*, b.chat_id, b.parent_message_id, b.parent_message_version,
                       b.selected_text, b.selected_text_hash
                FROM branch_messages m
                JOIN contextual_branches b ON b.id = m.branch_id
                WHERE 1=1
                {branch_filter_clause}
                {time_filter_clause}
                ORDER BY m.created_at ASC
                LIMIT %s
            """, params + [MAX_BRANCH_MESSAGES])
            for row in cur.fetchall():
                branch_messages.append({
                    "id": row["id"],
                    "branch_id": row["branch_id"],
                    "role": row["role"],
                    "content": row["content"],
                    "timestamp": row["timestamp"].isoformat() if row.get("timestamp") else None,
                    "selected_text": row.get("selected_text"),
                    "selected_text_hash": row.get("selected_text_hash"),
                    "parent_message_id": row.get("parent_message_id"),
                    "parent_message_version": row.get("parent_message_version"),
                })

            hint_time_filter_clause = ""
            hint_params: List[Any] = []
            if branch_id:
                hint_params.append(branch_id)
                hint_filter_clause = "AND b.id = %s"
            else:
                hint_params.append(chat_id)
                hint_filter_clause = "AND b.chat_id = %s"

            if after_ts and not include_full_branch:
                hint_time_filter_clause = "AND h.created_at > %s"
                hint_params.append(after_ts)

            cur.execute(f"""
                SELECT h.*, b.parent_message_id, b.parent_message_version,
                       b.selected_text, b.selected_text_hash
                FROM bridging_hints h
                JOIN contextual_branches b ON b.id = h.branch_id
                WHERE 1=1
                {hint_filter_clause}
                {hint_time_filter_clause}
                ORDER BY h.created_at ASC
                LIMIT %s
            """, hint_params + [MAX_BRIDGING_HINTS])
            for row in cur.fetchall():
                bridging_hints.append({
                    "id": row["id"],
                    "branch_id": row["branch_id"],
                    "hint_text": row["hint_text"],
                    "target_offset": row["target_offset"],
                    "created_at": row["created_at"].isoformat() if row.get("created_at") else None,
                    "selected_text": row.get("selected_text"),
                    "selected_text_hash": row.get("selected_text_hash"),
                    "parent_message_id": row.get("parent_message_id"),
                    "parent_message_version": row.get("parent_message_version"),
                })
    finally:
        pool.putconn(conn)
    return branch_messages, bridging_hints


def _build_prompt_payload(
    digest: NotesDigest,
    main_chat_events: List[Dict[str, Any]],
    branch_messages: List[Dict[str, Any]],
    bridging_hints: List[Dict[str, Any]]
) -> Dict[str, Any]:
    existing_digest = {
        "sections": [
            {
                "title": section.title,
                "entries": [
                    {
                        "entry_id": entry.id,
                        "concept_label": entry.concept_label,
                        "summary_text": entry.summary_text,
                        "source_type": entry.source_type,
                        "source_message_ids": entry.source_message_ids,
                        "related_branch_id": entry.related_branch_id,
                        "related_anchor_ids": entry.related_anchor_ids,
                        "confidence_level": entry.confidence_level,
                    }
                    for entry in section.entries
                ],
            }
            for section in digest.sections
        ],
        "last_updated_at": digest.last_updated_at.isoformat() if digest.last_updated_at else None,
    }

    new_material = {
        "main_chat_events": main_chat_events,
        "branch_messages": branch_messages,
        "bridging_hints": bridging_hints,
    }

    return {
        "existing_digest": existing_digest,
        "new_material": new_material,
    }


def _apply_updates(
    digest: NotesDigest,
    updates: Dict[str, Any],
    last_event_id: Optional[str]
) -> Tuple[NotesDigest, int, int]:
    pool = _get_pool()
    conn = pool.getconn()
    entries_added = 0
    entries_refined = 0
    now = datetime.utcnow()
    
    # Fetch all concepts once per digest update
    concepts: List[Concept] = []
    if GRAPH_AVAILABLE:
        try:
            from db_neo4j import get_neo4j_session
            session = next(get_neo4j_session())
            try:
                concepts = get_all_concepts(session)
            finally:
                session.close()
        except Exception as e:
            # Silently fail - concept linking is optional
            log_event("concept_linking_failed", {"error": str(e)})
    
    try:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            section_map = _get_section_map(digest)
            entry_map = _get_entry_map(digest)

            new_sections = updates.get("new_sections") or []
            for section_payload in new_sections:
                title = (section_payload.get("title") or "").strip()
                if not title:
                    continue
                if title.lower() in section_map:
                    continue
                position = section_payload.get("position")
                if position is None:
                    position = max([s.position for s in digest.sections], default=0) + 1
                section_id = f"section-{uuid.uuid4().hex[:12]}"
                cur.execute("""
                    INSERT INTO notes_sections (id, digest_id, title, position, created_at, updated_at)
                    VALUES (%s, %s, %s, %s, NOW(), NOW())
                """, (section_id, digest.id, title, position))
                section = NotesSection(
                    id=section_id,
                    digest_id=digest.id,
                    title=title,
                    position=position,
                    entries=[],
                    created_at=now,
                    updated_at=now,
                )
                digest.sections.append(section)
                section_map[title.lower()] = section

            add_entries = updates.get("add_entries") or []
            for entry_payload in add_entries:
                section_title = (entry_payload.get("section_title") or "").strip()
                if not section_title:
                    continue
                section = section_map.get(section_title.lower())
                if not section:
                    section_id = f"section-{uuid.uuid4().hex[:12]}"
                    position = max([s.position for s in digest.sections], default=0) + 1
                    cur.execute("""
                        INSERT INTO notes_sections (id, digest_id, title, position, created_at, updated_at)
                        VALUES (%s, %s, %s, %s, NOW(), NOW())
                    """, (section_id, digest.id, section_title, position))
                    section = NotesSection(
                        id=section_id,
                        digest_id=digest.id,
                        title=section_title,
                        position=position,
                        entries=[],
                        created_at=now,
                        updated_at=now,
                    )
                    digest.sections.append(section)
                    section_map[section_title.lower()] = section

                concept_label = entry_payload.get("concept_label")
                summary_text = entry_payload.get("summary_text") or ""
                similar_entry = _find_similar_entry(section, concept_label, summary_text)
                if similar_entry:
                    entry_payload["entry_id"] = similar_entry.id
                    updates.setdefault("refine_entries", []).append(entry_payload)
                    continue

                entry_id = f"entry-{uuid.uuid4().hex[:12]}"
                source_message_ids = entry_payload.get("source_message_ids") or []
                related_anchor_ids = entry_payload.get("related_anchor_ids")
                related_branch_id = entry_payload.get("related_branch_id")
                confidence = entry_payload.get("confidence_level") or 0.5
                source_type = entry_payload.get("source_type") or "main_chat"
                
                # Extract related node IDs from summary text
                related_node_ids = _extract_related_node_ids_for_entry(summary_text, concepts)

                cur.execute("""
                    INSERT INTO notes_entries (
                        id, section_id, chat_id, source_type, source_message_ids,
                        related_branch_id, related_anchor_ids, summary_text,
                        confidence_level, concept_label, related_node_ids, created_at, updated_at
                    ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, NOW(), NOW())
                """, (
                    entry_id,
                    section.id,
                    digest.chat_id,
                    source_type,
                    source_message_ids,
                    related_branch_id,
                    related_anchor_ids,
                    summary_text,
                    confidence,
                    concept_label,
                    related_node_ids,
                ))
                entries_added += 1

                entry = NotesEntry(
                    id=entry_id,
                    section_id=section.id,
                    chat_id=digest.chat_id,
                    source_type=source_type,
                    source_message_ids=source_message_ids,
                    related_branch_id=related_branch_id,
                    related_anchor_ids=related_anchor_ids,
                    summary_text=summary_text,
                    confidence_level=confidence,
                    concept_label=concept_label,
                    related_node_ids=related_node_ids,
                    created_at=now,
                    updated_at=now,
                )
                section.entries.append(entry)
                entry_map[entry_id] = entry

            refine_entries = updates.get("refine_entries") or []
            for refine_payload in refine_entries:
                entry_id = refine_payload.get("entry_id")
                if not entry_id:
                    continue
                existing = entry_map.get(entry_id)
                if not existing:
                    continue
                summary_text = refine_payload.get("summary_text") or existing.summary_text
                confidence = refine_payload.get("confidence_level")
                if confidence is None:
                    confidence = existing.confidence_level
                source_message_ids = _merge_ids(
                    existing.source_message_ids,
                    refine_payload.get("source_message_ids")
                )
                related_anchor_ids = _merge_ids(
                    existing.related_anchor_ids or [],
                    refine_payload.get("related_anchor_ids") or []
                )
                related_branch_id = refine_payload.get("related_branch_id") or existing.related_branch_id
                
                # Recompute related_node_ids based on updated summary_text
                related_node_ids = _extract_related_node_ids_for_entry(summary_text, concepts)

                cur.execute("""
                    UPDATE notes_entries
                    SET summary_text = %s,
                        confidence_level = %s,
                        source_message_ids = %s,
                        related_branch_id = %s,
                        related_anchor_ids = %s,
                        related_node_ids = %s,
                        updated_at = NOW()
                    WHERE id = %s
                """, (
                    summary_text,
                    confidence,
                    source_message_ids,
                    related_branch_id,
                    related_anchor_ids,
                    related_node_ids,
                    entry_id
                ))
                entries_refined += 1

                existing.summary_text = summary_text
                existing.confidence_level = confidence
                existing.source_message_ids = source_message_ids
                existing.related_branch_id = related_branch_id
                existing.related_anchor_ids = related_anchor_ids
                existing.related_node_ids = related_node_ids
                existing.updated_at = now

            cur.execute("""
                UPDATE notes_digests
                SET last_updated_at = %s,
                    last_processed_at = %s,
                    last_processed_message_id = %s
                WHERE id = %s
            """, (now, now, last_event_id, digest.id))
            conn.commit()
    finally:
        pool.putconn(conn)

    digest.last_updated_at = now
    digest.last_processed_at = now
    digest.last_processed_message_id = last_event_id
    return digest, entries_added, entries_refined


def _store_history(digest: NotesDigest, trigger_source: str) -> None:
    pool = _get_pool()
    conn = pool.getconn()
    snapshot = json.loads(digest.json())
    try:
        with conn.cursor() as cur:
            cur.execute("""
                INSERT INTO notes_digest_history (id, digest_id, trigger_source, snapshot, created_at)
                VALUES (%s, %s, %s, %s, NOW())
            """, (
                f"history-{uuid.uuid4().hex[:12]}",
                digest.id,
                trigger_source,
                json.dumps(snapshot)
            ))
            conn.commit()
    finally:
        pool.putconn(conn)


def update_notes_digest(
    chat_id: str,
    trigger_source: str = "manual",
    branch_id: Optional[str] = None,
) -> Tuple[NotesDigest, int, int, str]:
    if not PSYCOPG2_AVAILABLE:
        raise ImportError("psycopg2-binary is required for notes digest")

    log_event("notes_update_triggered", {
        "chat_id": chat_id,
        "trigger_source": trigger_source,
        "branch_id": branch_id,
    })

    digest = get_or_create_digest(chat_id)
    last_processed_at = digest.last_processed_at or digest.last_updated_at

    include_full_branch = trigger_source in ("branch_closed", "bridging_hints") and branch_id is not None

    main_chat_events = _collect_main_chat_events(chat_id, last_processed_at)
    branch_messages, bridging_hints = _collect_branch_data(
        chat_id,
        last_processed_at,
        branch_id,
        include_full_branch,
    )

    if not main_chat_events and not branch_messages and not bridging_hints:
        log_event("notes_update_completed", {
            "chat_id": chat_id,
            "trigger_source": trigger_source,
            "entries_added": 0,
            "entries_refined": 0,
            "status": "no_update",
        })
        return digest, 0, 0, "no_update"

    prompt_payload = _build_prompt_payload(digest, main_chat_events, branch_messages, bridging_hints)

    try:
        updates = _call_llm(INCREMENTAL_NOTES_DIGEST_PROMPT, prompt_payload)
    except Exception as e:
        log_event("notes_update_failed", {
            "chat_id": chat_id,
            "trigger_source": trigger_source,
            "error": str(e),
        })
        raise

    last_event_id = main_chat_events[-1]["event_id"] if main_chat_events else digest.last_processed_message_id
    digest, entries_added, entries_refined = _apply_updates(
        digest=digest,
        updates=updates,
        last_event_id=last_event_id,
    )

    log_event("notes_entries_added", {
        "chat_id": chat_id,
        "count": entries_added,
    })
    log_event("notes_entries_refined", {
        "chat_id": chat_id,
        "count": entries_refined,
    })
    log_event("notes_update_completed", {
        "chat_id": chat_id,
        "trigger_source": trigger_source,
        "entries_added": entries_added,
        "entries_refined": entries_refined,
        "status": "updated",
    })

    try:
        from services_lecture_links import resolve_links_for_notes_entries
        resolve_links_for_notes_entries(chat_id, updated_since=last_processed_at)
    except Exception as e:
        log_event("lecture_link_failed", {
            "chat_id": chat_id,
            "source_type": "notes_entry",
            "error": str(e),
        })

    _store_history(digest, trigger_source)

    return digest, entries_added, entries_refined, "updated"


def get_notes_history(chat_id: str) -> List[NotesHistoryEntry]:
    pool = _get_pool()
    conn = pool.getconn()
    history: List[NotesHistoryEntry] = []
    try:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute("""
                SELECT h.id, h.digest_id, h.trigger_source, h.created_at, h.snapshot
                FROM notes_digest_history h
                JOIN notes_digests d ON d.id = h.digest_id
                WHERE d.chat_id = %s
                ORDER BY h.created_at DESC
                LIMIT 50
            """, (chat_id,))
            rows = cur.fetchall()
            for row in rows:
                snapshot = row["snapshot"]
                if isinstance(snapshot, str):
                    snapshot = json.loads(snapshot)
                history.append(NotesHistoryEntry(
                    id=row["id"],
                    digest_id=row["digest_id"],
                    trigger_source=row.get("trigger_source"),
                    created_at=row["created_at"],
                    snapshot=NotesDigest(**snapshot),
                ))
    finally:
        pool.putconn(conn)
    return history
