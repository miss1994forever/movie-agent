# Security and Privacy

## Public-Safe Configuration

The portfolio demo must use:

```env
MOVIE_REC_DEMO_MODE=true
MOVIE_REC_ALLOW_CONFIG_WRITE=false
MOVIE_REC_ALLOW_LETTERBOXD_READ=false
MOVIE_REC_ALLOW_LETTERBOXD_WRITE=false
```

Demo mode fails closed: backend configuration changes and Letterboxd mutations return HTTP 403 even if a caller bypasses the UI. It uses fictional data and does not start MCP, Playwright or a paid AI request.

Demo and private-local modes use separate SQLite files, so enabling the demo cannot expose recommendation history or taste profiles previously saved by the local account workflow.

## Secrets

- Treat passwords, cookies, CSRF tokens and model keys as credentials.
- Keep them out of Git, screenshots, logs, frontend environment variables and client responses.
- Rotate a credential immediately if it appears in Git history; deleting the current file is insufficient.
- Use an isolated, limited-budget model key for any controlled deployment.

## Personal Data

Viewing history, ratings, reviews, mood text and inferred taste profiles can identify or profile a person. A future import flow should explain what is processed, minimize retention, avoid saving the raw export by default, disclose third-party model processing and provide deletion.

The current portfolio demo contains no real member data. The legacy local workflow is single-user and should not be repurposed as multi-user credential storage.

## Network Exposure

- FastAPI and Vite examples bind to loopback for local use.
- The MCP server binds to `127.0.0.1` by default. An external MCP deployment must set and enforce `MCP_API_KEY` and use TLS through a trusted reverse proxy.
- CORS is not authentication.
- A public deployment should expose only the demo APIs, add rate limits and budget controls, and keep configuration/write capabilities disabled.

## Third-Party and Brand Boundary

This is an unofficial personal project, not a Letterboxd product or partnership. The public demo must not scrape Letterboxd or collect account credentials. Film metadata, posters and trademarks remain subject to their respective providers' terms and attribution requirements.
