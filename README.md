# Movie Agent for Letterboxd

Python CLI agent that connects to the local Letterboxd MCP server over SSE, reads your Letterboxd context, and uses crewAI plus DashScope/Qwen to recommend movies and sync account actions.

## What Is Implemented

- crewAI-based recommendation pipeline with four sequential agents: Taste Analyst, Film Scout, Chief Curator, and Account Manager.
- Local Letterboxd MCP server over HTTP/SSE with browser-assisted fallbacks for protected account reads.
- Read/write separation for Letterboxd tools, with explicit confirmation before every account mutation.
- Search flow that prefers real Letterboxd slug resolution and verifies ambiguous titles with `get_film`.

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

Then edit `.env` with your credentials:

```env
DASHSCOPE_API_KEY=your_dashscope_key
AI_MODEL=qwen-max
LETTERBOXD_USERNAME=your_letterboxd_username
LETTERBOXD_PASSWORD=your_letterboxd_password
TMDB_API_KEY=your_tmdb_key

# Optional
DASHSCOPE_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1
PORT=3000
MCP_INIT_TIMEOUT_SEC=30
MCP_READY_TIMEOUT_SEC=20
LETTERBOXD_MCP_URL=
DEBUG_TRACEBACK=false
CREW_VERBOSE=false
```

## Letterboxd Account Connection (Step by Step)

1. Optional but recommended: run setup wizard first
   - `python scripts/setup_cookie_login.py` or `python run.py --setup`
   - Follow prompts to write `.env` automatically.
   - Wizard now supports "Letterboxd only" mode (skip Gemini/TMDB updates).

2. Open your Letterboxd profile in browser and confirm your username slug (for example `june` in `https://letterboxd.com/june/`).
   - Agent now validates this at startup and rejects email-style usernames.
3. In `.env`, set one credential mode:
   - Mode A (recommended): `LETTERBOXD_USERNAME` + `LETTERBOXD_PASSWORD`
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
   - `✅ Letterboxd 账号连通检查通过`
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
status and recommendation results.

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
3. The frontend polls the job until it succeeds or fails.
4. Successful recommendations are saved to local SQLite at `web/backend/data/movie_rec.sqlite3`.
5. Letterboxd write actions require an explicit confirmation dialog before the backend calls MCP write tools.
6. The web recommendation flow is read-only until you click an action button; account sync is handled by the web UI, not by terminal prompts.

See `docs/WEB_IMPLEMENTATION_INSTRUCTIONS.md` for the detailed implementation plan and milestones.

## Troubleshooting

- If startup hangs, verify port and server status:

```bash
lsof -i :3000
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
