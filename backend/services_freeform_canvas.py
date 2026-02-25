import json
import logging
import math
import time
from typing import Any, Dict, List, Optional, Tuple
from uuid import uuid4

from neo4j import Session

from models import (
    ConceptCreate,
    ExtractedLink,
    ExtractedNode,
    FreeformCanvasCaptureRequest,
    FreeformCanvasCaptureResponse,
    LectureCreate,
    LectureSegment,
)
from services_graph import (
    create_concept,
    create_lecture_segment,
    create_relationship_by_ids,
    link_segment_to_concept,
)
from services_lecture_ingestion import (
    find_concept_by_name_and_domain,
    normalize_name,
    update_concept_description_if_better,
)
from services_lectures import create_lecture, get_lecture_by_id, update_lecture
from services_model_router import TASK_EXTRACT, model_router

logger = logging.getLogger("brain_web")


FREEFORM_CAPTURE_SYSTEM_PROMPT = """
You are analyzing a freeform whiteboard. The user has described their canvas elements in spatial and temporal order.

Your job is to produce:
1. A list of concept nodes (enclosed shapes / circles = concepts).
2. A list of directed links (arrows from shape A to shape B = directed relationship).
3. A list of unanchored text blocks (free text not clearly inside any enclosure).
4. A Markdown transcript documenting what was drawn and in what order.

Return valid JSON with this schema:
{
  "nodes": [
    { "name": "string", "description": "string", "domain": "string or null", "type": "concept" }
  ],
  "links": [
    { "source_name": "string", "target_name": "string", "predicate": "string", "explanation": "string" }
  ],
  "unanchored_text": ["string"],
  "transcript": "markdown string — document order of creation, what was drawn"
}
"""


def _loads_json_list(raw: Optional[str], field_name: str) -> List[Dict[str, Any]]:
    if not raw:
        return []
    try:
        value = json.loads(raw)
    except json.JSONDecodeError as e:
        raise ValueError(f"Invalid JSON for {field_name}: {e}") from e
    if not isinstance(value, list):
        raise ValueError(f"{field_name} must deserialize to a list")
    return [item for item in value if isinstance(item, dict)]


def _clean_llm_json(content: str) -> str:
    content = (content or "").strip()
    if content.startswith("```json"):
        return content[7:-3].strip()
    if content.startswith("```"):
        return content[3:-3].strip()
    return content


def _bbox_from_points(points: List[Dict[str, Any]]) -> Optional[Dict[str, float]]:
    if not points:
        return None
    xs = [float(p.get("x", 0)) for p in points]
    ys = [float(p.get("y", 0)) for p in points]
    min_x, max_x = min(xs), max(xs)
    min_y, max_y = min(ys), max(ys)
    return {
        "x": min_x,
        "y": min_y,
        "w": max_x - min_x,
        "h": max_y - min_y,
    }


def _bbox_center(b: Dict[str, float]) -> Tuple[float, float]:
    return (b["x"] + b["w"] / 2.0, b["y"] + b["h"] / 2.0)


def _distance(a: Tuple[float, float], b: Tuple[float, float]) -> float:
    return math.hypot(a[0] - b[0], a[1] - b[1])


def _point_in_bbox(px: float, py: float, b: Dict[str, float], pad: float = 0.0) -> bool:
    return (
        (b["x"] - pad) <= px <= (b["x"] + b["w"] + pad)
        and (b["y"] - pad) <= py <= (b["y"] + b["h"] + pad)
    )


def _distance_point_to_bbox_edge(px: float, py: float, b: Dict[str, float]) -> float:
    inside_x = b["x"] <= px <= (b["x"] + b["w"])
    inside_y = b["y"] <= py <= (b["y"] + b["h"])
    if inside_x and inside_y:
        return min(
            abs(px - b["x"]),
            abs(px - (b["x"] + b["w"])),
            abs(py - b["y"]),
            abs(py - (b["y"] + b["h"])),
        )
    dx = max(b["x"] - px, 0.0, px - (b["x"] + b["w"]))
    dy = max(b["y"] - py, 0.0, py - (b["y"] + b["h"]))
    return math.hypot(dx, dy)


def is_closed_loop(points: List[Dict[str, Any]]) -> bool:
    if len(points) < 10:
        return False
    start = points[0]
    end = points[-1]
    dist = ((float(end["x"]) - float(start["x"])) ** 2 + (float(end["y"]) - float(start["y"])) ** 2) ** 0.5
    return dist < 100


def is_arrow(points: List[Dict[str, Any]]) -> bool:
    if len(points) < 5:
        return False
    bbox = _bbox_from_points(points)
    if not bbox:
        return False
    bbox_w = bbox["w"]
    bbox_h = bbox["h"]
    path_length = sum(
        ((float(points[i]["x"]) - float(points[i - 1]["x"])) ** 2 + (float(points[i]["y"]) - float(points[i - 1]["y"])) ** 2) ** 0.5
        for i in range(1, len(points))
    )
    diagonal = (bbox_w ** 2 + bbox_h ** 2) ** 0.5
    return diagonal > 0 and (path_length / diagonal) < 2.5 and path_length > 60


def _estimate_text_bbox(block: Dict[str, Any]) -> Dict[str, float]:
    x = float(block.get("x", 0))
    y = float(block.get("y", 0))
    w = float(block.get("w", max(40.0, len(str(block.get("text", ""))) * 8.0)))
    font_size = float(block.get("fontSize", 16))
    h = max(font_size * 1.6, 20.0)
    return {"x": x, "y": y, "w": w, "h": h}


def _safe_text(value: Any) -> str:
    return str(value or "").strip()


def _classify_strokes(strokes: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    classified: List[Dict[str, Any]] = []
    for idx, stroke in enumerate(strokes):
        points = stroke.get("points") or []
        if not isinstance(points, list) or not points:
            continue
        bbox = _bbox_from_points(points)
        if not bbox:
            continue
        kind = "freehand mark"
        if is_closed_loop(points):
            kind = "enclosure"
        elif is_arrow(points):
            kind = "arrow"
        classified.append(
            {
                "id": stroke.get("id") or f"stroke_{idx}",
                "timestamp": int(stroke.get("timestamp") or 0),
                "tool": stroke.get("tool") or "pen",
                "color": stroke.get("color"),
                "width": stroke.get("width"),
                "points": points,
                "bbox": bbox,
                "kind": kind,
                "start": {
                    "x": float(points[0].get("x", 0)),
                    "y": float(points[0].get("y", 0)),
                },
                "end": {
                    "x": float(points[-1].get("x", 0)),
                    "y": float(points[-1].get("y", 0)),
                },
            }
        )
    classified.sort(key=lambda s: (s.get("timestamp", 0), str(s.get("id"))))
    return classified


def _nearest_enclosure_for_text(
    text_bbox: Dict[str, float],
    enclosures: List[Dict[str, Any]],
    max_distance: float = 80.0,
) -> Optional[Tuple[Dict[str, Any], float]]:
    text_center = _bbox_center(text_bbox)
    best: Optional[Tuple[Dict[str, Any], float]] = None
    for enc in enclosures:
        eb = enc["bbox"]
        if _point_in_bbox(text_center[0], text_center[1], eb, pad=10.0):
            dist = 0.0
        else:
            dist = _distance_point_to_bbox_edge(text_center[0], text_center[1], eb)
        if dist <= max_distance and (best is None or dist < best[1]):
            best = (enc, dist)
    return best


def _build_canvas_description(
    strokes: List[Dict[str, Any]],
    text_blocks: List[Dict[str, Any]],
    phases: List[Dict[str, Any]],
    ocr_hint: Optional[str],
) -> Tuple[str, Dict[str, Any]]:
    classified_strokes = _classify_strokes(strokes)
    enclosures = [s for s in classified_strokes if s["kind"] == "enclosure"]
    arrows = [s for s in classified_strokes if s["kind"] == "arrow"]
    marks = [s for s in classified_strokes if s["kind"] == "freehand mark"]

    text_items: List[Dict[str, Any]] = []
    enclosure_texts: Dict[str, List[str]] = {str(e["id"]): [] for e in enclosures}
    unanchored_texts: List[str] = []

    for idx, block in enumerate(sorted(text_blocks, key=lambda b: int(b.get("timestamp") or 0))):
        text = _safe_text(block.get("text"))
        if not text:
            continue
        bbox = _estimate_text_bbox(block)
        nearest = _nearest_enclosure_for_text(bbox, enclosures)
        attached_to = None
        attached_distance = None
        if nearest:
            attached_to = str(nearest[0]["id"])
            attached_distance = round(nearest[1], 1)
            enclosure_texts.setdefault(attached_to, []).append(text)
        else:
            unanchored_texts.append(text)
        text_items.append(
            {
                "id": block.get("id") or f"text_{idx}",
                "timestamp": int(block.get("timestamp") or 0),
                "text": text,
                "bbox": bbox,
                "attached_to_enclosure": attached_to,
                "attached_distance": attached_distance,
            }
        )

    # Enclosure labels from nearby text to improve arrow endpoint descriptions.
    enclosure_labels: Dict[str, str] = {}
    for enc in enclosures:
        labels = [t for t in enclosure_texts.get(str(enc["id"]), []) if t]
        enclosure_labels[str(enc["id"])] = labels[0] if labels else f"enclosure_{enc['id']}"

    def _nearest_enclosure_label(point: Dict[str, float]) -> Optional[str]:
        if not enclosures:
            return None
        p = (point["x"], point["y"])
        best_enc = min(enclosures, key=lambda enc: _distance(p, _bbox_center(enc["bbox"])))
        if _distance(p, _bbox_center(best_enc["bbox"])) > 500:
            return None
        return enclosure_labels.get(str(best_enc["id"]))

    arrow_descriptions: List[Dict[str, Any]] = []
    for arrow in arrows:
        src = _nearest_enclosure_label(arrow["start"])
        dst = _nearest_enclosure_label(arrow["end"])
        arrow_descriptions.append(
            {
                "id": arrow["id"],
                "timestamp": arrow["timestamp"],
                "bbox": arrow["bbox"],
                "source_hint": src,
                "target_hint": dst,
            }
        )

    elements: List[Tuple[int, str]] = []
    for enc in enclosures:
        b = enc["bbox"]
        label_hint = enclosure_labels.get(str(enc["id"]))
        elements.append(
            (
                int(enc["timestamp"]),
                f"- [{enc['timestamp']}] enclosure `{enc['id']}` at ({b['x']:.0f},{b['y']:.0f},{b['w']:.0f}x{b['h']:.0f})"
                + (f" with nearby text: {', '.join(enclosure_texts.get(str(enc['id']), [])[:3])}" if enclosure_texts.get(str(enc["id"])) else "")
                + (f" (label hint: {label_hint})" if label_hint else ""),
            )
        )
    for arrow in arrow_descriptions:
        b = arrow["bbox"]
        src = arrow.get("source_hint") or "unknown"
        dst = arrow.get("target_hint") or "unknown"
        elements.append(
            (
                int(arrow["timestamp"]),
                f"- [{arrow['timestamp']}] arrow `{arrow['id']}` at ({b['x']:.0f},{b['y']:.0f},{b['w']:.0f}x{b['h']:.0f}) from `{src}` to `{dst}`",
            )
        )
    for mark in marks:
        b = mark["bbox"]
        elements.append(
            (
                int(mark["timestamp"]),
                f"- [{mark['timestamp']}] freehand mark `{mark['id']}` at ({b['x']:.0f},{b['y']:.0f},{b['w']:.0f}x{b['h']:.0f})",
            )
        )
    for text in text_items:
        b = text["bbox"]
        attach = text.get("attached_to_enclosure")
        attach_note = f" near enclosure `{attach}`" if attach else " unanchored"
        elements.append(
            (
                int(text["timestamp"]),
                f"- [{text['timestamp']}] text `{text['text']}` at ({b['x']:.0f},{b['y']:.0f},{b['w']:.0f}x{b['h']:.0f}){attach_note}",
            )
        )
    elements.sort(key=lambda item: item[0])

    phases_text = ""
    if phases:
        phase_lines = []
        for phase in sorted(phases, key=lambda p: (int(p.get("order") or 0), int(p.get("createdAt") or 0))):
            phase_lines.append(
                f"- {phase.get('label') or 'Untitled'} (order={phase.get('order')}, view=({phase.get('viewX')},{phase.get('viewY')}), zoom={phase.get('zoom')})"
            )
        phases_text = "\n\nPhases:\n" + "\n".join(phase_lines)

    ocr_text = f"\n\nOCR Hint:\n{ocr_hint.strip()}" if ocr_hint and ocr_hint.strip() else ""

    description = (
        "Canvas Summary:\n"
        f"- Enclosures detected: {len(enclosures)}\n"
        f"- Arrows detected: {len(arrows)}\n"
        f"- Freehand marks detected: {len(marks)}\n"
        f"- Text blocks: {len(text_items)}\n"
        "\nCanvas Elements (time order):\n"
        + ("\n".join(line for _, line in elements) if elements else "- No drawable elements found")
        + phases_text
        + ocr_text
    )

    structured = {
        "counts": {
            "enclosures": len(enclosures),
            "arrows": len(arrows),
            "freehand_marks": len(marks),
            "text_blocks": len(text_items),
        },
        "enclosures": [
            {
                "id": e["id"],
                "timestamp": e["timestamp"],
                "bbox": e["bbox"],
                "text_candidates": enclosure_texts.get(str(e["id"]), []),
                "label_hint": enclosure_labels.get(str(e["id"])),
            }
            for e in enclosures
        ],
        "arrows": arrow_descriptions,
        "freehand_marks": [
            {"id": m["id"], "timestamp": m["timestamp"], "bbox": m["bbox"]} for m in marks
        ],
        "text_blocks": text_items,
        "unanchored_text": unanchored_texts,
        "phases": phases,
    }
    return description, structured


def _merge_metadata_with_phases(
    existing_metadata_json: Optional[str],
    phases: List[Dict[str, Any]],
    run_id: str,
    drawing_blocks: Optional[List[Dict[str, Any]]] = None,
) -> str:
    metadata: Dict[str, Any] = {}
    if existing_metadata_json:
        try:
            parsed = json.loads(existing_metadata_json)
            if isinstance(parsed, dict):
                metadata = parsed
        except Exception:
            logger.warning("[freeform_capture] Failed to parse existing metadata_json; overwriting malformed metadata")

    freeform_meta = metadata.get("freeformCanvas")
    if not isinstance(freeform_meta, dict):
        freeform_meta = {}
    freeform_meta["phases"] = phases
    freeform_meta["lastCaptureRunId"] = run_id
    freeform_meta["lastCaptureAt"] = int(time.time() * 1000)
    if drawing_blocks is not None:
        freeform_meta["drawingBlocks"] = drawing_blocks
    metadata["freeformCanvas"] = freeform_meta
    return json.dumps(metadata)


def _call_freeform_llm(domain: Optional[str], description: str, structured: Dict[str, Any]) -> Dict[str, Any]:
    if not model_router.client:
        raise ValueError("OpenAI client not initialized.")

    user_prompt = (
        f"Domain: {domain or 'General'}\n\n"
        "Use the following canvas analysis to infer concepts and directed relationships.\n"
        "Prefer enclosure labels / nearby text as concept names.\n"
        "If an arrow endpoint is ambiguous, infer conservatively and explain uncertainty.\n\n"
        f"{description}\n\n"
        "Structured JSON analysis:\n"
        f"{json.dumps(structured, ensure_ascii=False)}"
    )

    raw_content = model_router.completion(
        task_type=TASK_EXTRACT,
        messages=[
            {"role": "system", "content": FREEFORM_CAPTURE_SYSTEM_PROMPT},
            {"role": "user", "content": user_prompt},
        ],
        temperature=0.2,
        max_tokens=4000,
    )
    cleaned = _clean_llm_json(raw_content)
    try:
        parsed = json.loads(cleaned)
    except json.JSONDecodeError as e:
        raise ValueError(f"Freeform capture model returned invalid JSON: {e}") from e
    if not isinstance(parsed, dict):
        raise ValueError("Freeform capture model returned non-object JSON")
    return parsed


def capture_freeform_canvas(
    session: Session,
    payload: FreeformCanvasCaptureRequest,
    tenant_id: Optional[str] = None,
) -> FreeformCanvasCaptureResponse:
    strokes = _loads_json_list(payload.strokes_json, "strokes_json")
    text_blocks = _loads_json_list(payload.text_blocks_json, "text_blocks_json")
    phases = _loads_json_list(payload.phases_json, "phases_json") if payload.phases_json else []
    drawing_blocks = (
        _loads_json_list(payload.drawing_blocks_json, "drawing_blocks_json")
        if payload.drawing_blocks_json
        else None
    )

    description, structured = _build_canvas_description(strokes, text_blocks, phases, payload.ocr_hint)
    llm_data = _call_freeform_llm(payload.domain, description, structured)

    # Normalize LLM output
    node_payloads = []
    for raw_node in llm_data.get("nodes", []) or []:
        if not isinstance(raw_node, dict):
            continue
        raw_node.setdefault("type", "concept")
        raw_node.setdefault("domain", payload.domain)
        node_payloads.append(ExtractedNode(**raw_node))

    link_payloads = []
    for raw_link in llm_data.get("links", []) or []:
        if not isinstance(raw_link, dict):
            continue
        link_payloads.append(ExtractedLink(**raw_link))

    transcript = _safe_text(llm_data.get("transcript"))
    llm_unanchored_text = [t for t in (llm_data.get("unanchored_text") or []) if isinstance(t, str) and t.strip()]
    if not transcript:
        fallback_lines = ["# Freeform Canvas Transcript", "", "Canvas capture generated from geometric analysis."]
        if llm_unanchored_text:
            fallback_lines += ["", "## Unanchored Text"] + [f"- {t}" for t in llm_unanchored_text]
        transcript = "\n".join(fallback_lines)

    run_id = f"freeform-capture-{uuid4().hex[:10]}"

    # Reuse existing lecture if canvas_id maps to one; otherwise create a new lecture.
    lecture = get_lecture_by_id(session, payload.canvas_id)
    if lecture:
        merged_metadata = _merge_metadata_with_phases(
            lecture.metadata_json, phases, run_id, drawing_blocks=drawing_blocks
        )
        updated = update_lecture(
            session=session,
            lecture_id=lecture.lecture_id,
            title=payload.canvas_title or lecture.title,
            raw_text=transcript,
            metadata_json=merged_metadata,
        )
        lecture = updated or lecture
    else:
        lecture = create_lecture(
            session=session,
            payload=LectureCreate(
                title=payload.canvas_title or "Freeform Canvas",
                description="Structured capture from freeform canvas",
                raw_text=transcript,
            ),
            tenant_id=tenant_id,
        )
        merged_metadata = _merge_metadata_with_phases(
            None, phases, run_id, drawing_blocks=drawing_blocks
        )
        lecture = update_lecture(
            session=session,
            lecture_id=lecture.lecture_id,
            metadata_json=merged_metadata,
        ) or lecture

    nodes_created = []
    nodes_updated = []
    links_created: List[Dict[str, Any]] = []
    node_name_to_id: Dict[str, str] = {}

    for en in node_payloads:
        normalized_name = normalize_name(en.name)
        existing = find_concept_by_name_and_domain(session, en.name, en.domain, tenant_id=tenant_id)
        if existing:
            updated = update_concept_description_if_better(session, existing, en.description)
            current_sources = list(updated.lecture_sources or [])
            if lecture.lecture_id not in current_sources:
                current_sources.append(lecture.lecture_id)
                session.run(
                    "MATCH (c:Concept {node_id: $node_id}) SET c.lecture_sources = $sources",
                    node_id=updated.node_id,
                    sources=current_sources,
                )
                updated.lecture_sources = current_sources
            nodes_updated.append(updated)
            node_name_to_id[normalized_name] = updated.node_id
        else:
            created = create_concept(
                session,
                ConceptCreate(
                    name=en.name,
                    domain=en.domain or payload.domain or "General",
                    type=en.type or "concept",
                    description=en.description,
                    tags=en.tags or [],
                    lecture_key=lecture.lecture_id,
                    lecture_sources=[lecture.lecture_id],
                    created_by=lecture.lecture_id,
                    last_updated_by=lecture.lecture_id,
                    created_by_run_id=run_id,
                    last_updated_by_run_id=run_id,
                ),
                tenant_id=tenant_id,
            )
            nodes_created.append(created)
            node_name_to_id[normalized_name] = created.node_id

    for el in link_payloads:
        src_id = node_name_to_id.get(normalize_name(el.source_name))
        dst_id = node_name_to_id.get(normalize_name(el.target_name))
        if not src_id or not dst_id:
            continue
        create_relationship_by_ids(
            session=session,
            source_id=src_id,
            target_id=dst_id,
            predicate=el.predicate,
            rationale=el.explanation,
            method="llm",
            source_id_meta=lecture.lecture_id,
            tenant_id=tenant_id,
        )
        links_created.append(
            {
                "source_id": src_id,
                "target_id": dst_id,
                "predicate": el.predicate,
                "explanation": el.explanation,
            }
        )

    # Persist a single transcript segment so the capture has lecture-segment traceability.
    segment_row = create_lecture_segment(
        session=session,
        lecture_id=lecture.lecture_id,
        segment_index=0,
        text=transcript,
        summary="Freeform canvas capture transcript",
        start_time_sec=None,
        end_time_sec=None,
        style_tags=["freeform-canvas", "capture"],
    )
    covered_concepts = []
    for concept in nodes_created + nodes_updated:
        try:
            # create_lecture_segment currently does not persist tenant_id on LectureSegment.
            # Use the same linking behavior as handwriting ingestion (no tenant filter on segment lookup).
            link_segment_to_concept(session, segment_row["segment_id"], concept.node_id)
            covered_concepts.append(concept)
        except Exception as e:
            logger.warning(f"[freeform_capture] Failed to link segment to concept {concept.node_id}: {e}")

    segments = [
        LectureSegment(
            segment_id=segment_row["segment_id"],
            lecture_id=lecture.lecture_id,
            segment_index=0,
            text=transcript,
            summary="Freeform canvas capture transcript",
            style_tags=["freeform-canvas", "capture"],
            covered_concepts=covered_concepts,
            analogies=[],
            lecture_title=lecture.title,
        )
    ]

    return FreeformCanvasCaptureResponse(
        lecture_id=lecture.lecture_id,
        nodes_created=nodes_created,
        nodes_updated=nodes_updated,
        links_created=links_created,
        segments=segments,
        transcript=transcript,
        run_id=run_id,
    )
