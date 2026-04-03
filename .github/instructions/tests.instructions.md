---
description: "Use when editing or adding tests, validation scripts, or checks under tests/. Covers current-vs-legacy test expectations for the crewAI-based movie_rec package."
name: "Test Guidelines"
applyTo: "tests/**"
---

# Test Guidelines

- Treat tests under `tests/` as mixed-quality validation, not a fully trustworthy regression suite. Verify that each test still targets the current `src/movie_rec/` package rather than older pre-crewAI modules before extending it.
- Prefer targeted validation for runtime-sensitive changes: `python run.py --check-auth` for auth/startup paths and focused manual runs of `python run.py` for end-to-end recommendation behavior.
- Add new automated coverage against the current package layout under `src/movie_rec/`, not against removed or legacy entrypoints.
- Keep tests lightweight and local where possible. Avoid introducing coverage that depends on live Letterboxd state, browser challenges, or external API availability unless the file is explicitly marked as an integration check.
- If a test needs environment variables or external services, make that requirement explicit in the test body or module docstring and keep the default path failure-readable.
- Link to existing setup docs instead of embedding long troubleshooting instructions inside tests: `README.md`, `docs/LETTERBOXD_LOGIN_GUIDE.md`, `docs/COOKIE_LOGIN_QUICK.md`, and `docs/DASHSCOPE_SETUP.md`.