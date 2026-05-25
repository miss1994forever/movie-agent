from __future__ import annotations

from fastapi import APIRouter, HTTPException

from ..schemas.taste_profile import (
    TasteProfileRefreshCreateResponse,
    TasteProfileRefreshJobResponse,
    TasteProfileResponse,
)
from ..services.taste_profile_service import (
    create_taste_profile_refresh_job,
    get_taste_profile,
    get_taste_profile_refresh_job,
)


router = APIRouter(prefix="/api/taste-profile", tags=["taste-profile"])


@router.get("", response_model=TasteProfileResponse)
async def read_taste_profile() -> TasteProfileResponse:
    return TasteProfileResponse(profile=await get_taste_profile())


@router.post("/refresh", response_model=TasteProfileRefreshCreateResponse)
async def refresh_profile() -> TasteProfileRefreshCreateResponse:
    job = await create_taste_profile_refresh_job()
    return TasteProfileRefreshCreateResponse(job_id=job.job_id, status=job.status)


@router.get("/refresh/{job_id}", response_model=TasteProfileRefreshJobResponse)
async def refresh_profile_status(job_id: str) -> TasteProfileRefreshJobResponse:
    job = get_taste_profile_refresh_job(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Taste profile refresh job not found.")
    return job
