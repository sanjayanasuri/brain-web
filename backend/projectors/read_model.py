"""Read model storage for projected data."""
import json
from typing import Optional, Dict, Any, TYPE_CHECKING
from datetime import datetime
from neo4j import Session

if TYPE_CHECKING:
    from .session_context import SessionContext


class ReadModelStore:
    """Stores read models (projected data) in Neo4j."""
    
    def save_session_context(self, session: Session, context: "SessionContext") -> None:
        """
        Save session context to Neo4j.
        
        Args:
            session: Neo4j session
            context: SessionContext to save
        """
        query = """
        MERGE (sc:SessionContext {session_id: $session_id})
        SET sc.active_concepts = $active_concepts,
            sc.active_objects = $active_objects,
            sc.uncertainty_score = $uncertainty_score,
            sc.last_updated = $last_updated
        RETURN sc.session_id AS session_id
        """
        
        active_concepts_json = [
            {
                "concept_id": c.concept_id,
                "weight": c.weight,
                "name": c.name,
            }
            for c in context.active_concepts
        ]
        
        active_objects_json = [
            {
                "object_type": o.object_type,
                "object_id": o.object_id,
                "relevance_score": o.relevance_score,
            }
            for o in context.active_objects
        ]
        
        session.run(
            query,
            session_id=context.session_id,
            active_concepts=json.dumps(active_concepts_json),
            active_objects=json.dumps(active_objects_json),
            uncertainty_score=context.uncertainty_score,
            last_updated=context.last_updated.isoformat(),
        )
    
    def load_session_context(self, session: Session, session_id: str) -> Optional["SessionContext"]:
        """
        Load session context from Neo4j.
        
        Args:
            session: Neo4j session
            session_id: Session identifier
            
        Returns:
            SessionContext or None if not found
        """
        query = """
        MATCH (sc:SessionContext {session_id: $session_id})
        RETURN sc.active_concepts AS active_concepts,
               sc.active_objects AS active_objects,
               sc.uncertainty_score AS uncertainty_score,
               sc.last_updated AS last_updated
        LIMIT 1
        """
        
        result = session.run(query, session_id=session_id)
        record = result.single()
        
        if not record:
            return None
        
        from .session_context import ActiveConcept, ActiveObject
        
        active_concepts = []
        if record["active_concepts"]:
            concepts_data = json.loads(record["active_concepts"])
            active_concepts = [
                ActiveConcept(**c) for c in concepts_data
            ]
        
        active_objects = []
        if record["active_objects"]:
            objects_data = json.loads(record["active_objects"])
            active_objects = [
                ActiveObject(**o) for o in objects_data
            ]
        
        from .session_context import SessionContext
        return SessionContext(
            session_id=session_id,
            active_concepts=active_concepts,
            active_objects=active_objects,
            uncertainty_score=record["uncertainty_score"],
            last_updated=datetime.fromisoformat(record["last_updated"]),
        )


# Global read model store instance
_read_model_store: Optional[ReadModelStore] = None


def get_read_model_store() -> ReadModelStore:
    """Get or create global read model store."""
    global _read_model_store
    if _read_model_store is None:
        _read_model_store = ReadModelStore()
    return _read_model_store

