from fastapi import APIRouter, Request
from pydantic import BaseModel, Field
from typing import Any, Dict, Optional
import os
import time

import boto3

from demo_mode import structured_log_line
import logging


logger = logging.getLogger("brain_web")

router = APIRouter(prefix="/events", tags=["events"])


class ProductEvent(BaseModel):
    name: str = Field(..., description="Event name, e.g. page_view, feature_used")
    properties: Dict[str, Any] = Field(default_factory=dict)
    ts_ms: Optional[int] = Field(default=None, description="Client timestamp (ms). Server will fill if omitted.")


def _get_ddb_table():
    table_name = os.getenv("EVENTS_DDB_TABLE", "").strip()
    if not table_name:
        return None
    region = os.getenv("AWS_REGION") or os.getenv("AWS_DEFAULT_REGION") or "us-east-1"
    ddb = boto3.resource("dynamodb", region_name=region)
    return ddb.Table(table_name)


@router.post("")
def ingest_event(payload: ProductEvent, request: Request):
    """
    Anonymous product analytics event ingestion.
    - No PII by design (session_id is a random cookie)
    - Stores to DynamoDB if configured; otherwise logs to CloudWatch only
    """
    session_id = getattr(request.state, "session_id", None) or request.cookies.get("bw_session_id") or "unknown"
    request_id = getattr(request.state, "request_id", None)
    tenant_id = getattr(request.state, "tenant_id", None)
    ip = getattr(request.state, "client_ip", None)

    ts_ms = payload.ts_ms or int(time.time() * 1000)

    event_record = {
        "pk": f"tenant#{tenant_id or 'unknown'}",
        "sk": f"ts#{ts_ms}#{request_id or ''}",
        "ts_ms": ts_ms,
        "name": payload.name,
        "properties": payload.properties,
        "session_id": session_id,
        "request_id": request_id,
        "ip": ip,
    }

    table = _get_ddb_table()
    if table is not None:
        table.put_item(Item=event_record)
        stored = True
    else:
        stored = False

    logger.info(
        structured_log_line(
            {
                "event": "product_event",
                "stored": stored,
                "name": payload.name,
                "session_id": session_id,
                "request_id": request_id,
                "tenant_id": tenant_id,
            }
        )
    )

    return {"status": "ok", "stored": stored}


