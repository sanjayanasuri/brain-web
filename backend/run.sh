#!/bin/bash
# Startup script to ensure uvicorn uses the venv Python interpreter
# Usage: ./run.sh

cd "$(dirname "$0")"
source .venv/bin/activate
exec python -m uvicorn main:app --reload --host 127.0.0.1 --port 8000

