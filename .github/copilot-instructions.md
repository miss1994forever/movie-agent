# Project Guidelines

## Architecture

- Treat the current Python package under `src/movie_rec/` as the source of truth. The active entrypoint is `run.py`, which delegates to `src/movie_rec/main.py`.
- Keep the existing separation of concerns: `core/` manages config and MCP lifecycle, `cli/` handles argument parsing and setup flows, `tools/` wraps MCP calls for crewAI, `agents/` defines LLM roles, `tasks/` defines task prompts, and `crews/` assembles the sequential pipeline.
- The Node server in `Letterboxd-MCP/` is a separate runtime dependency. Python communicates with it over SSE via `mcp.client.sse.sse_client`; do not redesign this to stdio without checking the server implementation first.

## Build And Run

- From the repo root, install Python dependencies with `pip install -r requirements.txt`.
- Install Node dependencies with `cd Letterboxd-MCP && npm install`. `postinstall` also installs the Playwright browser dependency.
- Use `python run.py --setup` for interactive environment setup, `python run.py --check-auth` for Letterboxd connectivity checks, and `python run.py` for the main recommendation flow.
- Use `config/.env.example` as the env template and keep environment-driven behavior centralized in `src/movie_rec/core/config.py`.

## Conventions

- Prefer the current crewAI flow over older README-era assumptions. If documentation conflicts with code, follow the implementation under `src/movie_rec/`.
- `nest_asyncio.apply()` is intentional here because sync crewAI tools call async MCP operations from the running event loop. Do not remove it unless you are refactoring that boundary end to end.
- Preserve the read/write split in `src/movie_rec/tools/letterboxd_tools.py`: recommendation and discovery tools stay read-only, while account mutations remain isolated and confirmation-gated.
- Keep Letterboxd auth handling strict: usernames are slugs, not emails, and setup/auth validation should continue to fail early on malformed credentials.
- When changing AI configuration, keep DashScope/OpenAI-compatible settings aligned with `src/movie_rec/core/config.py` (`DASHSCOPE_API_KEY`, `AI_MODEL`, `DASHSCOPE_BASE_URL`) instead of introducing parallel config paths.

## Testing And Validation

- There is no clearly reliable automated regression suite in the current repo. Before relying on files under `tests/`, verify that they still target the current crewAI package rather than older modules.
- For changes that affect startup, auth, or MCP wiring, prefer targeted validation such as `python run.py --check-auth` and focused manual runs over assuming `pytest` coverage exists.
- If you add or modernize tests, place them under `tests/` and align them with the current `src/movie_rec/` package layout.

## Documentation

- Link to existing docs instead of duplicating them:
  - `README.md` for the main setup and run flow
  - `docs/LETTERBOXD_LOGIN_GUIDE.md` and `docs/COOKIE_LOGIN_QUICK.md` for auth troubleshooting
  - `docs/DASHSCOPE_SETUP.md` and `docs/QUICK_START_DASHSCOPE.md` for AI provider setup
  - `docs/WATCHLIST_FIX_GUIDE.md`, `docs/WEB_VS_APP_GUIDE.md`, and `docs/FIX_SUMMARY.md` for known behavior and historical fixes