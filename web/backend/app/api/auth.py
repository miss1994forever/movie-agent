from __future__ import annotations

from fastapi import APIRouter

from ..core.settings import public_config_status
from ..schemas.letterboxd import AuthCheckResponse
from ..services.letterboxd_service import check_auth


router = APIRouter(prefix="/api/auth", tags=["auth"])


@router.get("/check", response_model=AuthCheckResponse)
async def auth_check() -> AuthCheckResponse:
    ok, username, error = await check_auth()
    return AuthCheckResponse(
        ok=ok,
        username=username,
        error=error,
        config=public_config_status(),
    )
