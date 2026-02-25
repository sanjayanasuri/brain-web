from typing import Any, Dict, List

from fastapi import APIRouter, Depends

from auth import require_auth
from db_postgres import execute_query, execute_update

router = APIRouter(prefix="/learning", tags=["learning"])


@router.get("/interventions")
def list_learning_interventions(status: str = "open", limit: int = 20, auth=Depends(require_auth)) -> List[Dict[str, Any]]:
    rows = execute_query(
        """
        SELECT id, source, trigger_text, simplified_explanation, prerequisite_gap,
               practice_question, status, metadata, created_at, updated_at
        FROM learning_interventions
        WHERE user_id=%s AND tenant_id=%s
          AND (%s='all' OR status=%s)
        ORDER BY updated_at DESC
        LIMIT %s
        """,
        (str(auth.user_id), str(auth.tenant_id), status, status, max(1, min(limit, 100))),
    ) or []
    return rows


@router.post("/interventions/{intervention_id}/resolve")
def resolve_learning_intervention(intervention_id: str, auth=Depends(require_auth)) -> Dict[str, Any]:
    execute_update(
        """
        UPDATE learning_interventions
        SET status='resolved', updated_at=NOW()
        WHERE id=%s AND user_id=%s AND tenant_id=%s
        """,
        (intervention_id, str(auth.user_id), str(auth.tenant_id)),
    )
    return {"ok": True}
