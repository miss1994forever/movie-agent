from __future__ import annotations

import asyncio

from fastapi import HTTPException

from ..core.settings import can_write_letterboxd, get_external_mcp_url

from movie_rec.core.mcp_manager import extract_json, mcp_session, preflight_check


async def check_auth() -> tuple[bool, str | None, str | None]:
    async with mcp_session(get_external_mcp_url()) as session:
        ok, info = await preflight_check(session)
        if ok:
            return True, info or None, None
        return False, None, info


async def deep_check_auth() -> dict:
    async with mcp_session(get_external_mcp_url()) as session:
        raw_user = await asyncio.wait_for(
            session.call_tool("get_current_user", arguments={"tryLogin": True}),
            timeout=90,
        )
        user = extract_json(raw_user)
        username = user.get("username") if isinstance(user, dict) else None
        logged_in = bool(isinstance(user, dict) and user.get("loggedIn"))
        warnings: list[str] = []
        error = user.get("error") if isinstance(user, dict) else None

        profile_read_ok = False
        watchlist_read_ok = False

        if logged_in:
            try:
                raw_snapshot = await asyncio.wait_for(
                    session.call_tool("get_member_snapshot", arguments={"username": "me"}),
                    timeout=120,
                )
                snapshot = extract_json(raw_snapshot)
                warnings.extend(snapshot.get("warnings") or [])
                profile_read_ok = bool(
                    (snapshot.get("favourites") or [])
                    or (snapshot.get("watchlist") or [])
                    or (snapshot.get("recent") or [])
                    or (snapshot.get("ratings") or [])
                    or (snapshot.get("diary") or [])
                    or snapshot.get("username")
                )
            except Exception as exc:
                warnings.append(f"Profile snapshot failed: {exc}")

            try:
                raw_watchlist = await asyncio.wait_for(
                    session.call_tool(
                        "get_member_watchlist",
                        arguments={"username": "me", "maxPages": 1},
                    ),
                    timeout=120,
                )
                watchlist = extract_json(raw_watchlist)
                watchlist_read_ok = bool(
                    (watchlist.get("items") is not None)
                    or (watchlist.get("films") is not None)
                    or not watchlist.get("error")
                )
                if watchlist.get("error"):
                    warnings.append(f"Watchlist read error: {watchlist.get('error')}")
            except Exception as exc:
                warnings.append(f"Watchlist read failed: {exc}")

        return {
            "ok": bool(logged_in and profile_read_ok),
            "username": username,
            "logged_in": logged_in,
            "profile_read_ok": profile_read_ok,
            "watchlist_read_ok": watchlist_read_ok,
            "warnings": warnings,
            "error": error,
        }


async def call_write_tool(tool_name: str, args: dict, confirmed: bool) -> dict:
    if not can_write_letterboxd():
        raise HTTPException(status_code=403, detail="Letterboxd write actions are disabled by server policy.")
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
