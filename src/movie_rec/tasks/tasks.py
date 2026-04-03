"""Task factory functions for the movie recommendation crew.

Pipeline (sequential):
  1. taste_analysis  → structured taste profile from Letterboxd account
  2. film_scouting   → candidate shortlist (context: taste_analysis)
  3. curation        → final 1-2 picks with reasoning (context: both above)
  4. account_sync    → Letterboxd write operations (context: curation)
"""
from crewai import Task


def create_taste_analysis_task(agent, timestamp: str) -> Task:
    """
    Task 1 — read the authenticated user's Letterboxd profile and output a taste brief.
    Deliberately narrow scope: no searching, no recommendations yet.
    """
    return Task(
        description=(
            f"Current time: {timestamp}\n\n"
            "Call `get_user_context` once to fetch the authenticated user's own Letterboxd profile. "
            "Do not override the username unless the user explicitly asks for a different account.\n\n"
            "From the data, extract and structure:\n"
            "• Pinned Favourites — these reveal the user's deepest cinematic values\n"
            "• High-rated / liked films (4–5 stars) — confirmed tastes\n"
            "• Recent diary entries — what they've been watching lately\n"
            "• Watchlist sample — aspirational taste\n\n"
            "If the tool reports read warnings or challenge-page failures, quote that explicitly instead of "
            "claiming the user has no activity.\n\n"
            "Identify patterns: preferred genres, national cinemas, directors, "
            "decade preferences, narrative styles, tonal range (contemplative vs energetic), "
            "and any notable gaps or patterns to avoid."
        ),
        expected_output=(
            "A concise taste profile brief (≤300 words) structured as:\n"
            "• Core tastes: [3-5 bullet points — genres/styles they clearly love]\n"
            "• Favourite directors/eras: [notable names or periods]\n"
            "• Avoid: [any genres or styles their history suggests they dislike]\n"
            "• Mood baseline: [their default viewing preference when undecided]\n"
            "• Key films for context: [3-5 titles that best represent their taste]"
        ),
        agent=agent,
    )


def create_film_scouting_task(
    agent,
    mood: str,
    watchlist_only_candidates: str | None = None,
    taste_task: Task | None = None,
) -> Task:
    """
    Task 2 — search for candidate films using the taste profile + user mood.
    Accepts the taste_analysis task as context so the agent sees the profile brief.
    """
    constraint = ""
    if watchlist_only_candidates:
        constraint = (
            "\n\n⚠️  HARD CONSTRAINT — watchlist-only mode: "
            "You must choose candidates EXCLUSIVELY from this list "
            "(do NOT recommend anything outside it):\n"
            f"{watchlist_only_candidates}"
        )

    return Task(
        description=(
            f"User's current mood: {mood}\n\n"
            "Using the taste profile from the previous task:\n\n"
            "⚠️  HARD RULE: The taste profile contains a '[FILM SCOUT — HARD EXCLUDE]' line listing "
            "already-watched slugs. You MUST NOT include any film from that list in your shortlist. "
            "Check every candidate's slug against the exclusion list before including it.\n\n"
            "Steps for each candidate film:\n"
            "1. Call `search_films` to find the film. Prefer the exact Letterboxd slug returned by search results; "
            "TMDB-style metadata is fallback context only when Letterboxd search is unavailable.\n"
            "2. Call `get_film` with that slug to VERIFY it exists and obtain runtime and "
            "avg Letterboxd rating. If not found, try a slightly simplified slug "
            "(drop subtitles, remove special characters).\n"
            "3. Cross-check the verified slug against the exclusion list. Discard and pick "
            "a different film if it matches.\n\n"
            "Aim for variety in the shortlist (e.g. mix of well-known and hidden gems), "
            "but every pick must be genuinely defensible given the taste brief."
            f"{constraint}"
        ),
        expected_output=(
            "A shortlist of 3–5 films. For each:\n"
            "  Title (Chinese + English, year, country, runtime, ⭐ avg rating from get_film)\n"
            "  slug: <exact-letterboxd-slug-from-search>\n"
            "  Why it fits: [1–2 sentences linking taste profile + current mood]"
        ),
        agent=agent,
        context=[taste_task] if taste_task else [],
    )


def create_curation_task(
    agent,
    mood: str,
    timestamp: str,
    taste_task: Task,
    scouting_task: Task,
) -> Task:
    """
    Task 3 — no tools; pure synthesis.
    Reads the taste profile + candidate shortlist, makes the final 1-2 picks,
    and writes emotionally resonant recommendations.
    human_input=True so the user can accept or redirect before account actions.
    """
    return Task(
        description=(
            f"Current time: {timestamp}\n"
            f"User mood: {mood}\n\n"
            "You have received:\n"
            "  • A taste profile brief (from the Taste Analyst)\n"
            "  • A candidate shortlist with slugs (from the Film Scout)\n\n"
            "Your job: make the decisive final choice.\n"
            "Select 1 film (2 at most if both are genuinely excellent) from the shortlist. "
            "Do NOT search for new films — work only with what the Scout provided.\n\n"
            "Write a recommendation that feels personal and immediate: "
            "connect the film's core themes to the user's emotional state right now, "
            "reference something specific from their taste profile, "
            "and end with one sentence that makes them want to start watching immediately."
        ),
        expected_output=(
            "1–2 final recommendations. Each must include:\n"
            "• Chinese + English title, year, country, runtime, ⭐ avg rating\n"
            "• slug: <letterboxd-slug>\n"
            "• 推荐理由 (120+ chars): themes, why it fits the mood, "
            "  a specific connection to the user's taste profile"
        ),
        agent=agent,
        context=[taste_task, scouting_task],
        human_input=True,
    )


def create_account_task(agent, curation_task: Task) -> Task:
    """
    Task 4 — sync user-selected films to Letterboxd.
    Receives the curated recommendations as context.
    """
    return Task(
        description=(
            "Review the movie recommendations delivered in the previous task.\n"
            "Ask the user which actions they want to perform on Letterboxd:\n"
            "  • Add to watchlist\n"
            "  • Mark as watched\n"
            "  • Rate (provide a 0.5–5 star value; internally 1–10)\n"
            "  • Like (heart)\n"
            "  • All of the above for one film\n\n"
            "Use the appropriate write tools. Each tool will prompt for confirmation "
            "before executing. If the user declines all actions, finish gracefully."
        ),
        expected_output="A summary of all Letterboxd account operations performed (or skipped).",
        agent=agent,
        context=[curation_task],
        human_input=True,
    )
