"""
Qdrant Vector Store Integration

This module provides a vector database interface for storing and searching concept embeddings.
Replaces the in-memory + JSON file approach with a proper vector database.

Setup:
    docker run -p 6333:6333 -p 6334:6334 qdrant/qdrant

Environment Variables:
    QDRANT_HOST: Qdrant host (default: localhost)
    QDRANT_PORT: Qdrant port (default: 6333)
    QDRANT_COLLECTION: Collection name (default: concepts)
"""
from typing import List, Dict, Optional, Any
import os
from qdrant_client import QdrantClient
from qdrant_client.models import (
    Distance, VectorParams, PointStruct, Filter, FieldCondition, MatchValue
)

# Configuration
QDRANT_HOST = os.getenv("QDRANT_HOST", "localhost")
QDRANT_PORT = int(os.getenv("QDRANT_PORT", "6333"))
QDRANT_COLLECTION = os.getenv("QDRANT_COLLECTION", "concepts")

# Global client (lazy initialization)
_client: Optional[QdrantClient] = None


def get_client() -> QdrantClient:
    """Get or create Qdrant client."""
    global _client
    if _client is None:
        _client = QdrantClient(host=QDRANT_HOST, port=QDRANT_PORT)
    return _client


def ensure_collection(dimension: int = 1536):
    """
    Ensure the collection exists with proper configuration.
    
    Args:
        dimension: Embedding dimension (default: 1536 for OpenAI text-embedding-3-small)
    """
    client = get_client()
    
    # Check if collection exists
    collections = client.get_collections().collections
    collection_names = [c.name for c in collections]
    
    if QDRANT_COLLECTION not in collection_names:
        # Create collection
        client.create_collection(
            collection_name=QDRANT_COLLECTION,
            vectors_config=VectorParams(
                size=dimension,
                distance=Distance.COSINE
            )
        )
        print(f"[Qdrant] Created collection '{QDRANT_COLLECTION}' with dimension {dimension}")


def upsert_concept_embedding(
    concept_id: str,
    embedding: List[float],
    metadata: Dict[str, Any]
) -> None:
    """
    Upsert a concept embedding into Qdrant.
    
    Args:
        concept_id: Concept node ID (used as point ID)
        embedding: Embedding vector
        metadata: Additional metadata (name, domain, graph_id, etc.)
    """
    client = get_client()
    ensure_collection(dimension=len(embedding))
    
    point = PointStruct(
        id=concept_id,  # Use concept_id as point ID
        vector=embedding,
        payload=metadata
    )
    
    client.upsert(
        collection_name=QDRANT_COLLECTION,
        points=[point]
    )


def semantic_search(
    query_embedding: List[float],
    limit: int = 10,
    graph_id: Optional[str] = None,
    domain: Optional[str] = None,
    min_score: float = 0.0
) -> List[Dict[str, Any]]:
    """
    Perform semantic search over concept embeddings.
    
    Args:
        query_embedding: Query embedding vector
        limit: Maximum number of results
        graph_id: Optional filter by graph_id
        domain: Optional filter by domain
        min_score: Minimum similarity score (0-1)
    
    Returns:
        List of results with concept_id, score, and metadata
    """
    client = get_client()
    ensure_collection(dimension=len(query_embedding))
    
    # Build filter if needed
    query_filter = None
    if graph_id or domain:
        conditions = []
        if graph_id:
            conditions.append(
                FieldCondition(key="graph_id", match=MatchValue(value=graph_id))
            )
        if domain:
            conditions.append(
                FieldCondition(key="domain", match=MatchValue(value=domain))
            )
        if len(conditions) > 1:
            from qdrant_client.models import Filter, Condition
            query_filter = Filter(must=conditions)
        elif len(conditions) == 1:
            query_filter = Filter(must=conditions[0])
    
    # Perform search
    results = client.search(
        collection_name=QDRANT_COLLECTION,
        query_vector=query_embedding,
        limit=limit,
        query_filter=query_filter,
        score_threshold=min_score
    )
    
    # Format results
    formatted_results = []
    for result in results:
        formatted_results.append({
            "concept_id": result.id,
            "score": result.score,
            "metadata": result.payload
        })
    
    return formatted_results


def delete_concept(concept_id: str) -> None:
    """Delete a concept embedding from Qdrant."""
    client = get_client()
    client.delete(
        collection_name=QDRANT_COLLECTION,
        points_selector=[concept_id]
    )


def batch_upsert(
    points: List[Dict[str, Any]]
) -> None:
    """
    Batch upsert multiple concept embeddings.
    
    Args:
        points: List of dicts with keys: concept_id, embedding, metadata
    """
    if not points:
        return
    
    client = get_client()
    
    # Determine dimension from first point
    dimension = len(points[0]["embedding"])
    ensure_collection(dimension=dimension)
    
    # Convert to PointStruct
    qdrant_points = [
        PointStruct(
            id=p["concept_id"],
            vector=p["embedding"],
            payload=p["metadata"]
        )
        for p in points
    ]
    
    client.upsert(
        collection_name=QDRANT_COLLECTION,
        points=qdrant_points
    )


def get_collection_info() -> Dict[str, Any]:
    """Get information about the collection."""
    client = get_client()
    try:
        collection_info = client.get_collection(QDRANT_COLLECTION)
        return {
            "name": collection_info.name,
            "points_count": collection_info.points_count,
            "vectors_count": collection_info.vectors_count,
            "config": {
                "dimension": collection_info.config.params.vectors.size,
                "distance": collection_info.config.params.vectors.distance
            }
        }
    except Exception as e:
        return {"error": str(e)}


# Migration helper
def migrate_from_neo4j(session, batch_size: int = 100):
    """
    Migrate embeddings from Neo4j to Qdrant.
    
    Args:
        session: Neo4j session
        batch_size: Number of concepts to process per batch
    """
    from services_graph import get_all_concepts
    
    print("[Migration] Fetching all concepts from Neo4j...")
    all_concepts = get_all_concepts(session)
    print(f"[Migration] Found {len(all_concepts)} concepts")
    
    points = []
    migrated = 0
    
    for concept in all_concepts:
        if not concept.embedding:
            continue
        
        points.append({
            "concept_id": concept.node_id,
            "embedding": concept.embedding,
            "metadata": {
                "name": concept.name,
                "domain": concept.domain or "",
                "graph_id": getattr(concept, "graph_id", "default"),
                "type": concept.type or "",
            }
        })
        
        if len(points) >= batch_size:
            batch_upsert(points)
            migrated += len(points)
            print(f"[Migration] Migrated {migrated}/{len(all_concepts)} concepts...")
            points = []
    
    # Migrate remaining
    if points:
        batch_upsert(points)
        migrated += len(points)
    
    print(f"[Migration] Complete! Migrated {migrated} concepts to Qdrant")
