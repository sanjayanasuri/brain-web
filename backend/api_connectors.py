"""
FastAPI routes for finance connectors (SEC, News, Prices).
"""
from fastapi import APIRouter, HTTPException, Query
from typing import Optional, List
from neo4j import Session
import logging

from fastapi import Depends
from db_neo4j import get_neo4j_session
from neo4j import Session
from services_branch_explorer import get_active_graph_context, ensure_graph_scoping_initialized
from services_finance_ingestion import ingest_source_document
from services_sources import source_document_exists
from connectors.sec_edgar import fetch_company_filings, fetch_filing_text
from connectors.news import fetch_articles
from connectors.prices import fetch_price_data

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/connectors", tags=["connectors"])


def _sync_sec_filings(
    session: Session,
    graph_id: str,
    branch_id: str,
    ticker: str,
    form_types: Optional[List[str]] = None
) -> dict:
    """
    Sync SEC filings for a ticker.
    
    Returns:
        dict with counts: fetched, ingested, skipped, failed
    """
    if form_types is None:
        form_types = ["10-Q", "10-K", "8-K"]
    
    logger.info(f"[SEC Sync] Starting sync for {ticker}")
    
    # Fetch filings
    filings = fetch_company_filings(ticker, form_types=form_types, limit=50)
    logger.info(f"[SEC Sync] Fetched {len(filings)} filings for {ticker}")
    
    fetched = len(filings)
    ingested = 0
    skipped = 0
    failed = 0
    
    for filing in filings:
        external_id = filing["external_id"]
        url = filing["url"]
        doc_type = filing["type"]
        published_at = filing.get("published_at")
        
        # Check if already exists
        existing = source_document_exists(session, graph_id, external_id, source="SEC")
        if existing and existing.get("status") == "INGESTED":
            # Check if checksum changed (would need to fetch text to compare)
            # For now, skip if already ingested
            skipped += 1
            logger.info(f"[SEC Sync] Skipping {external_id} (already ingested)")
            continue
        
        # Fetch filing text
        text = fetch_filing_text(url)
        if not text:
            logger.warning(f"[SEC Sync] Failed to fetch text for {external_id}")
            failed += 1
            continue
        
        # Ingest
        result = ingest_source_document(
            session=session,
            graph_id=graph_id,
            branch_id=branch_id,
            source="SEC",
            external_id=external_id,
            url=url,
            text=text,
            company_ticker=ticker,
            doc_type=doc_type,
            published_at=published_at,
            metadata={
                "filing_date": filing.get("filing_date"),
                "report_date": filing.get("report_date"),
                "title": filing.get("title")
            }
        )
        
        if result["status"] == "INGESTED":
            ingested += 1
        elif result["status"] == "SKIPPED":
            skipped += 1
        else:
            failed += 1
            logger.error(f"[SEC Sync] Failed to ingest {external_id}: {result.get('error')}")
    
    logger.info(f"[SEC Sync] Completed for {ticker}: {fetched} fetched, {ingested} ingested, {skipped} skipped, {failed} failed")
    
    return {
        "ticker": ticker,
        "source": "SEC",
        "fetched": fetched,
        "ingested": ingested,
        "skipped": skipped,
        "failed": failed
    }


def _sync_news_articles(
    session: Session,
    graph_id: str,
    branch_id: str,
    ticker: str,
    since_ts: Optional[int] = None
) -> dict:
    """
    Sync news articles for a ticker.
    
    Returns:
        dict with counts: fetched, ingested, skipped, failed
    """
    logger.info(f"[News Sync] Starting sync for {ticker}")
    
    # Fetch articles
    articles = fetch_articles(ticker, since_ts=since_ts)
    logger.info(f"[News Sync] Fetched {len(articles)} articles for {ticker}")
    
    fetched = len(articles)
    ingested = 0
    skipped = 0
    failed = 0
    
    for article in articles:
        external_id = article.get("external_id") or article.get("url", "")
        url = article.get("url", "")
        title = article.get("title", "")
        published_at = article.get("published_at")
        text = article.get("text", "")
        
        if not external_id:
            logger.warning(f"[News Sync] Article missing external_id, skipping")
            failed += 1
            continue
        
        # Check if already exists
        existing = source_document_exists(session, graph_id, external_id, source="NEWS")
        if existing and existing.get("status") == "INGESTED":
            skipped += 1
            continue
        
        # If no text provided, we can't ingest (would need to fetch from URL)
        if not text:
            logger.warning(f"[News Sync] Article {external_id} has no text, skipping")
            skipped += 1
            continue
        
        # Ingest
        result = ingest_source_document(
            session=session,
            graph_id=graph_id,
            branch_id=branch_id,
            source="NEWS",
            external_id=external_id,
            url=url,
            text=text,
            company_ticker=ticker,
            doc_type="ARTICLE",
            published_at=published_at,
            metadata={
                "title": title
            }
        )
        
        if result["status"] == "INGESTED":
            ingested += 1
        elif result["status"] == "SKIPPED":
            skipped += 1
        else:
            failed += 1
            logger.error(f"[News Sync] Failed to ingest {external_id}: {result.get('error')}")
    
    logger.info(f"[News Sync] Completed for {ticker}: {fetched} fetched, {ingested} ingested, {skipped} skipped, {failed} failed")
    
    return {
        "ticker": ticker,
        "source": "NEWS",
        "fetched": fetched,
        "ingested": ingested,
        "skipped": skipped,
        "failed": failed
    }


def _sync_price_data(
    session: Session,
    graph_id: str,
    branch_id: str,
    ticker: str,
    since_ts: Optional[int] = None
) -> dict:
    """
    Sync price data for a ticker.
    
    Note: Price data ingestion is simplified - we create SourceDocument but don't
    extract claims from price points (they're structured data, not text).
    
    Returns:
        dict with counts: fetched, ingested, skipped, failed
    """
    logger.info(f"[Prices Sync] Starting sync for {ticker}")
    
    # Fetch price data
    price_points = fetch_price_data(ticker, since_ts=since_ts)
    logger.info(f"[Prices Sync] Fetched {len(price_points)} price points for {ticker}")
    
    fetched = len(price_points)
    ingested = 0
    skipped = 0
    failed = 0
    
    # For price data, we could either:
    # 1. Create one SourceDocument per day (simple)
    # 2. Create one SourceDocument for the entire series (better for aggregation)
    # For now, we'll create one SourceDocument for the series
    
    if not price_points:
        logger.info(f"[Prices Sync] No price data for {ticker}")
        return {
            "ticker": ticker,
            "source": "PRICES",
            "fetched": 0,
            "ingested": 0,
            "skipped": 0,
            "failed": 0
        }
    
    # Create a text representation of price data (CSV-like)
    # This allows it to go through the same pipeline, though claims extraction
    # won't be very useful for structured data
    price_lines = []
    for point in price_points:
        line = f"Date: {point.get('date')}, Open: {point.get('open')}, High: {point.get('high')}, Low: {point.get('low')}, Close: {point.get('close')}, Volume: {point.get('volume')}"
        price_lines.append(line)
    
    text = "\n".join(price_lines)
    external_id = f"{ticker}_PRICES_{price_points[0].get('date', 'UNKNOWN')}_{price_points[-1].get('date', 'UNKNOWN')}"
    url = f"https://api.example.com/prices/{ticker}"  # Placeholder
    
    # Check if already exists
    existing = source_document_exists(session, graph_id, external_id, source="PRICES")
    if existing and existing.get("status") == "INGESTED":
        skipped += 1
        return {
            "ticker": ticker,
            "source": "PRICES",
            "fetched": fetched,
            "ingested": 0,
            "skipped": 1,
            "failed": 0
        }
    
    # Ingest (will create chunks and claims, though claims from price data may not be very useful)
    result = ingest_source_document(
        session=session,
        graph_id=graph_id,
        branch_id=branch_id,
        source="PRICES",
        external_id=external_id,
        url=url,
        text=text,
        company_ticker=ticker,
        doc_type="PRICE_SERIES",
        published_at=price_points[-1].get("timestamp") if price_points else None,
        metadata={
            "point_count": len(price_points),
            "date_range": {
                "start": price_points[0].get("date") if price_points else None,
                "end": price_points[-1].get("date") if price_points else None
            }
        }
    )
    
    if result["status"] == "INGESTED":
        ingested += 1
    elif result["status"] == "SKIPPED":
        skipped += 1
    else:
        failed += 1
        logger.error(f"[Prices Sync] Failed to ingest {external_id}: {result.get('error')}")
    
    logger.info(f"[Prices Sync] Completed for {ticker}: {fetched} fetched, {ingested} ingested, {skipped} skipped, {failed} failed")
    
    return {
        "ticker": ticker,
        "source": "PRICES",
        "fetched": fetched,
        "ingested": ingested,
        "skipped": skipped,
        "failed": failed
    }


@router.post("/sec/sync")
def sync_sec(
    ticker: str = Query(..., description="Stock ticker symbol (e.g., NVDA)"),
    graph_id: Optional[str] = Query(None, description="Graph ID (uses active if not provided)"),
    branch_id: Optional[str] = Query(None, description="Branch ID (uses active if not provided)"),
    form_types: Optional[str] = Query(None, description="Comma-separated form types (e.g., '10-Q,10-K,8-K')"),
    session: Session = Depends(get_neo4j_session)
):
    """
    Sync SEC filings for a ticker.
    Fetches latest filings and ingests them into the graph.
    """
    try:
        ensure_graph_scoping_initialized(session)
        active_graph_id, active_branch_id = get_active_graph_context(session)
        
        graph_id = graph_id or active_graph_id
        branch_id = branch_id or active_branch_id
        
        form_types_list = None
        if form_types:
            form_types_list = [ft.strip() for ft in form_types.split(",")]
        
        result = _sync_sec_filings(session, graph_id, branch_id, ticker, form_types_list)
        return result
    except Exception as e:
        logger.error(f"[SEC Sync] Error: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/news/sync")
def sync_news(
    ticker: str = Query(..., description="Stock ticker symbol (e.g., NVDA)"),
    graph_id: Optional[str] = Query(None, description="Graph ID (uses active if not provided)"),
    branch_id: Optional[str] = Query(None, description="Branch ID (uses active if not provided)"),
    since_ts: Optional[int] = Query(None, description="Unix timestamp to fetch articles since"),
    session: Session = Depends(get_neo4j_session)
):
    """
    Sync news articles for a ticker.
    Fetches latest articles and ingests them into the graph.
    """
    try:
        ensure_graph_scoping_initialized(session)
        active_graph_id, active_branch_id = get_active_graph_context(session)
        
        graph_id = graph_id or active_graph_id
        branch_id = branch_id or active_branch_id
        
        result = _sync_news_articles(session, graph_id, branch_id, ticker, since_ts)
        return result
    except Exception as e:
        logger.error(f"[News Sync] Error: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/prices/sync")
def sync_prices(
    ticker: str = Query(..., description="Stock ticker symbol (e.g., NVDA)"),
    graph_id: Optional[str] = Query(None, description="Graph ID (uses active if not provided)"),
    branch_id: Optional[str] = Query(None, description="Branch ID (uses active if not provided)"),
    since_ts: Optional[int] = Query(None, description="Unix timestamp to fetch prices since"),
    session: Session = Depends(get_neo4j_session)
):
    """
    Sync price data for a ticker.
    Fetches latest price data and ingests it into the graph.
    """
    try:
        ensure_graph_scoping_initialized(session)
        active_graph_id, active_branch_id = get_active_graph_context(session)
        
        graph_id = graph_id or active_graph_id
        branch_id = branch_id or active_branch_id
        
        result = _sync_price_data(session, graph_id, branch_id, ticker, since_ts)
        return result
    except Exception as e:
        logger.error(f"[Prices Sync] Error: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))
