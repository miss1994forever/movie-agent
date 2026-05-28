from __future__ import annotations

import os
import sys
from pathlib import Path

from dotenv import load_dotenv, set_key


PROJECT_ROOT = Path(__file__).resolve().parents[4]
SRC_PATH = PROJECT_ROOT / "src"
WEB_DATA_DIR = PROJECT_ROOT / "web" / "backend" / "data"
DATABASE_PATH = WEB_DATA_DIR / "movie_rec.sqlite3"
ENV_PATH = PROJECT_ROOT / ".env"

if str(SRC_PATH) not in sys.path:
    sys.path.insert(0, str(SRC_PATH))

load_dotenv(ENV_PATH, override=True)


def get_external_mcp_url() -> str | None:
    value = os.getenv("LETTERBOXD_MCP_URL", "").strip()
    return value or None


def public_config_status() -> dict[str, bool]:
    has_username_password = bool(
        os.getenv("LETTERBOXD_USERNAME", "").strip()
        and os.getenv("LETTERBOXD_PASSWORD", "").strip()
    )
    has_credentials = bool(os.getenv("LETTERBOXD_CREDENTIALS", "").strip())
    has_cookie = bool(os.getenv("LETTERBOXD_COOKIE", "").strip())
    return {
        "dashscope_api_key": bool(os.getenv("DASHSCOPE_API_KEY", "").strip()),
        "tmdb_api_key": bool(os.getenv("TMDB_API_KEY", "").strip()),
        "letterboxd_configured": has_username_password or has_credentials or has_cookie,
    }


def update_env_config(values: dict[str, str | None]) -> dict[str, bool]:
    ENV_PATH.touch(exist_ok=True)
    for key, value in values.items():
        normalized = (value or "").strip()
        set_key(str(ENV_PATH), key, normalized, quote_mode="always")
        os.environ[key] = normalized

    load_dotenv(ENV_PATH, override=True)
    _refresh_movie_rec_config()
    return public_config_status()


def _refresh_movie_rec_config() -> None:
    try:
        from movie_rec.core import config as movie_config
    except Exception:
        return

    movie_config.DASHSCOPE_API_KEY = os.getenv("DASHSCOPE_API_KEY", "")
    movie_config.AI_MODEL = os.getenv("AI_MODEL", "qwen-max")
    movie_config.DASHSCOPE_BASE_URL = os.getenv(
        "DASHSCOPE_BASE_URL",
        "https://dashscope.aliyuncs.com/compatible-mode/v1",
    )
    movie_config.CREW_VERBOSE = os.getenv("CREW_VERBOSE", "false").lower() in {"1", "true", "yes"}
