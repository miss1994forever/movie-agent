from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel


class TasteProfile(BaseModel):
    id: str = "default"
    summary: str
    exploration_suggestions: str
    raw_profile: str
    created_at: datetime
    updated_at: datetime


class TasteProfileResponse(BaseModel):
    profile: TasteProfile | None = None


class TasteProfileRefreshResponse(BaseModel):
    profile: TasteProfile


class TasteProfileRefreshCreateResponse(BaseModel):
    job_id: str
    status: str


class TasteProfileRefreshJobResponse(BaseModel):
    job_id: str
    status: str
    stage: str
    profile: TasteProfile | None = None
    error: str | None = None
    created_at: datetime
    finished_at: datetime | None = None
