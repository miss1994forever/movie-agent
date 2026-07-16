from __future__ import annotations

import asyncio
import json

import pytest

from movie_rec.providers.demo import DemoTasteDataProvider
from web.backend.app.api.auth import auth_check, update_config
from web.backend.app.core.settings import (
    can_read_letterboxd,
    can_write_config,
    can_write_letterboxd,
    is_demo_mode,
    get_database_path,
)
from web.backend.app.schemas.letterboxd import AppConfigUpdateRequest
from web.backend.app.services import recommendation_service
from web.backend.app.services.letterboxd_service import call_write_tool
from web.backend.app.storage.database import init_db


def test_demo_provider_is_deterministic_and_uses_fictional_context() -> None:
    provider = DemoTasteDataProvider()

    first = provider.recommend("想看一部轻松搞笑的电影")
    second = provider.recommend("想看一部轻松搞笑的电影")

    assert first == second
    assert [movie.slug for movie in first] == ["tampopo", "perfect-days-2023"]
    assert "fictional sample data" in provider.context_text()


def test_demo_capabilities_fail_closed(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("MOVIE_REC_DEMO_MODE", "true")
    monkeypatch.setenv("MOVIE_REC_ALLOW_CONFIG_WRITE", "true")
    monkeypatch.setenv("MOVIE_REC_ALLOW_LETTERBOXD_READ", "true")
    monkeypatch.setenv("MOVIE_REC_ALLOW_LETTERBOXD_WRITE", "true")

    assert is_demo_mode() is True
    assert can_write_config() is False
    assert can_read_letterboxd() is False
    assert can_write_letterboxd() is False
    assert get_database_path().name == "movie_rec_demo.sqlite3"


def test_demo_auth_does_not_open_external_session(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("MOVIE_REC_DEMO_MODE", "true")

    response = asyncio.run(auth_check())

    assert response.ok is True
    assert response.username is None
    assert response.config["demo_mode"] is True


def test_demo_mode_rejects_runtime_config_changes(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("MOVIE_REC_DEMO_MODE", "true")

    with pytest.raises(Exception) as exc_info:
        asyncio.run(update_config(AppConfigUpdateRequest(ai_model="should-not-be-written")))

    assert getattr(exc_info.value, "status_code", None) == 403


def test_demo_recommendation_uses_no_external_session(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("MOVIE_REC_DEMO_MODE", "true")

    async def scenario():
        await init_db()
        job = await recommendation_service.create_recommendation_job("quiet and reflective")
        task = recommendation_service._job_tasks[job.job_id]
        await task
        return recommendation_service.get_recommendation_job(job.job_id)

    completed = asyncio.run(scenario())

    assert completed is not None
    assert completed.status == "succeeded"
    assert len(completed.movies) == 2
    assert all(movie.poster_url is None for movie in completed.movies)
    assert "fictional sample taste data" in completed.result_text
    assert "```json" not in completed.result_text


def test_demo_mode_rejects_letterboxd_writes(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("MOVIE_REC_DEMO_MODE", "true")

    async def scenario() -> None:
        await call_write_tool("toggle_like", {"slug": "tampopo"}, confirmed=True)

    with pytest.raises(Exception) as exc_info:
        asyncio.run(scenario())

    assert getattr(exc_info.value, "status_code", None) == 403


def test_demo_movie_payload_is_json_serializable() -> None:
    movie = DemoTasteDataProvider().recommend("science fiction")[0]
    payload = {
        "title": movie.title,
        "year": movie.year,
        "slug": movie.slug,
        "themes": movie.themes,
    }

    assert json.loads(json.dumps(payload))["slug"] == "after-yang"


def test_recommendation_retries_one_transient_failure(monkeypatch: pytest.MonkeyPatch) -> None:
    attempts = 0

    async def flaky_run(*_args, **_kwargs) -> str:
        nonlocal attempts
        attempts += 1
        if attempts == 1:
            raise TimeoutError("temporary connection timed out")
        return "recovered"

    async def no_wait(_delay: float) -> None:
        return None

    monkeypatch.setenv("RECOMMENDATION_MAX_ATTEMPTS", "2")
    monkeypatch.setattr(recommendation_service, "_run_recommendation", flaky_run)
    monkeypatch.setattr(recommendation_service.asyncio, "sleep", no_wait)

    result = asyncio.run(
        recommendation_service._run_recommendation_with_retry("mood", "missing-job", False)
    )

    assert result == "recovered"
    assert attempts == 2
