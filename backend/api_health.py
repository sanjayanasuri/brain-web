"""
Health check endpoints for monitoring system status.
"""

from fastapi import APIRouter, Depends
from neo4j import Session

from db_neo4j import get_neo4j_session
from neo4j_utils import get_connection_health_info
import logging

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/health", tags=["health"])


@router.get("/")
async def health_check():
    """Basic health check endpoint."""
    return {"status": "ok", "service": "brain-web-backend"}


@router.get("/neo4j")
async def neo4j_health_check(session: Session = Depends(get_neo4j_session)):
    """Check Neo4j database connectivity and health."""
    try:
        # Simple query to test connection
        result = session.run("RETURN 1 as test")
        result.single()
        
        # Get additional connection info
        conn_info = get_connection_health_info()
        
        return {
            "status": "healthy",
            "database": "neo4j",
            "connection": conn_info,
            "query_test": "passed"
        }
    except Exception as e:
        logger.error(f"Neo4j health check failed: {e}")
        return {
            "status": "unhealthy",
            "database": "neo4j",
            "error": str(e),
            "query_test": "failed"
        }


@router.get("/detailed")
async def detailed_health_check(session: Session = Depends(get_neo4j_session)):
    """Detailed health check including database statistics."""
    try:
        # Test basic connectivity
        session.run("RETURN 1").single()
        
        # Get some database statistics
        stats_result = session.run("""
            CALL apoc.meta.stats() YIELD labels, relTypes, stats
            RETURN labels, relTypes, stats
        """)
        
        stats = {}
        try:
            record = stats_result.single()
            if record:
                stats = {
                    "node_labels": dict(record["labels"]) if record["labels"] else {},
                    "relationship_types": dict(record["relTypes"]) if record["relTypes"] else {},
                    "general_stats": dict(record["stats"]) if record["stats"] else {}
                }
        except Exception as e:
            logger.warning(f"Could not fetch detailed stats (APOC may not be available): {e}")
            # Fallback to basic node count
            node_count_result = session.run("MATCH (n) RETURN count(n) as node_count")
            node_count = node_count_result.single()["node_count"]
            stats = {"total_nodes": node_count}
        
        return {
            "status": "healthy",
            "database": "neo4j",
            "connectivity": "ok",
            "statistics": stats,
            "connection_info": get_connection_health_info()
        }
    except Exception as e:
        logger.error(f"Detailed health check failed: {e}")
        return {
            "status": "unhealthy",
            "database": "neo4j",
            "error": str(e),
            "connectivity": "failed"
        }

@router.get("/cache")
async def cache_stats():
    """Get statistics for the multi-level cache."""
    try:
        from cache_utils import get_cache_stats
        return get_cache_stats()
    except Exception as e:
        logger.error(f"Failed to fetch cache stats: {e}")
        return {"error": str(e)}