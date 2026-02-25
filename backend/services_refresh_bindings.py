"""
Generic per-node/workspace refresh bindings for live updates.

This module is intentionally vertical-agnostic:
- Workspaces (GraphSpace) can define refresh defaults
- Concepts (nodes) can define refresh bindings / overrides
- A refresh run executes generic checks and stores outputs as normal Resources

The concrete check implementations currently support a few generic retrieval kinds
(`live_metric`, `exa_answer`, `exa_news`, `search_and_fetch`) but the binding schema
is designed so more kinds can be added without changing the UI model.
"""

from __future__ import annotations

import hashlib
import json
import logging
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional, Tuple

from neo4j import Session

from models import Resource
from services_branch_explorer import ensure_graph_scoping_initialized, get_active_graph_context
from services_resources import create_resource, link_resource_to_concept
from services_web_search import (
    answer_web,
    search_and_fetch,
    search_exa_news,
    search_live_market_data,
)

logger = logging.getLogger("brain_web")

CONCEPT_REFRESH_CONFIG_PROP = "refresh_config_json"
CONCEPT_REFRESH_STATE_PROP = "refresh_state_json"
GRAPH_REFRESH_DEFAULTS_PROP = "refresh_defaults_json"

DEFAULT_TTL_SECONDS = 3600


def _utcnow() -> datetime:
    return datetime.utcnow().replace(microsecond=0)


def _utcnow_iso() -> str:
    return _utcnow().isoformat() + "Z"


def _parse_iso(value: Optional[str]) -> Optional[datetime]:
    if not value or not isinstance(value, str):
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00")).replace(tzinfo=None)
    except Exception:
        return None


def _json_load(raw: Any) -> Dict[str, Any]:
    if not raw:
        return {}
    if isinstance(raw, dict):
        return dict(raw)
    if isinstance(raw, str):
        try:
            out = json.loads(raw)
            return out if isinstance(out, dict) else {}
        except Exception:
            return {}
    return {}


def _json_dump(value: Dict[str, Any]) -> str:
    return json.dumps(value or {}, separators=(",", ":"), ensure_ascii=True)


def _default_refresh_config() -> Dict[str, Any]:
    return {
        "version": 1,
        "enabled": False,
        "inherit_workspace_defaults": True,
        "triggers": ["manual"],
        "ttl_seconds": DEFAULT_TTL_SECONDS,
        "checks": [],
    }


def _normalize_trigger_list(value: Any) -> List[str]:
    allowed = {"manual", "on_open", "scheduled"}
    out: List[str] = []
    for item in value or []:
        s = str(item).strip().lower()
        if s and s in allowed and s not in out:
            out.append(s)
    if not out:
        out = ["manual"]
    return out


def _normalize_check_config(raw: Dict[str, Any], idx: int) -> Dict[str, Any]:
    kind = str(raw.get("kind") or "").strip()
    query = str(raw.get("query") or "").strip()
    title = str(raw.get("title") or "").strip() or None
    params = raw.get("params") if isinstance(raw.get("params"), dict) else {}
    enabled = bool(raw.get("enabled", True))
    check_id = str(raw.get("check_id") or "").strip()
    if not check_id:
        basis = f"{kind}|{query}|{idx}"
        check_id = "chk_" + hashlib.sha1(basis.encode("utf-8")).hexdigest()[:10]
    return {
        "check_id": check_id,
        "kind": kind,
        "query": query,
        "title": title,
        "enabled": enabled,
        "params": params,
    }


def normalize_refresh_config(raw: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    cfg = _default_refresh_config()
    incoming = dict(raw or {})
    if "enabled" in incoming:
        cfg["enabled"] = bool(incoming.get("enabled"))
    if "inherit_workspace_defaults" in incoming:
        cfg["inherit_workspace_defaults"] = bool(incoming.get("inherit_workspace_defaults"))
    if "triggers" in incoming:
        cfg["triggers"] = _normalize_trigger_list(incoming.get("triggers"))
    ttl = incoming.get("ttl_seconds")
    try:
        ttl_int = int(ttl) if ttl is not None else cfg["ttl_seconds"]
    except Exception:
        ttl_int = cfg["ttl_seconds"]
    cfg["ttl_seconds"] = max(30, min(7 * 24 * 3600, ttl_int))

    checks_raw = incoming.get("checks")
    checks: List[Dict[str, Any]] = []
    if isinstance(checks_raw, list):
        for idx, item in enumerate(checks_raw):
            if isinstance(item, dict):
                normalized = _normalize_check_config(item, idx)
                if normalized["kind"] and normalized["query"]:
                    checks.append(normalized)
    cfg["checks"] = checks
    return cfg


def _merge_checks(default_checks: List[Dict[str, Any]], override_checks: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    merged: List[Dict[str, Any]] = []
    seen_ids = set()
    for item in default_checks + override_checks:
        check_id = item.get("check_id")
        if check_id and check_id in seen_ids:
            # Replace previous entry with latest override.
            merged = [c for c in merged if c.get("check_id") != check_id]
        if check_id:
            seen_ids.add(check_id)
        merged.append(item)
    return merged


def merge_refresh_configs(
    workspace_defaults: Optional[Dict[str, Any]],
    concept_config: Optional[Dict[str, Any]],
) -> Dict[str, Any]:
    ws = normalize_refresh_config(workspace_defaults or {})
    concept_raw = dict(concept_config or {})
    concept = normalize_refresh_config(concept_raw)

    inherit_defaults = bool(concept.get("inherit_workspace_defaults", True))
    if not inherit_defaults:
        return concept

    merged = _default_refresh_config()
    # Only override workspace values when the node explicitly set that field.
    merged["enabled"] = bool(concept["enabled"]) if "enabled" in concept_raw else bool(ws.get("enabled", False))
    merged["inherit_workspace_defaults"] = True
    merged["triggers"] = _normalize_trigger_list(concept["triggers"] if "triggers" in concept_raw else ws.get("triggers"))
    merged["ttl_seconds"] = int(
        concept["ttl_seconds"] if "ttl_seconds" in concept_raw else (ws.get("ttl_seconds") or DEFAULT_TTL_SECONDS)
    )
    merged["checks"] = _merge_checks(
        list(ws.get("checks") or []),
        list(concept.get("checks") or []),
    )
    return normalize_refresh_config(merged)


def _compute_refresh_status(
    *,
    effective_config: Dict[str, Any],
    state: Dict[str, Any],
    now: Optional[datetime] = None,
) -> Dict[str, Any]:
    current = now or _utcnow()
    enabled = bool(effective_config.get("enabled"))
    ttl_seconds = int(effective_config.get("ttl_seconds") or DEFAULT_TTL_SECONDS)
    last_run_at = state.get("last_run_at")
    last_success_at = state.get("last_success_at")
    last_success_dt = _parse_iso(last_success_at)
    next_due_at = None
    is_stale = False
    age_seconds: Optional[int] = None
    if enabled:
        if last_success_dt:
            age_seconds = max(0, int((current - last_success_dt).total_seconds()))
            next_due_dt = last_success_dt + timedelta(seconds=ttl_seconds)
            next_due_at = next_due_dt.isoformat() + "Z"
            is_stale = current >= next_due_dt
        else:
            is_stale = True

    return {
        "enabled": enabled,
        "triggers": list(effective_config.get("triggers") or []),
        "ttl_seconds": ttl_seconds,
        "check_count": len([c for c in (effective_config.get("checks") or []) if c.get("enabled", True)]),
        "is_stale": bool(is_stale),
        "age_seconds": age_seconds,
        "last_run_at": last_run_at,
        "last_success_at": last_success_at,
        "next_due_at": next_due_at,
        "last_status": state.get("last_status"),
        "last_trigger": state.get("last_trigger"),
        "last_error": state.get("last_error"),
    }


def _get_active_graph_context(session: Session, *, tenant_id: str, user_id: str) -> Tuple[str, str]:
    ensure_graph_scoping_initialized(session)
    return get_active_graph_context(session, tenant_id=tenant_id, user_id=user_id)


def _get_graph_refresh_defaults_raw(session: Session, *, graph_id: str, tenant_id: str) -> Dict[str, Any]:
    rec = session.run(
        f"""
        MATCH (g:GraphSpace {{graph_id: $graph_id, tenant_id: $tenant_id}})
        RETURN g.graph_id AS graph_id,
               g.{GRAPH_REFRESH_DEFAULTS_PROP} AS refresh_defaults_json
        LIMIT 1
        """,
        graph_id=graph_id,
        tenant_id=tenant_id,
    ).single()
    if not rec:
        raise ValueError(f"Graph '{graph_id}' not found")
    return {
        "graph_id": rec["graph_id"],
        "refresh_defaults": _json_load(rec.get("refresh_defaults_json")),
    }


def get_graph_refresh_defaults(session: Session, *, graph_id: str, tenant_id: str) -> Dict[str, Any]:
    out = _get_graph_refresh_defaults_raw(session, graph_id=graph_id, tenant_id=tenant_id)
    out["refresh_defaults"] = normalize_refresh_config(out.get("refresh_defaults"))
    return out


def set_graph_refresh_defaults(
    session: Session,
    *,
    graph_id: str,
    tenant_id: str,
    refresh_defaults: Dict[str, Any],
) -> Dict[str, Any]:
    normalized = normalize_refresh_config(refresh_defaults)
    rec = session.run(
        f"""
        MATCH (g:GraphSpace {{graph_id: $graph_id, tenant_id: $tenant_id}})
        SET g.{GRAPH_REFRESH_DEFAULTS_PROP} = $refresh_defaults_json
        RETURN g.graph_id AS graph_id,
               g.{GRAPH_REFRESH_DEFAULTS_PROP} AS refresh_defaults_json
        LIMIT 1
        """,
        graph_id=graph_id,
        tenant_id=tenant_id,
        refresh_defaults_json=_json_dump(normalized),
    ).single()
    if not rec:
        raise ValueError(f"Graph '{graph_id}' not found")
    return {"graph_id": rec["graph_id"], "refresh_defaults": normalize_refresh_config(_json_load(rec.get("refresh_defaults_json")))}


def get_concept_refresh_binding(
    session: Session,
    *,
    concept_id: str,
    tenant_id: str,
    user_id: str,
) -> Dict[str, Any]:
    graph_id, branch_id = _get_active_graph_context(session, tenant_id=tenant_id, user_id=user_id)
    rec = session.run(
        f"""
        MATCH (g:GraphSpace {{graph_id: $graph_id, tenant_id: $tenant_id}})
        MATCH (c:Concept {{node_id: $concept_id, graph_id: $graph_id}})-[:BELONGS_TO]->(g)
        WHERE $branch_id IN COALESCE(c.on_branches, [])
        RETURN c.node_id AS concept_id,
               c.name AS concept_name,
               c.graph_id AS graph_id,
               c.{CONCEPT_REFRESH_CONFIG_PROP} AS refresh_config_json,
               c.{CONCEPT_REFRESH_STATE_PROP} AS refresh_state_json,
               g.{GRAPH_REFRESH_DEFAULTS_PROP} AS graph_refresh_defaults_json
        LIMIT 1
        """,
        graph_id=graph_id,
        branch_id=branch_id,
        concept_id=concept_id,
        tenant_id=tenant_id,
    ).single()
    if not rec:
        raise ValueError(f"Concept '{concept_id}' not found in active graph")

    concept_config = normalize_refresh_config(_json_load(rec.get("refresh_config_json")))
    graph_defaults = normalize_refresh_config(_json_load(rec.get("graph_refresh_defaults_json")))
    state = _json_load(rec.get("refresh_state_json"))
    effective = merge_refresh_configs(graph_defaults, concept_config)
    status = _compute_refresh_status(effective_config=effective, state=state)

    return {
        "concept": {
            "concept_id": rec["concept_id"],
            "name": rec["concept_name"],
            "graph_id": rec["graph_id"],
        },
        "config": concept_config,
        "workspace_defaults": graph_defaults,
        "effective_config": effective,
        "state": state,
        "status": status,
    }


def set_concept_refresh_binding(
    session: Session,
    *,
    concept_id: str,
    tenant_id: str,
    user_id: str,
    refresh_config: Dict[str, Any],
) -> Dict[str, Any]:
    graph_id, branch_id = _get_active_graph_context(session, tenant_id=tenant_id, user_id=user_id)
    normalized = normalize_refresh_config(refresh_config)
    rec = session.run(
        f"""
        MATCH (g:GraphSpace {{graph_id: $graph_id, tenant_id: $tenant_id}})
        MATCH (c:Concept {{node_id: $concept_id, graph_id: $graph_id}})-[:BELONGS_TO]->(g)
        WHERE $branch_id IN COALESCE(c.on_branches, [])
        SET c.{CONCEPT_REFRESH_CONFIG_PROP} = $refresh_config_json
        RETURN c.node_id AS concept_id
        LIMIT 1
        """,
        graph_id=graph_id,
        branch_id=branch_id,
        tenant_id=tenant_id,
        concept_id=concept_id,
        refresh_config_json=_json_dump(normalized),
    ).single()
    if not rec:
        raise ValueError(f"Concept '{concept_id}' not found in active graph")
    return get_concept_refresh_binding(session, concept_id=concept_id, tenant_id=tenant_id, user_id=user_id)


def _set_concept_refresh_state(
    session: Session,
    *,
    concept_id: str,
    tenant_id: str,
    user_id: str,
    state: Dict[str, Any],
) -> None:
    graph_id, branch_id = _get_active_graph_context(session, tenant_id=tenant_id, user_id=user_id)
    session.run(
        f"""
        MATCH (g:GraphSpace {{graph_id: $graph_id, tenant_id: $tenant_id}})
        MATCH (c:Concept {{node_id: $concept_id, graph_id: $graph_id}})-[:BELONGS_TO]->(g)
        WHERE $branch_id IN COALESCE(c.on_branches, [])
        SET c.{CONCEPT_REFRESH_STATE_PROP} = $refresh_state_json
        """,
        graph_id=graph_id,
        branch_id=branch_id,
        tenant_id=tenant_id,
        concept_id=concept_id,
        refresh_state_json=_json_dump(state),
    ).consume()


def _resource_to_dict(resource: Resource) -> Dict[str, Any]:
    if hasattr(resource, "dict"):
        return resource.dict()
    return {
        "resource_id": getattr(resource, "resource_id", None),
        "kind": getattr(resource, "kind", None),
        "url": getattr(resource, "url", None),
        "title": getattr(resource, "title", None),
        "mime_type": getattr(resource, "mime_type", None),
        "caption": getattr(resource, "caption", None),
        "source": getattr(resource, "source", None),
        "metadata": getattr(resource, "metadata", None),
        "created_at": getattr(resource, "created_at", None),
    }


def _build_refresh_resource_url(concept_id: str, check: Dict[str, Any], suffix: str = "") -> str:
    check_id = check.get("check_id") or "check"
    tail = f"/{suffix}" if suffix else ""
    return f"brainweb://refresh/{concept_id}/{check_id}{tail}"


def _render_check_text_template(value: Optional[str], *, concept_name: str, concept_id: str) -> Optional[str]:
    if value is None:
        return None
    text = str(value)
    if not text:
        return text
    return (
        text.replace("{{concept_name}}", concept_name)
        .replace("{concept_name}", concept_name)
        .replace("{{concept_id}}", concept_id)
        .replace("{concept_id}", concept_id)
    )


def _create_refresh_resource(
    session: Session,
    *,
    concept_id: str,
    concept_name: str,
    check: Dict[str, Any],
    result_kind: str,
    title: str,
    caption: str,
    url: str,
    source: str,
    metadata: Dict[str, Any],
    tenant_id: str,
    user_id: str,
) -> Resource:
    resource = create_resource(
        session=session,
        kind=result_kind,
        url=url,
        title=title,
        caption=caption[:4000] if caption else None,
        source=source,
        metadata=metadata,
        tenant_id=tenant_id,
        user_id=user_id,
    )
    link_resource_to_concept(
        session=session,
        concept_id=concept_id,
        resource_id=resource.resource_id,
        tenant_id=tenant_id,
        user_id=user_id,
    )
    return resource


async def _run_refresh_check(
    session: Session,
    *,
    concept_id: str,
    concept_name: str,
    check: Dict[str, Any],
    tenant_id: str,
    user_id: str,
    trigger: str,
) -> Dict[str, Any]:
    kind = str(check.get("kind") or "").strip().lower()
    query = str(
        _render_check_text_template(check.get("query"), concept_name=concept_name, concept_id=concept_id) or ""
    ).strip()
    rendered_title = _render_check_text_template(check.get("title"), concept_name=concept_name, concept_id=concept_id)
    params = check.get("params") if isinstance(check.get("params"), dict) else {}
    if not kind or not query:
        return {"check_id": check.get("check_id"), "status": "skipped", "reason": "missing_kind_or_query"}

    base_meta = {
        "type": "refresh_check_result",
        "concept_id": concept_id,
        "concept_name": concept_name,
        "check_id": check.get("check_id"),
        "check_kind": kind,
        "check_query": query,
        "check_query_template": check.get("query"),
        "trigger": trigger,
        "refreshed_at": _utcnow_iso(),
    }

    if kind == "live_metric":
        result = await search_live_market_data(query)
        if not result:
            return {"check_id": check.get("check_id"), "status": "failed", "error": "No live metric result"}
        structured = result.get("structured_data") or {}
        resource = _create_refresh_resource(
            session=session,
            concept_id=concept_id,
            concept_name=concept_name,
            check=check,
            result_kind="metric_snapshot",
            title=result.get("title") or f"Live Metric: {concept_name}",
            caption=(result.get("content") or result.get("snippet") or "")[:1000],
            url=result.get("url") or _build_refresh_resource_url(concept_id, check, "live-metric"),
            source=result.get("engine") or "live_metric",
            metadata={
                **base_meta,
                "is_realtime": bool(result.get("is_realtime")),
                "structured_data": structured,
                "source_result": result,
                "rendered_query": query,
            },
            tenant_id=tenant_id,
            user_id=user_id,
        )
        return {
            "check_id": check.get("check_id"),
            "status": "success",
            "resource": _resource_to_dict(resource),
            "summary": {"kind": "live_metric", "provider": result.get("engine"), "title": result.get("title")},
        }

    if kind == "exa_answer":
        answer = await answer_web(
            query=query,
            category=params.get("category"),
            policy_name=params.get("policy_name"),
            content_mode=params.get("content_mode"),
            content_max_length=params.get("content_max_length", 12000),
            max_age_hours=params.get("max_age_hours"),
            include_domains=params.get("include_domains"),
            exclude_domains=params.get("exclude_domains"),
            prefer_realtime_only=bool(params.get("prefer_realtime_only", False)),
            use_learning_schema=bool(params.get("use_learning_schema", False)),
        )
        if not answer:
            return {"check_id": check.get("check_id"), "status": "failed", "error": "No Exa answer result"}
        citations = answer.get("citations") if isinstance(answer.get("citations"), list) else []
        first_url = None
        for c in citations:
            if isinstance(c, dict) and c.get("url"):
                first_url = c.get("url")
                break
        resource = _create_refresh_resource(
            session=session,
            concept_id=concept_id,
            concept_name=concept_name,
            check=check,
            result_kind="web_link",
            title=f"Refresh Answer: {rendered_title or query}",
            caption=(answer.get("answer") or "")[:2000],
            url=str(first_url or _build_refresh_resource_url(concept_id, check, "exa-answer")),
            source="exa_answer",
            metadata={**base_meta, "answer_result": answer, "rendered_query": query},
            tenant_id=tenant_id,
            user_id=user_id,
        )
        return {
            "check_id": check.get("check_id"),
            "status": "success",
            "resource": _resource_to_dict(resource),
            "summary": {"kind": "exa_answer", "citations": len(citations)},
        }

    if kind == "exa_news":
        limit = max(1, min(20, int(params.get("limit", 6) or 6)))
        max_age_hours = params.get("max_age_hours", 6)
        try:
            max_age_hours_int = int(max_age_hours) if max_age_hours is not None else 6
        except Exception:
            max_age_hours_int = 6
        items = await search_exa_news(query, limit=limit, max_age_hours=max_age_hours_int)
        headlines = [
            {
                "title": item.get("title"),
                "url": item.get("url"),
                "snippet": item.get("snippet"),
                "metadata": item.get("metadata"),
            }
            for item in (items or [])[:limit]
        ]
        caption_lines = [f"{idx + 1}. {h.get('title')}" for idx, h in enumerate(headlines[:8]) if h.get("title")]
        caption = "\n".join(caption_lines) if caption_lines else f"No recent headlines found for {query}"
        resource = _create_refresh_resource(
            session=session,
            concept_id=concept_id,
            concept_name=concept_name,
            check=check,
            result_kind="web_link",
            title=f"Refresh News: {rendered_title or query}",
            caption=caption,
            url=_build_refresh_resource_url(concept_id, check, "exa-news"),
            source="exa_news",
            metadata={**base_meta, "headlines": headlines, "query": query, "rendered_query": query},
            tenant_id=tenant_id,
            user_id=user_id,
        )
        return {
            "check_id": check.get("check_id"),
            "status": "success",
            "resource": _resource_to_dict(resource),
            "summary": {"kind": "exa_news", "headline_count": len(headlines)},
        }

    if kind in {"search_and_fetch", "web_search"}:
        num_results = max(1, min(5, int(params.get("num_results", 3) or 3)))
        max_content_length = max(1000, min(30000, int(params.get("max_content_length", 8000) or 8000)))
        result = await search_and_fetch(
            query=query,
            num_results=num_results,
            max_content_length=max_content_length,
            time_range=params.get("time_range"),
        )
        rows = result.get("results") if isinstance(result.get("results"), list) else []
        sources = []
        for item in rows[:10]:
            s = item.get("search_result") or {}
            sources.append({"title": s.get("title"), "url": s.get("url"), "snippet": s.get("snippet")})
        caption = "\n".join([f"{i+1}. {s.get('title')}" for i, s in enumerate(sources[:8]) if s.get("title")]) or f"No results for {query}"
        resource = _create_refresh_resource(
            session=session,
            concept_id=concept_id,
            concept_name=concept_name,
            check=check,
            result_kind="web_link",
            title=f"Refresh Search: {rendered_title or query}",
            caption=caption,
            url=_build_refresh_resource_url(concept_id, check, "search"),
            source="web_search_refresh",
            metadata={**base_meta, "search_result": result, "rendered_query": query},
            tenant_id=tenant_id,
            user_id=user_id,
        )
        return {
            "check_id": check.get("check_id"),
            "status": "success",
            "resource": _resource_to_dict(resource),
            "summary": {"kind": "search_and_fetch", "result_count": len(rows)},
        }

    return {"check_id": check.get("check_id"), "status": "skipped", "reason": f"Unsupported check kind '{kind}'"}


async def run_concept_refresh(
    session: Session,
    *,
    concept_id: str,
    tenant_id: str,
    user_id: str,
    trigger: str = "manual",
    force: bool = False,
) -> Dict[str, Any]:
    binding = get_concept_refresh_binding(session, concept_id=concept_id, tenant_id=tenant_id, user_id=user_id)
    concept = binding["concept"]
    effective = binding["effective_config"]
    current_state = dict(binding.get("state") or {})
    status = binding["status"]
    trigger_norm = str(trigger or "manual").strip().lower()
    now_iso = _utcnow_iso()

    if not effective.get("enabled"):
        return {
            "ok": True,
            "run_status": "skipped",
            "skip_reason": "disabled",
            "binding": binding,
            "resources_created": [],
            "resources_created_count": 0,
        }

    triggers = set(effective.get("triggers") or [])
    if not force and trigger_norm not in triggers:
        return {
            "ok": True,
            "run_status": "skipped",
            "skip_reason": "trigger_not_enabled",
            "binding": binding,
            "resources_created": [],
            "resources_created_count": 0,
        }

    if not force and trigger_norm == "on_open" and not status.get("is_stale"):
        return {
            "ok": True,
            "run_status": "skipped",
            "skip_reason": "fresh",
            "binding": binding,
            "resources_created": [],
            "resources_created_count": 0,
        }

    checks = [c for c in (effective.get("checks") or []) if c.get("enabled", True)]
    if not checks:
        next_state = {
            **current_state,
            "last_run_at": now_iso,
            "last_trigger": trigger_norm,
            "last_status": "skipped",
            "last_error": "No checks configured",
        }
        _set_concept_refresh_state(session, concept_id=concept_id, tenant_id=tenant_id, user_id=user_id, state=next_state)
        updated_binding = get_concept_refresh_binding(session, concept_id=concept_id, tenant_id=tenant_id, user_id=user_id)
        return {
            "ok": True,
            "run_status": "skipped",
            "skip_reason": "no_checks",
            "binding": updated_binding,
            "resources_created": [],
            "resources_created_count": 0,
        }

    check_results: List[Dict[str, Any]] = []
    resources_created: List[Dict[str, Any]] = []
    last_error = None

    for check in checks:
        try:
            result = await _run_refresh_check(
                session,
                concept_id=concept["concept_id"],
                concept_name=concept["name"],
                check=check,
                tenant_id=tenant_id,
                user_id=user_id,
                trigger=trigger_norm,
            )
        except Exception as e:
            logger.error("Refresh check failed for concept %s check %s: %s", concept_id, check.get("check_id"), e, exc_info=True)
            result = {"check_id": check.get("check_id"), "status": "failed", "error": str(e)}

        check_results.append(result)
        resource_obj = result.get("resource")
        if isinstance(resource_obj, dict):
            resources_created.append(resource_obj)
        if result.get("status") == "failed" and not last_error:
            last_error = result.get("error") or "Refresh check failed"

    success_count = sum(1 for r in check_results if r.get("status") == "success")
    failed_count = sum(1 for r in check_results if r.get("status") == "failed")
    if success_count and failed_count:
        run_status = "partial"
    elif success_count:
        run_status = "success"
    else:
        run_status = "failed"

    checks_state: Dict[str, Any] = dict(current_state.get("checks") or {})
    for result in check_results:
        check_id = str(result.get("check_id") or "")
        if not check_id:
            continue
        check_entry = {
            "last_run_at": now_iso,
            "status": result.get("status"),
        }
        if result.get("status") == "success":
            check_entry["last_success_at"] = now_iso
            res = result.get("resource")
            if isinstance(res, dict) and res.get("resource_id"):
                check_entry["last_resource_id"] = res.get("resource_id")
        if result.get("error"):
            check_entry["last_error"] = result.get("error")
        checks_state[check_id] = {**checks_state.get(check_id, {}), **check_entry}

    next_state = {
        **current_state,
        "version": 1,
        "last_run_at": now_iso,
        "last_trigger": trigger_norm,
        "last_status": run_status,
        "last_error": last_error,
        "last_run_summary": {
            "success_count": success_count,
            "failed_count": failed_count,
            "resource_count": len(resources_created),
            "trigger": trigger_norm,
            "forced": bool(force),
        },
        "checks": checks_state,
    }
    if success_count > 0:
        next_state["last_success_at"] = now_iso
    _set_concept_refresh_state(session, concept_id=concept_id, tenant_id=tenant_id, user_id=user_id, state=next_state)

    updated_binding = get_concept_refresh_binding(session, concept_id=concept_id, tenant_id=tenant_id, user_id=user_id)
    return {
        "ok": True,
        "run_status": run_status,
        "binding": updated_binding,
        "resources_created": resources_created,
        "resources_created_count": len(resources_created),
        "check_results": check_results,
    }


def list_refresh_scheduler_contexts(
    session: Session,
    *,
    tenant_id: Optional[str] = None,
    limit: int = 100,
) -> List[Dict[str, str]]:
    """
    Enumerate graph-context user profiles for scheduled refresh processing.
    """
    limit_int = max(1, min(int(limit or 100), 1000))
    rows = session.run(
        """
        MATCH (u:UserProfile)
        WHERE COALESCE(u.context_kind, 'graph_context') = 'graph_context'
          AND u.user_id IS NOT NULL
          AND u.user_id <> ''
          AND ($tenant_id IS NULL OR u.tenant_id = $tenant_id)
        RETURN DISTINCT u.user_id AS user_id, COALESCE(u.tenant_id, '') AS tenant_id
        LIMIT $limit
        """,
        tenant_id=tenant_id,
        limit=limit_int,
    )
    out: List[Dict[str, str]] = []
    for rec in rows:
        user_id = str(rec.get("user_id") or "").strip()
        tenant_val = str(rec.get("tenant_id") or "").strip()
        if not user_id or not tenant_val:
            continue
        out.append({"user_id": user_id, "tenant_id": tenant_val})
    return out


def _iter_scheduled_refresh_candidates_for_active_context(
    session: Session,
    *,
    tenant_id: str,
    user_id: str,
    scan_limit: int,
) -> Tuple[str, str, List[Dict[str, Any]]]:
    graph_id, branch_id = _get_active_graph_context(session, tenant_id=tenant_id, user_id=user_id)
    try:
        graph_defaults = get_graph_refresh_defaults(session, graph_id=graph_id, tenant_id=tenant_id).get("refresh_defaults") or {}
    except Exception:
        graph_defaults = {}
    graph_defaults_norm = normalize_refresh_config(graph_defaults)

    scan_limit_int = max(1, min(int(scan_limit or 200), 2000))
    rows = session.run(
        f"""
        MATCH (g:GraphSpace {{graph_id: $graph_id, tenant_id: $tenant_id}})
        MATCH (c:Concept {{graph_id: $graph_id}})-[:BELONGS_TO]->(g)
        WHERE $branch_id IN COALESCE(c.on_branches, [])
        RETURN c.node_id AS concept_id,
               c.name AS concept_name,
               c.{CONCEPT_REFRESH_CONFIG_PROP} AS refresh_config_json,
               c.{CONCEPT_REFRESH_STATE_PROP} AS refresh_state_json
        LIMIT $scan_limit
        """,
        graph_id=graph_id,
        tenant_id=tenant_id,
        branch_id=branch_id,
        scan_limit=scan_limit_int,
    )

    candidates: List[Dict[str, Any]] = []
    for rec in rows:
        concept_config = normalize_refresh_config(_json_load(rec.get("refresh_config_json")))
        effective = merge_refresh_configs(graph_defaults_norm, concept_config)
        if not bool(effective.get("enabled")):
            continue
        triggers = set(effective.get("triggers") or [])
        if "scheduled" not in triggers:
            continue
        state = _json_load(rec.get("refresh_state_json"))
        status = _compute_refresh_status(effective_config=effective, state=state)
        candidates.append(
            {
                "concept_id": rec.get("concept_id"),
                "concept_name": rec.get("concept_name"),
                "effective_config": effective,
                "status": status,
            }
        )
    return graph_id, branch_id, candidates


async def run_due_refreshes_for_active_context(
    session: Session,
    *,
    tenant_id: str,
    user_id: str,
    limit_nodes: int = 10,
    scan_limit: int = 200,
    force: bool = False,
) -> Dict[str, Any]:
    graph_id, branch_id, candidates = _iter_scheduled_refresh_candidates_for_active_context(
        session,
        tenant_id=tenant_id,
        user_id=user_id,
        scan_limit=scan_limit,
    )
    limit_nodes_int = max(1, min(int(limit_nodes or 10), 100))
    due_candidates = [c for c in candidates if force or bool(c.get("status", {}).get("is_stale"))]
    due_candidates.sort(
        key=lambda c: (
            c.get("status", {}).get("next_due_at") or "",
            c.get("status", {}).get("last_success_at") or "",
            str(c.get("concept_id") or ""),
        )
    )

    runs: List[Dict[str, Any]] = []
    for candidate in due_candidates[:limit_nodes_int]:
        concept_id = str(candidate.get("concept_id") or "")
        if not concept_id:
            continue
        try:
            result = await run_concept_refresh(
                session=session,
                concept_id=concept_id,
                tenant_id=tenant_id,
                user_id=user_id,
                trigger="scheduled",
                force=force,
            )
            runs.append(
                {
                    "concept_id": concept_id,
                    "run_status": result.get("run_status"),
                    "skip_reason": result.get("skip_reason"),
                    "resources_created_count": int(result.get("resources_created_count") or 0),
                }
            )
        except Exception as e:
            logger.error(
                "Scheduled refresh failed (tenant=%s user=%s graph=%s branch=%s concept=%s): %s",
                tenant_id,
                user_id,
                graph_id,
                branch_id,
                concept_id,
                e,
                exc_info=True,
            )
            runs.append(
                {
                    "concept_id": concept_id,
                    "run_status": "failed",
                    "error": str(e),
                    "resources_created_count": 0,
                }
            )

    return {
        "tenant_id": tenant_id,
        "user_id": user_id,
        "graph_id": graph_id,
        "branch_id": branch_id,
        "candidates_scanned": len(candidates),
        "candidates_due": len(due_candidates),
        "runs_attempted": len(runs),
        "runs_triggered": sum(1 for r in runs if r.get("run_status") not in {"skipped"}),
        "runs_skipped": sum(1 for r in runs if r.get("run_status") == "skipped"),
        "runs_failed": sum(1 for r in runs if r.get("run_status") == "failed"),
        "resources_created": sum(int(r.get("resources_created_count") or 0) for r in runs),
        "runs": runs,
    }


async def run_due_refreshes_for_all_active_contexts(
    session: Session,
    *,
    tenant_id: Optional[str] = None,
    limit_contexts: int = 25,
    limit_nodes_per_context: int = 10,
    scan_limit_per_context: int = 200,
    force: bool = False,
) -> Dict[str, Any]:
    contexts = list_refresh_scheduler_contexts(session, tenant_id=tenant_id, limit=limit_contexts)
    summaries: List[Dict[str, Any]] = []
    contexts_processed = 0
    runs_triggered = 0
    runs_failed = 0
    resources_created = 0

    for ctx in contexts:
        user_id = str(ctx.get("user_id") or "").strip()
        tenant_val = str(ctx.get("tenant_id") or "").strip()
        if not user_id or not tenant_val:
            continue
        try:
            summary = await run_due_refreshes_for_active_context(
                session,
                tenant_id=tenant_val,
                user_id=user_id,
                limit_nodes=limit_nodes_per_context,
                scan_limit=scan_limit_per_context,
                force=force,
            )
            contexts_processed += 1
            runs_triggered += int(summary.get("runs_triggered") or 0)
            runs_failed += int(summary.get("runs_failed") or 0)
            resources_created += int(summary.get("resources_created") or 0)
            summaries.append(summary)
        except Exception as e:
            contexts_processed += 1
            runs_failed += 1
            logger.error(
                "Scheduled refresh context failed (tenant=%s user=%s): %s",
                tenant_val,
                user_id,
                e,
                exc_info=True,
            )
            summaries.append({"tenant_id": tenant_val, "user_id": user_id, "error": str(e)})

    return {
        "contexts_found": len(contexts),
        "contexts_processed": contexts_processed,
        "runs_triggered": runs_triggered,
        "runs_failed": runs_failed,
        "resources_created": resources_created,
        "context_summaries": summaries,
    }
