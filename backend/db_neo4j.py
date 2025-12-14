from neo4j import GraphDatabase  # type: ignore[reportMissingImports]
from typing import Generator, Optional

from config import NEO4J_URI, NEO4J_USER, NEO4J_PASSWORD
from config import DEMO_MODE, DEMO_ALLOW_WRITES

# Lazy driver initialization - only create when first needed
# This allows ECS secrets to be injected at container startup
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
        # Configure driver with connection pooling and keepalive to handle defunct connections
        _driver = GraphDatabase.driver(
            NEO4J_URI,
            auth=(NEO4J_USER, NEO4J_PASSWORD),
            max_connection_lifetime=3600,  # 1 hour
            max_connection_pool_size=50,
            connection_acquisition_timeout=30,
            keep_alive=True
        )
    # Verify driver is still healthy, recreate if needed
    try:
        _driver.verify_connectivity()
    except Exception:
        # Driver is unhealthy, close and recreate
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
            keep_alive=True
        )
    return _driver


def get_neo4j_session() -> Generator:
    """
    FastAPI dependency that yields a Neo4j session.
    Handles connection errors gracefully by retrying with a fresh session.
    """
    driver = _get_driver()
    session = None
    max_retries = 2
    for attempt in range(max_retries):
        try:
            # In demo mode, default to READ sessions unless explicitly allowed.
            if DEMO_MODE and not DEMO_ALLOW_WRITES:
                try:
                    # neo4j python driver exports READ_ACCESS in many versions
                    from neo4j import READ_ACCESS  # type: ignore
                    session = driver.session(default_access_mode=READ_ACCESS)
                except Exception:
                    # Fall back to string mode (works in some driver versions)
                    session = driver.session(default_access_mode="READ")
            else:
                session = driver.session()
            yield session
            return
        except Exception as e:
            # If session creation fails, try to get a fresh driver
            if attempt < max_retries - 1:
                global _driver
                try:
                    if _driver:
                        _driver.close()
                except Exception:
                    pass
                _driver = None
                driver = _get_driver()
            else:
                # Last attempt failed, raise the error
                raise
        finally:
            if session:
                try:
                    session.close()
                except Exception:
                    pass


# Export driver for scripts that need direct access
# This maintains backward compatibility with import_csv_to_neo4j.py and other scripts
def get_driver():
    """Get the Neo4j driver (for scripts that need direct access)."""
    return _get_driver()


# For backward compatibility, expose driver as a property-like access
# Scripts can use: from db_neo4j import get_driver; driver = get_driver()
driver = property(lambda self: _get_driver()) if False else None  # Type hint workaround
# Actually, let's just make it a simple function call for scripts
