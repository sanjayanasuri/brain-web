#!/usr/bin/env python3
"""
CLI script for finance data ingestion.
"""
import argparse
import sys
from pathlib import Path

# Add parent directory to path
sys.path.insert(0, str(Path(__file__).parent.parent))

from db_neo4j import get_neo4j_session
from services_finance_ingestion import ingest_finance_sources
from services_branch_explorer import (
    ensure_graph_scoping_initialized,
    ensure_graphspace_exists,
    ensure_branch_exists,
)


def main():
    parser = argparse.ArgumentParser(description="Ingest finance data from public sources")
    parser.add_argument("--graph-id", required=True, help="Graph ID")
    parser.add_argument("--branch-id", required=True, help="Branch ID")
    parser.add_argument("--ticker", required=True, help="Company ticker symbol (e.g., NVDA)")
    parser.add_argument("--since-days", type=int, default=30, help="Number of days to look back (default: 30)")
    parser.add_argument("--limit", type=int, default=20, help="Maximum documents per connector (default: 20)")
    parser.add_argument(
        "--connectors",
        nargs="+",
        default=["edgar", "ir", "news"],
        choices=["edgar", "ir", "news"],
        help="Connectors to use (default: edgar ir news)"
    )
    
    args = parser.parse_args()
    
    # Get Neo4j session
    session_gen = get_neo4j_session()
    session = next(session_gen)
    
    try:
        # Ensure graph and branch exist
        ensure_graph_scoping_initialized(session)
        ensure_graphspace_exists(session, args.graph_id)
        ensure_branch_exists(session, args.graph_id, args.branch_id)
        
        print(f"[Finance Ingestion] Starting ingestion for {args.ticker}")
        print(f"  Graph ID: {args.graph_id}")
        print(f"  Branch ID: {args.branch_id}")
        print(f"  Since days: {args.since_days}")
        print(f"  Limit: {args.limit}")
        print(f"  Connectors: {', '.join(args.connectors)}")
        print()
        
        # Run ingestion
        result = ingest_finance_sources(
            session=session,
            graph_id=args.graph_id,
            branch_id=args.branch_id,
            ticker=args.ticker,
            since_days=args.since_days,
            limit=args.limit,
            connectors=args.connectors
        )
        
        # Print results
        print("[Finance Ingestion] Results:")
        print(f"  Documents fetched: {result['documents_fetched']}")
        print(f"  Chunks created: {result['chunks_created']}")
        print(f"  Claims created: {result['claims_created']}")
        print(f"  Proposed edges created: {result['proposed_edges_created']}")
        
        if result['errors']:
            print(f"  Errors: {len(result['errors'])}")
            for error in result['errors']:
                print(f"    - {error}")
        
        if result['ingested_docs']:
            print(f"  Ingested documents: {len(result['ingested_docs'])}")
            for doc in result['ingested_docs'][:5]:  # Show first 5
                print(f"    - {doc['title']} ({doc['doc_type']})")
            if len(result['ingested_docs']) > 5:
                print(f"    ... and {len(result['ingested_docs']) - 5} more")
        
        print()
        print("[Finance Ingestion] ✓ Completed successfully")
        
    except Exception as e:
        print(f"[Finance Ingestion] ✗ Error: {e}", file=sys.stderr)
        import traceback
        traceback.print_exc()
        sys.exit(1)
    finally:
        session.close()


if __name__ == "__main__":
    main()
