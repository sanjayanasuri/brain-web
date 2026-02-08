import os
from pathlib import Path
from urllib.parse import urlparse
from dotenv import load_dotenv

repo_root = Path(__file__).parent.parent
env_local = repo_root / ".env.local"
env_file = repo_root / ".env"
backend_env = Path(__file__).parent / ".env"

# Load environment variables in priority order:
# 1) backend/.env (lowest)
# 2) repo_root/.env (overrides backend)
# 3) repo_root/.env.local (highest)
if backend_env.exists():
    load_dotenv(dotenv_path=backend_env, override=False)
if env_file.exists():
    load_dotenv(dotenv_path=env_file, override=True)
if env_local.exists():
    load_dotenv(dotenv_path=env_local, override=True)

# Load in priority order: backend first, then repo root (with override=True for repo files)
if backend_env.exists():
    load_dotenv(dotenv_path=backend_env, override=False)
if env_file.exists():
    load_dotenv(dotenv_path=env_file, override=True)  # Repo .env overrides backend
if env_local.exists():
    load_dotenv(dotenv_path=env_local, override=True)  # Repo .env.local has highest priority

# For cloud deployments (Railway/Aura), we prefer the single URI
# Local fallback remains bolt://127.0.0.1:7687
NEO4J_URI = os.getenv("NEO4J_URI") or os.getenv("NEO4J_URL") or "bolt://127.0.0.1:7687"
NEO4J_USER = os.getenv("NEO4J_USER", "neo4j")
NEO4J_PASSWORD = os.getenv("NEO4J_PASSWORD")  # Required - no default for security
NEO4J_DATABASE = os.getenv("NEO4J_DATABASE", "neo4j")

# For future AI integration
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")

# Supermemory AI integration
SUPERMEMORY_API_KEY = os.getenv("SUPERMEMORY_API_KEY")

# PersonaPlex / Voice Streaming configuration
PERSONAPLEX_URL = os.getenv("PERSONAPLEX_URL")
VOICE_AGENT_NAME = os.getenv("VOICE_AGENT_NAME", "Learning Companion")

# Notion API integration
NOTION_API_KEY = os.getenv("NOTION_API_KEY")
BRAINWEB_API_BASE = os.getenv("BRAINWEB_API_BASE", "http://127.0.0.1:8000")
PERPLEXICA_URL = os.getenv("PERPLEXICA_URL", "http://127.0.0.1:3000")

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

# PDF ingestion limits
PDF_MAX_FILE_SIZE_MB = int(os.getenv("PDF_MAX_FILE_SIZE_MB", "50"))  # 50MB default
PDF_MAX_FILE_SIZE_BYTES = PDF_MAX_FILE_SIZE_MB * 1024 * 1024
PDF_MAX_PAGES = int(os.getenv("PDF_MAX_PAGES", "1000"))  # Max pages to process
PDF_RATE_LIMIT_PER_MINUTE = int(os.getenv("PDF_RATE_LIMIT_PER_MINUTE", "10"))  # 10 PDFs per minute per user

# SEC EDGAR API User-Agent (required by SEC)
SEC_USER_AGENT = os.getenv("SEC_USER_AGENT", "BrainWeb/1.0 contact@example.com")

# Finance skill IDs (kept for reference, or remove if unused)
BROWSER_USE_FINANCE_DISCOVERY_SKILL_ID = os.getenv("BROWSER_USE_FINANCE_DISCOVERY_SKILL_ID")
BROWSER_USE_FINANCE_TRACKER_SKILL_ID = os.getenv("BROWSER_USE_FINANCE_TRACKER_SKILL_ID")

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
    print(f"DEBUG: DATABASE_URL found. Host: {POSTGRES_HOST}, Port: {POSTGRES_PORT}")
    print(f"DEBUG: Connection string: {POSTGRES_CONNECTION_STRING}")
else:
    print("DEBUG: DATABASE_URL not found, using individual vars")
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
