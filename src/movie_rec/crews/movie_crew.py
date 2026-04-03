"""MovieCrew — assembles the 4-agent pipeline and runs it.

Pipeline (sequential):
  Taste Analyst → Film Scout → Chief Curator → Account Manager
"""
from datetime import datetime
from crewai import Crew, Process

from ..agents.agents import (
    create_taste_analyst_agent,
    create_film_scout_agent,
    create_curator_agent,
    create_account_agent,
)
from ..tasks.tasks import (
    create_taste_analysis_task,
    create_film_scouting_task,
    create_curation_task,
    create_account_task,
)
from ..tools.letterboxd_tools import (
    GetUserContextTool,
    SearchFilmsTool,
    GetFilmTool,
    AddToWatchlistTool,
    AddToWatchedTool,
    RateFilmTool,
    ToggleLikeTool,
    WriteReviewTool,
)


class MovieCrew:
    """
    Orchestrates the full recommendation + account-management workflow.

    Usage:
        crew = MovieCrew(session=mcp_session, mood="想看文艺片")
        result = crew.run()   # blocks until done (uses nest_asyncio)
    """

    def __init__(
        self,
        session,
        mood: str,
        watchlist_only_candidates: str | None = None,
    ):
        self.session = session
        self.mood = mood
        self.watchlist_only_candidates = watchlist_only_candidates
        self.timestamp = datetime.now().strftime("%Y-%m-%d %H:%M")

    # ── Tool factories ────────────────────────────────────────────────────────

    def _context_tools(self) -> list:
        """Read-only: user profile only (Taste Analyst)."""
        return [GetUserContextTool(session=self.session)]

    def _search_tools(self) -> list:
        """Read-only: film search + detail lookup (Film Scout)."""
        return [
            SearchFilmsTool(session=self.session),
            GetFilmTool(session=self.session),
        ]

    def _write_tools(self) -> list:
        """Write operations (Account Manager)."""
        return [
            AddToWatchlistTool(session=self.session),
            AddToWatchedTool(session=self.session),
            RateFilmTool(session=self.session),
            ToggleLikeTool(session=self.session),
            WriteReviewTool(session=self.session),
        ]

    # ── Main entry point ──────────────────────────────────────────────────────

    def run(self) -> str:
        """Build and kick off the crew synchronously. Returns the final output string."""
        # Agents (each only sees the tools it actually needs)
        analyst = create_taste_analyst_agent(self._context_tools())
        scout = create_film_scout_agent(self._search_tools())
        curator = create_curator_agent()
        account_mgr = create_account_agent(self._write_tools())

        # Tasks (context chain: each receives the outputs of prior tasks it depends on)
        taste_task = create_taste_analysis_task(
            agent=analyst,
            timestamp=self.timestamp,
        )
        scouting_task = create_film_scouting_task(
            agent=scout,
            mood=self.mood,
            watchlist_only_candidates=self.watchlist_only_candidates,
            taste_task=taste_task,
        )
        curation_task = create_curation_task(
            agent=curator,
            mood=self.mood,
            timestamp=self.timestamp,
            taste_task=taste_task,
            scouting_task=scouting_task,
        )
        account_task = create_account_task(agent=account_mgr, curation_task=curation_task)

        crew = Crew(
            agents=[analyst, scout, curator, account_mgr],
            tasks=[taste_task, scouting_task, curation_task, account_task],
            process=Process.sequential,
            verbose=True,
        )

        result = crew.kickoff()
        return str(result)
