from __future__ import annotations

from fastapi import APIRouter

from ..schemas.letterboxd import (
    ConfirmedSlugRequest,
    LetterboxdActionResponse,
    RateRequest,
    ReviewRequest,
)
from ..services.letterboxd_service import call_write_tool


router = APIRouter(prefix="/api/letterboxd", tags=["letterboxd"])


@router.post("/watchlist", response_model=LetterboxdActionResponse)
async def add_to_watchlist(request: ConfirmedSlugRequest) -> LetterboxdActionResponse:
    result = await call_write_tool(
        "add_to_watchlist",
        {"slug": request.slug, "remove": request.remove},
        request.confirmed,
    )
    return LetterboxdActionResponse(ok=True, tool="add_to_watchlist", result=result)


@router.post("/watched", response_model=LetterboxdActionResponse)
async def add_to_watched(request: ConfirmedSlugRequest) -> LetterboxdActionResponse:
    result = await call_write_tool(
        "add_to_watched",
        {"slug": request.slug, "remove": request.remove},
        request.confirmed,
    )
    return LetterboxdActionResponse(ok=True, tool="add_to_watched", result=result)


@router.post("/like", response_model=LetterboxdActionResponse)
async def toggle_like(request: ConfirmedSlugRequest) -> LetterboxdActionResponse:
    result = await call_write_tool(
        "toggle_like",
        {"slug": request.slug, "remove": request.remove},
        request.confirmed,
    )
    return LetterboxdActionResponse(ok=True, tool="toggle_like", result=result)


@router.post("/rate", response_model=LetterboxdActionResponse)
async def rate_film(request: RateRequest) -> LetterboxdActionResponse:
    result = await call_write_tool(
        "rate_film",
        {"slug": request.slug, "rating": request.rating},
        request.confirmed,
    )
    return LetterboxdActionResponse(ok=True, tool="rate_film", result=result)


@router.post("/review", response_model=LetterboxdActionResponse)
async def write_review(request: ReviewRequest) -> LetterboxdActionResponse:
    args: dict = {"slug": request.slug, "review": request.review}
    if request.rating:
        args["rating"] = request.rating
    result = await call_write_tool("write_review", args, request.confirmed)
    return LetterboxdActionResponse(ok=True, tool="write_review", result=result)
