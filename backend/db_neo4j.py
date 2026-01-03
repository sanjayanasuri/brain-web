from neo4j import GraphDatabase  # type: ignore[reportMissingImports]
from typing import Generator, Optional

from config import NEO4J_URI, NEO4J_USER, NEO4J_PASSWORD
from config import DEMO_MODE, DEMO_ALLOW_WRITES

# Add this in config.py too (see notes below)
from config import NEO4J_DATABASE

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
    """
    driver = _get_driver()
    session = None
    try:
        session_kwargs = {"database": NEO4J_DATABASE}

        # In demo mode, default to READ sessions unless explicitly allowed.
        if DEMO_MODE and not DEMO_ALLOW_WRITES:
            try:
                from neo4j import READ_ACCESS  # type: ignore
                session = driver.session(default_access_mode=READ_ACCESS, **session_kwargs)
            except Exception:
                session = driver.session(default_access_mode="READ", **session_kwargs)
        else:
            session = driver.session(**session_kwargs)

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
