from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, Field

from .recommendation import MovieRecommendation


class HistoryItem(BaseModel):
    id: str
    mood: str
    result_text: str
    movies: list[MovieRecommendation] = Field(default_factory=list)
    status: str
    error: str | None = None
    created_at: datetime
    finished_at: datetime | None = None


class HistoryListResponse(BaseModel):
    items: list[HistoryItem]
