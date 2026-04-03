"""Central configuration — reads from .env at import time."""
import os
from pathlib import Path
from dotenv import load_dotenv

load_dotenv(override=True)

# ── Paths ────────────────────────────────────────────────────────────────────
PROJECT_ROOT = Path(__file__).parent.parent.parent.parent
MCP_PLUGIN_PATH = str(PROJECT_ROOT / "Letterboxd-MCP" / "index.js")
ENV_PATH = str(PROJECT_ROOT / ".env")

# ── MCP server ───────────────────────────────────────────────────────────────
MCP_HOST = os.getenv("LETTERBOXD_MCP_HOST", "127.0.0.1")
MCP_PORT = int(os.getenv("PORT", "3000"))
MCP_INIT_TIMEOUT = float(os.getenv("MCP_INIT_TIMEOUT_SEC", "30"))
MCP_READY_TIMEOUT = float(os.getenv("MCP_READY_TIMEOUT_SEC", "20"))

# ── AI (DashScope / Qwen) ───────────────────────────────────────────────────
DASHSCOPE_API_KEY = os.getenv("DASHSCOPE_API_KEY", "")
AI_MODEL = os.getenv("AI_MODEL", "qwen-max")
# Default URL; override in .env for Coding Plan: https://coding.dashscope.aliyuncs.com/v1
DASHSCOPE_BASE_URL = os.getenv(
    "DASHSCOPE_BASE_URL", "https://dashscope.aliyuncs.com/compatible-mode/v1"
)

# ── Letterboxd write-protected tools ────────────────────────────────────────
WRITE_TOOLS = frozenset({
    "add_to_watched",
    "add_to_watchlist",
    "write_review",
    "add_to_list",
    "create_list",
    "toggle_like",
    "rate_film",
})
