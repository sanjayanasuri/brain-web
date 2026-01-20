"""User preferences projector - derives user preferences from events."""
from typing import Dict, List, Optional, Set
from datetime import datetime
from pydantic import BaseModel, Field

from events.schema import EventType
from events.store import get_event_store


class UserPreference(BaseModel):
    """A user preference derived from events."""
    preference_type: str  # e.g., "preferred_domain", "preferred_concept", "interaction_style"
    value: str
    confidence: float = Field(..., ge=0.0, le=1.0)
    evidence_count: int = 0


class UserPreferences(BaseModel):
    """Derived user preferences from events."""
    user_id: str
    preferred_domains: List[str] = Field(default_factory=list)
    preferred_concepts: List[str] = Field(default_factory=list)
    interaction_style: str = "exploratory"  # "exploratory", "focused", "mixed"
    last_updated: datetime


class UserPreferencesProjector:
    """Projects user preferences from events."""
    
    def __init__(self):
        """Initialize projector."""
        self.store = get_event_store()
    
    def update_preferences(self, session_id: str) -> UserPreferences:
        """
        Update user preferences from events.
        
        Args:
            session_id: Session identifier (we'll extract user_id from events)
            
        Returns:
            UserPreferences
        """
        # Replay all events for the session
        events = self.store.replay(session_id)
        
        if not events:
            # No events, return default preferences
            return UserPreferences(
                user_id="unknown",
                last_updated=datetime.utcnow()
            )
        
        # Extract user_id from first event
        user_id = events[0].actor_id or "unknown"
        
        # Track domain preferences
        domain_counts: Dict[str, int] = {}
        concept_counts: Dict[str, int] = {}
        interaction_patterns: List[str] = []
        
        # Process events
        for event in events:
            # Track domains from payload
            if "domain" in event.payload:
                domain = event.payload["domain"]
                domain_counts[domain] = domain_counts.get(domain, 0) + 1
            
            # Track concepts
            if event.object_ref and event.object_ref.type == "concept":
                concept_id = event.object_ref.id
                concept_counts[concept_id] = concept_counts.get(concept_id, 0) + 1
            
            # Track interaction patterns
            if event.event_type == EventType.CHAT_MESSAGE_CREATED:
                interaction_patterns.append("chat")
            elif event.event_type == EventType.SOURCE_CAPTURED:
                interaction_patterns.append("capture")
            elif event.event_type == EventType.USER_VIEWED:
                interaction_patterns.append("view")
        
        # Determine interaction style
        chat_count = interaction_patterns.count("chat")
        capture_count = interaction_patterns.count("capture")
        view_count = interaction_patterns.count("view")
        
        total_interactions = len(interaction_patterns)
        if total_interactions == 0:
            interaction_style = "exploratory"
        elif chat_count / total_interactions > 0.5:
            interaction_style = "inquisitive"
        elif capture_count / total_interactions > 0.4:
            interaction_style = "collector"
        elif view_count / total_interactions > 0.6:
            interaction_style = "explorer"
        else:
            interaction_style = "mixed"
        
        # Get top domains (top 5)
        sorted_domains = sorted(
            domain_counts.items(),
            key=lambda x: x[1],
            reverse=True
        )[:5]
        preferred_domains = [domain for domain, _ in sorted_domains]
        
        # Get top concepts (top 10)
        sorted_concepts = sorted(
            concept_counts.items(),
            key=lambda x: x[1],
            reverse=True
        )[:10]
        preferred_concepts = [concept_id for concept_id, _ in sorted_concepts]
        
        return UserPreferences(
            user_id=user_id,
            preferred_domains=preferred_domains,
            preferred_concepts=preferred_concepts,
            interaction_style=interaction_style,
            last_updated=datetime.utcnow()
        )

