---
description: "Use when working on the Letterboxd MCP Node server, Playwright scraping flows, SSE transport, or tool definitions under Letterboxd-MCP/. Covers transport, compatibility, and scraping reliability constraints."
name: "Letterboxd MCP Guidelines"
applyTo: "Letterboxd-MCP/**"
---

# Letterboxd MCP Guidelines

- Treat `Letterboxd-MCP/` as a standalone Node runtime that serves the Python package over HTTP/SSE. Preserve compatibility with the Python client in `src/movie_rec/core/mcp_manager.py`.
- Keep transport assumptions aligned with the current server design: `index.js` exposes SSE mode, and Python connects through `mcp.client.sse.sse_client`. Do not switch the server to stdio or rename transport-facing behavior without updating both sides.
- Keep MCP tool names stable and unique. Duplicate or casually renamed tools can break discovery in the Python crewAI wrappers.
- Favor reliability over scraper purity. This repo already uses browser fallbacks and cached/snapshot-style reads to survive Cloudflare and 403/520-style failures; changes should preserve those degraded-but-useful paths.
- Keep read operations and account mutations clearly separated. Read tooling supports recommendation context; write tooling is consumed through confirmation-gated Python wrappers and should remain predictable.
- When changing package scripts or dependencies, preserve `npm install` as the setup path and keep Playwright browser installation working through `postinstall` unless there is a deliberate replacement.
- Before changing request flows, check the docs and repo notes instead of duplicating rationale in code comments: `Letterboxd-MCP/README.md`, `docs/WATCHLIST_FIX_GUIDE.md`, `docs/WEB_VS_APP_GUIDE.md`, and `docs/FIX_SUMMARY.md`.