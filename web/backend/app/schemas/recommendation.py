from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field


JobStatus = Literal["queued", "running", "succeeded", "failed"]


class MovieRecommendation(BaseModel):
    title: str
    year: int | None = None
    slug: str | None = None
    director: str | None = None
    reason: str | None = None
    letterboxd_url: str | None = None


class RecommendationRequest(BaseModel):
    mood: str = Field(min_length=1, max_length=1000)


class RecommendationJobResponse(BaseModel):
    job_id: str
    status: JobStatus
    mood: str
    result_text: str = ""
    movies: list[MovieRecommendation] = Field(default_factory=list)
    error: str | None = None
    created_at: datetime
    finished_at: datetime | None = None


class RecommendationCreateResponse(BaseModel):
    job_id: str
    status: JobStatus
