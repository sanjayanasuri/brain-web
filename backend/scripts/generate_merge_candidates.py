#!/usr/bin/env python3
"""
Script to generate merge candidates for entity resolution.

Usage:
    python generate_merge_candidates.py --graph-id <graph_id> [--threshold 0.82] [--top-k 3] [--limit-pairs 3000]
"""
import argparse
import sys
from pathlib import Path

# Add parent directory to path to import backend modules
sys.path.insert(0, str(Path(__file__).parent.parent))

from db_neo4j import get_neo4j_session
from services_entity_resolution import generate_merge_candidates
from services_branch_explorer import ensure_graph_scoping_initialized


def main():
    parser = argparse.ArgumentParser(description="Generate merge candidates for entity resolution")
    parser.add_argument(
        "--graph-id",
        type=str,
        required=True,
        help="Graph ID to generate candidates for"
    )
    parser.add_argument(
        "--threshold",
        type=float,
        default=0.82,
        help="Minimum similarity score to create candidate (default: 0.82)"
    )
    parser.add_argument(
        "--top-k",
        type=int,
        default=3,
        help="Maximum candidates per node (default: 3)"
    )
    parser.add_argument(
        "--limit-pairs",
        type=int,
        default=3000,
        help="Maximum pairs to evaluate (safety limit, default: 3000)"
    )
    
    args = parser.parse_args()
    
    print(f"[Generate Merge Candidates] Starting for graph_id: {args.graph_id}")
    print(f"  Threshold: {args.threshold}")
    print(f"  Top-K per node: {args.top_k}")
    print(f"  Limit pairs: {args.limit_pairs}")
    
    # Get Neo4j session
    session_gen = get_neo4j_session()
    session = next(session_gen)
    
    try:
        ensure_graph_scoping_initialized(session)
        
        candidates_created = generate_merge_candidates(
            session=session,
            graph_id=args.graph_id,
            top_k_per_node=args.top_k,
            score_threshold=args.threshold,
            limit_pairs=args.limit_pairs,
        )
        
        print(f"[Generate Merge Candidates] ✓ Created {candidates_created} merge candidates")
        return 0
    except Exception as e:
        print(f"[Generate Merge Candidates] ✗ ERROR: {e}", file=sys.stderr)
        import traceback
        traceback.print_exc()
        return 1
    finally:
        session.close()


if __name__ == "__main__":
    sys.exit(main())
