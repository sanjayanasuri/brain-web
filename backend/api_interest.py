"""Interest profile and content suggestion endpoints."""
from typing import Dict, List

from fastapi import APIRouter, Depends

from auth import get_user_context_from_request, require_auth
from services_interest_recommender import (
    build_interest_profile,
    generate_content_suggestions,
    get_recent_suggestions,
)

router = APIRouter(prefix="/interest", tags=["interest"])


@router.get("/profile")
def get_interest_profile(user_ctx=Depends(require_auth)) -> Dict:
    return build_interest_profile(user_id=user_ctx.user_id, tenant_id=user_ctx.tenant_id)


@router.post("/suggestions/refresh")
def refresh_interest_suggestions(limit: int = 5, user_ctx=Depends(require_auth)) -> List[Dict]:
    return generate_content_suggestions(
        user_id=user_ctx.user_id,
        tenant_id=user_ctx.tenant_id,
        limit=limit,
    )


@router.get("/suggestions")
def list_interest_suggestions(limit: int = 10, user_ctx=Depends(require_auth)) -> List[Dict]:
    return get_recent_suggestions(
        user_id=user_ctx.user_id,
        tenant_id=user_ctx.tenant_id,
        limit=limit,
    )
