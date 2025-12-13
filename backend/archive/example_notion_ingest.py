#!/usr/bin/env python3
"""
Example script showing how to ingest a Notion page as a lecture.

Usage:
    python example_notion_ingest.py YOUR_NOTION_PAGE_ID [domain]

Example:
    python example_notion_ingest.py abc123def456 "Machine Learning"
"""
import sys
from services_notion import ingest_notion_page_as_lecture

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python example_notion_ingest.py PAGE_ID [domain]")
        print("Example: python example_notion_ingest.py abc123def456 'Machine Learning'")
        sys.exit(1)
    
    page_id = sys.argv[1]
    domain = sys.argv[2] if len(sys.argv) > 2 else None
    
    try:
        print(f"Ingesting Notion page {page_id}...")
        result = ingest_notion_page_as_lecture(page_id, domain)
        
        print(f"\n✓ Ingestion complete!")
        print(f"  Lecture ID: {result.lecture_id}")
        print(f"  Nodes created: {len(result.nodes_created)}")
        print(f"  Nodes updated: {len(result.nodes_updated)}")
        print(f"  Links created: {len(result.links_created)}")
        
        if result.nodes_created:
            print(f"\n  Created nodes:")
            for node in result.nodes_created:
                print(f"    - {node.name} ({node.domain})")
        
        if result.nodes_updated:
            print(f"\n  Updated nodes:")
            for node in result.nodes_updated:
                print(f"    - {node.name} ({node.domain})")
        
    except Exception as e:
        print(f"Error: {e}", file=sys.stderr)
        sys.exit(1)
