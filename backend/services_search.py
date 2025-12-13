from typing import List, Dict, Optional
import math
import json
import hashlib
from neo4j import Session
from openai import OpenAI
import os
from pathlib import Path

from models import Concept
from services_graph import get_all_concepts

# Find backend directory and .env file
backend_dir = Path(__file__).parent
env_path = backend_dir / '.env'

# Load .env file explicitly with explicit path
try:
    from dotenv import load_dotenv
    # Load from backend/.env explicitly
    load_dotenv(dotenv_path=env_path, override=True)
except ImportError:
    pass

# Initialize OpenAI client - try multiple methods to get API key
api_key = None

# Method 1: Read directly from .env file (most reliable)
if env_path.exists():
    try:
        with open(env_path, 'r') as f:
            for line in f:
                line = line.strip()
                # Skip comments and empty lines
                if not line or line.startswith('#'):
                    continue
                # Handle KEY=value format
                if line.startswith('OPENAI_API_KEY='):
                    # Split on first = only
                    parts = line.split('=', 1)
                    if len(parts) == 2:
                        api_key = parts[1].strip()
                        # Remove quotes if present
                        if (api_key.startswith('"') and api_key.endswith('"')) or \
                           (api_key.startswith("'") and api_key.endswith("'")):
                            api_key = api_key[1:-1]
                        # Remove any trailing whitespace/newlines
                        api_key = api_key.rstrip()
                        break
    except Exception as e:
        print(f"Could not read .env file directly: {e}")

# Method 2: From environment (after load_dotenv)
if not api_key:
    api_key = os.getenv("OPENAI_API_KEY")

# Method 3: From config module (which also loads .env)
if not api_key:
    try:
        from config import OPENAI_API_KEY as config_key
        if config_key:
            api_key = config_key
    except (ImportError, AttributeError):
        pass

# Validate and initialize client
if not api_key:
    print("=" * 60)
    print("ERROR: OPENAI_API_KEY not found!")
    print(f"Looked in: {env_path}")
    print("Please add OPENAI_API_KEY=your_key to backend/.env file")
    print("Format: OPENAI_API_KEY=sk-proj-...")
    print("=" * 60)
    client = None
else:
    # Validate key format
    if len(api_key) < 20:
        print(f"WARNING: API key seems too short (length: {len(api_key)})")
    if not api_key.startswith('sk-'):
        print("WARNING: API key doesn't start with 'sk-'")
    
    # Never print key material (even partials) to logs.
    print(f"✓ OpenAI API key loaded (length: {len(api_key)})")
    try:
        client = OpenAI(api_key=api_key)
        print("✓ OpenAI client initialized successfully")
    except Exception as e:
        print(f"ERROR: Failed to initialize OpenAI client: {e}")
        client = None

# Embeddings cache file path
EMBEDDINGS_CACHE_FILE = Path(__file__).parent / "embeddings_cache.json"

# In-memory cache for embeddings (keyed by node_id)
# Structure: {node_id: {"embedding": [floats], "text_hash": str}}
_embedding_cache: Dict[str, Dict] = {}


def _compute_text_hash(node_text: str) -> str:
    """Compute a hash of the node text to detect changes"""
    return hashlib.md5(node_text.encode()).hexdigest()


def _load_embeddings_cache() -> Dict[str, Dict]:
    """
    Load embeddings cache from disk.
    
    Returns:
        Dictionary mapping node_id to {"embedding": [floats], "text_hash": str}
    """
    if not EMBEDDINGS_CACHE_FILE.exists():
        return {}
    
    try:
        with open(EMBEDDINGS_CACHE_FILE, "r") as f:
            data = json.load(f)
            print(f"[Semantic Search] Loaded {len(data)} embeddings from cache file")
            return data
    except Exception as e:
        print(f"[Semantic Search] Warning: Failed to load embeddings cache: {e}")
        return {}


def _save_embeddings_cache():
    """Save embeddings cache to disk"""
    try:
        with open(EMBEDDINGS_CACHE_FILE, "w") as f:
            json.dump(_embedding_cache, f)
        print(f"[Semantic Search] Saved {len(_embedding_cache)} embeddings to cache file")
    except Exception as e:
        print(f"[Semantic Search] Warning: Failed to save embeddings cache: {e}")


def invalidate_embedding(node_id: str):
    """
    Invalidate embedding for a specific node (e.g., when node is updated).
    This removes it from cache so it will be regenerated on next search.
    """
    if node_id in _embedding_cache:
        del _embedding_cache[node_id]
        _save_embeddings_cache()


def embed_text(text: str) -> List[float]:
    """
    Uses OpenAI embeddings (text-embedding-3-small) to get vector representation.
    """
    if not client:
        error_msg = "ERROR: OpenAI client not initialized. Check OPENAI_API_KEY environment variable."
        print(error_msg)
        raise ValueError(error_msg)
    
    try:
        response = client.embeddings.create(
            model="text-embedding-3-small",
            input=text
        )
        return response.data[0].embedding
    except Exception as e:
        error_str = str(e)
        if "invalid_api_key" in error_str.lower() or "incorrect api key" in error_str.lower():
            print(f"ERROR: Invalid OpenAI API key. Error: {error_str}")
            raise ValueError(f"Invalid OpenAI API key: {error_str}")
        elif "rate_limit" in error_str.lower():
            print(f"WARNING: Rate limit exceeded: {error_str}")
            raise
        else:
            print(f"Error creating embedding: {error_str}")
            raise


def cosine_similarity(vec1: List[float], vec2: List[float]) -> float:
    """
    Computes cosine similarity between two vectors.
    """
    if len(vec1) != len(vec2):
        return 0.0
    
    dot_product = sum(a * b for a, b in zip(vec1, vec2))
    magnitude1 = math.sqrt(sum(a * a for a in vec1))
    magnitude2 = math.sqrt(sum(a * a for a in vec2))
    
    if magnitude1 == 0 or magnitude2 == 0:
        return 0.0
    
    return dot_product / (magnitude1 * magnitude2)


def semantic_search_nodes(
    query: str,
    session: Session,
    limit: int = 5
) -> List[Dict]:
    """
    Performs semantic search over all nodes in the graph.
    Returns list of dicts with 'node' (Concept) and 'score' (float).
    """
    if not client:
        print("ERROR: Cannot perform semantic search - OpenAI client not initialized.")
        print("Please set OPENAI_API_KEY in backend/.env file")
        # Return nodes by name match as fallback
        all_concepts = get_all_concepts(session)
        query_lower = query.lower()
        matched = [c for c in all_concepts if query_lower in c.name.lower()]
        return [{"node": c, "score": 0.5} for c in matched[:limit]]
    
    # Get all concepts
    all_concepts = get_all_concepts(session)
    
    if not all_concepts:
        return []
    
    print(f"[Semantic Search] Computing embeddings for query and {len(all_concepts)} nodes...")
    
    # Get query embedding
    try:
        query_embedding = embed_text(query)
        if sum(query_embedding) == 0:
            print("WARNING: Query embedding is zero vector - OpenAI API may be failing")
    except Exception as e:
        print(f"ERROR: Failed to get query embedding: {e}")
        # Fallback to name matching
        query_lower = query.lower()
        matched = [c for c in all_concepts if query_lower in c.name.lower()]
        return [{"node": c, "score": 0.5} for c in matched[:limit]]
    
    # Load embeddings cache from disk on first use
    if not _embedding_cache:
        loaded = _load_embeddings_cache()
        if loaded:
            _embedding_cache.update(loaded)
            print(f"[Semantic Search] Using {len(loaded)} cached embeddings from disk")
        else:
            print(f"[Semantic Search] No cache file found - will generate embeddings for all {len(all_concepts)} nodes (this is a one-time cost)")
    
    # Build text representation for each node and compute similarity
    results = []
    new_embeddings_count = 0
    for i, node in enumerate(all_concepts):
        # Build text representation
        text_parts = [node.name]
        if node.description:
            text_parts.append(node.description)
        if node.tags:
            text_parts.append(", ".join(node.tags))
        node_text = "\n".join(text_parts)
        text_hash = _compute_text_hash(node_text)
        
        # Check if we need to generate/regenerate embedding
        needs_embedding = False
        if node.node_id not in _embedding_cache:
            # New node - needs embedding
            needs_embedding = True
        else:
            # Check if cached embedding is valid (has correct structure and hash)
            cached = _embedding_cache[node.node_id]
            if not isinstance(cached, dict) or "embedding" not in cached:
                # Old cache format or corrupted - regenerate
                needs_embedding = True
            elif cached.get("text_hash") != text_hash:
                # Node content changed - invalidate old embedding
                print(f"[Semantic Search] Node {node.node_id} ({node.name}) content changed, regenerating embedding...")
                needs_embedding = True
        
        # Get or compute node embedding
        if needs_embedding:
            try:
                embedding = embed_text(node_text)
                _embedding_cache[node.node_id] = {
                    "embedding": embedding,
                    "text_hash": text_hash
                }
                new_embeddings_count += 1
                if new_embeddings_count % 10 == 0:
                    print(f"[Semantic Search] Generated {new_embeddings_count} new embeddings, cached {i+1}/{len(all_concepts)} total...")
            except Exception as e:
                print(f"ERROR: Failed to embed node {node.node_id} ({node.name}): {e}")
                # Use zero vector as fallback for this node
                _embedding_cache[node.node_id] = {
                    "embedding": [0.0] * 1536,
                    "text_hash": text_hash
                }
        
        node_embedding = _embedding_cache[node.node_id]["embedding"]
        
        # Compute cosine similarity
        score = cosine_similarity(query_embedding, node_embedding)
        
        results.append({
            "node": node,
            "score": score
        })
    
    # Sort by score descending and return top N
    results.sort(key=lambda x: x["score"], reverse=True)
    top_results = results[:limit]
    print(f"[Semantic Search] Top result: {top_results[0]['node'].name if top_results else 'none'} (score: {top_results[0]['score'] if top_results else 0})")
    
    # Save cache to disk if we generated new embeddings
    if new_embeddings_count > 0:
        _save_embeddings_cache()
    
    return top_results

