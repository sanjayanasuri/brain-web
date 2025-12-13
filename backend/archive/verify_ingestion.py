"""
Quick script to verify if a Notion page was ingested and check for specific nodes/relationships
"""
import sys
from db_neo4j import get_neo4j_session
from services_graph import get_all_concepts, get_all_relationships, get_concept_by_name
from notion_page_index import get_all_page_mappings

def search_concepts_by_keywords(keywords):
    """Search for concepts containing any of the keywords"""
    session_gen = get_neo4j_session()
    session = next(session_gen)
    
    try:
        all_concepts = get_all_concepts(session)
        found = []
        
        for concept in all_concepts:
            name_lower = concept.name.lower()
            for keyword in keywords:
                if keyword.lower() in name_lower:
                    found.append(concept)
                    break
        
        return found
    finally:
        try:
            next(session_gen, None)
        except StopIteration:
            pass

def search_relationships_by_names(names):
    """Search for relationships involving any of the names"""
    session_gen = get_neo4j_session()
    session = next(session_gen)
    
    try:
        all_rels = get_all_relationships(session)
        all_concepts = get_all_concepts(session)
        
        # Create a map of node_id -> name
        id_to_name = {c.node_id: c.name for c in all_concepts}
        
        found = []
        names_lower = [n.lower() for n in names]
        
        for rel in all_rels:
            source_name = id_to_name.get(rel["source_id"], "")
            target_name = id_to_name.get(rel["target_id"], "")
            
            source_match = any(n in source_name.lower() for n in names_lower)
            target_match = any(n in target_name.lower() for n in names_lower)
            
            if source_match or target_match:
                found.append({
                    "source": source_name,
                    "target": target_name,
                    "predicate": rel["predicate"]
                })
        
        return found
    finally:
        try:
            next(session_gen, None)
        except StopIteration:
            pass

def main():
    print("=" * 60)
    print("Verifying Notion Page Ingestion")
    print("=" * 60)
    print()
    
    # Check page mappings
    print("1. Checking Notion page mappings...")
    page_mappings = get_all_page_mappings()
    print(f"   Found {len(page_mappings)} pages in index")
    for page_id, info in list(page_mappings.items())[:5]:  # Show first 5
        lecture_ids = info.get("lecture_ids", [])
        print(f"   - Page {page_id[:8]}... has {len(lecture_ids)} lecture(s)")
    print()
    
    # Search for the names mentioned
    keywords = ["Mihir", "Jag", "Abhishek", "FIFA", "smoke", "closer"]
    print(f"2. Searching for concepts with keywords: {', '.join(keywords)}")
    concepts = search_concepts_by_keywords(keywords)
    
    if concepts:
        print(f"   ✓ Found {len(concepts)} matching concepts:")
        for concept in concepts:
            sources = concept.lecture_sources or []
            print(f"   - {concept.name} (domain: {concept.domain}, sources: {len(sources)})")
    else:
        print("   ✗ No matching concepts found")
    print()
    
    # Search for relationships
    print("3. Searching for relationships...")
    names = ["Mihir", "Jag", "Abhishek"]
    relationships = search_relationships_by_names(names)
    
    if relationships:
        print(f"   ✓ Found {len(relationships)} matching relationships:")
        for rel in relationships:
            print(f"   - {rel['source']} -[{rel['predicate']}]-> {rel['target']}")
    else:
        print("   ✗ No matching relationships found")
    print()
    
    # Get all concepts and relationships count
    session_gen = get_neo4j_session()
    session = next(session_gen)
    try:
        all_concepts = get_all_concepts(session)
        all_rels = get_all_relationships(session)
        print(f"4. Graph statistics:")
        print(f"   - Total concepts: {len(all_concepts)}")
        print(f"   - Total relationships: {len(all_rels)}")
    finally:
        try:
            next(session_gen, None)
        except StopIteration:
            pass
    
    print()
    print("=" * 60)
    print("Verification complete!")
    print()
    print("If you don't see your data:")
    print("1. Check /notion-admin to see if your page is marked as 'indexed'")
    print("2. Run a Notion sync: POST /admin/sync-notion")
    print("3. Make sure the page was actually ingested (check backend logs)")
    print("=" * 60)

if __name__ == "__main__":
    main()
