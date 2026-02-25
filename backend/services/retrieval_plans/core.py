"""
Core retrieval plan dispatcher and shared helpers (compare target extraction, empty result).
"""
from typing import List, Any, Optional, Tuple
from neo4j import Session
import json
import re

from services_branch_explorer import ensure_graph_scoping_initialized
from services_search import semantic_search_nodes
from models import RetrievalResult, RetrievalTraceStep, Intent

_COMPARE_TARGET_MIN_CONFIDENCE = 0.65


def _safe_float(value: Any, default: float = 0.0) -> float:
    try:
        return float(value)
    except Exception:
        return float(default)


def _clean_compare_target(value: Any) -> str:
    text = str(value or "").strip()
    if not text:
        return ""
    text = re.sub(r'^[\"\'`]+|[\"\'`]+$', "", text).strip()
    text = text.strip(" \t\n\r.,;:!?")
    return re.sub(r"\s+", " ", text)


def _dedupe_targets(targets: List[Any]) -> List[str]:
    out: List[str] = []
    seen = set()
    for target in targets:
        cleaned = _clean_compare_target(target)
        if not cleaned:
            continue
        key = cleaned.lower()
        if key in seen:
            continue
        seen.add(key)
        out.append(cleaned)
        if len(out) >= 2:
            break
    return out


def _extract_compare_targets_llm(query: str) -> List[str]:
    text = str(query or "").strip()
    if not text:
        return []

    try:
        from services_model_router import model_router, TASK_EXTRACT

        if not model_router.client:
            return []

        prompt = (
            "Extract the two entities/topics being compared in the query.\n"
            "Return strict JSON with keys:\n"
            "- target_a: string or null\n"
            "- target_b: string or null\n"
            "- is_compare: boolean\n"
            "- confidence: number between 0 and 1\n"
            "Rules:\n"
            "- If query is not a comparison request, set is_compare=false and targets=null.\n"
            "- Do not invent entities.\n"
            "- Keep targets concise and normalized.\n"
        )

        raw = model_router.completion(
            task_type=TASK_EXTRACT,
            messages=[
                {"role": "system", "content": prompt},
                {"role": "user", "content": json.dumps({"query": text})},
            ],
            response_format={"type": "json_object"},
            temperature=0.0,
            max_tokens=120,
        )

        parsed = json.loads(raw or "{}")
        if parsed.get("is_compare") is False:
            return []
        confidence = _safe_float(parsed.get("confidence"), 0.0)
        if confidence < _COMPARE_TARGET_MIN_CONFIDENCE:
            return []

        return _dedupe_targets([parsed.get("target_a"), parsed.get("target_b")])
    except Exception:
        return []


def _extract_compare_targets_regex(query: str) -> List[str]:
    text = str(query or "").strip()
    if not text:
        return []

    patterns = [
        r"(.+?)\s+(?:vs|versus)\s+(.+)",
        r"\bcompare\s+(.+?)\s+(?:and|to|with)\s+(.+)",
        r"\bdifference\s+between\s+(.+?)\s+and\s+(.+)",
    ]

    for pattern in patterns:
        match = re.search(pattern, text, flags=re.I)
        if not match:
            continue
        return _dedupe_targets([match.group(1), match.group(2)])

    return []


def _identify_compare_targets(query: str, session: Session) -> Tuple[List[str], str]:
    llm_targets = _extract_compare_targets_llm(query)
    if len(llm_targets) >= 2:
        return llm_targets[:2], "llm"
    regex_targets = _extract_compare_targets_regex(query)
    if len(regex_targets) >= 2:
        return regex_targets[:2], "regex"
    results = semantic_search_nodes(query, session, limit=2)
    semantic_targets = _dedupe_targets([r["node"].name for r in results[:2]])
    return semantic_targets, "semantic"


def _empty_result(intent: str, trace: List[RetrievalTraceStep], warning: str = "No results found") -> RetrievalResult:
    return RetrievalResult(
        intent=intent,
        trace=trace,
        context={
            "focus_entities": [],
            "focus_communities": [],
            "claims": [],
            "chunks": [],
            "subgraph": {"concepts": [], "edges": []},
            "suggestions": [],
            "warnings": [warning],
        },
    )


def run_plan(
    session: Session,
    query: str,
    intent: str,
    graph_id: str,
    branch_id: str,
    limit: int = 5,
    detail_level: str = "summary",
    ingestion_run_id: Optional[Any] = None,
) -> RetrievalResult:
    ensure_graph_scoping_initialized(session)
    intent_enum = Intent(intent)

    if intent_enum == Intent.DEFINITION_OVERVIEW:
        from .definition_overview import plan_definition_overview
        return plan_definition_overview(session, query, graph_id, branch_id, limit, detail_level, ingestion_run_id)
    elif intent_enum == Intent.TIMELINE:
        from .timeline import plan_timeline
        return plan_timeline(session, query, graph_id, branch_id, limit, detail_level, ingestion_run_id)
    elif intent_enum == Intent.CAUSAL_CHAIN:
        from .causal_chain import plan_causal_chain
        return plan_causal_chain(session, query, graph_id, branch_id, limit, detail_level, ingestion_run_id)
    elif intent_enum == Intent.COMPARE:
        from .compare import plan_compare
        return plan_compare(session, query, graph_id, branch_id, limit, detail_level, ingestion_run_id)
    elif intent_enum == Intent.WHO_NETWORK:
        from .who_network import plan_who_network
        return plan_who_network(session, query, graph_id, branch_id, limit, detail_level, ingestion_run_id)
    elif intent_enum == Intent.EVIDENCE_CHECK:
        from .evidence_check import plan_evidence_check
        return plan_evidence_check(session, query, graph_id, branch_id, limit, detail_level, ingestion_run_id)
    elif intent_enum == Intent.EXPLORE_NEXT:
        from .explore_next import plan_explore_next
        return plan_explore_next(session, query, graph_id, branch_id, limit, detail_level, ingestion_run_id)
    elif intent_enum == Intent.WHAT_CHANGED:
        from .what_changed import plan_what_changed
        return plan_what_changed(session, query, graph_id, branch_id, limit, detail_level)
    elif intent_enum == Intent.SELF_KNOWLEDGE:
        from .self_knowledge import plan_self_knowledge
        return plan_self_knowledge(session, query, graph_id, branch_id, limit, detail_level, ingestion_run_id)
    else:
        from .definition_overview import plan_definition_overview
        return plan_definition_overview(session, query, graph_id, branch_id, limit, detail_level, ingestion_run_id)
