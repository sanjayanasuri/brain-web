"""
Simple in-memory caching utilities for API responses.
Provides TTL-based caching to speed up frequently accessed data.

Usage:
    from cache_utils import get_cached, set_cached
    
    # Try to get from cache
    result = get_cached("graph_overview", graph_id)
    if result is None:
        # Compute expensive operation
        result = expensive_operation()
        # Cache for 5 minutes
        set_cached("graph_overview", graph_id, result, ttl_seconds=300)
    return result
"""
import time
from typing import Any, Optional, Dict
from threading import Lock

# In-memory cache storage
# Structure: {cache_key: {"value": Any, "expires_at": float}}
_cache: Dict[str, Dict[str, Any]] = {}
_cache_lock = Lock()

# Cache statistics
_cache_stats = {
    "hits": 0,
    "misses": 0,
    "evictions": 0,
}


def _make_key(cache_name: str, *args, **kwargs) -> str:
    """Create a cache key from cache name and arguments."""
    key_parts = [cache_name]
    if args:
        key_parts.extend(str(arg) for arg in args)
    if kwargs:
        # Sort kwargs for consistent key generation
        sorted_kwargs = sorted(kwargs.items())
        key_parts.extend(f"{k}={v}" for k, v in sorted_kwargs)
    return ":".join(key_parts)


def get_cached(cache_name: str, *args, ttl_seconds: int = 300, **kwargs) -> Optional[Any]:
    """
    Get a value from cache.
    
    Args:
        cache_name: Name of the cache (e.g., "graph_overview")
        *args: Positional arguments to include in cache key
        ttl_seconds: TTL for the cache entry (default: 5 minutes)
        **kwargs: Keyword arguments to include in cache key
    
    Returns:
        Cached value if found and not expired, None otherwise
    """
    cache_key = _make_key(cache_name, *args, **kwargs)
    
    with _cache_lock:
        entry = _cache.get(cache_key)
        if entry is None:
            _cache_stats["misses"] += 1
            return None
        
        # Check if expired
        if time.time() > entry["expires_at"]:
            del _cache[cache_key]
            _cache_stats["misses"] += 1
            _cache_stats["evictions"] += 1
            return None
        
        _cache_stats["hits"] += 1
        return entry["value"]


def set_cached(cache_name: str, value: Any, *args, ttl_seconds: int = 300, **kwargs) -> None:
    """
    Set a value in cache.
    
    Args:
        cache_name: Name of the cache (e.g., "graph_overview")
        value: Value to cache
        *args: Positional arguments to include in cache key
        ttl_seconds: Time to live in seconds (default: 5 minutes)
        **kwargs: Keyword arguments to include in cache key
    """
    cache_key = _make_key(cache_name, *args, **kwargs)
    
    with _cache_lock:
        _cache[cache_key] = {
            "value": value,
            "expires_at": time.time() + ttl_seconds,
        }


def invalidate_cache(cache_name: str, *args, **kwargs) -> None:
    """
    Invalidate a specific cache entry.
    
    Args:
        cache_name: Name of the cache
        *args: Positional arguments to match cache key
        **kwargs: Keyword arguments to match cache key
    """
    cache_key = _make_key(cache_name, *args, **kwargs)
    
    with _cache_lock:
        if cache_key in _cache:
            del _cache[cache_key]


def invalidate_cache_pattern(cache_name_prefix: str) -> None:
    """
    Invalidate all cache entries matching a prefix.
    Useful for invalidating all entries for a specific cache type.
    
    Args:
        cache_name_prefix: Prefix to match (e.g., "graph_overview" will invalidate all graph overviews)
    """
    with _cache_lock:
        keys_to_delete = [
            key for key in _cache.keys()
            if key.startswith(cache_name_prefix + ":")
        ]
        for key in keys_to_delete:
            del _cache[key]


def clear_cache() -> None:
    """Clear all cache entries."""
    with _cache_lock:
        _cache.clear()


def get_cache_stats() -> Dict[str, Any]:
    """
    Get cache statistics.
    
    Returns:
        Dict with hits, misses, evictions, and current cache size
    """
    with _cache_lock:
        total = _cache_stats["hits"] + _cache_stats["misses"]
        hit_rate = _cache_stats["hits"] / total if total > 0 else 0.0
        
        return {
            "hits": _cache_stats["hits"],
            "misses": _cache_stats["misses"],
            "evictions": _cache_stats["evictions"],
            "hit_rate": hit_rate,
            "cache_size": len(_cache),
        }

