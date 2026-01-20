"""
Finance ingestion scheduler service.

Handles scheduled ingestion runs based on tracking configuration.
Can be called from:
- Cron jobs (local/EC2)
- ECS scheduled tasks (AWS)
- CloudWatch Events
- Any task scheduler
"""
import logging
from typing import List, Optional
from datetime import datetime, timedelta
from neo4j import Session

from services_finance_ingestion import ingest_finance_sources
from services_branch_explorer import ensure_graph_scoping_initialized, get_active_graph_context
from db_neo4j import get_driver

logger = logging.getLogger("brain_web")


def get_tracked_tickers(session: Session, enabled_only: bool = True) -> List[dict]:
    """
    Get list of tickers with tracking enabled.
    
    Args:
        session: Neo4j session
        enabled_only: If True, only return tickers with enabled=True
    
    Returns:
        List of dicts with ticker, enabled, cadence
    """
    query = """
    MATCH (t:FinanceTrack)
    WHERE t.enabled = $enabled OR $enabled_only = false
    RETURN t.ticker AS ticker,
           t.enabled AS enabled,
           t.cadence AS cadence,
           t.last_ingested_at AS last_ingested_at
    ORDER BY t.ticker
    """
    result = session.run(query, enabled=True, enabled_only=enabled_only)
    return [record.data() for record in result]


def should_ingest_ticker(ticker_config: dict, current_time: Optional[datetime] = None) -> bool:
    """
    Determine if a ticker should be ingested based on cadence and last ingestion time.
    
    Args:
        ticker_config: Dict with ticker, enabled, cadence, last_ingested_at
        current_time: Current time (defaults to now)
    
    Returns:
        True if ticker should be ingested
    """
    if not ticker_config.get("enabled", False):
        return False
    
    if current_time is None:
        current_time = datetime.utcnow()
    
    last_ingested_at = ticker_config.get("last_ingested_at")
    if not last_ingested_at:
        # Never ingested, should ingest
        return True
    
    # Parse last_ingested_at (ISO format string)
    try:
        if isinstance(last_ingested_at, str):
            last_time = datetime.fromisoformat(last_ingested_at.replace('Z', '+00:00'))
        else:
            last_time = last_ingested_at
    except Exception:
        # If parsing fails, assume we should ingest
        logger.warning(f"Failed to parse last_ingested_at for {ticker_config.get('ticker')}, defaulting to ingest")
        return True
    
    cadence = ticker_config.get("cadence", "daily")
    
    # Calculate time since last ingestion
    time_since = current_time - last_time.replace(tzinfo=None) if last_time.tzinfo else current_time - last_time
    
    # Determine threshold based on cadence
    if cadence == "daily":
        threshold = timedelta(days=1)
    elif cadence == "weekly":
        threshold = timedelta(days=7)
    elif cadence == "monthly":
        threshold = timedelta(days=30)
    else:
        # Unknown cadence, default to daily
        threshold = timedelta(days=1)
    
    return time_since >= threshold


def run_scheduled_ingestion(
    session: Session,
    graph_id: Optional[str] = None,
    branch_id: Optional[str] = None,
    ticker: Optional[str] = None,
    force: bool = False,
) -> dict:
    """
    Run scheduled ingestion for tracked tickers.
    
    Args:
        session: Neo4j session
        graph_id: Optional graph ID (uses active if not provided)
        branch_id: Optional branch ID (uses active if not provided)
        ticker: Optional specific ticker to ingest (if None, processes all tracked tickers)
        force: If True, ingest even if cadence threshold not met
    
    Returns:
        Dict with results: {tickers_processed: int, tickers_ingested: int, errors: List[str]}
    """
    ensure_graph_scoping_initialized(session)
    
    if not graph_id or not branch_id:
        graph_id, branch_id = get_active_graph_context(session)
    
    # Get tracked tickers
    if ticker:
        # Get specific ticker config
        query = """
        MATCH (t:FinanceTracking {ticker: $ticker})
        RETURN t.ticker AS ticker,
               t.enabled AS enabled,
               t.cadence AS cadence,
               t.last_ingested_at AS last_ingested_at
        """
        result = session.run(query, ticker=ticker.upper())
        record = result.single()
        if not record:
            return {
                "tickers_processed": 0,
                "tickers_ingested": 0,
                "errors": [f"Ticker {ticker} not found in tracking config"]
            }
        tickers_to_process = [record.data()]
    else:
        tickers_to_process = get_tracked_tickers(session, enabled_only=True)
    
    if not tickers_to_process:
        logger.info("[Finance Scheduler] No tracked tickers found")
        return {
            "tickers_processed": 0,
            "tickers_ingested": 0,
            "errors": []
        }
    
    tickers_processed = 0
    tickers_ingested = 0
    errors = []
    
    for ticker_config in tickers_to_process:
        ticker = ticker_config["ticker"]
        tickers_processed += 1
        
        # Check if should ingest
        if not force and not should_ingest_ticker(ticker_config):
            logger.info(f"[Finance Scheduler] Skipping {ticker} (cadence threshold not met)")
            continue
        
        try:
            logger.info(f"[Finance Scheduler] Ingesting {ticker}")
            
            # Run ingestion
            result = ingest_finance_sources(
                session=session,
                graph_id=graph_id,
                branch_id=branch_id,
                ticker=ticker,
                since_days=30,  # Default lookback
                limit=20,  # Default limit
                connectors=["edgar", "ir", "news"],  # Default connectors
            )
            
            # Update last_ingested_at
            update_query = """
            MATCH (t:FinanceTrack {ticker: $ticker})
            SET t.last_ingested_at = $now
            """
            now_iso = datetime.utcnow().isoformat() + "Z"
            session.run(update_query, ticker=ticker, now=now_iso)
            
            tickers_ingested += 1
            logger.info(f"[Finance Scheduler] Successfully ingested {ticker}: {result.get('documents_fetched', 0)} docs, {result.get('claims_created', 0)} claims")
            
        except Exception as e:
            error_msg = f"Failed to ingest {ticker}: {str(e)}"
            logger.error(f"[Finance Scheduler] {error_msg}", exc_info=True)
            errors.append(error_msg)
    
    return {
        "tickers_processed": tickers_processed,
        "tickers_ingested": tickers_ingested,
        "errors": errors,
    }


def run_scheduled_ingestion_cli():
    """
    CLI entry point for scheduled ingestion.
    Can be called from cron, ECS scheduled tasks, etc.
    
    Usage:
        python -m services_finance_scheduler [--ticker TICKER] [--force]
    """
    import argparse
    
    parser = argparse.ArgumentParser(description="Run scheduled finance ingestion")
    parser.add_argument("--ticker", help="Specific ticker to ingest (optional)")
    parser.add_argument("--force", action="store_true", help="Force ingestion even if cadence threshold not met")
    parser.add_argument("--graph-id", help="Graph ID (optional, uses active)")
    parser.add_argument("--branch-id", help="Branch ID (optional, uses active)")
    
    args = parser.parse_args()
    
    driver = get_driver()
    with driver.session() as session:
        result = run_scheduled_ingestion(
            session=session,
            graph_id=args.graph_id,
            branch_id=args.branch_id,
            ticker=args.ticker,
            force=args.force,
        )
        
        print(f"Processed: {result['tickers_processed']}, Ingested: {result['tickers_ingested']}")
        if result['errors']:
            print(f"Errors: {len(result['errors'])}")
            for error in result['errors']:
                print(f"  - {error}")


if __name__ == "__main__":
    run_scheduled_ingestion_cli()

