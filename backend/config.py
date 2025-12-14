import os
from pathlib import Path
from dotenv import load_dotenv

# Load environment variables in priority order:
# 1. backend/.env (lowest priority)
# 2. repo_root/.env (overrides backend)
# 3. repo_root/.env.local (highest priority - overrides everything)
# This allows repo-level .env.local to override backend/.env
repo_root = Path(__file__).parent.parent
env_local = repo_root / ".env.local"
env_file = repo_root / ".env"
backend_env = Path(__file__).parent / ".env"

# Load in priority order: backend first, then repo root (with override=True for repo files)
if backend_env.exists():
    load_dotenv(dotenv_path=backend_env, override=False)
if env_file.exists():
    load_dotenv(dotenv_path=env_file, override=True)  # Repo .env overrides backend
if env_local.exists():
    load_dotenv(dotenv_path=env_local, override=True)  # Repo .env.local has highest priority

# Neo4j configuration - read from environment variables
# For Docker dev, these should match docker-compose.yml settings
NEO4J_URI = os.getenv("NEO4J_URI", "bolt://localhost:7687")
NEO4J_USER = os.getenv("NEO4J_USER", "neo4j")
NEO4J_PASSWORD = os.getenv("NEO4J_PASSWORD")  # Required - no default for security

# For future AI integration
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")

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

# -----------------------------------------------------------------------------
# Demo mode (production demo guardrails)
# -----------------------------------------------------------------------------
DEMO_MODE = os.getenv("DEMO_MODE", "false").lower() in ("true", "1", "yes")
# Hard default: deny writes in demo unless explicitly overridden
DEMO_ALLOW_WRITES = os.getenv("DEMO_ALLOW_WRITES", "false").lower() in ("true", "1", "yes")
# Force demo tenant (client-supplied tenant is ignored in demo mode)
DEMO_TENANT_ID = os.getenv("DEMO_TENANT_ID", "demo")
# Force demo graph_id to isolate demo data from personal data
DEMO_GRAPH_ID = os.getenv("DEMO_GRAPH_ID", "demo")
# Optional allow-list for POST/PUT/PATCH/DELETE routes in demo mode
# Example: "/ai/chat,/ai/semantic-search,/feedback"
DEMO_SAFE_WRITE_PATHS = [p.strip() for p in os.getenv("DEMO_SAFE_WRITE_PATHS", "/ai/chat,/ai/semantic-search,/events").split(",") if p.strip()]

# App-level rate limiting (complements WAF rate-based rules)
DEMO_RATE_LIMIT_PER_IP_PER_MIN = int(os.getenv("DEMO_RATE_LIMIT_PER_IP_PER_MIN", "120"))
DEMO_RATE_LIMIT_PER_SESSION_PER_MIN = int(os.getenv("DEMO_RATE_LIMIT_PER_SESSION_PER_MIN", "60"))

# Bedrock caps (server-side only; enforced in demo mode if Bedrock is enabled later)
DEMO_BEDROCK_MAX_TOKENS_PER_SESSION = int(os.getenv("DEMO_BEDROCK_MAX_TOKENS_PER_SESSION", "4000"))
