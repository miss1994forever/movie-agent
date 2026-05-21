"""Agent factory functions — all agents use DashScope via OpenAI-compatible endpoint.

Crew pipeline (4 agents, sequential):
  1. Taste Analyst   — reads Letterboxd profile → taste profile brief
  2. Film Scout      — searches & vets candidate films → shortlist
  3. Chief Curator   — synthesises taste + candidates + mood → final picks
  4. Account Manager — syncs user decisions back to Letterboxd (write)
"""
from crewai import Agent, LLM
from ..core.config import DASHSCOPE_API_KEY, AI_MODEL, DASHSCOPE_BASE_URL, CREW_VERBOSE


def _llm() -> LLM:
    """Build a crewAI LLM via an OpenAI-compatible DashScope endpoint (supports Coding Plan)."""
    return LLM(
        model=f"openai/{AI_MODEL}",
        base_url=DASHSCOPE_BASE_URL,
        api_key=DASHSCOPE_API_KEY,
    )


def create_taste_analyst_agent(context_tools: list) -> Agent:
    """
    Agent 1 — reads the user's Letterboxd profile and extracts a deep taste model.
    Only needs GetUserContextTool; no search required.
    """
    return Agent(
        role="Personal Taste Analyst",
        goal=(
            "Produce a structured taste profile from the user's Letterboxd account: "
            "favourite genres, directors, eras, themes, and films to avoid recommending."
        ),
        backstory=(
            "You are a film psychologist who reads between the lines of ratings and lists. "
            "You notice patterns humans miss — a preference for slow-burn narratives, "
            "a love of unreliable narrators, or a dislike of excessive CGI. "
            "Your deliverable is a concise brief that the next agent can act on immediately."
        ),
        tools=context_tools,
        llm=_llm(),
        verbose=CREW_VERBOSE,
        allow_delegation=False,
    )


def create_film_scout_agent(search_tools: list) -> Agent:
    """
    Agent 2 — searches for and vets candidate films given the taste profile and mood.
    Uses SearchFilmsTool and GetFilmTool; no Letterboxd account access.
    """
    return Agent(
        role="Film Scout",
        goal=(
            "Find 3–5 candidate films that match both the taste profile and the user's "
            "current mood while aggressively filtering out already-watched titles and low-priority rewatches. "
            "Gather each finalist's slug, runtime, avg rating, and key themes."
        ),
        backstory=(
            "You are a researcher with encyclopaedic knowledge of world cinema and "
            "direct access to Letterboxd's film database. "
            "You cast a wide net first, then trim ruthlessly to the most promising candidates, "
            "always including the Letterboxd slug so picks can be actioned immediately. "
            "You never offload exclusion checking to the user: if a film is already watched, it is your mistake to correct before answering."
        ),
        tools=search_tools,
        llm=_llm(),
        verbose=CREW_VERBOSE,
        allow_delegation=False,
    )


def create_curator_agent() -> Agent:
    """
    Agent 3 — no tools; pure synthesis.
    Reads the taste profile and candidate shortlist, then makes the final 1–2 picks
    with emotionally resonant reasoning tailored to the user's current mood.
    """
    return Agent(
        role="Chief Curator",
        goal=(
            "Select the best 2 films by default, or 3 when quality stays high, from the candidate shortlist "
            "and write compelling, mood-matched recommendations."
        ),
        backstory=(
            "You are a seasoned film programmer who believes great recommendations are "
            "felt before they are understood. You read the analyst's profile and the "
            "scout's shortlist, weigh the user's emotional state, and make a decisive, "
            "human choice — not an algorithmic average. Your words make people excited "
            "to watch the film right now."
        ),
        llm=_llm(),
        verbose=CREW_VERBOSE,
        allow_delegation=False,
    )


def create_account_agent(write_tools: list) -> Agent:
    """Agent 4 — syncs user decisions back to Letterboxd (write operations only)."""
    return Agent(
        role="Letterboxd Account Manager",
        goal=(
            "Help the user sync their movie interactions to Letterboxd: "
            "add films to the watchlist, mark as watched, rate, and like."
        ),
        backstory=(
            "You manage the user's Letterboxd account on their behalf. "
            "You always seek explicit confirmation before executing any write operation."
        ),
        tools=write_tools,
        llm=_llm(),
        verbose=CREW_VERBOSE,
        allow_delegation=False,
    )
