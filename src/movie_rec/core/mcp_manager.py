"""MCP server lifecycle — start, connect, preflight, teardown."""
import asyncio
import json
import os
import socket
from contextlib import asynccontextmanager

from mcp import ClientSession
from mcp.client.sse import sse_client

from .config import (
    MCP_HOST, MCP_PORT, MCP_INIT_TIMEOUT, MCP_READY_TIMEOUT, MCP_PLUGIN_PATH
)


# ── Helpers ──────────────────────────────────────────────────────────────────

def get_free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


async def _is_port_open(host: str, port: int) -> bool:
    try:
        r, w = await asyncio.open_connection(host, port)
        w.close()
        await w.wait_closed()
        return True
    except Exception:
        return False


async def _wait_for_port(host: str, port: int, timeout: float) -> None:
    deadline = asyncio.get_running_loop().time() + timeout
    while asyncio.get_running_loop().time() < deadline:
        if await _is_port_open(host, port):
            return
        await asyncio.sleep(0.25)
    raise TimeoutError(f"MCP server not ready after {timeout:.0f}s")


def _build_env(port: int) -> dict:
    """Build subprocess env, prioritising credentials from .env over shell exports."""
    username = os.getenv("LETTERBOXD_USERNAME", "").strip()
    password = os.getenv("LETTERBOXD_PASSWORD", "").strip()
    credentials = os.getenv("LETTERBOXD_CREDENTIALS", "").strip()
    cookie = os.getenv("LETTERBOXD_COOKIE", "").strip()

    use_up = bool(username and password)
    use_creds = bool(not use_up and credentials)
    use_cookie = bool(not use_up and not use_creds and cookie)

    return {
        **os.environ,
        "PORT": str(port),
        "LETTERBOXD_USERNAME": username if use_up else "",
        "LETTERBOXD_PASSWORD": password if use_up else "",
        "LETTERBOXD_CREDENTIALS": credentials if use_creds else "",
        "LETTERBOXD_COOKIE": cookie if use_cookie else "",
        "TMDB_API_KEY": os.getenv("TMDB_API_KEY", ""),
    }


# ── Public utilities ─────────────────────────────────────────────────────────

def extract_json(tool_result) -> dict:
    """Extract and parse the JSON payload from an MCP tool result."""
    for block in getattr(tool_result, "content", []) or []:
        text = getattr(block, "text", None)
        if text:
            try:
                return json.loads(text)
            except json.JSONDecodeError:
                return {}
    return {}


async def preflight_check(session: ClientSession) -> tuple[bool, str]:
    """Verify Letterboxd connectivity. Returns (ok, username_or_error)."""
    try:
        raw = await asyncio.wait_for(
            session.call_tool("get_current_user", arguments={"tryLogin": True}),
            timeout=MCP_INIT_TIMEOUT,
        )
        user = extract_json(raw)
        if not isinstance(user, dict) or not user.get("loggedIn"):
            detail = user.get("error", "") if isinstance(user, dict) else ""
            return False, detail or "Not authenticated"
        return True, user.get("username", "")
    except asyncio.TimeoutError:
        return False, "Connection timed out"
    except Exception as exc:
        return False, str(exc)


# ── Context manager ──────────────────────────────────────────────────────────

@asynccontextmanager
async def mcp_session(external_url: str = None):
    """Start the MCP Node server (if needed) and yield an active ClientSession."""
    port = MCP_PORT
    process = None

    if not external_url:
        if await _is_port_open(MCP_HOST, port):
            port = get_free_port()
        url = f"http://{MCP_HOST}:{port}/sse"
        process = await asyncio.create_subprocess_exec(
            "node", MCP_PLUGIN_PATH, "--mode=sse",
            env=_build_env(port),
            stdout=asyncio.subprocess.DEVNULL,
            stderr=asyncio.subprocess.DEVNULL,
        )
        await _wait_for_port(MCP_HOST, port, MCP_READY_TIMEOUT)
    else:
        url = external_url

    try:
        async with sse_client(url, timeout=10, sse_read_timeout=300) as (read, write):
            async with ClientSession(read, write) as session:
                await asyncio.wait_for(session.initialize(), timeout=MCP_INIT_TIMEOUT)
                yield session
    finally:
        if process is not None and process.returncode is None:
            process.terminate()
            try:
                await asyncio.wait_for(process.wait(), timeout=3)
            except (asyncio.TimeoutError, ProcessLookupError):
                pass
