from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from auth import require_auth
from services_api_keys import rotate_personal_api_key


router = APIRouter(prefix="/v1/api-keys", tags=["api-keys"])


class RotatePersonalApiKeyResponse(BaseModel):
    api_key: str
    prefix: str


@router.post("/personal/rotate", response_model=RotatePersonalApiKeyResponse)
def rotate_personal_key(auth: dict = Depends(require_auth)):
    """
    Rotate the caller's personal API key.

    The plaintext key is returned once and is never persisted.
    """
    try:
        api_key, prefix = rotate_personal_api_key(user_id=str(auth.get("user_id")))
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))

    return RotatePersonalApiKeyResponse(api_key=api_key, prefix=prefix)

