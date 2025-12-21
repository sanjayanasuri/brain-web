#!/usr/bin/env python3
"""
Brain Web Doctor - Health check script for all services.

Usage:
    python scripts/doctor.py

Environment variables (optional):
    BACKEND_URL - Backend URL (default: http://127.0.0.1:8000)
    FRONTEND_URL - Frontend URL (default: http://localhost:3000)
    NEO4J_URI - Neo4j URI (default: bolt://localhost:7687)
    NEO4J_USERNAME - Neo4j username (default: neo4j)
    NEO4J_PASSWORD - Neo4j password (required)
"""
import os
import sys
import subprocess
import urllib.request
import urllib.error
import time
from pathlib import Path
from urllib.parse import urlparse

# Add backend to path to import config
backend_dir = Path(__file__).parent.parent / "backend"
sys.path.insert(0, str(backend_dir))

# Load environment variables first (same priority as backend)
repo_root = Path(__file__).parent.parent
env_local = repo_root / ".env.local"
env_file = repo_root / ".env"
backend_env = backend_dir / ".env"

try:
    from dotenv import load_dotenv
    
    if backend_env.exists():
        load_dotenv(dotenv_path=backend_env, override=False)
    if env_file.exists():
        load_dotenv(dotenv_path=env_file, override=True)
    if env_local.exists():
        load_dotenv(dotenv_path=env_local, override=True)
except ImportError:
    pass  # dotenv is optional, we'll use os.getenv

try:
    # Try to import config (may fail if backend not set up)
    try:
        from config import NEO4J_URI, NEO4J_USER, NEO4J_PASSWORD, DEMO_MODE, DEMO_ALLOW_WRITES
    except ImportError:
        # Fallback: read from environment directly
        NEO4J_URI = os.getenv("NEO4J_URI", "bolt://localhost:7687")
        NEO4J_USER = os.getenv("NEO4J_USER", "neo4j")
        NEO4J_PASSWORD = os.getenv("NEO4J_PASSWORD")
        DEMO_MODE = os.getenv("DEMO_MODE", "false").lower() in ("true", "1", "yes")
        DEMO_ALLOW_WRITES = os.getenv("DEMO_ALLOW_WRITES", "false").lower() in ("true", "1", "yes")
    
    from neo4j import GraphDatabase
except ImportError as e:
    print(f"[FAIL] Failed to import required modules: {e}")
    print("Suggested fix: Install backend dependencies: cd backend && pip install -r requirements.txt")
    sys.exit(1)

# Configuration with env overrides
BACKEND_URL = os.getenv("BACKEND_URL", "http://127.0.0.1:8000")
FRONTEND_URL = os.getenv("FRONTEND_URL", "http://localhost:3000")
NEO4J_URI_OVERRIDE = os.getenv("NEO4J_URI")
NEO4J_USERNAME_OVERRIDE = os.getenv("NEO4J_USERNAME") or os.getenv("NEO4J_USER")
NEO4J_PASSWORD_OVERRIDE = os.getenv("NEO4J_PASSWORD")

# Use overrides if provided, otherwise use config values
NEO4J_URI_CHECK = NEO4J_URI_OVERRIDE or NEO4J_URI
NEO4J_USER_CHECK = NEO4J_USERNAME_OVERRIDE or NEO4J_USER
NEO4J_PASSWORD_CHECK = NEO4J_PASSWORD_OVERRIDE or NEO4J_PASSWORD

# Colors
GREEN = '\033[92m'
RED = '\033[91m'
YELLOW = '\033[93m'
RESET = '\033[0m'

def print_pass(message):
    print(f"{GREEN}[PASS]{RESET} {message}")

def print_fail(message, suggestion=None):
    print(f"{RED}[FAIL]{RESET} {message}")
    if suggestion:
        print(f"   Suggested fix: {suggestion}")

def check_port_listening(host, port, timeout=1):
    """Check if a port is actually listening (not just process exists)."""
    import socket
    try:
        sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        sock.settimeout(timeout)
        result = sock.connect_ex((host, port))
        sock.close()
        return result == 0
    except Exception:
        return False

def check_backend_http():
    """Check if backend HTTP endpoint is reachable."""
    try:
        # First check if port is listening
        parsed = urlparse(BACKEND_URL)
        host = parsed.hostname or "127.0.0.1"
        port = parsed.port or 8000
        
        if not check_port_listening(host, port):
            # Check if process exists but port not listening (startup in progress)
            if check_process_running("uvicorn.*main:app"):
                print_fail(
                    f"Backend process running but port {port} not listening (still starting up?)",
                    f"Wait for CSV import to complete, or check backend logs: cd backend && tail -f logs/*"
                )
            else:
                print_fail(
                    f"Backend not reachable at {BACKEND_URL}",
                    f"Start backend: cd backend && ./run.sh"
                )
            return False
        
        # Try /health first (if it exists), then /, then /openapi.json
        endpoints = ["/health", "/", "/openapi.json"]
        endpoint_used = None
        response = None
        latency_ms = 0
        
        for endpoint in endpoints:
            try:
                url = f"{BACKEND_URL}{endpoint}"
                start = time.time()
                req = urllib.request.Request(url)
                with urllib.request.urlopen(req, timeout=3) as resp:
                    latency_ms = int((time.time() - start) * 1000)
                    endpoint_used = endpoint
                    response = resp
                    break
            except urllib.error.HTTPError as e:
                # If /health returns 404, try next endpoint
                if e.code == 404 and endpoint == "/health":
                    continue
                # For other endpoints, if we get a response, use it
                latency_ms = int((time.time() - start) * 1000)
                endpoint_used = endpoint
                response = e
                break
            except (urllib.error.URLError, OSError):
                continue
        
        if response is None:
            print_fail(
                f"Backend port {port} listening but HTTP requests failing",
                f"Check backend logs for errors"
            )
            return False
        
        status = response.status if hasattr(response, 'status') else response.code
        
        if status == 200:
            print_pass(f"Backend reachable ({status}) in {latency_ms}ms (endpoint: {endpoint_used})")
            return True
        else:
            print_fail(
                f"Backend returned {status} (endpoint: {endpoint_used})",
                f"Check backend logs for errors"
            )
            return False
            
    except Exception as e:
        print_fail(
            f"Backend HTTP check failed: {e}",
            f"Start backend: cd backend && ./run.sh"
        )
        return False

def check_frontend_http():
    """Check if frontend HTTP endpoint is reachable."""
    try:
        url = f"{FRONTEND_URL}/"
        start = time.time()
        req = urllib.request.Request(url)
        with urllib.request.urlopen(req, timeout=3) as response:
            latency_ms = int((time.time() - start) * 1000)
            if response.status == 200:
                print_pass(f"Frontend reachable ({response.status}) in {latency_ms}ms")
                return True
            else:
                print_fail(
                    f"Frontend returned {response.status}",
                    f"Check frontend logs for errors"
                )
                return False
    except urllib.error.HTTPError as e:
        latency_ms = int((time.time() - start) * 1000)
        print_fail(
            f"Frontend returned {e.code}",
            f"Check frontend logs: cd frontend && npm run dev"
        )
        return False
    except Exception as e:
        print_fail(
            f"Frontend not reachable at {FRONTEND_URL}: {e}",
            f"Start frontend: cd frontend && npm run dev"
        )
        return False

def check_neo4j():
    """Check Neo4j connectivity."""
    if not NEO4J_PASSWORD_CHECK:
        print_fail(
            "NEO4J_PASSWORD not set",
            "Set NEO4J_PASSWORD in .env.local or export it"
        )
        return False
    
    try:
        parsed = urlparse(NEO4J_URI_CHECK)
        driver = GraphDatabase.driver(
            NEO4J_URI_CHECK,
            auth=(NEO4J_USER_CHECK, NEO4J_PASSWORD_CHECK),
            connection_acquisition_timeout=3
        )
        
        # Test connection with a simple query
        with driver.session() as session:
            result = session.run("RETURN 1 as test")
            record = result.single()
            if record and record["test"] == 1:
                print_pass(f"Neo4j connection successful ({NEO4J_URI_CHECK})")
                driver.close()
                return True
            else:
                driver.close()
                print_fail("Neo4j query returned unexpected result")
                return False
                
    except Exception as e:
        error_msg = str(e)
        if "authentication" in error_msg.lower() or "password" in error_msg.lower():
            suggestion = "Check NEO4J_PASSWORD in .env.local"
        elif "connection" in error_msg.lower() or "refused" in error_msg.lower():
            suggestion = "Start Neo4j: docker compose up -d neo4j (or start Neo4j Desktop)"
        else:
            suggestion = f"Check Neo4j logs and connection settings"
        
        print_fail(f"Neo4j connection failed: {error_msg}", suggestion)
        return False

def check_process_running(pattern):
    """Check if a process matching the pattern is running."""
    try:
        result = subprocess.run(
            ['pgrep', '-f', pattern],
            capture_output=True,
            text=True,
            timeout=2
        )
        return result.returncode == 0
    except Exception:
        return False

def check_process(pattern, name, command_hint):
    """Check if a process matching the pattern is running."""
    try:
        result = subprocess.run(
            ['pgrep', '-f', pattern],
            capture_output=True,
            text=True,
            timeout=2
        )
        if result.returncode == 0:
            pids = result.stdout.strip().split('\n')
            pid_str = ', '.join(pids) if pids[0] else 'unknown'
            print_pass(f"{name} process: PID {pid_str}")
            return True
        else:
            print_fail(
                f"{name} process not running",
                command_hint
            )
            return False
    except subprocess.TimeoutExpired:
        print_fail(f"{name} process check timed out")
        return False
    except Exception as e:
        print_fail(f"{name} process check failed: {e}")
        return False

def check_backend_process():
    """Check if backend process is running."""
    return check_process(
        "uvicorn.*main:app",
        "Backend",
        "Start backend: cd backend && ./run.sh"
    )

def check_frontend_process():
    """Check if frontend process is running."""
    return check_process(
        "next.*dev",
        "Frontend",
        "Start frontend: cd frontend && npm run dev"
    )

def check_mode():
    """Check demo mode and write-gate status."""
    try:
        demo_mode = DEMO_MODE
        allow_writes = DEMO_ALLOW_WRITES
        
        mode_str = "demo" if demo_mode else "development"
        writes_str = "enabled" if allow_writes else "disabled"
        
        if demo_mode:
            print_pass(f"Mode: {mode_str} (writes: {writes_str})")
        else:
            print_pass(f"Mode: {mode_str} (writes: {writes_str})")
        
        return True
    except Exception as e:
        print_fail(f"Mode check failed: {e}")
        return False

def main():
    """Run all health checks."""
    print("🔍 Brain Web Doctor - Health Check\n")
    
    results = []
    
    # 1. Backend HTTP
    print("1. Checking backend HTTP...")
    results.append(check_backend_http())
    print()
    
    # 2. Frontend HTTP
    print("2. Checking frontend HTTP...")
    results.append(check_frontend_http())
    print()
    
    # 3. Neo4j connectivity
    print("3. Checking Neo4j connectivity...")
    results.append(check_neo4j())
    print()
    
    # 4. Process checks
    print("4. Checking processes...")
    results.append(check_backend_process())
    results.append(check_frontend_process())
    print()
    
    # 5. Mode check
    print("5. Checking mode configuration...")
    results.append(check_mode())
    print()
    
    # Summary
    print("━" * 60)
    if all(results):
        print(f"{GREEN}OVERALL: PASS{RESET}")
        sys.exit(0)
    else:
        print(f"{RED}OVERALL: FAIL{RESET}")
        sys.exit(1)

if __name__ == "__main__":
    main()

