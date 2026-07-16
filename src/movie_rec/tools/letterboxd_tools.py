"""
crewAI BaseTool wrappers for Letterboxd MCP tools.

MCP calls are async; crewAI tools are sync by default.
nest_asyncio lets us call loop.run_until_complete() from within the already-running
asyncio event loop that owns the MCP session.
"""
import asyncio
import json
import os
import re
import time
from typing import Any, Callable, Type

import nest_asyncio
from crewai.tools import BaseTool
from pydantic import BaseModel, Field

from ..core.mcp_manager import extract_json

try:
    nest_asyncio.apply()
except ValueError:
    # uvloop cannot be patched. Web calls provide their owning event loop and
    # use run_coroutine_threadsafe, so importing the tools remains safe there.
    pass


# ── Internal helpers ─────────────────────────────────────────────────────────

_SEARCH_FILMS_CACHE: dict[tuple[str, str | None, bool], tuple[float, str]] = {}
_SEARCH_CACHE_TTL_SECONDS = 600.0
_SEARCH_EMPTY_TTL_SECONDS = 30.0


def _env_flag(name: str, default: bool = False) -> bool:
    value = os.getenv(name)
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


def _env_float(name: str, default: float) -> float:
    try:
        return float(os.getenv(name, str(default)))
    except ValueError:
        return default

def _call(session: Any, tool_name: str, args: dict, event_loop: Any | None = None) -> dict:
    """Blocking wrapper: run an async MCP tool call in the current event loop."""
    coroutine = asyncio.wait_for(session.call_tool(tool_name, arguments=args), timeout=90)
    if event_loop is not None and event_loop.is_running():
        result = asyncio.run_coroutine_threadsafe(coroutine, event_loop).result(timeout=95)
    else:
        loop = asyncio.get_event_loop()
        result = loop.run_until_complete(coroutine)
    return extract_json(result)


def _parse_rating(v: Any) -> float:
    """Parse a Letterboxd rating to a 0–5 star float.

    Handles three formats:
      • Numeric 1–10 (Letterboxd internal, e.g. data-rating="8") → divide by 2
      • Numeric 0–5 float (e.g. "3.9" from aggregateRating)
      • Star string (e.g. "★★★★½") → count characters
    """
    if v is None:
        return 0.0
    s = str(v).strip()
    # Star-character format
    star_count = s.count('★') + 0.5 * s.count('½')
    if star_count > 0:
        return star_count
    try:
        n = float(s)
        # Letterboxd internal 1-10 scale → convert to 0-5
        return n / 2.0 if n > 5 else n
    except (TypeError, ValueError):
        return 0.0




def _estimate_slug(title: str) -> str:
    """Estimate a Letterboxd-style slug from a film title (verify with get_film)."""
    s = title.lower()
    s = re.sub(r"[''`']", "", s)        # remove apostrophes
    s = re.sub(r"[^a-z0-9]+", "-", s)  # non-alphanumeric → hyphen
    return s.strip("-")


def _extract_query_title_and_year(query: str) -> tuple[str, str | None]:
    normalized = " ".join((query or "").replace("（", "(").replace("）", ")").split())
    match = re.search(r"(?:\((\d{4})\)|(\d{4}))\s*$", normalized)
    if not match:
        return normalized, None
    year = match.group(1) or match.group(2)
    title = normalized[:match.start()].strip(" -_()")
    return title or normalized, year


def _truncate(d: Any, limit: int = 4000) -> str:
    text = json.dumps(d, ensure_ascii=False)
    return text[:limit] if len(text) > limit else text


def _clean_username(value: str | None) -> str:
    username = (value or "").strip()
    if username.startswith("@"):
        username = username[1:]
    return username


# ── Read tools ───────────────────────────────────────────────────────────────

class GetUserContextInput(BaseModel):
    username: str = Field(default="me", description="Letterboxd username; 'me' = current user")


class GetUserContextTool(BaseTool):
    """Collect user profile context: favorites, liked/high-rated films, recent watches, watchlist."""

    name: str = "get_user_context"
    description: str = (
        "Fetch the current user's Letterboxd context: pinned favorites, highly-rated films "
        "(proxy for liked films), recently watched films, and watchlist sample. "
        "Call this first to understand user preferences before generating recommendations."
    )
    args_schema: Type[BaseModel] = GetUserContextInput
    session: Any
    event_loop: Any | None = None

    model_config = {"arbitrary_types_allowed": True}

    def _run(self, username: str = "me") -> str:
        lines = []
        warnings: list[str] = []
        watched_slugs: list[str] = []  # accumulated for the exclusion section
        low_priority_rewatch_slugs: list[str] = []
        resolved_username = _clean_username(username)
        has_user_line = False
        has_favourites = False
        has_ratings = False
        has_recent = False
        has_watchlist = False
        has_diary = False

        try:
            snapshot = _call(self.session, "get_member_snapshot", {"username": resolved_username or "me"}, self.event_loop)
            if snapshot.get("username"):
                resolved_username = _clean_username(snapshot["username"])
                lines.append(f"User: @{resolved_username}")
                has_user_line = True

            favourites = snapshot.get("favourites") or []
            ratings = snapshot.get("ratings") or []
            recent = snapshot.get("recent") or []
            watchlist = snapshot.get("watchlist") or []
            diary = snapshot.get("diary") or []

            if favourites:
                titles = [f"{f.get('title', '?')} ({f.get('year', '')})" for f in favourites[:8]]
                lines.append(f"[HIGH PRIORITY] Favorites: {', '.join(titles)}")
                watched_slugs += [item.get("slug", "") for item in favourites if item.get("slug")]
                low_priority_rewatch_slugs += [item.get("slug", "") for item in favourites if item.get("slug")]
                has_favourites = True

            top_rated = [item for item in ratings if _parse_rating(item.get("rating")) >= 4.0][:8]
            if top_rated:
                titles = [f"{f.get('title', '?')} ({f.get('rating', '')})" for f in top_rated]
                lines.append(f"[HIGH PRIORITY] Highly-rated films (rating evidence, not necessarily red-heart likes): {', '.join(titles)}")
                low_priority_rewatch_slugs += [item.get("slug", "") for item in top_rated if item.get("slug")]
                has_ratings = True
            watched_slugs += [item.get("slug", "") for item in ratings[:120] if item.get("slug")]

            if recent:
                titles = [item.get("title", "?") for item in recent[:10]]
                lines.append(f"[LOW PRIORITY] Recently watched without explicit like/favourite signal: {', '.join(titles)}")
                has_recent = True
            watched_slugs += [item.get("slug", "") for item in recent[:120] if item.get("slug")]

            if watchlist:
                titles = [item.get("title", item.get("slug", "?")) for item in watchlist[:10]]
                lines.append(f"Watchlist (aspirational taste): {', '.join(titles)}")
                has_watchlist = True

            if diary:
                items = [
                    f"{entry.get('title', '?')} ({entry.get('date', entry.get('watchedDate', '?'))})"
                    for entry in diary[:5]
                ]
                lines.append(f"Recent diary: {', '.join(items)}")
                has_diary = True

            warnings.extend(snapshot.get("warnings") or [])
        except Exception as exc:
            warnings.append(f"Snapshot read unavailable: {exc}")

        # Who is logged in
        if not has_user_line:
            try:
                user = _call(self.session, "get_current_user", {"tryLogin": False}, self.event_loop)
                if user.get("username"):
                    resolved_username = _clean_username(user["username"])
                    lines.append(f"User: @{resolved_username}")
                    has_user_line = True
            except Exception as exc:
                warnings.append(f"Could not resolve current user: {exc}")

        if not resolved_username:
            resolved_username = "me"

        # Pinned / favorite films (highest priority for preference inference)
        if not has_favourites:
            try:
                data = _call(self.session, "get_member_pinned", {"username": resolved_username}, self.event_loop)
                films = (data.get("items") or data.get("films") or [])[:8]
                if films:
                    titles = [f"{f.get('title', '?')} ({f.get('year', '')})" for f in films]
                    lines.append(f"[HIGH PRIORITY] Favorites: {', '.join(titles)}")
                    watched_slugs += [f.get("slug", "") for f in films if f.get("slug")]
                    low_priority_rewatch_slugs += [f.get("slug", "") for f in films if f.get("slug")]
            except Exception as exc:
                warnings.append(f"Could not read favourites: {exc}")

        # Highly-rated films from the ratings page (best available proxy for "liked" films)
        if not has_ratings:
            try:
                data = _call(self.session, "get_member_ratings", {"username": resolved_username, "maxPages": 2}, self.event_loop)
                films = data.get("items") or data.get("films") or []
                top_rated = [f for f in films if _parse_rating(f.get("rating")) >= 4.0][:8]
                if top_rated:
                    titles = [f"{f.get('title', '?')} ({f.get('rating', '')})"
                              for f in top_rated]
                    lines.append(f"[HIGH PRIORITY] Highly-rated / liked films: {', '.join(titles)}")
                    low_priority_rewatch_slugs += [f.get("slug", "") for f in top_rated if f.get("slug")]
                watched_slugs += [f.get("slug", "") for f in films[:120] if f.get("slug")]
            except Exception as exc:
                warnings.append(f"Could not read ratings/liked films: {exc}")

        # Watched films log — collect recently watched for exclusion and taste signals
        if not has_recent:
            try:
                data = _call(self.session, "get_member_films", {"username": resolved_username, "maxPages": 2}, self.event_loop)
                films = data.get("items") or data.get("films") or []
                recent = films[:10]
                titles: list[str] = []
                if recent:
                    titles = [f.get("title", "?") for f in recent]
                    lines.append(f"[LOW PRIORITY] Recently watched without explicit like/favourite signal: {', '.join(titles)}")
                watched_slugs += [f.get("slug", "") for f in films[:120] if f.get("slug")]
            except Exception as exc:
                warnings.append(f"Could not read watched films: {exc}")

        # Watchlist — aspirational taste reference
        if not has_watchlist:
            try:
                data = _call(self.session, "get_member_watchlist", {"username": resolved_username, "maxPages": 1}, self.event_loop)
                films = (data.get("items") or data.get("films") or [])[:10]
                if films:
                    titles = [f.get("title", f.get("slug", "?")) for f in films]
                    lines.append(f"Watchlist (aspirational taste): {', '.join(titles)}")
            except Exception as exc:
                warnings.append(f"Could not read watchlist: {exc}")

        # Diary — recent viewing dates context
        if not has_diary:
            try:
                data = _call(self.session, "get_member_diary", {"username": resolved_username, "maxPages": 1}, self.event_loop)
                entries = (data.get("items") or [])[:5]
                if entries:
                    items = [f"{e.get('title', '?')} ({e.get('date', e.get('watchedDate', '?'))})" for e in entries]
                    lines.append(f"Recent diary: {', '.join(items)}")
            except Exception as exc:
                warnings.append(f"Could not read diary: {exc}")

        # ── Exclusion list for the Film Scout ─────────────────────────────────
        unique_watched = list(dict.fromkeys(s for s in watched_slugs if s))
        low_priority_rewatch = [s for s in dict.fromkeys(low_priority_rewatch_slugs) if s]
        if unique_watched:
            lines.append(
                f"[FILM SCOUT — HARD EXCLUDE] Already watched — do NOT recommend any of these: "
                + ", ".join(unique_watched[:150])
            )
        if low_priority_rewatch:
            lines.append(
                "[FILM SCOUT — LOW PRIORITY REWATCH] These are favourites or highly-rated rewatches. "
                "Only use them if the user explicitly asks for rewatches or if you genuinely cannot find stronger unseen options: "
                + ", ".join(low_priority_rewatch[:40])
            )

        if len(lines) <= 1 and warnings:
            lines.append(
                "Profile reads failed or returned challenge pages. Use these warnings instead of assuming the account has no activity:"
            )
            lines.extend(f"- {warning}" for warning in warnings[:5])
        elif warnings:
            lines.append("Context read warnings: " + " | ".join(warnings[:3]))

        return "\n".join(lines) if lines else "No user context available."


class SearchFilmsInput(BaseModel):
    query: str = Field(description="Film title or keywords to search")


class SearchFilmsTool(BaseTool):
    """Search for films via TMDB API, with optional Letterboxd search fallback."""

    name: str = "search_films"
    description: str = (
        "Search for concrete film titles quickly. Uses TMDB first for discovery metadata. "
        "Returned slugs are best-effort hints; prefer get_film for known or finalist slugs."
    )
    args_schema: Type[BaseModel] = SearchFilmsInput
    session: Any
    event_loop: Any | None = None
    telemetry_callback: Callable[[str, str, float, str], None] | None = None

    model_config = {"arbitrary_types_allowed": True}

    def _run(self, query: str) -> str:
        started = time.perf_counter()
        title_query, release_year = _extract_query_title_and_year(query)
        api_key = os.getenv("TMDB_API_KEY", "").strip()
        cache_key = (title_query.lower(), release_year, bool(api_key))
        cached = _SEARCH_FILMS_CACHE.get(cache_key)
        cache_hit = bool(cached and cached[0] > time.monotonic())
        if cached and not cache_hit:
            _SEARCH_FILMS_CACHE.pop(cache_key, None)
        try:
            if cache_hit:
                return cached[1]

            if api_key:
                result = self._tmdb_search(title_query, api_key, preferred_year=release_year)
                if result:
                    _SEARCH_FILMS_CACHE[cache_key] = (time.monotonic() + _SEARCH_CACHE_TTL_SECONDS, result)
                    return result

                if not _env_flag("MOVIE_REC_LETTERBOXD_SEARCH_FALLBACK", default=False):
                    result = (
                        f"No fast TMDB results found for '{query}'. "
                        "Try a concrete known film title, or estimate a likely Letterboxd slug and call get_film."
                    )
                    _SEARCH_FILMS_CACHE[cache_key] = (time.monotonic() + _SEARCH_EMPTY_TTL_SECONDS, result)
                    return result

            letterboxd_result = self._letterboxd_search(query, preferred_year=release_year)
            if letterboxd_result:
                _SEARCH_FILMS_CACHE[cache_key] = (time.monotonic() + _SEARCH_CACHE_TTL_SECONDS, letterboxd_result)
                return letterboxd_result
            result = f"No results found for '{query}'."
            _SEARCH_FILMS_CACHE[cache_key] = (time.monotonic() + _SEARCH_EMPTY_TTL_SECONDS, result)
            return result
        finally:
            elapsed = time.perf_counter() - started
            status = "cache" if cache_hit else "query"
            self._emit_telemetry("search_films", f"{status}: {query}", elapsed)

    def _emit_telemetry(self, tool_name: str, target: str, elapsed: float) -> None:
        if self.telemetry_callback:
            self.telemetry_callback(tool_name, target, elapsed, "")

    def _tmdb_search(self, query: str, api_key: str, preferred_year: str | None = None) -> str:
        import httpx
        try:
            resp = httpx.get(
                "https://api.themoviedb.org/3/search/movie",
                params={
                    "api_key": api_key,
                    "query": query,
                    "include_adult": "false",
                    **({"primary_release_year": preferred_year} if preferred_year else {}),
                },
                timeout=_env_float("TMDB_SEARCH_TIMEOUT_SECONDS", 4.0),
            )
            resp.raise_for_status()
            results = resp.json().get("results", [])[:5]
        except Exception:
            return ""  # trigger fallback

        if not results:
            return ""

        lines = []
        seen: set[tuple[str, str]] = set()
        for m in results:
            title = m.get("title", "?")
            year = (m.get("release_date") or "")[:4]
            vote = m.get("vote_average") or 0
            overview = (m.get("overview") or "")[:120]
            base_slug = _estimate_slug(title)
            slug = f"{base_slug}-{year}" if preferred_year and year == preferred_year else base_slug
            signature = (slug, year)
            if signature in seen:
                continue
            seen.add(signature)
            lines.append(
                f"- {title} ({year})  slug: {slug}  ⭐ TMDB {vote:.1f}/10\n"
                f"  {overview}"
            )
        return "\n".join(lines)

    def _letterboxd_search(self, query: str, preferred_year: str | None = None) -> str:
        title_query, release_year = _extract_query_title_and_year(query)
        candidates = []
        effective_year = preferred_year or release_year
        if effective_year:
            candidates.extend([
                f"{title_query} ({effective_year})",
                f"{title_query} {effective_year}",
            ])
        candidates.extend([query, title_query])
        normalized_candidates = []
        for candidate in candidates:
            normalized = " ".join(candidate.replace("（", "(").replace("）", ")").split())
            bare = normalized.rsplit("(", 1)[0].strip() if "(" in normalized else normalized
            normalized_candidates.extend([normalized, bare])
        candidates = [candidate for candidate in dict.fromkeys(c for c in normalized_candidates if c)]

        last_error = ""
        for q in candidates:
            try:
                data = _call(self.session, "search", {"query": q, "type": "films", "maxPages": 1}, self.event_loop)
            except Exception as exc:
                last_error = str(exc)
                continue
            items = (data.get("items") or [])[:5]
            if items:
                if effective_year:
                    year_matches = [item for item in items if str(item.get("year", ""))[:4] == effective_year]
                    if year_matches:
                        items = year_matches
                    elif any(self._verify_letterboxd_slug(item.get("title", ""), effective_year, item.get("slug", "")) for item in items):
                        items = [
                            item for item in items
                            if self._verify_letterboxd_slug(item.get("title", ""), effective_year, item.get("slug", ""))
                        ]
                    else:
                        continue
                return "\n".join(
                    f"- {i.get('title', '?')} ({i.get('year', '')})  slug: {i.get('slug', '')}"
                    for i in items
                )

        if last_error:
            return ""
        return ""


class GetFilmInput(BaseModel):
    slug: str = Field(description="Letterboxd film slug, e.g. 'lost-in-translation'")


class GetFilmTool(BaseTool):
    """Get detailed metadata for a film by its Letterboxd slug."""

    name: str = "get_film"
    description: str = (
        "Get detailed information (runtime, country, avg Letterboxd rating, cast, synopsis) "
        "for a film using its Letterboxd slug. "
        "Use this to verify an estimated slug from search_films — if not found, try a "
        "slightly different slug (e.g. drop a subtitle or simplify the title)."
    )
    args_schema: Type[BaseModel] = GetFilmInput
    session: Any
    event_loop: Any | None = None
    telemetry_callback: Callable[[str, str, float, str], None] | None = None

    model_config = {"arbitrary_types_allowed": True}

    def _run(self, slug: str) -> str:
        started = time.perf_counter()
        try:
            data = _call(self.session, "get_film", {"slug": slug}, self.event_loop)
            if not data:
                return f"Film '{slug}' not found."
            # Return a focused subset to keep context short.
            # Keys from letterboxd.js getFilm(): title, year, director, runtime, genre, rating, synopsis
            keys = ["title", "year", "director", "runtime", "genre", "rating", "synopsis"]
            summary = {k: data[k] for k in keys if k in data}
            return _truncate(summary)
        finally:
            elapsed = time.perf_counter() - started
            if self.telemetry_callback:
                self.telemetry_callback("get_film", slug, elapsed, "")


# ── Write tools (always ask for confirmation) ─────────────────────────────────

class _WriteBase(BaseTool):
    session: Any
    event_loop: Any | None = None
    model_config = {"arbitrary_types_allowed": True}

    def _confirmed_call(self, tool_name: str, args: dict) -> str:
        print(f"\n⚠️  Write operation: {tool_name}")
        print(f"   Args: {json.dumps(args, ensure_ascii=False)}")
        try:
            choice = input("Confirm? (y/N): ").strip().lower()
        except (KeyboardInterrupt, EOFError):
            return "Cancelled."
        if choice not in {"y", "yes"}:
            return "Cancelled by user."
        result = _call(self.session, tool_name, args, self.event_loop)
        if isinstance(result, dict) and result.get("success"):
            return f"✅ {tool_name} succeeded."
        return f"Result: {result}"


class AddToWatchlistInput(BaseModel):
    slug: str = Field(description="Film slug")
    remove: bool = Field(default=False, description="True to remove from watchlist")


class AddToWatchlistTool(_WriteBase):
    name: str = "add_to_watchlist"
    description: str = (
        "Add or remove a film from the user's Letterboxd watchlist. "
        "IMPORTANT: the slug must be a verified Letterboxd slug obtained via search_films or get_film — "
        "never use a guessed slug, as an incorrect slug will cause this tool to fail."
    )
    args_schema: Type[BaseModel] = AddToWatchlistInput

    def _run(self, slug: str, remove: bool = False) -> str:
        return self._confirmed_call("add_to_watchlist", {"slug": slug, "remove": remove})


class AddToWatchedInput(BaseModel):
    slug: str = Field(description="Film slug")
    remove: bool = Field(default=False, description="True to unmark as watched")


class AddToWatchedTool(_WriteBase):
    name: str = "add_to_watched"
    description: str = "Mark a film as watched (or unwatch) on Letterboxd."
    args_schema: Type[BaseModel] = AddToWatchedInput

    def _run(self, slug: str, remove: bool = False) -> str:
        return self._confirmed_call("add_to_watched", {"slug": slug, "remove": remove})


class RateFilmInput(BaseModel):
    slug: str = Field(description="Film slug")
    rating: int = Field(description="Internal rating 1-10 (2=1★, 4=2★, 6=3★, 8=4★, 10=5★)")


class RateFilmTool(_WriteBase):
    name: str = "rate_film"
    description: str = "Rate a film on Letterboxd. Rating is 1-10 internally (2 per star)."
    args_schema: Type[BaseModel] = RateFilmInput

    def _run(self, slug: str, rating: int) -> str:
        return self._confirmed_call("rate_film", {"slug": slug, "rating": rating})


class ToggleLikeInput(BaseModel):
    slug: str = Field(description="Film slug")
    remove: bool = Field(default=False, description="True to unlike")


class ToggleLikeTool(_WriteBase):
    name: str = "toggle_like"
    description: str = "Like or unlike a film on Letterboxd."
    args_schema: Type[BaseModel] = ToggleLikeInput

    def _run(self, slug: str, remove: bool = False) -> str:
        return self._confirmed_call("toggle_like", {"slug": slug, "remove": remove})


class WriteReviewInput(BaseModel):
    slug: str = Field(description="Film slug")
    review: str = Field(description="Review text to publish")
    rating: int = Field(default=0, description="Optional rating 1-10")


class WriteReviewTool(_WriteBase):
    name: str = "write_review"
    description: str = "Publish a review/diary entry for a film on Letterboxd."
    args_schema: Type[BaseModel] = WriteReviewInput

    def _run(self, slug: str, review: str, rating: int = 0) -> str:
        args: dict = {"slug": slug, "review": review}
        if rating:
            args["rating"] = rating
        return self._confirmed_call("write_review", args)
