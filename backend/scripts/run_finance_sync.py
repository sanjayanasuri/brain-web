#!/usr/bin/env python3
"""
Script to run finance data sync (SEC, News, Prices).
Safe for cron/GitHub Actions.

Usage:
    python scripts/run_finance_sync.py --ticker NVDA --sources sec,news,prices --graph-id default --branch-id main
"""
import argparse
import sys
import os
from pathlib import Path

# Add backend to path
backend_dir = Path(__file__).parent.parent
sys.path.insert(0, str(backend_dir))

from db_neo4j import get_driver
from services_branch_explorer import ensure_graph_scoping_initialized, get_active_graph_context
from api_connectors import _sync_sec_filings, _sync_news_articles, _sync_price_data
import logging

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)


def main():
    parser = argparse.ArgumentParser(description="Run finance data sync")
    parser.add_argument(
        "--ticker",
        required=True,
        help="Stock ticker symbol (e.g., NVDA)"
    )
    parser.add_argument(
        "--sources",
        required=True,
        help="Comma-separated list of sources to sync (sec,news,prices)"
    )
    parser.add_argument(
        "--graph-id",
        help="Graph ID (uses active if not provided)"
    )
    parser.add_argument(
        "--branch-id",
        help="Branch ID (uses active if not provided)"
    )
    parser.add_argument(
        "--since-ts",
        type=int,
        help="Unix timestamp to fetch data since (optional)"
    )
    parser.add_argument(
        "--form-types",
        help="Comma-separated SEC form types (e.g., '10-Q,10-K,8-K')"
    )
    
    args = parser.parse_args()
    
    # Parse sources
    sources = [s.strip().lower() for s in args.sources.split(",")]
    valid_sources = {"sec", "news", "prices"}
    invalid_sources = [s for s in sources if s not in valid_sources]
    if invalid_sources:
        logger.error(f"Invalid sources: {invalid_sources}. Valid: {valid_sources}")
        sys.exit(1)
    
    # Get database session
    driver = get_driver()
    with driver.session() as session:
        ensure_graph_scoping_initialized(session)
        active_graph_id, active_branch_id = get_active_graph_context(session)
        
        graph_id = args.graph_id or active_graph_id
        branch_id = args.branch_id or active_branch_id
        
        logger.info(f"Starting finance sync for {args.ticker}")
        logger.info(f"Graph ID: {graph_id}, Branch ID: {branch_id}")
        logger.info(f"Sources: {sources}")
        
        results = []
        
        # Sync SEC
        if "sec" in sources:
            logger.info("=" * 60)
            logger.info("Syncing SEC filings...")
            form_types = None
            if args.form_types:
                form_types = [ft.strip() for ft in args.form_types.split(",")]
            result = _sync_sec_filings(session, graph_id, branch_id, args.ticker, form_types)
            results.append(result)
            logger.info(f"SEC Sync Result: {result}")
        
        # Sync News
        if "news" in sources:
            logger.info("=" * 60)
            logger.info("Syncing News articles...")
            result = _sync_news_articles(session, graph_id, branch_id, args.ticker, args.since_ts)
            results.append(result)
            logger.info(f"News Sync Result: {result}")
        
        # Sync Prices
        if "prices" in sources:
            logger.info("=" * 60)
            logger.info("Syncing Price data...")
            result = _sync_price_data(session, graph_id, branch_id, args.ticker, args.since_ts)
            results.append(result)
            logger.info(f"Prices Sync Result: {result}")
        
        # Summary
        logger.info("=" * 60)
        logger.info("Sync Summary:")
        total_fetched = sum(r["fetched"] for r in results)
        total_ingested = sum(r["ingested"] for r in results)
        total_skipped = sum(r["skipped"] for r in results)
        total_failed = sum(r["failed"] for r in results)
        
        logger.info(f"Total: {total_fetched} fetched, {total_ingested} ingested, {total_skipped} skipped, {total_failed} failed")
        
        # Exit with error code if any failed
        if total_failed > 0:
            logger.warning(f"Some syncs failed ({total_failed} failures)")
            sys.exit(1)
        else:
            logger.info("All syncs completed successfully")
            sys.exit(0)
    
    except Exception as e:
        logger.error(f"Error during finance sync: {e}", exc_info=True)
        sys.exit(1)


if __name__ == "__main__":
    main()
