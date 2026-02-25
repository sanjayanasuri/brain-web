import hashlib
import hmac
import json
import logging
import os
import time
from typing import Any, Dict, List, Tuple

from fastapi import APIRouter, HTTPException, Request

logger = logging.getLogger("brain_web")

router = APIRouter(prefix="/observability", tags=["observability"])


def _truthy(v: str) -> bool:
    return v.strip().lower() in ("true", "1", "yes", "y", "on")


def _verify_vercel_log_drain_signature(*, body: bytes, signature: str, secret: str) -> bool:
    """
    Vercel log drains support request signing via `x-vercel-signature`.

    Signature = hex(HMAC-SHA1(secret, raw_body_bytes)).
    """
    if not signature or not secret:
        return False
    expected = hmac.new(secret.encode("utf-8"), body, hashlib.sha1).hexdigest()
    return hmac.compare_digest(signature, expected)


def _parse_vercel_log_payload(body: bytes) -> Tuple[List[Dict[str, Any]], str]:
    """
    Vercel log drains can send either:
    - JSON (object or list of objects)
    - NDJSON (newline-delimited JSON objects)

    Returns: (entries, format)
    """
    raw = body.decode("utf-8", errors="replace").strip()
    if not raw:
        return ([], "empty")

    try:
        parsed: Any = json.loads(raw)
        if isinstance(parsed, list):
            items = [x for x in parsed if isinstance(x, dict)]
            return (items, "json_list")
        if isinstance(parsed, dict):
            return ([parsed], "json_object")
    except json.JSONDecodeError:
        pass

    entries: List[Dict[str, Any]] = []
    for line in raw.splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            obj = json.loads(line)
        except json.JSONDecodeError:
            continue
        if isinstance(obj, dict):
            entries.append(obj)
    return (entries, "ndjson")


@router.post("/vercel/logs", include_in_schema=False)
async def ingest_vercel_logs(request: Request) -> Dict[str, Any]:
    """
    Ingest Vercel Log Drain payloads.

    Configure in Vercel: Project → Settings → Log Drains.
    Set `VERCEL_LOG_DRAIN_SECRET` and (recommended) enable signed requests.
    """
    secret = os.getenv("VERCEL_LOG_DRAIN_SECRET", "").strip()
    allow_insecure = _truthy(os.getenv("VERCEL_LOG_DRAIN_ALLOW_INSECURE", "false"))
    signature = (request.headers.get("x-vercel-signature") or "").strip()

    body = await request.body()
    if secret:
        if not _verify_vercel_log_drain_signature(body=body, signature=signature, secret=secret):
            raise HTTPException(status_code=401, detail="Invalid Vercel log drain signature")
    elif not allow_insecure:
        raise HTTPException(status_code=503, detail="VERCEL_LOG_DRAIN_SECRET is not configured")

    entries, payload_format = _parse_vercel_log_payload(body)
    received_at_ms = int(time.time() * 1000)

    for entry in entries:
        record = {
            "event": "vercel_log",
            "source": "vercel",
            "received_at_ms": received_at_ms,
            "payload_format": payload_format,
            "vercel": entry,
        }
        logger.info(json.dumps(record, separators=(",", ":"), ensure_ascii=False))

    return {"ok": True, "count": len(entries), "format": payload_format}
