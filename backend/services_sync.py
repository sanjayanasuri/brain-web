"""
Service for automatic CSV export synchronization.
Provides helper functions to export CSV files after mutations.
"""
import logging
from typing import Optional
from fastapi import BackgroundTasks

logger = logging.getLogger(__name__)


def auto_export_csv(background_tasks: Optional[BackgroundTasks] = None):
    """
    Automatically export Neo4j graph to CSV files.
    Can be called directly (synchronous) or as a background task (async).
    
    Args:
        background_tasks: If provided, export runs in background. Otherwise, runs synchronously.
    """
    def _export():
        try:
            print("[SYNC] Starting auto-export to CSV...")
            from scripts import export_csv_from_neo4j
            export_csv_from_neo4j.main()
            print("[SYNC] ✓ Auto-export to CSV completed successfully")
            logger.info("Auto-export to CSV completed successfully")
        except Exception as e:
            print(f"[SYNC] ✗ Error during auto-export to CSV: {e}")
            logger.error(f"Error during auto-export to CSV: {e}", exc_info=True)
            # Don't raise - export failures shouldn't break API responses
    
    if background_tasks:
        background_tasks.add_task(_export)
    else:
        _export()

