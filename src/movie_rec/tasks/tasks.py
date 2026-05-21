"""Task factory functions for the movie recommendation crew.

Pipeline (sequential):
    1. taste_analysis  → structured taste profile from Letterboxd account
    2. film_scouting   → candidate shortlist (context: taste_analysis)
    3. curation        → final 2-3 picks with reasoning (context: both above)
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
            "already-watched slugs. You MUST NOT include any film from that list in your shortlist, backup list, "
            "or tie-break recommendations unless the user explicitly asks for rewatches. Check every candidate's slug "
            "against the exclusion list before including it.\n\n"
            "⚠️  SECOND RULE: The taste profile may contain a '[FILM SCOUT — LOW PRIORITY REWATCH]' line. "
            "Those films are not forbidden, but they should rank below unseen options and should almost never appear "
            "when stronger unseen candidates exist.\n\n"
            "Steps for each candidate film:\n"
            "1. Call `search_films` to discover candidates quickly. Treat the returned slug as a best-effort hint during exploration.\n"
            "2. Only call `get_film` for the strongest finalists you are seriously considering keeping in the shortlist, "
            "or when a title is ambiguous and you need to confirm the right slug. Do NOT verify every exploratory search result.\n"
            "3. Cross-check each verified finalist slug against the exclusion list. Discard and pick "
            "a different film if it matches.\n"
            "4. Before producing the final shortlist, perform a final self-audit: every main pick and every backup pick must be unseen unless the user explicitly asked for rewatches. Do not ask the user to check the exclusion list for you.\n\n"
            "Aim for variety in the shortlist (e.g. mix of well-known and hidden gems), "
            "but every pick must be genuinely defensible given the taste brief."
            f"{constraint}"
        ),
        expected_output=(
            "A shortlist of 3–5 films. For each:\n"
            "  Title (Chinese + English, year, country, runtime, ⭐ avg rating when verified via get_film)\n"
            "  slug: <best available Letterboxd slug hint; verified for finalists>\n"
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
    human_input: bool = True,
) -> Task:
    """
    Task 3 — no tools; pure synthesis.
    Reads the taste profile + candidate shortlist, makes the final 2-3 picks,
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
            "Select 2 films by default, or 3 films if the shortlist supports it without lowering quality. "
            "Do NOT search for new films — work only with what the Scout provided.\n\n"
            "Do NOT collapse to a single recommendation unless the shortlist is genuinely too weak to support 2 options.\n"
            "Write a recommendation that feels personal and immediate: "
            "connect the film's core themes to the user's emotional state right now, "
            "reference something specific from their taste profile, "
            "and end with one sentence that makes them want to start watching immediately.\n\n"
            "At the very end, include one fenced JSON block that can be parsed by a web app. "
            "The JSON must have this exact shape:\n"
            "{\n"
            '  "recommendations": [\n'
            "    {\n"
            '      "title": "English or original title",\n'
            '      "year": 2000,\n'
            '      "slug": "verified-letterboxd-slug",\n'
            '      "director": "Director name",\n'
            '      "reason": "One concise reason for the card UI.",\n'
            '      "letterboxd_url": "https://letterboxd.com/film/verified-letterboxd-slug/"\n'
            "    }\n"
            "  ]\n"
            "}\n"
            "Only include films from your final recommendations in this JSON block. "
            "Do not put comments or trailing commas inside the JSON."
        ),
        expected_output=(
            "2–3 final recommendations. Each must include:\n"
            "• Chinese + English title, year, country, runtime, ⭐ avg rating\n"
            "• slug: <letterboxd-slug>\n"
            "• 推荐理由 (120+ chars): themes, why it fits the mood, "
            "  a specific connection to the user's taste profile\n\n"
            "End with a fenced JSON block containing `recommendations`, where each item has "
            "`title`, `year`, `slug`, `director`, `reason`, and `letterboxd_url`."
        ),
        agent=agent,
        context=[taste_task, scouting_task],
        human_input=human_input,
    )


def create_account_task(agent, curation_task: Task, human_input: bool = True) -> Task:
    """
    Task 4 — sync user-selected films to Letterboxd.
    Receives the curated recommendations as context.
    """
    return Task(
        description=(
            "Review the movie recommendations delivered in the previous task.\n"
            "Ask the user which actions they want to perform on Letterboxd for each recommended film they care about:\n"
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
        human_input=human_input,
    )
