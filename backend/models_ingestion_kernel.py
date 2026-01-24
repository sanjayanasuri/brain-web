"""
Unified ingestion kernel models for artifact processing.

This module defines the core contracts for ingestion: policies, actions, inputs, and results.
These models provide a consistent interface across different ingestion sources (webpages, Notion pages, finance docs, lectures, manual entries).
"""

from typing import Optional, List, Dict, Any, Literal
from pydantic import BaseModel, Field


class IngestionPolicy(BaseModel):
    """Policy settings that control ingestion behavior."""
    local_only: bool = True
    denylist_domains: List[str] = Field(default_factory=list)
    max_chars: int = 200_000
    min_chars: int = 200
    strip_url_query: bool = True


class IngestionActions(BaseModel):
    """Actions to perform during ingestion."""
    run_lecture_extraction: bool = True  # LLM node/link extraction, segments/analogies
    run_chunk_and_claims: bool = True  # chunk + claim extraction
    embed_claims: bool = True
    create_lecture_node: bool = True  # for lecture/notion sources
    create_artifact_node: bool = True  # new Artifact node


class ArtifactInput(BaseModel):
    """Input specification for ingesting an artifact."""
    artifact_type: Literal["webpage", "notion_page", "finance_doc", "lecture", "manual", "pdf"]
    source_url: Optional[str] = None
    source_id: Optional[str] = None  # Notion page id, EDGAR accession, etc.
    title: Optional[str] = None
    domain: Optional[str] = None
    text: str
    metadata: Dict[str, Any] = Field(default_factory=dict)
    actions: IngestionActions = Field(default_factory=IngestionActions)
    policy: IngestionPolicy = Field(default_factory=IngestionPolicy)


class IngestionResult(BaseModel):
    """Result from artifact ingestion."""
    run_id: str
    artifact_id: Optional[str] = None
    status: Literal["COMPLETED", "PARTIAL", "FAILED", "SKIPPED"]
    reused_existing: bool = False
    summary_counts: Dict[str, Any] = Field(default_factory=dict)
    warnings: List[str] = Field(default_factory=list)
    errors: List[str] = Field(default_factory=list)
    # Lecture-specific fields (populated when run_lecture_extraction is True)
    lecture_id: Optional[str] = None
    nodes_created: List[Any] = Field(default_factory=list)  # List[Concept]
    nodes_updated: List[Any] = Field(default_factory=list)  # List[Concept]
    links_created: List[Dict[str, Any]] = Field(default_factory=list)
    segments: List[Any] = Field(default_factory=list)  # List[LectureSegment]
    # Enrichment fields for tracking created/updated IDs
    created_concept_ids: List[str] = Field(default_factory=list)
    updated_concept_ids: List[str] = Field(default_factory=list)
    created_relationship_count: int = 0
    created_claim_ids: List[str] = Field(default_factory=list)

