"""
Verification script for Perplexica integration.
Run with: python backend/scripts/test_perplexica.py
"""
import sys
import os
import asyncio
import json

# Add backend to path
sys.path.append(os.path.join(os.path.dirname(__file__), ".."))

import logging
logging.basicConfig(level=logging.INFO, format='%(levelname)s: %(message)s')

async def test_perplexica():
    print("--- Testing Perplexica Integration ---")
    
    try:
        import services_web_search
        # Force correct URL for testing (Docker maps 3000->3001)
        services_web_search.PERPLEXICA_URL = "http://localhost:3001"
        from services_web_search import get_perplexica_config, search_web
        
        print(f"DEBUG: Forcing PERPLEXICA_URL = {services_web_search.PERPLEXICA_URL}")
        config = await get_perplexica_config()
        if not config:
            print("FAILED: Could not fetch Perplexica config (is it running on port 3000?)")
            return
        print(f"✓ Config fetched: {json.dumps(config, indent=2)}")
        
        print("\n2. Performing Search Query...")
        query = sys.argv[1] if len(sys.argv) > 1 else "What is the capital of France?"
        results = await search_web(query)
        
        if not results:
            print(f"FAILED: No results returned for query '{query}'")
            return
            
        print(f"✓ Search successful! Found {len(results)} sources.")
        for i, res in enumerate(results[:3]):
            print(f"\nSource {i+1}:")
            print(f"  Title: {res.get('title')}")
            print(f"  URL:   {res.get('url')}")
            print(f"  Snippet: {res.get('snippet', '')[:100]}...")
            
            if res.get("graph"):
                print("  ✓ Graph Fragment Detected:")
                graph = res.get("graph")
                nodes = graph.get("nodes", [])
                edges = graph.get("edges", [])
                print(f"    - Nodes: {len(nodes)} (e.g., {', '.join([n.get('label', '') for n in nodes[:3]])})")
                print(f"    - Edges: {len(edges)} (e.g., {', '.join([f'{e.get('source')} -> {e.get('target')}' for e in edges[:3]])})")
            
        print("\n--- Verification Successful ---")
        
    except Exception as e:
        print(f"\n--- Verification Failed ---")
        print(f"Error: {e}")
        import traceback
        traceback.print_exc()

if __name__ == "__main__":
    asyncio.run(test_perplexica())
