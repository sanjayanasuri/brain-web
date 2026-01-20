"""Background task processing for event projection."""
import asyncio
import logging
from typing import Set, Optional
from datetime import datetime
from queue import Queue, Empty
from threading import Thread

logger = logging.getLogger("brain_web")


class ProjectionTaskQueue:
    """Simple in-memory task queue for projection tasks."""
    
    def __init__(self):
        """Initialize task queue."""
        self.queue: Queue = Queue()
        self.processing: Set[str] = set()  # Track sessions being processed
        self.worker_thread: Optional[Thread] = None
        self.running = False
    
    def enqueue(self, session_id: str, projector_name: str = "session_context"):
        """
        Enqueue a projection task.
        
        Args:
            session_id: Session to project
            projector_name: Name of projector to run
        """
        if session_id not in self.processing:
            self.queue.put((session_id, projector_name))
            logger.debug(f"Enqueued projection task for session {session_id}")
    
    def start_worker(self):
        """Start background worker thread."""
        if self.running:
            return
        
        self.running = True
        
        def worker():
            """Worker thread that processes tasks."""
            while self.running:
                try:
                    session_id, projector_name = self.queue.get(timeout=1.0)
                    self.processing.add(session_id)
                    
                    try:
                        if projector_name == "session_context":
                            from projectors.session_context import SessionContextProjector
                            from db_neo4j import get_neo4j_session
                            projector = SessionContextProjector()
                            # Get Neo4j session for read model persistence
                            neo4j_session = next(get_neo4j_session())
                            try:
                                projector.project_and_save(session_id, neo4j_session)
                                
                                # Note: WebSocket notifications are handled separately
                                # Clients can poll or we can add async bridge later
                            finally:
                                neo4j_session.close()
                            logger.debug(f"Projected context for session {session_id}")
                        elif projector_name == "user_preferences":
                            from projectors.user_preferences import UserPreferencesProjector
                            projector = UserPreferencesProjector()
                            projector.update_preferences(session_id)
                            logger.debug(f"Projected preferences for session {session_id}")
                    except Exception as e:
                        logger.error(f"Failed to project {projector_name} for session {session_id}: {e}", exc_info=True)
                    finally:
                        self.processing.discard(session_id)
                        self.queue.task_done()
                        
                except Empty:
                    continue
                except Exception as e:
                    logger.error(f"Error in projection worker: {e}", exc_info=True)
        
        self.worker_thread = Thread(target=worker, daemon=True)
        self.worker_thread.start()
        logger.info("Projection task queue worker started")
    
    def stop_worker(self):
        """Stop background worker thread."""
        self.running = False
        if self.worker_thread:
            self.worker_thread.join(timeout=5.0)
        logger.info("Projection task queue worker stopped")


# Global task queue instance
_task_queue: Optional[ProjectionTaskQueue] = None


def get_task_queue() -> ProjectionTaskQueue:
    """Get or create global task queue."""
    global _task_queue
    if _task_queue is None:
        _task_queue = ProjectionTaskQueue()
        _task_queue.start_worker()
    return _task_queue


def enqueue_projection(session_id: str, projector_name: str = "session_context"):
    """
    Enqueue a projection task to run in background.
    
    Args:
        session_id: Session to project
        projector_name: Name of projector to run
    """
    queue = get_task_queue()
    queue.enqueue(session_id, projector_name)

