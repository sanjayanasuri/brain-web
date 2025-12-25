"""
Service for automatic CSV export synchronization.
Provides helper functions to export CSV files after mutations.
"""
import logging
from typing import Optional
from fastapi import BackgroundTasks

logger = logging.getLogger(__name__)


def auto_export_csv(background_tasks: Optional[BackgroundTasks] = None, export_per_graph: bool = True, graph_id: Optional[str] = None):
    """
    Automatically export Neo4j graph to CSV files.
    Can be called directly (synchronous) or as a background task (async).
    
    Args:
        background_tasks: If provided, export runs in background. Otherwise, runs synchronously.
        export_per_graph: If True (default), also exports separate CSV files for each graph.
                         Files will be named like nodes_G{graph_id}.csv
        graph_id: If provided, only export this specific graph. If None, export all graphs.
                  This is more efficient when you only modified one graph.
    """
    def _export():
        try:
            if graph_id:
                print(f"[SYNC] Starting auto-export to CSV for graph: {graph_id}...")
            else:
                print("[SYNC] Starting auto-export to CSV (all graphs)...")
            from scripts import export_csv_from_neo4j
            export_csv_from_neo4j.main(graph_id=graph_id, export_per_graph=export_per_graph)
            if graph_id:
                print(f"[SYNC] ✓ Auto-export to CSV completed successfully for graph: {graph_id}")
            else:
                print("[SYNC] ✓ Auto-export to CSV completed successfully")
            logger.info(f"Auto-export to CSV completed successfully (graph_id={graph_id})")
        except Exception as e:
            print(f"[SYNC] ✗ Error during auto-export to CSV: {e}")
            logger.error(f"Error during auto-export to CSV: {e}", exc_info=True)
            # Don't raise - export failures shouldn't break API responses
    
    if background_tasks:
        background_tasks.add_task(_export)
    else:
        _export()

