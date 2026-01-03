"""
Service for ingesting lecture text and extracting graph structure using LLM

Do not call backend endpoints from backend services. Use ingestion kernel/internal services to prevent ingestion path drift.
"""
import json
import re
from typing import Optional, List, Dict, Any
from uuid import uuid4
from neo4j import Session
from openai import OpenAI
import os
from pathlib import Path

from models import (
    LectureIngestRequest,
    LectureIngestResult,
    LectureExtraction,
    ExtractedNode,
    ExtractedLink,
    Concept,
    ConceptCreate,
    RelationshipCreate,
    LectureSegment,
    Analogy,
)
from services_graph import (
    get_concept_by_name,
    create_concept,
    create_relationship,
    create_relationship_by_ids,
    get_or_create_analogy,
    create_lecture_segment,
    link_segment_to_concept,
    link_segment_to_analogy,
    upsert_source_chunk,
    upsert_claim,
    link_claim_mentions,
)
from services_ingestion_runs import (
    create_ingestion_run,
    update_ingestion_run_status,
)
from services_claims import extract_claims_from_chunk, normalize_claim_text
from services_search import embed_text
from services_branch_explorer import get_active_graph_context, ensure_graph_scoping_initialized
from prompts import LECTURE_TO_GRAPH_PROMPT, LECTURE_SEGMENTATION_PROMPT
from config import OPENAI_API_KEY
import hashlib

# Initialize OpenAI client
client = None
if OPENAI_API_KEY:
    # Clean the API key (remove whitespace, quotes, etc.)
    cleaned_key = OPENAI_API_KEY.strip().strip('"').strip("'")
    if cleaned_key and cleaned_key.startswith('sk-'):
        try:
            client = OpenAI(api_key=cleaned_key)
            # Never print key material (even partials) to logs.
            print(f"✓ OpenAI client initialized for lecture ingestion (key length: {len(cleaned_key)})")
        except Exception as e:
            print(f"ERROR: Failed to initialize OpenAI client for lecture ingestion: {e}")
            client = None
    else:
        print("WARNING: OPENAI_API_KEY format invalid (should start with 'sk-')")
        client = None
else:
    print("WARNING: OPENAI_API_KEY not found - lecture ingestion will not work")
    print("  Set it in .env.local (repo root) or backend/.env")


def normalize_name(name: str) -> str:
    """Normalize concept name for comparison (lowercase, strip whitespace)"""
    return name.strip().lower()


def chunk_text(text: str, max_chars: int = 1200, overlap: int = 150) -> List[Dict[str, Any]]:
    """
    Chunk text into overlapping segments.
    
    Args:
        text: Full text to chunk
        max_chars: Maximum characters per chunk
        overlap: Number of characters to overlap between chunks
    
    Returns:
        List of dicts with 'text' and 'index' fields
    """
    if not text:
        return []
    
    chunks = []
    start = 0
    index = 0
    
    while start < len(text):
        # Calculate end position
        end = start + max_chars
        
        # Try to break at sentence boundary (prefer period, newline, or space)
        if end < len(text):
            # Look for sentence boundary in the last 200 chars
            boundary_chars = ['.', '\n', '!', '?']
            for i in range(end, max(start + max_chars - 200, start), -1):
                if text[i] in boundary_chars:
                    end = i + 1
                    break
            else:
                # No sentence boundary found, try space
                for i in range(end, max(start + max_chars - 100, start), -1):
                    if text[i] == ' ':
                        end = i + 1
                        break
        
        chunk_text_content = text[start:end].strip()
        if chunk_text_content:
            chunks.append({
                "text": chunk_text_content,
                "index": index
            })
            index += 1
        
        # Move start position with overlap
        start = end - overlap
        if start >= len(text):
            break
    
    return chunks


def find_concept_by_name_and_domain(
    session: Session, name: str, domain: Optional[str]
) -> Optional[Concept]:
    """
    Find a concept by name (case-insensitive) and optionally domain.
    If domain is None, matches any domain.
    """
    from services_graph import _normalize_concept_from_db
    
    normalized_name = normalize_name(name)
    
    if domain:
        # Try exact match first (name + domain)
        query = """
        MATCH (c:Concept)
        WHERE toLower(trim(c.name)) = $normalized_name
          AND c.domain = $domain
        RETURN c.node_id AS node_id,
               c.name AS name,
               c.domain AS domain,
               c.type AS type,
               c.description AS description,
               c.tags AS tags,
               c.notes_key AS notes_key,
               c.lecture_key AS lecture_key,
               c.url_slug AS url_slug,
               COALESCE(c.lecture_sources, []) AS lecture_sources,
               c.created_by AS created_by,
               c.last_updated_by AS last_updated_by
        LIMIT 1
        """
        result = session.run(query, normalized_name=normalized_name, domain=domain)
        record = result.single()
        if record:
            return _normalize_concept_from_db(record.data())
    
    # Fallback: match by name only (case-insensitive)
    query = """
    MATCH (c:Concept)
    WHERE toLower(trim(c.name)) = $normalized_name
    RETURN c.node_id AS node_id,
           c.name AS name,
           c.domain AS domain,
           c.type AS type,
           c.description AS description,
           c.tags AS tags,
           c.notes_key AS notes_key,
           c.lecture_key AS lecture_key,
           c.url_slug AS url_slug,
           COALESCE(c.lecture_sources, []) AS lecture_sources,
           c.created_by AS created_by,
           c.last_updated_by AS last_updated_by
    LIMIT 1
    """
    result = session.run(query, normalized_name=normalized_name)
    record = result.single()
    if record:
        return _normalize_concept_from_db(record.data())
    
    return None


def update_concept_description_if_better(
    session: Session, concept: Concept, new_description: Optional[str]
) -> Concept:
    """
    Update concept description only if new one is longer/more detailed.
    Returns the updated concept.
    """
    from services_graph import _normalize_concept_from_db
    
    if not new_description:
        return concept
    
    current_desc = concept.description or ""
    # Update if new description is longer (more detailed)
    if len(new_description) > len(current_desc):
        query = """
        MATCH (c:Concept {node_id: $node_id})
        SET c.description = $description
        RETURN c.node_id AS node_id,
               c.name AS name,
               c.domain AS domain,
               c.type AS type,
               c.description AS description,
               c.tags AS tags,
               c.notes_key AS notes_key,
               c.lecture_key AS lecture_key,
               c.url_slug AS url_slug,
               COALESCE(c.lecture_sources, []) AS lecture_sources,
               c.created_by AS created_by,
               c.last_updated_by AS last_updated_by
        """
        result = session.run(query, node_id=concept.node_id, description=new_description)
        record = result.single()
        if record:
            return _normalize_concept_from_db(record.data())
    
    return concept


def merge_tags(existing_tags: Optional[List[str]], new_tags: List[str]) -> List[str]:
    """Merge new tags with existing tags, avoiding duplicates"""
    existing = set(existing_tags or [])
    new = set(new_tags or [])
    merged = existing | new
    return sorted(list(merged))


def update_concept_tags(session: Session, concept: Concept, new_tags: List[str]) -> Concept:
    """Update concept tags by merging with existing tags"""
    from services_graph import _normalize_concept_from_db
    
    merged_tags = merge_tags(concept.tags, new_tags)
    query = """
    MATCH (c:Concept {node_id: $node_id})
    SET c.tags = $tags
    RETURN c.node_id AS node_id,
           c.name AS name,
           c.domain AS domain,
           c.type AS type,
           c.description AS description,
           c.tags AS tags,
           c.notes_key AS notes_key,
           c.lecture_key AS lecture_key,
           c.url_slug AS url_slug,
           COALESCE(c.lecture_sources, []) AS lecture_sources,
           c.created_by AS created_by,
           c.last_updated_by AS last_updated_by
    """
    result = session.run(query, node_id=concept.node_id, tags=merged_tags)
    record = result.single()
    if record:
        return _normalize_concept_from_db(record.data())
    return concept


def extract_segments_and_analogies_with_llm(
    lecture_title: str,
    lecture_text: str,
    domain: Optional[str] = None,
    available_concepts: Optional[List[str]] = None,
) -> List[Dict[str, Any]]:
    """
    Use the LLM to:
    - Segment the lecture into ordered segments
    - For each segment, identify:
        - text
        - optional summary
        - style tags
        - covered concept names
        - analogies (label + description + target concept names)
        - optional start/end timestamps (for future audio support)

    Returns a list of dicts:
    [
      {
        "segment_index": 0,
        "text": "...",
        "summary": "...",
        "style_tags": [...],
        "start_time_sec": null,
        "end_time_sec": null,
        "covered_concepts": ["IDE", "Compiler"],
        "analogies": [
          {
            "label": "DJ reading the crowd",
            "description": "...",
            "target_concepts": ["Recommender Systems", "User Behavior Modeling"]
          }
        ]
      },
      ...
    ]
    """
    if not client:
        # Return a single segment stub if LLM is not available
        print("[Segment Extraction] OpenAI client not available, returning stub")
        return [{
            "segment_index": 0,
            "text": lecture_text,
            "summary": None,
            "style_tags": [],
            "start_time_sec": None,
            "end_time_sec": None,
            "covered_concepts": [],
            "analogies": [],
        }]
    
    # Build the user prompt
    concept_hint = ""
    if available_concepts:
        concept_hint = f"\n\nIMPORTANT: When listing covered_concepts, use EXACT names from this list (case-insensitive match):\n{', '.join(available_concepts[:50])}"  # Limit to first 50 to avoid token bloat
        if len(available_concepts) > 50:
            concept_hint += f"\n(and {len(available_concepts) - 50} more concepts...)"
        concept_hint += "\nIf a concept is mentioned but not in this list, still include it but it may not link properly."
    
    user_prompt = f"""Lecture Title: {lecture_title}

Domain: {domain or "Not specified"}

Lecture Text:
{lecture_text}{concept_hint}

Break this lecture into segments and extract concepts and analogies. Return the JSON as specified."""
    
    try:
        print(f"[Segment Extraction] Calling LLM to segment lecture: {lecture_title}")
        response = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {"role": "system", "content": LECTURE_SEGMENTATION_PROMPT},
                {"role": "user", "content": user_prompt},
            ],
            temperature=0.3,  # Lower temperature for more consistent extraction
            max_tokens=8000,  # Increased for longer lectures with many segments
        )
    except Exception as api_error:
        error_str = str(api_error)
        print(f"[Segment Extraction] ERROR: Failed to call LLM: {error_str}")
        # Fall back to stub
        return [{
            "segment_index": 0,
            "text": lecture_text,
            "summary": None,
            "style_tags": [],
            "start_time_sec": None,
            "end_time_sec": None,
            "covered_concepts": [],
            "analogies": [],
        }]
    
    # Process the response
    try:
        # Check if response is valid
        if not response or not response.choices or len(response.choices) == 0:
            raise ValueError("LLM returned empty response (no choices)")
        
        message = response.choices[0].message
        if not message or not message.content:
            raise ValueError("LLM returned empty response (no content)")
        
        content = message.content.strip()
        if not content:
            raise ValueError("LLM returned empty content")
        
        # Try to extract JSON from the response (sometimes LLM adds markdown code blocks)
        json_match = re.search(r'\{.*\}', content, re.DOTALL)
        if json_match:
            content = json_match.group(0)
        
        # Parse JSON with recovery for truncated responses
        try:
            data = json.loads(content)
        except json.JSONDecodeError as e:
            print(f"[Segment Extraction] ERROR: Failed to parse LLM response as JSON: {e}")
            print(f"[Segment Extraction] Response length: {len(content)} chars")
            print(f"[Segment Extraction] Response content (first 1000 chars): {content[:1000]}...")
            
            # Try to recover partial segments from truncated JSON
            # Look for complete segment objects before the truncation
            try:
                # Find the segments array start
                segments_start = content.find('"segments": [')
                if segments_start != -1:
                    # Try to extract complete segments by finding }, patterns
                    # This is a best-effort recovery
                    segments_text = content[segments_start:]
                    
                    # Use regex to find all complete segment objects
                    # Pattern: { ... } where braces are balanced
                    segment_pattern = r'\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}'
                    matches = re.findall(segment_pattern, segments_text, re.DOTALL)
                    
                    recovered_segments = []
                    for match in matches:
                        try:
                            seg_obj = json.loads(match)
                            if isinstance(seg_obj, dict) and 'segment_index' in seg_obj:
                                recovered_segments.append(seg_obj)
                        except:
                            continue
                    
                    if recovered_segments:
                        print(f"[Segment Extraction] Recovered {len(recovered_segments)} complete segments from truncated response")
                        data = {"segments": recovered_segments}
                    else:
                        raise ValueError(f"LLM returned invalid JSON (likely truncated at max_tokens): {e}")
                else:
                    raise ValueError(f"LLM returned invalid JSON: {e}")
            except Exception as recovery_error:
                # Recovery failed, raise original error
                raise ValueError(f"LLM returned invalid JSON: {e}")
        
        # Validate structure
        if "segments" not in data:
            raise ValueError("LLM response missing 'segments' key")
        
        segments_raw = data["segments"]
        if not isinstance(segments_raw, list):
            raise ValueError("LLM response 'segments' is not a list")
        
        # Validate and normalize each segment
        segments_normalized = []
        for i, seg in enumerate(segments_raw):
            # Ensure required fields
            normalized_seg = {
                "segment_index": seg.get("segment_index", i),
                "text": seg.get("text", ""),
                "summary": seg.get("summary"),
                "style_tags": seg.get("style_tags", []),
                "start_time_sec": seg.get("start_time_sec"),
                "end_time_sec": seg.get("end_time_sec"),
                "covered_concepts": seg.get("covered_concepts", []),
                "analogies": seg.get("analogies", []),
            }
            
            # Ensure analogies have required fields
            normalized_analogies = []
            for an in normalized_seg["analogies"]:
                if isinstance(an, dict):
                    normalized_analogies.append({
                        "label": an.get("label", ""),
                        "description": an.get("description"),
                        "target_concepts": an.get("target_concepts", []),
                    })
            normalized_seg["analogies"] = normalized_analogies
            
            segments_normalized.append(normalized_seg)
        
        print(f"[Segment Extraction] Successfully extracted {len(segments_normalized)} segments")
        return segments_normalized
        
    except Exception as e:
        print(f"[Segment Extraction] ERROR: Failed to process LLM response: {e}")
        print(f"[Segment Extraction] Falling back to stub segment")
        # Fall back to stub on any error
        return [{
            "segment_index": 0,
            "text": lecture_text,
            "summary": None,
            "style_tags": [],
            "start_time_sec": None,
            "end_time_sec": None,
            "covered_concepts": [],
            "analogies": [],
        }]


def call_llm_for_extraction(lecture_title: str, lecture_text: str, domain: Optional[str]) -> LectureExtraction:
    """
    Call OpenAI LLM to extract nodes and links from lecture text.
    Returns a validated LectureExtraction object.
    """
    if not client:
        raise ValueError("OpenAI client not initialized. Check OPENAI_API_KEY environment variable.")
    
    # Build the user prompt
    user_prompt = f"""Lecture Title: {lecture_title}
    
Domain: {domain or "Not specified"}

Lecture Text:
{lecture_text}

Extract the concepts and relationships from this lecture and return them as JSON."""

    try:
        response = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {"role": "system", "content": LECTURE_TO_GRAPH_PROMPT},
                {"role": "user", "content": user_prompt},
            ],
            temperature=0.3,  # Lower temperature for more consistent extraction
            max_tokens=8000,  # Increased for longer lectures with many segments
        )
    except Exception as api_error:
        error_str = str(api_error)
        if "invalid_api_key" in error_str.lower() or "401" in error_str or "incorrect api key" in error_str.lower():
            # Provide helpful error message
            key_preview = OPENAI_API_KEY[:10] + "..." if OPENAI_API_KEY and len(OPENAI_API_KEY) > 10 else "not set"
            raise ValueError(
                f"Invalid OpenAI API key (starts with: {key_preview}). "
                f"Please check your OPENAI_API_KEY in .env.local (repo root) or backend/.env. "
                f"Get a valid key from https://platform.openai.com/api-keys. "
                f"Make sure the key is on a single line with no quotes or extra spaces."
            )
        raise
    
    # Process the response (only reached if API call succeeded)
    try:
        # Check if response is valid
        if not response or not response.choices or len(response.choices) == 0:
            raise ValueError("LLM returned empty response (no choices)")
        
        message = response.choices[0].message
        if not message or not message.content:
            raise ValueError("LLM returned empty response (no content)")
        
        content = message.content.strip()
        if not content:
            raise ValueError("LLM returned empty content")
        
        # Try to extract JSON from the response (sometimes LLM adds markdown code blocks)
        json_match = re.search(r'\{.*\}', content, re.DOTALL)
        if json_match:
            content = json_match.group(0)
        
        # Parse JSON
        try:
            data = json.loads(content)
        except json.JSONDecodeError as e:
            print(f"ERROR: Failed to parse LLM response as JSON: {e}")
            print(f"Response content: {content[:500]}...")
            raise ValueError(f"LLM returned invalid JSON: {e}")
        
        # Validate and create LectureExtraction
        try:
            extraction = LectureExtraction(**data)
        except Exception as e:
            print(f"ERROR: Failed to create LectureExtraction from data: {e}")
            print(f"Data keys: {list(data.keys()) if isinstance(data, dict) else 'not a dict'}")
            print(f"Data preview: {str(data)[:500]}...")
            raise ValueError(f"LLM returned data that doesn't match expected schema: {e}")
        
        # Ensure lecture_title matches
        extraction.lecture_title = lecture_title
        
        # Set domain on nodes if provided
        if domain and extraction.nodes:
            for node in extraction.nodes:
                if not node.domain:
                    node.domain = domain
        
        return extraction
        
    except Exception as e:
        print(f"ERROR: Failed to process LLM response: {e}")
        raise


def run_lecture_extraction_engine(
    session: Session,
    lecture_title: str,
    lecture_text: str,
    domain: Optional[str],
    run_id: str,
    lecture_id: str,
) -> Dict[str, Any]:
    """
    Extract concepts and relationships from lecture text using LLM.
    
    Args:
        session: Neo4j session
        lecture_title: Title of the lecture
        lecture_text: Full text of the lecture
        domain: Optional domain hint
        run_id: Ingestion run ID
        lecture_id: Lecture ID
    
    Returns:
        Dict with nodes_created, nodes_updated, links_created, node_name_to_id,
        concepts_created, concepts_updated, relationships_proposed, errors
    """
    # Track counts for run summary
    concepts_created = 0
    concepts_updated = 0
    relationships_proposed = 0
    errors = []
    
    # Step 1: Call LLM for extraction
    print(f"[Lecture Ingestion] Calling LLM to extract concepts from lecture: {lecture_title}")
    extraction = call_llm_for_extraction(lecture_title, lecture_text, domain)
    
    # Validate extraction result
    if not extraction:
        raise ValueError("LLM extraction returned None - this should not happen")
    if not hasattr(extraction, 'nodes') or extraction.nodes is None:
        raise ValueError("LLM extraction returned invalid result: missing 'nodes' attribute")
    if not hasattr(extraction, 'links') or extraction.links is None:
        raise ValueError("LLM extraction returned invalid result: missing 'links' attribute")
    
    print(f"[Lecture Ingestion] Extracted {len(extraction.nodes)} nodes and {len(extraction.links)} links")
    
    # Step 2: Upsert nodes
    nodes_created = []
    nodes_updated = []
    node_name_to_id = {}  # Map from extracted name to node_id
    
    for extracted_node in extraction.nodes:
        # Normalize name for lookup
        normalized_name = normalize_name(extracted_node.name)
        
        # Check if node exists
        existing = find_concept_by_name_and_domain(
            session, extracted_node.name, extracted_node.domain
        )
        
        if existing:
            # Update existing node
            print(f"[Lecture Ingestion] Updating existing node: {extracted_node.name}")
            
            # Update description if better
            updated = update_concept_description_if_better(
                session, existing, extracted_node.description
            )
            
            # Merge tags
            if extracted_node.tags:
                updated = update_concept_tags(session, updated, extracted_node.tags)
            
            # Update multi-source tracking
            # Append lecture_id to lecture_sources if not already present
            current_sources = updated.lecture_sources or []
            if lecture_id not in current_sources:
                current_sources = current_sources + [lecture_id]
            
            # Keep created_by as the earliest source (don't overwrite if already set)
            created_by = updated.created_by
            if not created_by and current_sources:
                created_by = current_sources[0]
            
            # Set last_updated_by to the current lecture_id
            last_updated_by = lecture_id
            
            # Update lecture_key for backward compatibility and run_id
            query = """
            MATCH (c:Concept {node_id: $node_id})
            SET c.lecture_key = $lecture_key,
                c.lecture_sources = $lecture_sources,
                c.created_by = COALESCE(c.created_by, $created_by),
                c.last_updated_by = $last_updated_by,
                c.last_updated_by_run_id = $last_updated_by_run_id
            RETURN c.node_id AS node_id,
                   c.name AS name,
                   c.domain AS domain,
                   c.type AS type,
                   c.description AS description,
                   c.tags AS tags,
                   c.notes_key AS notes_key,
                   c.lecture_key AS lecture_key,
                   c.url_slug AS url_slug,
                   COALESCE(c.lecture_sources, []) AS lecture_sources,
                   c.created_by AS created_by,
                   c.last_updated_by AS last_updated_by,
                   c.created_by_run_id AS created_by_run_id,
                   c.last_updated_by_run_id AS last_updated_by_run_id
            """
            result = session.run(
                query,
                node_id=updated.node_id,
                lecture_key=lecture_id,
                lecture_sources=current_sources,
                created_by=created_by,
                last_updated_by=last_updated_by,
                last_updated_by_run_id=run_id
            )
            record = result.single()
            if record:
                from services_graph import _normalize_concept_from_db
                updated = _normalize_concept_from_db(record.data())
            
            nodes_updated.append(updated)
            concepts_updated += 1
            node_name_to_id[normalized_name] = updated.node_id
        else:
            # Create new node
            print(f"[Lecture Ingestion] Creating new node: {extracted_node.name}")
            
            concept_payload = ConceptCreate(
                name=extracted_node.name,
                domain=extracted_node.domain or domain or "General",
                type=extracted_node.type or "concept",
                description=extracted_node.description,
                tags=extracted_node.tags or [],
                lecture_key=lecture_id,  # For backward compatibility
                lecture_sources=[lecture_id],
                created_by=lecture_id,
                last_updated_by=lecture_id,
                created_by_run_id=run_id,
            )
            
            new_concept = create_concept(session, concept_payload)
            nodes_created.append(new_concept)
            concepts_created += 1
            node_name_to_id[normalized_name] = new_concept.node_id
    
    # Step 3: Create relationships
    links_created = []
    
    for extracted_link in extraction.links:
        # Skip low-confidence links
        if extracted_link.confidence < 0.5:
            print(f"[Lecture Ingestion] Skipping low-confidence link: {extracted_link.source_name} -> {extracted_link.target_name} (confidence: {extracted_link.confidence})")
            continue
        
        source_normalized = normalize_name(extracted_link.source_name)
        target_normalized = normalize_name(extracted_link.target_name)
        
        source_id = node_name_to_id.get(source_normalized)
        target_id = node_name_to_id.get(target_normalized)
        
        if not source_id:
            print(f"[Lecture Ingestion] WARNING: Source node not found: {extracted_link.source_name}")
            continue
        if not target_id:
            print(f"[Lecture Ingestion] WARNING: Target node not found: {extracted_link.target_name}")
            continue
        
        # Create relationship by IDs with PROPOSED status and metadata
        # Auto-accept only if confidence is very high (>=0.9) AND relationship type is in allowlist
        high_confidence_allowlist = ["DEPENDS_ON", "PREREQUISITE_FOR", "RELATED_TO"]
        should_auto_accept = (
            extracted_link.confidence >= 0.9
            and extracted_link.predicate in high_confidence_allowlist
        )
        
        relationship_status = "ACCEPTED" if should_auto_accept else "PROPOSED"
        
        try:
            create_relationship_by_ids(
                session=session,
                source_id=source_id,
                target_id=target_id,
                predicate=extracted_link.predicate,
                status=relationship_status,
                confidence=extracted_link.confidence,
                method="llm",
                source_id_meta=lecture_id,
                rationale=extracted_link.explanation,
                ingestion_run_id=run_id,
            )
            links_created.append({
                "source_id": source_id,
                "target_id": target_id,
                "predicate": extracted_link.predicate,
                "status": relationship_status,
            })
            if relationship_status == "PROPOSED":
                relationships_proposed += 1
            print(f"[Lecture Ingestion] Created link ({relationship_status}): {extracted_link.source_name} -[{extracted_link.predicate}]-> {extracted_link.target_name} (confidence: {extracted_link.confidence})")
        except Exception as e:
            error_msg = f"Failed to create link {extracted_link.source_name} -> {extracted_link.target_name}: {e}"
            errors.append(error_msg)
            print(f"[Lecture Ingestion] ERROR: {error_msg}")
    
    print(f"[Lecture Ingestion] Completed: {len(nodes_created)} created, {len(nodes_updated)} updated, {len(links_created)} links created")
    
    return {
        "nodes_created": nodes_created,
        "nodes_updated": nodes_updated,
        "links_created": links_created,
        "node_name_to_id": node_name_to_id,
        "concepts_created": concepts_created,
        "concepts_updated": concepts_updated,
        "relationships_proposed": relationships_proposed,
        "errors": errors,
        "extraction": extraction,  # Store extraction for status calculation
    }


def run_chunk_and_claims_engine(
    session: Session,
    source_id: str,
    source_label: str,
    domain: Optional[str],
    text: str,
    run_id: str,
    known_concepts: List[Concept],
    include_existing_concepts: bool = True,
) -> Dict[str, Any]:
    """
    Chunk text and extract claims from chunks.
    
    Args:
        session: Neo4j session
        source_id: Source identifier (e.g., lecture_id)
        source_label: Source label (e.g., lecture_title)
        domain: Optional domain hint
        text: Full text to chunk
        run_id: Ingestion run ID
        known_concepts: List of Concept objects from current ingestion
        include_existing_concepts: Whether to include existing concepts in mention resolution
    
    Returns:
        Dict with chunks_created, claims_created, chunk_ids, claim_ids, errors
    """
    errors = []
    chunks_created = 0
    claims_created = 0
    chunk_ids = []
    claim_ids = []
    
    print(f"[Lecture Ingestion] Creating chunks and extracting claims")
    ensure_graph_scoping_initialized(session)
    graph_id, branch_id = get_active_graph_context(session)
    
    # Chunk the text
    chunks = chunk_text(text, max_chars=1200, overlap=150)
    print(f"[Lecture Ingestion] Created {len(chunks)} chunks")
    
    # Build concept lookup map for claim extraction
    known_concepts_dict = [
        {"name": c.name, "node_id": c.node_id, "description": c.description}
        for c in known_concepts
    ]
    
    # Also include existing concepts in the graph for mention resolution
    existing_concept_map = {}
    if include_existing_concepts:
        from services_graph import get_all_concepts
        existing_concepts = get_all_concepts(session)
        existing_concept_map = {normalize_name(c.name): c.node_id for c in existing_concepts}
    
    for chunk in chunks:
        chunk_id = f"CHUNK_{uuid4().hex[:8].upper()}"
        
        # Create SourceChunk
        metadata = {
            "lecture_id": source_id,
            "lecture_title": source_label,
            "domain": domain,
        }
        try:
            upsert_source_chunk(
                session=session,
                graph_id=graph_id,
                branch_id=branch_id,
                chunk_id=chunk_id,
                source_id=source_id,
                chunk_index=chunk["index"],
                text=chunk["text"],
                metadata=metadata
            )
            chunks_created += 1
            chunk_ids.append(chunk_id)
        except Exception as e:
            error_msg = f"Failed to create SourceChunk {chunk_id}: {e}"
            errors.append(error_msg)
            print(f"[Lecture Ingestion] ERROR: {error_msg}")
            continue
        
        # Extract claims from chunk
        claims = extract_claims_from_chunk(chunk["text"], known_concepts_dict)
        
        for claim_data in claims:
            # Create deterministic claim_id
            normalized_claim_text = normalize_claim_text(claim_data["claim_text"])
            claim_id_hash = hashlib.sha256(
                f"{graph_id}{source_id}{normalized_claim_text}".encode()
            ).hexdigest()[:16]
            claim_id = f"CLAIM_{claim_id_hash.upper()}"
            
            # Resolve mentioned concept names to node_ids
            mentioned_node_ids = []
            for concept_name in claim_data.get("mentioned_concept_names", []):
                normalized_concept_name = normalize_name(concept_name)
                # First try current ingestion concepts
                found_id = None
                for c in known_concepts:
                    if normalize_name(c.name) == normalized_concept_name:
                        found_id = c.node_id
                        break
                # Fallback to existing concepts
                if not found_id and include_existing_concepts:
                    found_id = existing_concept_map.get(normalized_concept_name)
                
                if found_id:
                    mentioned_node_ids.append(found_id)
            
            # Compute claim embedding
            try:
                claim_embedding = embed_text(claim_data["claim_text"])
            except Exception as e:
                print(f"[Lecture Ingestion] WARNING: Failed to embed claim, continuing without embedding: {e}")
                claim_embedding = None
            
            # Create Claim
            try:
                upsert_claim(
                    session=session,
                    graph_id=graph_id,
                    branch_id=branch_id,
                    claim_id=claim_id,
                    text=claim_data["claim_text"],
                    confidence=claim_data["confidence"],
                    method="llm",
                    source_id=source_id,
                    source_span=claim_data.get("source_span", f"chunk {chunk['index']}"),
                    chunk_id=chunk_id,
                    embedding=claim_embedding,
                    ingestion_run_id=run_id,
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
                claim_ids.append(claim_id)
            except Exception as e:
                error_msg = f"Failed to create Claim {claim_id}: {e}"
                errors.append(error_msg)
                print(f"[Lecture Ingestion] ERROR: {error_msg}")
                continue
    
    print(f"[Lecture Ingestion] Created {claims_created} claims from {len(chunks)} chunks")
    
    return {
        "chunks_created": chunks_created,
        "claims_created": claims_created,
        "chunk_ids": chunk_ids,
        "claim_ids": claim_ids,
        "errors": errors,
    }


def run_segments_and_analogies_engine(
    session: Session,
    lecture_id: str,
    lecture_title: str,
    lecture_text: str,
    domain: Optional[str],
    node_name_to_id: Dict[str, str],
    nodes_created: List[Concept],
    nodes_updated: List[Concept],
) -> List[LectureSegment]:
    """
    Extract segments and analogies from lecture text.
    
    Args:
        session: Neo4j session
        lecture_id: Lecture ID
        lecture_title: Title of the lecture
        lecture_text: Full text of the lecture
        domain: Optional domain hint
        node_name_to_id: Map from normalized concept name to node_id
        nodes_created: List of created Concept objects
        nodes_updated: List of updated Concept objects
    
    Returns:
        List of LectureSegment objects
    """
    print(f"[Lecture Ingestion] Extracting segments and analogies")
    
    # Build list of concept names that were actually created/updated for the LLM
    available_concept_names = [normalize_name(nc.name) for nc in nodes_created] + [normalize_name(nu.name) for nu in nodes_updated]
    
    segments_raw = extract_segments_and_analogies_with_llm(
        lecture_title=lecture_title,
        lecture_text=lecture_text,
        domain=domain,
        available_concepts=available_concept_names,  # Pass available concepts to help LLM match correctly
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
        )
        segment_id = seg_db["segment_id"]
        
        # Resolve covered concepts by name (best-effort)
        covered_concept_models: List[Concept] = []
        for concept_name in seg.get("covered_concepts", []):
            # First, try to match using the concepts we just created/updated in this ingestion
            normalized_concept_name = normalize_name(concept_name)
            concept_id = node_name_to_id.get(normalized_concept_name)
            
            if concept_id:
                # Found in current ingestion - get the concept object
                # Find it in nodes_created or nodes_updated
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
                    )
                    continue
            
            # Fallback: try to find existing concept by name in database (without domain restriction first)
            existing_concept = find_concept_by_name_and_domain(
                session=session,
                name=concept_name,
                domain=domain,
            )
            if existing_concept:
                covered_concept_models.append(existing_concept)
                link_segment_to_concept(
                    session=session,
                    segment_id=segment_id,
                    concept_id=existing_concept.node_id,
                )
            else:
                # Try without domain restriction for fuzzy matching
                existing_concept_any_domain = find_concept_by_name_and_domain(
                    session=session,
                    name=concept_name,
                    domain=None,  # Search across all domains
                )
                if existing_concept_any_domain:
                    covered_concept_models.append(existing_concept_any_domain)
                    link_segment_to_concept(
                        session=session,
                        segment_id=segment_id,
                        concept_id=existing_concept_any_domain.node_id,
                    )
                else:
                    # Concept might not exist yet, but we'll link if it does
                    # This handles cases where segment extraction references concepts
                    # that weren't in the main extraction
                    # This is expected behavior - segments may reference concepts that don't exist yet
                    print(f"[Lecture Ingestion] Segment references concept '{concept_name}' that wasn't found (this is OK - concept may be created later)")
        
        # Create / link analogies
        analogy_models: List[Analogy] = []
        for an in seg.get("analogies", []):
            analogy_db = get_or_create_analogy(
                session=session,
                label=an["label"],
                description=an.get("description"),
                tags=[domain] if domain else [],
            )
            analogy_models.append(Analogy(**analogy_db))
            link_segment_to_analogy(
                session=session,
                segment_id=segment_id,
                analogy_id=analogy_db["analogy_id"],
            )
            # OPTIONAL: later, we can also relate Analogy -> Concept here
        
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


def ingest_lecture(
    session: Session,
    lecture_title: str,
    lecture_text: str,
    domain: Optional[str],
    existing_lecture_id: Optional[str] = None,
) -> LectureIngestResult:
    """
    Main function to ingest a lecture:
    1. Create ingestion run
    2. Call extraction engine to extract nodes and links
    3. Call chunk and claims engine to extract claims
    4. Create/verify Lecture node (if existing_lecture_id provided, uses existing)
    5. Call segments and analogies engine
    6. Update run status
    7. Return results
    
    Args:
        session: Neo4j session
        lecture_title: Title of the lecture
        lecture_text: Full text of the lecture
        domain: Optional domain hint
        existing_lecture_id: Optional lecture_id if lecture already exists (for save-first approach)
    
    Returns:
        LectureIngestResult with created/updated nodes and links
    """
    # Create ingestion run
    ingestion_run = create_ingestion_run(
        session=session,
        source_type="LECTURE",
        source_label=lecture_title,
    )
    run_id = ingestion_run.run_id
    
    # Use existing lecture_id if provided, otherwise generate new one
    lecture_id = existing_lecture_id or f"LECTURE_{uuid4().hex[:8].upper()}"
    
    # Step 1: Run extraction engine
    extraction_result = run_lecture_extraction_engine(
        session=session,
        lecture_title=lecture_title,
        lecture_text=lecture_text,
        domain=domain,
        run_id=run_id,
        lecture_id=lecture_id,
    )
    
    nodes_created = extraction_result["nodes_created"]
    nodes_updated = extraction_result["nodes_updated"]
    links_created = extraction_result["links_created"]
    node_name_to_id = extraction_result["node_name_to_id"]
    concepts_created = extraction_result["concepts_created"]
    concepts_updated = extraction_result["concepts_updated"]
    relationships_proposed = extraction_result["relationships_proposed"]
    errors = extraction_result["errors"]
    
    # Step 2: Run chunk and claims engine
    all_concepts = nodes_created + nodes_updated
    chunk_claims_result = run_chunk_and_claims_engine(
        session=session,
        source_id=lecture_id,
        source_label=lecture_title,
        domain=domain,
        text=lecture_text,
        run_id=run_id,
        known_concepts=all_concepts,
        include_existing_concepts=True,
    )
    
    # Merge errors from chunk/claims engine
    errors.extend(chunk_claims_result["errors"])
    
    # Step 3: Create/Update Lecture node (only if it doesn't exist)
    if existing_lecture_id:
        print(f"[Lecture Ingestion] Using existing Lecture node: {lecture_id}")
        # Just verify it exists
        query = """
        MATCH (l:Lecture {lecture_id: $lecture_id})
        RETURN l.lecture_id AS lecture_id
        """
        result = session.run(query, lecture_id=lecture_id)
        if not result.single():
            raise ValueError(f"Lecture {lecture_id} not found - cannot process AI for non-existent lecture")
    else:
        print(f"[Lecture Ingestion] Creating Lecture node: {lecture_id}")
        query = """
        MERGE (l:Lecture {lecture_id: $lecture_id})
        ON CREATE SET l.title = $title,
                      l.description = $description,
                      l.primary_concept = $primary_concept,
                      l.level = $level,
                      l.estimated_time = $estimated_time,
                      l.slug = $slug
        RETURN l.lecture_id AS lecture_id
        """
        session.run(
            query,
            lecture_id=lecture_id,
            title=lecture_title,
            description=None,
            primary_concept=None,
            level=None,
            estimated_time=None,
            slug=None,
        )
    
    # Step 4: Run segments and analogies engine
    segments_models = run_segments_and_analogies_engine(
        session=session,
        lecture_id=lecture_id,
        lecture_title=lecture_title,
        lecture_text=lecture_text,
        domain=domain,
        node_name_to_id=node_name_to_id,
        nodes_created=nodes_created,
        nodes_updated=nodes_updated,
    )
    
    # Step 5: Update ingestion run status
    extraction = extraction_result["extraction"]
    links_count = len(extraction.links) if extraction and extraction.links else 0
    status = "COMPLETED" if len(errors) == 0 else "PARTIAL" if len(errors) < links_count else "FAILED"
    update_ingestion_run_status(
        session=session,
        run_id=run_id,
        status=status,
        summary_counts={
            "concepts_created": concepts_created,
            "concepts_updated": concepts_updated,
            "relationships_proposed": relationships_proposed,
        },
        error_count=len(errors) if errors else None,
        errors=errors if errors else None,
    )
    
    # Extract enrichment fields
    created_concept_ids = [concept.node_id for concept in nodes_created]
    updated_concept_ids = [concept.node_id for concept in nodes_updated]
    created_relationship_count = len(links_created)
    created_claim_ids = chunk_claims_result.get("claim_ids", [])
    
    return LectureIngestResult(
        lecture_id=lecture_id,
        nodes_created=nodes_created,
        nodes_updated=nodes_updated,
        links_created=links_created,
        segments=segments_models,
        run_id=run_id,
        created_concept_ids=created_concept_ids,
        updated_concept_ids=updated_concept_ids,
        created_relationship_count=created_relationship_count,
        created_claim_ids=created_claim_ids,
    )
