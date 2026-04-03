"""
Async entry point for the Movie Recommendation Agent.

Flow:
  1. Validate local credentials (shape check, no network).
  2. Start the MCP Node server and establish a ClientSession.
  3. Run a Letterboxd preflight check (login + watchlist read).
  4. Ask the user for their current mood.
  5. (Optional) Pre-fetch the watchlist if the user requests watchlist-only picks.
  6. Hand off to MovieCrew — crewAI orchestrates context-gathering, recommendation,
     refinement loop (human_input=True) and account sync.
"""

import asyncio
import json
import os
import sys
import traceback

import nest_asyncio

nest_asyncio.apply()

from dotenv import load_dotenv

load_dotenv(override=True)

from .core.mcp_manager import extract_json, mcp_session, preflight_check
from .cli.cli import (
    safe_input,
    validate_credentials,
    detect_watchlist_only,
    run_setup_wizard,
    parse_args,
)
from .crews.movie_crew import MovieCrew


# ── Auth check ────────────────────────────────────────────────────────────────

async def _check_auth() -> int:
    external_url = os.getenv("LETTERBOXD_MCP_URL", "") or None
    print("🚀 Starting MCP server for auth check...")
    async with mcp_session(external_url) as session:
        ok, info = await preflight_check(session)
        if ok:
            print(f"✅ Letterboxd auth OK  (user: @{info})" if info else "✅ Letterboxd auth OK")
            return 0
        print(f"❌ Auth failed: {info}")
        _print_auth_tips(info)
        return 1


def _print_auth_tips(error: str) -> None:
    print("\n💡 Tips:")
    if "credentials" in error.lower() or "not authenticated" in error.lower():
        print("  • Run `python run.py --setup` to configure credentials.")
    elif "timeout" in error.lower():
        print("  • Increase MCP_INIT_TIMEOUT_SEC in .env (e.g. 60).")
        print("  • Set LETTERBOXD_HEADLESS=false to see the browser window.")
    elif "login failed" in error.lower():
        print("  • Double-check LETTERBOXD_USERNAME (slug, not email) and PASSWORD.")
        print("  • Try `python run.py --setup` to reconfigure.")


# ── Main recommendation flow ──────────────────────────────────────────────────

async def _run() -> None:
    ok, reason = validate_credentials()
    if not ok:
        print(f"\n❌ Config error: {reason}")
        sys.exit(1)

    external_url = os.getenv("LETTERBOXD_MCP_URL", "") or None
    print("🚀 Connecting to Letterboxd MCP server...")

    async with mcp_session(external_url) as session:
        ok, username = await preflight_check(session)
        if ok:
            display = f"@{username}" if username else "account"
            print(f"✅ Connected ({display})")
        else:
            print(f"\n⚠️  Preflight warning: {username}")
            print("Continuing — recommendations may not be personalised.\n")

        mood_raw = safe_input("\n🎥 What's your mood today? (e.g. 想看王家卫 / just finished exams): ")
        if mood_raw is None:
            return
        mood = mood_raw.strip()
        if not mood:
            mood = "want to watch something good"

        # Pre-fetch watchlist when user explicitly requests watchlist-only picks
        watchlist_only_candidates: str | None = None
        if detect_watchlist_only(mood):
            print("🔎 Fetching your watchlist for watchlist-only mode...")
            try:
                raw = await session.call_tool(
                    "get_member_watchlist", arguments={"username": "me", "maxPages": 1}
                )
                payload = extract_json(raw)
                items = (payload.get("items") or payload.get("films") or [])[:50]
                if items:
                    pairs = [
                        {"title": x.get("title", ""), "slug": x.get("slug", "")}
                        for x in items
                    ]
                    watchlist_only_candidates = json.dumps(pairs, ensure_ascii=False)
                    print(f"   Found {len(pairs)} films in watchlist.")
                else:
                    print("⚠️  Watchlist is empty — falling back to general recommendations.")
            except Exception as exc:
                print(f"⚠️  Could not read watchlist: {exc}")

        # Run the crewAI crew (blocks here; nest_asyncio allows this inside async)
        print("\n🤖 Starting MovieCrew...\n")
        crew = MovieCrew(
            session=session,
            mood=mood,
            watchlist_only_candidates=watchlist_only_candidates,
        )
        result = crew.run()

        print("\n" + "=" * 50)
        print("🌟 Final result:")
        print(result)
        print("=" * 50)


# ── Public entry point ────────────────────────────────────────────────────────

def main() -> None:
    args = parse_args()

    if args.setup:
        run_setup_wizard()
        sys.exit(0)

    if args.check_auth:
        try:
            code = asyncio.run(_check_auth())
        except Exception as exc:
            print(f"\n❌ Auth check error: {exc}")
            if os.getenv("DEBUG_TRACEBACK", "false").lower() in {"1", "true", "yes"}:
                traceback.print_exc()
            code = 1
        sys.exit(code)

    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)
    try:
        loop.run_until_complete(_run())
    except KeyboardInterrupt:
        print("\n\nSession cancelled.")
        sys.exit(130)
    except Exception as exc:
        print(f"\n❌ Unexpected error: {exc}")
        if os.getenv("DEBUG_TRACEBACK", "false").lower() in {"1", "true", "yes"}:
            traceback.print_exc()
        sys.exit(1)
    finally:
        loop.close()


if __name__ == "__main__":
    main()
