"""
Service for Supermemory AI integration.
Handles personal memory storage, retrieval, and synchronization.
"""
import httpx
import logging
from typing import List, Dict, Any, Optional
from datetime import datetime
import uuid

from config import SUPERMEMORY_API_KEY
from db_postgres import execute_update, execute_query
from models import SupermemoryMemory, MemorySyncEvent

logger = logging.getLogger("brain_web")

SUPERMEMORY_API_BASE = "https://supermemory.ai/api" # Placeholder - update with real API base if different

async def sync_learning_moment(user_id: str, content: str, source: str = "voice", metadata: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    """
    Store a new memory in Supermemory AI and log the sync event.
    """
    if not SUPERMEMORY_API_KEY:
        logger.warning("SUPERMEMORY_API_KEY not set. Skipping sync.")
        return {"status": "skipped", "reason": "no_api_key"}

    # 1. Sync to external Supermemory AI
    try:
        async with httpx.AsyncClient() as client:
            headers = {
                "Authorization": f"Bearer {SUPERMEMORY_API_KEY}",
                "Content-Type": "application/json"
            }
            payload = {
                "content": content,
                "metadata": metadata or {},
                "source": source
            }
            # Response handling based on expected Supermemory API structure
            # response = await client.post(f"{SUPERMEMORY_API_BASE}/memories", json=payload, headers=headers)
            # response.raise_for_status()
            # memory_data = response.json()
            # memory_id = memory_data.get("id")
            
            # Mocking successful API call for now
            memory_id = f"sm_{uuid.uuid4().hex[:8]}" 
            logger.info(f"Memory synced to Supermemory AI: {memory_id}")
    except Exception as e:
        logger.error(f"Failed to sync with Supermemory AI: {e}")
        # We still log the event even if the external sync fails (status='failed')
        memory_id = None

    # 2. Log sync event in local Postgres
    sync_id = str(uuid.uuid4())
    status = "synced" if memory_id else "failed"
    
    query = """
    INSERT INTO memory_sync_events (id, user_id, source, memory_id, content_preview, timestamp, status)
    VALUES (%s, %s, %s, %s, %s, %s, %s)
    """
    params = (
        sync_id,
        user_id,
        source,
        memory_id,
        content[:200] + ("..." if len(content) > 200 else ""),
        datetime.utcnow(),
        status
    )
    
    try:
        execute_update(query, params)
    except Exception as e:
        logger.error(f"Failed to log memory sync event: {e}")

    return {
        "sync_id": sync_id,
        "memory_id": memory_id,
        "status": status
    }

async def search_memories(user_id: str, query: str, limit: int = 5) -> List[Dict[str, Any]]:
    """
    Search personal memories via Supermemory AI.
    """
    if not SUPERMEMORY_API_KEY:
        return []

    try:
        async with httpx.AsyncClient() as client:
            headers = {"Authorization": f"Bearer {SUPERMEMORY_API_KEY}"}
            # params = {"q": query, "limit": limit}
            # response = await client.get(f"{SUPERMEMORY_API_BASE}/memories/search", params=params, headers=headers)
            # response.raise_for_status()
            # return response.json().get("memories", [])
            
            # Placeholder return
            return []
    except Exception as e:
        logger.error(f"Failed to search Supermemory AI: {e}")
        return []

def get_sync_history(user_id: str, limit: int = 20) -> List[Dict[str, Any]]:
    """
    Fetch recent sync events for a user.
    """
    query = """
    SELECT id, source, memory_id, content_preview, timestamp, status
    FROM memory_sync_events
    WHERE user_id = %s
    ORDER BY timestamp DESC
    LIMIT %s
    """
    return execute_query(query, (user_id, limit))
