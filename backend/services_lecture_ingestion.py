"""
Service for ingesting lecture text and extracting graph structure using LLM.

Do not call backend endpoints from backend services. Use ingestion kernel/internal
services to prevent ingestion path drift.

Implementation is split into services.lecture_ingestion; this module re-exports
the public API for backward compatibility.
"""
from services.lecture_ingestion.chunking import normalize_name, chunk_text
from services.lecture_ingestion.concept_utils import (
    find_concept_by_name_and_domain,
    update_concept_description_if_better,
    merge_tags,
    update_concept_tags,
)
from services.lecture_ingestion.extraction import (
    extract_segments_and_analogies_with_llm,
    call_llm_for_extraction,
    process_structure,
    run_lecture_extraction_engine,
)
from services.lecture_ingestion.chunk_claims import (
    process_chunk_atomic,
    run_chunk_and_claims_engine,
)
from services.lecture_ingestion.segments_analogies import run_segments_and_analogies_engine
from services.lecture_ingestion.handwriting import ingest_handwriting

__all__ = [
    "normalize_name",
    "chunk_text",
    "find_concept_by_name_and_domain",
    "update_concept_description_if_better",
    "merge_tags",
    "update_concept_tags",
    "extract_segments_and_analogies_with_llm",
    "call_llm_for_extraction",
    "process_structure",
    "run_lecture_extraction_engine",
    "process_chunk_atomic",
    "run_chunk_and_claims_engine",
    "run_segments_and_analogies_engine",
    "ingest_handwriting",
]
