from __future__ import annotations

from fastapi import APIRouter

from ..core.settings import public_config_status
from ..schemas.letterboxd import AuthCheckResponse, DeepAuthCheckResponse
from ..services.letterboxd_service import check_auth, deep_check_auth


router = APIRouter(prefix="/api/auth", tags=["auth"])


@router.get("/check", response_model=AuthCheckResponse)
async def auth_check() -> AuthCheckResponse:
    try:
        ok, username, error = await check_auth()
    except Exception as exc:
        ok, username, error = False, None, str(exc)
    return AuthCheckResponse(
        ok=ok,
        username=username,
        error=error,
        config=public_config_status(),
    )


@router.get("/deep-check", response_model=DeepAuthCheckResponse)
async def auth_deep_check() -> DeepAuthCheckResponse:
    try:
        return DeepAuthCheckResponse.model_validate(await deep_check_auth())
    except Exception as exc:
        return DeepAuthCheckResponse(ok=False, error=str(exc))
