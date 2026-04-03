"""CLI helpers: argument parsing, credential validation, setup wizard."""
import os
import sys
import argparse
import re
from getpass import getpass
from dotenv import load_dotenv, set_key

from ..core.config import ENV_PATH

load_dotenv(override=True)

# ── Watchlist-only intent detection ─────────────────────────────────────────

_WATCHLIST_PATTERNS = [
    "从watchlist", "从 watchlist", "从片单", "从想看列表", "从待看",
    "watchlist里", "watchlist中", "片单里", "片单中", "待看列表",
]


def detect_watchlist_only(text: str) -> bool:
    value = (text or "").lower()
    return any(p in value for p in _WATCHLIST_PATTERNS)


# ── Safe input ───────────────────────────────────────────────────────────────

def safe_input(prompt: str) -> str | None:
    try:
        return input(prompt)
    except (KeyboardInterrupt, EOFError):
        print("\n已取消。")
        return None


def _normalize_letterboxd_username(value: str) -> str:
    raw = (value or "").strip()
    if not raw:
        return ""
    if raw.startswith("@"):
        raw = raw[1:]

    try:
        if raw.startswith("http"):
            from urllib.parse import urlparse

            parsed = urlparse(raw)
            if parsed.netloc.lower().endswith("letterboxd.com"):
                raw = parsed.path
        elif "letterboxd.com/" in raw:
            from urllib.parse import urlparse

            parsed = urlparse(f"https://{raw}")
            if parsed.netloc.lower().endswith("letterboxd.com"):
                raw = parsed.path
    except Exception:
        pass

    raw = raw.split("?", 1)[0].split("#", 1)[0]
    parts = [part.strip() for part in raw.split("/") if part.strip()]
    candidate = (parts[0] if parts else raw).lstrip("@")
    if re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_-]{1,40}", candidate):
        return candidate
    return ""


# ── Credential validation ────────────────────────────────────────────────────

def validate_credentials() -> tuple[bool, str]:
    """Return (ok, error_message). ok=True means credentials look valid."""
    username = os.getenv("LETTERBOXD_USERNAME", "").strip()
    password = os.getenv("LETTERBOXD_PASSWORD", "").strip()
    credentials = os.getenv("LETTERBOXD_CREDENTIALS", "").strip()
    cookie = os.getenv("LETTERBOXD_COOKIE", "").strip()

    if username or password:
        if not (username and password):
            return False, "Both LETTERBOXD_USERNAME and LETTERBOXD_PASSWORD must be set."
        if not _normalize_letterboxd_username(username):
            return False, "LETTERBOXD_USERNAME must be a slug (e.g. 'june'), not an email."
        return True, ""
    if credentials:
        user, sep, _ = credentials.partition(":")
        if not sep:
            return False, "LETTERBOXD_CREDENTIALS must be 'username:password'."
        if not _normalize_letterboxd_username(user):
            return False, f"Username part of LETTERBOXD_CREDENTIALS is invalid: '{user}'."
        return True, ""
    if cookie:
        return True, ""
    return False, "No Letterboxd credentials found. Run: python run.py --setup"


# ── Setup wizard ─────────────────────────────────────────────────────────────

def _prompt(text: str, secret: bool = False) -> str:
    while True:
        val = (getpass(text) if secret else input(text)).strip()
        if val:
            return val
        print("This field cannot be empty.")


def run_setup_wizard() -> None:
    print("\n🛠️  Movie Agent Setup Wizard")
    print("What would you like to set up?")
    print("  a) Everything (API key + Letterboxd)")
    print("  k) API key only")
    print("  l) Letterboxd credentials only")
    choice = ""
    while choice not in {"a", "k", "l"}:
        choice = (safe_input("Choose (a/k/l): ") or "").strip().lower()
        if choice == "":
            choice = "a"  # default

    setup_api = choice in {"a", "k"}
    setup_lb = choice in {"a", "l"}

    if setup_api:
        dashscope_key = _prompt("DASHSCOPE_API_KEY: ", secret=True)
        ai_model = (safe_input("AI model (default: qwen-max): ") or "").strip() or "qwen-max"
        set_key(ENV_PATH, "DASHSCOPE_API_KEY", dashscope_key, quote_mode="always")
        set_key(ENV_PATH, "AI_MODEL", ai_model, quote_mode="always")
        print("✅ API key saved.")

    if not setup_lb:
        print(f"\n✅ Config saved → {ENV_PATH}")
        return

    print("\nLetterboxd login mode:")
    print("  1) USERNAME + PASSWORD (recommended)")
    print("  2) COOKIE (paste from browser DevTools)")
    mode = ""
    while mode not in {"1", "2"}:
        mode = input("Choose (1/2): ").strip()

    if mode == "1":
        username = _prompt("LETTERBOXD_USERNAME (slug, not email): ")
        normalized_username = _normalize_letterboxd_username(username)
        while not normalized_username:
            print("Must be a slug like 'june' or a full Letterboxd profile URL.")
            username = _prompt("LETTERBOXD_USERNAME: ")
            normalized_username = _normalize_letterboxd_username(username)
        password = _prompt("LETTERBOXD_PASSWORD: ", secret=True)
        set_key(ENV_PATH, "LETTERBOXD_USERNAME", normalized_username, quote_mode="always")
        set_key(ENV_PATH, "LETTERBOXD_PASSWORD", password, quote_mode="always")
        set_key(ENV_PATH, "LETTERBOXD_COOKIE", "", quote_mode="always")
        set_key(ENV_PATH, "LETTERBOXD_CREDENTIALS", "", quote_mode="always")
    else:
        cookie = _prompt("LETTERBOXD_COOKIE (full Cookie header value): ", secret=True)
        set_key(ENV_PATH, "LETTERBOXD_COOKIE", cookie, quote_mode="always")
        set_key(ENV_PATH, "LETTERBOXD_USERNAME", "", quote_mode="always")
        set_key(ENV_PATH, "LETTERBOXD_PASSWORD", "", quote_mode="always")
        set_key(ENV_PATH, "LETTERBOXD_CREDENTIALS", "", quote_mode="always")

    set_key(ENV_PATH, "PORT", os.getenv("PORT", "3000"), quote_mode="always")
    print(f"\n✅ Config saved → {ENV_PATH}")
    print("Test login with: python run.py --check-auth")


# ── Argument parser ──────────────────────────────────────────────────────────

def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Movie Recommendation Agent for Letterboxd")
    parser.add_argument("--setup", action="store_true", help="Run interactive setup wizard")
    parser.add_argument("--check-auth", action="store_true", help="Verify Letterboxd auth and exit")
    return parser.parse_args()
