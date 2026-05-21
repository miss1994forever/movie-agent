from __future__ import annotations

import asyncio

from fastapi import HTTPException

from ..core.settings import get_external_mcp_url

from movie_rec.core.mcp_manager import extract_json, mcp_session, preflight_check


async def check_auth() -> tuple[bool, str | None, str | None]:
    async with mcp_session(get_external_mcp_url()) as session:
        ok, info = await preflight_check(session)
        if ok:
            return True, info or None, None
        return False, None, info


async def call_write_tool(tool_name: str, args: dict, confirmed: bool) -> dict:
    if not confirmed:
        raise HTTPException(status_code=400, detail="Explicit confirmation is required.")
    async with mcp_session(get_external_mcp_url()) as session:
        result = await asyncio.wait_for(
            session.call_tool(tool_name, arguments=args),
            timeout=120,
        )
        payload = extract_json(result)
        if not payload:
            return {"success": True, "raw": str(result)}
        return payload
