from fastapi import APIRouter, Depends

from auth import require_auth
from services_indexing_health import get_indexing_health

router = APIRouter(prefix="/indexing", tags=["indexing-health"])


@router.get("/health")
def indexing_health(auth=Depends(require_auth)):
    return get_indexing_health(user_id=str(auth.user_id), tenant_id=str(auth.tenant_id))
