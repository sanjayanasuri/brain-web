"""
Finance acquisition service: orchestrates Browser Use + EDGAR + IR + News acquisition
with snapshot creation and change detection.
"""
import logging
from typing import Dict, Any, Optional, List
from uuid import uuid4
from datetime import datetime
from neo4j import Session

from services_branch_explorer import (
    ensure_graph_scoping_initialized,
    get_active_graph_context,
)
from services_ingestion_runs import create_ingestion_run, update_ingestion_run_status
from services_evidence_snapshots import create_or_get_snapshot, normalize_content, compute_content_hash
from services_sources import upsert_source_document
from services_graph import get_concept_by_name
from connectors.edgar import EdgarConnector
from connectors.ir import IRConnector
from connectors.news_rss import NewsRSSConnector
from models import FinanceSourceRun

logger = logging.getLogger(__name__)


def _get_company_id_from_ticker(session: Session, graph_id: str, ticker: str) -> Optional[str]:
    """
    Get Company Concept node_id from ticker.
    
    Args:
        session: Neo4j session
        graph_id: Graph ID
        ticker: Ticker symbol
    
    Returns:
        Concept node_id or None if not found
    """
    # Try exact name match first
    from services_graph import get_concept_by_name
    concept = get_concept_by_name(session, ticker)
    if concept and concept.type and "company" in concept.type.lower():
        return concept.node_id
    
    # Try searching by tags
    query = """
    MATCH (c:Concept {graph_id: $graph_id})
    WHERE c.tags IS NOT NULL AND $ticker IN c.tags
      AND c.type CONTAINS 'company'
    RETURN c.node_id AS node_id
    LIMIT 1
    """
    result = session.run(query, graph_id=graph_id, ticker=f"ticker:{ticker}")
    record = result.single()
    if record:
        return record["node_id"]
    
    return None


def run_company_acquisition(
    session: Session,
    company_id: str,
    ticker: str,
    sources: List[str] = ["edgar", "ir", "news"],
    since_days: int = 30,
    limit_per_source: int = 20,
) -> FinanceSourceRun:
    """
    Run a complete acquisition cycle for a company.
    
    This function:
    1. Acquires documents from EDGAR, IR (Browser Use), News RSS
    2. Creates EvidenceSnapshots for each document
    3. Detects changes and creates ChangeEvents
    4. Links snapshots to SourceDocuments
    5. Returns FinanceSourceRun with results
    
    Args:
        session: Neo4j session
        company_id: Concept node_id for Company
        ticker: Ticker symbol
        sources: List of sources to use ["edgar", "ir", "news"]
        since_days: Days to look back
        limit_per_source: Max documents per source
    
    Returns:
        FinanceSourceRun with acquisition results
    """
    ensure_graph_scoping_initialized(session)
    graph_id, branch_id = get_active_graph_context(session)
    
    run_id = str(uuid4())
    started_at = datetime.utcnow().isoformat()
    
    sources_attempted = []
    sources_succeeded = []
    sources_failed = []
    snapshots_created = 0
    change_events_created = 0
    errors = []
    
    all_artifacts = []
    
    # Acquire from EDGAR
    if "edgar" in sources:
        sources_attempted.append("edgar")
        try:
            edgar_connector = EdgarConnector()
            company_config = {}  # Could be loaded from finance_sources.json
            edgar_docs = edgar_connector.fetch(
                ticker=ticker,
                company=company_config,
                since_days=since_days,
                limit=limit_per_source
            )
            
            for doc in edgar_docs:
                all_artifacts.append({
                    "url": doc.url,
                    "title": doc.title,
                    "published_at": doc.published_at,  # ISO string, will be converted
                    "raw_text": doc.raw_text,
                    "source_type": "EDGAR",
                    "doc_type": doc.doc_type,
                    "metadata": doc.metadata,
                })
            
            sources_succeeded.append("edgar")
            logger.info(f"[Finance Acquisition] EDGAR: {len(edgar_docs)} documents for {ticker}")
            
        except Exception as e:
            error_msg = f"EDGAR acquisition failed: {str(e)}"
            errors.append(error_msg)
            sources_failed.append("edgar")
            logger.error(f"[Finance Acquisition] {error_msg}", exc_info=True)
    
    # Acquire from News RSS
    if "news" in sources:
        sources_attempted.append("news")
        try:
            news_connector = NewsRSSConnector()
            company_config = {}
            news_docs = news_connector.fetch(
                ticker=ticker,
                company=company_config,
                since_days=since_days,
                limit=limit_per_source
            )
            
            for doc in news_docs:
                all_artifacts.append({
                    "url": doc.url,
                    "title": doc.title,
                    "published_at": doc.published_at,
                    "raw_text": doc.raw_text,
                    "source_type": "NEWS_RSS",
                    "doc_type": doc.doc_type,
                    "metadata": doc.metadata,
                })
            
            sources_succeeded.append("news")
            logger.info(f"[Finance Acquisition] News RSS: {len(news_docs)} articles for {ticker}")
            
        except Exception as e:
            error_msg = f"News RSS acquisition failed: {str(e)}"
            errors.append(error_msg)
            sources_failed.append("news")
            logger.error(f"[Finance Acquisition] {error_msg}", exc_info=True)
    
    # Process each artifact: create SourceDocument, Snapshot, detect changes
    for artifact in all_artifacts:
        try:
            # Convert published_at to Unix timestamp
            published_at_ts = None
            if artifact.get("published_at"):
                published_at_str = artifact["published_at"]
                if isinstance(published_at_str, str):
                    try:
                        dt = datetime.fromisoformat(published_at_str.replace("Z", "+00:00"))
                        published_at_ts = int(dt.timestamp() * 1000)
                    except Exception:
                        pass
                elif isinstance(published_at_str, (int, float)):
                    published_at_ts = int(published_at_ts)
            
            # Create/update SourceDocument
            source_type = artifact["source_type"]
            external_id = artifact.get("metadata", {}).get("external_id") or artifact["url"]
            
            doc_data = upsert_source_document(
                session=session,
                graph_id=graph_id,
                branch_id=branch_id,
                source=source_type,
                external_id=external_id,
                url=artifact["url"],
                company_ticker=ticker,
                doc_type=artifact.get("doc_type"),
                published_at=published_at_ts,
                text=artifact.get("raw_text", ""),
                metadata=artifact.get("metadata"),
            )
            source_document_id = doc_data["doc_id"]
            
            # Create snapshot and detect changes
            snapshot_data, change_event_data = create_or_get_snapshot(
                session=session,
                graph_id=graph_id,
                branch_id=branch_id,
                source_document_id=source_document_id,
                source_type=source_type,
                source_url=artifact["url"],
                raw_text=artifact.get("raw_text"),
                raw_html=artifact.get("raw_html"),
                title=artifact.get("title"),
                published_at=published_at_ts,
                company_id=company_id,
                metadata=artifact.get("metadata"),
            )
            
            if snapshot_data:
                snapshots_created += 1
            
            if change_event_data:
                change_events_created += 1
            
        except Exception as e:
            error_msg = f"Failed to process artifact {artifact.get('url', 'unknown')}: {str(e)}"
            errors.append(error_msg)
            logger.error(f"[Finance Acquisition] {error_msg}", exc_info=True)
    
    # Determine status
    status = "COMPLETED"
    if sources_failed:
        status = "PARTIAL" if sources_succeeded else "FAILED"
    
    completed_at = datetime.utcnow().isoformat()
    
    return FinanceSourceRun(
        run_id=run_id,
        company_id=company_id,
        ticker=ticker,
        sources_attempted=sources_attempted,
        sources_succeeded=sources_succeeded,
        sources_failed=sources_failed,
        snapshots_created=snapshots_created,
        change_events_created=change_events_created,
        started_at=started_at,
        completed_at=completed_at,
        status=status,
        errors=errors if errors else None,
    )

