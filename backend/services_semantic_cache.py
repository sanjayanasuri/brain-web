"""
Semantic Cache (Redis Hot Path)

Goal:
  - Before calling the LLM, check Redis for a semantically-similar question.
  - If a near-duplicate exists (cosine distance < threshold), return cached answer.

Notes:
  - This implementation uses vanilla Redis (no Redis Stack / RediSearch vector index).
  - We keep a small, tenant+user-scoped rolling window of recent Q&A embeddings in Redis
    and do an in-process similarity scan over the last N entries.
"""

from __future__ import annotations

import json
import logging
import time
from typing import Any, Dict, List, Optional, Tuple
from uuid import uuid4

try:
    import redis
except Exception:  # pragma: no cover
    redis = None

from openai import OpenAI

from config import (
    OPENAI_API_KEY,
    USE_REDIS,
    REDIS_URL,
    REDIS_HOST,
    REDIS_PORT,
    REDIS_PASSWORD,
    REDIS_DB,
)

logger = logging.getLogger("brain_web")

# Defaults tuned for "hot path" speed and bounded memory.
DEFAULT_DISTANCE_THRESHOLD = 0.1  # cosine distance = 1 - cosine_similarity
DEFAULT_MAX_CANDIDATES = 50
DEFAULT_ENTRY_TTL_SECONDS = 60 * 60 * 24  # 24h
DEFAULT_MAX_ENTRIES = 200

_redis_client = None
_openai_client: Optional[OpenAI] = None


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
        logger.warning(f"Semantic cache: Redis unavailable ({e})")
        _redis_client = None
        return None


def _get_openai_client() -> OpenAI:
    global _openai_client
    if _openai_client is None:
        if not OPENAI_API_KEY:
            raise ValueError("OPENAI_API_KEY not set (required for semantic cache embeddings)")
        _openai_client = OpenAI(api_key=str(OPENAI_API_KEY).strip().strip('"').strip("'"))
    return _openai_client


def embed_text(text: str) -> List[float]:
    """Get an embedding for semantic cache lookup/storage."""
    client = _get_openai_client()
    resp = client.embeddings.create(model="text-embedding-3-small", input=text)
    return resp.data[0].embedding


def _cosine_similarity(a: List[float], b: List[float]) -> float:
    if len(a) != len(b) or not a:
        return 0.0
    dot = 0.0
    na = 0.0
    nb = 0.0
    for x, y in zip(a, b):
        dot += x * y
        na += x * x
        nb += y * y
    if na <= 0.0 or nb <= 0.0:
        return 0.0
    return dot / ((na ** 0.5) * (nb ** 0.5))


def _cosine_distance(a: List[float], b: List[float]) -> float:
    return 1.0 - _cosine_similarity(a, b)


def _recent_list_key(*, tenant_id: str, user_id: str) -> str:
    return f"semcache:{tenant_id}:{user_id}:recent"


def _entry_key(*, tenant_id: str, user_id: str, entry_id: str) -> str:
    return f"semcache:{tenant_id}:{user_id}:entry:{entry_id}"


def find_similar(
    *,
    tenant_id: str,
    user_id: str,
    query: str,
    query_embedding: List[float],
    distance_threshold: float = DEFAULT_DISTANCE_THRESHOLD,
    max_candidates: int = DEFAULT_MAX_CANDIDATES,
) -> Optional[Dict[str, Any]]:
    """
    Return best semantic cache hit if within distance_threshold.

    Returns a dict like:
      {
        "answer": "...",
        "question": "...",
        "distance": 0.03,
        "entry_id": "...",
      }
    """
    if not tenant_id or not user_id:
        return None

    r = _get_redis_client()
    if not r:
        return None

    list_key = _recent_list_key(tenant_id=tenant_id, user_id=user_id)
    try:
        entry_ids = r.lrange(list_key, 0, max(0, max_candidates - 1))
        if not entry_ids:
            return None

        entry_keys = [_entry_key(tenant_id=tenant_id, user_id=user_id, entry_id=eid) for eid in entry_ids]
        raw_entries = r.mget(entry_keys)
    except Exception as e:
        logger.debug(f"Semantic cache lookup failed: {e}")
        return None

    best: Optional[Dict[str, Any]] = None
    best_distance = float("inf")

    for eid, raw in zip(entry_ids, raw_entries):
        if not raw:
            continue
        try:
            entry = json.loads(raw)
            emb = entry.get("embedding")
            if not isinstance(emb, list) or not emb:
                continue
            dist = _cosine_distance(query_embedding, emb)
            if dist < best_distance:
                best_distance = dist
                best = {
                    "entry_id": eid,
                    "question": entry.get("question", ""),
                    "answer": entry.get("answer", ""),
                    "distance": dist,
                }
        except Exception:
            continue

    if best and best_distance < float(distance_threshold):
        # Guardrail: ensure we only return non-empty answers.
        if isinstance(best.get("answer"), str) and best["answer"].strip():
            return best
    return None


def store(
    *,
    tenant_id: str,
    user_id: str,
    question: str,
    answer: str,
    question_embedding: List[float],
    ttl_seconds: int = DEFAULT_ENTRY_TTL_SECONDS,
    max_entries: int = DEFAULT_MAX_ENTRIES,
    extra: Optional[Dict[str, Any]] = None,
) -> Optional[str]:
    """Store a semantic cache entry and return its entry_id."""
    if not tenant_id or not user_id:
        return None
    if not isinstance(question, str) or not question.strip():
        return None
    if not isinstance(answer, str) or not answer.strip():
        return None

    r = _get_redis_client()
    if not r:
        return None

    entry_id = uuid4().hex
    entry = {
        "question": question,
        "answer": answer,
        "embedding": question_embedding,
        "created_at": int(time.time()),
    }
    if extra:
        entry["extra"] = extra

    list_key = _recent_list_key(tenant_id=tenant_id, user_id=user_id)
    key = _entry_key(tenant_id=tenant_id, user_id=user_id, entry_id=entry_id)
    try:
        pipe = r.pipeline(transaction=False)
        pipe.setex(key, int(ttl_seconds), json.dumps(entry))
        pipe.lpush(list_key, entry_id)
        pipe.ltrim(list_key, 0, max(0, int(max_entries) - 1))
        pipe.expire(list_key, int(ttl_seconds))
        pipe.execute()
        return entry_id
    except Exception as e:
        logger.debug(f"Semantic cache store failed: {e}")
        return None


def lookup_question(
    *,
    tenant_id: str,
    user_id: str,
    question: str,
    distance_threshold: float = DEFAULT_DISTANCE_THRESHOLD,
    max_candidates: int = DEFAULT_MAX_CANDIDATES,
) -> Tuple[Optional[Dict[str, Any]], Optional[List[float]]]:
    """
    Convenience wrapper:
      - embeds the question
      - finds a similar cached entry
    Returns (hit, embedding).
    """
    if not tenant_id or not user_id:
        return (None, None)

    # Avoid embedding calls if Redis isn't available or cache is empty.
    r = _get_redis_client()
    if not r:
        return (None, None)
    try:
        if not r.lrange(_recent_list_key(tenant_id=tenant_id, user_id=user_id), 0, 0):
            return (None, None)
    except Exception:
        return (None, None)

    try:
        q_emb = embed_text(question)
    except Exception as e:
        logger.debug(f"Semantic cache embedding failed: {e}")
        return (None, None)
    hit = find_similar(
        tenant_id=tenant_id,
        user_id=user_id,
        query=question,
        query_embedding=q_emb,
        distance_threshold=distance_threshold,
        max_candidates=max_candidates,
    )
    return (hit, q_emb)
