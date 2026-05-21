from __future__ import annotations

from pydantic import BaseModel, Field


class AuthCheckResponse(BaseModel):
    ok: bool
    username: str | None = None
    error: str | None = None
    config: dict[str, bool]


class DeepAuthCheckResponse(BaseModel):
    ok: bool
    username: str | None = None
    logged_in: bool = False
    profile_read_ok: bool = False
    watchlist_read_ok: bool = False
    warnings: list[str] = []
    error: str | None = None


class ConfirmedSlugRequest(BaseModel):
    slug: str = Field(min_length=1)
    confirmed: bool
    remove: bool = False


class RateRequest(BaseModel):
    slug: str = Field(min_length=1)
    rating: int = Field(ge=1, le=10)
    confirmed: bool


class ReviewRequest(BaseModel):
    slug: str = Field(min_length=1)
    review: str = Field(min_length=1, max_length=10000)
    confirmed: bool
    rating: int | None = Field(default=None, ge=1, le=10)


class LetterboxdActionResponse(BaseModel):
    ok: bool
    tool: str
    result: dict
    error: str | None = None
