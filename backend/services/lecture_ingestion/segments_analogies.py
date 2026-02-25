"""
Extract segments and analogies from lecture text (LLM), persist segments and link to concepts/analogies.
"""
from typing import Optional, List, Dict

from neo4j import Session

from models import Concept, LectureSegment, Analogy
from services_graph import (
    create_lecture_segment,
    link_segment_to_concept,
    get_or_create_analogy,
    link_segment_to_analogy,
)

from .chunking import normalize_name
from .concept_utils import find_concept_by_name_and_domain
from .extraction import extract_segments_and_analogies_with_llm


def run_segments_and_analogies_engine(
    session: Session,
    lecture_id: str,
    lecture_title: str,
    lecture_text: str,
    domain: Optional[str],
    node_name_to_id: Dict[str, str],
    nodes_created: List[Concept],
    nodes_updated: List[Concept],
    tenant_id: Optional[str] = None,
) -> List[LectureSegment]:
    """
    Extract segments and analogies from lecture text.
    """
    print(f"[Lecture Ingestion] Extracting segments and analogies")
    available_concept_names = [normalize_name(nc.name) for nc in nodes_created] + [
        normalize_name(nu.name) for nu in nodes_updated
    ]
    segments_raw = extract_segments_and_analogies_with_llm(
        lecture_title=lecture_title,
        lecture_text=lecture_text,
        domain=domain,
        available_concepts=available_concept_names,
    )
    segments_models: List[LectureSegment] = []

    for seg in segments_raw:
        seg_db = create_lecture_segment(
            session=session,
            lecture_id=lecture_id,
            segment_index=seg["segment_index"],
            text=seg["text"],
            summary=seg.get("summary"),
            start_time_sec=seg.get("start_time_sec"),
            end_time_sec=seg.get("end_time_sec"),
            style_tags=seg.get("style_tags"),
            tenant_id=tenant_id,
        )
        segment_id = seg_db["segment_id"]
        covered_concept_models: List[Concept] = []
        for concept_name in seg.get("covered_concepts", []):
            normalized_concept_name = normalize_name(concept_name)
            concept_id = node_name_to_id.get(normalized_concept_name)
            if concept_id:
                found_concept = None
                for nc in nodes_created:
                    if normalize_name(nc.name) == normalized_concept_name:
                        found_concept = nc
                        break
                if not found_concept:
                    for nu in nodes_updated:
                        if normalize_name(nu.name) == normalized_concept_name:
                            found_concept = nu
                            break
                if found_concept:
                    covered_concept_models.append(found_concept)
                    link_segment_to_concept(
                        session=session,
                        segment_id=segment_id,
                        concept_id=concept_id,
                        tenant_id=tenant_id,
                    )
                    continue
                for nc in nodes_created:
                    if normalized_concept_name in [normalize_name(a) for a in (nc.aliases or [])]:
                        found_concept = nc
                        break
                if not found_concept:
                    for nu in nodes_updated:
                        if normalized_concept_name in [normalize_name(a) for a in (nu.aliases or [])]:
                            found_concept = nu
                            break
                if found_concept:
                    covered_concept_models.append(found_concept)
                    link_segment_to_concept(
                        session=session,
                        segment_id=segment_id,
                        concept_id=found_concept.node_id,
                        tenant_id=tenant_id,
                    )
                    continue
            existing_concept = find_concept_by_name_and_domain(
                session=session, name=concept_name, domain=domain, tenant_id=tenant_id
            )
            if existing_concept:
                covered_concept_models.append(existing_concept)
                link_segment_to_concept(
                    session=session,
                    segment_id=segment_id,
                    concept_id=existing_concept.node_id,
                    tenant_id=tenant_id,
                )
            else:
                existing_concept_any_domain = find_concept_by_name_and_domain(
                    session=session, name=concept_name, domain=None, tenant_id=tenant_id
                )
                if existing_concept_any_domain:
                    covered_concept_models.append(existing_concept_any_domain)
                    link_segment_to_concept(
                        session=session,
                        segment_id=segment_id,
                        concept_id=existing_concept_any_domain.node_id,
                        tenant_id=tenant_id,
                    )
                else:
                    print(
                        f"[Lecture Ingestion] Segment references concept '{concept_name}' that wasn't found (this is OK - concept may be created later)"
                    )
        analogy_models: List[Analogy] = []
        for an in seg.get("analogies", []):
            analogy_db = get_or_create_analogy(
                session=session,
                label=an["label"],
                description=an.get("description"),
                tags=[domain] if domain else [],
                tenant_id=tenant_id,
            )
            analogy_models.append(Analogy(**analogy_db))
            link_segment_to_analogy(
                session=session,
                segment_id=segment_id,
                analogy_id=analogy_db["analogy_id"],
                tenant_id=tenant_id,
            )
        segments_models.append(
            LectureSegment(
                segment_id=segment_id,
                lecture_id=lecture_id,
                segment_index=seg["segment_index"],
                start_time_sec=seg.get("start_time_sec"),
                end_time_sec=seg.get("end_time_sec"),
                text=seg["text"],
                summary=seg.get("summary"),
                style_tags=seg.get("style_tags", []),
                covered_concepts=covered_concept_models,
                analogies=analogy_models,
            )
        )
    print(f"[Lecture Ingestion] Created {len(segments_models)} segments")
    return segments_models
