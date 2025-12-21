"""
Finance ingestion orchestrator.
Thin adapter around the ingestion kernel for finance documents.

Do not call backend endpoints from backend services. Use ingestion kernel/internal services to prevent ingestion path drift.
"""
from typing import Dict, Any, Optional, List
from neo4j import Session
import logging
import json
from pathlib import Path
from datetime import datetime

from services_branch_explorer import (
    ensure_graph_scoping_initialized,
    get_active_graph_context,
)
from services_logging import log_graphrag_event
from services_ingestion_runs import (
    create_ingestion_run,
    update_ingestion_run_status,
)
from services_ingestion_kernel import ingest_artifact
from models_ingestion_kernel import ArtifactInput, IngestionActions, IngestionPolicy

# Imports for deprecated ingest_source_document function (kept for backward compatibility)
from uuid import uuid4
from services_sources import (
    upsert_source_document,
    mark_source_document_status,
    get_source_document
)
from services_graph import (
    upsert_source_chunk,
    upsert_claim,
    link_claim_mentions,
    get_all_concepts
)
from services_claims import extract_claims_from_chunk
from services_lecture_ingestion import chunk_text
from services_search import embed_text

# Import connectors
from connectors.edgar import EdgarConnector
from connectors.ir import IRConnector
from connectors.news_rss import NewsRSSConnector

logger = logging.getLogger(__name__)


def _normalize_name(name: str) -> str:
    """Normalize concept name for matching."""
    return name.lower().strip()


def ingest_source_document(
    session: Session,
    graph_id: str,
    branch_id: str,
    source: str,  # "SEC" | "NEWS" | "PRICES"
    external_id: str,
    url: str,
    text: str,
    company_ticker: Optional[str] = None,
    doc_type: Optional[str] = None,
    published_at: Optional[int] = None,
    metadata: Optional[Dict[str, Any]] = None
) -> Dict[str, Any]:
    """
    DEPRECATED: This function is kept for backward compatibility with api_connectors.py.
    New code should use ingest_artifact() from services_ingestion_kernel instead.
    
    Ingest a source document through the full pipeline:
    1. Create/update SourceDocument
    2. Check idempotency (skip if already ingested with same checksum)
    3. Chunk text into SourceChunks
    4. Extract claims from chunks
    5. Upsert claims and link to SourceChunks
    6. Link claim mentions to Concept nodes
    7. Mark SourceDocument as INGESTED
    
    Args:
        session: Neo4j session
        graph_id: Graph ID for scoping
        branch_id: Branch ID for scoping
        source: Source type
        external_id: External identifier
        url: Document URL
        text: Document text content
        company_ticker: Optional company ticker
        doc_type: Optional document type
        published_at: Optional publication timestamp
        metadata: Optional metadata dict
    
    Returns:
        dict with ingestion results:
        - doc_id: str
        - status: str ("INGESTED" | "SKIPPED" | "FAILED")
        - chunks_created: int
        - claims_created: int
        - error: Optional[str]
    """
    ensure_graph_scoping_initialized(session)
    
    try:
        # Step 1: Create/update SourceDocument
        logger.info(f"[Finance Ingestion] Creating SourceDocument: {source}/{external_id}")
        doc_data = upsert_source_document(
            session=session,
            graph_id=graph_id,
            branch_id=branch_id,
            source=source,
            external_id=external_id,
            url=url,
            company_ticker=company_ticker,
            doc_type=doc_type,
            published_at=published_at,
            text=text,
            metadata=metadata
        )
        doc_id = doc_data["doc_id"]
        
        # Step 2: Check idempotency
        existing_doc = get_source_document(session, graph_id, doc_id)
        if existing_doc:
            existing_status = existing_doc.get("status")
            existing_checksum = existing_doc.get("checksum")
            current_checksum = doc_data.get("checksum")
            
            # If already ingested and checksum unchanged, skip
            if existing_status == "INGESTED" and existing_checksum == current_checksum:
                logger.info(f"[Finance Ingestion] Document {doc_id} already ingested with same checksum, skipping")
                return {
                    "doc_id": doc_id,
                    "status": "SKIPPED",
                    "chunks_created": 0,
                    "claims_created": 0,
                    "reason": "already_ingested"
                }
        
        # Step 3: Chunk text
        logger.info(f"[Finance Ingestion] Chunking text ({len(text)} chars)")
        chunks = chunk_text(text, max_chars=1200, overlap=150)
        logger.info(f"[Finance Ingestion] Created {len(chunks)} chunks")
        
        if not chunks:
            logger.warning(f"[Finance Ingestion] No chunks created from text, marking as FAILED")
            mark_source_document_status(session, graph_id, doc_id, "FAILED", "No chunks created from text")
            return {
                "doc_id": doc_id,
                "status": "FAILED",
                "chunks_created": 0,
                "claims_created": 0,
                "error": "No chunks created from text"
            }
        
        # Step 4: Get existing concepts for mention resolution
        existing_concepts = get_all_concepts(session)
        existing_concept_map = {_normalize_name(c.name): c.node_id for c in existing_concepts}
        known_concepts = [
            {"name": c.name, "node_id": c.node_id, "description": c.description}
            for c in existing_concepts
        ]
        
        # Step 5: Process chunks and extract claims
        chunks_created = 0
        claims_created = 0
        
        for chunk in chunks:
            chunk_id = f"CHUNK_{uuid4().hex[:8].upper()}"
            
            # Create SourceChunk
            chunk_metadata = {
                "source": source,
                "external_id": external_id,
                "doc_id": doc_id,
                "company_ticker": company_ticker,
                "doc_type": doc_type,
            }
            if metadata:
                chunk_metadata.update(metadata)
            
            try:
                upsert_source_chunk(
                    session=session,
                    graph_id=graph_id,
                    branch_id=branch_id,
                    chunk_id=chunk_id,
                    source_id=doc_id,  # Use doc_id as source_id
                    chunk_index=chunk["index"],
                    text=chunk["text"],
                    metadata=chunk_metadata
                )
                chunks_created += 1
            except Exception as e:
                logger.error(f"[Finance Ingestion] Failed to create SourceChunk {chunk_id}: {e}")
                continue
            
            # Extract claims from chunk
            claims = extract_claims_from_chunk(chunk["text"], known_concepts)
            
            for claim_data in claims:
                claim_id = f"CLAIM_{uuid4().hex[:8].upper()}"
                
                # Resolve mentioned concept node_ids
                mentioned_node_ids = []
                for concept_name in claim_data.get("mentioned_concept_names", []):
                    normalized = _normalize_name(concept_name)
                    if normalized in existing_concept_map:
                        mentioned_node_ids.append(existing_concept_map[normalized])
                
                # Generate embedding for claim (optional, can be expensive)
                claim_embedding = None
                try:
                    claim_embedding = embed_text(claim_data["claim_text"])
                except Exception as e:
                    logger.warning(f"[Finance Ingestion] Failed to generate embedding for claim {claim_id}: {e}")
                
                # Create Claim
                try:
                    upsert_claim(
                        session=session,
                        graph_id=graph_id,
                        branch_id=branch_id,
                        claim_id=claim_id,
                        text=claim_data["claim_text"],
                        confidence=claim_data.get("confidence", 0.5),
                        method="llm",
                        source_id=doc_id,
                        source_span=claim_data.get("source_span", f"chunk {chunk['index']}"),
                        chunk_id=chunk_id,
                        embedding=claim_embedding
                    )
                    
                    # Link claim to mentioned concepts
                    if mentioned_node_ids:
                        link_claim_mentions(
                            session=session,
                            graph_id=graph_id,
                            claim_id=claim_id,
                            mentioned_node_ids=mentioned_node_ids
                        )
                    
                    claims_created += 1
                except Exception as e:
                    logger.error(f"[Finance Ingestion] Failed to create Claim {claim_id}: {e}")
                    continue
        
        # Step 6: Mark as INGESTED
        mark_source_document_status(session, graph_id, doc_id, "INGESTED")
        
        logger.info(f"[Finance Ingestion] Successfully ingested {doc_id}: {chunks_created} chunks, {claims_created} claims")
        
        return {
            "doc_id": doc_id,
            "status": "INGESTED",
            "chunks_created": chunks_created,
            "claims_created": claims_created
        }
        
    except Exception as e:
        logger.error(f"[Finance Ingestion] Failed to ingest document {external_id}: {e}", exc_info=True)
        
        # Mark as FAILED if we have a doc_id
        try:
            if 'doc_id' in locals():
                mark_source_document_status(session, graph_id, doc_id, "FAILED", str(e))
        except Exception:
            pass
        
        return {
            "doc_id": doc_id if 'doc_id' in locals() else None,
            "status": "FAILED",
            "chunks_created": 0,
            "claims_created": 0,
            "error": str(e)
        }


def _load_finance_config() -> Dict[str, Any]:
    """
    Load finance sources configuration from JSON file.
    """
    config_path = Path(__file__).parent / "finance_sources.json"
    if not config_path.exists():
        logger.warning(f"[Finance Ingestion] Config file not found: {config_path}, using defaults")
        return {
            "defaults": {
                "since_days": 30,
                "limit": 20,
                "news": {"allow_fulltext_fetch": False}
            },
            "companies": {}
        }
    
    try:
        with open(config_path, "r") as f:
            return json.load(f)
    except Exception as e:
        logger.error(f"[Finance Ingestion] Failed to load config: {e}")
        return {
            "defaults": {
                "since_days": 30,
                "limit": 20,
                "news": {"allow_fulltext_fetch": False}
            },
            "companies": {}
        }


def _get_connector_instance(connector_name: str):
    """
    Get connector instance by name.
    """
    if connector_name == "edgar":
        return EdgarConnector()
    elif connector_name == "ir":
        return IRConnector()
    elif connector_name == "news":
        return NewsRSSConnector()
    else:
        raise ValueError(f"Unknown connector: {connector_name}")


def _convert_published_at(published_at: Optional[str]) -> Optional[int]:
    """
    Convert ISO datetime string to Unix timestamp (milliseconds).
    """
    if not published_at:
        return None
    
    try:
        # Try parsing ISO format
        dt = datetime.fromisoformat(published_at.replace("Z", "+00:00"))
        return int(dt.timestamp() * 1000)
    except Exception:
        try:
            # Try common formats
            for fmt in ["%Y-%m-%d", "%Y-%m-%d %H:%M:%S", "%Y-%m-%dT%H:%M:%S"]:
                try:
                    dt = datetime.strptime(published_at, fmt)
                    return int(dt.timestamp() * 1000)
                except ValueError:
                    continue
        except Exception:
            pass
    
    return None


def ingest_finance_sources(
    session: Session,
    graph_id: str,
    branch_id: str,
    ticker: str,
    since_days: int = 30,
    limit: int = 20,
    connectors: List[str] = ["edgar", "ir", "news"]
) -> Dict[str, Any]:
    """
    Main orchestration function for finance ingestion.
    
    Args:
        session: Neo4j session
        graph_id: Graph ID for scoping
        branch_id: Branch ID for scoping
        ticker: Company ticker symbol (e.g., "NVDA")
        since_days: Number of days to look back
        limit: Maximum documents per connector
        connectors: List of connector names to use (e.g., ["edgar", "ir", "news"])
    
    Returns:
        dict with ingestion results:
        - documents_fetched: int
        - chunks_created: int
        - claims_created: int
        - proposed_edges_created: int (always 0 for now)
        - errors: List[str]
        - ingested_docs: List[dict] with title and url
    """
    ensure_graph_scoping_initialized(session)
    
    # Create ingestion run
    ingestion_run = create_ingestion_run(
        session=session,
        source_type="FINANCE",
        source_label=f"{ticker}",
    )
    run_id = ingestion_run.run_id
    
    # Load config
    config = _load_finance_config()
    defaults = config.get("defaults", {})
    companies = config.get("companies", {})
    
    # Get company config
    company_config = companies.get(ticker.upper(), {})
    if not company_config:
        logger.warning(f"[Finance Ingestion] No config found for ticker {ticker}")
        company_config = {}
    
    # Merge defaults
    since_days = since_days or defaults.get("since_days", 30)
    limit = limit or defaults.get("limit", 20)
    
    # Initialize counters
    documents_fetched = 0
    total_chunks_created = 0
    total_claims_created = 0
    errors = []
    ingested_docs = []
    
    # Run connectors
    all_documents = []
    
    for connector_name in connectors:
        try:
            connector = _get_connector_instance(connector_name)
            logger.info(f"[Finance Ingestion] Running connector: {connector_name}")
            
            # Fetch documents
            docs = connector.fetch(
                ticker=ticker,
                company=company_config,
                since_days=since_days,
                limit=limit
            )
            
            all_documents.extend(docs)
            documents_fetched += len(docs)
            
        except Exception as e:
            error_msg = f"Connector {connector_name} failed: {str(e)}"
            logger.error(f"[Finance Ingestion] {error_msg}", exc_info=True)
            errors.append(error_msg)
    
    logger.info(f"[Finance Ingestion] Fetched {documents_fetched} documents from connectors")
    
    # Process each document using the ingestion kernel
    for doc in all_documents:
        try:
            # Convert published_at to Unix timestamp
            published_at_ts = _convert_published_at(doc.published_at)
            
            # Build metadata for artifact
            metadata = doc.metadata or {}
            metadata.update({
                "ticker": doc.ticker,
                "source_type": doc.source_type,
                "doc_type": doc.doc_type,
                "published_at": published_at_ts,
                "connector_name": doc.source_type.lower()
            })
            
            # Build ArtifactInput payload
            payload = ArtifactInput(
                artifact_type="finance_doc",
                source_url=doc.url,
                source_id=doc.external_id,
                title=doc.title,
                domain="Finance",
                text=doc.raw_text,
                metadata=metadata,
                actions=IngestionActions(
                    run_lecture_extraction=False,  # Finance uses claims more than concept-link extraction
                    run_chunk_and_claims=True,
                    embed_claims=True,
                    create_artifact_node=True
                ),
                policy=IngestionPolicy(
                    local_only=True,
                    denylist_domains=[],
                    max_chars=200_000,
                    min_chars=200,
                    strip_url_query=True
                )
            )
            
            # Ingest using kernel
            logger.info(f"[Finance Ingestion] Ingesting document: {doc.title}")
            result = ingest_artifact(session, payload)
            
            # Map kernel result status to finance ingestion status
            if result.status == "COMPLETED" or result.status == "PARTIAL":
                # Aggregate counts from kernel result
                summary = result.summary_counts or {}
                doc_chunks = summary.get("chunks_created", 0)
                doc_claims = summary.get("claims_created", 0)
                
                total_chunks_created += doc_chunks
                total_claims_created += doc_claims
                
                ingested_docs.append({
                    "title": doc.title,
                    "url": doc.url,
                    "doc_type": doc.doc_type,
                    "run_id": result.run_id  # Store document-level run_id
                })
                
                logger.info(f"[Finance Ingestion] Successfully ingested {doc.title}: {doc_chunks} chunks, {doc_claims} claims")
            elif result.status == "SKIPPED":
                logger.info(f"[Finance Ingestion] Skipped document: {doc.title}")
                if result.errors:
                    logger.info(f"[Finance Ingestion] Skip reason: {result.errors[0]}")
            else:  # FAILED
                error_msg = f"Failed to ingest {doc.title}"
                if result.errors:
                    error_msg += f": {result.errors[0]}"
                errors.append(error_msg)
                logger.error(f"[Finance Ingestion] {error_msg}")
        
        except Exception as e:
            error_msg = f"Failed to process document {doc.title}: {str(e)}"
            errors.append(error_msg)
            logger.error(f"[Finance Ingestion] {error_msg}", exc_info=True)
    
    # Log ingestion event
    try:
        log_graphrag_event(
            graph_id=graph_id,
            branch_id=branch_id,
            mode="finance_ingestion",
            user_question=f"Finance ingestion for {ticker}",
            retrieved_communities=None,
            retrieved_claims=None,
            response_length_tokens=None,
            metadata={
                "ticker": ticker,
                "documents_fetched": documents_fetched,
                "chunks_created": total_chunks_created,
                "claims_created": total_claims_created,
                "connectors": connectors,
                "errors": len(errors)
            }
        )
    except Exception as e:
        logger.warning(f"[Finance Ingestion] Failed to log event: {e}")
    
    # Update ingestion run status
    status = "COMPLETED" if len(errors) == 0 else "PARTIAL" if documents_fetched > 0 else "FAILED"
    update_ingestion_run_status(
        session=session,
        run_id=run_id,
        status=status,
        summary_counts={
            "documents_fetched": documents_fetched,
            "chunks_created": total_chunks_created,
            "claims_created": total_claims_created,
        },
        error_count=len(errors) if errors else None,
        errors=errors if errors else None,
    )
    
    return {
        "documents_fetched": documents_fetched,
        "chunks_created": total_chunks_created,
        "claims_created": total_claims_created,
        "proposed_edges_created": 0,  # Not implemented yet
        "errors": errors,
        "ingested_docs": ingested_docs,
        "run_id": run_id,
    }
