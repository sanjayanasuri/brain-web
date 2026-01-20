"""
Service for building communities after ingestion runs.

This module provides programmatic access to community building functionality.
"""
import logging
from typing import Optional
from neo4j import Session
from datetime import datetime

# Import build_communities from the script
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent))

try:
    from scripts.build_communities import build_communities
except ImportError:
    # Fallback if script is not importable
    build_communities = None

logger = logging.getLogger("brain_web")


def trigger_community_build(
    session: Session,
    graph_id: str,
    branch_id: str,
    build_version: Optional[str] = None,
    resolution: float = 0.6,
    unweighted: bool = False,
) -> bool:
    """
    Trigger a community build for the given graph and branch.
    
    Args:
        session: Neo4j session
        graph_id: Graph ID
        branch_id: Branch ID
        build_version: Optional build version (defaults to timestamp-based)
        resolution: Resolution parameter for Leiden algorithm
        unweighted: If True, ignore edge weights
    
    Returns:
        True if build was triggered successfully, False otherwise
    """
    if build_communities is None:
        logger.warning("[Community Build] build_communities function not available. Install python-igraph and leidenalg.")
        return False
    
    try:
        # Generate build version if not provided
        if not build_version:
            timestamp = datetime.utcnow().strftime("%Y%m%d_%H%M%S")
            build_version = f"auto_{timestamp}"
        
        logger.info(f"[Community Build] Triggering build for graph_id={graph_id}, branch_id={branch_id}, version={build_version}")
        
        build_communities(
            session=session,
            graph_id=graph_id,
            branch_id=branch_id,
            build_version=build_version,
            resolution=resolution,
            unweighted=unweighted,
        )
        
        logger.info(f"[Community Build] Successfully completed build for graph_id={graph_id}, version={build_version}")
        return True
        
    except ImportError as e:
        logger.warning(f"[Community Build] Required packages not installed: {e}")
        logger.warning("[Community Build] Install with: pip install python-igraph leidenalg")
        return False
    except Exception as e:
        logger.error(f"[Community Build] Failed to build communities: {e}", exc_info=True)
        return False

