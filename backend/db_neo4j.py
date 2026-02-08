from neo4j import GraphDatabase  # type: ignore[reportMissingImports]
from neo4j.exceptions import SessionExpired, ServiceUnavailable, TransientError
from typing import Generator, Optional
from contextlib import contextmanager
import time
import logging

from config import NEO4J_URI, NEO4J_USER, NEO4J_PASSWORD
from config import NEO4J_DATABASE, NEO4J_QUERY_TIMEOUT_SECONDS

logger = logging.getLogger(__name__)

_driver: Optional[GraphDatabase.driver] = None


def _get_driver():
    """Get or create the Neo4j driver, with lazy validation."""
    global _driver
    if _driver is None:
        if not NEO4J_PASSWORD:
            raise ValueError(
                "NEO4J_PASSWORD environment variable is required. "
                "Please set it in your .env.local file (see .env.example for reference)."
            )
        _driver = GraphDatabase.driver(
            NEO4J_URI,
            auth=(NEO4J_USER, NEO4J_PASSWORD),
            max_connection_lifetime=3600,
            max_connection_pool_size=50,
            connection_acquisition_timeout=30,
            keep_alive=True,
        )

    try:
        _driver.verify_connectivity()
    except Exception:
        try:
            _driver.close()
        except Exception:
            pass
        _driver = GraphDatabase.driver(
            NEO4J_URI,
            auth=(NEO4J_USER, NEO4J_PASSWORD),
            max_connection_lifetime=3600,
            max_connection_pool_size=50,
            connection_acquisition_timeout=30,
            keep_alive=True,
        )
    return _driver


def retry_neo4j_operation(func, max_retries=3, delay=1):
    """
    Retry wrapper for Neo4j operations that may fail due to connection issues.
    """
    for attempt in range(max_retries):
        try:
            return func()
        except (SessionExpired, ServiceUnavailable, TransientError, ConnectionResetError, TimeoutError) as e:
            logger.warning(f"Neo4j operation failed on attempt {attempt + 1}: {e}")
            if attempt == max_retries - 1:
                raise
            
            # Reset the driver on connection errors
            global _driver
            if _driver:
                try:
                    _driver.close()
                except Exception:
                    pass
                _driver = None
            
            time.sleep(delay * (attempt + 1))  # Exponential backoff
        except Exception as e:
            # Don't retry on non-connection errors
            raise


def get_neo4j_session() -> Generator:
    """
    FastAPI dependency that yields a Neo4j session.
    IMPORTANT: pins the session to NEO4J_DATABASE so reads/writes are consistent.
    
    Sessions are configured with query timeout to prevent long-running queries.
    """
    def create_session():
        driver = _get_driver()
        session_kwargs = {
            "database": NEO4J_DATABASE,
            "fetch_size": 1000,  # Batch size for large result sets
        }
        return driver.session(**session_kwargs)
    
    session = None
    try:
        session = retry_neo4j_operation(create_session)
        yield session

    except Exception as e:
        logger.error(f"Failed to create Neo4j session after retries: {e}")
        global _driver
        try:
            if _driver:
                _driver.close()
        except Exception:
            pass
        _driver = None
        raise
    finally:
        if session:
            try:
                session.close()
            except Exception:
                pass


@contextmanager
def neo4j_session():
    """
    Context manager for Neo4j sessions (for use with 'with' statements).
    Use this instead of get_neo4j_session() when not using FastAPI dependencies.
    """
    session_gen = get_neo4j_session()
    session = next(session_gen)
    try:
        yield session
    finally:
        try:
            next(session_gen)
        except StopIteration:
            pass


def get_driver():
    """Get the Neo4j driver (for scripts that need direct access)."""
    return _get_driver()


driver = property(lambda self: _get_driver()) if False else None
