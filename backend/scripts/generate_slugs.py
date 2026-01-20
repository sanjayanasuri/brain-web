#!/usr/bin/env python3
"""Generate URL slugs for all concepts that don't have them."""

import sys
from pathlib import Path

# Add parent directory to path so we can import backend modules
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from neo4j import Session
from utils.slug import generate_slug, ensure_unique_slug

# Backward compatible: try get_driver first, fall back to driver if needed
try:
    from db_neo4j import get_driver
    driver_getter = get_driver
except ImportError:
    # Fallback for older code
    from db_neo4j import driver
    driver_getter = lambda: driver


def run_in_session(fn):
    """
    Helper: open a session, run fn(session, ...), close session.
    """
    def wrapper(*args, **kwargs):
        driver = driver_getter()
        with driver.session() as session:
            return fn(session, *args, **kwargs)
    return wrapper


@run_in_session
def migrate_slugs(session: Session):
    """Generate URL slugs for all concepts that don't have them."""
    
    # Get all concepts without slugs
    query = """
    MATCH (c:Concept) 
    WHERE c.url_slug IS NULL OR c.url_slug = '' 
    RETURN c.node_id AS node_id, c.name AS name
    """
    result = session.run(query)
    
    count = 0
    skipped = 0
    
    for record in result:
        node_id = record["node_id"]
        name = record.get("name", "")
        
        if not name:
            print(f"⚠️  Skipping {node_id} - no name")
            skipped += 1
            continue
        
        try:
            base_slug = generate_slug(name)
            slug = ensure_unique_slug(session, base_slug, exclude_node_id=node_id)
            
            update_query = """
            MATCH (c:Concept {node_id: $node_id}) 
            SET c.url_slug = $slug
            """
            session.run(update_query, {"node_id": node_id, "slug": slug})
            print(f"✅ Generated slug '{slug}' for '{name}' ({node_id})")
            count += 1
        except Exception as e:
            print(f"❌ Error processing {node_id} ({name}): {e}")
            skipped += 1
    
    print(f"\n✅ Generated {count} slugs")
    if skipped > 0:
        print(f"⚠️  Skipped {skipped} concepts")
    return count


if __name__ == "__main__":
    print("Generating URL slugs for concepts without slugs...")
    print("=" * 60)
    migrate_slugs()
    print("=" * 60)
    print("Done!")
