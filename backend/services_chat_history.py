"""Service layer for chat history operations with Redis caching."""
import os
import json
import logging
from typing import List, Dict, Optional
from datetime import datetime

try:
    import psycopg2
    from psycopg2.extras import RealDictCursor
    from psycopg2.pool import ThreadedConnectionPool
    PSYCOPG2_AVAILABLE = True
except ImportError:
    PSYCOPG2_AVAILABLE = False
    ThreadedConnectionPool = None
    RealDictCursor = None

try:
    import redis
    from config import REDIS_URL, USE_REDIS
    REDIS_AVAILABLE = USE_REDIS
except ImportError:
    REDIS_AVAILABLE = False
    redis = None

from config import POSTGRES_CONNECTION_STRING

logger = logging.getLogger("brain_web")

# Connection pools
_postgres_pool: Optional[ThreadedConnectionPool] = None
_redis_client = None

# Configuration
REDIS_CHAT_HISTORY_TTL = 3600  # 1 hour
REDIS_CHAT_HISTORY_LIMIT = 10  # Last 10 messages


def _get_postgres_pool():
    """Get or create Postgres connection pool."""
    global _postgres_pool
    if not PSYCOPG2_AVAILABLE:
        raise ImportError("psycopg2-binary is required for chat history")
    if _postgres_pool is None:
        _postgres_pool = ThreadedConnectionPool(1, 10, POSTGRES_CONNECTION_STRING)
    return _postgres_pool


def _get_redis_client():
    """Get or create Redis client."""
    global _redis_client
    if not REDIS_AVAILABLE:
        return None
    if _redis_client is None:
        try:
            if not REDIS_URL:
                logger.warning("REDIS_URL not set, disabling Redis cache")
                return None
            _redis_client = redis.from_url(REDIS_URL, decode_responses=True)
            _redis_client.ping()
            logger.info("Redis client initialized for chat history")
        except Exception as e:
            logger.warning(f"Failed to connect to Redis: {e}")
            return None
    return _redis_client


def _save_to_redis(chat_id: str, role: str, content: str, message_id: Optional[str] = None, metadata: Optional[Dict] = None) -> bool:
    """Save message to Redis cache."""
    redis_client = _get_redis_client()
    if not redis_client:
        return False
    
    try:
        key = f"chat:{chat_id}:messages"
        message = json.dumps({
            "id": message_id,
            "role": role,
            "content": content,
            "metadata": metadata or {},
            "timestamp": datetime.utcnow().isoformat()
        })
        
        # Add to list (prepend for newest first)
        redis_client.lpush(key, message)
        
        # Keep only last N messages
        redis_client.ltrim(key, 0, REDIS_CHAT_HISTORY_LIMIT - 1)
        
        # Set TTL
        redis_client.expire(key, REDIS_CHAT_HISTORY_TTL)
        
        return True
    except Exception as e:
        logger.warning(f"Failed to save to Redis: {e}")
        return False


def _get_from_redis(chat_id: str, limit: int = 10) -> Optional[List[Dict[str, str]]]:
    """Get messages from Redis cache."""
    redis_client = _get_redis_client()
    if not redis_client:
        return None
    
    try:
        key = f"chat:{chat_id}:messages"
        messages_raw = redis_client.lrange(key, 0, limit - 1)
        
        if not messages_raw:
            return None
        
        # Parse and reverse (Redis stores newest first, we want oldest first)
        messages = []
        for msg_str in reversed(messages_raw):
            msg = json.loads(msg_str)
            messages.append({
                "id": msg.get("id"),
                "role": msg["role"],
                "content": msg["content"],
                "metadata": msg.get("metadata", {})
            })
        
        return messages
    except Exception as e:
        logger.warning(f"Failed to get from Redis: {e}")
        return None


def save_message(
    chat_id: str,
    user_id: str,
    tenant_id: str,
    role: str,
    content: str,
    metadata: Optional[Dict] = None
) -> str:
    """
    Save a chat message with write-through caching.
    
    Writes to Redis (fast) and Postgres (durable).
    
    Args:
        chat_id: Conversation identifier
        user_id: User identifier
        tenant_id: Tenant identifier
        role: Message role (user, assistant, system)
        content: Message content
        metadata: Optional metadata (model, tokens, etc.)
    
    Returns:
        Message ID (UUID)
    """
    # Save to Postgres (durable)
    if not PSYCOPG2_AVAILABLE:
        raise ImportError("psycopg2-binary is required for chat history")
    
    pool = _get_postgres_pool()
    conn = pool.getconn()
    try:
        with conn.cursor() as cur:
            cur.execute("""
                INSERT INTO chat_messages (chat_id, user_id, tenant_id, role, content, metadata, created_at)
                VALUES (%s, %s, %s, %s, %s, %s, NOW())
                RETURNING id
            """, (chat_id, user_id, tenant_id, role, content, psycopg2.extras.Json(metadata or {})))
            
            message_id = str(cur.fetchone()[0])
            conn.commit()
            
            # Save to Redis (fast path, now with stable ID)
            _save_to_redis(chat_id, role, content, message_id=message_id, metadata=metadata)
            
            return message_id
    finally:
        pool.putconn(conn)


def get_chat_history(
    chat_id: str,
    limit: int = 20,
    user_id: Optional[str] = None,
    tenant_id: Optional[str] = None
) -> List[Dict[str, str]]:
    """
    Get recent messages with Redis caching.
    
    Tries Redis first (fast), falls back to Postgres if miss.
    
    Args:
        chat_id: Conversation identifier
        limit: Maximum number of messages to retrieve
        user_id: Optional user filter
        tenant_id: Optional tenant filter
    
    Returns:
        List of messages in format: [{"role": "user", "content": "..."}, ...]
    """
    # Try Redis first (fast path)
    messages = _get_from_redis(chat_id, limit)
    if messages is not None:
        logger.debug(f"Chat history cache hit for {chat_id}")
        return messages
    
    # Fallback to Postgres (slow path)
    logger.debug(f"Chat history cache miss for {chat_id}, loading from Postgres")
    
    if not PSYCOPG2_AVAILABLE:
        return []
    
    pool = _get_postgres_pool()
    conn = pool.getconn()
    try:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            # Build query with optional filters
            query = """
                SELECT id, role, content, metadata, created_at
                FROM chat_messages
                WHERE chat_id = %s
            """
            params = [chat_id]
            
            if user_id:
                query += " AND user_id = %s"
                params.append(user_id)
            
            if tenant_id:
                query += " AND tenant_id = %s"
                params.append(tenant_id)
            
            query += """
                ORDER BY created_at DESC
                LIMIT %s
            """
            params.append(limit)
            
            cur.execute(query, params)
            
            messages = []
            for row in reversed(list(cur.fetchall())):  # Reverse to get chronological order
                messages.append({
                    "id": str(row["id"]),
                    "role": row["role"],
                    "content": row["content"],
                    "metadata": row["metadata"] if isinstance(row["metadata"], dict) else json.loads(row["metadata"] or "{}")
                })
            
            # Warm up Redis cache
            if messages:
                for msg in messages:
                    _save_to_redis(chat_id, msg["role"], msg["content"], message_id=msg["id"], metadata=msg.get("metadata"))
            
            return messages
    except Exception as e:
        # If table doesn't exist yet, return empty history
        if "does not exist" in str(e):
            return []
        raise
    finally:
        pool.putconn(conn)


def delete_chat_history(chat_id: str, user_id: Optional[str] = None, tenant_id: Optional[str] = None) -> int:
    """
    Delete all messages for a chat from both Redis and Postgres.
    
    Args:
        chat_id: Conversation identifier
        user_id: Optional user filter
        tenant_id: Optional tenant filter
    
    Returns:
        Number of messages deleted
    """
    # Delete from Redis
    redis_client = _get_redis_client()
    if redis_client:
        try:
            redis_client.delete(f"chat:{chat_id}:messages")
        except Exception as e:
            logger.warning(f"Failed to delete from Redis: {e}")
    
    # Delete from Postgres
    if not PSYCOPG2_AVAILABLE:
        raise ImportError("psycopg2-binary is required for chat history")
    
    pool = _get_postgres_pool()
    conn = pool.getconn()
    try:
        with conn.cursor() as cur:
            query = "DELETE FROM chat_messages WHERE chat_id = %s"
            params = [chat_id]
            
            if user_id:
                query += " AND user_id = %s"
                params.append(user_id)
            
            if tenant_id:
                query += " AND tenant_id = %s"
                params.append(tenant_id)
            
            cur.execute(query, params)
            deleted_count = cur.rowcount
            conn.commit()
            return deleted_count
    finally:
        pool.putconn(conn)


def get_chat_count(user_id: str, tenant_id: str, days: int = 30) -> int:
    """
    Get number of unique chats for a user in the last N days.
    
    Args:
        user_id: User identifier
        tenant_id: Tenant identifier
        days: Number of days to look back
    
    Returns:
        Number of unique chat_ids
    """
    if not PSYCOPG2_AVAILABLE:
        return 0
    
    pool = _get_postgres_pool()
    conn = pool.getconn()
    try:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT COUNT(DISTINCT chat_id)
                FROM chat_messages
                WHERE user_id = %s
                AND tenant_id = %s
                AND created_at >= NOW() - INTERVAL '%s days'
            """, (user_id, tenant_id, days))
            
            return cur.fetchone()[0] or 0
    except Exception:
        return 0
    finally:
        pool.putconn(conn)


def get_user_sessions(user_id: str, tenant_id: str, limit: int = 50) -> List[Dict]:
    """
    Get all unique chat sessions for a user.
    """
    if not PSYCOPG2_AVAILABLE:
        return []
    
    pool = _get_postgres_pool()
    conn = pool.getconn()
    try:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute("""
                SELECT 
                    chat_id as id, 
                    MIN(content) as title, 
                    MIN(created_at) as createdAt,
                    MAX(created_at) as updatedAt
                FROM chat_messages
                WHERE user_id = %s AND tenant_id = %s
                GROUP BY chat_id
                ORDER BY updatedAt DESC
                LIMIT %s
            """, (user_id, tenant_id, limit))
            
            sessions = []
            for row in cur.fetchall():
                title = row["title"]
                if len(title) > 50:
                    title = title[:47] + "..."
                
                sessions.append({
                    "id": row["id"],
                    "title": title,
                    "createdAt": int(row["createdat"].timestamp() * 1000),
                    "updatedAt": int(row["updatedat"].timestamp() * 1000),
                    "messages": [] 
                })
            return sessions
    except Exception as e:
        logger.error(f"Failed to get user sessions: {e}")
        return []
    finally:
        pool.putconn(conn)
