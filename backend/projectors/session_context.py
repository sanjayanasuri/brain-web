"""Session context projector - derives session context from events."""
from typing import Dict, List, Optional
from datetime import datetime
from pydantic import BaseModel, Field

from events.schema import EventEnvelope, EventType, ObjectRef
from events.store import get_event_store
from .read_model import get_read_model_store


class ActiveConcept(BaseModel):
    """Active concept with weight."""
    concept_id: str
    weight: float = Field(..., ge=0.0, le=1.0)
    name: Optional[str] = None


class ActiveObject(BaseModel):
    """Active object (claim or document)."""
    object_type: str  # "claim" or "document"
    object_id: str
    relevance_score: float = Field(..., ge=0.0, le=1.0)


class SessionContext(BaseModel):
    """Derived session context from events."""
    session_id: str
    active_concepts: List[ActiveConcept] = Field(default_factory=list)
    active_objects: List[ActiveObject] = Field(default_factory=list)
    uncertainty_score: float = Field(default=0.5, ge=0.0, le=1.0)
    last_updated: datetime


class SessionContextProjector:
    """Projects session context from events."""
    
    def __init__(self, use_read_model: bool = True):
        """
        Initialize projector.
        
        Args:
            use_read_model: If True, persist context to Neo4j read model store
        """
        self.store = get_event_store()
        self.read_model_store = get_read_model_store() if use_read_model else None
        # In-memory cache for context (fallback if read model unavailable)
        self._context_cache: Dict[str, SessionContext] = {}
    
    def project(self, session_id: str) -> SessionContext:
        """
        Project session context from all events for a session.
        
        Args:
            session_id: Session identifier
            
        Returns:
            SessionContext derived from events
        """
        # Replay all events for the session
        events = self.store.replay(session_id)
        
        # Initialize context
        context = SessionContext(
            session_id=session_id,
            last_updated=datetime.utcnow()
        )
        
        # Track concept weights
        concept_weights: Dict[str, float] = {}
        concept_names: Dict[str, str] = {}
        
        # Track active objects
        active_objects: Dict[str, ActiveObject] = {}
        
        # Process events chronologically
        for event in events:
            if event.event_type == EventType.USER_VIEWED:
                # User viewed a concept - increase weight
                if event.object_ref and event.object_ref.type == "concept":
                    concept_id = event.object_ref.id
                    concept_weights[concept_id] = concept_weights.get(concept_id, 0.0) + 0.2
                    if "name" in event.payload:
                        concept_names[concept_id] = event.payload["name"]
            
            elif event.event_type == EventType.CHAT_MESSAGE_CREATED:
                # Chat message - extract mentioned concepts from payload
                if "mentioned_concepts" in event.payload:
                    for concept_info in event.payload["mentioned_concepts"]:
                        concept_id = concept_info.get("concept_id")
                        if concept_id:
                            concept_weights[concept_id] = concept_weights.get(concept_id, 0.0) + 0.15
                            if "name" in concept_info:
                                concept_names[concept_id] = concept_info["name"]
            
            elif event.event_type == EventType.SOURCE_CAPTURED:
                # Source captured - add as active object
                if event.object_ref:
                    obj_key = f"{event.object_ref.type}:{event.object_ref.id}"
                    active_objects[obj_key] = ActiveObject(
                        object_type=event.object_ref.type,
                        object_id=event.object_ref.id,
                        relevance_score=0.7
                    )
            
            elif event.event_type == EventType.CLAIM_UPSERTED:
                # Claim upserted - add as active object
                if event.object_ref and event.object_ref.type == "claim":
                    obj_key = f"claim:{event.object_ref.id}"
                    active_objects[obj_key] = ActiveObject(
                        object_type="claim",
                        object_id=event.object_ref.id,
                        relevance_score=0.8
                    )
                    # Also boost related concepts
                    if "concept_ids" in event.payload:
                        for concept_id in event.payload["concept_ids"]:
                            concept_weights[concept_id] = concept_weights.get(concept_id, 0.0) + 0.1
        
        # Normalize concept weights (cap at 1.0)
        for concept_id in concept_weights:
            concept_weights[concept_id] = min(concept_weights[concept_id], 1.0)
        
        # Build active concepts list (top 10 by weight)
        sorted_concepts = sorted(
            concept_weights.items(),
            key=lambda x: x[1],
            reverse=True
        )[:10]
        
        context.active_concepts = [
            ActiveConcept(
                concept_id=concept_id,
                weight=weight,
                name=concept_names.get(concept_id)
            )
            for concept_id, weight in sorted_concepts
        ]
        
        # Build active objects list (top 20)
        context.active_objects = list(active_objects.values())[:20]
        
        # Compute uncertainty score (inverse of activity)
        # More events = lower uncertainty
        event_count = len(events)
        if event_count == 0:
            context.uncertainty_score = 1.0
        elif event_count < 5:
            context.uncertainty_score = 0.8
        elif event_count < 10:
            context.uncertainty_score = 0.5
        else:
            context.uncertainty_score = 0.2
        
        context.last_updated = datetime.utcnow()
        
        # Save to read model store if available
        if self.read_model_store:
            try:
                # Note: This requires a Neo4j session, which we don't have here
                # The read model will be saved by the caller or background task
                pass
            except Exception:
                pass
        
        # Cache context
        self._context_cache[session_id] = context
        
        return context
    
    def project_and_save(self, session_id: str, neo4j_session) -> SessionContext:
        """
        Project context and save to read model store.
        
        Args:
            session_id: Session identifier
            neo4j_session: Neo4j session for saving read model
            
        Returns:
            SessionContext
        """
        context = self.project(session_id)
        
        # Save to read model store
        if self.read_model_store:
            try:
                self.read_model_store.save_session_context(neo4j_session, context)
            except Exception as e:
                import logging
                logging.getLogger("brain_web").warning(f"Failed to save session context: {e}")
        
        return context
    
    def update_context(self, session_id: str) -> SessionContext:
        """
        Update and return session context.
        
        This is a convenience method that projects and caches the context.
        In a production system, you might want to store this in a read model.
        
        Args:
            session_id: Session identifier
            
        Returns:
            Updated SessionContext
        """
        return self.project(session_id)
    
    def get_context(self, session_id: str, neo4j_session=None) -> Optional[SessionContext]:
        """
        Get cached context, from read model, or project if not available.
        
        Args:
            session_id: Session identifier
            neo4j_session: Optional Neo4j session for loading from read model
            
        Returns:
            SessionContext or None if no events exist
        """
        # Try cache first
        if session_id in self._context_cache:
            return self._context_cache[session_id]
        
        # Try read model store
        if self.read_model_store and neo4j_session:
            try:
                context = self.read_model_store.load_session_context(neo4j_session, session_id)
                if context:
                    self._context_cache[session_id] = context
                    return context
            except Exception:
                pass
        
        # Fall back to projection
        try:
            return self.project(session_id)
        except Exception:
            return None

