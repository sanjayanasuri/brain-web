import logging
import os
from pathlib import Path
from urllib.parse import urlparse
from dotenv import load_dotenv

_log = logging.getLogger("brain_web")

repo_root = Path(__file__).parent.parent
env_local = repo_root / ".env.local"
env_file = repo_root / ".env"
backend_env = Path(__file__).parent / ".env"

# Load environment variables in priority order:
# 1) backend/.env (lowest)
# 2) repo_root/.env (overrides backend)
# 3) repo_root/.env.local (highest)
ENVIRONMENT = os.getenv("ENVIRONMENT", "development")  # "production" or "development"

if backend_env.exists():
    load_dotenv(dotenv_path=backend_env, override=False)
if env_file.exists():
    load_dotenv(dotenv_path=env_file, override=True)
if env_local.exists():
    load_dotenv(dotenv_path=env_local, override=True)



# For cloud deployments (Railway/Aura), we prefer the single URI
# Local fallback remains bolt://127.0.0.1:7687
NEO4J_URI = os.getenv("NEO4J_URI") or os.getenv("NEO4J_URL") or "bolt://127.0.0.1:7687"
NEO4J_USER = os.getenv("NEO4J_USER", "neo4j")
NEO4J_PASSWORD = os.getenv("NEO4J_PASSWORD")  # Required - no default for security
NEO4J_DATABASE = os.getenv("NEO4J_DATABASE", "neo4j")

# For future AI integration
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")
EXA_API_KEY = os.getenv("EXA_API_KEY")

# Explicit feedback classifier fallback (cheap model; only for ambiguous feedback notes).
ENABLE_FEEDBACK_CLASSIFIER_FALLBACK = os.getenv(
    "ENABLE_FEEDBACK_CLASSIFIER_FALLBACK", "true"
).lower() in ("true", "1", "yes")
FEEDBACK_CLASSIFIER_MIN_CONFIDENCE = float(
    os.getenv("FEEDBACK_CLASSIFIER_MIN_CONFIDENCE", "0.62")
)

# Voice learning-signal extraction fallback:
# keep deterministic heuristics as primary; use cheap LLM parsing for missed phrasings.
ENABLE_VOICE_SIGNAL_LLM_FALLBACK = os.getenv(
    "ENABLE_VOICE_SIGNAL_LLM_FALLBACK", "true"
).lower() in ("true", "1", "yes")
VOICE_SIGNAL_LLM_MIN_CONFIDENCE = float(
    os.getenv("VOICE_SIGNAL_LLM_MIN_CONFIDENCE", "0.62")
)
VOICE_SIGNAL_LLM_MAX_WORDS = int(
    os.getenv("VOICE_SIGNAL_LLM_MAX_WORDS", "28")
)

# Supermemory AI integration
SUPERMEMORY_API_KEY = os.getenv("SUPERMEMORY_API_KEY")

# PersonaPlex / Voice Streaming configuration
PERSONAPLEX_URL = os.getenv("PERSONAPLEX_URL")
VOICE_AGENT_NAME = os.getenv("VOICE_AGENT_NAME", "Learning Companion")

# Notion API integration
NOTION_API_KEY = os.getenv("NOTION_API_KEY")
BRAINWEB_API_BASE = os.getenv("BRAINWEB_API_BASE", "http://127.0.0.1:8000")

# Notion sync configuration
NOTION_DATABASE_IDS_STR = os.getenv("NOTION_DATABASE_IDS", "")
NOTION_DATABASE_IDS = [
    db_id.strip() for db_id in NOTION_DATABASE_IDS_STR.split(",") if db_id.strip()
] if NOTION_DATABASE_IDS_STR else []

# Enable Notion auto-sync background loop (dev-only)
ENABLE_NOTION_AUTO_SYNC = os.getenv("ENABLE_NOTION_AUTO_SYNC", "false").lower() in ("true", "1", "yes")

# Enable Chrome extension and localhost CORS regex patterns (dev-only)
ENABLE_EXTENSION_DEV = os.getenv("ENABLE_EXTENSION_DEV", "false").lower() in ("true", "1", "yes")

# Proposed edge visibility threshold (for auto mode)
PROPOSED_VISIBILITY_THRESHOLD = float(os.getenv("PROPOSED_VISIBILITY_THRESHOLD", "0.85"))

# Performance and timeout configuration
REQUEST_TIMEOUT_SECONDS = float(os.getenv("REQUEST_TIMEOUT_SECONDS", "300"))  # 5 minutes default
NEO4J_QUERY_TIMEOUT_SECONDS = float(os.getenv("NEO4J_QUERY_TIMEOUT_SECONDS", "60"))  # 1 minute default
DEFAULT_PAGE_SIZE = int(os.getenv("DEFAULT_PAGE_SIZE", "20"))
MAX_PAGE_SIZE = int(os.getenv("MAX_PAGE_SIZE", "100"))

# Voice agent performance configuration
VOICE_AGENT_CACHE_TTL_SECONDS = int(os.getenv("VOICE_AGENT_CACHE_TTL_SECONDS", "300"))  # 5 minutes
VOICE_SESSION_HISTORY_LIMIT = int(os.getenv("VOICE_SESSION_HISTORY_LIMIT", "20"))  # Keep last 20 interactions
VOICE_CONTEXT_MAX_LENGTH = int(os.getenv("VOICE_CONTEXT_MAX_LENGTH", "2000"))  # Max context chars
VOICE_MEMORY_CONTEXT_MAX_LENGTH = int(os.getenv("VOICE_MEMORY_CONTEXT_MAX_LENGTH", "1000"))  # Max memory context chars
VOICE_CONCEPT_EXTRACTION_MAX_TOKENS = int(os.getenv("VOICE_CONCEPT_EXTRACTION_MAX_TOKENS", "500"))
VOICE_ARTICLE_TEXT_MAX_LENGTH = int(os.getenv("VOICE_ARTICLE_TEXT_MAX_LENGTH", "50000"))  # Max article text to index

# Voice agent LLM parameters
VOICE_AGENT_MAX_TOKENS = int(os.getenv("VOICE_AGENT_MAX_TOKENS", "220"))  # Max tokens for voice responses
VOICE_AGENT_TEMPERATURE = float(os.getenv("VOICE_AGENT_TEMPERATURE", "0.7"))  # Temperature for voice responses
VOICE_CONCEPT_CONFIDENCE_THRESHOLD = float(os.getenv("VOICE_CONCEPT_CONFIDENCE_THRESHOLD", "0.7"))  # Min confidence for concept extraction
VOICE_SESSION_HISTORY_LLM_LIMIT = int(os.getenv("VOICE_SESSION_HISTORY_LLM_LIMIT", "5"))  # History limit for LLM context
VOICE_MEMORY_CONTEXT_LIMIT = int(os.getenv("VOICE_MEMORY_CONTEXT_LIMIT", "3"))  # Max memory items in context
VOICE_SPEECH_RATE_SLOW = float(os.getenv("VOICE_SPEECH_RATE_SLOW", "0.9"))
VOICE_SPEECH_RATE_NORMAL = float(os.getenv("VOICE_SPEECH_RATE_NORMAL", "1.15"))
VOICE_SPEECH_RATE_FAST = float(os.getenv("VOICE_SPEECH_RATE_FAST", "1.6"))
VOICE_SPEECH_CHARS_PER_MS = float(os.getenv("VOICE_SPEECH_CHARS_PER_MS", "55"))  # Characters per millisecond for speech duration estimate
VOICE_SPEECH_MIN_DURATION_MS = int(os.getenv("VOICE_SPEECH_MIN_DURATION_MS", "800"))  # Minimum speech duration in ms
VOICE_STOP_TEXT_MIN_LENGTH = int(os.getenv("VOICE_STOP_TEXT_MIN_LENGTH", "3"))  # Min remaining text length to process after stop
VOICE_INTERRUPT_MAX_WORDS = int(os.getenv("VOICE_INTERRUPT_MAX_WORDS", "5"))  # Max words in interrupt-only command

# Web search API guardrails
WEB_SEARCH_RATE_LIMIT_PER_MINUTE = int(os.getenv("WEB_SEARCH_RATE_LIMIT_PER_MINUTE", "60"))

# Memory promotion thresholds (short -> active -> long-term)
MEMORY_PROMOTION_MIN_CONFIDENCE = float(os.getenv("MEMORY_PROMOTION_MIN_CONFIDENCE", "0.60"))
MEMORY_ACTIVE_THRESHOLD = float(os.getenv("MEMORY_ACTIVE_THRESHOLD", "0.72"))
MEMORY_LONGTERM_THRESHOLD = float(os.getenv("MEMORY_LONGTERM_THRESHOLD", "0.86"))

# PDF ingestion limits
PDF_MAX_FILE_SIZE_MB = int(os.getenv("PDF_MAX_FILE_SIZE_MB", "50"))  # 50MB default
PDF_MAX_FILE_SIZE_BYTES = PDF_MAX_FILE_SIZE_MB * 1024 * 1024
PDF_MAX_PAGES = int(os.getenv("PDF_MAX_PAGES", "1000"))  # Max pages to process
PDF_RATE_LIMIT_PER_MINUTE = int(os.getenv("PDF_RATE_LIMIT_PER_MINUTE", "10"))  # 10 PDFs per minute per user

# Storage configuration (for resource files)
# Set STORAGE_BACKEND=s3 to use S3, otherwise uses local filesystem (default, no cost)
STORAGE_BACKEND = os.getenv("STORAGE_BACKEND", "local").lower()
S3_BUCKET = os.getenv("S3_BUCKET")  # Required if STORAGE_BACKEND=s3
S3_REGION = os.getenv("S3_REGION", "us-east-1")
S3_PREFIX = os.getenv("S3_PREFIX", "resources")  # S3 key prefix for all resources

# Qdrant Vector Database configuration
# Support Railway's service discovery via environment variables
QDRANT_HOST = os.getenv("QDRANT_HOST") or os.getenv("QDRANT_PRIVATE_HOST") or os.getenv("RAILWAY_TCP_PROXY_DOMAIN") or "127.0.0.1"
QDRANT_PORT = int(os.getenv("QDRANT_PORT", "6333"))
QDRANT_COLLECTION = os.getenv("QDRANT_COLLECTION", "concepts")
USE_QDRANT = os.getenv("USE_QDRANT", "true").lower() in ("true", "1", "yes")  # Enable Qdrant by default

# Unified content pipeline collections (Phase 0 contract).
# Keep these separate from the existing concepts collection to avoid mixing payload schemas.
QDRANT_COLLECTION_CONTENT_ITEM_TEXT = os.getenv("QDRANT_COLLECTION_CONTENT_ITEM_TEXT", "content_item_text")
QDRANT_COLLECTION_TRANSCRIPT_CHUNKS = os.getenv("QDRANT_COLLECTION_TRANSCRIPT_CHUNKS", "transcript_chunks")

# PostgreSQL configuration (for event store)
# Support Railway's DATABASE_URL format: postgresql://user:pass@host:port/db
DATABASE_URL = os.getenv("DATABASE_URL")
if DATABASE_URL:
    # Parse Railway's DATABASE_URL format
    parsed = urlparse(DATABASE_URL)
    POSTGRES_HOST = parsed.hostname or os.getenv("POSTGRES_HOST", "127.0.0.1")
    POSTGRES_PORT = parsed.port or int(os.getenv("POSTGRES_PORT", "5432"))
    POSTGRES_DB = parsed.path.lstrip("/") or os.getenv("POSTGRES_DB", "brainweb")
    POSTGRES_USER = parsed.username or os.getenv("POSTGRES_USER", "brainweb")
    POSTGRES_PASSWORD = parsed.password or os.getenv("POSTGRES_PASSWORD", "brainweb")
    POSTGRES_CONNECTION_STRING = DATABASE_URL
    _log.debug("Postgres: using DATABASE_URL (host=%s port=%s)", POSTGRES_HOST, POSTGRES_PORT)
else:
    _log.debug("Postgres: DATABASE_URL not set, using individual POSTGRES_* vars")
    # Fallback to individual env vars
    POSTGRES_HOST = os.getenv("POSTGRES_HOST", "127.0.0.1")
    POSTGRES_PORT = int(os.getenv("POSTGRES_PORT", "5432"))
    POSTGRES_DB = os.getenv("POSTGRES_DB", "brainweb")
    POSTGRES_USER = os.getenv("POSTGRES_USER", "brainweb")
    POSTGRES_PASSWORD = os.getenv("POSTGRES_PASSWORD", "brainweb")
    POSTGRES_CONNECTION_STRING = os.getenv(
        "POSTGRES_CONNECTION_STRING",
        f"postgresql://{POSTGRES_USER}:{POSTGRES_PASSWORD}@{POSTGRES_HOST}:{POSTGRES_PORT}/{POSTGRES_DB}"
    )

# Redis configuration (for caching)
# Support Railway's REDIS_URL format: redis://:password@host:port
REDIS_URL = os.getenv("REDIS_URL") or os.getenv("REDIS_PRIVATE_URL")
if REDIS_URL:
    try:
        parsed = urlparse(REDIS_URL)
        REDIS_HOST = parsed.hostname or os.getenv("REDIS_HOST", "localhost")
        REDIS_PORT = parsed.port or int(os.getenv("REDIS_PORT", "6379"))
        REDIS_PASSWORD = parsed.password or None
        REDIS_DB = int(parsed.path.lstrip("/") or os.getenv("REDIS_DB", "0"))
    except Exception:
        # If parsing fails, fall back to simple individual vars
        REDIS_HOST = os.getenv("REDIS_HOST", "127.0.0.1")
        REDIS_PORT = int(os.getenv("REDIS_PORT", "6379"))
        REDIS_PASSWORD = os.getenv("REDIS_PASSWORD")
        REDIS_DB = int(os.getenv("REDIS_DB", "0"))
else:
    REDIS_HOST = os.getenv("REDIS_HOST", "127.0.0.1")
    REDIS_PORT = int(os.getenv("REDIS_PORT", "6379"))
    REDIS_PASSWORD = os.getenv("REDIS_PASSWORD")
    REDIS_DB = int(os.getenv("REDIS_DB", "0"))
USE_REDIS = os.getenv("USE_REDIS", "true").lower() in ("true", "1", "yes")  # Enable Redis by default

# Ingest API rate limits (per user, fixed window per minute).
INGEST_RATE_LIMIT_PER_MINUTE = int(os.getenv("INGEST_RATE_LIMIT_PER_MINUTE", "60"))

# Content pipeline worker controls.
ENABLE_CONTENT_PIPELINE_WORKER = os.getenv("ENABLE_CONTENT_PIPELINE_WORKER", "true").lower() in ("true", "1", "yes")
CONTENT_PIPELINE_MAX_JOB_ATTEMPTS = int(os.getenv("CONTENT_PIPELINE_MAX_JOB_ATTEMPTS", "5"))

# Demo Mode configuration
DEMO_MODE = os.getenv("DEMO_MODE", "false").lower() in ("true", "1", "yes")
DEMO_ALLOW_WRITES = os.getenv("DEMO_ALLOW_WRITES", "false").lower() in ("true", "1", "yes")
DEMO_TENANT_ID = os.getenv("DEMO_TENANT_ID", "demo")
DEMO_SAFE_WRITE_PATHS = [
    p.strip() for p in os.getenv("DEMO_SAFE_WRITE_PATHS", "/feedback").split(",") if p.strip()
]
DEMO_RATE_LIMIT_PER_IP_PER_MIN = int(os.getenv("DEMO_RATE_LIMIT_PER_IP_PER_MIN", "60"))
DEMO_RATE_LIMIT_PER_SESSION_PER_MIN = int(os.getenv("DEMO_RATE_LIMIT_PER_SESSION_PER_MIN", "30"))
DEMO_BEDROCK_MAX_TOKENS_PER_SESSION = int(os.getenv("DEMO_BEDROCK_MAX_TOKENS_PER_SESSION", "50000"))

# Voice Activity Detection (VAD) configuration
VAD_ENGINE = os.getenv("VAD_ENGINE", "silero").lower()  # "silero" or "energy"
SILERO_VAD_MODEL_PATH = os.getenv("SILERO_VAD_MODEL_PATH", "/app/models/silero_vad.jit")
SILERO_VAD_THRESHOLD = float(os.getenv("SILERO_VAD_THRESHOLD", "0.5"))  # Detection threshold (0.0-1.0)
SILERO_VAD_SAMPLING_RATE = int(os.getenv("SILERO_VAD_SAMPLING_RATE", "16000"))  # 8000 or 16000 Hz

# Energy VAD fallback configuration (if VAD_ENGINE=energy)
ENERGY_VAD_THRESHOLD = float(os.getenv("ENERGY_VAD_THRESHOLD", "0.03"))
ENERGY_VAD_FRAME_LENGTH_MS = int(os.getenv("ENERGY_VAD_FRAME_LENGTH_MS", "30"))
