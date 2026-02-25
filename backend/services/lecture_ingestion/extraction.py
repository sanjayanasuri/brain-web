"""
LLM extraction: segments/analogies, lecture-to-graph, structure processing, run_lecture_extraction_engine.
"""
import json
import re
import logging
from typing import Optional, List, Dict, Any, Callable

from neo4j import Session

from models import (
    LectureExtraction,
    ExtractedNode,
    ExtractedLink,
    ConceptCreate,
    HierarchicalTopic,
)
from services_graph import (
    create_concept,
    create_relationship_by_ids,
)
from services.graph.concepts import _normalize_concept_from_db
from prompts import LECTURE_TO_GRAPH_PROMPT, LECTURE_SEGMENTATION_PROMPT
from config import OPENAI_API_KEY
from services_model_router import model_router, TASK_EXTRACT

from .chunking import normalize_name
from . import concept_utils
find_concept_by_name_and_domain = concept_utils.find_concept_by_name_and_domain
update_concept_description_if_better = concept_utils.update_concept_description_if_better
update_concept_tags = concept_utils.update_concept_tags

logger = logging.getLogger("brain_web")


def _determine_extraction_type(node_type: str, name: str) -> str:
    """
    Determine extraction type (concept, name, date) based on node type and name.
    
    Args:
        node_type: The type field from the extracted node
        name: The name of the extracted node
        
    Returns:
        'concept', 'name', or 'date'
    """
    node_type_lower = node_type.lower() if node_type else ""
    name_lower = name.lower() if name else ""
    
    # Check for date patterns
    date_patterns = [
        r'\b\d{1,2}[/-]\d{1,2}[/-]\d{2,4}\b',  # MM/DD/YYYY or MM-DD-YYYY
        r'\b\d{4}[/-]\d{1,2}[/-]\d{1,2}\b',    # YYYY/MM/DD or YYYY-MM-DD
        r'\b(january|february|march|april|may|june|july|august|september|october|november|december)\s+\d{1,2},?\s+\d{4}\b',
        r'\b\d{1,2}\s+(january|february|march|april|may|june|july|august|september|october|november|december),?\s+\d{4}\b',
    ]
    
    for pattern in date_patterns:
        if re.search(pattern, name_lower):
            return "date"
    
    # Check node type for person/name indicators
    if node_type_lower in ["person", "name", "people", "individual", "author", "researcher"]:
        return "name"
    
    # Check if name looks like a person name (two capitalized words)
    if re.match(r'^[A-Z][a-z]+\s+[A-Z][a-z]+', name):
        # Could be a person name, but also could be a concept
        # Only classify as name if node type suggests it
        if node_type_lower in ["person", "name", "people"]:
            return "name"
    
    # Default to concept
    return "concept"

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
    if not model_router.client:
        logger.warning("[lecture_ingestion] OpenAI client not available — returning stub segment")
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
        concept_hint = f"\n\nIMPORTANT: When listing covered_concepts, use EXACT names from this list (case-insensitive match):\n{', '.join(available_concepts[:200])}"
        if len(available_concepts) > 200:
            concept_hint += f"\n(and {len(available_concepts) - 200} more concepts...)"
        concept_hint += "\nIf a concept is mentioned but not in this list, still include it but it may not link properly."

    user_prompt = f"""Lecture Title: {lecture_title}

Domain: {domain or 'Not specified'}

Lecture Text:
{lecture_text}{concept_hint}

Break this lecture into segments and extract concepts and analogies. Return the JSON as specified."""

    try:
        logger.info(f"[lecture_ingestion] Segmenting lecture: {lecture_title}")
        raw_content = model_router.completion(
            task_type=TASK_EXTRACT,
            messages=[
                {"role": "system", "content": LECTURE_SEGMENTATION_PROMPT},
                {"role": "user", "content": user_prompt},
            ],
            temperature=0.3,
            max_tokens=8000,
        )
        # Wrap into a fake response object shape that the parsing code below expects
        class _FakeMsg:
            content = raw_content
        class _FakeChoice:
            message = _FakeMsg()
        class _FakeResp:
            choices = [_FakeChoice()]
        response = _FakeResp()
    except Exception as api_error:
        error_str = str(api_error)
        logger.error(f"[lecture_ingestion] Segment extraction LLM call failed: {error_str}")
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
    if not model_router.client:
        raise ValueError("OpenAI client not initialized. Check OPENAI_API_KEY environment variable.")

    # Build the user prompt
    user_prompt = f"""Lecture Title: {lecture_title}

Domain: {domain or 'Not specified'}

Lecture Text:
{lecture_text}

Extract the concepts and relationships from this lecture and return them as JSON."""

    try:
        raw_content = model_router.completion(
            task_type=TASK_EXTRACT,
            messages=[
                {"role": "system", "content": LECTURE_TO_GRAPH_PROMPT},
                {"role": "user", "content": user_prompt},
            ],
            temperature=0.3,
            max_tokens=8000,
        )
        class _FakeMsg:
            content = raw_content
        class _FakeChoice:
            message = _FakeMsg()
        class _FakeResp:
            choices = [_FakeChoice()]
        response = _FakeResp()
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


def _process_structure_recursive(
    session: Session,
    topic: HierarchicalTopic,
    parent_id: Optional[str],
    lecture_id: str,
    run_id: str,
    node_name_to_id: Dict[str, str],
    domain: Optional[str]
) -> None:
    """Recursively create topic nodes and link them."""
    
    # 1. Create/Get Topic Node
    topic_name_normalized = normalize_name(topic.name)
    existing_topic = find_concept_by_name_and_domain(session, topic.name, domain)
    
    topic_id = None
    
    if existing_topic:
        topic_id = existing_topic.node_id
        # Ensure it's marked as a topic if not already? (Optional)
    else:
        # Create new Topic Concept
        topic_payload = ConceptCreate(
            name=topic.name,
            domain=domain or "Structure",
            type="topic",
            description=f"Topic from lecture",
            tags=["Structure"],
            lecture_key=lecture_id,
            lecture_sources=[lecture_id],
            created_by_run_id=run_id
        )
        new_topic = create_concept(session, topic_payload)
        topic_id = new_topic.node_id
        
    # 2. Link Parent -> Topic (CONTAINS)
    if parent_id and topic_id:
        create_relationship_by_ids(
            session=session,
            source_id=parent_id,
            target_id=topic_id,
            predicate="CONTAINS",
            confidence=1.0,
            method="structure_extraction",
            ingestion_run_id=run_id
        )
        
    # 3. Link Topic -> Concepts (CONTAINS)
    for concept_name in topic.concepts:
        c_norm = normalize_name(concept_name)
        c_id = node_name_to_id.get(c_norm)
        
        # If not found in current ingestion, try DB lookup
        if not c_id:
             existing_c = find_concept_by_name_and_domain(session, concept_name, domain)
             if existing_c:
                 c_id = existing_c.node_id
        
        if c_id and topic_id:
             create_relationship_by_ids(
                session=session,
                source_id=topic_id,
                target_id=c_id,
                predicate="CONTAINS", # Topic CONTAINS Concept
                confidence=1.0,
                method="structure_extraction",
                ingestion_run_id=run_id
            )
            
    # 4. Recurse for Subtopics
    for subtopic in topic.subtopics:
        _process_structure_recursive(
            session, subtopic, topic_id, lecture_id, run_id, node_name_to_id, domain
        )


def process_structure(
    session: Session,
    extraction: LectureExtraction,
    lecture_id: str,
    run_id: str,
    node_name_to_id: Dict[str, str],
    domain: Optional[str]
) -> None:
    """Process the hierarchical structure (AST) if present."""
    if not extraction.structure:
        return

    print(f"[Lecture Ingestion] Processing {len(extraction.structure)} root topics from structure...")
    
    for root_topic in extraction.structure:
        _process_structure_recursive(
            session, root_topic, None, lecture_id, run_id, node_name_to_id, domain
        ) 


def run_lecture_extraction_engine(
    session: Session,
    lecture_title: str,
    lecture_text: str,
    domain: Optional[str],
    run_id: str,
    lecture_id: str,
    event_callback: Optional[Callable[[str, Dict[str, Any]], None]] = None,
    tenant_id: Optional[str] = None,
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
        event_callback: Optional callback function(event_type, event_data) for real-time events
        tenant_id: Optional tenant_id for multi-tenant isolation
    
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
            session, extracted_node.name, extracted_node.domain, tenant_id=tenant_id
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
                c.last_updated_by_run_id = $last_updated_by_run_id,
                c.aliases = REDUCE(s = COALESCE(c.aliases, []), x IN $new_aliases | CASE WHEN x IN s THEN s ELSE s + x END)
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
                last_updated_by_run_id=run_id,
                new_aliases=extracted_node.aliases or []
            )
            record = result.single()
            if record:
                updated = _normalize_concept_from_db(record.data())
            
            nodes_updated.append(updated)
            concepts_updated += 1
            node_name_to_id[normalized_name] = updated.node_id
            
            # Emit extraction event
            if event_callback:
                node_type = extracted_node.type or "concept"
                # Determine extraction type based on node type
                extraction_type = _determine_extraction_type(node_type, extracted_node.name)
                event_callback("extraction", {
                    "type": extraction_type,
                    "name": extracted_node.name,
                    "node_type": node_type,
                    "action": "updated",
                    "description": extracted_node.description,
                })
        else:
            # Create new node
            print(f"[Lecture Ingestion] Creating new node: {extracted_node.name}")
            
            concept_payload = ConceptCreate(
                name=extracted_node.name,
                domain=extracted_node.domain or domain or "General",
                type=extracted_node.type or "concept",
                description=extracted_node.description,
                tags=extracted_node.tags or [],
                aliases=extracted_node.aliases or [],
                lecture_key=lecture_id,  # For backward compatibility
                lecture_sources=[lecture_id],
                created_by=lecture_id,
                last_updated_by=lecture_id,
                created_by_run_id=run_id,
            )
            
            new_concept = create_concept(session, concept_payload, tenant_id=tenant_id)
            nodes_created.append(new_concept)
            concepts_created += 1
            node_name_to_id[normalized_name] = new_concept.node_id
            
            # Emit extraction event
            if event_callback:
                node_type = extracted_node.type or "concept"
                # Determine extraction type based on node type
                extraction_type = _determine_extraction_type(node_type, extracted_node.name)
                event_callback("extraction", {
                    "type": extraction_type,
                    "name": extracted_node.name,
                    "node_type": node_type,
                    "action": "created",
                    "description": extracted_node.description,
                })
    
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
                tenant_id=tenant_id,
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
    
    
    # Step 4: Process Hierarchical Structure (AST)
    if extraction.structure:
        try:
            process_structure(
                session=session,
                extraction=extraction,
                lecture_id=lecture_id,
                run_id=run_id,
                node_name_to_id=node_name_to_id,
                domain=domain
            )
            print(f"[Lecture Ingestion] AST Structure processed successfully")
        except Exception as e:
            print(f"[Lecture Ingestion] WARNING: Failed to process AST structure: {e}")
            errors.append(f"Structure processing info: {e}")

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



