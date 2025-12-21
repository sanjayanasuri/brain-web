"""
Logging service for GraphRAG events.
Logs to JSONL file for analysis and debugging.
"""
import json
import os
from datetime import datetime
from pathlib import Path
from typing import Dict, Any, Optional, List

# Log file path
LOG_DIR = Path(__file__).parent / "logs"
LOG_FILE = LOG_DIR / "graphrag_events.jsonl"


def ensure_log_dir():
    """Ensure log directory exists."""
    LOG_DIR.mkdir(exist_ok=True)


def log_graphrag_event(
    graph_id: str,
    branch_id: str,
    mode: str,
    user_question: str,
    retrieved_communities: Optional[List[str]] = None,
    retrieved_claims: Optional[List[str]] = None,
    response_length_tokens: Optional[int] = None,
    metadata: Optional[Dict[str, Any]] = None
) -> None:
    """
    Log a GraphRAG event to JSONL file.
    
    Args:
        graph_id: Graph ID
        branch_id: Branch ID
        mode: Retrieval mode ("classic" or "graphrag")
        user_question: User's question
        retrieved_communities: List of community IDs retrieved
        retrieved_claims: List of claim IDs retrieved
        response_length_tokens: Approximate token count of response
        metadata: Optional additional metadata
    """
    ensure_log_dir()
    
    event = {
        "timestamp": datetime.utcnow().isoformat(),
        "graph_id": graph_id,
        "branch_id": branch_id,
        "mode": mode,
        "user_question": user_question,
    }
    
    if retrieved_communities is not None:
        event["retrieved_communities"] = retrieved_communities
    
    if retrieved_claims is not None:
        event["retrieved_claims"] = retrieved_claims
    
    if response_length_tokens is not None:
        event["response_length_tokens"] = response_length_tokens
    
    if metadata:
        event["metadata"] = metadata
    
    # Append to JSONL file
    try:
        with open(LOG_FILE, "a") as f:
            f.write(json.dumps(event) + "\n")
    except Exception as e:
        # Don't fail the request if logging fails
        print(f"[GraphRAG Logging] WARNING: Failed to log event: {e}")


def get_recent_events(limit: int = 100) -> List[Dict[str, Any]]:
    """
    Get recent GraphRAG events from log file.
    
    Args:
        limit: Maximum number of events to return
    
    Returns:
        List of event dicts, most recent first
    """
    if not LOG_FILE.exists():
        return []
    
    events = []
    try:
        with open(LOG_FILE, "r") as f:
            lines = f.readlines()
            # Read last N lines
            for line in lines[-limit:]:
                try:
                    event = json.loads(line.strip())
                    events.append(event)
                except json.JSONDecodeError:
                    continue
        
        # Sort by timestamp (most recent first)
        events.sort(key=lambda e: e.get("timestamp", ""), reverse=True)
        return events
    except Exception as e:
        print(f"[GraphRAG Logging] ERROR: Failed to read events: {e}")
        return []


# Relationship review logging
REVIEW_LOG_FILE = LOG_DIR / "relationship_reviews.jsonl"


def log_relationship_review(
    action: str,
    graph_id: str,
    src_node_id: str,
    dst_node_id: str,
    rel_type: str,
    prior_status: Optional[str] = None,
    reviewer: Optional[str] = None,
    source_id: Optional[str] = None,
    chunk_id: Optional[str] = None,
    claim_id: Optional[str] = None,
    metadata: Optional[Dict[str, Any]] = None
) -> None:
    """
    Log a relationship review decision (accept/reject/edit).
    
    Args:
        action: Action taken ("accept", "reject", "edit")
        graph_id: Graph ID
        src_node_id: Source concept node_id
        dst_node_id: Destination concept node_id
        rel_type: Relationship type
        prior_status: Previous status before action
        reviewer: Reviewer identifier (optional)
        source_id: Source identifier (lecture_key / notion page id / file id)
        chunk_id: Chunk ID (optional)
        claim_id: Claim ID (optional)
        metadata: Additional metadata (optional)
    """
    ensure_log_dir()
    
    event = {
        "timestamp": datetime.utcnow().isoformat(),
        "action": action,
        "graph_id": graph_id,
        "edge": {
            "src_node_id": src_node_id,
            "dst_node_id": dst_node_id,
            "rel_type": rel_type,
        },
    }
    
    if prior_status is not None:
        event["prior_status"] = prior_status
    
    if reviewer is not None:
        event["reviewer"] = reviewer
    
    if source_id is not None:
        event["source_id"] = source_id
    
    if chunk_id is not None:
        event["chunk_id"] = chunk_id
    
    if claim_id is not None:
        event["claim_id"] = claim_id
    
    if metadata:
        event["metadata"] = metadata
    
    # Append to JSONL file
    try:
        with open(REVIEW_LOG_FILE, "a") as f:
            f.write(json.dumps(event) + "\n")
    except Exception as e:
        # Don't fail the request if logging fails
        print(f"[Relationship Review Logging] WARNING: Failed to log event: {e}")


# Entity merge logging
MERGE_LOG_FILE = LOG_DIR / "entity_merges.jsonl"


def log_entity_merge(
    action: str,
    graph_id: str,
    keep_node_id: str,
    merge_node_id: str,
    reviewer: Optional[str] = None,
    metadata: Optional[Dict[str, Any]] = None
) -> None:
    """
    Log an entity merge action.
    
    Args:
        action: Action taken ("MERGE_EXECUTED")
        graph_id: Graph ID
        keep_node_id: Node ID that was kept
        merge_node_id: Node ID that was merged
        reviewer: Reviewer identifier (optional)
        metadata: Additional metadata (optional)
    """
    ensure_log_dir()
    
    event = {
        "timestamp": datetime.utcnow().isoformat(),
        "action": action,
        "graph_id": graph_id,
        "keep_node_id": keep_node_id,
        "merge_node_id": merge_node_id,
    }
    
    if reviewer is not None:
        event["reviewer"] = reviewer
    
    if metadata:
        event["metadata"] = metadata
    
    # Append to JSONL file
    try:
        with open(MERGE_LOG_FILE, "a") as f:
            f.write(json.dumps(event) + "\n")
    except Exception as e:
        # Don't fail the request if logging fails
        print(f"[Entity Merge Logging] WARNING: Failed to log event: {e}")
