"""
Task processor for background AI work.

Processes tasks queued via voice commands or UI.
Tasks are executed asynchronously and update their status.
"""
import logging
from typing import Optional, Dict, Any
from datetime import datetime
import json

from neo4j import Session

from models import Task, TaskType, TaskStatus
from services_signals import get_task
from services_branch_explorer import get_active_graph_context, set_active_branch, set_active_graph
from services_graphrag import retrieve_graphrag_context
from services_retrieval_signals import enhance_retrieval_with_signals, format_signal_context
from services_model_router import model_router, TASK_CHAT_FAST, TASK_REASONING, TASK_SUMMARIZE

logger = logging.getLogger("brain_web")


def _get_graph_tenant_id(session: Session, graph_id: Optional[str]) -> Optional[str]:
    if not graph_id:
        return None
    rec = session.run(
        """
        MATCH (g:GraphSpace {graph_id: $graph_id})
        RETURN g.tenant_id AS tenant_id
        LIMIT 1
        """,
        graph_id=graph_id,
    ).single()
    if not rec:
        return None
    tenant_id = rec.get("tenant_id")
    return str(tenant_id) if tenant_id else None


def _ensure_task_graph_context(session: Session, task: Task) -> None:
    """
    Best-effort: align the active graph/branch context with the task.

    Many services rely on get_active_graph_context(session). TaskQueue workers run
    with a fresh session, so we re-select here to prevent cross-graph drift.
    """
    try:
        tenant_id = _get_graph_tenant_id(session, task.graph_id)
        current_graph_id, current_branch_id = get_active_graph_context(session, tenant_id=tenant_id)
        if task.graph_id and task.graph_id != current_graph_id:
            set_active_graph(session, task.graph_id, tenant_id=tenant_id)
        if task.branch_id and task.branch_id != get_active_graph_context(session, tenant_id=tenant_id)[1]:
            set_active_branch(session, task.branch_id, tenant_id=tenant_id)
    except Exception:
        # Don't fail tasks solely due to context selection problems.
        pass


def _get_trigger_signal_payload(session: Session, task: Task) -> Optional[Dict[str, Any]]:
    if not task.created_by_signal_id:
        return None
    try:
        rec = session.run(
            """
            MATCH (s:Signal {signal_id: $signal_id, graph_id: $graph_id})
            RETURN s.payload AS payload
            LIMIT 1
            """,
            signal_id=task.created_by_signal_id,
            graph_id=task.graph_id,
        ).single()
        if not rec:
            return None
        payload = rec.get("payload")
        if isinstance(payload, str):
            try:
                payload = json.loads(payload)
            except Exception:
                return None
        if isinstance(payload, dict):
            return payload
        return None
    except Exception:
        return None


def _get_trigger_transcript(session: Session, task: Task) -> Optional[str]:
    payload = _get_trigger_signal_payload(session, task)
    if not payload:
        return None
    for k in ("transcript", "question", "text"):
        v = payload.get(k)
        if isinstance(v, str) and v.strip():
            return v.strip()
    return None


def process_task(session: Session, task_id: str) -> Optional[Task]:
    """
    Process a single task.
    
    This function executes the task based on its type and updates the task status.
    Should be called from a background worker.
    """
    # Seed active context from task's own graph/branch so non-API workers never
    # rely on an unrelated "global" active graph.
    try:
        rec = session.run(
            """
            MATCH (t:Task {task_id: $task_id})
            RETURN t.graph_id AS graph_id, t.branch_id AS branch_id
            LIMIT 1
            """,
            task_id=task_id,
        ).single()
        if rec:
            graph_id = rec.get("graph_id")
            branch_id = rec.get("branch_id")
            tenant_id = _get_graph_tenant_id(session, graph_id)
            if graph_id:
                set_active_graph(session, graph_id, tenant_id=tenant_id)
                if branch_id:
                    set_active_branch(session, branch_id, tenant_id=tenant_id)
    except Exception:
        pass

    task = get_task(session, task_id)
    if not task:
        logger.error(f"Task {task_id} not found")
        return None
    
    if task.status != TaskStatus.QUEUED:
        logger.warning(f"Task {task_id} is not in QUEUED status (current: {task.status})")
        return task
    
    # Update status to RUNNING
    started_at = int(datetime.utcnow().timestamp() * 1000)
    update_query = """
    MATCH (t:Task {task_id: $task_id})
    SET t.status = $status,
        t.started_at = $started_at
    RETURN t
    """
    session.run(update_query, task_id=task_id, status=TaskStatus.RUNNING.value, started_at=started_at)
    
    try:
        result = None
        error = None
        
        if task.task_type == TaskType.GENERATE_ANSWERS:
            result = _process_generate_answers(session, task)
        elif task.task_type == TaskType.SUMMARIZE:
            result = _process_summarize(session, task)
        elif task.task_type == TaskType.EXPLAIN:
            result = _process_explain(session, task)
        elif task.task_type == TaskType.GAP_ANALYSIS:
            result = _process_gap_analysis(session, task)
        elif task.task_type == TaskType.RETRIEVE_CONTEXT:
            result = _process_retrieve_context(session, task)
        elif task.task_type == TaskType.EXTRACT_CONCEPTS:
            result = _process_extract_concepts(session, task)
        elif task.task_type == TaskType.REBUILD_COMMUNITIES:
            result = _process_rebuild_communities(session, task)
        else:
            error = f"Unknown task type: {task.task_type}"
        
        # Update task with result
        completed_at = int(datetime.utcnow().timestamp() * 1000)
        import json
        result_json = json.dumps(result) if result else None
        
        update_result_query = """
        MATCH (t:Task {task_id: $task_id})
        SET t.status = $status,
            t.completed_at = $completed_at,
            t.result = $result,
            t.error = $error
        RETURN t
        """
        session.run(
            update_result_query,
            task_id=task_id,
            status=TaskStatus.READY.value if not error else TaskStatus.FAILED.value,
            completed_at=completed_at,
            result=result_json,
            error=error,
        )
        
        logger.info(f"Task {task_id} completed successfully")
        return get_task(session, task_id)
        
    except Exception as e:
        logger.error(f"Task {task_id} failed: {e}", exc_info=True)
        # Update task with error
        completed_at = int(datetime.utcnow().timestamp() * 1000)
        update_error_query = """
        MATCH (t:Task {task_id: $task_id})
        SET t.status = $status,
            t.completed_at = $completed_at,
            t.error = $error
        RETURN t
        """
        session.run(
            update_error_query,
            task_id=task_id,
            status=TaskStatus.FAILED.value,
            completed_at=completed_at,
            error=str(e),
        )
        return get_task(session, task_id)


def _process_generate_answers(session: Session, task: Task) -> Dict[str, Any]:
    """Generate answers to questions based on user's material."""
    question = task.params.get("question", "")
    if not question:
        return {
            "error": "No question provided in task params",
            "task_type": task.task_type.value,
        }
    
    # Retrieve context using GraphRAG with signal-aware retrieval
    try:
        context_result = retrieve_graphrag_context(
            session=session,
            graph_id=task.graph_id,
            branch_id=task.branch_id,
            question=question,
            evidence_strictness="medium",
        )
        
        # Enhance with signals
        concepts = context_result.get("concepts", [])
        signal_info = enhance_retrieval_with_signals(session, concepts)
        signal_context = format_signal_context(signal_info)
        
        # Combine context
        full_context = context_result.get("context_text", "")
        if signal_context:
            full_context += "\n\n" + signal_context
        
        answer = model_router.completion(
            task_type=TASK_CHAT_FAST,
            messages=[
                {
                    "role": "system",
                    "content": "You are a helpful tutor. Answer questions using only the provided context from the user's knowledge graph. If the context doesn't contain enough information, say so clearly.",
                },
                {
                    "role": "user",
                    "content": f"Question: {question}\n\nContext from knowledge graph:\n{full_context}\n\nAnswer:",
                },
            ],
            temperature=0.7,
            max_tokens=1000,
        )
        
        return {
            "answer": answer,
            "question": question,
            "context_used": {
                "communities": len(context_result.get("communities", [])),
                "claims": len(context_result.get("claims", [])),
                "concepts": len(context_result.get("concepts", [])),
            },
            "task_type": task.task_type.value,
        }
    except Exception as e:
        logger.error(f"Error generating answers: {e}", exc_info=True)
        return {
            "error": str(e),
            "task_type": task.task_type.value,
        }


def _process_summarize(session: Session, task: Task) -> Dict[str, Any]:
    """Summarize highlighted or selected content."""
    text = task.params.get("text", "")
    block_id = task.params.get("block_id") or task.block_id
    concept_id = task.params.get("concept_id") or task.concept_id
    
    if not text and not block_id and not concept_id:
        return {
            "error": "No text, block_id, or concept_id provided",
            "task_type": task.task_type.value,
        }
    
    # If block_id or concept_id provided, retrieve content from graph
    if not text and (block_id or concept_id):
        # TODO: Fetch block or concept content from graph
        # For now, use retrieval as fallback
        query = f"Summarize content related to block {block_id}" if block_id else f"Summarize concept {concept_id}"
        context_result = retrieve_graphrag_context(
            session=session,
            graph_id=task.graph_id,
            branch_id=task.branch_id,
            question=query,
            evidence_strictness="medium",
        )
        text = context_result.get("context_text", "")
    
    if not text:
        return {
            "error": "No content to summarize",
            "task_type": task.task_type.value,
        }
    
    try:
        # Truncate if too long
        max_chars = 8000
        if len(text) > max_chars:
            text = text[:max_chars] + "..."

        summary = model_router.completion(
            task_type=TASK_SUMMARIZE,
            messages=[
                {
                    "role": "system",
                    "content": "You are a helpful assistant that creates concise summaries. Focus on key concepts and main points.",
                },
                {
                    "role": "user",
                    "content": f"Summarize this content:\n\n{text}",
                },
            ],
            temperature=0.3,
            max_tokens=500,
        )
        
        return {
            "summary": summary,
            "original_length": len(text),
            "task_type": task.task_type.value,
        }
    except Exception as e:
        logger.error(f"Error summarizing: {e}", exc_info=True)
        return {
            "error": str(e),
            "task_type": task.task_type.value,
        }


def _process_explain(session: Session, task: Task) -> Dict[str, Any]:
    """Explain concept using only user's material."""
    concept_id = task.params.get("concept_id") or task.concept_id
    question = task.params.get("question", "")
    
    if not concept_id and not question:
        return {
            "error": "No concept_id or question provided",
            "task_type": task.task_type.value,
        }
    
    # Retrieve context for the concept/question
    query = question if question else f"Explain concept {concept_id}"
    
    try:
        context_result = retrieve_graphrag_context(
            session=session,
            graph_id=task.graph_id,
            branch_id=task.branch_id,
            question=query,
            evidence_strictness="medium",
        )
        
        # Enhance with signals (user's reflections, emphasis, etc.)
        concepts = context_result.get("concepts", [])
        signal_info = enhance_retrieval_with_signals(session, concepts)
        signal_context = format_signal_context(signal_info)
        
        # Combine context
        full_context = context_result.get("context_text", "")
        if signal_context:
            full_context += "\n\n" + signal_context
        
        explanation = model_router.completion(
            task_type=TASK_CHAT_FAST,
            messages=[
                {
                    "role": "system",
                    "content": "You are a helpful tutor. Explain concepts using only the provided context from the user's knowledge graph. Use the user's own words and reflections when available.",
                },
                {
                    "role": "user",
                    "content": f"Explain: {query}\n\nContext from knowledge graph:\n{full_context}\n\nExplanation:",
                },
            ],
            temperature=0.7,
            max_tokens=1000,
        )
        
        return {
            "explanation": explanation,
            "concept_id": concept_id,
            "context_used": {
                "communities": len(context_result.get("communities", [])),
                "claims": len(context_result.get("claims", [])),
                "concepts": len(context_result.get("concepts", [])),
            },
            "task_type": task.task_type.value,
        }
    except Exception as e:
        logger.error(f"Error explaining: {e}", exc_info=True)
        return {
            "error": str(e),
            "task_type": task.task_type.value,
        }


def _process_gap_analysis(session: Session, task: Task) -> Dict[str, Any]:
    """Analyze gaps between required knowledge and demonstrated understanding."""
    _ensure_task_graph_context(session, task)

    question = task.params.get("question") or task.params.get("query") or _get_trigger_transcript(session, task) or ""
    question = str(question).strip()
    if not question:
        return {"error": "No question/transcript provided for gap analysis", "task_type": task.task_type.value}

    try:
        context_result = retrieve_graphrag_context(
            session=session,
            graph_id=task.graph_id,
            branch_id=task.branch_id,
            question=question,
            evidence_strictness=task.params.get("evidence_strictness", "medium"),
        )
    except Exception as e:
        logger.error(f"Error retrieving context for gap analysis: {e}", exc_info=True)
        context_result = {"context_text": "", "concepts": [], "claims": [], "communities": [], "edges": []}

    # Ask the LLM for prerequisite concepts, then score coverage using the graph.
    known_concepts = []
    for c in (context_result.get("concepts") or [])[:30]:
        name = c.get("name") if isinstance(c, dict) else None
        if isinstance(name, str) and name.strip():
            known_concepts.append(name.strip())

    try:
        raw = model_router.completion(
            task_type=TASK_REASONING,
            messages=[
                {
                    "role": "system",
                    "content": (
                        "You are a tutor helping a student identify prerequisites and gaps.\n"
                        "Return ONLY valid JSON.\n"
                        "Schema:\n"
                        "{\n"
                        '  "prerequisites": [{"name": string, "why": string, "importance": "high"|"medium"|"low"}],\n'
                        '  "assumptions": [string]\n'
                        "}\n"
                        "Keep it focused (8-15 prerequisites)."
                    ),
                },
                {
                    "role": "user",
                    "content": (
                        f"Question/goal:\n{question}\n\n"
                        f"Known related concepts already in the graph:\n{json.dumps(known_concepts[:30])}\n"
                    ),
                },
            ],
            temperature=0.2,
            max_tokens=700,
        )
        raw = (raw or "").strip()
        parsed = json.loads(raw) if raw else {}
    except Exception as e:
        logger.warning(f"Gap analysis prerequisite extraction failed; falling back to retrieved concepts: {e}")
        parsed = {"prerequisites": [{"name": n, "why": "", "importance": "medium"} for n in known_concepts[:12]], "assumptions": []}

    prereqs = parsed.get("prerequisites") if isinstance(parsed, dict) else None
    if not isinstance(prereqs, list):
        prereqs = []

    prereq_items: list[dict] = []
    seen = set()
    for item in prereqs:
        if not isinstance(item, dict):
            continue
        name = str(item.get("name") or "").strip()
        if not name or name.lower() in seen:
            continue
        seen.add(name.lower())
        prereq_items.append(
            {
                "name": name,
                "why": str(item.get("why") or "").strip(),
                "importance": str(item.get("importance") or "medium").strip().lower(),
            }
        )
        if len(prereq_items) >= 15:
            break

    prereq_names = [p["name"] for p in prereq_items]
    if not prereq_names:
        prereq_names = known_concepts[:10]
        prereq_items = [{"name": n, "why": "", "importance": "medium"} for n in prereq_names]

    coverage_rows: list[dict] = []
    if prereq_names:
        cov_query = """
        MATCH (g:GraphSpace {graph_id: $graph_id})
        WITH g, $branch_id AS branch_id, $names AS names
        UNWIND names AS requested_name
        OPTIONAL MATCH (c:Concept {graph_id: $graph_id})-[:BELONGS_TO]->(g)
        WHERE branch_id IN COALESCE(c.on_branches, [])
          AND (toLower(c.name) = toLower(requested_name) OR toLower(c.name) CONTAINS toLower(requested_name))
        WITH g, branch_id, requested_name, c
        ORDER BY CASE
          WHEN c IS NULL THEN 2
          WHEN toLower(c.name) = toLower(requested_name) THEN 0
          ELSE 1
        END, size(c.name) ASC
        WITH g, branch_id, requested_name, collect(c)[0] AS best
        OPTIONAL MATCH (best)-[r]-(n:Concept {graph_id: $graph_id})-[:BELONGS_TO]->(g)
        WHERE branch_id IN COALESCE(r.on_branches, []) AND branch_id IN COALESCE(n.on_branches, [])
        WITH g, branch_id, requested_name, best, count(DISTINCT r) AS degree
        OPTIONAL MATCH (cl:Claim {graph_id: $graph_id})-[:MENTIONS]->(best)
        WHERE branch_id IN COALESCE(cl.on_branches, [])
        WITH requested_name, best, degree, count(DISTINCT cl) AS claim_count
        RETURN requested_name,
               best.node_id AS node_id,
               best.name AS matched_name,
               size(COALESCE(best.description, "")) AS description_len,
               degree,
               claim_count
        """
        try:
            rows = session.run(
                cov_query,
                graph_id=task.graph_id,
                branch_id=task.branch_id,
                names=prereq_names,
            )
            coverage_rows = [dict(r.data()) for r in rows]
        except Exception as e:
            logger.warning(f"Gap analysis coverage query failed: {e}")
            coverage_rows = [{"requested_name": n, "node_id": None, "matched_name": None, "description_len": 0, "degree": 0, "claim_count": 0} for n in prereq_names]

    cov_by_requested = {r.get("requested_name"): r for r in coverage_rows if isinstance(r, dict)}

    gaps = []
    next_steps = []
    for prereq in prereq_items:
        requested = prereq["name"]
        cov = cov_by_requested.get(requested, {}) if cov_by_requested else {}
        node_id = cov.get("node_id")
        matched_name = cov.get("matched_name")
        description_len = int(cov.get("description_len") or 0)
        claim_count = int(cov.get("claim_count") or 0)
        degree = int(cov.get("degree") or 0)

        if not node_id:
            gap_type = "missing"
            next_steps.append(f"Add '{requested}' to your graph (capture a source or add a note), then re-run gap analysis.")
        elif claim_count == 0 or description_len < 30:
            gap_type = "insufficient_depth"
            next_steps.append(f"Expand '{matched_name or requested}' with at least 1–2 supporting claims and a short description.")
        else:
            gap_type = "sufficient"

        gaps.append(
            {
                "requested_name": requested,
                "matched_name": matched_name,
                "concept_id": node_id,
                "gap_type": gap_type,
                "importance": prereq.get("importance"),
                "why": prereq.get("why"),
                "coverage": {
                    "degree": degree,
                    "claim_count": claim_count,
                    "description_len": description_len,
                },
            }
        )

    # Deduplicate next steps while preserving order
    dedup_steps = []
    seen_steps = set()
    for s in next_steps:
        if s in seen_steps:
            continue
        seen_steps.add(s)
        dedup_steps.append(s)

    return {
        "question": question,
        "gaps": gaps,
        "assumptions": parsed.get("assumptions", []) if isinstance(parsed, dict) else [],
        "next_steps": dedup_steps[:8],
        "context_used": {
            "communities": len(context_result.get("communities", [])),
            "claims": len(context_result.get("claims", [])),
            "concepts": len(context_result.get("concepts", [])),
        },
        "task_type": task.task_type.value,
    }


def _process_retrieve_context(session: Session, task: Task) -> Dict[str, Any]:
    """Retrieve relevant context for a question or concept."""
    question = task.params.get("question", "")
    concept_id = task.params.get("concept_id") or task.concept_id
    
    if not question and not concept_id:
        return {
            "error": "No question or concept_id provided",
            "task_type": task.task_type.value,
        }
    
    query = question if question else f"Context for concept {concept_id}"
    
    try:
        # Retrieve context using GraphRAG
        context_result = retrieve_graphrag_context(
            session=session,
            graph_id=task.graph_id,
            branch_id=task.branch_id,
            question=query,
            evidence_strictness=task.params.get("evidence_strictness", "medium"),
        )
        
        # Enhance with signals
        concepts = context_result.get("concepts", [])
        signal_info = enhance_retrieval_with_signals(session, concepts)
        signal_context = format_signal_context(signal_info)
        
        # Combine context
        full_context = context_result.get("context_text", "")
        if signal_context:
            full_context += "\n\n" + signal_context
        
        return {
            "context": full_context,
            "context_text": full_context,
            "communities": context_result.get("communities", []),
            "claims": context_result.get("claims", []),
            "concepts": context_result.get("concepts", []),
            "edges": context_result.get("edges", []),
            "signal_info": signal_info,
            "task_type": task.task_type.value,
        }
    except Exception as e:
        logger.error(f"Error retrieving context: {e}", exc_info=True)
        return {
            "error": str(e),
            "task_type": task.task_type.value,
        }


def _process_extract_concepts(session: Session, task: Task) -> Dict[str, Any]:
    """Extract concepts from uploaded content."""
    _ensure_task_graph_context(session, task)

    # Preferred inputs
    text = task.params.get("text")
    resource_id = task.params.get("resource_id")
    artifact_type = "manual"
    extra_metadata: Dict[str, Any] = {}

    if not (isinstance(text, str) and text.strip()) and resource_id:
        # Resource-backed extraction (PDF/text)
        rid = str(resource_id).strip()
        q = """
        MATCH (g:GraphSpace {graph_id: $graph_id})
        MATCH (r:Resource {graph_id: $graph_id, resource_id: $resource_id})-[:BELONGS_TO]->(g)
        WHERE $branch_id IN COALESCE(r.on_branches, [])
        RETURN r.kind AS kind, r.mime_type AS mime_type, r.url AS url, r.title AS title, r.storage_path AS storage_path
        LIMIT 1
        """
        rec = session.run(q, graph_id=task.graph_id, branch_id=task.branch_id, resource_id=rid).single()
        if not rec:
            return {"error": f"Resource not found: {rid}", "task_type": task.task_type.value}

        storage_path = rec.get("storage_path")
        if not storage_path:
            return {"error": "Resource is missing storage_path (re-upload the file to enable ingestion)", "task_type": task.task_type.value}

        from storage import read_file
        file_bytes = read_file(str(storage_path))

        kind = str(rec.get("kind") or "").strip()
        mime_type = str(rec.get("mime_type") or "").strip()
        url = str(rec.get("url") or "").strip() or None
        title = str(rec.get("title") or rid).strip() or rid

        if mime_type == "application/pdf" or kind == "pdf":
            from services_pdf_enhanced import extract_pdf_enhanced
            pdf_result = extract_pdf_enhanced(pdf_path=str(storage_path), pdf_bytes=file_bytes, use_ocr=False, extract_tables=True)
            text = pdf_result.full_text
            artifact_type = "pdf"
            extra_metadata = {
                "resource_id": rid,
                "pdf_metadata": pdf_result.metadata.dict(),
                "extraction_method": pdf_result.extraction_method,
            }
        elif mime_type.startswith("text/"):
            try:
                text = file_bytes.decode("utf-8")
            except Exception:
                text = file_bytes.decode("utf-8", errors="replace")
            artifact_type = "manual"
            extra_metadata = {"resource_id": rid, "mime_type": mime_type}
        else:
            return {"error": f"Unsupported resource type for concept extraction: {mime_type or kind or 'unknown'}", "task_type": task.task_type.value}

        task.params["source_url"] = url
        task.params["title"] = title

    if not (isinstance(text, str) and text.strip()):
        text = _get_trigger_transcript(session, task) or ""

    text = str(text).strip()
    if not text:
        return {"error": "No text/transcript provided for concept extraction", "task_type": task.task_type.value}

    from services_ingestion_kernel import ingest_artifact
    from models_ingestion_kernel import ArtifactInput, IngestionActions, IngestionPolicy

    title = str(task.params.get("title") or "Concept extraction").strip() or "Concept extraction"
    domain = task.params.get("domain")
    source_url = task.params.get("source_url")
    source_id = task.params.get("source_id") or task.task_id

    artifact_input = ArtifactInput(
        artifact_type=artifact_type,  # type: ignore[arg-type]
        source_url=str(source_url).strip() if isinstance(source_url, str) and source_url.strip() else None,
        source_id=str(source_id).strip() if source_id else None,
        title=title,
        domain=str(domain).strip() if isinstance(domain, str) and domain.strip() else None,
        text=text,
        metadata={
            "capture_mode": "task_extract_concepts",
            "task_id": task.task_id,
            **extra_metadata,
        },
        actions=IngestionActions(
            run_lecture_extraction=True,
            run_chunk_and_claims=False,
            embed_claims=False,
            create_lecture_node=True,
            create_artifact_node=True,
        ),
        policy=IngestionPolicy(
            local_only=True,
            max_chars=200_000,
            min_chars=20,
        ),
    )

    try:
        ingest_result = ingest_artifact(session, artifact_input)
    except Exception as e:
        logger.error(f"Error extracting concepts via ingestion kernel: {e}", exc_info=True)
        return {"error": str(e), "task_type": task.task_type.value}

    created = ingest_result.created_concept_ids or []
    updated = ingest_result.updated_concept_ids or []

    return {
        "artifact_id": ingest_result.artifact_id,
        "run_id": ingest_result.run_id,
        "status": ingest_result.status,
        "created_concept_ids": created,
        "updated_concept_ids": updated,
        "created_relationship_count": ingest_result.created_relationship_count,
        "task_type": task.task_type.value,
    }


def _process_rebuild_communities(session: Session, task: Task) -> Dict[str, Any]:
    """Rebuild communities for the graph."""
    try:
        from services_community_build import trigger_community_build
        
        resolution = task.params.get("resolution", 0.6)
        
        logger.info(f"Starting community rebuild task for graph {task.graph_id}")
        
        success = trigger_community_build(
            session=session,
            graph_id=task.graph_id,
            branch_id=task.branch_id,
            resolution=float(resolution),
        )
        
        if success:
            return {
                "message": "Community detection completed successfully",
                "graph_id": task.graph_id,
                "task_type": task.task_type.value,
            }
        else:
            raise Exception("Community build reported failure (check server logs for details)")
            
    except Exception as e:
        logger.error(f"Error rebuilding communities: {e}", exc_info=True)
        # Re-raise to be caught by main loop and mark task as FAILED
        raise e
