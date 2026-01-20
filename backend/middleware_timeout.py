"""
Request timeout middleware for FastAPI.

Enforces maximum request duration to prevent long-running requests from blocking resources.
"""
import asyncio
import logging
from fastapi import Request, HTTPException
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import JSONResponse

from config import REQUEST_TIMEOUT_SECONDS

logger = logging.getLogger("brain_web")


class TimeoutMiddleware(BaseHTTPMiddleware):
    """
    Middleware that enforces request timeout.
    
    If a request takes longer than REQUEST_TIMEOUT_SECONDS, it will be cancelled
    and return a 504 Gateway Timeout response.
    """
    
    async def dispatch(self, request: Request, call_next):
        try:
            # Wrap the request in a timeout
            response = await asyncio.wait_for(
                call_next(request),
                timeout=REQUEST_TIMEOUT_SECONDS
            )
            return response
        except asyncio.TimeoutError:
            logger.warning(
                f"Request timeout: {request.method} {request.url.path} exceeded {REQUEST_TIMEOUT_SECONDS}s"
            )
            return JSONResponse(
                status_code=504,
                content={
                    "error": "Gateway Timeout",
                    "message": f"Request exceeded maximum duration of {REQUEST_TIMEOUT_SECONDS} seconds",
                    "timeout_seconds": REQUEST_TIMEOUT_SECONDS,
                }
            )

