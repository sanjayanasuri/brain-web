"""DynamoDB implementation of event store."""
import os
import json
from typing import List, Optional
from datetime import datetime

import boto3
from botocore.exceptions import ClientError

from ..schema import EventEnvelope
from .base import EventStore


class DynamoDBEventStore(EventStore):
    """DynamoDB-backed event store."""
    
    def __init__(self, table_name: str):
        """
        Initialize DynamoDB event store.
        
        Args:
            table_name: DynamoDB table name
        """
        self.table_name = table_name
        region = os.getenv("AWS_REGION") or os.getenv("AWS_DEFAULT_REGION") or "us-east-1"
        self.ddb = boto3.resource("dynamodb", region_name=region)
        self.table = self.ddb.Table(table_name)
    
    def append(self, event: EventEnvelope) -> None:
        """Append event to DynamoDB with idempotency check."""
        # Check idempotency if key is provided
        if event.idempotency_key:
            # Try to get existing event by idempotency key
            # Note: This assumes a GSI exists. If not, we'll skip the check.
            try:
                response = self.table.query(
                    IndexName="idempotency_key-index",
                    KeyConditionExpression="idempotency_key = :key",
                    ExpressionAttributeValues={":key": event.idempotency_key},
                    Limit=1
                )
                if response.get("Items"):
                    # Event already exists, skip
                    return
            except ClientError as e:
                # Index might not exist - continue without idempotency check
                if e.response["Error"]["Code"] not in ["ResourceNotFoundException", "ValidationException"]:
                    raise
        
        # Convert event to DynamoDB item
        item = {
            "pk": f"session#{event.session_id}",
            "sk": f"event#{event.occurred_at.isoformat()}#{event.event_id}",
            "event_id": event.event_id,
            "event_type": event.event_type.value,
            "session_id": event.session_id,
            "actor_id": event.actor_id,
            "occurred_at": event.occurred_at.isoformat(),
            "version": event.version,
            "correlation_id": event.correlation_id,
            "trace_id": event.trace_id,
            "payload": json.dumps(event.payload),
        }
        
        if event.idempotency_key:
            item["idempotency_key"] = event.idempotency_key
        
        if event.object_ref:
            item["object_ref_type"] = event.object_ref.type
            item["object_ref_id"] = event.object_ref.id
        
        try:
            self.table.put_item(Item=item)
        except ClientError as e:
            raise ValueError(f"Failed to append event: {e}")
    
    def list_events(
        self,
        session_id: str,
        after_ts: Optional[datetime] = None,
        limit: int = 100
    ) -> List[EventEnvelope]:
        """List events for a session."""
        pk = f"session#{session_id}"
        
        query_kwargs = {
            "KeyConditionExpression": "pk = :pk",
            "ExpressionAttributeValues": {":pk": pk},
            "Limit": limit,
            "ScanIndexForward": True,  # Ascending order
        }
        
        if after_ts:
            query_kwargs["KeyConditionExpression"] += " AND sk > :after_sk"
            query_kwargs["ExpressionAttributeValues"][":after_sk"] = (
                f"event#{after_ts.isoformat()}"
            )
        
        try:
            response = self.table.query(**query_kwargs)
            return [self._item_to_event(item) for item in response.get("Items", [])]
        except ClientError as e:
            raise ValueError(f"Failed to list events: {e}")
    
    def replay(self, session_id: str) -> List[EventEnvelope]:
        """Replay all events for a session."""
        return self.list_events(session_id, limit=10000)
    
    def _item_to_event(self, item: dict) -> EventEnvelope:
        """Convert DynamoDB item to EventEnvelope."""
        from ..schema import ObjectRef
        
        object_ref = None
        if "object_ref_type" in item and "object_ref_id" in item:
            object_ref = ObjectRef(
                type=item["object_ref_type"],
                id=item["object_ref_id"]
            )
        
        return EventEnvelope(
            event_id=item["event_id"],
            event_type=item["event_type"],
            session_id=item["session_id"],
            actor_id=item.get("actor_id"),
            occurred_at=datetime.fromisoformat(item["occurred_at"].replace("Z", "+00:00")),
            version=item.get("version", 1),
            idempotency_key=item.get("idempotency_key"),
            correlation_id=item.get("correlation_id"),
            trace_id=item.get("trace_id"),
            object_ref=object_ref,
            payload=json.loads(item.get("payload", "{}")),
        )

