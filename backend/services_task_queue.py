"""
Background task queue for AI tasks (voice commands, etc.).

Similar to events/background.py but for Task processing.
"""
import logging
from typing import Optional
from queue import Queue, Empty
from threading import Thread

from db_neo4j import get_neo4j_session
from services_task_processor import process_task

logger = logging.getLogger("brain_web")


class TaskQueue:
    """Simple in-memory task queue for AI tasks."""
    
    def __init__(self):
        """Initialize task queue."""
        self.queue: Queue = Queue()
        self.processing: set[str] = set()  # Track tasks being processed
        self.worker_thread: Optional[Thread] = None
        self.running = False
    
    def enqueue(self, task_id: str):
        """
        Enqueue a task for processing.
        
        Args:
            task_id: Task ID to process
        """
        if task_id not in self.processing:
            self.queue.put(task_id)
            logger.debug(f"Enqueued task {task_id}")
    
    def start_worker(self):
        """Start background worker thread."""
        if self.running:
            return
        
        self.running = True
        
        def worker():
            """Worker thread that processes tasks."""
            while self.running:
                try:
                    task_id = self.queue.get(timeout=1.0)
                    self.processing.add(task_id)
                    
                    try:
                        # Get Neo4j session for task processing
                        neo4j_session = next(get_neo4j_session())
                        try:
                            process_task(neo4j_session, task_id)
                            logger.info(f"Processed task {task_id}")
                        finally:
                            neo4j_session.close()
                    except Exception as e:
                        logger.error(f"Failed to process task {task_id}: {e}", exc_info=True)
                    finally:
                        self.processing.discard(task_id)
                        self.queue.task_done()
                        
                except Empty:
                    continue
                except Exception as e:
                    logger.error(f"Error in task worker: {e}", exc_info=True)
        
        self.worker_thread = Thread(target=worker, daemon=True)
        self.worker_thread.start()
        logger.info("Task queue worker started")
    
    def stop_worker(self):
        """Stop background worker thread."""
        self.running = False
        if self.worker_thread:
            self.worker_thread.join(timeout=5.0)
        logger.info("Task queue worker stopped")


# Global task queue instance
_task_queue: Optional[TaskQueue] = None


def get_task_queue() -> TaskQueue:
    """Get or create global task queue."""
    global _task_queue
    if _task_queue is None:
        _task_queue = TaskQueue()
        _task_queue.start_worker()
    return _task_queue


def enqueue_task(task_id: str):
    """
    Enqueue a task to run in background.
    
    Args:
        task_id: Task ID to process
    """
    queue = get_task_queue()
    queue.enqueue(task_id)
