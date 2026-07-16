# Architecture

Movie Rec has two deliberately separate execution paths.

```text
Portfolio demo
Mood ──> DemoTasteDataProvider ──> deterministic curator ──> SQLite history ──> Vue UI

Private local workflow
Mood ──> Letterboxd MCP ──> Taste Analyst ──> Film Scout ──> Chief Curator
                    TMDB/search tools ───────────┘               │
                                                                 └──> SQLite history ──> Vue UI
```

## Boundaries

- `src/movie_rec/providers/` owns normalized taste evidence. The demo provider contains fictional data and performs no I/O.
- `src/movie_rec/crews/` owns multi-agent orchestration for private local use.
- `src/movie_rec/tools/` adapts synchronous crewAI tools to the asynchronous MCP session.
- `Letterboxd-MCP/` is an unofficial, local-only Node/Playwright adapter. It binds to loopback by default.
- `web/backend/` owns capability enforcement, background jobs and SQLite persistence.
- `web/frontend/` displays status and results; it is not trusted to enforce sensitive permissions.

## Key Decision: Two Explicit Modes

Because a public portfolio should not depend on visitor credentials, unofficial scraping or paid model calls, demo mode is an explicit backend execution path rather than a UI mock. This produces a runnable artifact with inspectable states while preserving the network-dependent agent workflow as local research code.

The trade-off is that demo recommendations do not evaluate model quality. They demonstrate application flow, data boundaries and failure-safe capability design only.

## Data Flow and Third Parties

In demo mode, mood text and fictional data stay in the local application. In private local mode, taste evidence and mood may be sent to the configured DashScope-compatible endpoint; TMDB may receive film-title searches; the unofficial MCP adapter may access Letterboxd using the local user's session.

No API key belongs in the Vue bundle. Secrets are read by the backend from the root `.env` only when the relevant capability is enabled.
