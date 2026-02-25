#!/usr/bin/env python3
"""Periodic memory consolidation job.

- Promotes stable memory into user_profile_facts
- Optional snapshot export for debugging/transparency
"""
from __future__ import annotations

import os
import sys

BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if BACKEND_DIR not in sys.path:
    sys.path.insert(0, BACKEND_DIR)

from db_postgres import execute_query
from services_memory_consolidation import consolidate_user_memory, export_memory_snapshots


def run(snapshot: bool = True):
    users = execute_query(
        """
        SELECT DISTINCT user_id, tenant_id
        FROM conversation_memory_events
        ORDER BY tenant_id, user_id
        LIMIT 500
        """
    ) or []

    print(f"[memory-consolidation] users={len(users)}")
    for u in users:
        uid = str(u.get("user_id"))
        tid = str(u.get("tenant_id"))
        count = consolidate_user_memory(user_id=uid, tenant_id=tid)
        print(f"[memory-consolidation] user={uid} tenant={tid} upserts={count}")
        if snapshot:
            out_dir = os.path.join(BACKEND_DIR, "runtime", "memory_snapshots", tid, uid)
            paths = export_memory_snapshots(user_id=uid, tenant_id=tid, out_dir=out_dir)
            print(f"[memory-consolidation] snapshots={paths}")


if __name__ == "__main__":
    run(snapshot=os.getenv("MEMORY_SNAPSHOT_EXPORT", "true").lower() == "true")
