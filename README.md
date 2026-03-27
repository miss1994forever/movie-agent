# Movie Agent for Letterboxd

Python CLI agent that connects to the local Letterboxd MCP server (SSE transport), reads your Letterboxd context, and asks Gemini to recommend movies.

## What Is Implemented

- MCP transport switched to HTTP/SSE between Python client and Node server.
- MCP server tool definitions cleaned up (duplicate tool names removed).
- Write actions are protected by an explicit second confirmation in terminal.

## Project Structure

```
movie_rec/
├── src/                    # Main Python source code
│   ├── movie_agent.py     # Main CLI agent entrypoint
│   └── ai_providers.py    # AI provider configurations
├── Letterboxd-MCP/        # Node.js MCP server implementation
├── tests/                 # Test files
├── scripts/               # Utility and setup scripts
├── docs/                  # Documentation and guides
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
GEMINI_API_KEY=your_gemini_key
LETTERBOXD_USERNAME=your_letterboxd_username
LETTERBOXD_PASSWORD=your_letterboxd_password
TMDB_API_KEY=your_tmdb_key

# Optional
GEMINI_MODEL=gemini-2.5-flash
GEMINI_MODELS=gemini-2.5-flash,gemini-2.0-flash
PORT=3000
MCP_INIT_TIMEOUT_SEC=30
MCP_READY_TIMEOUT_SEC=20
LETTERBOXD_MCP_URL=
DEBUG_TRACEBACK=false
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
4. If your account has extra login verification or temporary risk checks, complete a manual login in browser first.
5. Install Node dependencies and Playwright browser:
   - `cd Letterboxd-MCP && npm install`
6. Run agent:
   - `python run.py` (recommended) or `python src/movie_agent.py`

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

1. Run `python movie_agent.py --check-auth` first.
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

## 3) Run the Agent

**Recommended (using launcher):**
```bash
python run.py
```

**Alternative (direct):**
```bash
python src/movie_agent.py
```

Expected behavior:

1. Agent starts a local MCP server on `http://127.0.0.1:<port>/sse`.
2. Agent asks your current mood.
3. Gemini may call read tools to collect your Letterboxd context.
4. Any write tool call requires explicit terminal confirmation before execution.

Notes:

- If `PORT` is occupied, the agent automatically starts MCP server on a free local port.
- If `LETTERBOXD_MCP_URL` is set, agent connects to that endpoint and will not start local Node server.
- If Gemini model is temporarily unavailable, agent can fallback by `GEMINI_MODELS` order.

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
- Setup and configuration guides
- Troubleshooting documentation  
- API integration guides

## Utility Scripts

The `scripts/` directory contains helper utilities:
- `diagnose_login.py`: Diagnose Letterboxd login issues
- `setup_cookie_login.py`: Interactive setup wizard
