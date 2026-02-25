"""Per-user assistant profile + style prompt assembly.

OpenClaw-like personalization layer for Brain Web assistants.
"""
from __future__ import annotations

import json
from typing import Any, Dict

from db_postgres import execute_query, execute_update

DEFAULT_STYLE = {
    "assistant_name": "Bujji",
    "tone": "warm, direct, curious",
    "verbosity": "balanced",
    "teaching_mode": "practical",
    "voice_style": "calm, conversational",
    "constraints": [
        "avoid fluff",
        "be concise unless detail is requested",
        "be opinionated when useful",
        "stay non-judgmental",
    ],
}


def get_or_create_assistant_profile(*, user_id: str, tenant_id: str) -> Dict[str, Any]:
    row = execute_query(
        """
        SELECT user_id, tenant_id, profile_json, updated_at
        FROM assistant_profiles
        WHERE user_id=%s AND tenant_id=%s
        LIMIT 1
        """,
        (user_id, tenant_id),
    )
    if row:
        rec = row[0]
        return {
            "user_id": rec.get("user_id"),
            "tenant_id": rec.get("tenant_id"),
            "profile": rec.get("profile_json") or DEFAULT_STYLE,
            "updated_at": rec.get("updated_at"),
        }

    execute_update(
        """
        INSERT INTO assistant_profiles (user_id, tenant_id, profile_json)
        VALUES (%s, %s, %s::jsonb)
        ON CONFLICT (user_id, tenant_id) DO NOTHING
        """,
        (user_id, tenant_id, json.dumps(DEFAULT_STYLE)),
    )
    return {
        "user_id": user_id,
        "tenant_id": tenant_id,
        "profile": dict(DEFAULT_STYLE),
    }


def update_assistant_profile(*, user_id: str, tenant_id: str, patch: Dict[str, Any]) -> Dict[str, Any]:
    current = get_or_create_assistant_profile(user_id=user_id, tenant_id=tenant_id).get("profile") or {}
    merged = {**current, **(patch or {})}
    execute_update(
        """
        INSERT INTO assistant_profiles (user_id, tenant_id, profile_json, updated_at)
        VALUES (%s, %s, %s::jsonb, NOW())
        ON CONFLICT (user_id, tenant_id)
        DO UPDATE SET profile_json=EXCLUDED.profile_json, updated_at=NOW()
        """,
        (user_id, tenant_id, json.dumps(merged)),
    )
    return {"user_id": user_id, "tenant_id": tenant_id, "profile": merged}


def build_assistant_style_prompt(*, user_id: str, tenant_id: str) -> str:
    p = get_or_create_assistant_profile(user_id=user_id, tenant_id=tenant_id).get("profile") or DEFAULT_STYLE
    constraints = p.get("constraints") or []
    constraints_text = "\n".join([f"- {c}" for c in constraints]) if isinstance(constraints, list) else ""
    return (
        f"You are {p.get('assistant_name','Bujji')}. "
        f"Tone: {p.get('tone','warm, direct, curious')}. "
        f"Verbosity: {p.get('verbosity','balanced')}. "
        f"Teaching mode: {p.get('teaching_mode','practical')}. "
        f"Voice style: {p.get('voice_style','calm, conversational')}.\n"
        f"Behavior constraints:\n{constraints_text}\n"
        "Keep continuity across voice and text for this user."
    )
