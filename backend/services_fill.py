from __future__ import annotations

import asyncio
import datetime
import hashlib
import json
import re
from typing import Any, Dict, List, Optional, Tuple

from neo4j import Session

from config import OPENAI_API_KEY
from models_fill import FillKind, FillResponse
from services_branch_explorer import (
    DEFAULT_BRANCH_ID,
    ensure_branch_exists,
    ensure_graph_scoping_initialized,
    ensure_graphspace_exists,
    get_active_graph_context,
)


def _now_iso() -> str:
    return datetime.datetime.utcnow().replace(tzinfo=datetime.timezone.utc).isoformat()


def _sha256_text(text: str) -> str:
    return hashlib.sha256((text or "").encode("utf-8", errors="ignore")).hexdigest()


def _stable_meta(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def parse_fill_command(command: str) -> Tuple[FillKind, str]:
    raw = (command or "").strip()
    if not raw:
        return "unknown", ""

    if raw.lower().startswith("/fill"):
        raw = raw[5:].strip()

    if not raw:
        return "unknown", ""

    m = re.match(r"^(?P<kind>diagram|diag|link|where|web|search)\s*[:\-]?\s*(?P<body>.*)$", raw, flags=re.I)
    if m:
        k = (m.group("kind") or "").lower()
        body = (m.group("body") or "").strip()
        if k in ("diagram", "diag"):
            return "diagram", body
        if k in ("web", "search"):
            return "web", body
        # "where" defaults to internal links
        if k in ("link", "where"):
            return "link", body

    # Default: treat as internal link/retrieval fill
    return "link", raw


def _upsert_fill_artifact(
    *,
    session: Session,
    graph_id: str,
    branch_id: str,
    artifact_type: str,
    title: str,
    text: str,
    metadata: Dict[str, Any],
) -> str:
    """
    Upsert a Neo4j :Artifact for /fill output.

    Uses (graph_id, url, content_hash) node key (Branch Explorer constraints).
    """
    normalized = " ".join((text or "").strip().split())
    content_hash = _sha256_text(normalized.lower())
    url = f"fill://{artifact_type}/{content_hash[:16]}"
    artifact_id = f"A{content_hash[:10].upper()}"
    now_iso = _now_iso()
    captured_at_ms = int(datetime.datetime.utcnow().timestamp() * 1000)

    meta_json = _stable_meta(
        {
            **(metadata or {}),
            "fill_artifact_type": artifact_type,
            "created_at": now_iso,
        }
    )

    session.run(
        """
        MATCH (g:GraphSpace {graph_id: $graph_id})
        MERGE (a:Artifact {graph_id: $graph_id, url: $url, content_hash: $content_hash})
        ON CREATE SET
          a.artifact_id = $artifact_id,
          a.branch_id = $branch_id,
          a.artifact_type = $artifact_type,
          a.title = $title,
          a.captured_at = $captured_at_ms,
          a.text = $text,
          a.metadata_json = $metadata_json,
          a.metadata = $metadata_json,
          a.on_branches = [$branch_id],
          a.created_at = $now,
          a.updated_at = $now
        ON MATCH SET
          a.title = COALESCE($title, a.title),
          a.text = COALESCE($text, a.text),
          a.metadata_json = COALESCE($metadata_json, a.metadata_json),
          a.metadata = COALESCE($metadata_json, a.metadata),
          a.on_branches = CASE
            WHEN a.on_branches IS NULL THEN [$branch_id]
            WHEN $branch_id IN a.on_branches THEN a.on_branches
            ELSE a.on_branches + $branch_id
          END,
          a.updated_at = $now
        MERGE (a)-[:BELONGS_TO]->(g)
        RETURN a.artifact_id AS artifact_id
        """,
        graph_id=graph_id,
        branch_id=branch_id,
        url=url,
        content_hash=content_hash,
        artifact_id=artifact_id,
        artifact_type=artifact_type,
        title=title,
        captured_at_ms=captured_at_ms,
        text=text,
        metadata_json=meta_json,
        now=now_iso,
    ).consume()

    return artifact_id


def _fallback_mermaid(topic: str) -> str:
    safe = (topic or "Topic").strip().replace('"', "'")
    return "\n".join(
        [
            "flowchart TD",
            f'  A["{safe}"]',
            "  A --> B[\"Key idea 1\"]",
            "  A --> C[\"Key idea 2\"]",
            "  A --> D[\"Key idea 3\"]",
        ]
    )


def generate_mermaid_diagram(topic: str) -> Tuple[str, List[str]]:
    """
    Best-effort Mermaid diagram generation.

    Uses OpenAI when configured; otherwise falls back to a simple skeleton.
    """
    warnings: List[str] = []
    topic = (topic or "").strip()
    if not topic:
        return _fallback_mermaid("Diagram"), ["No topic provided; generated a generic diagram skeleton."]

    if not OPENAI_API_KEY:
        return _fallback_mermaid(topic), ["OPENAI_API_KEY not configured; generated a diagram skeleton."]

    try:
        from openai import OpenAI

        client = OpenAI(api_key=OPENAI_API_KEY)
        prompt = f"""Create a Mermaid flowchart that explains: {topic}

Requirements:
- Output ONLY Mermaid code (no backticks).
- Use flowchart TD.
- Keep nodes short (<= 8 words).
- Include 6-12 nodes max.
"""
        resp = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {"role": "system", "content": "You generate Mermaid diagrams. Output only Mermaid code."},
                {"role": "user", "content": prompt},
            ],
            temperature=0.2,
            max_tokens=500,
        )
        text = (resp.choices[0].message.content or "").strip()
        # Strip accidental fences
        if text.startswith("```"):
            text = re.sub(r"^```[a-zA-Z]*\n?", "", text).strip()
            text = re.sub(r"\n?```$", "", text).strip()
        if not text:
            warnings.append("Diagram model returned empty output; using fallback.")
            return _fallback_mermaid(topic), warnings
        return text, warnings
    except Exception as e:
        warnings.append(f"Diagram generation failed ({e}); using fallback.")
        return _fallback_mermaid(topic), warnings


def _search_links(
    *,
    session: Session,
    graph_id: str,
    branch_id: str,
    query: str,
    limit: int,
) -> Dict[str, Any]:
    q = (query or "").strip()
    if not q:
        return {"artifacts": [], "quotes": []}

    # Artifacts: substring match on title/url/text (best-effort)
    artifacts = []
    for rec in session.run(
        """
        MATCH (g:GraphSpace {graph_id: $graph_id})
        MATCH (a:Artifact {graph_id: $graph_id})-[:BELONGS_TO]->(g)
        WHERE (a.on_branches IS NULL OR $branch_id IN a.on_branches)
          AND (
            toLower(COALESCE(a.title, "")) CONTAINS toLower($q)
            OR toLower(COALESCE(a.url, "")) CONTAINS toLower($q)
            OR toLower(COALESCE(a.text, "")) CONTAINS toLower($q)
          )
        RETURN a.artifact_id AS artifact_id,
               a.title AS title,
               a.url AS url,
               a.artifact_type AS artifact_type,
               a.captured_at AS captured_at
        ORDER BY a.captured_at DESC
        LIMIT $limit
        """,
        graph_id=graph_id,
        branch_id=branch_id,
        q=q,
        limit=max(1, min(int(limit), 20)),
    ):
        artifacts.append(
            {
                "artifact_id": rec.get("artifact_id"),
                "title": rec.get("title"),
                "url": rec.get("url"),
                "artifact_type": rec.get("artifact_type"),
                "captured_at": rec.get("captured_at"),
            }
        )

    # Quotes: substring match (useful for note_image OCR blocks)
    quotes = []
    for rec in session.run(
        """
        MATCH (g:GraphSpace {graph_id: $graph_id})
        MATCH (q:Quote {graph_id: $graph_id})-[:BELONGS_TO]->(g)
        WHERE (q.on_branches IS NULL OR $branch_id IN q.on_branches)
          AND toLower(COALESCE(q.text, "")) CONTAINS toLower($q)
        OPTIONAL MATCH (q)-[:FROM_ARTIFACT]->(a:Artifact {graph_id: $graph_id})-[:BELONGS_TO]->(g)
        RETURN q.quote_id AS quote_id,
               q.text AS text,
               q.anchor_json AS anchor_json,
               a.artifact_id AS artifact_id,
               a.title AS artifact_title,
               a.url AS artifact_url
        ORDER BY q.created_at DESC
        LIMIT $limit
        """,
        graph_id=graph_id,
        branch_id=branch_id,
        q=q,
        limit=max(1, min(int(limit), 20)),
    ):
        t = (rec.get("text") or "").strip()
        preview = t.replace("\n", " ")
        if len(preview) > 180:
            preview = preview[:180] + "…"
        quotes.append(
            {
                "quote_id": rec.get("quote_id"),
                "text_preview": preview,
                "anchor_json": rec.get("anchor_json"),
                "artifact_id": rec.get("artifact_id"),
                "artifact_title": rec.get("artifact_title"),
                "artifact_url": rec.get("artifact_url"),
            }
        )

    return {"artifacts": artifacts, "quotes": quotes}


def _format_link_answer(query: str, items: Dict[str, Any]) -> str:
    q = (query or "").strip()
    artifacts = items.get("artifacts") or []
    quotes = items.get("quotes") or []

    if not artifacts and not quotes:
        return f'I couldn’t find any saved matches for "{q}".'

    lines: List[str] = []
    lines.append(f'Here’s what I found for **"{q}"**:')

    if artifacts:
        lines.append("\n**Artifacts**")
        for a in artifacts[:5]:
            title = a.get("title") or a.get("artifact_type") or "Artifact"
            aid = a.get("artifact_id") or ""
            url = a.get("url") or ""
            lines.append(f"- {title} (`{aid}`) — {url}")

    if quotes:
        lines.append("\n**Anchored quotes/blocks**")
        for qt in quotes[:5]:
            qid = qt.get("quote_id") or ""
            preview = qt.get("text_preview") or ""
            aid = qt.get("artifact_id") or ""
            atitle = qt.get("artifact_title") or "Artifact"
            lines.append(f"- {preview} (`{qid}`) — from {atitle} (`{aid}`)")

    return "\n".join(lines).strip()


def _run_web_search_and_fetch(query: str, limit: int) -> Tuple[Dict[str, Any], List[str]]:
    """
    Best-effort web search using existing services_web_search.search_and_fetch.
    Runs in a private event loop for compatibility with sync callers.
    """
    warnings: List[str] = []
    try:
        from services_web_search import search_and_fetch
    except Exception as e:
        return {"results": []}, [f"Web search unavailable ({e})."]

    async def _go():
        return await search_and_fetch(query=query, num_results=max(1, min(int(limit), 5)), max_content_length=6000)

    try:
        result = asyncio.run(_go())
        return result or {"results": []}, warnings
    except Exception as e:
        warnings.append(f"Web search failed ({e}).")
        return {"results": []}, warnings


def run_fill(
    *,
    session: Session,
    command: str,
    graph_id: Optional[str] = None,
    branch_id: Optional[str] = None,
    limit: int = 5,
    tenant_id: Optional[str] = None,
) -> FillResponse:
    """
    Run a /fill command and persist the output as an Artifact for reuse.
    """
    ensure_graph_scoping_initialized(session)
    active_graph_id, active_branch_id = get_active_graph_context(session, tenant_id=tenant_id)

    use_graph_id = graph_id or active_graph_id
    if graph_id and not branch_id:
        use_branch_id = DEFAULT_BRANCH_ID
    else:
        use_branch_id = branch_id or active_branch_id

    ensure_graphspace_exists(session, use_graph_id, tenant_id=tenant_id)
    ensure_branch_exists(session, use_graph_id, use_branch_id)

    kind, body = parse_fill_command(command)
    if kind == "unknown":
        return FillResponse(status="error", kind="unknown", answer="Usage: /fill diagram: ... | /fill link: ... | /fill web: ...")

    warnings: List[str] = []

    if kind == "diagram":
        mermaid, w = generate_mermaid_diagram(body)
        warnings.extend(w)
        answer = "\n".join(["Here’s a diagram you can paste into Mermaid:", "```mermaid", mermaid.strip(), "```"]).strip()
        artifact_id = _upsert_fill_artifact(
            session=session,
            graph_id=use_graph_id,
            branch_id=use_branch_id,
            artifact_type="generated_diagram",
            title=f"Diagram: {body or 'Untitled'}",
            text=mermaid.strip(),
            metadata={"format": "mermaid", "topic": body, "command": command},
        )
        return FillResponse(
            status="ok",
            kind="diagram",
            artifact_id=artifact_id,
            answer=answer,
            data={"mermaid": mermaid},
            warnings=warnings,
        )

    if kind == "web":
        result, w = _run_web_search_and_fetch(body, limit=max(1, min(int(limit), 5)))
        warnings.extend(w)
        items = []
        for r in (result.get("results") or [])[:5]:
            sr = r.get("search_result") or {}
            fc = r.get("fetched_content") or {}
            items.append(
                {
                    "title": sr.get("title") or fc.get("title") or "",
                    "url": sr.get("url") or "",
                    "snippet": sr.get("snippet") or (fc.get("content") or "")[:200],
                }
            )

        if not items:
            answer = f'I couldn’t fetch web results for "{body}".'
        else:
            lines = [f'Web results for **"{body}"**:']
            for it in items:
                lines.append(f"- {it.get('title') or 'Result'} — {it.get('url')}")
            answer = "\n".join(lines)

        artifact_id = _upsert_fill_artifact(
            session=session,
            graph_id=use_graph_id,
            branch_id=use_branch_id,
            artifact_type="web_snapshot",
            title=f"Web snapshot: {body or 'Untitled'}",
            text=answer,
            metadata={"query": body, "items": items, "command": command},
        )
        return FillResponse(
            status="ok",
            kind="web",
            artifact_id=artifact_id,
            answer=answer,
            data={"items": items},
            warnings=warnings,
        )

    # kind == "link"
    items = _search_links(session=session, graph_id=use_graph_id, branch_id=use_branch_id, query=body, limit=limit)
    answer = _format_link_answer(body, items)
    artifact_id = _upsert_fill_artifact(
        session=session,
        graph_id=use_graph_id,
        branch_id=use_branch_id,
        artifact_type="fill_links",
        title=f"Links: {body or 'Untitled'}",
        text=answer,
        metadata={"query": body, "items": items, "command": command},
    )
    return FillResponse(
        status="ok",
        kind="link",
        artifact_id=artifact_id,
        answer=answer,
        data=items,
        warnings=warnings,
    )

