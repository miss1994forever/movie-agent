from __future__ import annotations

from pydantic import BaseModel, Field


class AuthCheckResponse(BaseModel):
    ok: bool
    username: str | None = None
    error: str | None = None
    config: dict[str, bool]


class AppConfigResponse(BaseModel):
    config: dict[str, bool]


class AppConfigUpdateRequest(BaseModel):
    dashscope_api_key: str | None = None
    dashscope_base_url: str | None = None
    ai_model: str | None = None
    tmdb_api_key: str | None = None
    letterboxd_username: str | None = None
    letterboxd_password: str | None = None
    letterboxd_credentials: str | None = None
    letterboxd_cookie: str | None = None


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
