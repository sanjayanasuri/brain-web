import sys
import os
import socket
import logging
import traceback
import time
import uuid
import json
from pathlib import Path
from urllib.parse import urlparse
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request, HTTPException, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.exceptions import RequestValidationError
from fastapi.staticfiles import StaticFiles



from api_auth import router as auth_router
from api_health import router as health_router
from services_user import init_user_db
from api_concepts import router as concepts_router
from api_ai import router as ai_router
from api_retrieval import router as retrieval_router
from api_lectures import router as lectures_router
from api_lecture_links import router as lecture_links_router, sections_router as lecture_sections_router
from api_mentions import router as mentions_router
from api_admin import router as admin_router
from api_notion import router as notion_router
from api_preferences import router as preferences_router
from api_feedback import router as feedback_router
# Debug router - only include in development
debug_router = None
if os.getenv("NODE_ENV", "development") != "production":
    try:
        from api_debug import router as debug_router
    except ImportError:
        pass
from api_answers import router as answers_router
from api_resources import router as resources_router
from api_tests import router as tests_router
from api_gaps import router as gaps_router
from api_graphs import router as graphs_router
from api_branches import router as branches_router
from api_contextual_branches import router as contextual_branches_router
from api_notes_digest import router as notes_digest_router
from api_snapshots import router as snapshots_router
from api_events import router as events_router, sessions_router
from api_events_replay import router as events_replay_router
from api_review import router as review_router
from api_suggestions import router as suggestions_router
from api_connectors import router as connectors_router
from api_finance_ingestion import router as finance_ingestion_router
from api_finance import router as finance_router
from api_ingestion_runs import router as ingestion_runs_router
from api_paths import router as paths_router
from api_quality import router as quality_router
from api_web_ingestion import router as web_ingestion_router
from api_pdf_ingestion import router as pdf_ingestion_router
from api_quotes import router as quotes_router
from api_claims_from_quotes import router as claims_from_quotes_router
from api_signals import router as signals_router
from api_voice import router as voice_router
from api_voice_agent import router as voice_agent_router
from api_note_images import router as note_images_router
from api_extend import router as extend_router
from api_trails import router as trails_router
from api_offline import router as offline_router
from api_sync import router as sync_router
from api_dashboard import router as dashboard_router
from api_exams import router as exams_router
from api_calendar import router as calendar_router
from api_scheduler import tasks_router, schedule_router

# Phase 4: Analytics router
try:
    from routers.analytics import router as analytics_router
except ImportError:
    analytics_router = None


from auth import (
    get_user_context_from_request,
    is_public_endpoint,
    require_auth,
)
from middleware_timeout import TimeoutMiddleware
from config import REQUEST_TIMEOUT_SECONDS

# Configure logging
logging.basicConfig(level=logging.INFO, format="%(message)s")
logger = logging.getLogger("brain_web")

# --- Dev-only route introspection helpers ---
# These are intentionally simple and only enabled outside production.
_ENABLE_DEBUG_INTROSPECTION = os.getenv("NODE_ENV", "development") != "production"

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

        parsed = urlparse(NEO4J_URI)
        neo4j_host = parsed.hostname or "localhost"
        neo4j_port = parsed.port or 7687

        if not _is_tcp_reachable(neo4j_host, neo4j_port):
            msg = f"Neo4j not reachable at {neo4j_host}:{neo4j_port}; skipping CSV auto-import."
            print(f"[SYNC] ⚠ {msg}")
            logger.warning(msg)
        else:
            # Skip CSV auto-import on startup to avoid re-importing data that already exists
            # CSV import should be manual via /admin/import endpoint
            # This prevents duplicate nodes when CSV files contain old data from different graphs
            print("[SYNC] ⚠ Skipping CSV auto-import on startup (use /admin/import to import manually)")
            logger.info("Skipping CSV auto-import on startup - use /admin/import for manual imports")
    except Exception as e:
        print(f"[SYNC] ✗ Error during startup: {e}")
        logger.error(f"Error during startup: {e}", exc_info=True)
    
    # Always try to initialize user database
    try:
        init_user_db()
    except Exception as e:
        print(f"Warning: Failed to initialize user database: {e}")
    
    # Start Notion auto-sync background loop if enabled
    from config import ENABLE_NOTION_AUTO_SYNC
    if ENABLE_NOTION_AUTO_SYNC:
        import asyncio
        from service_notion_sync import sync_once
        
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
    
    # Start event projection background task queue
    try:
        from events.background import get_task_queue
        get_task_queue()  # Initialize and start worker
        print("[Events] Background projection task queue started")
    except Exception as e:
        print(f"[Events] ⚠ Failed to start projection queue: {e}")
        logger.warning(f"Failed to start event projection queue: {e}")
    
    # Start AI task queue for voice commands and background tasks
    try:
        from services_task_queue import get_task_queue as get_ai_task_queue
        get_ai_task_queue()  # Initialize and start worker
        print("[Tasks] Background AI task queue started")
    except Exception as e:
        print(f"[Tasks] ⚠ Failed to start AI task queue: {e}")
        logger.warning(f"Failed to start AI task queue: {e}")
    
    yield  # App runs here
    
    # Shutdown
    try:
        from events.background import _task_queue
        if _task_queue:
            _task_queue.stop_worker()
            print("[Events] Background projection task queue stopped")
    except Exception:
        pass
    
    try:
        from services_task_queue import _task_queue as ai_task_queue
        if ai_task_queue:
            ai_task_queue.stop_worker()
            print("[Tasks] Background AI task queue stopped")
    except Exception:
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
    "http://localhost:3001",
    "http://127.0.0.1:3001",
    "https://sanjayanasuri.com",
    "https://demo.sanjayanasuri.com",
    "https://www.demo.sanjayanasuri.com",
    "https://brain-web-delta.vercel.app",
    "https://brain-web-git-main-sanjayanasuris-projects.vercel.app",
    "https://brain-htt06gwfr-sanjayanasuris-projects.vercel.app",
    # Railway domains (will be auto-detected)
    os.getenv("RAILWAY_PUBLIC_DOMAIN", ""),
    os.getenv("RAILWAY_STATIC_URL", ""),
    os.getenv("FRONTEND_URL", ""),
    # Ensure Railway domains are prefixed with https:// if not already
]

# Ensure Railway domains have schemes
for i, domain in enumerate(origins):
    if domain and not domain.startswith("http"):
        origins[i] = f"https://{domain}"

# Allow additional origins via env (comma-separated)
extra_origins = [
    origin.strip()
    for origin in os.getenv("CORS_ALLOW_ORIGINS", "").split(",")
    if origin.strip()
]
origins.extend(extra_origins)
origins = [origin for origin in origins if origin]  # Remove empty strings

# Filter out '*' if credentials are True (FastAPI requirement)
if "*" in origins:
    origins = [o for o in origins if o != "*"]

# CORS configuration added later to ensure it wraps all other middlewares

# Add timeout middleware (after CORS, before auth)
app.add_middleware(TimeoutMiddleware)

app.include_router(auth_router)
app.include_router(health_router)
app.include_router(concepts_router)
app.include_router(ai_router)
app.include_router(retrieval_router)
app.include_router(lectures_router)
app.include_router(lecture_links_router)
app.include_router(lecture_sections_router)
app.include_router(mentions_router)
app.include_router(preferences_router)
app.include_router(feedback_router)
app.include_router(answers_router)
app.include_router(resources_router)
app.include_router(gaps_router)
app.include_router(graphs_router)
app.include_router(branches_router)
app.include_router(contextual_branches_router)
app.include_router(notes_digest_router)
app.include_router(snapshots_router)
app.include_router(events_router)
app.include_router(sessions_router)
app.include_router(events_replay_router)
app.include_router(review_router)
app.include_router(suggestions_router)
app.include_router(finance_router)
app.include_router(paths_router)
app.include_router(quality_router)
# Web ingestion router is always included but has local-only guard
app.include_router(web_ingestion_router)
# PDF ingestion router for ingesting PDFs into the knowledge graph
app.include_router(pdf_ingestion_router)
# Phase 2: Evidence Graph endpoints
app.include_router(quotes_router)
app.include_router(claims_from_quotes_router)
# Phase D: Whiteboard/photo note images
app.include_router(note_images_router)
# Learning State Engine: Signals and Voice
app.include_router(signals_router)
app.include_router(voice_router)
app.include_router(voice_agent_router)
# Phase 3: Extend system
app.include_router(extend_router)
# Phase 4: Trails system
app.include_router(trails_router)
# Phase 5: Offline system
app.include_router(offline_router)
# Sync system (capture selection, events)
app.include_router(sync_router)
# Dashboard and study analytics
app.include_router(dashboard_router)
app.include_router(exams_router)
# Calendar events (native calendar functionality)
app.include_router(calendar_router)
# Smart Scheduler (tasks and plan suggestions)
app.include_router(tasks_router)
app.include_router(schedule_router)
# Unified workflows (Capture → Explore → Synthesize)
from api_workflows import router as workflows_router
app.include_router(workflows_router)
# Session events and context API
from api_sessions_events import router as sessions_events_router
app.include_router(sessions_events_router)
# Session websocket API
from api_sessions_websocket import router as sessions_websocket_router
app.include_router(sessions_websocket_router)
# Web search API (native Brain Web web search)
from api_web_search import router as web_search_router
app.include_router(web_search_router)

# Deep Research API
from api_deep_research import router as deep_research_router
app.include_router(deep_research_router)

# Adaptive Learning System (Phase 1: Selection → Context → Clarify)
from routers.study import router as study_router
app.include_router(study_router)

# Phase 4: Analytics
if analytics_router:
    app.include_router(analytics_router)

# Include all routers
app.include_router(admin_router)
app.include_router(notion_router)
if debug_router:
    app.include_router(debug_router)
app.include_router(tests_router)
app.include_router(connectors_router)
app.include_router(finance_ingestion_router)
app.include_router(ingestion_runs_router)


if _ENABLE_DEBUG_INTROSPECTION:
    @app.get("/__debug/routes")
    async def __debug_routes():
        """Return registered routes for debugging local dev issues."""
        items = []
        for r in app.router.routes:
            methods = sorted(getattr(r, "methods", []) or [])
            path = getattr(r, "path", None) or getattr(r, "path_format", None)
            name = getattr(r, "name", None)
            items.append({"path": path, "methods": methods, "name": name})
        return {"count": len(items), "routes": items}

    @app.get("/__debug/contextual-branches")
    async def __debug_contextual_branches():
        """
        Confirm the imported module file and router routes for contextual branches.
        """
        try:
            import api_contextual_branches as m  # type: ignore
            router = getattr(m, "router", None)
            router_routes = []
            if router is not None:
                for r in getattr(router, "routes", []) or []:
                    router_routes.append(
                        {
                            "path": getattr(r, "path", None) or getattr(r, "path_format", None),
                            "methods": sorted(getattr(r, "methods", []) or []),
                            "name": getattr(r, "name", None),
                        }
                    )
            return {
                "module_file": getattr(m, "__file__", None),
                "router_prefix": getattr(router, "prefix", None) if router is not None else None,
                "router_routes_count": len(router_routes),
                "router_routes": router_routes,
            }
        except Exception as e:
            return {"error": str(e)}


@app.middleware("http")
async def auth_middleware(request: Request, call_next):
    """
    Authentication middleware.
    
    Flow:
    1. Extract request metadata (request_id, session_id, client_ip)
    2. Check if endpoint is public (skip auth if so)
    3. Extract user/tenant context from auth token
    4. Attach context to request.state for downstream use
    5. Log request metrics
    """
    start = time.perf_counter()
    request_id = request.headers.get("x-request-id") or uuid.uuid4().hex
    session_id = request.headers.get("x-session-id") or request.cookies.get("bw_session_id") or uuid.uuid4().hex
    client_ip = request.headers.get("x-forwarded-for", "").split(",")[0].strip() if request.headers.get("x-forwarded-for") else (request.client.host if request.client else "unknown")

    # Attach basic context
    request.state.request_id = request_id
    request.state.session_id = session_id
    request.state.client_ip = client_ip

    # demo_settings moved up to check before 401
    from demo_mode import load_demo_settings, enforce_demo_mode_request, FixedWindowRateLimiter
    
    # Simple global limiter for the middleware
    if not hasattr(app.state, "demo_limiter"):
        app.state.demo_limiter = FixedWindowRateLimiter()
    
    demo_settings = load_demo_settings()
    path = request.url.path

    is_public = is_public_endpoint(path)
    if is_public:
        # Public endpoint - no auth strictly required by middleware
        user_context = {
            "user_id": "public",
            "tenant_id": "public",
            "is_authenticated": False,
        }
    else:
        # Extract user context from auth token
        user_context = get_user_context_from_request(request)
        
        # In Demo Mode, elevate unauthenticated users BEFORE the strict 401 check
        if demo_settings.demo_mode and not user_context["is_authenticated"]:
            user_context = {
                "user_id": "guest",
                "tenant_id": demo_settings.tenant_id,
                "is_authenticated": True, # Elevate to allowed for demo purposes
            }
        
        # If still not authenticated and not a public endpoint, require auth
        if not user_context["is_authenticated"]:
            return JSONResponse(
                status_code=401,
                content={"detail": "Authentication required"}
            )
    
    # Attach user/tenant context to request state
    request.state.user_id = user_context.get("user_id")
    request.state.tenant_id = user_context.get("tenant_id") or request.headers.get("x-tenant-id")
    request.state.is_authenticated = user_context.get("is_authenticated", False)

    if demo_settings.demo_mode:
        try:
            enforce_demo_mode_request(request, demo_settings, app.state.demo_limiter)
        except HTTPException as e:
            return JSONResponse(status_code=e.status_code, content={"detail": e.detail})

    try:
        response = await call_next(request)
    except HTTPException as e:
        response = JSONResponse(status_code=e.status_code, content={"detail": e.detail})
    except Exception:
        # Let exception handlers do sanitization; still record metrics/logs here
        raise
    finally:
        latency_ms = int((time.perf_counter() - start) * 1000)
        status_code = getattr(locals().get("response"), "status_code", 500)

        log_data = {
            "event": "request",
            "request_id": request_id,
            "session_id": session_id,
            "route": path,
            "method": request.method,
            "status": status_code,
            "latency_ms": latency_ms,
            "user_id": request.state.user_id if hasattr(request.state, "user_id") else None,
            "tenant_id": request.state.tenant_id if hasattr(request.state, "tenant_id") else None,
            "is_authenticated": request.state.is_authenticated if hasattr(request.state, "is_authenticated") else False,
        }
        logger.info(json.dumps(log_data, separators=(",", ":"), ensure_ascii=False))

    # Set response headers
    if isinstance(response, Response):
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
    Logs the error with appropriate level and returns JSON response with CORS headers.
    """
    if exc.status_code >= 500:
        logger.error(f"HTTP {exc.status_code} error on {request.method} {request.url.path}: {exc.detail}")
    else:
        logger.warning(f"HTTP {exc.status_code} error on {request.method} {request.url.path}: {exc.detail}")
    
    response = JSONResponse(status_code=exc.status_code, content={"detail": exc.detail})
    
    # Ensure CORS visibility
    origin = request.headers.get("origin")
    if origin:
        response.headers["Access-Control-Allow-Origin"] = origin
        response.headers["Access-Control-Allow-Credentials"] = "true"
    return response


@app.exception_handler(RequestValidationError)
async def validation_exception_handler(request: Request, exc: RequestValidationError):
    """
    Handle request validation errors (422).
    """
    logger.warning(f"Validation error on {request.method} {request.url.path}: {exc.errors()}")
    from fastapi.encoders import jsonable_encoder
    response = JSONResponse(status_code=422, content={"detail": jsonable_encoder(exc.errors())})
    
    origin = request.headers.get("origin")
    if origin:
        response.headers["Access-Control-Allow-Origin"] = origin
        response.headers["Access-Control-Allow-Credentials"] = "true"
    return response


@app.exception_handler(Exception)
async def general_exception_handler(request: Request, exc: Exception):
    """
    Catch-all handler for unhandled exceptions.
    Detects Neo4j connection issues and returns a graceful fallback in Demo mode.
    """
    # Detect Neo4j connection issues
    exc_name = type(exc).__name__
    is_neo4j_error = "neo4j" in str(type(exc)).lower() or "ServiceUnavailable" in exc_name or "ConnectionRefused" in exc_name
    
    if is_neo4j_error:
        logger.warning(f"Neo4j connection error detected: {exc}")
        response = JSONResponse(
            status_code=503,
            content={
                "detail": "Knowledge graph database (Neo4j) is unreachable. Running in offline/demo mode.",
                "code": "DATABASE_UNREACHABLE",
                "nodes": [], 
                "edges": [],
                "meta": {"total_nodes": 0, "total_edges": 0, "offline": True}
            }
        )
    else:
        logger.exception(f"Unhandled exception on {request.method} {request.url.path}: {exc}")
        response = JSONResponse(status_code=500, content={"detail": "Internal server error"})
    
    # Ensure CORS headers are present even when bypassing middleware
    origin = request.headers.get("origin")
    if origin:
        response.headers["Access-Control-Allow-Origin"] = origin
        response.headers["Access-Control-Allow-Credentials"] = "true"
        response.headers["Access-Control-Allow-Methods"] = "*"
        response.headers["Access-Control-Allow-Headers"] = "*"
        
    return response



# Finalize CORS as the outermost middleware
# We add it last so that it wraps all other middlewares (including Auth and Timeout)
# This ensures CORS headers are added even to 401 and 504 responses.
from fastapi.middleware.cors import CORSMiddleware
from config import ENABLE_EXTENSION_DEV

# Add regex patterns for Chrome extensions, localhost, local network IPs,
# and production frontend domains (to avoid brittle allowlists).
origin_regexes = [
    # Prod frontends (allow optional ports)
    r"https?://.*\.sanjayanasuri\.com(?::\d+)?",
    r"https?://.*\.vercel\.app(?::\d+)?",
    r"https?://.*\.up\.railway\.app(?::\d+)?",
    r"https?://brain-web-.*",
]

if ENABLE_EXTENSION_DEV:
    origin_regexes.append(r"chrome-extension://.*")
    origin_regexes.append(r"http://localhost:\d+")
    origin_regexes.append(r"http://127\.0\.0\.1:\d+")
    origin_regexes.append(r"http://192\.168\.\d+\.\d+:\d+")
else:
    # Always allow local network IPs for mobile development
    origin_regexes.append(r"http://192\.168\.\d+\.\d+:\d+")
    origin_regexes.append(r"http://10\.\d+\.\d+\.\d+:\d+")
    origin_regexes.append(r"http://172\.(1[6-9]|2[0-9]|3[0-1])\.\d+\.\d+:\d+")

extra_origin_regex = os.getenv("CORS_ALLOW_ORIGIN_REGEX", "").strip()
if extra_origin_regex:
    origin_regexes.append(extra_origin_regex)

# Handle wildcard case for origin_regexes if it was in origins
if os.getenv("CORS_ALLOW_ORIGINS") == "*":
    # If wildcard is set, allow everything via regex BUT still allow credentials
    # Use a broad regex that matches common schemes
    origin_regexes.append(r"https?://.*")

cors_kwargs = {
    "allow_origins": origins,
    "allow_credentials": True,
    "allow_methods": ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    "allow_headers": ["*"],
    "expose_headers": ["x-request-id", "x-session-id"],
    "max_age": 600,
}
if origin_regexes:
    # Always allow localhost ports in development
    origin_regexes.append(r"http://localhost:\d+")
    origin_regexes.append(r"http://127\.0\.0\.1:\d+")
    cors_kwargs["allow_origin_regex"] = "(" + "|".join(origin_regexes) + ")"

app.add_middleware(
    CORSMiddleware,
    **cors_kwargs,
)


@app.get("/")
def read_root():
    return {"status": "ok", "message": "Brain Web backend is running"}

