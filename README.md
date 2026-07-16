# Movie Rec

A local-first movie recommendation prototype that combines viewing-history context with a user's current mood. The project includes a FastAPI + Vue web application, a crewAI/Qwen recommendation pipeline, local history and taste-profile storage, and a deterministic portfolio demo that needs no account or paid API.

> **Project status:** personal, experimental prototype. Public/demo mode uses fictional sample data and cannot read or modify a Letterboxd account. The legacy Letterboxd integration is retained for local research only; it uses unofficial browser automation and must not be exposed as a public service.

This repository is an independently developed, unofficial project and is not affiliated with or endorsed by Letterboxd. Letterboxd names and marks belong to their respective owner.

Original project code is available under the [MIT License](LICENSE). Third-party names, data and assets are covered separately in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

## Why This Project Exists

Most recommendation interfaces optimize for broad popularity. This prototype explores a more inspectable flow: normalize a viewer's taste evidence, combine it with a short mood description, let agents separate analysis from candidate research and curation, then preserve the result locally.

The main engineering decisions are:

- separate taste-data providers from recommendation orchestration so a safe demo does not need live account access;
- enforce read, write, and configuration capabilities on the backend instead of trusting hidden UI controls;
- distinguish a deterministic portfolio demo from the network-dependent local agent workflow;
- make partial results, cancellation, tool timing, history, and failure states visible in the interface.

## Safe Portfolio Demo

The demo uses a fictional taste profile and a curated film catalog. It does not start Playwright or MCP and does not call Letterboxd, TMDB, or DashScope.

```bash
cp config/.env.example .env
pip install -r web/backend/requirements.txt -r requirements.txt
uvicorn web.backend.app.main:app --host 127.0.0.1 --port 8000
```

In another terminal:

```bash
cd web/frontend
npm install
npm run dev
```

Open `http://127.0.0.1:5173`. The status strip should say `Portfolio demo · fictional sample data`.

## What Is Implemented

- crewAI-based recommendation pipeline with four sequential agents: Taste Analyst, Film Scout, Chief Curator, and Account Manager.
- Local Letterboxd MCP server over HTTP/SSE with browser-assisted fallbacks for protected account reads.
- Read/write separation for Letterboxd tools, with explicit confirmation before every account mutation.
- Web UI with Home, History, Saved Taste Profile, and Settings pages.
- Saved Taste Profile fast path: recommendations can reuse a stored profile instead of running live taste analysis every time.
- Recommendation job status, cancellation, backend event log, and lightweight Film Scout tool telemetry.
- Settings UI for checking and editing local `.env` configuration without exposing existing secret values to the browser.
- Film lookup flow that prefers known Letterboxd slugs with `get_film`, uses cached TMDB-backed search when needed, and can optionally fall back to Letterboxd browser search.
- Portfolio-safe demo provider with backend-enforced capability switches.
- Bounded frontend request timeouts/retries and expiring positive/negative film-search caches.

## Project Structure

```text
movie_rec/
├── src/
│   └── movie_rec/         # Current Python package
│       ├── main.py        # Async entry point
│       ├── core/          # Config + MCP lifecycle
│       ├── cli/           # CLI parsing + setup wizard
│       ├── tools/         # crewAI tool wrappers for Letterboxd MCP
│       ├── agents/        # crewAI agent definitions
│       ├── tasks/         # crewAI task prompts
│       └── crews/         # Crew assembly
├── Letterboxd-MCP/        # Node.js MCP server implementation
├── tests/                 # Test files
├── scripts/               # Utility and setup scripts
├── docs/                  # Documentation and guides
├── web/                   # Personal web app (FastAPI + Vue)
│   ├── backend/           # FastAPI API wrapper around the current agent
│   └── frontend/          # Vue 3 / Vite interface
├── config/                # Configuration templates
│   └── .env.example       # Environment configuration template
├── run.py                 # Main launcher script
├── requirements.txt       # Python dependencies
└── README.md              # This file
```

## 1) Configure Environment

Create a `.env` file in project root (copy from template):

```bash
cp config/.env.example .env
```

The checked-in template defaults to portfolio-safe demo mode:

```env
MOVIE_REC_DEMO_MODE=true
MOVIE_REC_ALLOW_CONFIG_WRITE=false
MOVIE_REC_ALLOW_LETTERBOXD_READ=false
MOVIE_REC_ALLOW_LETTERBOXD_WRITE=false
```

Only configure model keys or Letterboxd credentials for private local development. Never place them in a public deployment or browser bundle.

## Letterboxd Account Connection (Step by Step)

> Local development only. This path is not required for the portfolio demo and is not an authorized public Letterboxd API integration.

1. Optional but recommended: run setup wizard first
   - `python scripts/setup_cookie_login.py` or `python run.py --setup`
   - Follow prompts to write `.env` automatically.
   - Wizard now supports "Letterboxd only" mode (skip Gemini/TMDB updates).

2. Open your Letterboxd profile in browser and confirm your username slug (for example `june` in `https://letterboxd.com/june/`).
   - Agent now validates this at startup and rejects email-style usernames.
3. In `.env`, set one credential mode:
   - Mode A: `LETTERBOXD_USERNAME` + `LETTERBOXD_PASSWORD`
   - Mode B: `LETTERBOXD_CREDENTIALS=username:password`
   - Mode C (optional fallback): `LETTERBOXD_COOKIE=<full cookie header>`
   - Optional: set `LETTERBOXD_LOGIN_STRATEGY=auto` (default) to prefer direct username/password login.
4. If your account hits a security verification page, keep `LETTERBOXD_HEADLESS=false` so the visible browser window stays open long enough to complete the challenge.
5. Install Node dependencies and Playwright browser:
   - `cd Letterboxd-MCP && npm install`
6. Run agent:
   - `python run.py`

7. Quick auth test (without starting full recommendation flow):
   - `python run.py --check-auth`

8. Wait for startup preflight message:
   - `Letterboxd auth OK`
9. If preflight fails, follow printed remediation and rerun.

Validation behavior:

- `LETTERBOXD_USERNAME` must be slug-like (no `@`, no spaces).
- `LETTERBOXD_CREDENTIALS` must be `username:password` and username part must be valid slug.
- Setup wizard auto-normalizes profile URL style input to slug where possible.

If username/password look correct but login still fails:

1. Run `python run.py --check-auth` first.
2. Ensure password is stored with quotes in `.env` (wizard now writes secrets with quotes to avoid special-char parsing issues).
3. If account has risk check/captcha, manually login once in browser, then retry.
4. Keep only one credential mode in use. Username/password now has highest priority if multiple env vars exist.

## 2) Install Dependencies

Python:

```bash
pip install -r requirements.txt
```

Development and tests:

```bash
pip install -r requirements-dev.txt
pytest -q
```

Node MCP server:

```bash
cd Letterboxd-MCP
npm install
cd ..
```

Web backend dependencies:

```bash
pip install -r web/backend/requirements.txt
```

Web frontend dependencies:

```bash
cd web/frontend
npm install
cd ../..
```

## 3) Run the Agent

**Recommended:**

```bash
python run.py
```

Expected behavior:

1. Agent starts a local MCP server on `http://127.0.0.1:<port>/sse`.
2. Agent asks your current mood.
3. The Taste Analyst and Film Scout use read tools to collect your Letterboxd context and verify film slugs.
4. Any write tool call requires explicit terminal confirmation before execution.

Notes:

- If `PORT` is occupied, the agent automatically starts MCP server on a free local port.
- If `LETTERBOXD_MCP_URL` is set, agent connects to that endpoint and will not start local Node server.
- crewAI verbose traces are disabled by default. Set `CREW_VERBOSE=true` in `.env` if you want full agent/tool logs.

## 4) Run the Personal Web App

The web app is a local-first, single-user interface for the same recommendation
pipeline. Keep secrets in the root `.env`; the browser only receives connection
status, masked configuration state, and recommendation results.

Start the backend API from the repository root:

```bash
uvicorn web.backend.app.main:app --reload --host 127.0.0.1 --port 8000 --loop asyncio
```

Start the frontend in another terminal:

```bash
cd web/frontend
npm run dev
```

Open:

```text
http://127.0.0.1:5173
```

If that port is already occupied, Vite prints the next available local URL
such as `http://127.0.0.1:5174`.

Web behavior:

1. `GET /api/auth/check` verifies Letterboxd connectivity.
2. `POST /api/recommendations` starts a background recommendation job.
3. The frontend polls the job until it succeeds, fails, or is cancelled.
4. `DELETE /api/recommendations/{job_id}` cancels a tracked recommendation job.
5. Successful recommendations are saved to local SQLite at `web/backend/data/movie_rec.sqlite3`.
6. The Home page shows the latest saved recommendation and stays synced with History after deletes and backend restarts.
7. Letterboxd write actions require an explicit confirmation dialog before the backend calls MCP write tools.
8. The web recommendation flow is read-only until you click an action button; account sync is handled by the web UI, not by terminal prompts.

Main pages:

- Home: mood input, recommendation progress, Cancel Recommendation button, and latest recommendation.
- History: saved recommendation records with clickable Letterboxd movie cards and poster enrichment.
- Saved Taste Profile: refresh your long-term taste profile and choose whether future recommendations should reference it.
- Settings: auth status, deep Letterboxd check, editable local configuration, backend status log, and Clear events button.

The top navigation also includes a dark/light theme toggle.

Settings configuration:

- Click `Edit Configuration` before sensitive fields are shown.
- Existing API keys, passwords, and cookies are not sent back to the browser.
- Saving writes to the root `.env` and updates backend runtime settings where possible.
- Restart the backend after changing provider keys, model settings, or credentials if a running process still behaves as if it has old values.

Cancellation note:

- The Cancel button marks the current tracked job as cancelled and prevents a cancelled result from being saved as a success.
- crewAI work runs in a background worker thread, and Python cannot safely force-kill that thread from the UI. If a tool call or model call is already in progress, it may take a short time to wind down.
- For a hard stop, stop the backend process with `Ctrl+C` and start it again.

Backend status and telemetry:

- `GET /api/status` returns recent backend events shown in Settings.
- `DELETE /api/status/events` clears the in-memory status log.
- Film Scout records lightweight tool metrics for `search_films` and `get_film`, including call counts and elapsed time. These appear in backend status events after a recommendation run.

See `docs/WEB_IMPLEMENTATION_INSTRUCTIONS.md` for the detailed implementation plan and milestones.

## Troubleshooting

- If startup hangs, verify port and server status:

```bash
lsof -i :3000
```

- If the web backend port is occupied:

```bash
lsof -i :8000
```

Then stop the relevant backend process and restart:

```bash
uvicorn web.backend.app.main:app --reload --host 127.0.0.1 --port 8000 --loop asyncio
```

- If Node dependencies are missing:

```bash
cd Letterboxd-MCP && npm install
```

- If Python package mismatch happens, upgrade MCP package:

```bash
pip install -U mcp
```

- If Letterboxd tools return login failure, verify `.env` credentials and try logging in once manually in browser.

- If account reads fail after login, the MCP layer may be hitting a Letterboxd security challenge. Keep `LETTERBOXD_HEADLESS=false` and retry so the visible browser session can complete verification.

- If Settings shows stale configuration after editing `.env`, restart the backend. Environment values are loaded by the Python process at startup, and some provider/client settings are safest to reload with a clean process.

- If the Home page shows a stale running job or `Recommendation job not found` after a backend restart, clear the frontend recommendation cache in the browser console:

```js
localStorage.removeItem("movie-rec.recommendations");
location.reload();
```

- If recommendation search feels slow, keep `TMDB_API_KEY` configured, leave `MOVIE_REC_LETTERBOXD_SEARCH_FALLBACK=false`, and prefer prompts that mention concrete films, directors, genres, periods, or countries. Film Scout is instructed to use `get_film` when it already has a likely slug and limit broad `search_films` calls.

- If you only want to test recommendation flow without account reads, set:

```env
LETTERBOXD_LOGIN_FOR_READS=false
```

- To print full Python traceback for debugging:

```bash
DEBUG_TRACEBACK=true python run.py
```

## Additional Documentation

See the `docs/` directory for detailed guides:

- `docs/LETTERBOXD_LOGIN_GUIDE.md` and `docs/COOKIE_LOGIN_QUICK.md` for auth troubleshooting
- `docs/DASHSCOPE_SETUP.md` and `docs/QUICK_START_DASHSCOPE.md` for AI provider setup
- `docs/WATCHLIST_FIX_GUIDE.md`, `docs/WEB_VS_APP_GUIDE.md`, and `docs/FIX_SUMMARY.md` for known behavior and historical fixes
- `docs/WEB_IMPLEMENTATION_INSTRUCTIONS.md` for the personal web app implementation plan

## Utility Scripts

The `scripts/` directory contains helper utilities:

- `diagnose_login.py`: Diagnose Letterboxd login issues
- `setup_cookie_login.py`: Interactive setup wizard
