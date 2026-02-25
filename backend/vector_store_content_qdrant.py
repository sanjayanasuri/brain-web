"""
Qdrant contract for the unified content ingestion pipeline.

Phase 0 goal: define collection names + payload expectations so future ingestion,
analysis, and retrieval code can depend on a stable interface.

Collections:
- `content_item_text`
    - Payload (minimum): content_item_id, user_id, type, source_url
    - Recommended (safety): tenant_id
- `transcript_chunks`
    - Payload (minimum): content_item_id, chunk_id, user_id, speaker
    - Recommended (safety): tenant_id

This module is intentionally small: it provides collection ensure/create helpers.
Embedding/upsert/search logic is implemented in later phases.
"""

from __future__ import annotations

from typing import Optional

from qdrant_client import QdrantClient
from qdrant_client.models import Distance, VectorParams

from config import (
    QDRANT_HOST,
    QDRANT_PORT,
    QDRANT_COLLECTION_CONTENT_ITEM_TEXT,
    QDRANT_COLLECTION_TRANSCRIPT_CHUNKS,
)

DEFAULT_EMBEDDING_DIMENSION = 1536  # OpenAI text-embedding-3-small (default)

_client: Optional[QdrantClient] = None


def get_client() -> QdrantClient:
    global _client
    if _client is None:
        _client = QdrantClient(host=QDRANT_HOST, port=QDRANT_PORT)
    return _client


def reset_client() -> None:
    """Reset the global Qdrant client (best-effort)."""
    global _client
    client = _client
    _client = None
    try:
        if client is not None and hasattr(client, "close"):
            client.close()  # type: ignore[no-untyped-call]
    except Exception:
        pass


def ensure_collection(*, collection_name: str, dimension: int) -> None:
    client = get_client()
    existing = {c.name for c in client.get_collections().collections}
    if collection_name in existing:
        return
    client.create_collection(
        collection_name=collection_name,
        vectors_config=VectorParams(size=dimension, distance=Distance.COSINE),
    )


def ensure_content_pipeline_collections(*, dimension: int = DEFAULT_EMBEDDING_DIMENSION) -> None:
    ensure_collection(collection_name=QDRANT_COLLECTION_CONTENT_ITEM_TEXT, dimension=dimension)
    ensure_collection(collection_name=QDRANT_COLLECTION_TRANSCRIPT_CHUNKS, dimension=dimension)
