"""
Evidence snapshot utilities: content normalization, hashing, and change detection.
"""
import re
import hashlib
import json
import logging
from typing import Optional, Dict, Any, Tuple
from uuid import uuid4
from datetime import datetime
from neo4j import Session
from bs4 import BeautifulSoup

from services_branch_explorer import (
    ensure_graph_scoping_initialized,
    get_active_graph_context,
)
from services_graph import (
    upsert_evidence_snapshot,
    get_snapshot_by_hash,
    get_latest_snapshot_for_url,
    upsert_change_event,
    stale_claims_for_change,
    mark_claims_stale,
)
from services_sources import upsert_source_document

logger = logging.getLogger(__name__)


def normalize_content(
    source_type: str,
    raw_text: Optional[str] = None,
    raw_html: Optional[str] = None,
    pdf_text: Optional[str] = None,
) -> str:
    """
    Normalize content for deterministic hashing.
    
    Rules:
    - Strip dynamic elements (timestamps, cookie banners, navigation)
    - Normalize whitespace (collapse multiple spaces/newlines to single space)
    - Remove HTML tags if HTML provided
    - Stable ordering for lists when possible
    - Lowercase for case-insensitive comparison (optional - currently case-sensitive)
    
    Args:
        source_type: Source type ("EDGAR" | "IR" | "NEWS_RSS" | "BROWSER_USE" | "UPLOAD")
        raw_text: Plain text content
        raw_html: HTML content (will be parsed and text extracted)
        pdf_text: PDF extracted text
    
    Returns:
        Normalized text string
    """
    # Prefer raw_text, fallback to extracted HTML text, then PDF text
    text = raw_text
    if not text and raw_html:
        # Extract text from HTML
        soup = BeautifulSoup(raw_html, "html.parser")
        # Remove script, style, nav, footer, header, aside
        for tag in soup(["script", "style", "nav", "footer", "header", "aside"]):
            tag.decompose()
        text = soup.get_text(separator=" ", strip=True)
    if not text and pdf_text:
        text = pdf_text
    
    if not text:
        return ""
    
    # Remove common dynamic elements (timestamps, cookie banners, etc.)
    # Remove ISO timestamps
    text = re.sub(r'\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[Z\+\-]\d{2}:\d{2}', '', text)
    # Remove common date patterns
    text = re.sub(r'\d{1,2}/\d{1,2}/\d{4}', '', text)
    text = re.sub(r'\d{4}-\d{2}-\d{2}', '', text)
    # Remove cookie banner patterns
    text = re.sub(r'(?i)(cookie|privacy|accept|decline).{0,50}(policy|notice|banner)', '', text)
    # Remove navigation patterns
    text = re.sub(r'(?i)(home|about|contact|menu|navigation)', '', text)
    
    # Normalize whitespace: collapse multiple spaces/newlines/tabs to single space
    text = re.sub(r'\s+', ' ', text)
    
    # Remove leading/trailing whitespace
    text = text.strip()
    
    # For EDGAR filings, remove common SEC boilerplate
    if source_type == "EDGAR":
        # Remove common SEC headers/footers
        text = re.sub(r'(?i)UNITED STATES\s+SECURITIES AND EXCHANGE COMMISSION', '', text)
        text = re.sub(r'(?i)FORM\s+\d+[-\s]?\w+', '', text)
        text = re.sub(r'(?i)SEC FILE NUMBER[:\s]+\d+', '', text)
        text = re.sub(r'(?i)COMMISSION FILE NUMBER[:\s]+\d+', '', text)
        # Remove page numbers
        text = re.sub(r'\s+\d+\s+$', '', text, flags=re.MULTILINE)
    
    # Re-normalize whitespace after removals
    text = re.sub(r'\s+', ' ', text)
    text = text.strip()
    
    return text


def compute_content_hash(normalized_text: str) -> str:
    """
    Compute SHA256 hash of normalized content.
    
    Args:
        normalized_text: Normalized text content
    
    Returns:
        SHA256 hex digest
    """
    return hashlib.sha256(normalized_text.encode('utf-8')).hexdigest()


def detect_content_changes(
    prev_hash: Optional[str],
    new_hash: str,
    prev_text: Optional[str] = None,
    new_text: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Detect changes between two content versions.
    
    Args:
        prev_hash: Previous content hash (None if new document)
        new_hash: New content hash
        prev_text: Optional previous text for diff summary
        new_text: Optional new text for diff summary
    
    Returns:
        dict with:
        - change_type: "NEW_DOCUMENT" | "CONTENT_UPDATED" | "METADATA_UPDATED"
        - severity: "LOW" | "MEDIUM" | "HIGH"
        - diff_summary: Optional short summary of changes
    """
    if prev_hash is None:
        return {
            "change_type": "NEW_DOCUMENT",
            "severity": "MEDIUM",
            "diff_summary": "New document detected"
        }
    
    if prev_hash == new_hash:
        return {
            "change_type": "METADATA_UPDATED",
            "severity": "LOW",
            "diff_summary": "Content unchanged, metadata may have changed"
        }
    
    # Content changed
    diff_summary = None
    if prev_text and new_text:
        # Simple diff summary: compute character/word difference
        prev_words = len(prev_text.split())
        new_words = len(new_text.split())
        word_diff = new_words - prev_words
        
        if abs(word_diff) < 10:
            diff_summary = "Minor content changes"
            severity = "LOW"
        elif abs(word_diff) < 100:
            diff_summary = f"Moderate content changes ({word_diff:+d} words)"
            severity = "MEDIUM"
        else:
            diff_summary = f"Major content changes ({word_diff:+d} words)"
            severity = "HIGH"
    else:
        diff_summary = "Content hash changed"
        severity = "MEDIUM"
    
    return {
        "change_type": "CONTENT_UPDATED",
        "severity": severity,
        "diff_summary": diff_summary
    }


def normalize_title(title: str, source_type: str) -> str:
    """
    Normalize document title for consistent comparison.
    
    Args:
        title: Original title
        source_type: Source type
    
    Returns:
        Normalized title
    """
    # Remove extra whitespace
    normalized = re.sub(r'\s+', ' ', title).strip()
    
    # For EDGAR, remove common prefixes
    if source_type == "EDGAR":
        normalized = re.sub(r'^(?i)FORM\s+\d+[-\s]?\w+\s*[-–—]\s*', '', normalized)
        normalized = re.sub(r'^(?i)SEC\s+FILE\s+NUMBER[:\s]+\d+\s*', '', normalized)
    
    return normalized


def create_or_get_snapshot(
    session: Session,
    graph_id: str,
    branch_id: str,
    source_document_id: str,
    source_type: str,
    source_url: str,
    raw_text: Optional[str] = None,
    raw_html: Optional[str] = None,
    pdf_text: Optional[str] = None,
    title: Optional[str] = None,
    published_at: Optional[int] = None,
    company_id: Optional[str] = None,
    tenant_id: Optional[str] = None,
    metadata: Optional[Dict[str, Any]] = None,
) -> Tuple[dict, Optional[dict]]:
    """
    Create a new EvidenceSnapshot or return existing one if content hash matches.
    
    This function:
    1. Normalizes content
    2. Computes content hash
    3. Checks for existing snapshot with same hash
    4. Creates new snapshot if needed
    5. Detects changes and creates ChangeEvent if content changed
    
    Args:
        session: Neo4j session
        graph_id: Graph ID for scoping
        branch_id: Branch ID for scoping
        source_document_id: SourceDocument doc_id
        source_type: Source type ("EDGAR" | "IR" | "NEWS_RSS" | "BROWSER_USE" | "UPLOAD")
        source_url: Source URL
        raw_text: Raw text content
        raw_html: Raw HTML content
        pdf_text: PDF extracted text
        title: Document title
        published_at: Publication timestamp (Unix ms)
        company_id: Optional Concept node_id for Company
        tenant_id: Optional tenant identifier
        metadata: Optional metadata dict
    
    Returns:
        Tuple of (snapshot_dict, change_event_dict)
        - snapshot_dict: Created or existing snapshot data
        - change_event_dict: ChangeEvent data if change detected, None otherwise
    """
    ensure_graph_scoping_initialized(session)
    
    # Normalize content and compute hash
    normalized_text = normalize_content(source_type, raw_text, raw_html, pdf_text)
    content_hash = compute_content_hash(normalized_text)
    
    # Normalize title
    normalized_title = normalize_title(title or source_url, source_type) if title else source_url
    
    # Check for existing snapshot with same hash
    existing_snapshot = get_snapshot_by_hash(session, graph_id, source_url, content_hash)
    
    if existing_snapshot:
        logger.info(f"[Evidence Snapshot] Found existing snapshot {existing_snapshot['snapshot_id']} with matching hash for {source_url}")
        return existing_snapshot, None
    
    # Check for previous snapshot for this URL (to detect changes)
    prev_snapshot = get_latest_snapshot_for_url(session, graph_id, source_url)
    
    # Create new snapshot
    snapshot_id = str(uuid4())
    metadata_json = json.dumps(metadata) if metadata else None
    
    snapshot_data = upsert_evidence_snapshot(
        session=session,
        graph_id=graph_id,
        branch_id=branch_id,
        snapshot_id=snapshot_id,
        source_document_id=source_document_id,
        source_type=source_type,
        source_url=source_url,
        content_hash=content_hash,
        normalized_title=normalized_title,
        normalized_published_at=published_at,
        extraction_version="v1",
        company_id=company_id,
        tenant_id=tenant_id,
        metadata_json=metadata_json,
    )
    
    # Detect changes and create ChangeEvent if needed
    change_event_data = None
    if prev_snapshot:
        prev_hash = prev_snapshot.get("content_hash")
        prev_text = normalized_text  # We don't store full text, so use current for comparison
        new_text = normalized_text
        
        change_info = detect_content_changes(prev_hash, content_hash, prev_text, new_text)
        
        # Determine severity based on source type and change type
        if source_type == "EDGAR" and change_info["change_type"] == "CONTENT_UPDATED":
            # EDGAR amendments are high severity
            if "/A" in source_url or "-A" in source_url:
                change_info["severity"] = "HIGH"
                change_info["diff_summary"] = "Amendment filing detected - supersedes prior version"
        
        change_event_id = str(uuid4())
        change_event_data = upsert_change_event(
            session=session,
            graph_id=graph_id,
            branch_id=branch_id,
            change_event_id=change_event_id,
            source_url=source_url,
            change_type=change_info["change_type"],
            new_snapshot_id=snapshot_id,
            prev_snapshot_id=prev_snapshot.get("snapshot_id"),
            diff_summary=change_info.get("diff_summary"),
            severity=change_info["severity"],
            company_id=company_id,
            tenant_id=tenant_id,
            metadata_json=json.dumps({"detection_method": "hash_comparison"}) if metadata else None,
        )
        
        logger.info(f"[Evidence Snapshot] Created ChangeEvent {change_event_id} for {source_url}: {change_info['change_type']} ({change_info['severity']})")
        
        # Mark stale claims from previous snapshot
        stale_claim_ids = stale_claims_for_change(session, graph_id, change_event_id)
        if stale_claim_ids:
            count = mark_claims_stale(session, graph_id, stale_claim_ids, change_event_id)
            logger.info(f"[Evidence Snapshot] Marked {count} claims as stale due to change event {change_event_id}")
    else:
        # New document - create ChangeEvent for NEW_DOCUMENT
        change_info = detect_content_changes(None, content_hash)
        change_event_id = str(uuid4())
        change_event_data = upsert_change_event(
            session=session,
            graph_id=graph_id,
            branch_id=branch_id,
            change_event_id=change_event_id,
            source_url=source_url,
            change_type=change_info["change_type"],
            new_snapshot_id=snapshot_id,
            prev_snapshot_id=None,
            diff_summary=change_info.get("diff_summary"),
            severity=change_info["severity"],
            company_id=company_id,
            tenant_id=tenant_id,
            metadata_json=json.dumps({"detection_method": "new_document"}) if metadata else None,
        )
        logger.info(f"[Evidence Snapshot] Created ChangeEvent {change_event_id} for new document {source_url}")
    
    return snapshot_data, change_event_data

