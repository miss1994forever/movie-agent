from __future__ import annotations

import os
import sys
from pathlib import Path

from dotenv import load_dotenv


PROJECT_ROOT = Path(__file__).resolve().parents[4]
SRC_PATH = PROJECT_ROOT / "src"
WEB_DATA_DIR = PROJECT_ROOT / "web" / "backend" / "data"
DATABASE_PATH = WEB_DATA_DIR / "movie_rec.sqlite3"

if str(SRC_PATH) not in sys.path:
    sys.path.insert(0, str(SRC_PATH))

load_dotenv(PROJECT_ROOT / ".env", override=True)


def get_external_mcp_url() -> str | None:
    value = os.getenv("LETTERBOXD_MCP_URL", "").strip()
    return value or None


def public_config_status() -> dict[str, bool]:
    return {
        "dashscope_api_key": bool(os.getenv("DASHSCOPE_API_KEY", "").strip()),
        "tmdb_api_key": bool(os.getenv("TMDB_API_KEY", "").strip()),
        "letterboxd_username": bool(os.getenv("LETTERBOXD_USERNAME", "").strip()),
        "letterboxd_password": bool(os.getenv("LETTERBOXD_PASSWORD", "").strip()),
        "letterboxd_credentials": bool(os.getenv("LETTERBOXD_CREDENTIALS", "").strip()),
        "letterboxd_cookie": bool(os.getenv("LETTERBOXD_COOKIE", "").strip()),
    }
