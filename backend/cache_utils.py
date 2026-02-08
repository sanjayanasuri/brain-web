"""
Multi-level caching utilities for API responses.
Provides Memory -> Disk -> Redis (optional) caching to speed up transitions and minimize latency.
"""
import time
import json
import logging
from typing import Any, Optional, Dict, Union
from threading import Lock
from pathlib import Path

try:
    import redis
    from config import REDIS_HOST, REDIS_PORT, REDIS_DB, REDIS_PASSWORD, USE_REDIS
except ImportError:
    USE_REDIS = False

try:
    from diskcache import Cache
    HAS_DISKCACHE = True
except ImportError:
    HAS_DISKCACHE = False

from config import repo_root

logger = logging.getLogger("brain_web")

# In-memory cache storage (Level 1)
_memory_cache: Dict[str, Dict[str, Any]] = {}
_cache_lock = Lock()

# Disk cache storage (Level 2)
_disk_cache = None
if HAS_DISKCACHE:
    cache_dir = repo_root / ".cache" / "api_data"
    cache_dir.mkdir(parents=True, exist_ok=True)
    _disk_cache = Cache(str(cache_dir))

# Redis cache (Level 3)
_redis_client = None
if USE_REDIS:
    try:
        _redis_client = redis.Redis(
            host=REDIS_HOST,
            port=REDIS_PORT,
            db=REDIS_DB,
            password=REDIS_PASSWORD,
            socket_timeout=2,
            decode_responses=False # Keep bytes for pickling if needed, but we prefer JSON
        )
        _redis_client.ping()
        logger.info(f"Connected to Redis for caching at {REDIS_HOST}:{REDIS_PORT}")
    except Exception as e:
        logger.warning(f"Failed to connect to Redis: {e}. Falling back to Disk/Memory cache.")
        _redis_client = None

# Cache statistics
_cache_stats = {
    "hits_l1": 0, # Memory
    "hits_l2": 0, # Disk
    "hits_l3": 0, # Redis
    "misses": 0,
}

def _make_key(cache_name: str, *args, **kwargs) -> str:
    """Create a cache key from cache name and arguments."""
    key_parts = [cache_name]
    if args:
        key_parts.extend(str(arg) for arg in args)
    if kwargs:
        sorted_kwargs = sorted(kwargs.items())
        key_parts.extend(f"{k}={v}" for k, v in sorted_kwargs)
    return ":".join(key_parts)

def get_cached(cache_name: str, *args, **kwargs) -> Optional[Any]:
    """
    Get a value from multi-level cache.
    """
    cache_key = _make_key(cache_name, *args, **kwargs)
    
    # 1. Try Memory (L1)
    with _cache_lock:
        entry = _memory_cache.get(cache_key)
        if entry and time.time() <= entry["expires_at"]:
            _cache_stats["hits_l1"] += 1
            return entry["value"]
        elif entry:
            del _memory_cache[cache_key]

    # 2. Try Redis (L3) if enabled
    if _redis_client:
        try:
            data = _redis_client.get(cache_key)
            if data:
                value = json.loads(data)
                _cache_stats["hits_l3"] += 1
                # Promote to Memory
                set_cached(cache_name, value, *args, **kwargs)
                return value
        except Exception:
            pass

    # 3. Try Disk (L2)
    if _disk_cache:
        try:
            value = _disk_cache.get(cache_key)
            if value is not None:
                _cache_stats["hits_l2"] += 1
                # Promote to Memory/Redis
                set_cached(cache_name, value, *args, **kwargs)
                return value
        except Exception:
            pass

    _cache_stats["misses"] += 1
    return None

def set_cached(cache_name: str, value: Any, *args, ttl_seconds: int = 300, **kwargs) -> None:
    """
    Set a value in multi-level cache.
    """
    cache_key = _make_key(cache_name, *args, **kwargs)
    expires_at = time.time() + ttl_seconds

    # 1. Set Memory (L1)
    with _cache_lock:
        _memory_cache[cache_key] = {
            "value": value,
            "expires_at": expires_at,
        }

    # 2. Set Disk (L2)
    if _disk_cache:
        try:
            _disk_cache.set(cache_key, value, expire=ttl_seconds)
        except Exception:
            pass

    # 3. Set Redis (L3)
    if _redis_client:
        try:
            _redis_client.setex(cache_key, ttl_seconds, json.dumps(value))
        except Exception:
            pass

def invalidate_cache(cache_name: str, *args, **kwargs) -> None:
    """Invalidate a specific cache entry across all levels."""
    cache_key = _make_key(cache_name, *args, **kwargs)
    
    with _cache_lock:
        _memory_cache.pop(cache_key, None)
    
    if _disk_cache:
        _disk_cache.delete(cache_key)
        
    if _redis_client:
        try:
            _redis_client.delete(cache_key)
        except Exception:
            pass

def invalidate_cache_pattern(pattern: str) -> None:
    """Invalidate all cache entries matching a prefix pattern."""
    # 1. Memory
    with _cache_lock:
        keys_to_delete = [k for k in _memory_cache.keys() if k.startswith(pattern)]
        for k in keys_to_delete:
            del _memory_cache[k]
    
    # 2. Disk
    if _disk_cache:
        try:
            # diskcache doesn't have a direct pattern delete, so we clear if it's too much
            # or just iterate which might be slow. For now, simple iteration.
            keys_to_delete = [k for k in _disk_cache if isinstance(k, str) and k.startswith(pattern)]
            for k in keys_to_delete:
                _disk_cache.delete(k)
        except Exception:
            pass
            
    # 3. Redis
    if _redis_client:
        try:
            # Use SCAN to find keys without blocking
            cursor = 0
            while True:
                cursor, keys = _redis_client.scan(cursor=cursor, match=f"{pattern}*", count=100)
                if keys:
                    _redis_client.delete(*keys)
                if cursor == 0:
                    break
        except Exception:
            pass

def clear_cache() -> None:
    """Clear all cache entries across all levels."""
    with _cache_lock:
        _memory_cache.clear()
    
    if _disk_cache:
        _disk_cache.clear()
        
    if _redis_client:
        try:
            _redis_client.flushdb()
        except Exception:
            pass

def get_cache_stats() -> Dict[str, Any]:
    """Get multi-level cache statistics."""
    total_hits = _cache_stats["hits_l1"] + _cache_stats["hits_l2"] + _cache_stats["hits_l3"]
    total = total_hits + _cache_stats["misses"]
    hit_rate = total_hits / total if total > 0 else 0.0
    
    return {
        **_cache_stats,
        "total_hits": total_hits,
        "hit_rate": hit_rate,
        "memory_size": len(_memory_cache),
        "disk_size": len(_disk_cache) if _disk_cache else 0,
    }

