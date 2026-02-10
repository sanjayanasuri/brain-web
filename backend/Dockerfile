FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app

# Download Silero VAD model
RUN mkdir -p /app/models && \
    apt-get update && \
    apt-get install -y wget && \
    wget -O /app/models/silero_vad.jit https://github.com/snakers4/silero-vad/raw/master/files/silero_vad.jit && \
    apt-get remove -y wget && \
    apt-get autoremove -y && \
    rm -rf /var/lib/apt/lists/*

COPY requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -r /app/requirements.txt

COPY . /app

EXPOSE 8000

CMD ["sh", "-lc", "uvicorn main:app --host 0.0.0.0 --port ${PORT:-8000}"]


