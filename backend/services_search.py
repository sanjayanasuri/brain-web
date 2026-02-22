from typing import List, Dict, Optional, Any
import math
import json
import hashlib
import logging
from neo4j import Session
from pathlib import Path

from config import OPENAI_API_KEY, USE_QDRANT
from services_model_router import model_router, TASK_EMBEDDING
from services_graph import get_all_concepts

logger = logging.getLogger("brain_web")

# Embeddings cache file path
EMBEDDINGS_CACHE_FILE = Path(__file__).parent / "embeddings_cache.json"

# In-memory cache for embeddings (keyed by node_id)
_embedding_cache: Dict[str, Dict] = {}

def _compute_text_hash(node_text: str) -> str:
    """Compute a hash of the node text to detect changes"""
    return hashlib.md5(node_text.encode()).hexdigest()

def _load_embeddings_cache() -> Dict[str, Dict]:
    if not EMBEDDINGS_CACHE_FILE.exists():
        return {}
    try:
        with open(EMBEDDINGS_CACHE_FILE, "r") as f:
            return json.load(f)
    except Exception as e:
        logger.warning(f"Failed to load embeddings cache: {e}")
        return {}

def _save_embeddings_cache():
    try:
        with open(EMBEDDINGS_CACHE_FILE, "w") as f:
            json.dump(_embedding_cache, f)
    except Exception as e:
        logger.warning(f"Failed to save embeddings cache: {e}")

def embed_text(text: str) -> List[float]:
    """Uses model_router to get vector representation."""
    return model_router.embed(text)

def cosine_similarity(vec1: List[float], vec2: List[float]) -> float:
    if not vec1 or not vec2 or len(vec1) != len(vec2):
        return 0.0
    dot_product = sum(a * b for a, b in zip(vec1, vec2))
    mag1 = math.sqrt(sum(a * a for a in vec1))
    mag2 = math.sqrt(sum(a * a for a in vec2))
    return dot_product / (mag1 * mag2) if mag1 > 0 and mag2 > 0 else 0.0

def semantic_search_nodes(
    query: str,
    session: Session,
    limit: int = 5,
    tenant_id: Optional[str] = None
) -> List[Dict]:
    """Semantic search over nodes. Uses Qdrant if available, fallback to local cache."""
    if USE_QDRANT and tenant_id:
        try:
            from services_search_qdrant import semantic_search_nodes as qdrant_search
            return qdrant_search(query, session, limit, tenant_id=tenant_id)
        except Exception as e:
            logger.warning(f"Qdrant search failed, falling back to local: {e}")

    # Local fallback
    global _embedding_cache
    if not _embedding_cache:
        _embedding_cache = _load_embeddings_cache()

    concepts = get_all_concepts(session)
    if not concepts: return []
    
    query_vec = embed_text(query)
    results = []
    updated = False
    
    for concept in concepts:
        text = f"{concept.name}\n{concept.description or ''}\n{', '.join(concept.tags or [])}"
        text_hash = _compute_text_hash(text)
        
        cache_entry = _embedding_cache.get(concept.node_id)
        if cache_entry and cache_entry.get("text_hash") == text_hash:
            vec = cache_entry["embedding"]
        else:
            vec = embed_text(text)
            _embedding_cache[concept.node_id] = {"embedding": vec, "text_hash": text_hash}
            updated = True
        
        results.append({"node": concept, "score": cosine_similarity(query_vec, vec)})
    
    if updated:
        _save_embeddings_cache()
    
    results.sort(key=lambda x: x["score"], reverse=True)
    return results[:limit]

def invalidate_embedding(node_id: str):
    if node_id in _embedding_cache:
        del _embedding_cache[node_id]
        _save_embeddings_cache()
