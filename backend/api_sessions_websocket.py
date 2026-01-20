"""WebSocket endpoint for real-time session context updates."""
from fastapi import APIRouter, WebSocket, WebSocketDisconnect, Depends
from typing import Dict, Set
import json
import asyncio
import logging

from projectors.session_context import SessionContextProjector
from db_neo4j import get_neo4j_session

logger = logging.getLogger("brain_web")

router = APIRouter(prefix="/api/sessions", tags=["sessions-websocket"])

# Track active WebSocket connections
_active_connections: Dict[str, Set[WebSocket]] = {}


class ConnectionManager:
    """Manages WebSocket connections for session context updates."""
    
    def __init__(self):
        self.active_connections: Dict[str, Set[WebSocket]] = {}
    
    async def connect(self, websocket: WebSocket, session_id: str):
        """Accept WebSocket connection and add to active connections."""
        await websocket.accept()
        if session_id not in self.active_connections:
            self.active_connections[session_id] = set()
        self.active_connections[session_id].add(websocket)
        logger.info(f"WebSocket connected for session {session_id}")
    
    def disconnect(self, websocket: WebSocket, session_id: str):
        """Remove WebSocket connection."""
        if session_id in self.active_connections:
            self.active_connections[session_id].discard(websocket)
            if not self.active_connections[session_id]:
                del self.active_connections[session_id]
        logger.info(f"WebSocket disconnected for session {session_id}")
    
    async def send_context_update(self, session_id: str, context: dict):
        """Send context update to all connections for a session."""
        if session_id not in self.active_connections:
            return
        
        message = json.dumps({
            "type": "context_update",
            "session_id": session_id,
            "context": context,
        })
        
        disconnected = set()
        for websocket in self.active_connections[session_id]:
            try:
                await websocket.send_text(message)
            except Exception as e:
                logger.warning(f"Failed to send WebSocket message: {e}")
                disconnected.add(websocket)
        
        # Clean up disconnected sockets
        for ws in disconnected:
            self.disconnect(ws, session_id)


_manager = ConnectionManager()


@router.websocket("/{session_id}/context/stream")
async def websocket_context_stream(
    websocket: WebSocket,
    session_id: str,
):
    """
    WebSocket endpoint for real-time session context updates.
    
    Client connects and receives context updates whenever the session context changes.
    """
    await _manager.connect(websocket, session_id)
    
    try:
        # Send initial context
        try:
            neo4j_session = next(get_neo4j_session())
            try:
                projector = SessionContextProjector(use_read_model=True)
                context = projector.get_context(session_id, neo4j_session=neo4j_session)
                if context:
                    await websocket.send_text(json.dumps({
                        "type": "initial_context",
                        "session_id": session_id,
                        "context": context.dict(),
                    }))
            finally:
                neo4j_session.close()
        except Exception as e:
            logger.error(f"Failed to send initial context: {e}")
        
        # Keep connection alive and handle incoming messages
        while True:
            try:
                # Wait for ping or close message
                data = await asyncio.wait_for(websocket.receive_text(), timeout=30.0)
                # Echo ping messages
                if data == "ping":
                    await websocket.send_text("pong")
            except asyncio.TimeoutError:
                # Send keepalive ping
                await websocket.send_text("ping")
            except WebSocketDisconnect:
                break
    except WebSocketDisconnect:
        pass
    finally:
        _manager.disconnect(websocket, session_id)


# Function to notify WebSocket clients when context updates
async def notify_context_update(session_id: str):
    """Notify WebSocket clients of context update."""
    try:
        neo4j_session = next(get_neo4j_session())
        try:
            projector = SessionContextProjector(use_read_model=True)
            context = projector.get_context(session_id, neo4j_session=neo4j_session)
            if context:
                await _manager.send_context_update(session_id, context.dict())
        finally:
            neo4j_session.close()
    except Exception as e:
        logger.error(f"Failed to notify context update: {e}")

