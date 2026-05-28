from __future__ import annotations

from fastapi import APIRouter

from ..core.settings import public_config_status
from ..services.runtime_status import clear_events, get_status


router = APIRouter(prefix="/api/status", tags=["status"])


@router.get("")
async def status() -> dict:
    payload = get_status()
    payload["config"] = public_config_status()
    return payload


@router.delete("/events")
async def status_clear_events() -> dict[str, bool]:
    clear_events()
    return {"ok": True}
