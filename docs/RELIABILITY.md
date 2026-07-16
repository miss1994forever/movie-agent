# Reliability and Failure Handling

## Current Recovery Model

| Boundary | Recovery | Remaining limitation |
|---|---|---|
| Public demo | Deterministic provider; no network dependency | Does not measure recommendation quality |
| Frontend GET | 12-second timeout and bounded retry for network errors, 429 and 5xx | POST requests are not retried to avoid duplicate mutations |
| Recommendation job | Explicit queued/running/succeeded/failed/cancelled states | In-flight work is still process-local |
| Film search | TMDB-first discovery with optional fallback; positive cache 10 minutes, negative cache 30 seconds | Legacy Letterboxd fallback remains network-dependent |
| Poster enrichment | Missing TMDB key or request failure leaves the card without a poster | Failure is intentionally non-fatal |
| Profile reads | Snapshot, individual routes, saved HTML, then dated disk snapshot | Local-only fallback may be stale |
| Letterboxd auth | Cookie names are treated as candidates; a remote page must prove login | Challenges may still require a visible local browser |

## Failure Semantics

- A real empty result should not be reported as a transport failure.
- Cached or partially recovered context must carry a warning.
- If the minimum taste evidence is unavailable, the local agent should disclose that recommendations are not personalized.
- Account writes are never automatically retried. A timeout can leave remote state uncertain and should be reconciled before another mutation.

## Verification Commands

```bash
pytest -q
node --check Letterboxd-MCP/letterboxd.js
node --check Letterboxd-MCP/index.js
cd web/frontend && npm run build
```

External provider tests are opt-in:

```bash
RUN_DASHSCOPE_INTEGRATION_TESTS=1 pytest -m integration
```
