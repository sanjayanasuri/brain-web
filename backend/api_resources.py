"""
API endpoints for Resource management.

Handles:
- Uploading files and creating Resource nodes
- Listing resources attached to concepts
- Linking resources to concepts
- Searching resources within the active graph + branch
"""

from fastapi import APIRouter, Depends, UploadFile, File, Form, HTTPException, Request
from typing import List, Optional, Dict, Any, Tuple
import mimetypes
import os

from models import Resource, PDFExtractionResult
from db_neo4j import get_neo4j_session
from auth import require_auth
from storage import save_file, read_file, get_file_url
from audit_log import log_resource_access
from services_resources import (
    create_resource,
    get_resources_for_concept,
    link_resource_to_concept,
    search_resources,
)
from services_resource_ai import (
    generate_image_caption,
    extract_pdf_text,
    summarize_pdf_text,
)
from services_pdf_enhanced import extract_pdf_enhanced
from pydantic import BaseModel
from fastapi import Query

router = APIRouter(prefix="/resources", tags=["resources"])


class ConfusionSkillRequest(BaseModel):
    concept_id: Optional[str] = None
    query: str
    sources: List[str] = ["stackoverflow", "github", "docs", "blogs"]
    limit: int = 8


class StockQuoteResourceRequest(BaseModel):
    concept_id: Optional[str] = None
    symbol: Optional[str] = None
    query: Optional[str] = None


class LiveMetricResourceRequest(BaseModel):
    concept_id: Optional[str] = None
    query: str


def _require_graph_identity(request: Request) -> tuple[str, str]:
    user_id = getattr(request.state, "user_id", None)
    tenant_id = getattr(request.state, "tenant_id", None)
    if not user_id or not tenant_id:
        raise HTTPException(status_code=401, detail="Authentication with tenant context is required")
    return str(user_id), str(tenant_id)


def _save_upload(file: UploadFile, tenant_id: Optional[str] = None) -> Tuple[str, str]:
    """
    Save uploaded file using configured storage backend (local or S3).
    
    Returns:
        (url_path, storage_path) tuple
    """
    file_content = file.file.read()
    filename = file.filename or "upload"
    url_path, storage_path = save_file(file_content, filename, tenant_id=tenant_id)
    return url_path, storage_path


@router.get("/by-concept/{concept_id}", response_model=List[Resource])
def list_resources_for_concept(
    concept_id: str,
    request: Request,
    auth: dict = Depends(require_auth),
    session=Depends(get_neo4j_session),
):
    user_id, tenant_id = _require_graph_identity(request)
    resources = get_resources_for_concept(
        session=session,
        concept_id=concept_id,
        tenant_id=tenant_id,
        user_id=user_id,
    )
    # Log access to resources for audit trail
    for resource in resources:
        try:
            log_resource_access(request, resource.resource_id, access_type="VIEW")
        except Exception:
            pass  # Don't fail on audit logging
    return resources


@router.get("/search", response_model=List[Resource])
def search_resources_endpoint(
    query: str,
    request: Request,
    limit: int = 20,
    auth: dict = Depends(require_auth),
    session=Depends(get_neo4j_session),
):
    """
    Search resources in the active graph + branch by title/caption/url.
    """
    user_id, tenant_id = _require_graph_identity(request)
    resources = search_resources(
        session=session,
        query=query,
        limit=limit,
        tenant_id=tenant_id,
        user_id=user_id,
    )
    # Log access to resources for audit trail
    for resource in resources:
        try:
            log_resource_access(request, resource.resource_id, access_type="VIEW")
        except Exception:
            pass  # Don't fail on audit logging
    return resources


@router.post("/pdf/extract", response_model=PDFExtractionResult)
async def extract_pdf_enhanced_endpoint(
    file: UploadFile = File(...),
    use_ocr: bool = Query(False, description="Enable OCR for scanned PDFs"),
    extract_tables: bool = Query(True, description="Extract tables as structured text"),
    request: Request = None,
    auth: dict = Depends(require_auth),
    session=Depends(get_neo4j_session),
):
    """
    Enhanced PDF extraction endpoint with metadata, page-level tracking, and OCR support.
    
    Returns structured extraction result with pages and metadata.
    """
    if not file.filename:
        raise HTTPException(status_code=400, detail="Missing filename")
    
    if file.content_type != "application/pdf":
        raise HTTPException(status_code=400, detail="File must be a PDF")
    
    tenant_id = getattr(request.state, "tenant_id", None) if request else None
    url, storage_path = _save_upload(file, tenant_id=tenant_id)
    
    file_content = read_file(storage_path)
    
    result = extract_pdf_enhanced(
        pdf_path=storage_path,
        pdf_bytes=file_content,
        use_ocr=use_ocr,
        extract_tables=extract_tables,
    )
    
    return result


@router.post("/upload", response_model=Resource)
async def upload_resource(
    file: UploadFile = File(...),
    concept_id: Optional[str] = Form(None),
    title: Optional[str] = Form(None),
    source: Optional[str] = Form("upload"),
    enhanced_pdf: bool = Form(False, description="Use enhanced PDF extraction with metadata and page tracking"),
    use_ocr: bool = Form(False, description="Enable OCR for scanned PDFs (only if enhanced_pdf=True)"),
    request: Request = None,
    auth: dict = Depends(require_auth),
    session=Depends(get_neo4j_session),
):
    if not file.filename:
        raise HTTPException(status_code=400, detail="Missing filename")

    user_id, tenant_id = _require_graph_identity(request)
    url, storage_path = _save_upload(file, tenant_id=tenant_id)

    mime_type = file.content_type or mimetypes.guess_type(file.filename)[0] or "application/octet-stream"
    kind = (
        "image" if mime_type.startswith("image/") else
        "pdf" if mime_type == "application/pdf" else
        "audio" if mime_type.startswith("audio/") else
        "file"
    )

    caption = None
    metadata = {}
    
    try:
        # Read file for AI processing (works with both local and S3)
        file_content = read_file(storage_path)
        
        # Generate captions using bytes (works with both local and S3)
        if kind == "image":
            caption = generate_image_caption(storage_path, image_bytes=file_content)
        elif kind == "pdf":
            if enhanced_pdf:
                # Enhanced PDF extraction with metadata and page tracking
                pdf_result = extract_pdf_enhanced(
                    pdf_path=storage_path,
                    pdf_bytes=file_content,
                    use_ocr=use_ocr,
                    extract_tables=True,
                )
                # Use PDF title if available, otherwise summarize
                caption = pdf_result.metadata.title or summarize_pdf_text(pdf_result.full_text)
                # Store PDF metadata in resource metadata
                metadata = {
                    "pdf_metadata": pdf_result.metadata.dict(),
                    "extraction_method": pdf_result.extraction_method,
                    "page_count": pdf_result.metadata.page_count,
                    "is_scanned": pdf_result.metadata.is_scanned,
                    "has_tables": pdf_result.metadata.has_tables,
                    "has_images": pdf_result.metadata.has_images,
                }
            else:
                # Basic PDF extraction (existing behavior)
                pdf_text = extract_pdf_text(storage_path, pdf_bytes=file_content)
                if pdf_text:
                    caption = summarize_pdf_text(pdf_text)
    except Exception as e:
        import logging
        logging.getLogger("brain_web").warning(f"Failed to generate caption: {e}")
        caption = None

    resource = create_resource(
        session=session,
        kind=kind,
        url=url,
        storage_path=storage_path,
        title=title or file.filename,
        mime_type=mime_type,
        caption=caption,
        source=source,
        metadata=metadata if metadata else None,
        tenant_id=tenant_id,
        user_id=user_id,
    )

    if concept_id:
        try:
            link_resource_to_concept(
                session=session,
                concept_id=concept_id,
                resource_id=resource.resource_id,
                tenant_id=tenant_id,
                user_id=user_id,
            )
        except Exception as e:
            raise HTTPException(status_code=400, detail=str(e))

    return resource




def _caption_from_confusion_output(out: Dict[str, Any]) -> str:
    confusions = out.get("confusions", [])[:5]
    pitfalls = out.get("pitfalls", [])[:5]

    lines = []
    if confusions:
        lines.append("Common confusions:")
        for c in confusions:
            lines.append(f"- {c.get('title','').strip()}: {c.get('summary','').strip()}")
    if pitfalls:
        lines.append("Common pitfalls:")
        for p in pitfalls:
            lines.append(f"- {p.get('title','').strip()}: {p.get('summary','').strip()}")

    return "\n".join(lines).strip() or "Browser Use skill output attached."


def _caption_from_stock_quote_result(result: Dict[str, Any]) -> str:
    structured = (result or {}).get("structured_data") or {}
    symbol = structured.get("symbol") or (result or {}).get("metadata", {}).get("symbol") or "UNKNOWN"
    name = structured.get("name") or symbol
    price = structured.get("price")
    currency = structured.get("currency") or ""
    change = structured.get("change")
    change_pct = structured.get("change_percent")
    as_of = structured.get("as_of") or (result or {}).get("metadata", {}).get("as_of")

    parts = [f"{name} ({symbol})"]
    if isinstance(price, (int, float)):
        parts.append(f"{price:.2f} {currency}".strip())
    elif price is not None:
        parts.append(str(price))
    if isinstance(change, (int, float)) and isinstance(change_pct, (int, float)):
        parts.append(f"({change:+.2f}, {change_pct:+.2f}%)")
    if as_of:
        parts.append(f"as of {as_of}")
    return " ".join([p for p in parts if p]).strip() or f"Live market quote for {symbol}"


def _caption_from_live_metric_result(result: Dict[str, Any]) -> str:
    content = (result or {}).get("content") or ""
    if content:
        return content[:400]
    return (result or {}).get("title") or "Live metric snapshot"


@router.post("/fetch/confusions", response_model=Resource)
async def fetch_confusions(
    req: ConfusionSkillRequest,
    request: Request,
    auth: dict = Depends(require_auth),
    session=Depends(get_neo4j_session),
):
    """
    Fetch confusions and pitfalls using internal web search (Exa-backed).
    Replaces the external Browser Use skill with internal search_and_fetch.
    """
    from services_web_search import search_and_fetch
    user_id, tenant_id = _require_graph_identity(request)

    # 1. search for combined query
    # We append terms to find specific "confusion" type content
    search_query = f"{req.query} common confusions pitfalls mistakes differences"
    
    try:
        # returns dict with keys: query, results (list), ...
        # each result has 'search_result' and 'fetched_content'
        search_out = await search_and_fetch(
            query=search_query,
            num_results=req.limit,
        )
    except Exception as e:
        # Fallback if search service fails
        raise HTTPException(status_code=500, detail=f"Web search failed: {str(e)}")

    results = search_out.get("results", [])
    
    # 2. Format results to match the expected schema for the frontend (confusions/pitfalls)
    # The frontend expects 'confusions' and 'pitfalls' lists in metadata
    formatted_confusions = []
    
    for item in results:
        # access the snippet/title
        s_res = item.get("search_result", {})
        
        formatted_confusions.append({
            "title": s_res.get("title", "Untitled"),
            "summary": s_res.get("snippet", ""),
            "url": s_res.get("url", ""),
            "source": s_res.get("engine", "web")
        })

    # We categorize all as 'confusions' for now, as semantic classification would require an LLM step
    # which we can add later if needed.
    skill_out = {
        "confusions": formatted_confusions,
        "pitfalls": [], # Empty list to satisfy schema if strict
        "query": req.query
    }

    resource = create_resource(
        session=session,
        kind="web_link",
        # Use a dummy URL scheme to indicate this is a search aggregation
        url=f"brainweb://search?q={req.query}",
        title=f"Research: {req.query}",
        caption=_caption_from_confusion_output(skill_out),
        source="web_search",
        metadata=skill_out,
        tenant_id=tenant_id,
        user_id=user_id,
    )

    if req.concept_id:
        try:
            link_resource_to_concept(
                session=session,
                concept_id=req.concept_id,
                resource_id=resource.resource_id,
                tenant_id=tenant_id,
                user_id=user_id,
            )
        except Exception as e:
            raise HTTPException(status_code=400, detail=str(e))

    return resource


@router.post("/fetch/stock-quote", response_model=Resource)
async def fetch_stock_quote_resource(
    req: StockQuoteResourceRequest,
    request: Request,
    auth: dict = Depends(require_auth),
    session=Depends(get_neo4j_session),
):
    """
    Fetch a structured live stock quote snapshot and save it as a Resource in the graph.
    Useful for finance/company research workspaces that need current market metrics.
    """
    from services_web_search import get_stock_quote, search_live_market_data, resolve_stock_symbol

    user_id, tenant_id = _require_graph_identity(request)

    resolved_symbol = (req.symbol or "").strip().upper() or (resolve_stock_symbol(req.query or "") if req.query else None)
    if not resolved_symbol:
        raise HTTPException(
            status_code=400,
            detail="Provide `symbol` or a `query` containing a recognizable public stock/company ticker",
        )

    quote_result = await get_stock_quote(resolved_symbol)
    if not quote_result and req.query:
        quote_result = await search_live_market_data(req.query)
    if not quote_result:
        raise HTTPException(status_code=404, detail=f"No live quote data found for symbol '{resolved_symbol}'")

    structured = quote_result.get("structured_data") or {}
    metadata = {
        "type": "live_metric_snapshot",
        "metric_kind": "stock_quote",
        "query": req.query,
        "symbol": structured.get("symbol") or resolved_symbol,
        "provider": quote_result.get("engine", "market_data"),
        "is_realtime": bool(quote_result.get("is_realtime")),
        "quote": structured,
        "source_result": {
            "title": quote_result.get("title"),
            "url": quote_result.get("url"),
            "snippet": quote_result.get("snippet"),
            "metadata": quote_result.get("metadata"),
        },
    }

    resource = create_resource(
        session=session,
        kind="metric_snapshot",
        url=quote_result.get("url") or f"brainweb://market/quote/{resolved_symbol}",
        title=f"Live Quote: {structured.get('name') or resolved_symbol} ({structured.get('symbol') or resolved_symbol})",
        caption=_caption_from_stock_quote_result(quote_result),
        source=quote_result.get("engine", "market_data"),
        metadata=metadata,
        tenant_id=tenant_id,
        user_id=user_id,
    )

    if req.concept_id:
        try:
            link_resource_to_concept(
                session=session,
                concept_id=req.concept_id,
                resource_id=resource.resource_id,
                tenant_id=tenant_id,
                user_id=user_id,
            )
        except Exception as e:
            raise HTTPException(status_code=400, detail=str(e))

    return resource


@router.post("/fetch/live-metric", response_model=Resource)
async def fetch_live_metric_resource(
    req: LiveMetricResourceRequest,
    request: Request,
    auth: dict = Depends(require_auth),
    session=Depends(get_neo4j_session),
):
    """
    Fetch a structured live metric snapshot (stocks, crypto, FX, macro) and save it as a Resource.
    """
    from services_web_search import search_live_market_data

    user_id, tenant_id = _require_graph_identity(request)

    metric_result = await search_live_market_data(req.query)
    if not metric_result:
        raise HTTPException(status_code=404, detail="No structured live metric provider matched the query")

    structured = metric_result.get("structured_data") or {}
    metric_kind = structured.get("kind") or metric_result.get("source_type") or "live_metric"
    title = metric_result.get("title") or f"Live Metric: {metric_kind}"

    metadata = {
        "type": "live_metric_snapshot",
        "metric_kind": metric_kind,
        "query": req.query,
        "provider": metric_result.get("engine", "market_data"),
        "is_realtime": bool(metric_result.get("is_realtime")),
        "metric": structured,
        "source_result": {
            "title": metric_result.get("title"),
            "url": metric_result.get("url"),
            "snippet": metric_result.get("snippet"),
            "metadata": metric_result.get("metadata"),
            "source_type": metric_result.get("source_type"),
        },
    }

    resource = create_resource(
        session=session,
        kind="metric_snapshot",
        url=metric_result.get("url") or f"brainweb://metrics/{metric_kind}",
        title=title,
        caption=_caption_from_live_metric_result(metric_result),
        source=metric_result.get("engine", "market_data"),
        metadata=metadata,
        tenant_id=tenant_id,
        user_id=user_id,
    )

    if req.concept_id:
        try:
            link_resource_to_concept(
                session=session,
                concept_id=req.concept_id,
                resource_id=resource.resource_id,
                tenant_id=tenant_id,
                user_id=user_id,
            )
        except Exception as e:
            raise HTTPException(status_code=400, detail=str(e))

    return resource
