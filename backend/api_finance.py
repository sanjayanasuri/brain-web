import os
import logging
import time
import json
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field

from db_neo4j import get_neo4j_session
from auth import require_auth
from services_resources import create_resource, link_resource_to_concept
from services_graph import create_concept, get_concept_by_name
from models import ConceptCreate, Resource, FinanceSourceRun

router = APIRouter(prefix="/finance", tags=["finance"])
logger = logging.getLogger("brain_web")

# Skill IDs removed as browser_use service is deprecated
DISCOVERY_SKILL_ID = None
TRACKER_SKILL_ID = None
FINANCE_SKILL_ID = None


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
            detail=f"Invalid skill output: missing keys {missing_keys}."
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
    Finds resources with source='web' and metadata.identity.ticker matching.
    """
    if not tickers:
        return []
    
    # Query all resources and filter in Python
    # This is simpler and more reliable than trying to parse JSON in Cypher
    query = """
    MATCH (r:Resource)
    WHERE r.source = 'web'
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
def discover_companies(
    req: FinanceDiscoverRequest,
    auth: dict = Depends(require_auth),
    session=Depends(get_neo4j_session),
):
    raise HTTPException(status_code=501, detail="Finance discovery is currently disabled (Browser Use integration passed).")


@router.post("/track", response_model=FinanceTrackResponse)
def track_company(
    req: FinanceTrackRequest,
    auth: dict = Depends(require_auth),
    session=Depends(get_neo4j_session),
):
    raise HTTPException(status_code=501, detail="Finance tracking is currently disabled (Browser Use integration passed).")


@router.post("/snapshot", response_model=Resource)
def fetch_snapshot(
    req: FinanceSnapshotRequest,
    auth: dict = Depends(require_auth),
    session=Depends(get_neo4j_session),
):
    raise HTTPException(status_code=501, detail="Finance snapshot is currently disabled (Browser Use integration passed).")


@router.get("/tracking", response_model=Optional[FinanceTrackingResponse])
def get_tracking(
    ticker: str,
    auth: dict = Depends(require_auth),
    session=Depends(get_neo4j_session),
):
    """Get tracking configuration for a ticker."""
    return _get_finance_tracking(session, ticker)


@router.post("/tracking", response_model=FinanceTrackingResponse)
def set_tracking(
    req: FinanceTrackingConfig,
    auth: dict = Depends(require_auth),
    session=Depends(get_neo4j_session),
):
    """Create or update tracking configuration for a ticker."""
    if req.cadence not in ["daily", "weekly", "monthly"]:
        raise HTTPException(
            status_code=400,
            detail="cadence must be one of: daily, weekly, monthly"
        )
    
    return _upsert_finance_tracking(session, req.ticker, req.enabled, req.cadence)


@router.get("/tracking/list", response_model=FinanceTrackingListResponse)
def list_tracking(
    auth: dict = Depends(require_auth),
    session=Depends(get_neo4j_session),
):
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


# -------------------- Ticker Dashboard & Freshness Metrics --------------------

class TickerFreshnessMetrics(BaseModel):
    """Freshness metrics for a ticker."""
    ticker: str
    level: str  # "Fresh" | "Aging" | "Stale" | "No evidence"
    newest_evidence_at: Optional[str]  # ISO format
    age_days: Optional[int]
    documents_count: int
    claims_count: int
    last_ingested_at: Optional[str]  # ISO format


class TickerDashboardResponse(BaseModel):
    """Ticker dashboard with coverage, freshness, and evidence density."""
    ticker: str
    freshness: TickerFreshnessMetrics
    coverage: Dict[str, Any]  # Coverage metrics
    evidence_density: Dict[str, Any]  # Evidence density metrics


def _compute_ticker_freshness(session, ticker: str) -> TickerFreshnessMetrics:
    """Compute freshness metrics for a ticker."""
    # Find concept(s) for this ticker
    query = """
    MATCH (c:Concept)
    WHERE c.name CONTAINS $ticker
       OR c.tags CONTAINS $ticker
    RETURN c.node_id AS concept_id
    LIMIT 5
    """
    result = session.run(query, ticker=ticker)
    concept_ids = [record["concept_id"] for record in result]
    
    # Get documents and claims for this ticker
    doc_query = """
    MATCH (d:SourceDocument)
    WHERE d.company_ticker = $ticker
    RETURN count(d) AS doc_count,
           max(d.published_at) AS latest_published_at
    """
    doc_result = session.run(doc_query, ticker=ticker)
    doc_record = doc_result.single()
    documents_count = doc_record["doc_count"] if doc_record else 0
    latest_published_at = doc_record["latest_published_at"] if doc_record else None
    
    # Count claims
    claim_query = """
    MATCH (d:SourceDocument {company_ticker: $ticker})<-[:SUPPORTED_BY]-(chunk:SourceChunk)<-[:SUPPORTED_BY]-(claim:Claim)
    RETURN count(DISTINCT claim) AS claim_count
    """
    claim_result = session.run(claim_query, ticker=ticker)
    claim_record = claim_result.single()
    claims_count = claim_record["claim_count"] if claim_record else 0
    
    # Get last ingestion time
    tracking_query = """
    MATCH (t:FinanceTrack {ticker: $ticker})
    RETURN t.last_ingested_at AS last_ingested_at
    """
    tracking_result = session.run(tracking_query, ticker=ticker)
    tracking_record = tracking_result.single()
    last_ingested_at = tracking_record["last_ingested_at"] if tracking_record else None
    
    # Compute freshness level
    if latest_published_at:
        # Convert timestamp to datetime
        if isinstance(latest_published_at, (int, float)):
            latest_dt = datetime.fromtimestamp(latest_published_at)
        else:
            latest_dt = datetime.utcnow()
        
        now = datetime.utcnow()
        age_days = (now - latest_dt).days
        
        if age_days <= 30:
            level = "Fresh"
        elif age_days <= 120:
            level = "Aging"
        else:
            level = "Stale"
        
        newest_evidence_at = latest_dt.isoformat() + "Z"
    else:
        level = "No evidence"
        newest_evidence_at = None
        age_days = None
    
    return TickerFreshnessMetrics(
        ticker=ticker,
        level=level,
        newest_evidence_at=newest_evidence_at,
        age_days=age_days,
        documents_count=documents_count,
        claims_count=claims_count,
        last_ingested_at=last_ingested_at,
    )


# -------------------- Research Memo Export --------------------

class ResearchMemoRequest(BaseModel):
    """Request to generate a research memo."""
    query: str
    ticker: Optional[str] = None
    evidence_strictness: str = "medium"
    include_claims: bool = True
    include_concepts: bool = True


class ResearchMemoResponse(BaseModel):
    """Response with research memo and citations."""
    memo_text: str
    citations: List[Dict[str, Any]]
    metadata: Dict[str, Any]


@router.post("/memo", response_model=ResearchMemoResponse)
def generate_research_memo_endpoint(
    request: ResearchMemoRequest,
    auth: dict = Depends(require_auth),
    session=Depends(get_neo4j_session),
):
    """
    Generate an exportable research memo with citations.
    
    Returns a formatted markdown memo with:
    - Query summary
    - Key findings (claims with citations)
    - Related concepts
    - Full citation list
    """
    from services_research_memo import generate_research_memo
    
    # Build query (add ticker context if provided)
    query = request.query
    if request.ticker:
        query = f"{request.ticker}: {query}"
    
    result = generate_research_memo(
        session=session,
        query=query,
        evidence_strictness=request.evidence_strictness,
        include_claims=request.include_claims,
        include_concepts=request.include_concepts,
    )
    
    return ResearchMemoResponse(**result)


@router.get("/dashboard/{ticker}", response_model=TickerDashboardResponse)
def get_ticker_dashboard(
    ticker: str,
    auth: dict = Depends(require_auth),
    session=Depends(get_neo4j_session),
):
    """
    Get ticker dashboard with coverage, freshness, and evidence density metrics.
    """
    ticker_upper = ticker.upper()
    
    # Compute freshness
    freshness = _compute_ticker_freshness(session, ticker_upper)
    
    # Compute coverage (simplified - can be enhanced)
    coverage = {
        "documents_count": freshness.documents_count,
        "claims_count": freshness.claims_count,
        "sources": ["edgar", "ir", "news"],  # Could be dynamic
    }
    
    # Compute evidence density (claims per document)
    evidence_density = {
        "claims_per_document": (
            freshness.claims_count / freshness.documents_count
            if freshness.documents_count > 0
            else 0
        ),
        "total_claims": freshness.claims_count,
        "total_documents": freshness.documents_count,
    }
    
    return TickerDashboardResponse(
        ticker=ticker_upper,
        freshness=freshness,
        coverage=coverage,
        evidence_density=evidence_density,
    )


@router.get("/freshness/{ticker}", response_model=TickerFreshnessMetrics)
def get_ticker_freshness(
    ticker: str,
    auth: dict = Depends(require_auth),
    session=Depends(get_neo4j_session),
):
    """
    Get freshness metrics for a ticker.
    """
    return _compute_ticker_freshness(session, ticker.upper())


# ---------- Finance Acquisition Endpoints ----------

class FinanceAcquisitionRequest(BaseModel):
    """Request to run finance acquisition for a company."""
    ticker: str
    company_id: Optional[str] = None  # Optional - will be looked up if not provided
    sources: List[str] = Field(default=["edgar", "ir", "news"], description="Sources to acquire from")
    since_days: int = Field(default=30, ge=1, le=365)
    limit_per_source: int = Field(default=20, ge=1, le=100)


class FinanceAcquisitionResponse(BaseModel):
    """Response from finance acquisition run."""
    run: FinanceSourceRun
    message: str


@router.post("/run", response_model=FinanceAcquisitionResponse)
def run_finance_acquisition(
    req: FinanceAcquisitionRequest,
    auth: dict = Depends(require_auth),
    session=Depends(get_neo4j_session),
):
    """
    Run a finance acquisition cycle for a company.
    
    Acquires documents from EDGAR, IR (Browser Use), and News RSS,
    creates EvidenceSnapshots, and detects changes.
    """
    from services_finance_acquisition import run_company_acquisition
    from services_graph import get_concept_by_name
    from services_branch_explorer import ensure_graph_scoping_initialized, get_active_graph_context
    import os
    
    ensure_graph_scoping_initialized(session)
    graph_id, branch_id = get_active_graph_context(session)
    
    ticker_upper = req.ticker.upper()
    
    # Get or find company_id
    company_id = req.company_id
    if not company_id:
        # Try to find company concept by ticker
        concept = get_concept_by_name(session, ticker_upper)
        if concept and concept.type and "company" in concept.type.lower():
            company_id = concept.node_id
        else:
            # Try searching by tags
            query = """
            MATCH (c:Concept {graph_id: $graph_id})
            WHERE c.tags IS NOT NULL AND $ticker IN c.tags
              AND c.type CONTAINS 'company'
            RETURN c.node_id AS node_id
            LIMIT 1
            """
            result = session.run(query, graph_id=graph_id, ticker=f"ticker:{ticker_upper}")
            record = result.single()
            if record:
                company_id = record["node_id"]
    
    if not company_id:
        raise HTTPException(
            status_code=404,
            detail=f"Company concept not found for ticker {ticker_upper}. Please track the company first using POST /finance/track"
        )
    
    # Run acquisition
    try:
        run = run_company_acquisition(
            session=session,
            company_id=company_id,
            ticker=ticker_upper,
            sources=req.sources,
            since_days=req.since_days,
            limit_per_source=req.limit_per_source,
        )
        
        message = f"Acquisition completed: {run.snapshots_created} snapshots, {run.change_events_created} changes detected"
        if run.sources_failed:
            message += f", {len(run.sources_failed)} source(s) failed"
        
        return FinanceAcquisitionResponse(run=run, message=message)
        
    except Exception as e:
        logger.error(f"[Finance Acquisition] Failed for {ticker_upper}: {e}", exc_info=True)
        raise HTTPException(
            status_code=500,
            detail=f"Finance acquisition failed: {str(e)}"
        )


class ChangeEventResponse(BaseModel):
    """ChangeEvent response model."""
    change_event_id: str
    source_url: str
    detected_at: int
    change_type: str
    severity: str
    diff_summary: Optional[str] = None
    prev_snapshot_id: Optional[str] = None
    new_snapshot_id: str


class CompanyChangesResponse(BaseModel):
    """Response with change timeline for a company."""
    ticker: str
    company_id: str
    changes: List[ChangeEventResponse]
    total_changes: int


@router.get("/company/{ticker}/changes", response_model=CompanyChangesResponse)
def get_company_changes(
    ticker: str,
    limit: int = Query(default=50, ge=1, le=200),
    since_days: Optional[int] = Query(default=None, ge=1, le=365),
    auth: dict = Depends(require_auth),
    session=Depends(get_neo4j_session),
):
    """
    Get change timeline for a company.
    
    Returns ChangeEvents ordered by detected_at DESC.
    """
    ensure_graph_scoping_initialized(session)
    graph_id, branch_id = get_active_graph_context(session)
    
    ticker_upper = ticker.upper()
    
    # Find company concept
    from services_graph import get_concept_by_name
    concept = get_concept_by_name(session, ticker_upper)
    company_id = None
    if concept and concept.type and "company" in concept.type.lower():
        company_id = concept.node_id
    else:
        # Try searching by tags
        query = """
        MATCH (c:Concept {graph_id: $graph_id})
        WHERE c.tags IS NOT NULL AND $ticker IN c.tags
          AND c.type CONTAINS 'company'
        RETURN c.node_id AS node_id
        LIMIT 1
        """
        result = session.run(query, graph_id=graph_id, ticker=f"ticker:{ticker_upper}")
        record = result.single()
        if record:
            company_id = record["node_id"]
    
    if not company_id:
        raise HTTPException(
            status_code=404,
            detail=f"Company concept not found for ticker {ticker_upper}"
        )
    
    # Build query
    query = """
    MATCH (e:ChangeEvent {graph_id: $graph_id})
    WHERE e.company_id = $company_id
    """
    
    if since_days:
        cutoff_ts = int((datetime.utcnow().timestamp() - (since_days * 86400)) * 1000)
        query += " AND e.detected_at >= $cutoff_ts"
    
    query += """
    RETURN e.change_event_id AS change_event_id,
           e.source_url AS source_url,
           e.detected_at AS detected_at,
           e.change_type AS change_type,
           e.severity AS severity,
           e.diff_summary AS diff_summary,
           e.prev_snapshot_id AS prev_snapshot_id,
           e.new_snapshot_id AS new_snapshot_id
    ORDER BY e.detected_at DESC
    LIMIT $limit
    """
    
    params = {
        "graph_id": graph_id,
        "company_id": company_id,
        "limit": limit,
    }
    if since_days:
        params["cutoff_ts"] = cutoff_ts
    
    result = session.run(query, **params)
    changes = []
    for record in result:
        changes.append(ChangeEventResponse(
            change_event_id=record["change_event_id"],
            source_url=record["source_url"],
            detected_at=record["detected_at"],
            change_type=record["change_type"],
            severity=record["severity"],
            diff_summary=record.get("diff_summary"),
            prev_snapshot_id=record.get("prev_snapshot_id"),
            new_snapshot_id=record["new_snapshot_id"],
        ))
    
    return CompanyChangesResponse(
        ticker=ticker_upper,
        company_id=company_id,
        changes=changes,
        total_changes=len(changes),
    )
