"""
API endpoint for creating claims from quotes.
"""
from typing import List, Optional, Dict, Any
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from neo4j import Session
from uuid import uuid4
import hashlib

from db_neo4j import get_neo4j_session
from services_branch_explorer import (
    ensure_graph_scoping_initialized,
    get_active_graph_context,
)
from services_graph import (
    get_concept_by_id,
    link_claim_evidenced_by_quote,
    link_concept_supported_by_claim,
    get_all_concepts,
)
from services_claims import extract_claims_from_chunk
from models import Concept

router = APIRouter(prefix="/claims", tags=["claims"])


class ClaimsFromQuotesRequest(BaseModel):
    """Request to create claims from quotes."""
    quote_ids: List[str]
    concept_id: Optional[str] = None  # Optional: link all claims to this concept
    graph_id: Optional[str] = None
    branch_id: Optional[str] = None


class ClaimResult(BaseModel):
    """Result for a single created claim."""
    claim_id: str
    text: str
    confidence: float
    quote_id: str
    concept_ids: List[str]  # Concepts this claim is linked to


class ClaimsFromQuotesResponse(BaseModel):
    """Response from claims from quotes endpoint."""
    success: bool
    claims_created: int
    claims: List[ClaimResult]
    errors: List[str]


def get_quote_text(session: Session, graph_id: str, branch_id: str, quote_id: str) -> Optional[str]:
    """Get the text content of a quote."""
    query = """
    MATCH (q:Quote {graph_id: $graph_id, quote_id: $quote_id})
    WHERE $branch_id IN COALESCE(q.on_branches, [])
    RETURN q.text AS text
    LIMIT 1
    """
    result = session.run(query, graph_id=graph_id, branch_id=branch_id, quote_id=quote_id)
    record = result.single()
    if record:
        return record.data().get("text")
    return None


def get_quote_attached_concepts(session: Session, graph_id: str, branch_id: str, quote_id: str) -> List[str]:
    """Get concept node_ids attached to a quote via HAS_QUOTE."""
    query = """
    MATCH (c:Concept {graph_id: $graph_id})-[r:HAS_QUOTE]->(q:Quote {graph_id: $graph_id, quote_id: $quote_id})
    WHERE $branch_id IN COALESCE(c.on_branches, [])
      AND $branch_id IN COALESCE(q.on_branches, [])
    RETURN c.node_id AS node_id
    """
    result = session.run(query, graph_id=graph_id, branch_id=branch_id, quote_id=quote_id)
    return [record.data()["node_id"] for record in result]


def create_claim_from_quote(
    session: Session,
    graph_id: str,
    branch_id: str,
    quote_id: str,
    claim_text: str,
    confidence: float,
    source_span: str
) -> str:
    """
    Create a Claim node from quote text and link it to the quote.
    Returns the claim_id.
    """
    # Generate deterministic claim_id: hash of quote_id + claim_text
    claim_hash = hashlib.sha256(f"{quote_id}\n{claim_text}".encode('utf-8')).hexdigest()[:16].upper()
    claim_id = f"CLAIM_{claim_hash}"
    
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
        text=claim_text,
        confidence=confidence,
        method="llm_from_quote",
        source_id=quote_id,  # Use quote_id as source_id for quote-backed claims
        source_span=source_span
    )
    record = result.single()
    if not record:
        raise ValueError(f"Failed to create Claim {claim_id}")
    
    # Link claim to quote via EVIDENCED_BY
    link_claim_evidenced_by_quote(
        session=session,
        graph_id=graph_id,
        branch_id=branch_id,
        claim_id=claim_id,
        quote_id=quote_id
    )
    
    return claim_id


@router.post("/from_quotes", response_model=ClaimsFromQuotesResponse)
def create_claims_from_quotes(
    payload: ClaimsFromQuotesRequest,
    session: Session = Depends(get_neo4j_session),
):
    """
    Create claims from quotes using LLM extraction.
    
    For each quote:
    1. Extract 1-3 atomic claims using LLM
    2. Create Claim nodes
    3. Link (Claim)-[:EVIDENCED_BY]->(Quote)
    4. Link (Concept)-[:SUPPORTED_BY]->(Claim) for:
       - The provided concept_id (if any), OR
       - Concepts attached to the quote via HAS_QUOTE
    
    Args:
        payload: ClaimsFromQuotesRequest with quote_ids and optional concept_id
        session: Neo4j session
    
    Returns:
        ClaimsFromQuotesResponse with created claims and errors
    """
    ensure_graph_scoping_initialized(session)
    
    # Get graph/branch context
    if payload.graph_id and payload.branch_id:
        graph_id = payload.graph_id
        branch_id = payload.branch_id
    else:
        graph_id, branch_id = get_active_graph_context(session)
    
    # Get all concepts for mention resolution
    all_concepts = get_all_concepts(session)
    known_concepts = [
        {"name": c.name, "node_id": c.node_id, "description": c.description}
        for c in all_concepts
    ]
    
    claims_created = []
    errors = []
    
    # Resolve concept_id if provided
    target_concept_id: Optional[str] = None
    if payload.concept_id:
        concept = get_concept_by_id(session, payload.concept_id)
        if not concept:
            errors.append(f"Concept {payload.concept_id} not found")
            return ClaimsFromQuotesResponse(
                success=False,
                claims_created=0,
                claims=[],
                errors=errors
            )
        target_concept_id = concept.node_id
    
    # Process each quote
    for quote_id in payload.quote_ids:
        try:
            # Get quote text
            quote_text = get_quote_text(session, graph_id, branch_id, quote_id)
            if not quote_text:
                errors.append(f"Quote {quote_id} not found or has no text")
                continue
            
            # Extract claims from quote text
            extracted_claims = extract_claims_from_chunk(quote_text, known_concepts)
            if not extracted_claims:
                errors.append(f"No claims extracted from quote {quote_id}")
                continue
            
            # Get concepts attached to this quote
            quote_concept_ids = get_quote_attached_concepts(session, graph_id, branch_id, quote_id)
            
            # Determine which concepts to link claims to
            concepts_to_link = []
            if target_concept_id:
                concepts_to_link.append(target_concept_id)
            else:
                concepts_to_link.extend(quote_concept_ids)
            
            # Create claims
            for claim_data in extracted_claims[:3]:  # Limit to 3 claims per quote
                try:
                    claim_id = create_claim_from_quote(
                        session=session,
                        graph_id=graph_id,
                        branch_id=branch_id,
                        quote_id=quote_id,
                        claim_text=claim_data["claim_text"],
                        confidence=claim_data.get("confidence", 0.5),
                        source_span=claim_data.get("source_span", f"quote {quote_id}")
                    )
                    
                    # Link claim to concepts
                    linked_concept_ids = []
                    for concept_id in concepts_to_link:
                        try:
                            link_concept_supported_by_claim(
                                session=session,
                                graph_id=graph_id,
                                branch_id=branch_id,
                                concept_id=concept_id,
                                claim_id=claim_id
                            )
                            linked_concept_ids.append(concept_id)
                        except Exception as e:
                            errors.append(f"Failed to link claim {claim_id} to concept {concept_id}: {str(e)}")
                    
                    claims_created.append(ClaimResult(
                        claim_id=claim_id,
                        text=claim_data["claim_text"],
                        confidence=claim_data.get("confidence", 0.5),
                        quote_id=quote_id,
                        concept_ids=linked_concept_ids
                    ))
                except Exception as e:
                    errors.append(f"Failed to create claim from quote {quote_id}: {str(e)}")
                    continue
                    
        except Exception as e:
            errors.append(f"Error processing quote {quote_id}: {str(e)}")
            continue
    
    return ClaimsFromQuotesResponse(
        success=len(claims_created) > 0,
        claims_created=len(claims_created),
        claims=claims_created,
        errors=errors
    )

