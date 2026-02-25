#!/usr/bin/env python3
"""Daily interest suggestion refresh job.

Builds/refreshes interest profiles and suggestion rows for active users.
"""

from __future__ import annotations

import os
import sys
from datetime import datetime, timedelta, timezone

# Ensure backend root is importable when executed directly.
BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if BACKEND_DIR not in sys.path:
    sys.path.insert(0, BACKEND_DIR)

from db_postgres import execute_query  # noqa: E402
from services_interest_recommender import (  # noqa: E402
    build_interest_profile,
    generate_content_suggestions,
)


def _active_users(window_days: int = 14):
    # Prefer users with recent conversation events or promoted memories.
    since = datetime.now(timezone.utc) - timedelta(days=window_days)
    rows = execute_query(
        """
        SELECT DISTINCT user_id, tenant_id
        FROM (
            SELECT user_id, tenant_id, created_at
            FROM conversation_memory_events
            WHERE created_at >= %s
            UNION ALL
            SELECT user_id, tenant_id, last_seen_at AS created_at
            FROM memory_promotions
            WHERE last_seen_at >= %s
        ) t
        ORDER BY tenant_id, user_id
        """,
        (since, since),
    )
    return rows or []


def run(limit_per_user: int = 3) -> int:
    users = _active_users()
    print(f"[interest-refresh] users={len(users)}")
    refreshed = 0
    for u in users:
        user_id = str(u.get("user_id"))
        tenant_id = str(u.get("tenant_id"))
        try:
            profile = build_interest_profile(user_id=user_id, tenant_id=tenant_id)
            suggestions = generate_content_suggestions(
                user_id=user_id,
                tenant_id=tenant_id,
                limit=limit_per_user,
            )
            print(
                f"[interest-refresh] user={user_id} tenant={tenant_id} "
                f"keywords={len(profile.get('keywords', []))} suggestions={len(suggestions)}"
            )
            refreshed += 1
        except Exception as e:
            print(f"[interest-refresh] ERROR user={user_id} tenant={tenant_id}: {e}")
    return refreshed


if __name__ == "__main__":
    limit = int(os.getenv("INTEREST_SUGGESTION_LIMIT_PER_USER", "3"))
    done = run(limit_per_user=limit)
    print(f"[interest-refresh] complete refreshed={done}")
