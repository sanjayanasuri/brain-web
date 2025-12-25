import os
import logging
import time
import json
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from db_neo4j import get_neo4j_session
from services_browser_use import execute_skill, BrowserUseAPIError
from services_resources import create_resource, link_resource_to_concept
from services_graph import create_concept, get_concept_by_name
from models import ConceptCreate, Resource
from config import DEMO_MODE, DEMO_ALLOW_WRITES

router = APIRouter(prefix="/finance", tags=["finance"])
logger = logging.getLogger("brain_web")

DISCOVERY_SKILL_ID = os.environ.get("BROWSER_USE_FINANCE_DISCOVERY_SKILL_ID")
TRACKER_SKILL_ID = os.environ.get("BROWSER_USE_FINANCE_TRACKER_SKILL_ID")
# Fallback to TRACKER_SKILL_ID if BROWSER_USE_FINANCE_SKILL_ID is not set
FINANCE_SKILL_ID = os.environ.get("BROWSER_USE_FINANCE_SKILL_ID") or TRACKER_SKILL_ID


# -------------------- Models --------------------

class FinanceDiscoverRequest(BaseModel):
    concept_id: Optional[str] = None
    domain_query: str
    limit: int = 15
    filters: Dict[str, Any] = Field(default_factory=dict)


class FinanceTrackRequest(BaseModel):
    ticker: str
    concept_id: Optional[str] = None  # Optional - will create/upsert if not provided
    news_window_days: int = 7
    max_news_items: int = 8
    sources_profile: str = "credible_default"


class FinanceTrackResponse(BaseModel):
    concept_id: str
    resource: Resource


class FinanceSnapshotRequest(BaseModel):
    ticker: str
    concept_id: Optional[str] = None
    news_window_days: int = 7
    max_news_items: int = 5


class FinanceTrackingConfig(BaseModel):
    ticker: str
    enabled: bool
    cadence: str = "daily"  # daily, weekly, monthly


class FinanceTrackingResponse(BaseModel):
    ticker: str
    enabled: bool
    cadence: str


class FinanceTrackingListResponse(BaseModel):
    tickers: List[FinanceTrackingResponse]


class LatestSnapshotMetadata(BaseModel):
    ticker: str
    resource_id: Optional[str] = None
    snapshot_fetched_at: Optional[str] = None  # ISO string from resource.created_at
    market_as_of: Optional[str] = None  # From metadata.price.as_of or metadata.size.as_of
    company_name: Optional[str] = None  # From metadata.identity.name


class LatestSnapshotsResponse(BaseModel):
    snapshots: List[LatestSnapshotMetadata]


# -------------------- Helpers --------------------

def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _caption_from_discovery(out: Dict[str, Any]) -> str:
    companies = out.get("companies", [])[:10]
    if not companies:
        return "No companies returned by the discovery skill."

    lines = ["Top candidates:"]
    for c in companies:
        name = (c.get("name") or "").strip()
        ticker = (c.get("ticker") or "").strip()
        why = (c.get("one_line_why") or "").strip()

        if name and ticker:
            lines.append(f"- {name} ({ticker}): {why}")
        elif name:
            lines.append(f"- {name}: {why}")
        else:
            continue

    return "\n".join(lines)


def _caption_from_tracker(out: Dict[str, Any]) -> str:
    """Generate a human-readable caption from finance tracker output (max ~600 chars)."""
    identity = out.get("identity", {}) or {}
    size = out.get("size", {}) or {}
    price = out.get("price", {}) or {}
    news = (out.get("news", []) or [])[:3]  # Top 3 news items

    name = (identity.get("name") or "").strip()
    ticker = (identity.get("ticker") or "").strip()
    header = f"{name} ({ticker})" if name or ticker else f"Company ({ticker})"

    lines = [header]

    market_cap = size.get("market_cap")
    last_price = price.get("last_price")
    change_1w = price.get("change_1w")
    change_1m = price.get("change_1m")
    as_of = price.get("as_of") or size.get("as_of")

    if market_cap is not None:
        lines.append(f"Market cap: {market_cap}")
    if last_price is not None:
        lines.append(f"Price: {last_price}")
    if change_1w is not None:
        lines.append(f"1w: {change_1w}")
    if change_1m is not None:
        lines.append(f"1m: {change_1m}")
    if as_of:
        lines.append(f"As of: {as_of}")

    if news:
        lines.append("Top news:")
        for n in news:
            title = (n.get("title") or "").strip()
            if title:
                # Truncate long titles
                if len(title) > 80:
                    title = title[:77] + "..."
                lines.append(f"- {title}")

    caption = "\n".join(lines).strip()
    # Enforce max length
    if len(caption) > 600:
        caption = caption[:597] + "..."
    return caption


def _validate_skill_output(skill_out: Dict[str, Any]) -> None:
    """Validate that skill output has expected top-level keys."""
    expected_keys = ["identity", "size", "price", "news", "comparables", "sources", "evidence_map"]
    missing_keys = [key for key in expected_keys if key not in skill_out]
    if missing_keys:
        raise HTTPException(
            status_code=502,
            detail=f"Invalid skill output: missing keys {missing_keys}. Browser Use skill may have failed."
        )


def _upsert_company_concept(
    session,
    ticker: str,
    company_name: Optional[str] = None,
    exchange: Optional[str] = None,
    sector: Optional[str] = None,
    industry: Optional[str] = None,
) -> str:
    """
    Upsert a Company concept for the given ticker.
    Returns the concept's node_id.
    """
    # Use company name if available, otherwise use ticker
    concept_name = company_name or ticker
    
    # Check if concept already exists
    existing = get_concept_by_name(session, concept_name)
    if existing:
        logger.info(f"Found existing Company concept: {existing.node_id} ({concept_name})")
        return existing.node_id
    
    # Create new Company concept
    description_parts = []
    if exchange:
        description_parts.append(f"Exchange: {exchange}")
    if sector:
        description_parts.append(f"Sector: {sector}")
    if industry:
        description_parts.append(f"Industry: {industry}")
    description = "; ".join(description_parts) if description_parts else f"Public company (ticker: {ticker})"
    
    # Build tags from available info
    tags = []
    if ticker:
        tags.append(f"ticker:{ticker}")
    if sector:
        tags.append(f"sector:{sector.lower()}")
    
    concept_payload = ConceptCreate(
        name=concept_name,
        domain="finance",
        type="company",
        description=description,
        tags=tags if tags else None,
    )
    
    concept = create_concept(session, concept_payload)
    logger.info(f"Created new Company concept: {concept.node_id} ({concept_name})")
    return concept.node_id


def _get_finance_tracking(session, ticker: str) -> Optional[FinanceTrackingResponse]:
    """Get tracking configuration for a ticker."""
    query = """
    MATCH (ft:FinanceTrack {ticker: $ticker})
    RETURN ft.enabled AS enabled, ft.cadence AS cadence
    """
    result = session.run(query, ticker=ticker)
    record = result.single()
    if not record:
        return None
    return FinanceTrackingResponse(
        ticker=ticker,
        enabled=record["enabled"],
        cadence=record.get("cadence") or "daily",
    )


def _upsert_finance_tracking(session, ticker: str, enabled: bool, cadence: str) -> FinanceTrackingResponse:
    """Create or update tracking configuration for a ticker."""
    query = """
    MERGE (ft:FinanceTrack {ticker: $ticker})
    SET ft.enabled = $enabled,
        ft.cadence = $cadence,
        ft.updated_at = datetime()
    RETURN ft.enabled AS enabled, ft.cadence AS cadence
    """
    result = session.run(query, ticker=ticker, enabled=enabled, cadence=cadence)
    record = result.single()
    if not record:
        raise ValueError(f"Failed to upsert FinanceTrack for ticker {ticker}")
    return FinanceTrackingResponse(
        ticker=ticker,
        enabled=record["enabled"],
        cadence=record.get("cadence") or "daily",
    )


def _list_all_tracked_tickers(session) -> List[FinanceTrackingResponse]:
    """List all tickers with tracking enabled."""
    query = """
    MATCH (ft:FinanceTrack)
    WHERE ft.enabled = true
    RETURN ft.ticker AS ticker, ft.enabled AS enabled, ft.cadence AS cadence
    ORDER BY ft.ticker
    """
    result = session.run(query)
    tickers = []
    for record in result:
        tickers.append(FinanceTrackingResponse(
            ticker=record["ticker"],
            enabled=record["enabled"],
            cadence=record.get("cadence") or "daily",
        ))
    return tickers


def _get_latest_snapshots_for_tickers(session, tickers: List[str]) -> List[LatestSnapshotMetadata]:
    """
    Get the latest snapshot metadata for each ticker.
    Finds resources with source='browser_use' and metadata.identity.ticker matching.
    """
    if not tickers:
        return []
    
    # Query all browser_use resources and filter in Python
    # This is simpler and more reliable than trying to parse JSON in Cypher
    query = """
    MATCH (r:Resource)
    WHERE r.source = 'browser_use'
      AND r.metadata_json IS NOT NULL
    RETURN r.resource_id AS resource_id,
           r.created_at AS snapshot_fetched_at,
           r.metadata_json AS metadata_json
    ORDER BY r.created_at DESC
    """
    
    result = session.run(query)
    
    # Build a map of ticker -> latest snapshot
    ticker_to_snapshot: Dict[str, Dict[str, Any]] = {}
    
    for record in result:
        resource_id = record.get("resource_id")
        snapshot_fetched_at = record.get("snapshot_fetched_at")
        metadata_json_str = record.get("metadata_json")
        
        # Parse metadata
        metadata = None
        if metadata_json_str:
            try:
                metadata = json.loads(metadata_json_str) if isinstance(metadata_json_str, str) else metadata_json_str
            except (json.JSONDecodeError, TypeError):
                metadata = None
        
        if not metadata or not isinstance(metadata, dict):
            continue
        
        identity = metadata.get("identity") or {}
        ticker = identity.get("ticker")
        
        if not ticker or ticker not in tickers:
            continue
        
        # Convert created_at to ISO string if needed
        if snapshot_fetched_at:
            if hasattr(snapshot_fetched_at, 'to_native'):
                snapshot_fetched_at = snapshot_fetched_at.to_native().isoformat()
            elif isinstance(snapshot_fetched_at, datetime):
                snapshot_fetched_at = snapshot_fetched_at.isoformat()
            elif not isinstance(snapshot_fetched_at, str):
                snapshot_fetched_at = str(snapshot_fetched_at)
        
        # Get market_as_of from price or size
        market_as_of = None
        price = metadata.get("price") or {}
        size = metadata.get("size") or {}
        market_as_of = price.get("as_of") or size.get("as_of")
        
        # Only keep the latest snapshot per ticker
        if ticker not in ticker_to_snapshot:
            ticker_to_snapshot[ticker] = {
                "resource_id": resource_id,
                "snapshot_fetched_at": snapshot_fetched_at,
                "market_as_of": market_as_of,
                "company_name": identity.get("name"),
            }
        else:
            # Compare timestamps to keep the latest
            existing_time = ticker_to_snapshot[ticker]["snapshot_fetched_at"]
            if snapshot_fetched_at and existing_time:
                try:
                    # Handle both ISO format strings and datetime objects
                    existing_str = existing_time if isinstance(existing_time, str) else existing_time.isoformat()
                    new_str = snapshot_fetched_at if isinstance(snapshot_fetched_at, str) else snapshot_fetched_at.isoformat()
                    existing_dt = datetime.fromisoformat(existing_str.replace('Z', '+00:00'))
                    new_dt = datetime.fromisoformat(new_str.replace('Z', '+00:00'))
                    if new_dt > existing_dt:
                        ticker_to_snapshot[ticker] = {
                            "resource_id": resource_id,
                            "snapshot_fetched_at": snapshot_fetched_at,
                            "market_as_of": market_as_of,
                            "company_name": identity.get("name"),
                        }
                except (ValueError, AttributeError):
                    pass
    
    # Convert to response models
    snapshots = []
    for ticker in tickers:
        if ticker in ticker_to_snapshot:
            data = ticker_to_snapshot[ticker]
            snapshots.append(LatestSnapshotMetadata(
                ticker=ticker,
                resource_id=data["resource_id"],
                snapshot_fetched_at=data["snapshot_fetched_at"],
                market_as_of=data["market_as_of"],
                company_name=data["company_name"],
            ))
        else:
            # Include ticker even if no snapshot found
            snapshots.append(LatestSnapshotMetadata(
                ticker=ticker,
                resource_id=None,
                snapshot_fetched_at=None,
                market_as_of=None,
                company_name=None,
            ))
    
    return snapshots


# -------------------- Endpoints --------------------

@router.post("/discover")
def discover_companies(req: FinanceDiscoverRequest, session=Depends(get_neo4j_session)):
    if not DISCOVERY_SKILL_ID:
        raise HTTPException(status_code=500, detail="BROWSER_USE_FINANCE_DISCOVERY_SKILL_ID not configured")

    try:
        skill_out = execute_skill(
            DISCOVERY_SKILL_ID,
            parameters={
                "domain_query": req.domain_query,
                "limit": req.limit,
                "filters": req.filters,
            },
        )
    except BrowserUseAPIError as e:
        # Preserve HTTP status code from Browser Use API
        status_code = 502 if not e.status_code or e.status_code >= 500 else 400
        raise HTTPException(
            status_code=status_code,
            detail=f"Failed to execute Browser Use skill: {str(e)}"
        )
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to execute Browser Use skill: {str(e)}"
        )

    resource = create_resource(
        session=session,
        kind="web_link",
        url=f"browseruse://skills/{DISCOVERY_SKILL_ID}?domain={req.domain_query}",
        title=f"Company discovery: {req.domain_query}",
        caption=_caption_from_discovery(skill_out),
        source="browser_use",
        metadata={
            "schema": "finance_discovery_v1",
            "retrieved_at": _now_iso(),
            "input": req.model_dump(),
            "output": skill_out,
        },
    )

    if req.concept_id:
        link_resource_to_concept(
            session=session,
            concept_id=req.concept_id,
            resource_id=resource.resource_id,
        )

    return {
        "resource": resource.model_dump(),
        "candidates": skill_out.get("companies", []),
    }


@router.post("/track", response_model=FinanceTrackResponse)
def track_company(
    req: FinanceTrackRequest,
    session=Depends(get_neo4j_session)
):
    """
    Track a company ticker using Browser Use finance tracker skill.
    
    Creates/upserts a Company concept and stores the finance snapshot as a Resource.
    The Resource is linked to the Company concept and becomes retrievable by GraphRAG.
    """
    # Check allow_writes in demo mode
    if DEMO_MODE and not DEMO_ALLOW_WRITES:
        raise HTTPException(
            status_code=403,
            detail="Writes are disabled in demo mode. Set DEMO_ALLOW_WRITES=true to enable, or use a non-demo environment."
        )
    
    if not TRACKER_SKILL_ID:
        raise HTTPException(
            status_code=500,
            detail="BROWSER_USE_FINANCE_TRACKER_SKILL_ID not configured. Please set the environment variable."
        )

    # Execute Browser Use skill with timing
    start_time = time.time()
    try:
        skill_out = execute_skill(
            TRACKER_SKILL_ID,
            parameters={
                "ticker": req.ticker,
                "news_window_days": req.news_window_days,
                "max_news_items": req.max_news_items,
                "sources_profile": req.sources_profile,
            },
        )
        latency_ms = int((time.time() - start_time) * 1000)
        logger.info(f"Browser Use skill execution succeeded in {latency_ms}ms for ticker {req.ticker}")
    except BrowserUseAPIError as e:
        latency_ms = int((time.time() - start_time) * 1000)
        error_msg = str(e)
        logger.error(
            f"Browser Use skill execution failed after {latency_ms}ms for ticker {req.ticker}: {error_msg}"
        )
        # Preserve HTTP status code from Browser Use API
        status_code = 502 if not e.status_code or e.status_code >= 500 else 400
        raise HTTPException(
            status_code=status_code,
            detail=f"Browser Use skill execution failed: {error_msg}"
        )
    except Exception as e:
        latency_ms = int((time.time() - start_time) * 1000)
        error_msg = str(e)
        logger.error(
            f"Browser Use skill execution failed after {latency_ms}ms for ticker {req.ticker}: {error_msg}"
        )
        # Return 502 with clear error message
        raise HTTPException(
            status_code=502,
            detail=f"Browser Use skill execution failed: {error_msg}"
        )

    # Validate skill output structure
    try:
        _validate_skill_output(skill_out)
    except HTTPException:
        raise  # Re-raise validation errors
    except Exception as e:
        logger.error(f"Unexpected error validating skill output: {e}")
        raise HTTPException(
            status_code=502,
            detail=f"Invalid skill output format: {str(e)}"
        )

    # Extract company info from skill output
    identity = skill_out.get("identity", {}) or {}
    company_name = identity.get("name")
    exchange = identity.get("exchange")
    sector = identity.get("sector")
    industry = identity.get("industry")

    # Upsert Company concept (or use provided concept_id)
    if req.concept_id:
        concept_id = req.concept_id
        logger.info(f"Using provided concept_id: {concept_id}")
    else:
        concept_id = _upsert_company_concept(
            session=session,
            ticker=req.ticker,
            company_name=company_name,
            exchange=exchange,
            sector=sector,
            industry=industry,
        )

    # Create Resource with full skill output in metadata
    caption = _caption_from_tracker(skill_out)
    resource = create_resource(
        session=session,
        kind="web_link",
        url=f"browseruse://skills/{TRACKER_SKILL_ID}?ticker={req.ticker}",
        title=f"Finance snapshot: {req.ticker}",
        caption=caption,
        source="browser_use",
        metadata=skill_out,  # Full skill output stored here
    )

    # Link Resource to Concept
    link_resource_to_concept(
        session=session,
        concept_id=concept_id,
        resource_id=resource.resource_id,
    )

    logger.info(
        f"Finance track completed: ticker={req.ticker}, concept_id={concept_id}, resource_id={resource.resource_id}"
    )

    return FinanceTrackResponse(
        concept_id=concept_id,
        resource=resource,
    )


@router.post("/snapshot", response_model=Resource)
def fetch_snapshot(
    req: FinanceSnapshotRequest,
    session=Depends(get_neo4j_session)
):
    """
    Fetch a finance snapshot for a ticker and store it as a Resource.
    If concept_id is provided, link the resource to that concept.
    """
    # Check allow_writes in demo mode
    if DEMO_MODE and not DEMO_ALLOW_WRITES:
        raise HTTPException(
            status_code=403,
            detail="Writes are disabled in demo mode. Set DEMO_ALLOW_WRITES=true to enable, or use a non-demo environment."
        )
    
    skill_id = FINANCE_SKILL_ID or TRACKER_SKILL_ID
    if not skill_id:
        raise HTTPException(
            status_code=500,
            detail="BROWSER_USE_FINANCE_SKILL_ID or BROWSER_USE_FINANCE_TRACKER_SKILL_ID not configured. Please set the environment variable."
        )

    # Execute Browser Use skill
    start_time = time.time()
    try:
        skill_out = execute_skill(
            skill_id,
            parameters={
                "ticker": req.ticker,
                "news_window_days": req.news_window_days,
                "max_news_items": req.max_news_items,
            },
        )
        latency_ms = int((time.time() - start_time) * 1000)
        logger.info(f"Browser Use skill execution succeeded in {latency_ms}ms for ticker {req.ticker}")
    except BrowserUseAPIError as e:
        latency_ms = int((time.time() - start_time) * 1000)
        error_msg = str(e)
        logger.error(
            f"Browser Use skill execution failed after {latency_ms}ms for ticker {req.ticker}: {error_msg}"
        )
        # Preserve HTTP status code from Browser Use API
        status_code = 502 if not e.status_code or e.status_code >= 500 else 400
        raise HTTPException(
            status_code=status_code,
            detail=f"Browser Use skill execution failed: {error_msg}"
        )
    except Exception as e:
        latency_ms = int((time.time() - start_time) * 1000)
        error_msg = str(e)
        logger.error(
            f"Browser Use skill execution failed after {latency_ms}ms for ticker {req.ticker}: {error_msg}"
        )
        raise HTTPException(
            status_code=502,
            detail=f"Browser Use skill execution failed: {error_msg}"
        )

    # Validate skill output structure
    try:
        _validate_skill_output(skill_out)
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Unexpected error validating skill output: {e}")
        raise HTTPException(
            status_code=502,
            detail=f"Invalid skill output format: {str(e)}"
        )

    # Extract company info for title
    identity = skill_out.get("identity", {}) or {}
    company_name = identity.get("name")
    as_of = skill_out.get("price", {}).get("as_of") or skill_out.get("size", {}).get("as_of") or ""
    
    # Generate title with as_of date
    title = f"Finance snapshot: {req.ticker}"
    if as_of:
        title += f" ({as_of})"
    
    # Generate caption
    caption = _caption_from_tracker(skill_out)
    
    # Create Resource
    resource = create_resource(
        session=session,
        kind="web_link",
        url=f"browseruse://skills/{skill_id}?ticker={req.ticker}",
        title=title,
        caption=caption,
        source="browser_use",
        metadata=skill_out,  # Full skill output stored here
    )

    # Link Resource to Concept if concept_id provided
    if req.concept_id:
        link_resource_to_concept(
            session=session,
            concept_id=req.concept_id,
            resource_id=resource.resource_id,
        )
        logger.info(f"Linked snapshot resource {resource.resource_id} to concept {req.concept_id}")

    logger.info(f"Finance snapshot created: ticker={req.ticker}, resource_id={resource.resource_id}")
    return resource


@router.get("/tracking", response_model=Optional[FinanceTrackingResponse])
def get_tracking(
    ticker: str,
    session=Depends(get_neo4j_session)
):
    """Get tracking configuration for a ticker."""
    return _get_finance_tracking(session, ticker)


@router.post("/tracking", response_model=FinanceTrackingResponse)
def set_tracking(
    req: FinanceTrackingConfig,
    session=Depends(get_neo4j_session)
):
    """Create or update tracking configuration for a ticker."""
    # Check allow_writes in demo mode
    if DEMO_MODE and not DEMO_ALLOW_WRITES:
        raise HTTPException(
            status_code=403,
            detail="Writes are disabled in demo mode. Set DEMO_ALLOW_WRITES=true to enable, or use a non-demo environment."
        )
    
    if req.cadence not in ["daily", "weekly", "monthly"]:
        raise HTTPException(
            status_code=400,
            detail="cadence must be one of: daily, weekly, monthly"
        )
    
    return _upsert_finance_tracking(session, req.ticker, req.enabled, req.cadence)


@router.get("/tracking/list", response_model=FinanceTrackingListResponse)
def list_tracking(session=Depends(get_neo4j_session)):
    """List all tickers with tracking enabled."""
    tickers = _list_all_tracked_tickers(session)
    return FinanceTrackingListResponse(tickers=tickers)


@router.get("/snapshots/latest", response_model=LatestSnapshotsResponse)
def get_latest_snapshots(
    tickers: str = None,  # Comma-separated list of tickers
    session=Depends(get_neo4j_session)
):
    """
    Get the latest snapshot metadata for each ticker.
    Query param: tickers (comma-separated, e.g., "AAPL,MSFT,GOOGL")
    """
    if not tickers:
        return LatestSnapshotsResponse(snapshots=[])
    
    ticker_list = [t.strip().upper() for t in tickers.split(",") if t.strip()]
    if not ticker_list:
        return LatestSnapshotsResponse(snapshots=[])
    
    snapshots = _get_latest_snapshots_for_tickers(session, ticker_list)
    return LatestSnapshotsResponse(snapshots=snapshots)
