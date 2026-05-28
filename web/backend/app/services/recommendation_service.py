from __future__ import annotations

import asyncio
import json
import os
import re
import uuid
from datetime import datetime, timezone

from ..core.settings import get_external_mcp_url

import httpx

from movie_rec.cli.cli import detect_watchlist_only
from movie_rec.core.mcp_manager import extract_json, mcp_session, preflight_check
from movie_rec.crews.movie_crew import MovieCrew

from ..schemas.history import HistoryItem
from ..schemas.recommendation import (
    AgentStatus,
    MovieRecommendation,
    RecommendationJobResponse,
    JobStatus,
)
from .history_service import save_history
from .runtime_status import get_status, record_event, set_active_job
from .taste_profile_service import format_profile_for_prompt, get_taste_profile


_jobs: dict[str, RecommendationJobResponse] = {}
_job_tasks: dict[str, asyncio.Task] = {}
_job_lock = asyncio.Lock()
_tool_stats: dict[str, dict[str, dict[str, float]]] = {}


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
    return _extract_movies_from_text(result_text)


def _strip_recommendation_json(result_text: str) -> str:
    text = re.sub(
        r"\n?```json\s*\{\s*\"recommendations\"\s*:\s*\[.*?\]\s*\}\s*```\s*$",
        "",
        result_text,
        flags=re.DOTALL,
    ).rstrip()
    if text != result_text.rstrip():
        return text
    return re.sub(
        r"\n?```\s*\{\s*\"recommendations\"\s*:\s*\[.*?\]\s*\}\s*```\s*$",
        "",
        result_text,
        flags=re.DOTALL,
    ).rstrip()


def _clean_display_text(result_text: str) -> str:
    text = _strip_recommendation_json(result_text)
    text = re.sub(r"(?m)^\s*(?:---+|\*\*\*+|___+)\s*$\n?", "", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def _extract_movies_from_text(result_text: str) -> list[MovieRecommendation]:
    movies: list[MovieRecommendation] = []
    lines = result_text.splitlines()
    for index, line in enumerate(lines):
        slug_match = re.search(r"\bslug\s*:\s*([a-z0-9][a-z0-9-]*)", line, flags=re.IGNORECASE)
        if not slug_match:
            continue
        slug = slug_match.group(1).strip()
        context = " ".join(lines[max(0, index - 3) : index + 2])
        year_match = re.search(r"\b(19\d{2}|20\d{2})\b", context)
        title = _guess_title_from_context(context, slug)
        if any(movie.slug == slug for movie in movies):
            continue
        movies.append(
            MovieRecommendation(
                title=title,
                year=int(year_match.group(1)) if year_match else None,
                slug=slug,
                reason="See the recommendation text for details.",
                letterboxd_url=f"https://letterboxd.com/film/{slug}/",
            )
        )
    return movies[:5]


def _guess_title_from_context(context: str, slug: str) -> str:
    cleaned = re.sub(r"[*#`•\-\d.]+", " ", context)
    cleaned = re.sub(r"\bslug\s*:\s*[a-z0-9-]+", " ", cleaned, flags=re.IGNORECASE)
    cleaned = re.sub(r"\s+", " ", cleaned).strip(" :：,，")
    if cleaned:
        return cleaned[:90]
    return slug.replace("-", " ").title()


async def _enrich_movie_posters(movies: list[MovieRecommendation]) -> list[MovieRecommendation]:
    api_key = os.getenv("TMDB_API_KEY", "").strip()
    if not api_key:
        return movies

    async with httpx.AsyncClient(timeout=8) as client:
        enriched: list[MovieRecommendation] = []
        for movie in movies:
            if movie.poster_url:
                enriched.append(movie)
                continue
            poster_url = await _fetch_tmdb_poster(client, api_key, movie)
            enriched.append(movie.model_copy(update={"poster_url": poster_url} if poster_url else {}))
        return enriched


async def _fetch_tmdb_poster(
    client: httpx.AsyncClient,
    api_key: str,
    movie: MovieRecommendation,
) -> str | None:
    try:
        response = await client.get(
            "https://api.themoviedb.org/3/search/movie",
            params={
                "api_key": api_key,
                "query": movie.title,
                "include_adult": "false",
                **({"primary_release_year": movie.year} if movie.year else {}),
            },
        )
        response.raise_for_status()
        results = response.json().get("results") or []
    except Exception:
        return None

    if not results:
        return None
    poster_path = results[0].get("poster_path")
    return f"https://image.tmdb.org/t/p/w342{poster_path}" if poster_path else None


async def create_recommendation_job(mood: str, use_saved_taste_profile: bool = True) -> RecommendationJobResponse:
    job_id = str(uuid.uuid4())
    job = RecommendationJobResponse(
        job_id=job_id,
        status="queued",
        mood=mood.strip(),
        stage="queued",
        created_at=_now(),
    )
    _jobs[job_id] = job
    record_event(f"Queued recommendation job for mood: {job.mood}", job_id=job_id)
    _job_tasks[job_id] = asyncio.create_task(_run_job(job_id, use_saved_taste_profile))
    return job


def get_recommendation_job(job_id: str) -> RecommendationJobResponse | None:
    return _jobs.get(job_id)


def cancel_recommendation_job(job_id: str) -> RecommendationJobResponse | None:
    job = _jobs.get(job_id)
    if job is None:
        return None
    if job.status not in {"queued", "running"}:
        return job

    task = _job_tasks.get(job_id)
    if task and not task.done():
        task.cancel()

    cancelled = job.model_copy(
        update={
            "status": "cancelled",
            "stage": "cancelled",
            "error": "Recommendation job cancelled.",
            "finished_at": _now(),
        }
    )
    _jobs[job_id] = cancelled
    if get_status().get("active_job_id") == job_id:
        set_active_job(None)
    record_event("Recommendation job cancelled.", level="warning", job_id=job_id)
    return cancelled


def _update_job_stage(job_id: str, stage: str) -> None:
    job = _jobs.get(job_id)
    if not job:
        return
    job.stage = stage
    _jobs[job_id] = job


def _update_agent_status(job_id: str, event_type: str, message: str) -> None:
    job = _jobs.get(job_id)
    if not job:
        return

    statuses = [status.model_copy() for status in job.agent_statuses]
    events = [*job.events, _format_agent_event(event_type, message)][-20:]

    if event_type in {"agent_running", "agent_completed"}:
        name = message
        existing = next((status for status in statuses if status.name == name), None)
        if not existing:
            existing = AgentStatus(name=name, status="pending")
            statuses.append(existing)
        if event_type == "agent_running":
            for status in statuses:
                if status.status == "running":
                    status.status = "completed"
            existing.status = "running"
            existing.detail = "Working..."
        else:
            existing.status = "completed"
            existing.detail = "Done"
    elif event_type == "agent_step":
        name, _, detail = message.partition(": ")
        existing = next((status for status in statuses if status.name == name), None)
        if existing:
            existing.detail = detail[:180] if detail else existing.detail
    elif event_type == "tool_metric":
        _record_tool_metric(job_id, message)
        existing = next((status for status in statuses if status.name == "Film Scout"), None)
        if existing:
            existing.detail = message[:180]

    job.agent_statuses = statuses
    job.events = events
    _jobs[job_id] = job


def _format_agent_event(event_type: str, message: str) -> str:
    labels = {
        "agent_running": "Started",
        "agent_completed": "Completed",
        "agent_step": "Step",
        "tool_metric": "Tool",
    }
    return f"{labels.get(event_type, event_type)}: {message}"


def _record_tool_metric(job_id: str, message: str) -> None:
    tool_name, _, rest = message.partition(" | ")
    elapsed_text, _, _target = rest.partition(" | ")
    try:
        elapsed = float(elapsed_text.removesuffix("s"))
    except ValueError:
        elapsed = 0.0

    stats = _tool_stats.setdefault(job_id, {})
    tool_stats = stats.setdefault(tool_name, {"calls": 0.0, "seconds": 0.0})
    tool_stats["calls"] += 1
    tool_stats["seconds"] += elapsed
    record_event(f"Tool {message}", job_id=job_id)


def _format_tool_summary(job_id: str) -> str:
    stats = _tool_stats.get(job_id) or {}
    parts = []
    for tool_name in ["search_films", "get_film"]:
        tool_stats = stats.get(tool_name)
        if not tool_stats:
            continue
        parts.append(f"{tool_name}: {int(tool_stats['calls'])} calls, {tool_stats['seconds']:.2f}s total")
    return " | ".join(parts)


async def _run_job(job_id: str, use_saved_taste_profile: bool) -> None:
    async with _job_lock:
        job = _jobs[job_id]
        job.status = "running"
        job.stage = "starting"
        job.agent_statuses = [
            AgentStatus(name="Personal Taste Analyst", status="pending"),
            AgentStatus(name="Film Scout", status="pending"),
            AgentStatus(name="Chief Curator", status="pending"),
        ]
        _jobs[job_id] = job
        set_active_job(job_id)
        record_event("Recommendation job started.", job_id=job_id)

        try:
            result_text = await _run_recommendation(job.mood, job_id, use_saved_taste_profile)
            _update_job_stage(job_id, "parsing_results")
            movies = _extract_movies(result_text)
            movies = await _enrich_movie_posters(movies)
            display_text = _clean_display_text(result_text)
            finished = _now()
            latest_job = _jobs.get(job_id, job)
            completed = latest_job.model_copy(
                update={
                    "status": "succeeded",
                    "stage": "finished",
                    "result_text": display_text,
                    "movies": movies,
                    "finished_at": finished,
                }
            )
            tool_summary = _format_tool_summary(job_id)
            if tool_summary:
                completed.events = [*completed.events, f"Tool summary: {tool_summary}"][-20:]
                record_event(f"Tool summary: {tool_summary}", job_id=job_id)
            _jobs[job_id] = completed
            record_event("Recommendation job finished.", job_id=job_id)
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
            error = _format_exception(exc)
            failed = job.model_copy(
                update={
                    "status": "failed",
                    "stage": "failed",
                    "error": error,
                    "finished_at": _now(),
                }
            )
            _jobs[job_id] = failed
            record_event(error, level="error", job_id=job_id)
        except asyncio.CancelledError:
            latest_job = _jobs.get(job_id, job)
            cancelled = latest_job.model_copy(
                update={
                    "status": "cancelled",
                    "stage": "cancelled",
                    "error": "Recommendation job cancelled.",
                    "finished_at": _now(),
                }
            )
            _jobs[job_id] = cancelled
            record_event("Recommendation job cancelled.", level="warning", job_id=job_id)
            raise
        finally:
            if get_status().get("active_job_id") == job_id:
                set_active_job(None)
            _job_tasks.pop(job_id, None)


async def _run_recommendation(mood: str, job_id: str, use_saved_taste_profile: bool) -> str:
    external_url = get_external_mcp_url()
    event_loop = asyncio.get_running_loop()
    async with mcp_session(external_url) as session:
        _update_job_stage(job_id, "checking_letterboxd")
        record_event("MCP session connected.")
        ok, info = await preflight_check(session)
        if ok:
            record_event(f"Letterboxd preflight passed for @{info}." if info else "Letterboxd preflight passed.")
        else:
            record_event(f"Letterboxd preflight warning: {info}", level="warning")
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

        saved_taste_profile = ""
        if use_saved_taste_profile:
            saved_taste_profile = format_profile_for_prompt(await get_taste_profile())
            if saved_taste_profile:
                record_event("Using saved taste profile for this recommendation.", job_id=job_id)

        crew = MovieCrew(
            session=session,
            mood=mood,
            watchlist_only_candidates=watchlist_only_candidates,
            status_callback=lambda event_type, message: _update_agent_status(job_id, event_type, message),
            saved_taste_profile=saved_taste_profile,
            skip_live_taste_analysis=bool(saved_taste_profile),
            event_loop=event_loop,
        )
        _update_job_stage(job_id, "running_crewai")
        record_event("Starting crewAI recommendation pipeline.")
        return await asyncio.to_thread(crew.run_recommendation_only)


def _format_exception(exc: BaseException) -> str:
    text = _flatten_exception(exc)
    lowered = text.lower()
    if "invalid access token" in lowered or "token expired" in lowered:
        return (
            "AI provider authentication failed: invalid access token or token expired. "
            "Update DASHSCOPE_API_KEY in .env, then restart the backend."
        )
    return text or exc.__class__.__name__


def _flatten_exception(exc: BaseException) -> str:
    children = getattr(exc, "exceptions", None)
    if children:
        return " | ".join(_flatten_exception(child) for child in children)
    return str(exc)
