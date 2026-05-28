from __future__ import annotations

from fastapi import APIRouter

from ..core.settings import public_config_status, update_env_config
from ..schemas.letterboxd import (
    AppConfigResponse,
    AppConfigUpdateRequest,
    AuthCheckResponse,
    DeepAuthCheckResponse,
)
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


@router.get("/config", response_model=AppConfigResponse)
async def get_config() -> AppConfigResponse:
    return AppConfigResponse(config=public_config_status())


@router.post("/config", response_model=AppConfigResponse)
async def update_config(request: AppConfigUpdateRequest) -> AppConfigResponse:
    payload = request.model_dump(exclude_unset=True)
    env_values = {
        "DASHSCOPE_API_KEY": payload.get("dashscope_api_key"),
        "DASHSCOPE_BASE_URL": payload.get("dashscope_base_url"),
        "AI_MODEL": payload.get("ai_model"),
        "TMDB_API_KEY": payload.get("tmdb_api_key"),
        "LETTERBOXD_USERNAME": payload.get("letterboxd_username"),
        "LETTERBOXD_PASSWORD": payload.get("letterboxd_password"),
        "LETTERBOXD_CREDENTIALS": payload.get("letterboxd_credentials"),
        "LETTERBOXD_COOKIE": payload.get("letterboxd_cookie"),
    }
    updated = {key: value for key, value in env_values.items() if value is not None}
    return AppConfigResponse(config=update_env_config(updated))


@router.get("/deep-check", response_model=DeepAuthCheckResponse)
async def auth_deep_check() -> DeepAuthCheckResponse:
    try:
        return DeepAuthCheckResponse.model_validate(await deep_check_auth())
    except Exception as exc:
        return DeepAuthCheckResponse(ok=False, error=str(exc))
