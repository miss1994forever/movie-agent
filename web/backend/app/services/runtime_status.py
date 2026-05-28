from __future__ import annotations

from collections import deque
from datetime import datetime, timezone
from typing import Any


_events: deque[dict[str, Any]] = deque(maxlen=80)
_active_job_id: str | None = None
_last_error: str | None = None


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def record_event(message: str, level: str = "info", job_id: str | None = None) -> None:
    global _last_error
    if level == "error":
        _last_error = message
    _events.appendleft(
        {
            "time": _now(),
            "level": level,
            "job_id": job_id,
            "message": message,
        }
    )


def set_active_job(job_id: str | None) -> None:
    global _active_job_id
    _active_job_id = job_id


def get_status() -> dict[str, Any]:
    return {
        "ok": True,
        "active_job_id": _active_job_id,
        "last_error": _last_error,
        "events": list(_events),
    }


def clear_events() -> None:
    global _last_error
    _events.clear()
    _last_error = None
