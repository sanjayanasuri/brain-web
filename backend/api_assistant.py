"""Assistant profile endpoints for per-user personalized assistant behavior."""
from typing import Any, Dict, List

from fastapi import APIRouter, Depends
from pydantic import BaseModel

from auth import require_auth
from services_assistant_profile import (
    build_assistant_style_prompt,
    get_or_create_assistant_profile,
    update_assistant_profile,
)
from services_action_router import plan_actions

router = APIRouter(prefix="/assistant", tags=["assistant"])


class AssistantProfilePatch(BaseModel):
    profile: Dict[str, Any]


class AssistantActionPlanRequest(BaseModel):
    message: str
    answer: str | None = None


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


@router.post("/actions/plan")
def get_action_plan(payload: AssistantActionPlanRequest, auth: dict = Depends(require_auth)) -> Dict[str, List[Dict[str, Any]]]:
    actions = plan_actions(message=payload.message, answer=payload.answer)
    return {"actions": actions}
