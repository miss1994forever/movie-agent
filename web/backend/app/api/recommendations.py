from __future__ import annotations

from fastapi import APIRouter, HTTPException

from ..schemas.recommendation import (
    RecommendationCreateResponse,
    RecommendationJobResponse,
    RecommendationRequest,
)
from ..services.recommendation_service import (
    cancel_recommendation_job,
    create_recommendation_job,
    get_recommendation_job,
)


router = APIRouter(prefix="/api/recommendations", tags=["recommendations"])


@router.post("", response_model=RecommendationCreateResponse)
async def create_recommendation(request: RecommendationRequest) -> RecommendationCreateResponse:
    job = await create_recommendation_job(
        request.mood,
        use_saved_taste_profile=request.use_saved_taste_profile,
    )
    return RecommendationCreateResponse(job_id=job.job_id, status=job.status)


@router.get("/{job_id}", response_model=RecommendationJobResponse)
async def get_recommendation(job_id: str) -> RecommendationJobResponse:
    job = get_recommendation_job(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Recommendation job not found.")
    return job


@router.delete("/{job_id}", response_model=RecommendationJobResponse)
async def cancel_recommendation(job_id: str) -> RecommendationJobResponse:
    job = cancel_recommendation_job(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Recommendation job not found.")
    return job
