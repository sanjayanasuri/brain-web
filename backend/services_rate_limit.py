"""
Shared rate limiting helpers.

MVP: fixed-window per-minute counters, keyed by user_id (and optionally route).
- Uses Redis when available (production).
- Falls back to in-process limiter when Redis is unavailable (dev/tests).
"""

from __future__ import annotations

import logging
import time
from typing import Optional

from demo_mode import FixedWindowRateLimiter

try:
    import redis
except Exception:  # pragma: no cover
    redis = None

from config import USE_REDIS, REDIS_URL, REDIS_HOST, REDIS_PORT, REDIS_PASSWORD, REDIS_DB

logger = logging.getLogger("brain_web")

_redis_client = None
_mem_limiter = FixedWindowRateLimiter()


def _get_redis_client():
    global _redis_client
    if not USE_REDIS or redis is None:
        return None
    if _redis_client is not None:
        return _redis_client

    try:
        if REDIS_URL:
            _redis_client = redis.from_url(REDIS_URL, decode_responses=True, socket_timeout=2)
        else:
            _redis_client = redis.Redis(
                host=REDIS_HOST,
                port=REDIS_PORT,
                db=REDIS_DB,
                password=REDIS_PASSWORD,
                decode_responses=True,
                socket_timeout=2,
            )
        _redis_client.ping()
        return _redis_client
    except Exception as e:
        logger.warning(f"[rate_limit] Redis unavailable; falling back to in-process limiter ({e})")
        _redis_client = None
        return None


def allow_fixed_window(*, key: str, limit_per_min: int, now_s: Optional[float] = None) -> bool:
    """
    Fixed-window allow check, per-minute.

    key: caller-provided identifier, e.g. "ingest:test-user".
    """
    if limit_per_min <= 0:
        return True

    now_s = now_s if now_s is not None else time.time()
    window = int(now_s // 60)
    redis_key = f"ratelimit:{key}:{window}"

    r = _get_redis_client()
    if r is not None:
        try:
            pipe = r.pipeline()
            pipe.incr(redis_key, 1)
            # TTL slightly > 60s to handle clock skew and in-flight requests.
            pipe.expire(redis_key, 75)
            count, _ = pipe.execute()
            return int(count) <= int(limit_per_min)
        except Exception:
            pass

    # Dev/test fallback.
    return _mem_limiter.allow(key, limit_per_min, now_s=now_s)

