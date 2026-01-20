"""Abstract base class for event stores."""
from abc import ABC, abstractmethod
from typing import List, Optional
from datetime import datetime

from ..schema import EventEnvelope


class EventStore(ABC):
    """Abstract interface for event storage."""
    
    @abstractmethod
    def append(self, event: EventEnvelope) -> None:
        """
        Append an event to the store.
        
        Must be idempotent: if an event with the same idempotency_key
        already exists, it should be a no-op.
        
        Args:
            event: Event envelope to append
            
        Raises:
            ValueError: If event validation fails
        """
        pass
    
    @abstractmethod
    def list_events(
        self,
        session_id: str,
        after_ts: Optional[datetime] = None,
        limit: int = 100
    ) -> List[EventEnvelope]:
        """
        List events for a session, optionally after a timestamp.
        
        Args:
            session_id: Session identifier
            after_ts: Optional timestamp to filter events after
            limit: Maximum number of events to return
            
        Returns:
            List of event envelopes, ordered by occurred_at ascending
        """
        pass
    
    @abstractmethod
    def replay(self, session_id: str) -> List[EventEnvelope]:
        """
        Replay all events for a session.
        
        Args:
            session_id: Session identifier
            
        Returns:
            List of all event envelopes for the session, ordered by occurred_at ascending
        """
        pass

