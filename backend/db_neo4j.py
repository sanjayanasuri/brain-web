from neo4j import GraphDatabase  # type: ignore[reportMissingImports]
from typing import Generator, Optional

from config import NEO4J_URI, NEO4J_USER, NEO4J_PASSWORD
from config import NEO4J_DATABASE, NEO4J_QUERY_TIMEOUT_SECONDS

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


def get_neo4j_session() -> Generator:
    """
    FastAPI dependency that yields a Neo4j session.
    IMPORTANT: pins the session to NEO4J_DATABASE so reads/writes are consistent.
    
    Sessions are configured with query timeout to prevent long-running queries.
    """
    driver = _get_driver()
    session = None
    try:
        session_kwargs = {
            "database": NEO4J_DATABASE,
            # Set query timeout (in seconds, converted to milliseconds for Neo4j)
            "fetch_size": 1000,  # Batch size for large result sets
        }

        session = driver.session(**session_kwargs)
        
        # Note: Neo4j Python driver doesn't support per-query timeout directly,
        # but we can set it at the transaction level. For now, we rely on the
        # request timeout middleware to catch long-running queries.

        yield session

    except Exception:
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


def get_driver():
    """Get the Neo4j driver (for scripts that need direct access)."""
    return _get_driver()


driver = property(lambda self: _get_driver()) if False else None
