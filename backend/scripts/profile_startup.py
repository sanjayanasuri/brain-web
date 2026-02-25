#!/usr/bin/env python3
"""
Profile backend startup time by importing the FastAPI app.
Run from backend/: PYTHONPATH=. python scripts/profile_startup.py

Requires Postgres (and optionally Neo4j) to be running for full startup.
If DB is down, reports time until first import failure.
"""
import sys
import time
import os

def main():
    backend_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    if backend_dir not in sys.path:
        sys.path.insert(0, backend_dir)
    start = time.perf_counter()
    try:
        from main import app
        elapsed = time.perf_counter() - start
        print(f"Startup time: {elapsed:.3f}s")
        return 0 if elapsed < 30 else 1
    except Exception as e:
        elapsed = time.perf_counter() - start
        print(f"Startup failed after {elapsed:.3f}s: {e}")
        return 1

if __name__ == "__main__":
    sys.exit(main())
