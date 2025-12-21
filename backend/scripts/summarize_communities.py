#!/usr/bin/env python3
"""
Summarize communities using LLM and embed summaries.

Usage:
    python backend/scripts/summarize_communities.py --graph-id <graph_id> --branch-id <branch_id>
"""
import argparse
import json
from pathlib import Path
from typing import List, Dict, Any, Optional

# Add parent directory to path for imports
import sys
sys.path.insert(0, str(Path(__file__).parent.parent))

from neo4j import Session
from openai import OpenAI
from db_neo4j import get_driver
from services_graph import upsert_community, get_claims_for_communities
from services_search import embed_text
from services_branch_explorer import ensure_graph_scoping_initialized, ensure_graphspace_exists, ensure_branch_exists
from config import OPENAI_API_KEY

# Initialize OpenAI client
client = None
if OPENAI_API_KEY:
    cleaned_key = OPENAI_API_KEY.strip().strip('"').strip("'")
    if cleaned_key and cleaned_key.startswith('sk-'):
        try:
            client = OpenAI(api_key=cleaned_key)
            print(f"✓ OpenAI client initialized for community summarization")
        except Exception as e:
            print(f"ERROR: Failed to initialize OpenAI client: {e}")
            client = None
    else:
        print("WARNING: OPENAI_API_KEY format invalid")
        client = None
else:
    print("WARNING: OPENAI_API_KEY not found")


COMMUNITY_SUMMARIZATION_PROMPT = """You are a knowledge graph summarizer. Summarize a community of related concepts.

A community is a cluster of related concepts from a knowledge graph. Your task is to:
1. Write a summary_paragraph that explains what this community is about
2. List key_facts (bullets) - each fact should be traceable to at least one claim
3. List open_questions (bullets) - questions that arise from this community

Return JSON with:
- summary_paragraph: A 2-3 sentence summary of the community
- key_facts: Array of fact strings (each traceable to a claim)
- open_questions: Array of question strings

Example output:
{
  "summary_paragraph": "This community focuses on neural network architectures and training methods...",
  "key_facts": [
    "Neural networks use backpropagation to update weights",
    "Convolutional layers are effective for image processing"
  ],
  "open_questions": [
    "How do different activation functions affect training?",
    "What are the trade-offs between depth and width?"
  ]
}"""


def get_community_concepts(session: Session, graph_id: str, community_id: str, limit: int = 25) -> List[Dict[str, Any]]:
    """
    Get top concepts in a community.
    
    Args:
        session: Neo4j session
        graph_id: Graph ID
        community_id: Community ID
        limit: Maximum concepts to return
    
    Returns:
        List of concept dicts
    """
    query = """
    MATCH (g:GraphSpace {graph_id: $graph_id})
    MATCH (k:Community {graph_id: $graph_id, community_id: $community_id})-[:BELONGS_TO]->(g)
    MATCH (c:Concept {graph_id: $graph_id})-[:IN_COMMUNITY]->(k)
    RETURN c.node_id AS node_id,
           c.name AS name,
           c.description AS description,
           c.tags AS tags
    LIMIT $limit
    """
    result = session.run(query, graph_id=graph_id, community_id=community_id, limit=limit)
    concepts = []
    for record in result:
        concepts.append({
            "node_id": record["node_id"],
            "name": record["name"],
            "description": record["description"],
            "tags": record["tags"] or [],
        })
    return concepts


def summarize_community(
    session: Session,
    graph_id: str,
    community_id: str,
    community_name: str
) -> Optional[Dict[str, Any]]:
    """
    Generate summary for a community using LLM.
    
    Args:
        session: Neo4j session
        graph_id: Graph ID
        community_id: Community ID
        community_name: Community name
    
    Returns:
        Dict with summary_paragraph, key_facts, open_questions, or None if failed
    """
    if not client:
        print(f"[Summarize Communities] OpenAI client not available, skipping {community_id}")
        return None
    
    # Get top concepts
    concepts = get_community_concepts(session, graph_id, community_id, limit=25)
    
    # Get top claims
    claims_by_comm = get_claims_for_communities(
        session=session,
        graph_id=graph_id,
        community_ids=[community_id],
        limit_per_comm=50
    )
    claims = claims_by_comm.get(community_id, [])
    
    # Build prompt
    concepts_text = "\n".join([
        f"- {c['name']}: {c.get('description', 'No description')}"
        for c in concepts[:25]
    ])
    
    claims_text = "\n".join([
        f"- {claim['text']} (confidence: {claim['confidence']:.2f})"
        for claim in claims[:50]
    ])
    
    user_prompt = f"""Community: {community_name}
Community ID: {community_id}

Concepts in this community:
{concepts_text}

Claims related to this community:
{claims_text}

Summarize this community. Return JSON as specified."""
    
    try:
        print(f"[Summarize Communities] Calling LLM to summarize community: {community_name}")
        response = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {"role": "system", "content": COMMUNITY_SUMMARIZATION_PROMPT},
                {"role": "user", "content": user_prompt},
            ],
            temperature=0.3,
            max_tokens=1500,
        )
    except Exception as api_error:
        print(f"[Summarize Communities] ERROR: Failed to call LLM for {community_id}: {api_error}")
        return None
    
    # Process response
    try:
        if not response or not response.choices or len(response.choices) == 0:
            raise ValueError("LLM returned empty response")
        
        message = response.choices[0].message
        if not message or not message.content:
            raise ValueError("LLM returned empty content")
        
        content = message.content.strip()
        
        # Try to extract JSON
        import re
        json_match = re.search(r'\{.*\}', content, re.DOTALL)
        if json_match:
            content = json_match.group(0)
        
        # Parse JSON
        try:
            summary_data = json.loads(content)
        except json.JSONDecodeError as e:
            print(f"[Summarize Communities] ERROR: Failed to parse JSON for {community_id}: {e}")
            print(f"[Summarize Communities] Response: {content[:500]}...")
            return None
        
        # Validate structure
        summary_paragraph = summary_data.get("summary_paragraph", "")
        key_facts = summary_data.get("key_facts", [])
        open_questions = summary_data.get("open_questions", [])
        
        if not summary_paragraph:
            print(f"[Summarize Communities] WARNING: Empty summary for {community_id}")
            return None
        
        # Format summary text
        summary_text = summary_paragraph
        if key_facts:
            summary_text += "\n\nKey Facts:\n" + "\n".join(f"- {fact}" for fact in key_facts)
        if open_questions:
            summary_text += "\n\nOpen Questions:\n" + "\n".join(f"- {q}" for q in open_questions)
        
        # Embed summary
        try:
            summary_embedding = embed_text(summary_text)
        except Exception as e:
            print(f"[Summarize Communities] WARNING: Failed to embed summary for {community_id}: {e}")
            summary_embedding = None
        
        return {
            "summary": summary_text,
            "summary_embedding": summary_embedding,
            "summary_paragraph": summary_paragraph,
            "key_facts": key_facts,
            "open_questions": open_questions,
        }
        
    except Exception as e:
        print(f"[Summarize Communities] ERROR: Failed to process response for {community_id}: {e}")
        return None


def get_all_communities(session: Session, graph_id: str) -> List[Dict[str, Any]]:
    """
    Get all communities for a graph.
    
    Args:
        session: Neo4j session
        graph_id: Graph ID
    
    Returns:
        List of community dicts
    """
    query = """
    MATCH (g:GraphSpace {graph_id: $graph_id})
    MATCH (k:Community {graph_id: $graph_id})-[:BELONGS_TO]->(g)
    RETURN k.community_id AS community_id,
           k.name AS name,
           k.summary AS summary
    ORDER BY k.community_id
    """
    result = session.run(query, graph_id=graph_id)
    communities = []
    for record in result:
        communities.append({
            "community_id": record["community_id"],
            "name": record["name"],
            "summary": record["summary"],
        })
    return communities


def summarize_all_communities(
    session: Session,
    graph_id: str,
    branch_id: str
) -> None:
    """
    Summarize all communities in a graph.
    
    Args:
        session: Neo4j session
        graph_id: Graph ID
        branch_id: Branch ID
    """
    print(f"[Summarize Communities] Starting summarization for graph_id={graph_id}, branch_id={branch_id}")
    
    # Ensure graph and branch exist
    ensure_graphspace_exists(session, graph_id)
    ensure_branch_exists(session, graph_id, branch_id)
    ensure_graph_scoping_initialized(session)
    
    # Get all communities
    communities = get_all_communities(session, graph_id)
    print(f"[Summarize Communities] Found {len(communities)} communities")
    
    if not communities:
        print("[Summarize Communities] No communities found. Run build_communities.py first.")
        return
    
    # Summarize each community
    summarized = 0
    for comm in communities:
        community_id = comm["community_id"]
        community_name = comm["name"]
        
        # Skip if already has summary
        if comm.get("summary"):
            print(f"[Summarize Communities] Skipping {community_name} (already has summary)")
            continue
        
        summary_data = summarize_community(
            session=session,
            graph_id=graph_id,
            community_id=community_id,
            community_name=community_name
        )
        
        if summary_data:
            # Update community with summary
            try:
                upsert_community(
                    session=session,
                    graph_id=graph_id,
                    community_id=community_id,
                    name=community_name,
                    summary=summary_data["summary"],
                    summary_embedding=summary_data["summary_embedding"],
                    build_version=None  # Keep existing build_version
                )
                print(f"[Summarize Communities] Summarized: {community_name}")
                summarized += 1
            except Exception as e:
                print(f"[Summarize Communities] ERROR: Failed to update community {community_id}: {e}")
        else:
            print(f"[Summarize Communities] Failed to generate summary for {community_name}")
    
    print(f"[Summarize Communities] Completed: summarized {summarized}/{len(communities)} communities")


def main():
    parser = argparse.ArgumentParser(description="Summarize communities using LLM")
    parser.add_argument("--graph-id", required=True, help="Graph ID")
    parser.add_argument("--branch-id", required=True, help="Branch ID")
    
    args = parser.parse_args()
    
    driver = get_driver()
    with driver.session() as session:
        summarize_all_communities(
            session=session,
            graph_id=args.graph_id,
            branch_id=args.branch_id
        )


if __name__ == "__main__":
    main()
