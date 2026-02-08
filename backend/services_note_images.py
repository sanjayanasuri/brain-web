from __future__ import annotations

import base64
import datetime
import hashlib
import io
import json
import re
from typing import Any, Dict, List, Optional, Tuple

from neo4j import Session
from PIL import Image

from models_note_images import (
    NoteImageBlock,
    NoteImageIngestRequest,
    NoteImageIngestResponse,
    OCRBlock,
)
from services_branch_explorer import (
    DEFAULT_BRANCH_ID,
    ensure_branch_exists,
    ensure_graph_scoping_initialized,
    ensure_graphspace_exists,
    get_active_graph_context,
)
from storage import save_file
from unified_primitives import AnchorRef, ArtifactRef, BBoxSelector


_DATA_URL_RE = re.compile(r"^data:(?P<mime>[^;]+);base64,(?P<b64>.*)$", re.DOTALL)


def _now_iso() -> str:
    return datetime.datetime.utcnow().replace(tzinfo=datetime.timezone.utc).isoformat()


def _sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _safe_json_dumps(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False)


def parse_image_data_url(image_data: str) -> Tuple[bytes, Optional[str]]:
    """
    Parse a base64 data URL or raw base64 string into bytes.

    Returns (bytes, mime_type).
    """
    if not image_data or not str(image_data).strip():
        raise ValueError("image_data is required")

    raw = str(image_data).strip()
    m = _DATA_URL_RE.match(raw)
    if m:
        mime_type = m.group("mime")
        b64 = m.group("b64")
        try:
            return base64.b64decode(b64, validate=False), mime_type
        except Exception as e:
            raise ValueError(f"Invalid base64 image_data: {e}")

    # No header — assume raw base64
    try:
        return base64.b64decode(raw, validate=False), None
    except Exception as e:
        raise ValueError(f"Invalid base64 image_data: {e}")


def _image_ext_from_mime(mime_type: Optional[str], pil_format: Optional[str]) -> str:
    if mime_type:
        mt = mime_type.lower().strip()
        if mt.endswith("png"):
            return ".png"
        if mt.endswith("jpeg") or mt.endswith("jpg"):
            return ".jpg"
        if mt.endswith("webp"):
            return ".webp"
    if pil_format:
        fmt = pil_format.lower().strip()
        if fmt == "png":
            return ".png"
        if fmt in ("jpeg", "jpg"):
            return ".jpg"
        if fmt == "webp":
            return ".webp"
    return ".png"


def _coerce_positive_int(value: Optional[int]) -> Optional[int]:
    if value is None:
        return None
    try:
        v = int(value)
        return v if v > 0 else None
    except Exception:
        return None


def normalize_bbox_to_pct(
    *,
    x: float,
    y: float,
    w: float,
    h: float,
    unit: str,
    image_width: Optional[int],
    image_height: Optional[int],
) -> Optional[Dict[str, Any]]:
    """
    Normalize bbox to unit='pct' (0..1) and clip to image bounds.

    Returns a selector dict compatible with unified_primitives.BBoxSelector.
    """
    unit = (unit or "px").strip().lower()
    image_width = _coerce_positive_int(image_width)
    image_height = _coerce_positive_int(image_height)

    if unit == "pct":
        x1 = float(x)
        y1 = float(y)
        x2 = float(x + w)
        y2 = float(y + h)
        if x2 < x1:
            x1, x2 = x2, x1
        if y2 < y1:
            y1, y2 = y2, y1
        x1 = max(0.0, min(1.0, x1))
        y1 = max(0.0, min(1.0, y1))
        x2 = max(0.0, min(1.0, x2))
        y2 = max(0.0, min(1.0, y2))
        w2 = max(0.0, x2 - x1)
        h2 = max(0.0, y2 - y1)
        if w2 <= 0.0 or h2 <= 0.0:
            return None
        return {
            "kind": "bbox",
            "x": x1,
            "y": y1,
            "w": w2,
            "h": h2,
            "unit": "pct",
            "image_width": image_width,
            "image_height": image_height,
        }

    # px
    if not image_width or not image_height:
        return None

    x1_px = float(x)
    y1_px = float(y)
    x2_px = float(x + w)
    y2_px = float(y + h)
    if x2_px < x1_px:
        x1_px, x2_px = x2_px, x1_px
    if y2_px < y1_px:
        y1_px, y2_px = y2_px, y1_px

    x1_px = max(0.0, min(float(image_width), x1_px))
    y1_px = max(0.0, min(float(image_height), y1_px))
    x2_px = max(0.0, min(float(image_width), x2_px))
    y2_px = max(0.0, min(float(image_height), y2_px))

    w_px = max(0.0, x2_px - x1_px)
    h_px = max(0.0, y2_px - y1_px)
    if w_px <= 0.0 or h_px <= 0.0:
        return None

    return {
        "kind": "bbox",
        "x": x1_px / float(image_width),
        "y": y1_px / float(image_height),
        "w": w_px / float(image_width),
        "h": h_px / float(image_height),
        "unit": "pct",
        "image_width": image_width,
        "image_height": image_height,
    }


def _try_server_ocr_blocks(image: Image.Image) -> Tuple[List[OCRBlock], List[str]]:
    """
    Best-effort server-side OCR using pytesseract.image_to_data.

    Returns (blocks, warnings). Never raises.
    """
    warnings: List[str] = []
    try:
        import pytesseract  # type: ignore
        from pytesseract import Output  # type: ignore
    except Exception:
        warnings.append("pytesseract not available; provide ocr_blocks from client for bbox OCR.")
        return [], warnings

    try:
        data = pytesseract.image_to_data(image, output_type=Output.DICT)
    except Exception as e:
        warnings.append(f"Server OCR unavailable ({e}); provide ocr_blocks from client for bbox OCR.")
        return [], warnings

    width, height = image.size
    blocks: List[OCRBlock] = []
    n = len(data.get("text") or [])
    for i in range(n):
        text = str((data.get("text") or [""])[i] or "").strip()
        if not text:
            continue
        try:
            left = float((data.get("left") or [0])[i] or 0)
            top = float((data.get("top") or [0])[i] or 0)
            w = float((data.get("width") or [0])[i] or 0)
            h = float((data.get("height") or [0])[i] or 0)
        except Exception:
            continue

        conf_raw = None
        try:
            conf_raw = (data.get("conf") or [None])[i]
        except Exception:
            conf_raw = None
        conf = None
        try:
            if conf_raw is not None:
                conf = float(conf_raw)
        except Exception:
            conf = None

        blocks.append(
            OCRBlock(
                text=text,
                confidence=conf,
                bbox={
                    "x": left,
                    "y": top,
                    "w": w,
                    "h": h,
                    "unit": "px",
                    "image_width": width,
                    "image_height": height,
                },
            )
        )

    return blocks, warnings


def ingest_note_image(
    *,
    session: Session,
    payload: NoteImageIngestRequest,
    tenant_id: Optional[str] = None,
) -> NoteImageIngestResponse:
    """
    Phase D: ingest a photo/whiteboard image as an Artifact plus bbox-anchored OCR blocks.

    Additive only: does not affect existing /lectures/ingest-ink flow.
    """
    ensure_graph_scoping_initialized(session)

    active_graph_id, active_branch_id = get_active_graph_context(session, tenant_id=tenant_id)

    graph_id = payload.graph_id or active_graph_id
    if payload.graph_id and not payload.branch_id:
        branch_id = DEFAULT_BRANCH_ID
    else:
        branch_id = payload.branch_id or active_branch_id

    ensure_graphspace_exists(session, graph_id, tenant_id=tenant_id)
    ensure_branch_exists(session, graph_id, branch_id)

    image_bytes, mime_type = parse_image_data_url(payload.image_data)
    img = Image.open(io.BytesIO(image_bytes))
    img.load()
    width, height = img.size

    ext = _image_ext_from_mime(mime_type, getattr(img, "format", None))
    image_url, storage_path = save_file(image_bytes, f"note_image{ext}", tenant_id=tenant_id)

    content_hash = _sha256_bytes(image_bytes)
    artifact_id = f"A{content_hash[:10].upper()}"
    artifact_url = f"note-image://{content_hash}"

    warnings: List[str] = []
    blocks = payload.ocr_blocks or []
    if not blocks:
        blocks, ocr_warnings = _try_server_ocr_blocks(img)
        warnings.extend(ocr_warnings)

    # Normalize blocks + build AnchorRefs
    artifact_ref = ArtifactRef(
        namespace="neo4j",
        type="artifact",
        id=artifact_id,
        graph_id=graph_id,
        branch_id=branch_id,
    )

    prepared_blocks: List[Dict[str, Any]] = []
    response_blocks: List[NoteImageBlock] = []

    for idx, b in enumerate(blocks):
        text = (b.text or "").strip()
        if not text:
            continue

        bbox = b.bbox
        selector_dict = normalize_bbox_to_pct(
            x=float(getattr(bbox, "x", 0)),
            y=float(getattr(bbox, "y", 0)),
            w=float(getattr(bbox, "w", 0)),
            h=float(getattr(bbox, "h", 0)),
            unit=str(getattr(bbox, "unit", "px") or "px"),
            image_width=getattr(bbox, "image_width", None) or width,
            image_height=getattr(bbox, "image_height", None) or height,
        )
        if not selector_dict:
            continue

        selector = BBoxSelector(**selector_dict)
        preview = text.replace("\n", " ")
        if len(preview) > 120:
            preview = preview[:120] + "…"

        anchor = AnchorRef.create(artifact=artifact_ref, selector=selector, preview=preview)
        quote_hash_input = f"{artifact_id}\n{idx}\n{anchor.anchor_id}\n{text}"
        quote_id = f"QIMG_{hashlib.sha256(quote_hash_input.encode('utf-8')).hexdigest()[:16].upper()}"

        anchor_json = selector.model_dump(mode="json")
        prepared_blocks.append(
            {
                "quote_id": quote_id,
                "text": text,
                "confidence": b.confidence,
                "anchor_json": _safe_json_dumps(anchor_json),
            }
        )
        response_blocks.append(
            NoteImageBlock(
                text=text,
                confidence=b.confidence,
                bbox=selector_dict,
                anchor=anchor.model_dump(mode="json"),
                quote_id=quote_id,
            )
        )

    extracted_text = "\n".join([blk["text"] for blk in prepared_blocks]).strip()
    if not extracted_text and payload.ocr_hint:
        extracted_text = str(payload.ocr_hint).strip()

    metadata: Dict[str, Any] = {
        "kind": "note_image",
        "image_url": image_url,
        "storage_path": storage_path,
        "mime_type": mime_type,
        "image_width": width,
        "image_height": height,
        "ocr_engine": payload.ocr_engine,
        "ocr_hint": payload.ocr_hint,
        "blocks_count": len(prepared_blocks),
    }

    now_iso = _now_iso()
    captured_at_ms = int(datetime.datetime.utcnow().timestamp() * 1000)

    # Upsert Artifact
    session.run(
        """
        MATCH (g:GraphSpace {graph_id: $graph_id})
        MERGE (a:Artifact {graph_id: $graph_id, url: $url, content_hash: $content_hash})
        ON CREATE SET
          a.artifact_id = $artifact_id,
          a.branch_id = $branch_id,
          a.artifact_type = "note_image",
          a.title = $title,
          a.domain = $domain,
          a.captured_at = $captured_at_ms,
          a.text = $text,
          a.metadata_json = $metadata_json,
          a.metadata = $metadata_json,
          a.on_branches = [$branch_id],
          a.created_at = $now,
          a.updated_at = $now
        ON MATCH SET
          a.title = COALESCE($title, a.title),
          a.domain = COALESCE($domain, a.domain),
          a.text = COALESCE($text, a.text),
          a.metadata_json = COALESCE($metadata_json, a.metadata_json),
          a.metadata = COALESCE($metadata_json, a.metadata),
          a.on_branches = CASE
            WHEN a.on_branches IS NULL THEN [$branch_id]
            WHEN $branch_id IN a.on_branches THEN a.on_branches
            ELSE a.on_branches + $branch_id
          END,
          a.updated_at = $now
        MERGE (a)-[:BELONGS_TO]->(g)
        RETURN a.artifact_id AS artifact_id
        """,
        graph_id=graph_id,
        branch_id=branch_id,
        url=artifact_url,
        content_hash=content_hash,
        artifact_id=artifact_id,
        title=payload.title or "Whiteboard Photo",
        domain=payload.domain,
        captured_at_ms=captured_at_ms,
        text=extracted_text,
        metadata_json=_safe_json_dumps(metadata),
        now=now_iso,
    ).consume()

    # Upsert Quotes (OCR blocks)
    if prepared_blocks:
        session.run(
            """
            MATCH (g:GraphSpace {graph_id: $graph_id})
            MATCH (a:Artifact {graph_id: $graph_id, artifact_id: $artifact_id})-[:BELONGS_TO]->(g)
            UNWIND $blocks AS b
            MERGE (q:Quote {graph_id: $graph_id, quote_id: b.quote_id})
            ON CREATE SET
              q.text = b.text,
              q.page_url = $url,
              q.page_title = $title,
              q.anchor_json = b.anchor_json,
              q.confidence = b.confidence,
              q.created_at = $now,
              q.on_branches = [$branch_id]
            ON MATCH SET
              q.last_seen_at = $now,
              q.anchor_json = COALESCE(q.anchor_json, b.anchor_json),
              q.confidence = COALESCE(q.confidence, b.confidence),
              q.on_branches = CASE
                WHEN q.on_branches IS NULL THEN [$branch_id]
                WHEN $branch_id IN q.on_branches THEN q.on_branches
                ELSE q.on_branches + $branch_id
              END
            MERGE (q)-[:BELONGS_TO]->(g)
            MERGE (q)-[:FROM_ARTIFACT {graph_id: $graph_id}]->(a)
            RETURN count(q) AS upserted
            """,
            graph_id=graph_id,
            branch_id=branch_id,
            artifact_id=artifact_id,
            url=artifact_url,
            title=payload.title or "Whiteboard Photo",
            blocks=prepared_blocks,
            now=now_iso,
        ).consume()

    return NoteImageIngestResponse(
        status="ok",
        graph_id=graph_id,
        branch_id=branch_id,
        artifact_id=artifact_id,
        image_url=image_url,
        extracted_text=extracted_text,
        blocks=response_blocks,
        warnings=warnings,
    )

