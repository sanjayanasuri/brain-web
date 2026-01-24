"""
Utility functions for handling Neo4j operations with better error handling and resilience.
"""

import logging
import time
from functools import wraps
from typing import Callable, Any

from neo4j.exceptions import SessionExpired, ServiceUnavailable, TransientError

logger = logging.getLogger(__name__)


def neo4j_retry(max_retries: int = 3, delay: float = 1.0, exponential_backoff: bool = True):
    """
    Decorator to add retry logic to functions that perform Neo4j operations.
    
    Args:
        max_retries: Maximum number of retry attempts
        delay: Initial delay between retries in seconds
        exponential_backoff: If True, delay increases exponentially with each retry
    """
    def decorator(func: Callable) -> Callable:
        @wraps(func)
        def wrapper(*args, **kwargs) -> Any:
            last_exception = None
            
            for attempt in range(max_retries + 1):  # +1 for the initial attempt
                try:
                    return func(*args, **kwargs)
                except (SessionExpired, ServiceUnavailable, TransientError, ConnectionResetError, TimeoutError) as e:
                    last_exception = e
                    logger.warning(f"Neo4j operation '{func.__name__}' failed on attempt {attempt + 1}: {e}")
                    
                    if attempt == max_retries:
                        break
                    
                    wait_time = delay
                    if exponential_backoff:
                        wait_time *= (2 ** attempt)
                    
                    logger.info(f"Retrying in {wait_time:.2f} seconds...")
                    time.sleep(wait_time)
                except Exception as e:
                    # Don't retry on non-connection errors
                    logger.error(f"Non-retryable error in '{func.__name__}': {e}")
                    raise
            
            # If we get here, all retries failed
            logger.error(f"All retries exhausted for '{func.__name__}'. Last error: {last_exception}")
            raise last_exception
            
        return wrapper
    return decorator


def safe_neo4j_query(session, query: str, parameters: dict = None, default_return=None):
    """
    Execute a Neo4j query with error handling, returning a default value on failure.
    
    Args:
        session: Neo4j session
        query: Cypher query string
        parameters: Query parameters
        default_return: Value to return if query fails
    
    Returns:
        Query result or default_return on failure
    """
    try:
        result = session.run(query, parameters or {})
        return result
    except (SessionExpired, ServiceUnavailable, TransientError, ConnectionResetError, TimeoutError) as e:
        logger.error(f"Neo4j query failed due to connection issue: {e}")
        logger.debug(f"Failed query: {query}")
        if default_return is not None:
            return default_return
        raise
    except Exception as e:
        logger.error(f"Neo4j query failed: {e}")
        logger.debug(f"Failed query: {query}")
        if default_return is not None:
            return default_return
        raise


def get_connection_health_info():
    """
    Get information about Neo4j connection health.
    Useful for debugging and monitoring.
    """
    from db_neo4j import _get_driver
    
    try:
        driver = _get_driver()
        driver.verify_connectivity()
        return {
            "status": "healthy",
            "uri": driver._pool.address,
            "database": "connected"
        }
    except Exception as e:
        return {
            "status": "unhealthy",
            "error": str(e),
            "message": "Failed to connect to Neo4j"
        }