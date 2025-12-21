import json
import os
import time
import uuid
from dataclasses import dataclass
from typing import Dict, Iterable, Optional, Tuple

from fastapi import HTTPException, Request, Response


def _truthy(v: str) -> bool:
    return v.lower() in ("true", "1", "yes", "y", "on")


@dataclass(frozen=True)
class DemoSettings:
    demo_mode: bool
    allow_writes: bool
    tenant_id: str
    safe_write_paths: Tuple[str, ...]
    rate_ip_per_min: int
    rate_session_per_min: int
    bedrock_tokens_per_session_cap: int


def load_demo_settings() -> DemoSettings:
    from config import (
        DEMO_MODE,
        DEMO_ALLOW_WRITES,
        DEMO_TENANT_ID,
        DEMO_SAFE_WRITE_PATHS,
        DEMO_RATE_LIMIT_PER_IP_PER_MIN,
        DEMO_RATE_LIMIT_PER_SESSION_PER_MIN,
        DEMO_BEDROCK_MAX_TOKENS_PER_SESSION,
    )

    return DemoSettings(
        demo_mode=bool(DEMO_MODE),
        allow_writes=bool(DEMO_ALLOW_WRITES),
        tenant_id=str(DEMO_TENANT_ID or "demo"),
        safe_write_paths=tuple(DEMO_SAFE_WRITE_PATHS or []),
        rate_ip_per_min=int(DEMO_RATE_LIMIT_PER_IP_PER_MIN),
        rate_session_per_min=int(DEMO_RATE_LIMIT_PER_SESSION_PER_MIN),
        bedrock_tokens_per_session_cap=int(DEMO_BEDROCK_MAX_TOKENS_PER_SESSION),
    )


def get_or_create_session_id(request: Request) -> str:
    # Prefer explicit header if frontend wants to persist across browsers (optional)
    sid = request.headers.get("x-session-id") or request.cookies.get("bw_session_id")
    if sid and len(sid) <= 128:
        return sid
    return uuid.uuid4().hex


def set_session_cookie(response: Response, session_id: str) -> None:
    # Cookie is non-sensitive; helps anonymous sessions + rate limits + analytics correlation
    secure_cookie = os.getenv("NODE_ENV", "development") == "production"
    response.set_cookie(
        key="bw_session_id",
        value=session_id,
        httponly=True,
        secure=secure_cookie,
        samesite="lax",
        max_age=60 * 60 * 24 * 7,
    )


def get_client_ip(request: Request) -> str:
    # ALB adds X-Forwarded-For; take the first hop
    xff = request.headers.get("x-forwarded-for")
    if xff:
        return xff.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


class FixedWindowRateLimiter:
    """
    Minimal in-process rate limiter (good enough for single-task dev).
    In production, prefer WAF rate-based rules + (optional) shared store (DynamoDB).
    """

    def __init__(self) -> None:
        self._buckets: Dict[str, Tuple[int, int]] = {}
        # key -> (window_epoch_minute, count)

    def allow(self, key: str, limit_per_min: int, now_s: Optional[float] = None) -> bool:
        if limit_per_min <= 0:
            return True
        now_s = now_s if now_s is not None else time.time()
        window = int(now_s // 60)
        prev = self._buckets.get(key)
        if not prev or prev[0] != window:
            self._buckets[key] = (window, 1)
            return True
        if prev[1] >= limit_per_min:
            return False
        self._buckets[key] = (window, prev[1] + 1)
        return True


def is_write_method(method: str) -> bool:
    return method.upper() in ("POST", "PUT", "PATCH", "DELETE")


def path_is_blocked_in_demo(path: str) -> bool:
    # Always blocked in demo (no private integrations / no admin surface / no ingestion)
    blocked_prefixes = (
        "/admin",
        "/notion",
        "/debug",
        "/tests",
        "/connectors",  # Block connector ingestion endpoints (SEC, News, Prices sync)
        "/finance",     # Block finance ingestion endpoint
    )
    return any(path.startswith(p) for p in blocked_prefixes)


def path_is_safe_write(path: str, safe_paths: Iterable[str]) -> bool:
    # Exact match or prefix match (to allow e.g. "/feedback" subtree)
    for p in safe_paths:
        if path == p or path.startswith(p.rstrip("/") + "/"):
            return True
    return False


def enforce_demo_mode_request(
    request: Request,
    settings: DemoSettings,
    limiter: FixedWindowRateLimiter,
) -> None:
    if not settings.demo_mode:
        return

    path = request.url.path
    method = request.method
    
    # Log demo mode enforcement for debugging
    import logging
    logger = logging.getLogger("brain_web")
    
    if path_is_blocked_in_demo(path):
        logger.warning(structured_log_line({
            "event": "demo_blocked",
            "path": path,
            "method": method,
            "reason": "blocked_path"
        }))
        raise HTTPException(status_code=403, detail="Disabled in demo mode")

    if is_write_method(method):
        if not settings.allow_writes and not path_is_safe_write(path, settings.safe_write_paths):
            logger.warning(structured_log_line({
                "event": "demo_write_blocked",
                "path": path,
                "method": method,
                "allow_writes": settings.allow_writes,
                "safe_paths": list(settings.safe_write_paths),
                "reason": "read_only_demo"
            }))
            raise HTTPException(status_code=405, detail="Read-only demo")
        else:
            logger.info(structured_log_line({
                "event": "demo_write_allowed",
                "path": path,
                "method": method,
                "allow_writes": settings.allow_writes,
                "is_safe_path": path_is_safe_write(path, settings.safe_write_paths)
            }))

    # Rate limits (per IP + per session)
    ip = get_client_ip(request)
    sid = get_or_create_session_id(request)

    if not limiter.allow(f"ip:{ip}", settings.rate_ip_per_min):
        logger.warning(structured_log_line({
            "event": "rate_limit_exceeded",
            "type": "ip",
            "ip": ip,
            "limit": settings.rate_ip_per_min
        }))
        raise HTTPException(status_code=429, detail="Rate limited")
    if not limiter.allow(f"sid:{sid}", settings.rate_session_per_min):
        logger.warning(structured_log_line({
            "event": "rate_limit_exceeded",
            "type": "session",
            "session_id": sid,
            "limit": settings.rate_session_per_min
        }))
        raise HTTPException(status_code=429, detail="Rate limited")


def structured_log_line(payload: dict) -> str:
    return json.dumps(payload, separators=(",", ":"), ensure_ascii=False)


