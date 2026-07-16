from __future__ import annotations

import asyncio
import uuid
from datetime import datetime, timezone

from movie_rec.core.mcp_manager import mcp_session, preflight_check

from ..core.settings import get_external_mcp_url
from ..schemas.taste_profile import TasteProfile, TasteProfileRefreshJobResponse
from ..storage.database import connect
from .runtime_status import record_event
from ..core.settings import can_read_letterboxd, is_demo_mode


_refresh_jobs: dict[str, TasteProfileRefreshJobResponse] = {}
_refresh_lock = asyncio.Lock()


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _row_to_profile(row) -> TasteProfile:
    return TasteProfile(
        id=row["id"],
        summary=row["summary"],
        exploration_suggestions=row["exploration_suggestions"],
        raw_profile=row["raw_profile"],
        created_at=row["created_at"],
        updated_at=row["updated_at"],
    )


async def get_taste_profile() -> TasteProfile | None:
    db = await connect()
    try:
        cursor = await db.execute(
            """
            SELECT id, summary, exploration_suggestions, raw_profile, created_at, updated_at
            FROM taste_profile
            WHERE id = 'default'
            """
        )
        row = await cursor.fetchone()
    finally:
        await db.close()
    return _row_to_profile(row) if row else None


async def save_taste_profile(profile: TasteProfile) -> None:
    db = await connect()
    try:
        await db.execute(
            """
            INSERT OR REPLACE INTO taste_profile
            (id, summary, exploration_suggestions, raw_profile, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            (
                profile.id,
                profile.summary,
                profile.exploration_suggestions,
                profile.raw_profile,
                profile.created_at.isoformat(),
                profile.updated_at.isoformat(),
            ),
        )
        await db.commit()
    finally:
        await db.close()


async def refresh_taste_profile() -> TasteProfile:
    record_event("Refreshing saved taste profile.")
    if is_demo_mode():
        from movie_rec.providers.demo import DemoTasteDataProvider

        provider = DemoTasteDataProvider()
        summary, suggestions = provider.profile_sections()
        existing = await get_taste_profile()
        now = _now()
        profile = TasteProfile(
            id="default",
            summary=summary,
            exploration_suggestions=suggestions,
            raw_profile=f"## Current Taste Profile\n\n{summary}\n\n## Unexplored Directions\n\n{suggestions}",
            created_at=existing.created_at if existing else now,
            updated_at=now,
        )
        await save_taste_profile(profile)
        record_event("Saved fictional demo taste profile.")
        return profile

    if not can_read_letterboxd():
        raise RuntimeError("Letterboxd reads are disabled and no demo provider is active.")

    from crewai import Crew, Process, Task
    from movie_rec.agents.agents import create_taste_analyst_agent
    from movie_rec.tools.letterboxd_tools import GetUserContextTool

    async with mcp_session(get_external_mcp_url()) as session:
        ok, info = await preflight_check(session)
        if not ok:
            record_event(f"Taste profile refresh preflight warning: {info}", level="warning")

        agent = create_taste_analyst_agent([GetUserContextTool(session=session)])
        task = Task(
            description=(
                "Build a persistent personal movie taste profile for the authenticated Letterboxd user.\n\n"
                "First call `get_user_context` once. Then produce two clearly separated sections:\n\n"
                "SECTION A — CURRENT TASTE PROFILE\n"
                "Summarize the user's current film taste: favourite genres, recurring emotional modes, "
                "directors/eras/regions, visual or narrative preferences, likely dislikes, and key reference films.\n\n"
                "Evidence weighting rules:\n"
                "1. Highest priority: explicit favourites / red-heart liked films / pinned favourites.\n"
                "2. High priority: films rated 4 stars or above.\n"
                "3. Medium priority: watchlist and repeated director/style signals.\n"
                "4. Low priority: recently watched films without a high rating or red-heart signal. "
                "Do NOT treat a recently watched film as a key reference film unless it is also liked, favourited, "
                "or clearly high-rated. If the context says a film was merely recent, describe it as recent context, not core taste.\n\n"
                "For Key Reference Films, prefer liked/favourited/high-rated films over recent watches. "
                "Avoid using Beasts of the Southern Wild or any other merely recent film as a key reference unless the context marks it liked/favourited/high-rated.\n\n"
                "SECTION B — UNEXPLORED DIRECTIONS\n"
                "Recommend 8-12 areas the user may enjoy but has not deeply explored yet. Include a mix of: "
                "directors, film movements/styles, national or regional cinemas, specific periods, and genre pockets. "
                "For each, give a short reason and 1-2 starter films."
            ),
            expected_output=(
                "Markdown with exactly two headings:\n"
                "## Current Taste Profile\n"
                "## Unexplored Directions\n"
                "Keep it concise but specific. Do not recommend already-watched films as starter films if the context says they were watched."
            ),
            agent=agent,
            human_input=False,
        )
        crew = Crew(
            agents=[agent],
            tasks=[task],
            process=Process.sequential,
            verbose=False,
        )
        raw = str(crew.kickoff())

    summary, suggestions = _split_profile(raw)
    existing = await get_taste_profile()
    now = _now()
    profile = TasteProfile(
        id="default",
        summary=_strip_section_heading(summary, "Current Taste Profile"),
        exploration_suggestions=_strip_section_heading(suggestions, "Unexplored Directions"),
        raw_profile=raw,
        created_at=existing.created_at if existing else now,
        updated_at=now,
    )
    await save_taste_profile(profile)
    record_event("Saved taste profile refreshed.")
    return profile


async def create_taste_profile_refresh_job() -> TasteProfileRefreshJobResponse:
    job_id = str(uuid.uuid4())
    job = TasteProfileRefreshJobResponse(
        job_id=job_id,
        status="queued",
        stage="queued",
        created_at=_now(),
    )
    _refresh_jobs[job_id] = job
    asyncio.create_task(_run_refresh_job(job_id))
    return job


def get_taste_profile_refresh_job(job_id: str) -> TasteProfileRefreshJobResponse | None:
    return _refresh_jobs.get(job_id)


async def _run_refresh_job(job_id: str) -> None:
    async with _refresh_lock:
        job = _refresh_jobs[job_id]
        job.status = "running"
        job.stage = "running_personal_taste_analyst"
        _refresh_jobs[job_id] = job
        try:
            profile = await refresh_taste_profile()
            _refresh_jobs[job_id] = job.model_copy(
                update={
                    "status": "succeeded",
                    "stage": "finished",
                    "profile": profile,
                    "finished_at": _now(),
                }
            )
        except Exception as exc:
            _refresh_jobs[job_id] = job.model_copy(
                update={
                    "status": "failed",
                    "stage": "failed",
                    "error": str(exc),
                    "finished_at": _now(),
                }
            )
            record_event(f"Taste profile refresh failed: {exc}", level="error")


def format_profile_for_prompt(profile: TasteProfile | None) -> str:
    if not profile:
        return ""
    return (
        "SAVED LONG-TERM TASTE PROFILE\n\n"
        f"{profile.summary}\n\n"
        "SAVED UNEXPLORED DIRECTIONS\n\n"
        f"{profile.exploration_suggestions}"
    )


def _split_profile(raw: str) -> tuple[str, str]:
    marker = "## Unexplored Directions"
    if marker in raw:
        summary, suggestions = raw.split(marker, 1)
        return summary.strip(), f"{marker}\n{suggestions.strip()}"
    return raw.strip(), ""


def _strip_section_heading(text: str, heading: str) -> str:
    return (
        text.strip()
        .removeprefix(f"## {heading}")
        .removeprefix(f"# {heading}")
        .strip()
    )
