"""Assistant profile endpoints for per-user personalized assistant behavior."""
from typing import Any, Dict

from fastapi import APIRouter, Depends
from pydantic import BaseModel

from auth import require_auth
from services_assistant_profile import (
    build_assistant_style_prompt,
    get_or_create_assistant_profile,
    update_assistant_profile,
)

router = APIRouter(prefix="/assistant", tags=["assistant"])


class AssistantProfilePatch(BaseModel):
    profile: Dict[str, Any]


@router.get("/profile")
def get_profile(auth: dict = Depends(require_auth)):
    return get_or_create_assistant_profile(
        user_id=auth["user_id"],
        tenant_id=auth["tenant_id"],
    )


@router.patch("/profile")
def patch_profile(payload: AssistantProfilePatch, auth: dict = Depends(require_auth)):
    return update_assistant_profile(
        user_id=auth["user_id"],
        tenant_id=auth["tenant_id"],
        patch=payload.profile,
    )


@router.get("/style-prompt")
def get_style_prompt(auth: dict = Depends(require_auth)):
    prompt = build_assistant_style_prompt(
        user_id=auth["user_id"],
        tenant_id=auth["tenant_id"],
    )
    return {"style_prompt": prompt}
