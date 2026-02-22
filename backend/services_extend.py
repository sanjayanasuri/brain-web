"""
Service for Extend system: Controlled Reasoning & Graph Expansion.

Phase 3: Provides three modes:
- Mode A: Suggest Connections (NO WRITES)
- Mode B: Generate Claims (WRITE, evidence-backed only)
- Mode C: Controlled Concept Expansion (WRITE, capped)
"""
import json
import re
from typing import List, Dict, Any, Optional, Tuple
from neo4j import Session
from openai import OpenAI
import logging

from config import OPENAI_API_KEY
from services_model_router import model_router, TASK_CHAT_SMART, TASK_EXTRACT

from services_branch_explorer import (
    ensure_graph_scoping_initialized,
    get_active_graph_context,
)
from services_graph import (
    get_concept_by_id,
    get_concept_by_name,
    get_neighbors,
    create_relationship_by_ids,
    get_all_concepts,
    link_claim_evidenced_by_quote,
    link_concept_supported_by_claim,
    create_concept,
)
from services_claims import extract_claims_from_chunk
from models import Concept, ConceptCreate

from uuid import uuid4

logger = logging.getLogger("brain_web")


def get_concept_context(session: Session, graph_id: str, branch_id: str, concept_id: str) -> Dict[str, Any]:
    """Gather context about a concept: description, aliases, quotes, claims, neighbors."""
    query = """
    MATCH (c:Concept {graph_id: $graph_id, node_id: $concept_id})
    WHERE $branch_id IN COALESCE(c.on_branches, [])
    OPTIONAL MATCH (c)-[:HAS_QUOTE]->(q:Quote {graph_id: $graph_id})
    WHERE $branch_id IN COALESCE(q.on_branches, [])
    OPTIONAL MATCH (c)-[:SUPPORTED_BY]->(cl:Claim {graph_id: $graph_id})
    WHERE $branch_id IN COALESCE(cl.on_branches, [])
    OPTIONAL MATCH (c)-[r]-(n:Concept {graph_id: $graph_id})
    WHERE $branch_id IN COALESCE(n.on_branches, [])
      AND $branch_id IN COALESCE(r.on_branches, [])
      AND COALESCE(n.is_merged, false) = false
    RETURN c.name AS name,
           c.description AS description,
           COALESCE(c.aliases, []) AS aliases,
           collect(DISTINCT q.text) AS quote_texts,
           collect(DISTINCT q.quote_id) AS quote_ids,
           collect(DISTINCT cl.text) AS claim_texts,
           collect(DISTINCT cl.claim_id) AS claim_ids,
           collect(DISTINCT {name: n.name, node_id: n.node_id, rel_type: type(r)}) AS neighbors
    LIMIT 1
    """
    result = session.run(query, graph_id=graph_id, branch_id=branch_id, concept_id=concept_id)
    record = result.single()
    if not record:
        return {}
    
    data = record.data()
    return {
        "name": data.get("name", ""),
        "description": data.get("description", ""),
        "aliases": data.get("aliases", []),
        "quote_texts": [q for q in data.get("quote_texts", []) if q],
        "quote_ids": [q for q in data.get("quote_ids", []) if q],
        "claim_texts": [c for c in data.get("claim_texts", []) if c],
        "claim_ids": [c for c in data.get("claim_ids", []) if c],
        "neighbors": [n for n in data.get("neighbors", []) if n],
    }


def get_quote_context(session: Session, graph_id: str, branch_id: str, quote_id: str) -> Dict[str, Any]:
    """Gather context about a quote: text, source document, attached concepts."""
    query = """
    MATCH (q:Quote {graph_id: $graph_id, quote_id: $quote_id})
    WHERE $branch_id IN COALESCE(q.on_branches, [])
    OPTIONAL MATCH (q)-[:QUOTED_FROM]->(d:SourceDocument {graph_id: $graph_id})
    OPTIONAL MATCH (c:Concept {graph_id: $graph_id})-[r:HAS_QUOTE]->(q)
    WHERE $branch_id IN COALESCE(c.on_branches, [])
    RETURN q.text AS text,
           q.anchor AS anchor,
           d.url AS source_url,
           d.title AS source_title,
           collect(DISTINCT {name: c.name, node_id: c.node_id}) AS attached_concepts
    LIMIT 1
    """
    result = session.run(query, graph_id=graph_id, branch_id=branch_id, quote_id=quote_id)
    record = result.single()
    if not record:
        return {}
    
    data = record.data()
    return {
        "text": data.get("text", ""),
        "anchor": data.get("anchor"),
        "source_url": data.get("source_url", ""),
        "source_title": data.get("source_title", ""),
        "attached_concepts": [c for c in data.get("attached_concepts", []) if c],
    }


def suggest_connections(
    session: Session,
    graph_id: str,
    branch_id: str,
    source_type: str,
    source_id: str,
    context: Optional[str] = None
) -> List[Dict[str, Any]]:
    """
    Mode A: Suggest Connections (NO WRITES)
    
    Returns relationship suggestions without creating any nodes or edges.
    """
    if not model_router.client:
        return []

    
    # Gather context
    if source_type == "concept":
        concept = get_concept_by_id(session, source_id)
        if not concept:
            return []
        
        context_data = get_concept_context(session, graph_id, branch_id, source_id)
        source_name = concept.name
        source_description = concept.description or ""
        aliases = context_data.get("aliases", [])
        quotes = context_data.get("quote_texts", [])[:5]  # Limit quotes for prompt
        claims = context_data.get("claim_texts", [])[:5]  # Limit claims for prompt
        neighbors = context_data.get("neighbors", [])[:10]  # Limit neighbors
        
        context_text = f"""
Source Concept: {source_name}
Description: {source_description}
Aliases: {', '.join(aliases) if aliases else 'None'}

Quotes attached to this concept:
{chr(10).join(f"- {q[:200]}..." if len(q) > 200 else f"- {q}" for q in quotes) if quotes else "None"}

Claims supported by this concept:
{chr(10).join(f"- {c[:200]}..." if len(c) > 200 else f"- {c}" for c in claims) if claims else "None"}

Neighboring concepts:
{chr(10).join(f"- {n['name']} ({n['rel_type']})" for n in neighbors) if neighbors else "None"}
"""
    elif source_type == "quote":
        quote_context = get_quote_context(session, graph_id, branch_id, source_id)
        if not quote_context.get("text"):
            return []
        
        source_name = "Quote"
        source_description = quote_context.get("text", "")[:500]
        attached_concepts = quote_context.get("attached_concepts", [])
        
        context_text = f"""
Source Quote: {quote_context.get('text', '')[:500]}...
Source: {quote_context.get('source_url', 'Unknown')}

Concepts attached to this quote:
{chr(10).join(f"- {c['name']}" for c in attached_concepts) if attached_concepts else "None"}
"""
    else:
        return []
    
    # Get all concepts for reference
    all_concepts = get_all_concepts(session)
    concept_names = [c.name for c in all_concepts[:100]]  # Limit for prompt
    
    # Build LLM prompt
    system_prompt = """You are a knowledge graph relationship suggestion system. Suggest conceptual connections that might exist based on the provided context.

For each suggestion, provide:
- target_concept_name: Name of an existing concept (must match exactly from the known concepts list)
- relationship_type: One of: RELATES_TO, CAUSES, CONTRASTS_WITH, BUILDS_ON, DEPENDS_ON, PREREQUISITE_FOR
- justification: A clear explanation of why this connection might exist (2-3 sentences)
- confidence: A confidence score 0.0-1.0
- evidence_quote_ids: Optional list of quote IDs that support this connection (if available)

Return a JSON array of suggestions. Do NOT create new concepts. Only suggest connections to existing concepts."""
    
    user_prompt = f"""{context_text}

Known concepts in the graph:
{', '.join(concept_names) if concept_names else 'None'}

User context: {context if context else 'None'}

Generate 3-5 relationship suggestions. Return JSON array only."""
    
    try:
        raw = model_router.completion(
            task_type=TASK_EXTRACT,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
            temperature=0.3,
            max_tokens=2000,
        )

        if not raw:
            return []

        content = raw.strip()
        # Extract JSON array
        json_match = re.search(r'\[.*\]', content, re.DOTALL)
        if json_match:
            content = json_match.group(0)
        
        suggestions = json.loads(content)
        if not isinstance(suggestions, list):
            return []
        
        # Normalize and validate suggestions
        normalized = []
        for sug in suggestions:
            if not isinstance(sug, dict):
                continue
            
            # Resolve target concept
            target_name = sug.get("target_concept_name", "").strip()
            if not target_name:
                continue
            
            target_concept = get_concept_by_name(session, target_name)
            if not target_concept:
                continue  # Skip if target doesn't exist
            
            normalized.append({
                "source_concept_id": source_id if source_type == "concept" else None,
                "source_quote_id": source_id if source_type == "quote" else None,
                "target_concept_id": target_concept.node_id,
                "target_concept_name": target_concept.name,
                "relationship_type": sug.get("relationship_type", "RELATES_TO"),
                "justification": sug.get("justification", ""),
                "confidence": max(0.0, min(1.0, float(sug.get("confidence", 0.5)))),
                "evidence_quote_ids": sug.get("evidence_quote_ids", []),
            })
        
        return normalized
        
    except Exception as e:
        print(f"[Extend Mode A] Error generating suggestions: {e}")
        return []


def generate_claims_from_quotes(
    session: Session,
    graph_id: str,
    branch_id: str,
    quote_ids: List[str],
    concept_id: Optional[str] = None
) -> Tuple[List[Dict[str, Any]], List[str]]:
    """
    Mode B: Generate Claims (WRITE, evidence-backed only)
    
    Creates Claim nodes from quotes and links them appropriately.
    Returns (created_claims, errors)
    """
    errors = []
    created_claims = []
    
    # Get all concepts for mention resolution
    all_concepts = get_all_concepts(session)
    known_concepts = [
        {"name": c.name, "node_id": c.node_id, "description": c.description}
        for c in all_concepts
    ]
    
    # Resolve concept_id if provided
    target_concept_id: Optional[str] = None
    if concept_id:
        concept = get_concept_by_id(session, concept_id)
        if not concept:
            errors.append(f"Concept {concept_id} not found")
            return [], errors
        target_concept_id = concept.node_id
    
    # Process each quote
    for quote_id in quote_ids:
        try:
            # Get quote text
            quote_context = get_quote_context(session, graph_id, branch_id, quote_id)
            quote_text = quote_context.get("text", "")
            if not quote_text:
                errors.append(f"Quote {quote_id} not found or has no text")
                continue
            
            # Extract claims
            extracted_claims = extract_claims_from_chunk(quote_text, known_concepts)
            if not extracted_claims:
                errors.append(f"No claims extracted from quote {quote_id}")
                continue
            
            # Get concepts attached to this quote
            attached_concepts = quote_context.get("attached_concepts", [])
            quote_concept_ids = [c["node_id"] for c in attached_concepts]
            
            # Determine which concepts to link claims to
            concepts_to_link = []
            if target_concept_id:
                concepts_to_link.append(target_concept_id)
            else:
                concepts_to_link.extend(quote_concept_ids)
            
            if not concepts_to_link:
                errors.append(f"Quote {quote_id} has no attached concepts and no concept_id provided")
                continue
            
            # Create claims (limit to 3 per quote)
            for claim_data in extracted_claims[:3]:
                try:
                    # Generate deterministic claim_id
                    import hashlib
                    claim_hash = hashlib.sha256(f"{quote_id}\n{claim_data['claim_text']}".encode('utf-8')).hexdigest()[:16].upper()
                    claim_id = f"CLAIM_{claim_hash}"
                    
                    # Create Claim node
                    query = """
                    MATCH (g:GraphSpace {graph_id: $graph_id})
                    MERGE (c:Claim {graph_id: $graph_id, claim_id: $claim_id})
                    ON CREATE SET
                        c.text = $text,
                        c.confidence = $confidence,
                        c.method = $method,
                        c.source_id = $source_id,
                        c.source_span = $source_span,
                        c.on_branches = [$branch_id],
                        c.created_at = timestamp()
                    ON MATCH SET
                        c.text = $text,
                        c.confidence = $confidence,
                        c.method = $method,
                        c.source_id = $source_id,
                        c.source_span = $source_span,
                        c.on_branches = CASE
                            WHEN c.on_branches IS NULL THEN [$branch_id]
                            WHEN $branch_id IN c.on_branches THEN c.on_branches
                            ELSE c.on_branches + $branch_id
                        END,
                        c.updated_at = timestamp()
                    MERGE (c)-[:BELONGS_TO]->(g)
                    RETURN c.claim_id AS claim_id
                    """
                    result = session.run(
                        query,
                        graph_id=graph_id,
                        branch_id=branch_id,
                        claim_id=claim_id,
                        text=claim_data["claim_text"],
                        confidence=claim_data.get("confidence", 0.5),
                        method="llm_from_quote_extend",
                        source_id=quote_id,
                        source_span=claim_data.get("source_span", f"quote {quote_id}")
                    )
                    if not result.single():
                        errors.append(f"Failed to create Claim {claim_id}")
                        continue
                    
                    # Link claim to quote
                    link_claim_evidenced_by_quote(
                        session=session,
                        graph_id=graph_id,
                        branch_id=branch_id,
                        claim_id=claim_id,
                        quote_id=quote_id
                    )
                    
                    # Link claim to concepts
                    linked_concept_ids = []
                    for cid in concepts_to_link:
                        try:
                            link_concept_supported_by_claim(
                                session=session,
                                graph_id=graph_id,
                                branch_id=branch_id,
                                concept_id=cid,
                                claim_id=claim_id
                            )
                            linked_concept_ids.append(cid)
                        except Exception as e:
                            errors.append(f"Failed to link claim {claim_id} to concept {cid}: {str(e)}")
                    
                    created_claims.append({
                        "claim_id": claim_id,
                        "text": claim_data["claim_text"],
                        "confidence": claim_data.get("confidence", 0.5),
                        "quote_id": quote_id,
                        "concept_ids": linked_concept_ids,
                    })
                    
                except Exception as e:
                    errors.append(f"Failed to create claim from quote {quote_id}: {str(e)}")
                    continue
                    
        except Exception as e:
            errors.append(f"Error processing quote {quote_id}: {str(e)}")
            continue
    
    return created_claims, errors


def controlled_expansion(
    session: Session,
    graph_id: str,
    branch_id: str,
    concept_id: str,
    max_new_nodes: int,
    context: Optional[str] = None
) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]], List[str]]:
    """
    Mode C: Controlled Concept Expansion (WRITE, capped)
    
    Creates new Concept nodes related to the source concept, with hard caps.
    Returns (created_concepts, created_relationships, errors)
    """
    if max_new_nodes > 5:
        return [], [], [f"max_new_nodes cannot exceed 5 (got {max_new_nodes})"]
    
    if not model_router.client:
        return [], [], ["OpenAI client not available"]

    
    errors = []
    created_concepts = []
    created_relationships = []
    
    # Get source concept
    source_concept = get_concept_by_id(session, concept_id)
    if not source_concept:
        return [], [], [f"Source concept {concept_id} not found"]
    
    # Get context
    context_data = get_concept_context(session, graph_id, branch_id, concept_id)
    
    # Get all existing concepts to avoid duplicates
    all_concepts = get_all_concepts(session)
    existing_names = {c.name.lower().strip() for c in all_concepts}
    existing_aliases = set()
    for c in all_concepts:
        for alias in (c.aliases or []):
            existing_aliases.add(alias.lower().strip())
    
    # Build LLM prompt
    system_prompt = """You are a knowledge graph expansion system. Generate candidate concepts that are related to the source concept.

For each candidate, provide:
- name: A clear, concise concept name (2-4 words)
- relationship_type: One of: RELATES_TO, CAUSES, CONTRASTS_WITH, BUILDS_ON, DEPENDS_ON, PREREQUISITE_FOR
- justification: A clear explanation of why this concept should exist and how it relates (2-3 sentences)
- confidence: A confidence score 0.0-1.0
- description: A brief description of the concept (1-2 sentences, optional)

Return a JSON array of candidates. Generate unique concept names that don't duplicate existing concepts."""
    
    user_prompt = f"""
Source Concept: {source_concept.name}
Description: {source_concept.description or 'None'}
Domain: {source_concept.domain}

Context:
- Quotes: {len(context_data.get('quote_texts', []))} attached
- Claims: {len(context_data.get('claim_texts', []))} supported
- Neighbors: {len(context_data.get('neighbors', []))} connected

Existing concepts (do not duplicate): {', '.join([c.name for c in all_concepts[:50]])}

User context: {context if context else 'None'}

Generate up to {max_new_nodes} candidate concepts. Return JSON array only."""
    
    try:
        raw = model_router.completion(
            task_type=TASK_CHAT_SMART,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
            temperature=0.4,
            max_tokens=2000,
        )

        if not raw:
            return [], [], ["LLM returned empty response"]

        content = raw.strip()
        json_match = re.search(r'\[.*\]', content, re.DOTALL)
        if json_match:
            content = json_match.group(0)
        
        candidates = json.loads(content)
        if not isinstance(candidates, list):
            return [], [], ["LLM response was not a list"]
        
        # Process candidates (respect max_new_nodes)
        nodes_created = 0
        for candidate in candidates[:max_new_nodes]:
            if nodes_created >= max_new_nodes:
                break
            
            if not isinstance(candidate, dict):
                continue
            
            candidate_name = candidate.get("name", "").strip()
            if not candidate_name:
                continue
            
            # Check for duplicates
            normalized_name = candidate_name.lower().strip()
            if normalized_name in existing_names or normalized_name in existing_aliases:
                errors.append(f"Skipping duplicate concept name: {candidate_name}")
                continue
            
            # Create new concept
            try:
                concept_payload = ConceptCreate(
                    name=candidate_name,
                    domain=source_concept.domain,  # Inherit domain
                    type="concept",
                    description=candidate.get("description", ""),
                )
                
                new_concept = create_concept(session, concept_payload)
                nodes_created += 1
                existing_names.add(normalized_name)  # Track to avoid duplicates in this batch
                
                created_concepts.append({
                    "node_id": new_concept.node_id,
                    "name": new_concept.name,
                    "description": new_concept.description,
                })
                
                # Create relationship
                relationship_type = candidate.get("relationship_type", "RELATES_TO")
                justification = candidate.get("justification", "")
                confidence = max(0.0, min(1.0, float(candidate.get("confidence", 0.5))))
                
                create_relationship_by_ids(
                    session=session,
                    source_id=concept_id,
                    target_id=new_concept.node_id,
                    predicate=relationship_type,
                    status="ACCEPTED",
                    confidence=confidence,
                    method="llm_extend",
                    rationale=justification,
                )
                
                created_relationships.append({
                    "source_id": concept_id,
                    "target_id": new_concept.node_id,
                    "relationship_type": relationship_type,
                    "justification": justification,
                    "confidence": confidence,
                })
                
            except Exception as e:
                errors.append(f"Failed to create concept '{candidate_name}': {str(e)}")
                continue
        
        return created_concepts, created_relationships, errors
        
    except Exception as e:
        return [], [], [f"Error in controlled expansion: {str(e)}"]

