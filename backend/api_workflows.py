"""
Unified workflow API for Capture → Explore → Synthesize navigation.

Provides a single entry point for the three core workflows to simplify frontend integration.
"""
from typing import Optional, Dict, Any, List
from fastapi import APIRouter, Depends, HTTPException
from fastapi import Request
from pydantic import BaseModel, Field
from neo4j import Session

from db_neo4j import get_neo4j_session
from auth import require_auth
from services_branch_explorer import (
    ensure_graph_scoping_initialized,
    get_active_graph_context,
    set_active_branch,
    set_active_graph,
)

router = APIRouter(prefix="/workflows", tags=["workflows"])


# -------------------- Capture Workflow --------------------

class CaptureRequest(BaseModel):
    """Request to capture content."""
    content_type: str = Field(..., description="Type: 'selection', 'url', 'file'")
    # For selection
    selected_text: Optional[str] = None
    page_url: Optional[str] = None
    page_title: Optional[str] = None
    attach_concept_id: Optional[str] = None
    # For URL
    url: Optional[str] = None
    # For file
    file_data: Optional[Dict[str, Any]] = None
    # Common
    graph_id: Optional[str] = None
    branch_id: Optional[str] = None


class CaptureResponse(BaseModel):
    """Response from capture operation."""
    success: bool
    workflow: str = "capture"
    result: Dict[str, Any]
    next_actions: List[str] = Field(default_factory=list, description="Suggested next actions")


@router.post("/capture", response_model=CaptureResponse)
def capture_workflow(
    request: CaptureRequest,
    fastapi_request: Request,
    auth: dict = Depends(require_auth),
    session: Session = Depends(get_neo4j_session),
):
    """
    Capture workflow: Add content to the knowledge graph.
    
    Supports:
    - Text selection from web pages
    - URL ingestion
    - File uploads
    """
    ensure_graph_scoping_initialized(session)
    current_graph_id, current_branch_id = get_active_graph_context(session)

    target_graph_id = request.graph_id or current_graph_id
    target_branch_id = request.branch_id or current_branch_id

    # Keep active context aligned with the workflow target.
    if target_graph_id != current_graph_id:
        set_active_graph(session, target_graph_id)
    # After graph switches, branch may reset to default.
    if target_branch_id != get_active_graph_context(session)[1]:
        set_active_branch(session, target_branch_id)

    graph_id, branch_id = get_active_graph_context(session)
    
    result = {}
    next_actions = []
    
    try:
        if request.content_type == "selection":
            if not request.selected_text or not request.page_url:
                raise HTTPException(status_code=400, detail="selected_text and page_url required for selection capture")
            
            from services_sync_capture import capture_selection_into_graph
            # Get session_id from request state if available
            session_id = getattr(fastapi_request.state, 'session_id', None) if fastapi_request else None
            out = capture_selection_into_graph(
                session=session,
                graph_id=graph_id,
                branch_id=branch_id,
                page_url=request.page_url,
                page_title=request.page_title,
                selected_text=request.selected_text,
                attach_concept_id=request.attach_concept_id,
                session_id=session_id,
            )
            result = {
                "artifact_id": out.get("artifact_id"),
                "quote_id": out.get("quote_id"),
            }
            next_actions = ["explore_concept", "synthesize_claims"]
            
        elif request.content_type == "url":
            if not request.url:
                raise HTTPException(status_code=400, detail="url required for URL capture")
            
            from services_web_ingestion import ingest_web_payload
            ingest_result = ingest_web_payload(
                session=session,
                url=request.url,
                text="",  # Will be fetched
                title=None,
            )
            result = {
                "source_id": ingest_result.get("source_id"),
                "chunks_created": ingest_result.get("chunks_created", 0),
            }
            next_actions = ["explore_graph", "synthesize_summary"]
            
        elif request.content_type == "file":
            if not isinstance(request.file_data, dict):
                raise HTTPException(status_code=400, detail="file_data required for file capture")

            file_data = request.file_data

            # Option A: inline text capture (client extracted content)
            inline_text = file_data.get("text")
            if isinstance(inline_text, str) and inline_text.strip():
                from services_ingestion_kernel import ingest_artifact
                from models_ingestion_kernel import ArtifactInput, IngestionActions, IngestionPolicy

                title = str(file_data.get("title") or "File").strip() or "File"
                domain = file_data.get("domain")
                source_url = file_data.get("source_url")
                source_id = file_data.get("source_id") or file_data.get("filename")

                actions = IngestionActions(
                    run_lecture_extraction=bool(file_data.get("extract_concepts", True)),
                    run_chunk_and_claims=bool(file_data.get("extract_claims", True)),
                    embed_claims=bool(file_data.get("extract_claims", True)),
                    create_lecture_node=True,
                    create_artifact_node=True,
                )

                artifact_input = ArtifactInput(
                    artifact_type="manual",
                    source_url=str(source_url).strip() if isinstance(source_url, str) and source_url.strip() else None,
                    source_id=str(source_id).strip() if source_id else None,
                    title=title,
                    domain=str(domain).strip() if isinstance(domain, str) and domain.strip() else None,
                    text=inline_text,
                    metadata={
                        "capture_mode": "workflow_file_inline",
                    },
                    actions=actions,
                    policy=IngestionPolicy(
                        local_only=True,
                        max_chars=500_000,
                        min_chars=50,
                    ),
                )

                ingest_result = ingest_artifact(session, artifact_input)
                result = {
                    "artifact_id": ingest_result.artifact_id,
                    "run_id": ingest_result.run_id,
                    "status": ingest_result.status,
                    "reused_existing": ingest_result.reused_existing,
                    "summary_counts": ingest_result.summary_counts,
                    "warnings": ingest_result.warnings,
                    "errors": ingest_result.errors,
                }
                next_actions = ["explore_graph", "synthesize_summary"]
            else:
                # Option B: resource-backed capture (server reads uploaded file via stored storage_path)
                resource_id = str(file_data.get("resource_id") or "").strip()
                if not resource_id:
                    raise HTTPException(status_code=400, detail="file_data.resource_id or file_data.text is required")

                # Fetch resource with internal storage_path.
                q = """
                MATCH (g:GraphSpace {graph_id: $graph_id})
                MATCH (r:Resource {graph_id: $graph_id, resource_id: $resource_id})-[:BELONGS_TO]->(g)
                WHERE $branch_id IN COALESCE(r.on_branches, [])
                RETURN r.kind AS kind,
                       r.url AS url,
                       r.title AS title,
                       r.mime_type AS mime_type,
                       r.storage_path AS storage_path,
                       r.metadata_json AS metadata_json
                LIMIT 1
                """
                rec = session.run(
                    q,
                    graph_id=graph_id,
                    branch_id=branch_id,
                    resource_id=resource_id,
                ).single()
                if not rec:
                    raise HTTPException(status_code=404, detail=f"Resource not found: {resource_id}")

                storage_path = rec.get("storage_path")
                if not storage_path:
                    raise HTTPException(
                        status_code=400,
                        detail="Resource is missing storage_path (re-upload the file to enable ingestion)",
                    )

                kind = str(rec.get("kind") or "").strip()
                mime_type = str(rec.get("mime_type") or "").strip()
                url = str(rec.get("url") or "").strip() or None
                title = str(rec.get("title") or file_data.get("title") or resource_id).strip() or resource_id
                domain = file_data.get("domain")

                from storage import read_file
                file_bytes = read_file(str(storage_path))

                from services_ingestion_kernel import ingest_artifact
                from models_ingestion_kernel import ArtifactInput, IngestionActions, IngestionPolicy

                extract_concepts = bool(file_data.get("extract_concepts", True))
                extract_claims = bool(file_data.get("extract_claims", True))

                actions = IngestionActions(
                    run_lecture_extraction=extract_concepts,
                    run_chunk_and_claims=extract_claims,
                    embed_claims=extract_claims,
                    create_lecture_node=True,
                    create_artifact_node=True,
                )

                if mime_type == "application/pdf" or kind == "pdf":
                    from services_pdf_enhanced import extract_pdf_enhanced

                    use_ocr = bool(file_data.get("use_ocr", False))
                    extract_tables = bool(file_data.get("extract_tables", True))
                    pdf_result = extract_pdf_enhanced(
                        pdf_path=str(storage_path),
                        pdf_bytes=file_bytes,
                        use_ocr=use_ocr,
                        extract_tables=extract_tables,
                    )

                    artifact_input = ArtifactInput(
                        artifact_type="pdf",
                        source_url=url,
                        source_id=resource_id,
                        title=title,
                        domain=str(domain).strip() if isinstance(domain, str) and domain.strip() else None,
                        text=pdf_result.full_text,
                        metadata={
                            "capture_mode": "workflow_file_resource",
                            "resource_id": resource_id,
                            "pdf_metadata": pdf_result.metadata.dict(),
                            "extraction_method": pdf_result.extraction_method,
                        },
                        actions=actions,
                        policy=IngestionPolicy(
                            local_only=True,
                            max_chars=500_000,
                            min_chars=50,
                        ),
                    )
                elif mime_type.startswith("text/"):
                    try:
                        text = file_bytes.decode("utf-8")
                    except Exception:
                        text = file_bytes.decode("utf-8", errors="replace")

                    artifact_input = ArtifactInput(
                        artifact_type="manual",
                        source_url=url,
                        source_id=resource_id,
                        title=title,
                        domain=str(domain).strip() if isinstance(domain, str) and domain.strip() else None,
                        text=text,
                        metadata={
                            "capture_mode": "workflow_file_resource",
                            "resource_id": resource_id,
                            "mime_type": mime_type,
                        },
                        actions=actions,
                        policy=IngestionPolicy(
                            local_only=True,
                            max_chars=500_000,
                            min_chars=50,
                        ),
                    )
                else:
                    raise HTTPException(
                        status_code=400,
                        detail=f"Unsupported file type for capture workflow: {mime_type or kind or 'unknown'}",
                    )

                ingest_result = ingest_artifact(session, artifact_input)

                # Best-effort: mark resource with ingestion run_id and link it to an optional concept.
                try:
                    session.run(
                        """
                        MATCH (r:Resource {graph_id: $graph_id, resource_id: $resource_id})
                        SET r.ingestion_run_id = $run_id
                        """,
                        graph_id=graph_id,
                        resource_id=resource_id,
                        run_id=ingest_result.run_id,
                    ).consume()
                except Exception:
                    pass

                if request.attach_concept_id:
                    try:
                        from services_resources import link_resource_to_concept

                        link_resource_to_concept(
                            session=session,
                            concept_id=request.attach_concept_id,
                            resource_id=resource_id,
                        )
                    except Exception:
                        pass

                result = {
                    "resource_id": resource_id,
                    "artifact_id": ingest_result.artifact_id,
                    "run_id": ingest_result.run_id,
                    "status": ingest_result.status,
                    "reused_existing": ingest_result.reused_existing,
                    "summary_counts": ingest_result.summary_counts,
                    "warnings": ingest_result.warnings,
                    "errors": ingest_result.errors,
                }
                next_actions = ["explore_graph", "synthesize_summary"]
            
        else:
            raise HTTPException(status_code=400, detail=f"Unknown content_type: {request.content_type}")
        
        return CaptureResponse(
            success=True,
            result=result,
            next_actions=next_actions,
        )
        
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Capture failed: {str(e)}")


# -------------------- Explore Workflow --------------------

class ExploreRequest(BaseModel):
    """Request to explore the knowledge graph."""
    explore_type: str = Field(..., description="Type: 'query', 'concept', 'community', 'graph'")
    # For query
    query: Optional[str] = None
    intent: Optional[str] = None
    # For concept
    concept_id: Optional[str] = None
    # For community
    community_id: Optional[str] = None
    # For graph
    graph_id: Optional[str] = None
    # Common
    evidence_strictness: str = "medium"
    limit: Optional[int] = 10


class ExploreResponse(BaseModel):
    """Response from explore operation."""
    success: bool
    workflow: str = "explore"
    result: Dict[str, Any]
    next_actions: List[str] = Field(default_factory=list)


@router.post("/explore", response_model=ExploreResponse)
def explore_workflow(
    request: ExploreRequest,
    auth: dict = Depends(require_auth),
    session: Session = Depends(get_neo4j_session),
):
    """
    Explore workflow: Discover and navigate the knowledge graph.
    
    Supports:
    - Semantic search queries
    - Concept exploration
    - Community browsing
    - Graph overview
    """
    ensure_graph_scoping_initialized(session)
    graph_id, branch_id = get_active_graph_context(session)
    
    result = {}
    next_actions = []
    
    try:
        if request.explore_type == "query":
            if not request.query:
                raise HTTPException(status_code=400, detail="query required for query exploration")
            
            from models import RetrievalRequest
            from services_retrieval_plans import run_plan
            
            retrieval_result = run_plan(
                session=session,
                query=request.query,
                intent=request.intent,
                graph_id=graph_id,
                branch_id=branch_id,
                limit=request.limit or 10,
            )
            
            result = {
                "intent": retrieval_result.intent,
                "context": retrieval_result.context,
                "trace": [step.dict() for step in retrieval_result.trace],
            }
            next_actions = ["synthesize_answer", "capture_findings"]
            
        elif request.explore_type == "concept":
            if not request.concept_id:
                raise HTTPException(status_code=400, detail="concept_id required for concept exploration")
            
            from services_graph import get_concept_by_id, get_neighbors_with_relationships
            concept = get_concept_by_id(session, request.concept_id)
            if not concept:
                raise HTTPException(status_code=404, detail=f"Concept {request.concept_id} not found")
            
            neighbors = get_neighbors_with_relationships(session, request.concept_id)
            
            result = {
                "concept": concept.dict(),
                "neighbors": [n.dict() for n in neighbors[:request.limit or 10]],
            }
            next_actions = ["synthesize_summary", "capture_connections"]
            
        elif request.explore_type == "community":
            if not request.community_id:
                raise HTTPException(status_code=400, detail="community_id required for community exploration")
            
            from services_graphrag import semantic_search_communities
            communities = semantic_search_communities(
                session=session,
                graph_id=graph_id,
                branch_id=branch_id,
                query="",  # Get specific community
                limit=1,
            )
            
            result = {
                "community_id": request.community_id,
                "communities": [c for c in communities if c.get("community_id") == request.community_id],
            }
            next_actions = ["synthesize_community", "explore_concepts"]
            
        elif request.explore_type == "graph":
            from services_graph import get_graph_overview
            overview = get_graph_overview(
                session=session,
                limit_nodes=request.limit or 50,
                limit_edges=request.limit or 100,
            )
            
            result = {
                "nodes": overview.get("nodes", []),
                "edges": overview.get("edges", []),
                "meta": overview.get("meta", {}),
            }
            next_actions = ["synthesize_overview", "explore_concept"]
            
        else:
            raise HTTPException(status_code=400, detail=f"Unknown explore_type: {request.explore_type}")
        
        return ExploreResponse(
            success=True,
            result=result,
            next_actions=next_actions,
        )
        
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Explore failed: {str(e)}")


# -------------------- Synthesize Workflow --------------------

class SynthesizeRequest(BaseModel):
    """Request to synthesize information."""
    synthesize_type: str = Field(..., description="Type: 'answer', 'memo', 'summary', 'claims', 'mcq'")
    # For answer/summary
    query: Optional[str] = None
    context_ids: Optional[List[str]] = None
    # For claims
    quote_ids: Optional[List[str]] = None
    concept_id: Optional[str] = None
    # Common
    evidence_strictness: str = "medium"
    include_citations: bool = True


class SynthesizeResponse(BaseModel):
    """Response from synthesize operation."""
    success: bool
    workflow: str = "synthesize"
    result: Dict[str, Any]
    next_actions: List[str] = Field(default_factory=list)


@router.post("/synthesize", response_model=SynthesizeResponse)
async def synthesize_workflow(
    request: SynthesizeRequest,
    auth: dict = Depends(require_auth),
    session: Session = Depends(get_neo4j_session),
):
    """
    Synthesize workflow: Generate insights, summaries, and answers.
    
    Supports:
    - AI-powered answers
    - Research memos
    - Concept summaries
    - Claim generation
    """
    ensure_graph_scoping_initialized(session)
    graph_id, branch_id = get_active_graph_context(session)
    
    result = {}
    next_actions = []
    
    try:
        if request.synthesize_type == "answer":
            if not request.query:
                raise HTTPException(status_code=400, detail="query required for answer synthesis")
            
            # Use retrieval endpoint for answer synthesis
            from api_retrieval import retrieve_endpoint
            from models import RetrievalRequest
            from fastapi import Request
            
            retrieval_req = RetrievalRequest(
                message=request.query,
                graph_id=graph_id,
                branch_id=branch_id,
                evidence_strictness=request.evidence_strictness,
            )
            # Create a minimal request object for the endpoint
            class MockRequest:
                state = type('obj', (object,), {})()
            mock_request = MockRequest()
            retrieval_response = retrieve_endpoint(retrieval_req, mock_request, auth, session)
            
            result = {
                "answer": retrieval_response.context.get("summary", ""),
                "sources": retrieval_response.context.get("evidence_used", []),
                "intent": retrieval_response.intent,
            }
            next_actions = ["capture_answer", "explore_sources"]
            
        elif request.synthesize_type == "memo":
            if not request.query:
                raise HTTPException(status_code=400, detail="query required for memo synthesis")
            
            from services_research_memo import generate_research_memo
            
            memo_result = generate_research_memo(
                session=session,
                query=request.query,
                graph_id=graph_id,
                branch_id=branch_id,
                evidence_strictness=request.evidence_strictness,
                include_claims=True,
                include_concepts=True,
            )
            
            result = {
                "memo_text": memo_result["memo_text"],
                "citations": memo_result["citations"],
                "metadata": memo_result["metadata"],
            }
            next_actions = ["export_memo", "explore_citations"]
            
        elif request.synthesize_type == "summary":
            if not request.query and not request.context_ids:
                raise HTTPException(status_code=400, detail="query or context_ids required for summary synthesis")
            
            from services_graphrag import retrieve_graphrag_context
            context_result = retrieve_graphrag_context(
                session=session,
                graph_id=graph_id,
                branch_id=branch_id,
                question=request.query or "Summarize",
                evidence_strictness=request.evidence_strictness,
            )
            
            result = {
                "summary": context_result.get("context_text", ""),
                "claims_count": len(context_result.get("claims", [])),
                "concepts_count": len(context_result.get("concepts", [])),
            }
            next_actions = ["capture_summary", "explore_details"]
            
        elif request.synthesize_type == "claims":
            if not request.quote_ids:
                raise HTTPException(status_code=400, detail="quote_ids required for claims synthesis")
            
            from api_claims_from_quotes import create_claims_from_quotes
            from api_claims_from_quotes import ClaimsFromQuotesRequest
            
            claims_request = ClaimsFromQuotesRequest(
                quote_ids=request.quote_ids,
                concept_id=request.concept_id,
                graph_id=graph_id,
                branch_id=branch_id,
            )
            claims_response = create_claims_from_quotes(claims_request, session)
            
            result = {
                "claims_created": claims_response.claims_created,
                "claims": [c.dict() for c in claims_response.claims],
            }
            next_actions = ["explore_claims", "synthesize_validation"]
            
        elif request.synthesize_type == "mcq":
            if not request.query:
                raise HTTPException(status_code=400, detail="query (topic) required for MCQ synthesis")
            
            from services_mcq_generation import generate_mcq_for_topic
            
            task_spec_dict = await generate_mcq_for_topic(
                session=session,
                topic=request.query,
                graph_id=graph_id,
                branch_id=branch_id,
            )
            
            result = {
                "task_spec": task_spec_dict,
                "workflow": "practice",
            }
            next_actions = ["start_session", "explore_topic"]
            
        else:
            raise HTTPException(status_code=400, detail=f"Unknown synthesize_type: {request.synthesize_type}")
        
        return SynthesizeResponse(
            success=True,
            result=result,
            next_actions=next_actions,
        )
        
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Synthesize failed: {str(e)}")


# -------------------- Workflow Status --------------------

class WorkflowStatusResponse(BaseModel):
    """Status of workflows."""
    capture: Dict[str, Any]
    explore: Dict[str, Any]
    synthesize: Dict[str, Any]


@router.get("/status", response_model=WorkflowStatusResponse)
def get_workflow_status(
    auth: dict = Depends(require_auth),
    session: Session = Depends(get_neo4j_session),
):
    """
    Get status and capabilities of each workflow.
    """
    ensure_graph_scoping_initialized(session)
    graph_id, branch_id = get_active_graph_context(session)
    
    return WorkflowStatusResponse(
        capture={
            "available": True,
            "types": ["selection", "url", "file"],
            "graph_id": graph_id,
            "branch_id": branch_id,
        },
        explore={
            "available": True,
            "types": ["query", "concept", "community", "graph"],
            "graph_id": graph_id,
            "branch_id": branch_id,
        },
        synthesize={
            "available": True,
            "types": ["answer", "memo", "summary", "claims", "mcq"],
            "graph_id": graph_id,
            "branch_id": branch_id,
        },
    )
