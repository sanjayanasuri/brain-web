"""Event store implementations."""
from .base import EventStore
from .factory import get_event_store

__all__ = ["EventStore", "get_event_store"]

