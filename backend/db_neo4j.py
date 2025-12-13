from neo4j import GraphDatabase  # type: ignore[reportMissingImports]
from typing import Generator

from config import NEO4J_URI, NEO4J_USER, NEO4J_PASSWORD
from config import DEMO_MODE, DEMO_ALLOW_WRITES

# Validate that password is set
if not NEO4J_PASSWORD:
    raise ValueError(
        "NEO4J_PASSWORD environment variable is required. "
        "Please set it in your .env.local file (see .env.example for reference)."
    )

driver = GraphDatabase.driver(NEO4J_URI, auth=(NEO4J_USER, NEO4J_PASSWORD))


def get_neo4j_session() -> Generator:
    """
    FastAPI dependency that yields a Neo4j session.
    """
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
    try:
        yield session
    finally:
        session.close()
