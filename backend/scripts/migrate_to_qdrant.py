#!/usr/bin/env python3
"""
Migration script to move embeddings from Neo4j/in-memory cache to Qdrant.

Usage:
    python scripts/migrate_to_qdrant.py

This script:
1. Loads all concepts from Neo4j
2. Generates embeddings for concepts that don't have them
3. Syncs all embeddings to Qdrant
4. Optionally removes old cache files
"""
import sys
from pathlib import Path

# Add backend to path
backend_dir = Path(__file__).parent.parent
sys.path.insert(0, str(backend_dir))

from db_neo4j import get_neo4j_session
from services_graph import get_all_concepts
from vector_store_qdrant import (
    ensure_collection,
    batch_upsert,
    get_collection_info
)
from services_search_qdrant import embed_text, _build_concept_text
from config import OPENAI_API_KEY

def main():
    print("=" * 60)
    print("Qdrant Migration Script")
    print("=" * 60)
    
    if not OPENAI_API_KEY:
        print("ERROR: OPENAI_API_KEY not set in environment")
        print("Please set it in backend/.env file")
        return 1
    
    # Ensure collection exists
    print("\n[1/4] Ensuring Qdrant collection exists...")
    ensure_collection(dimension=1536)
    print("✓ Collection ready")
    
    # Get all concepts from Neo4j
    print("\n[2/4] Fetching all concepts from Neo4j...")
    session = next(get_neo4j_session())
    try:
        all_concepts = get_all_concepts(session)
        print(f"✓ Found {len(all_concepts)} concepts")
    finally:
        session.close()
    
    if not all_concepts:
        print("No concepts found. Nothing to migrate.")
        return 0
    
    # Process concepts in batches
    print("\n[3/4] Generating embeddings and syncing to Qdrant...")
    batch_size = 50
    points = []
    processed = 0
    skipped = 0
    errors = 0
    
    for i, concept in enumerate(all_concepts):
        try:
            # Build text representation
            concept_text = _build_concept_text(concept)
            
            # Generate embedding
            embedding = embed_text(concept_text)
            
            # Prepare point for Qdrant
            points.append({
                "concept_id": concept.node_id,
                "embedding": embedding,
                "metadata": {
                    "name": concept.name,
                    "domain": concept.domain or "",
                    "graph_id": getattr(concept, "graph_id", "default"),
                    "type": concept.type or "",
                }
            })
            
            processed += 1
            
            # Batch upsert
            if len(points) >= batch_size:
                batch_upsert(points)
                print(f"  Migrated {processed}/{len(all_concepts)} concepts...")
                points = []
                
        except Exception as e:
            errors += 1
            print(f"  ERROR: Failed to process concept {concept.node_id} ({concept.name}): {e}")
            if errors > 10:
                print("  Too many errors, stopping migration")
                return 1
    
    # Upsert remaining points
    if points:
        batch_upsert(points)
        processed += len(points)
    
    print(f"\n✓ Migration complete!")
    print(f"  - Processed: {processed}")
    print(f"  - Skipped: {skipped}")
    print(f"  - Errors: {errors}")
    
    # Show collection info
    print("\n[4/4] Verifying Qdrant collection...")
    info = get_collection_info()
    if "error" not in info:
        print(f"✓ Collection '{info['name']}' has {info['points_count']} points")
        print(f"  Dimension: {info['config']['dimension']}")
        print(f"  Distance: {info['config']['distance']}")
    else:
        print(f"WARNING: Could not verify collection: {info['error']}")
    
    print("\n" + "=" * 60)
    print("Migration complete! You can now use Qdrant for semantic search.")
    print("=" * 60)
    
    return 0

if __name__ == "__main__":
    sys.exit(main())
