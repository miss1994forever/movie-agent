from __future__ import annotations

import asyncio
import json
import re
import uuid
from datetime import datetime, timezone

from ..core.settings import get_external_mcp_url

from movie_rec.cli.cli import detect_watchlist_only
from movie_rec.core.mcp_manager import extract_json, mcp_session, preflight_check
from movie_rec.crews.movie_crew import MovieCrew

from ..schemas.history import HistoryItem
from ..schemas.recommendation import (
    MovieRecommendation,
    RecommendationJobResponse,
    JobStatus,
)
from .history_service import save_history


_jobs: dict[str, RecommendationJobResponse] = {}
_job_lock = asyncio.Lock()


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _extract_movies(result_text: str) -> list[MovieRecommendation]:
    """Best-effort parser for an optional JSON recommendations block."""
    candidates: list[str] = []
    fenced = re.findall(r"```(?:json)?\s*(\{.*?\})\s*```", result_text, flags=re.DOTALL)
    candidates.extend(fenced)
    if "recommendations" in result_text:
        start = result_text.find("{")
        end = result_text.rfind("}")
        if start != -1 and end != -1 and end > start:
            candidates.append(result_text[start : end + 1])

    for candidate in candidates:
        try:
            payload = json.loads(candidate)
        except json.JSONDecodeError:
            continue
        items = payload.get("recommendations")
        if not isinstance(items, list):
            continue
        movies: list[MovieRecommendation] = []
        for item in items:
            if isinstance(item, dict) and item.get("title"):
                movies.append(MovieRecommendation.model_validate(item))
        if movies:
            return movies
    return []


async def create_recommendation_job(mood: str) -> RecommendationJobResponse:
    job_id = str(uuid.uuid4())
    job = RecommendationJobResponse(
        job_id=job_id,
        status="queued",
        mood=mood.strip(),
        created_at=_now(),
    )
    _jobs[job_id] = job
    asyncio.create_task(_run_job(job_id))
    return job


def get_recommendation_job(job_id: str) -> RecommendationJobResponse | None:
    return _jobs.get(job_id)


async def _run_job(job_id: str) -> None:
    async with _job_lock:
        job = _jobs[job_id]
        job.status = "running"
        _jobs[job_id] = job

        try:
            result_text = await _run_recommendation(job.mood)
            movies = _extract_movies(result_text)
            finished = _now()
            completed = job.model_copy(
                update={
                    "status": "succeeded",
                    "result_text": result_text,
                    "movies": movies,
                    "finished_at": finished,
                }
            )
            _jobs[job_id] = completed
            await save_history(
                HistoryItem(
                    id=job_id,
                    mood=completed.mood,
                    result_text=completed.result_text,
                    movies=completed.movies,
                    status=completed.status,
                    error=None,
                    created_at=completed.created_at,
                    finished_at=completed.finished_at,
                )
            )
        except Exception as exc:
            failed = job.model_copy(
                update={
                    "status": "failed",
                    "error": str(exc),
                    "finished_at": _now(),
                }
            )
            _jobs[job_id] = failed


async def _run_recommendation(mood: str) -> str:
    external_url = get_external_mcp_url()
    async with mcp_session(external_url) as session:
        await preflight_check(session)
        watchlist_only_candidates: str | None = None
        if detect_watchlist_only(mood):
            raw = await session.call_tool(
                "get_member_watchlist",
                arguments={"username": "me", "maxPages": 1},
            )
            payload = extract_json(raw)
            items = (payload.get("items") or payload.get("films") or [])[:50]
            if items:
                pairs = [
                    {"title": item.get("title", ""), "slug": item.get("slug", "")}
                    for item in items
                ]
                watchlist_only_candidates = json.dumps(pairs, ensure_ascii=False)

        crew = MovieCrew(
            session=session,
            mood=mood,
            watchlist_only_candidates=watchlist_only_candidates,
        )
        return crew.run()
