from __future__ import annotations

import json
from datetime import datetime
from typing import Any, Dict, List, Optional
from uuid import uuid4

from neo4j import Session


def _now_iso() -> str:
    return datetime.utcnow().replace(microsecond=0).isoformat() + "Z"


def _coerce_str_list(value: Any) -> List[str]:
    if value is None:
        return []
    if isinstance(value, list):
        out: List[str] = []
        for item in value:
            s = str(item).strip()
            if s:
                out.append(s)
        return out
    if isinstance(value, str):
        # Accept comma/newline delimited strings
        parts = [p.strip() for p in value.replace("\r", "\n").replace(",", "\n").split("\n")]
        return [p for p in parts if p]
    return []


def _coerce_refresh_defaults(value: Any) -> Optional[Dict[str, Any]]:
    if value is None:
        return None
    if isinstance(value, dict):
        return dict(value)
    if isinstance(value, str):
        raw = value.strip()
        if not raw:
            return None
        parsed = json.loads(raw)
        if parsed is None:
            return None
        if not isinstance(parsed, dict):
            raise ValueError("refresh_defaults must be a JSON object")
        return parsed
    raise ValueError("refresh_defaults must be an object or JSON string")


def _coerce_json_object(value: Any, *, field_name: str) -> Optional[Dict[str, Any]]:
    if value is None:
        return None
    if isinstance(value, dict):
        return dict(value)
    if isinstance(value, str):
        raw = value.strip()
        if not raw:
            return None
        parsed = json.loads(raw)
        if parsed is None:
            return None
        if not isinstance(parsed, dict):
            raise ValueError(f"{field_name} must be a JSON object")
        return parsed
    raise ValueError(f"{field_name} must be an object or JSON string")


def _serialize_template_record(record: Dict[str, Any]) -> Dict[str, Any]:
    refresh_defaults = None
    raw_refresh = record.get("refresh_defaults_json")
    if raw_refresh:
        try:
            parsed = json.loads(raw_refresh) if isinstance(raw_refresh, str) else raw_refresh
            if isinstance(parsed, dict):
                refresh_defaults = parsed
        except Exception:
            refresh_defaults = None
    node_layout = None
    raw_layout = record.get("node_layout_json")
    if raw_layout:
        try:
            parsed_layout = json.loads(raw_layout) if isinstance(raw_layout, str) else raw_layout
            if isinstance(parsed_layout, dict):
                node_layout = parsed_layout
        except Exception:
            node_layout = None

    return {
        "template_id": record.get("template_id"),
        "template_family_id": record.get("template_family_id") or record.get("template_id"),
        "version": int(record.get("version") or 1),
        "parent_template_id": record.get("parent_template_id"),
        "label": record.get("label"),
        "description": record.get("description"),
        "vertical": record.get("vertical"),
        "tags": _coerce_str_list(record.get("tags")),
        "intent": record.get("intent"),
        "node_types": _coerce_str_list(record.get("node_types")),
        "starter_nodes": _coerce_str_list(record.get("starter_nodes")),
        "node_layout": node_layout,
        "default_checks": _coerce_str_list(record.get("default_checks")),
        "connection_patterns": _coerce_str_list(record.get("connection_patterns")),
        "refresh_defaults": refresh_defaults,
        "tenant_id": record.get("tenant_id"),
        "created_by_user_id": record.get("created_by_user_id"),
        "created_at": record.get("created_at"),
        "updated_at": record.get("updated_at"),
        "is_builtin": False,
    }


def _next_template_version(session: Session, *, tenant_id: str, template_family_id: str) -> int:
    rec = session.run(
        """
        MATCH (t:GraphTemplate {tenant_id: $tenant_id})
        WHERE COALESCE(t.archived, false) = false
          AND COALESCE(t.template_family_id, t.template_id) = $template_family_id
        RETURN COALESCE(MAX(COALESCE(t.version, 1)), 0) AS max_version
        """,
        tenant_id=tenant_id,
        template_family_id=template_family_id,
    ).single()
    max_version = int((rec or {}).get("max_version") or 0)
    return max_version + 1


def list_templates(
    session: Session,
    *,
    tenant_id: str,
    user_id: Optional[str] = None,
) -> List[Dict[str, Any]]:
    rows = session.run(
        """
        MATCH (t:GraphTemplate {tenant_id: $tenant_id})
        WHERE COALESCE(t.archived, false) = false
        RETURN t.template_id AS template_id,
               COALESCE(t.template_family_id, t.template_id) AS template_family_id,
               COALESCE(t.version, 1) AS version,
               t.parent_template_id AS parent_template_id,
               t.label AS label,
               t.description AS description,
               t.vertical AS vertical,
               t.tags AS tags,
               t.intent AS intent,
               t.node_types AS node_types,
               t.starter_nodes AS starter_nodes,
               t.node_layout_json AS node_layout_json,
               t.default_checks AS default_checks,
               t.connection_patterns AS connection_patterns,
               t.refresh_defaults_json AS refresh_defaults_json,
               t.tenant_id AS tenant_id,
               t.created_by_user_id AS created_by_user_id,
               t.created_at AS created_at,
               t.updated_at AS updated_at
        ORDER BY COALESCE(t.updated_at, t.created_at) DESC, t.label ASC
        """,
        tenant_id=tenant_id,
    )
    return [_serialize_template_record(dict(r)) for r in rows]


def get_template(
    session: Session,
    *,
    template_id: str,
    tenant_id: str,
) -> Dict[str, Any]:
    rec = session.run(
        """
        MATCH (t:GraphTemplate {tenant_id: $tenant_id, template_id: $template_id})
        WHERE COALESCE(t.archived, false) = false
        RETURN t.template_id AS template_id,
               COALESCE(t.template_family_id, t.template_id) AS template_family_id,
               COALESCE(t.version, 1) AS version,
               t.parent_template_id AS parent_template_id,
               t.label AS label,
               t.description AS description,
               t.vertical AS vertical,
               t.tags AS tags,
               t.intent AS intent,
               t.node_types AS node_types,
               t.starter_nodes AS starter_nodes,
               t.node_layout_json AS node_layout_json,
               t.default_checks AS default_checks,
               t.connection_patterns AS connection_patterns,
               t.refresh_defaults_json AS refresh_defaults_json,
               t.tenant_id AS tenant_id,
               t.created_by_user_id AS created_by_user_id,
               t.created_at AS created_at,
               t.updated_at AS updated_at
        LIMIT 1
        """,
        tenant_id=tenant_id,
        template_id=template_id,
    ).single()
    if not rec:
        raise ValueError("Template not found")
    return _serialize_template_record(dict(rec))


def create_template(
    session: Session,
    *,
    tenant_id: str,
    user_id: str,
    payload: Dict[str, Any],
) -> Dict[str, Any]:
    label = str(payload.get("label") or "").strip()
    if not label:
        raise ValueError("Template label is required")

    description = str(payload.get("description") or "").strip() or None
    vertical = str(payload.get("vertical") or "").strip() or None
    intent = str(payload.get("intent") or "").strip() or None
    tags = _coerce_str_list(payload.get("tags"))
    node_types = _coerce_str_list(payload.get("node_types"))
    starter_nodes = _coerce_str_list(payload.get("starter_nodes"))
    node_layout = _coerce_json_object(payload.get("node_layout"), field_name="node_layout")
    default_checks = _coerce_str_list(payload.get("default_checks"))
    connection_patterns = _coerce_str_list(payload.get("connection_patterns"))
    refresh_defaults = _coerce_refresh_defaults(payload.get("refresh_defaults"))
    parent_template_id = str(payload.get("parent_template_id") or "").strip() or None

    now = _now_iso()
    template_id = f"TPL_{uuid4().hex[:10].upper()}"
    template_family_id = str(payload.get("template_family_id") or "").strip() or template_id
    version = int(payload.get("version") or 1)

    rec = session.run(
        """
        CREATE (t:GraphTemplate {
          template_id: $template_id,
          tenant_id: $tenant_id,
          created_by_user_id: $user_id,
          template_family_id: $template_family_id,
          version: $version,
          parent_template_id: $parent_template_id,
          label: $label,
          description: $description,
          vertical: $vertical,
          tags: $tags,
          intent: $intent,
          node_types: $node_types,
          starter_nodes: $starter_nodes,
          node_layout_json: $node_layout_json,
          default_checks: $default_checks,
          connection_patterns: $connection_patterns,
          refresh_defaults_json: $refresh_defaults_json,
          archived: false,
          created_at: $now,
          updated_at: $now
        })
        RETURN t.template_id AS template_id,
               COALESCE(t.template_family_id, t.template_id) AS template_family_id,
               COALESCE(t.version, 1) AS version,
               t.parent_template_id AS parent_template_id,
               t.label AS label,
               t.description AS description,
               t.vertical AS vertical,
               t.tags AS tags,
               t.intent AS intent,
               t.node_types AS node_types,
               t.starter_nodes AS starter_nodes,
               t.node_layout_json AS node_layout_json,
               t.default_checks AS default_checks,
               t.connection_patterns AS connection_patterns,
               t.refresh_defaults_json AS refresh_defaults_json,
               t.tenant_id AS tenant_id,
               t.created_by_user_id AS created_by_user_id,
               t.created_at AS created_at,
               t.updated_at AS updated_at
        """,
        template_id=template_id,
        tenant_id=tenant_id,
        user_id=user_id,
        template_family_id=template_family_id,
        version=version,
        parent_template_id=parent_template_id,
        label=label,
        description=description,
        vertical=vertical,
        tags=tags,
        intent=intent,
        node_types=node_types,
        starter_nodes=starter_nodes,
        node_layout_json=json.dumps(node_layout) if node_layout is not None else None,
        default_checks=default_checks,
        connection_patterns=connection_patterns,
        refresh_defaults_json=json.dumps(refresh_defaults) if refresh_defaults is not None else None,
        now=now,
    ).single()
    if not rec:
        raise RuntimeError("Failed to create template")
    return _serialize_template_record(dict(rec))


def update_template(
    session: Session,
    *,
    template_id: str,
    tenant_id: str,
    user_id: str,
    payload: Dict[str, Any],
) -> Dict[str, Any]:
    current = get_template(session, template_id=template_id, tenant_id=tenant_id)

    label = str(payload.get("label") or current.get("label") or "").strip()
    if not label:
        raise ValueError("Template label is required")

    description = current.get("description") if "description" not in payload else (str(payload.get("description") or "").strip() or None)
    vertical = current.get("vertical") if "vertical" not in payload else (str(payload.get("vertical") or "").strip() or None)
    intent = current.get("intent") if "intent" not in payload else (str(payload.get("intent") or "").strip() or None)
    tags = current.get("tags", []) if "tags" not in payload else _coerce_str_list(payload.get("tags"))
    node_types = current.get("node_types", []) if "node_types" not in payload else _coerce_str_list(payload.get("node_types"))
    starter_nodes = current.get("starter_nodes", []) if "starter_nodes" not in payload else _coerce_str_list(payload.get("starter_nodes"))
    node_layout = (
        current.get("node_layout")
        if "node_layout" not in payload
        else _coerce_json_object(payload.get("node_layout"), field_name="node_layout")
    )
    default_checks = current.get("default_checks", []) if "default_checks" not in payload else _coerce_str_list(payload.get("default_checks"))
    connection_patterns = (
        current.get("connection_patterns", [])
        if "connection_patterns" not in payload
        else _coerce_str_list(payload.get("connection_patterns"))
    )
    refresh_defaults = (
        current.get("refresh_defaults")
        if "refresh_defaults" not in payload
        else _coerce_refresh_defaults(payload.get("refresh_defaults"))
    )

    rec = session.run(
        """
        MATCH (t:GraphTemplate {tenant_id: $tenant_id, template_id: $template_id})
        WHERE COALESCE(t.archived, false) = false
        SET t.label = $label,
            t.description = $description,
            t.vertical = $vertical,
            t.intent = $intent,
            t.tags = $tags,
            t.node_types = $node_types,
            t.starter_nodes = $starter_nodes,
            t.node_layout_json = $node_layout_json,
            t.default_checks = $default_checks,
            t.connection_patterns = $connection_patterns,
            t.refresh_defaults_json = $refresh_defaults_json,
            t.updated_at = $now
        RETURN t.template_id AS template_id,
               COALESCE(t.template_family_id, t.template_id) AS template_family_id,
               COALESCE(t.version, 1) AS version,
               t.parent_template_id AS parent_template_id,
               t.label AS label,
               t.description AS description,
               t.vertical AS vertical,
               t.tags AS tags,
               t.intent AS intent,
               t.node_types AS node_types,
               t.starter_nodes AS starter_nodes,
               t.node_layout_json AS node_layout_json,
               t.default_checks AS default_checks,
               t.connection_patterns AS connection_patterns,
               t.refresh_defaults_json AS refresh_defaults_json,
               t.tenant_id AS tenant_id,
               t.created_by_user_id AS created_by_user_id,
               t.created_at AS created_at,
               t.updated_at AS updated_at
        LIMIT 1
        """,
        tenant_id=tenant_id,
        template_id=template_id,
        label=label,
        description=description,
        vertical=vertical,
        intent=intent,
        tags=tags,
        node_types=node_types,
        starter_nodes=starter_nodes,
        node_layout_json=json.dumps(node_layout) if node_layout is not None else None,
        default_checks=default_checks,
        connection_patterns=connection_patterns,
        refresh_defaults_json=json.dumps(refresh_defaults) if refresh_defaults is not None else None,
        now=_now_iso(),
    ).single()
    if not rec:
        raise ValueError("Template not found")
    return _serialize_template_record(dict(rec))


def delete_template(
    session: Session,
    *,
    template_id: str,
    tenant_id: str,
) -> None:
    summary = session.run(
        """
        MATCH (t:GraphTemplate {tenant_id: $tenant_id, template_id: $template_id})
        DETACH DELETE t
        """,
        tenant_id=tenant_id,
        template_id=template_id,
    ).consume()
    if summary.counters.nodes_deleted == 0:
        raise ValueError("Template not found")


def clone_template(
    session: Session,
    *,
    template_id: str,
    tenant_id: str,
    user_id: str,
    mode: str = "clone",
    label: Optional[str] = None,
) -> Dict[str, Any]:
    source = get_template(session, template_id=template_id, tenant_id=tenant_id)
    mode_norm = str(mode or "clone").strip().lower()
    if mode_norm not in {"clone", "version"}:
        raise ValueError("mode must be 'clone' or 'version'")

    source_family = str(source.get("template_family_id") or source.get("template_id"))
    source_version = int(source.get("version") or 1)

    if mode_norm == "version":
        family_id = source_family
        next_version = _next_template_version(session, tenant_id=tenant_id, template_family_id=family_id)
        new_label = label.strip() if isinstance(label, str) and label.strip() else source.get("label")
        version_value = next_version
    else:
        family_id = ""  # create_template will set family to its own template_id
        version_value = 1
        new_label = label.strip() if isinstance(label, str) and label.strip() else f"{source.get('label')} (Copy)"

    payload = {
        "label": new_label,
        "description": source.get("description"),
        "vertical": source.get("vertical"),
        "tags": source.get("tags") or [],
        "intent": source.get("intent"),
        "node_types": source.get("node_types") or [],
        "starter_nodes": source.get("starter_nodes") or [],
        "node_layout": source.get("node_layout"),
        "default_checks": source.get("default_checks") or [],
        "connection_patterns": source.get("connection_patterns") or [],
        "refresh_defaults": source.get("refresh_defaults"),
        "parent_template_id": source.get("template_id"),
    }
    if mode_norm == "version":
        payload["template_family_id"] = family_id
        payload["version"] = version_value

    created = create_template(session, tenant_id=tenant_id, user_id=user_id, payload=payload)
    created["clone_mode"] = mode_norm
    created["source_template_id"] = source.get("template_id")
    created["source_version"] = source_version
    return created


def export_template(
    session: Session,
    *,
    template_id: str,
    tenant_id: str,
) -> Dict[str, Any]:
    template = get_template(session, template_id=template_id, tenant_id=tenant_id)
    return {
        "schema_version": 1,
        "kind": "brainweb_template_export",
        "exported_at": _now_iso(),
        "template": {
            "template_id": template.get("template_id"),
            "template_family_id": template.get("template_family_id"),
            "version": template.get("version"),
            "parent_template_id": template.get("parent_template_id"),
            "label": template.get("label"),
            "description": template.get("description"),
            "vertical": template.get("vertical"),
            "tags": template.get("tags") or [],
            "intent": template.get("intent"),
            "node_types": template.get("node_types") or [],
            "starter_nodes": template.get("starter_nodes") or [],
            "node_layout": template.get("node_layout"),
            "default_checks": template.get("default_checks") or [],
            "connection_patterns": template.get("connection_patterns") or [],
            "refresh_defaults": template.get("refresh_defaults"),
        },
    }


def import_template(
    session: Session,
    *,
    tenant_id: str,
    user_id: str,
    export_payload: Dict[str, Any],
    mode: str = "clone",
    label_override: Optional[str] = None,
) -> Dict[str, Any]:
    if not isinstance(export_payload, dict):
        raise ValueError("export_payload must be an object")

    template_obj = export_payload.get("template")
    if not isinstance(template_obj, dict):
        # Accept raw template objects too.
        template_obj = export_payload
    if not isinstance(template_obj, dict):
        raise ValueError("Invalid template export payload")

    mode_norm = str(mode or "clone").strip().lower()
    if mode_norm not in {"clone", "version"}:
        raise ValueError("mode must be 'clone' or 'version'")

    source_family = str(template_obj.get("template_family_id") or template_obj.get("template_id") or "").strip()
    payload = {
        "label": (label_override.strip() if isinstance(label_override, str) and label_override.strip() else str(template_obj.get("label") or "").strip()),
        "description": template_obj.get("description"),
        "vertical": template_obj.get("vertical"),
        "tags": template_obj.get("tags") or [],
        "intent": template_obj.get("intent"),
        "node_types": template_obj.get("node_types") or [],
        "starter_nodes": template_obj.get("starter_nodes") or [],
        "node_layout": template_obj.get("node_layout"),
        "default_checks": template_obj.get("default_checks") or [],
        "connection_patterns": template_obj.get("connection_patterns") or [],
        "refresh_defaults": template_obj.get("refresh_defaults"),
        "parent_template_id": template_obj.get("template_id"),
    }
    if not payload["label"]:
        raise ValueError("Imported template is missing a label")

    if mode_norm == "version" and source_family:
        payload["template_family_id"] = source_family
        payload["version"] = _next_template_version(session, tenant_id=tenant_id, template_family_id=source_family)
        if not label_override:
            payload["label"] = payload["label"]
    elif not label_override:
        payload["label"] = f"{payload['label']} (Imported)"

    created = create_template(session, tenant_id=tenant_id, user_id=user_id, payload=payload)
    created["import_mode"] = mode_norm
    return created
