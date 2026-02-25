"""
Ingest handwriting/sketch images via GPT-4o Vision; persist lecture, concepts, links, segments, blocks.
"""
import json
from typing import Optional
from uuid import uuid4

from neo4j import Session

from models import (
    HandwritingIngestRequest,
    LectureIngestResult,
    LectureExtraction,
    ExtractedNode,
    ExtractedLink,
    ConceptCreate,
    LectureCreate,
    LectureBlockUpsert,
)
from services_graph import (
    create_concept,
    create_relationship_by_ids,
    create_lecture_segment,
    link_segment_to_concept,
)
from services_model_router import model_router
from prompts import HANDWRITING_INGESTION_PROMPT

from .chunking import normalize_name
from .concept_utils import find_concept_by_name_and_domain, update_concept_description_if_better


def ingest_handwriting(
    session: Session,
    payload: HandwritingIngestRequest,
    tenant_id: Optional[str] = None,
) -> LectureIngestResult:
    """
    Ingest a handwriting image using GPT-4o Vision.
    Processes the image to extract concepts, links, and segments.
    """
    if not model_router.client:
        raise ValueError("OpenAI client not initialized.")

    base64_image = payload.image_data
    if "," in base64_image:
        base64_image = base64_image.split(",")[1]

    print(f"[Handwriting Ingestion] Calling GPT-4o Vision for: {payload.lecture_title}")
    user_content = [
        {
            "type": "text",
            "text": f"OCR Hint: {payload.ocr_hint}\n\nDomain: {payload.domain or 'General'}\n\nAnalyze this handwritten note/sketch.",
        },
        {"type": "image_url", "image_url": {"url": f"data:image/png;base64,{base64_image}"}},
    ]

    try:
        response = model_router.client.chat.completions.create(
            model="gpt-4o",
            messages=[
                {"role": "system", "content": HANDWRITING_INGESTION_PROMPT},
                {"role": "user", "content": user_content},
            ],
            max_tokens=4000,
        )
        content = response.choices[0].message.content.strip()
        if content.startswith("```json"):
            content = content[7:-3].strip()
        elif content.startswith("```"):
            content = content[3:-3].strip()
        data = json.loads(content)

        from services_lectures import create_lecture

        transcribed_text = "\n\n".join([seg.get("text", "") for seg in data.get("segments", [])])
        if not transcribed_text and payload.ocr_hint:
            transcribed_text = payload.ocr_hint

        lecture = create_lecture(
            session=session,
            payload=LectureCreate(
                title=payload.lecture_title or data.get("lecture_title", "Handwritten Notes"),
                description=f"Ingested from handwriting/sketch. Generated on {data.get('lecture_title', '')}",
                raw_text=transcribed_text,
            ),
            tenant_id=tenant_id,
        )

        extraction = LectureExtraction(
            lecture_title=lecture.title,
            nodes=[ExtractedNode(**n) for n in data.get("nodes", [])],
            links=[ExtractedLink(**l) for l in data.get("links", [])],
        )
        dummy_run_id = f"ink-ingest-{uuid4().hex[:8]}"
        nodes_created = []
        nodes_updated = []
        node_name_to_id = {}

        for en in extraction.nodes:
            normalized_name = normalize_name(en.name)
            existing = find_concept_by_name_and_domain(session, en.name, en.domain)
            if existing:
                updated = update_concept_description_if_better(session, existing, en.description)
                current_sources = updated.lecture_sources or []
                if lecture.lecture_id not in current_sources:
                    current_sources.append(lecture.lecture_id)
                session.run(
                    "MATCH (c:Concept {node_id: $node_id}) SET c.lecture_sources = $sources",
                    node_id=updated.node_id,
                    sources=current_sources,
                )
                nodes_updated.append(updated)
                node_name_to_id[normalized_name] = updated.node_id
            else:
                new_concept = create_concept(
                    session,
                    ConceptCreate(
                        name=en.name,
                        domain=en.domain or payload.domain or "General",
                        type=en.type or "concept",
                        description=en.description,
                        tags=en.tags or [],
                        lecture_key=lecture.lecture_id,
                        lecture_sources=[lecture.lecture_id],
                    ),
                )
                nodes_created.append(new_concept)
                node_name_to_id[normalized_name] = new_concept.node_id

        links_persisted = []
        for el in extraction.links:
            src_id = node_name_to_id.get(normalize_name(el.source_name))
            dst_id = node_name_to_id.get(normalize_name(el.target_name))
            if src_id and dst_id:
                create_relationship_by_ids(
                    session, src_id, dst_id, el.predicate, rationale=el.explanation
                )
                links_persisted.append({"source_id": src_id, "target_id": dst_id, "predicate": el.predicate})

        segments_persisted = []
        for i, seg_data in enumerate(data.get("segments", [])):
            seg = create_lecture_segment(
                session=session,
                lecture_id=lecture.lecture_id,
                segment_index=i,
                text=seg_data.get("text", ""),
                summary=seg_data.get("summary", ""),
            )
            for c_name in seg_data.get("covered_concepts", []):
                cid = node_name_to_id.get(normalize_name(c_name))
                if cid:
                    link_segment_to_concept(session, seg["segment_id"], cid)
            segments_persisted.append(seg)

        from services_lecture_blocks import upsert_lecture_blocks

        blocks_data = data.get("blocks", [])
        if blocks_data:
            block_upserts = []
            for i, blk in enumerate(blocks_data):
                block_upserts.append(
                    LectureBlockUpsert(
                        block_index=i,
                        block_type=blk.get("block_type", "paragraph"),
                        text=blk.get("text", "") or "",
                        bbox=blk.get("box_2d"),
                    )
                )
            if block_upserts:
                upsert_lecture_blocks(session, lecture.lecture_id, block_upserts)
                print(f"[Handwriting Ingestion] Persisted {len(block_upserts)} layout blocks with bboxes")

        return LectureIngestResult(
            lecture_id=lecture.lecture_id,
            nodes_created=nodes_created,
            nodes_updated=nodes_updated,
            links_created=links_persisted,
            segments=segments_persisted,
            run_id=dummy_run_id,
            created_concept_ids=[n.node_id for n in nodes_created],
            updated_concept_ids=[n.node_id for n in nodes_updated],
            created_relationship_count=len(links_persisted),
        )
    except Exception as e:
        print(f"[Handwriting Ingestion] ERROR: {e}")
        raise e
