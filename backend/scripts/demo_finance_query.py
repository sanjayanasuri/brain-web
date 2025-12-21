#!/usr/bin/env python3
"""
Demo script for Finance vertical queries.

Usage:
    python backend/scripts/demo_finance_query.py --message "finance: NVIDIA"
    python backend/scripts/demo_finance_query.py --message "finance: NVIDIA lens=fundamentals"
    python backend/scripts/demo_finance_query.py --message "finance: NVIDIA lens=competition"
"""
import argparse
import sys
from pathlib import Path

# Add backend to path
backend_dir = Path(__file__).parent.parent
sys.path.insert(0, str(backend_dir))

from db_neo4j import get_neo4j_session
from verticals.base import RetrievalRequest
from services_graphrag import retrieve_context


def main():
    parser = argparse.ArgumentParser(description="Demo Finance vertical query")
    parser.add_argument(
        "--message",
        type=str,
        required=True,
        help="Query message (e.g., 'finance: NVIDIA' or 'finance: NVIDIA lens=fundamentals')"
    )
    parser.add_argument(
        "--graph-id",
        type=str,
        default="default",
        help="Graph ID (default: 'default')"
    )
    parser.add_argument(
        "--branch-id",
        type=str,
        default="main",
        help="Branch ID (default: 'main')"
    )
    parser.add_argument(
        "--lens",
        type=str,
        default=None,
        help="Explicit lens: fundamentals, catalysts, competition, risks, narrative"
    )
    parser.add_argument(
        "--recency-days",
        type=int,
        default=None,
        help="Filter claims by recency (days)"
    )
    parser.add_argument(
        "--evidence-strictness",
        type=str,
        choices=["high", "medium", "low"],
        default="medium",
        help="Evidence strictness filter"
    )
    parser.add_argument(
        "--include-proposed-edges",
        action="store_true",
        default=True,
        help="Include proposed edges (default: True)"
    )
    parser.add_argument(
        "--no-proposed-edges",
        action="store_true",
        help="Exclude proposed edges"
    )
    
    args = parser.parse_args()
    
    # Parse message for finance: prefix and lens
    message = args.message
    vertical = "general"
    lens = args.lens
    
    if message.lower().startswith("finance:"):
        vertical = "finance"
        message = message[8:].strip()  # Remove "finance:" prefix
        
        # Parse lens from message if present
        if "lens=" in message.lower():
            import re
            match = re.search(r"lens=(\w+)", message, re.IGNORECASE)
            if match:
                lens = match.group(1)
                message = re.sub(r"lens=\w+", "", message, flags=re.IGNORECASE).strip()
    
    # Build request
    req = RetrievalRequest(
        graph_id=args.graph_id,
        branch_id=args.branch_id,
        query=message,
        vertical=vertical,
        lens=lens,
        recency_days=args.recency_days,
        evidence_strictness=args.evidence_strictness,
        include_proposed_edges=not args.no_proposed_edges if args.no_proposed_edges else args.include_proposed_edges,
    )
    
    print(f"[Demo] Query: {message}")
    print(f"[Demo] Vertical: {vertical}")
    print(f"[Demo] Lens: {lens or 'auto'}")
    print(f"[Demo] Graph ID: {args.graph_id}, Branch ID: {args.branch_id}")
    print()
    
    # Get session and retrieve
    session = get_neo4j_session()
    try:
        result = retrieve_context(req, session)
        
        print("=" * 80)
        print("RETRIEVAL RESULT")
        print("=" * 80)
        print(f"Mode: {result.mode}")
        print(f"Vertical: {result.vertical}")
        print(f"Lens: {result.lens}")
        print()
        
        print("=" * 80)
        print("METADATA")
        print("=" * 80)
        import json
        print(json.dumps(result.meta, indent=2))
        print()
        
        print("=" * 80)
        print("CONTEXT TEXT (first 500 chars)")
        print("=" * 80)
        print(result.context_text[:500])
        if len(result.context_text) > 500:
            print(f"\n... (truncated, total length: {len(result.context_text)} chars)")
        print()
        
    except Exception as e:
        print(f"ERROR: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)
    finally:
        session.close()


if __name__ == "__main__":
    main()
