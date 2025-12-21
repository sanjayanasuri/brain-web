from fastapi import FastAPI, Request, HTTPException, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.exceptions import RequestValidationError
from fastapi.staticfiles import StaticFiles
from contextlib import asynccontextmanager
import logging
import traceback
import os
import socket
import time
import uuid
import json
from pathlib import Path
from urllib.parse import urlparse

from api_concepts import router as concepts_router
from api_ai import router as ai_router
from api_retrieval import router as retrieval_router
from api_lectures import router as lectures_router
from api_admin import router as admin_router
from api_notion import router as notion_router
from api_preferences import router as preferences_router
from api_feedback import router as feedback_router
from api_teaching_style import router as teaching_style_router
from api_debug import router as debug_router
from api_answers import router as answers_router
from api_resources import router as resources_router
from api_tests import router as tests_router
from api_gaps import router as gaps_router
from api_graphs import router as graphs_router
from api_branches import router as branches_router
from api_snapshots import router as snapshots_router
from api_events import router as events_router, sessions_router
from api_review import router as review_router
from api_suggestions import router as suggestions_router
from api_connectors import router as connectors_router
from api_finance_ingestion import router as finance_ingestion_router
from api_finance import router as finance_router
from api_ingestion_runs import router as ingestion_runs_router
from api_paths import router as paths_router
from api_quality import router as quality_router
from api_web_ingestion import router as web_ingestion_router

from demo_mode import (
    FixedWindowRateLimiter,
    enforce_demo_mode_request,
    get_or_create_session_id,
    get_client_ip,
    load_demo_settings,
    set_session_cookie,
    structured_log_line,
)

# Configure logging
logging.basicConfig(level=logging.INFO, format="%(message)s")
logger = logging.getLogger("brain_web")

demo_settings = load_demo_settings()
rate_limiter = FixedWindowRateLimiter()

def _is_tcp_reachable(host: str, port: int, timeout_s: float = 0.4) -> bool:
    """
    Best-effort reachability check to avoid noisy startup failures when Neo4j
    isn't running locally.
    """
    try:
        with socket.create_connection((host, port), timeout=timeout_s):
            return True
    except OSError:
        return False


@asynccontextmanager
async def lifespan(app: FastAPI):
    """
    Lifespan context manager for startup and shutdown events.
    Replaces deprecated @app.on_event("startup") pattern.
    """
    # Startup
    try:
        from config import NEO4J_URI
        from config import DEMO_MODE

        parsed = urlparse(NEO4J_URI)
        neo4j_host = parsed.hostname or "localhost"
        neo4j_port = parsed.port or 7687

        if DEMO_MODE:
            msg = "DEMO_MODE enabled; skipping CSV auto-import on startup."
            print(f"[SYNC] ⚠ {msg}")
            logger.info(structured_log_line({"event": "startup_skip_import", "reason": "demo_mode"}))
        elif not _is_tcp_reachable(neo4j_host, neo4j_port):
            msg = f"Neo4j not reachable at {neo4j_host}:{neo4j_port}; skipping CSV auto-import."
            print(f"[SYNC] ⚠ {msg}")
            logger.warning(msg)
        else:
            print("[SYNC] Starting CSV auto-import on startup...")
            logger.info("Starting CSV auto-import on startup...")
            from scripts import import_csv_to_neo4j
            import_csv_to_neo4j.main()
            print("[SYNC] ✓ CSV auto-import completed successfully")
            logger.info("CSV auto-import completed successfully")
    except FileNotFoundError as e:
        print(f"[SYNC] ⚠ CSV files not found, skipping import: {e}")
        logger.warning(f"CSV files not found, skipping import: {e}")
    except Exception as e:
        print(f"[SYNC] ✗ Error during CSV auto-import: {e}")
        logger.error(f"Error during CSV auto-import: {e}", exc_info=True)
        # Don't crash the app if import fails
    
    # Start Notion auto-sync background loop if enabled (dev-only; never in demo mode)
    from config import ENABLE_NOTION_AUTO_SYNC, DEMO_MODE
    if ENABLE_NOTION_AUTO_SYNC and not DEMO_MODE:
        import asyncio
        from notion_sync import sync_once
        
        async def notion_sync_loop():
            """
            Background loop that syncs Notion every 5 minutes.
            
            Note: This checks for updated pages by querying Notion API.
            Future optimization: Cache page metadata to reduce API calls.
            """
            while True:
                try:
                    await asyncio.sleep(300)  # Wait 5 minutes (300 seconds) before first sync
                    print("[Notion Sync] Running automatic sync...")
                    result = sync_once()
                    print(f"[Notion Sync] Done: {result}")
                except Exception as e:
                    print(f"[Notion Sync] Error: {e}")
                    logger.error(f"Notion sync error: {e}", exc_info=True)
                    # Continue loop even on error
        
        asyncio.create_task(notion_sync_loop())
        print("[Notion Sync] Background auto-sync enabled (runs every 5 minutes)")
    
    yield  # App runs here
    
    # Shutdown (if needed in the future)
    pass


app = FastAPI(
    title="Brain Web Backend",
    description="Backend API for my personal knowledge graph + AI system.",
    version="0.1.0",
    lifespan=lifespan,
)

origins = [
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    "https://sanjayanasuri.com",
    "https://demo.sanjayanasuri.com",
    "https://www.demo.sanjayanasuri.com",
    "https://brain-web-delta.vercel.app",
    "https://brain-web-git-main-sanjayanasuris-projects.vercel.app",
    "https://brain-htt06gwfr-sanjayanasuris-projects.vercel.app",
]

# CORS configuration
cors_kwargs = {
    "allow_origins": origins,
    "allow_credentials": True,
    "allow_methods": ["*"],
    "allow_headers": ["*"],
}

# Add regex patterns for Chrome extensions and localhost dev when enabled
from config import ENABLE_EXTENSION_DEV
if ENABLE_EXTENSION_DEV:
    cors_kwargs["allow_origin_regex"] = r"(chrome-extension://.*|http://localhost:\d+|http://127\.0\.0\.1:\d+)"

app.add_middleware(
    CORSMiddleware,
    **cors_kwargs,
)

app.include_router(concepts_router)
app.include_router(ai_router)
app.include_router(retrieval_router)
app.include_router(lectures_router)
app.include_router(preferences_router)
app.include_router(feedback_router)
app.include_router(teaching_style_router)
app.include_router(answers_router)
app.include_router(resources_router)
app.include_router(gaps_router)
app.include_router(graphs_router)
app.include_router(branches_router)
app.include_router(snapshots_router)
app.include_router(events_router)
app.include_router(sessions_router)
app.include_router(review_router)
app.include_router(suggestions_router)
app.include_router(finance_router)
app.include_router(paths_router)
app.include_router(quality_router)
# Web ingestion router is always included but has local-only guard
app.include_router(web_ingestion_router)

# In demo mode we do not mount private/admin/debug/test/ingestion surfaces.
if not demo_settings.demo_mode:
    app.include_router(admin_router)
    app.include_router(notion_router)
    app.include_router(debug_router)
    app.include_router(tests_router)
    app.include_router(connectors_router)
    app.include_router(finance_ingestion_router)
    app.include_router(ingestion_runs_router)


@app.middleware("http")
async def demo_gate_and_observability(request: Request, call_next):
    start = time.perf_counter()
    request_id = request.headers.get("x-request-id") or uuid.uuid4().hex
    session_id = get_or_create_session_id(request)
    client_ip = get_client_ip(request)

    # Attach context for downstream usage
    request.state.request_id = request_id
    request.state.session_id = session_id
    request.state.client_ip = client_ip
    request.state.tenant_id = demo_settings.tenant_id if demo_settings.demo_mode else request.headers.get("x-tenant-id")

    try:
        enforce_demo_mode_request(request, demo_settings, rate_limiter)
        response = await call_next(request)
    except HTTPException as e:
        response = JSONResponse(status_code=e.status_code, content={"detail": e.detail})
    except Exception:
        # Let exception handlers do sanitization; still record metrics/logs here
        raise
    finally:
        latency_ms = int((time.perf_counter() - start) * 1000)
        status_code = getattr(locals().get("response"), "status_code", 500)

        logger.info(
            structured_log_line(
                {
                    "event": "request",
                    "request_id": request_id,
                    "session_id": session_id,
                    "route": request.url.path,
                    "method": request.method,
                    "status": status_code,
                    "latency_ms": latency_ms,
                    "tenant_id": request.state.tenant_id if hasattr(request.state, "tenant_id") else None,
                    "demo_mode": demo_settings.demo_mode,
                    "allow_writes": demo_settings.allow_writes,
                }
            )
        )

    # Ensure session cookie exists
    if isinstance(response, Response):
        if request.cookies.get("bw_session_id") != session_id:
            set_session_cookie(response, session_id)
        response.headers["x-request-id"] = request_id
    return response

# Mount static files for uploaded resources
# This serves files from the uploaded_resources directory at /static/resources/
UPLOAD_DIR = os.environ.get("RESOURCE_UPLOAD_DIR", "uploaded_resources")
upload_path = Path(__file__).parent / UPLOAD_DIR
upload_path.mkdir(exist_ok=True)  # Create directory if it doesn't exist
app.mount("/static/resources", StaticFiles(directory=str(upload_path)), name="static_resources")


# Centralized error handling
@app.exception_handler(HTTPException)
async def http_exception_handler(request: Request, exc: HTTPException):
    """
    Handle HTTP exceptions (4xx, 5xx).
    Logs the error with appropriate level and returns JSON response.
    """
    # Log 4xx errors at WARNING level, 5xx at ERROR level
    if exc.status_code >= 500:
        logger.error(
            f"HTTP {exc.status_code} error on {request.method} {request.url.path}",
            extra={
                "status_code": exc.status_code,
                "method": request.method,
                "path": request.url.path,
                "detail": exc.detail,
            },
            exc_info=True,
        )
    else:
        logger.warning(
            f"HTTP {exc.status_code} error on {request.method} {request.url.path}: {exc.detail}",
            extra={
                "status_code": exc.status_code,
                "method": request.method,
                "path": request.url.path,
                "detail": exc.detail,
            },
        )
    
    from config import DEMO_MODE
    if DEMO_MODE and exc.status_code >= 500:
        return JSONResponse(status_code=exc.status_code, content={"detail": "Internal server error"})
    return JSONResponse(status_code=exc.status_code, content={"detail": exc.detail})


@app.exception_handler(RequestValidationError)
async def validation_exception_handler(request: Request, exc: RequestValidationError):
    """
    Handle request validation errors (422).
    These are client errors, so log at WARNING level.
    """
    logger.warning(
        f"Validation error on {request.method} {request.url.path}",
        extra={
            "method": request.method,
            "path": request.url.path,
            "errors": exc.errors(),
        },
    )
    return JSONResponse(
        status_code=422,
        content={"detail": exc.errors()},
    )


@app.exception_handler(Exception)
async def general_exception_handler(request: Request, exc: Exception):
    """
    Catch-all handler for unhandled exceptions.
    Logs full stack trace but returns sanitized error message to client.
    """
    logger.exception(
        f"Unhandled exception on {request.method} {request.url.path}",
        extra={
            "method": request.method,
            "path": request.url.path,
            "exception_type": type(exc).__name__,
            "exception_message": str(exc),
        },
    )
    
    # Return sanitized error message (don't leak internal details)
    return JSONResponse(
        status_code=500,
        content={"detail": "Internal server error"},
    )


@app.get("/")
def read_root():
    return {"status": "ok", "message": "Brain Web backend is running"}
