from __future__ import annotations

import time
from typing import Any, Dict
from urllib.parse import urlparse

from .config import MonitorConfig
from .monitor import MonitorPolicy, SelfHealingMonitor
from .types import ActionResult, CheckResult


def _ok(action_id: str, summary: str, *, check_id: str | None = None, details: Dict[str, Any] | None = None) -> ActionResult:
    return ActionResult(action_id=action_id, ok=True, summary=summary, check_id=check_id, details=details or {})


def _fail(
    action_id: str,
    summary: str,
    *,
    check_id: str | None = None,
    error: str | None = None,
    details: Dict[str, Any] | None = None,
) -> ActionResult:
    return ActionResult(
        action_id=action_id,
        ok=False,
        summary=summary,
        check_id=check_id,
        error=error,
        details=details or {},
    )


def build_default_monitor(*, config: MonitorConfig) -> SelfHealingMonitor:
    checks = {
        "neo4j_connectivity": _check_neo4j_connectivity,
        "postgres_connectivity": _check_postgres_connectivity,
        "qdrant_connectivity": _check_qdrant_connectivity,
        "projection_worker": _check_projection_worker,
        "ai_task_worker": _check_ai_task_worker,
        "cache_memory": lambda: _check_cache_memory(config),
    }

    actions = {
        "reset_neo4j_driver": _action_reset_neo4j_driver,
        "reset_postgres_pool": _action_reset_postgres_pool,
        "reset_qdrant_client": _action_reset_qdrant_client,
        "restart_projection_worker": _action_restart_projection_worker,
        "restart_ai_task_worker": _action_restart_ai_task_worker,
        "prune_cache_memory": lambda: _action_prune_cache_memory(config),
    }

    policy = MonitorPolicy(
        remediation_by_check={
            "neo4j_connectivity": ["reset_neo4j_driver"],
            "postgres_connectivity": ["reset_postgres_pool"],
            "qdrant_connectivity": ["reset_qdrant_client"],
            "projection_worker": ["restart_projection_worker"],
            "ai_task_worker": ["restart_ai_task_worker"],
            "cache_memory": ["prune_cache_memory"],
        }
    )

    return SelfHealingMonitor(config=config, checks=checks, actions=actions, policy=policy)


# ---------------------------------------------------------------------------
# Checks (side-effect free)
# ---------------------------------------------------------------------------


def _check_neo4j_connectivity() -> CheckResult:
    start = time.perf_counter()
    try:
        from config import NEO4J_URI, NEO4J_DATABASE
        from db_neo4j import get_driver

        driver = get_driver()
        driver.verify_connectivity()
        duration_ms = int((time.perf_counter() - start) * 1000)
        return CheckResult(
            check_id="neo4j_connectivity",
            status="healthy",
            summary="neo4j reachable",
            duration_ms=duration_ms,
            details={"database": NEO4J_DATABASE, "uri": str(NEO4J_URI)},
        )
    except Exception as e:
        duration_ms = int((time.perf_counter() - start) * 1000)
        return CheckResult(
            check_id="neo4j_connectivity",
            status="unhealthy",
            summary="neo4j unreachable",
            duration_ms=duration_ms,
            details={},
            error=str(e),
        )


def _check_postgres_connectivity() -> CheckResult:
    start = time.perf_counter()
    try:
        import db_postgres as pg
        from config import POSTGRES_CONNECTION_STRING

        conn = None
        error = False
        try:
            conn = pg.get_db_connection()
            with conn.cursor() as cur:
                cur.execute("SELECT 1")
                cur.fetchone()
            duration_ms = int((time.perf_counter() - start) * 1000)
            parsed = urlparse(POSTGRES_CONNECTION_STRING)
            return CheckResult(
                check_id="postgres_connectivity",
                status="healthy",
                summary="postgres reachable",
                duration_ms=duration_ms,
                details={
                    "host": parsed.hostname,
                    "port": parsed.port,
                    "database": (parsed.path or "").lstrip("/") or None,
                },
            )
        except Exception as e:
            error = True
            raise
        finally:
            if conn is not None:
                try:
                    pg.return_db_connection(conn, error=error)
                except Exception:
                    pass
    except Exception as e:
        duration_ms = int((time.perf_counter() - start) * 1000)
        return CheckResult(
            check_id="postgres_connectivity",
            status="unhealthy",
            summary="postgres unreachable",
            duration_ms=duration_ms,
            details={},
            error=str(e),
        )


def _check_qdrant_connectivity() -> CheckResult:
    start = time.perf_counter()
    try:
        from config import USE_QDRANT, QDRANT_HOST, QDRANT_PORT

        if not USE_QDRANT:
            duration_ms = int((time.perf_counter() - start) * 1000)
            return CheckResult(
                check_id="qdrant_connectivity",
                status="healthy",
                summary="qdrant disabled",
                duration_ms=duration_ms,
                details={"enabled": False},
            )

        from vector_store_content_qdrant import get_client as get_content_client

        client = get_content_client()
        client.get_collections()
        duration_ms = int((time.perf_counter() - start) * 1000)
        return CheckResult(
            check_id="qdrant_connectivity",
            status="healthy",
            summary="qdrant reachable",
            duration_ms=duration_ms,
            details={"host": QDRANT_HOST, "port": QDRANT_PORT},
        )
    except Exception as e:
        duration_ms = int((time.perf_counter() - start) * 1000)
        return CheckResult(
            check_id="qdrant_connectivity",
            status="unhealthy",
            summary="qdrant unreachable",
            duration_ms=duration_ms,
            details={},
            error=str(e),
        )


def _check_projection_worker() -> CheckResult:
    start = time.perf_counter()
    try:
        from events import background as mod

        q = getattr(mod, "_task_queue", None)
        if q is None:
            duration_ms = int((time.perf_counter() - start) * 1000)
            return CheckResult(
                check_id="projection_worker",
                status="unhealthy",
                summary="projection queue not initialized",
                duration_ms=duration_ms,
                details={"initialized": False},
            )

        thread = getattr(q, "worker_thread", None)
        alive = bool(thread and thread.is_alive())
        running = bool(getattr(q, "running", False))
        queue_size = int(getattr(getattr(q, "queue", None), "qsize", lambda: 0)())
        processing = len(getattr(q, "processing", set()) or set())

        status = "healthy" if (running and alive) else "unhealthy"
        duration_ms = int((time.perf_counter() - start) * 1000)
        return CheckResult(
            check_id="projection_worker",
            status=status,
            summary="projection worker running" if status == "healthy" else "projection worker not running",
            duration_ms=duration_ms,
            details={
                "initialized": True,
                "running": running,
                "thread_alive": alive,
                "queue_size": queue_size,
                "processing": processing,
            },
        )
    except Exception as e:
        duration_ms = int((time.perf_counter() - start) * 1000)
        return CheckResult(
            check_id="projection_worker",
            status="unhealthy",
            summary="projection worker check failed",
            duration_ms=duration_ms,
            details={},
            error=str(e),
        )


def _check_ai_task_worker() -> CheckResult:
    start = time.perf_counter()
    try:
        import services_task_queue as mod

        q = getattr(mod, "_task_queue", None)
        if q is None:
            duration_ms = int((time.perf_counter() - start) * 1000)
            return CheckResult(
                check_id="ai_task_worker",
                status="unhealthy",
                summary="task queue not initialized",
                duration_ms=duration_ms,
                details={"initialized": False},
            )

        thread = getattr(q, "worker_thread", None)
        alive = bool(thread and thread.is_alive())
        running = bool(getattr(q, "running", False))
        queue_size = int(getattr(getattr(q, "queue", None), "qsize", lambda: 0)())
        processing = len(getattr(q, "processing", set()) or set())

        status = "healthy" if (running and alive) else "unhealthy"
        duration_ms = int((time.perf_counter() - start) * 1000)
        return CheckResult(
            check_id="ai_task_worker",
            status=status,
            summary="task worker running" if status == "healthy" else "task worker not running",
            duration_ms=duration_ms,
            details={
                "initialized": True,
                "running": running,
                "thread_alive": alive,
                "queue_size": queue_size,
                "processing": processing,
            },
        )
    except Exception as e:
        duration_ms = int((time.perf_counter() - start) * 1000)
        return CheckResult(
            check_id="ai_task_worker",
            status="unhealthy",
            summary="task worker check failed",
            duration_ms=duration_ms,
            details={},
            error=str(e),
        )


def _check_cache_memory(config: MonitorConfig) -> CheckResult:
    start = time.perf_counter()
    try:
        from cache_utils import get_cache_stats

        stats = get_cache_stats()
        memory_size = int(stats.get("memory_size") or 0)
        warn = int(config.cache_memory_warn_entries)
        max_entries = int(config.cache_memory_max_entries)

        if max_entries and memory_size > max_entries:
            status = "unhealthy"
            summary = f"memory cache over limit ({memory_size}>{max_entries})"
        elif warn and memory_size > warn:
            status = "degraded"
            summary = f"memory cache high ({memory_size}>{warn})"
        else:
            status = "healthy"
            summary = "memory cache ok"

        duration_ms = int((time.perf_counter() - start) * 1000)
        return CheckResult(
            check_id="cache_memory",
            status=status,
            summary=summary,
            duration_ms=duration_ms,
            details={"memory_size": memory_size, "warn": warn, "max": max_entries},
        )
    except Exception as e:
        duration_ms = int((time.perf_counter() - start) * 1000)
        return CheckResult(
            check_id="cache_memory",
            status="unhealthy",
            summary="cache stats failed",
            duration_ms=duration_ms,
            details={},
            error=str(e),
        )


# ---------------------------------------------------------------------------
# Remediations (side-effectful)
# ---------------------------------------------------------------------------


def _action_reset_neo4j_driver() -> ActionResult:
    try:
        from db_neo4j import reset_driver

        reset_driver()
        return _ok("reset_neo4j_driver", "neo4j driver reset")
    except Exception as e:
        return _fail("reset_neo4j_driver", "neo4j driver reset failed", error=str(e))


def _action_reset_postgres_pool() -> ActionResult:
    try:
        import db_postgres as pg

        pg.reset_pool()
        return _ok("reset_postgres_pool", "postgres pool reset")
    except Exception as e:
        return _fail("reset_postgres_pool", "postgres pool reset failed", error=str(e))


def _action_reset_qdrant_client() -> ActionResult:
    try:
        from vector_store_content_qdrant import reset_client as reset_content

        reset_content()
        try:
            from vector_store_qdrant import reset_client as reset_concepts

            reset_concepts()
        except Exception:
            pass
        return _ok("reset_qdrant_client", "qdrant clients reset")
    except Exception as e:
        return _fail("reset_qdrant_client", "qdrant client reset failed", error=str(e))


def _action_restart_projection_worker() -> ActionResult:
    try:
        from events import background as mod

        q = getattr(mod, "_task_queue", None)
        if q is None:
            mod.get_task_queue()
            return _ok("restart_projection_worker", "projection queue started")

        thread = getattr(q, "worker_thread", None)
        alive = bool(thread and thread.is_alive())
        if not alive:
            try:
                q.running = False
            except Exception:
                pass
            q.start_worker()
            return _ok("restart_projection_worker", "projection worker restarted")

        return _ok("restart_projection_worker", "projection worker already running")
    except Exception as e:
        return _fail("restart_projection_worker", "projection worker restart failed", error=str(e))


def _action_restart_ai_task_worker() -> ActionResult:
    try:
        import services_task_queue as mod

        q = getattr(mod, "_task_queue", None)
        if q is None:
            mod.get_task_queue()
            return _ok("restart_ai_task_worker", "task queue started")

        thread = getattr(q, "worker_thread", None)
        alive = bool(thread and thread.is_alive())
        if not alive:
            try:
                q.running = False
            except Exception:
                pass
            q.start_worker()
            return _ok("restart_ai_task_worker", "task worker restarted")

        return _ok("restart_ai_task_worker", "task worker already running")
    except Exception as e:
        return _fail("restart_ai_task_worker", "task worker restart failed", error=str(e))


def _action_prune_cache_memory(config: MonitorConfig) -> ActionResult:
    try:
        from cache_utils import prune_memory_cache

        target = int(config.cache_memory_target_entries)
        stats = prune_memory_cache(max_entries=target if target > 0 else None)
        return _ok("prune_cache_memory", "memory cache pruned", details=stats)
    except Exception as e:
        return _fail("prune_cache_memory", "memory cache prune failed", error=str(e))

