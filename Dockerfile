# Unified Root-level Dockerfile for Railway
FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PYTHONPATH=/app/backend:/app

WORKDIR /app

# 1. Copy requirements first for caching
COPY backend/requirements.txt /app/backend/requirements.txt
RUN pip install --no-cache-dir -r /app/backend/requirements.txt

# 2. Explicitly copy ALL files from backend directory
COPY backend/ /app/backend/

# 3. Copy other essential root files
COPY vercel.json railway.json /app/

# DEBUG: Final verification of files
RUN echo "--- FINAL BACKEND LIST ---" && ls -la /app/backend/

COPY backend/start.sh /app/backend/start.sh
RUN chmod +x /app/backend/start.sh

EXPOSE 8080
WORKDIR /app/backend
CMD ["./start.sh"]
