"""Unified minimal home feed API."""
from __future__ import annotations

from datetime import datetime, timedelta
from typing import Any, Dict, List

from fastapi import APIRouter, Depends

from auth import require_auth
from db_neo4j import get_neo4j_session
from db_postgres import execute_query
from services_interest_recommender import get_recent_suggestions

router = APIRouter(prefix="/home", tags=["home"])


def _today_window_iso() -> tuple[str, str]:
    now = datetime.utcnow()
    start = datetime(now.year, now.month, now.day)
    end = start + timedelta(days=1)
    return start.isoformat(), end.isoformat()


@router.get("/feed")
def get_home_feed(user_ctx=Depends(require_auth), session=Depends(get_neo4j_session)) -> Dict[str, Any]:
    user_id = user_ctx.user_id
    tenant_id = user_ctx.tenant_id

    # 1) Today's tasks (minimal)
    start_iso, end_iso = _today_window_iso()
    tasks_query = """
    MATCH (t:Task)
    WHERE ($tenant_id = 'default' OR t.tenant_id = $tenant_id OR t.tenant_id IS NULL)
      AND (t.due_date IS NULL OR t.due_date >= $start_iso)
      AND (t.due_date IS NULL OR t.due_date < $end_iso OR t.due_date <= $end_iso)
    RETURN t.id AS id,
           t.title AS title,
           coalesce(t.priority, 'medium') AS priority,
           t.due_date AS due_date
    ORDER BY
      CASE coalesce(t.priority, 'medium') WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END,
      coalesce(t.due_date, '9999-12-31T00:00:00') ASC
    LIMIT 5
    """
    tasks_res = session.run(tasks_query, tenant_id=tenant_id, start_iso=start_iso, end_iso=end_iso)
    tasks = [dict(r) for r in tasks_res]

    # 2) Suggested reads (already personalized)
    picks = get_recent_suggestions(user_id=user_id, tenant_id=tenant_id, limit=3)

    # 3) Lightweight continuity summary from latest chat history (Postgres)
    continuity: List[str] = []
    try:
        rows = execute_query(
            """
            SELECT content
            FROM chat_messages
            WHERE user_id=%s AND tenant_id=%s AND role='user'
            ORDER BY created_at DESC
            LIMIT 3
            """,
            (str(user_id), str(tenant_id)),
        ) or []
        continuity = [str(r.get("content") or "")[:180] for r in rows if r.get("content")]
    except Exception:
        continuity = []

    capture_new_count = 0
    try:
        cap_rows = execute_query(
            """
            SELECT COUNT(*)::int AS c
            FROM capture_inbox
            WHERE user_id=%s AND tenant_id=%s AND status='new'
            """,
            (str(user_id), str(tenant_id)),
        ) or []
        if cap_rows:
            capture_new_count = int(cap_rows[0].get("c") or 0)
    except Exception:
        capture_new_count = 0

    return {
        "today": {
            "tasks": tasks,
            "task_count": len(tasks),
        },
        "picks": picks,
        "continuity": continuity,
        "capture_inbox": {
            "new_count": capture_new_count,
        },
    }
