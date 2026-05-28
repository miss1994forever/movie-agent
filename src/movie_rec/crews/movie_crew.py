"""MovieCrew — assembles the 4-agent pipeline and runs it.

Pipeline (sequential):
  Taste Analyst → Film Scout → Chief Curator → Account Manager
"""
from datetime import datetime
from typing import Callable, Any
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
from ..core.config import CREW_VERBOSE


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
        status_callback: Callable[[str, str], None] | None = None,
        saved_taste_profile: str | None = None,
        skip_live_taste_analysis: bool = False,
        event_loop: Any | None = None,
    ):
        self.session = session
        self.mood = mood
        self.watchlist_only_candidates = watchlist_only_candidates
        self.status_callback = status_callback
        self.saved_taste_profile = saved_taste_profile
        self.skip_live_taste_analysis = skip_live_taste_analysis
        self.event_loop = event_loop
        self.timestamp = datetime.now().strftime("%Y-%m-%d %H:%M")

    # ── Tool factories ────────────────────────────────────────────────────────

    def _context_tools(self) -> list:
        """Read-only: user profile only (Taste Analyst)."""
        return [GetUserContextTool(session=self.session, event_loop=self.event_loop)]

    def _search_tools(self) -> list:
        """Read-only: film search + detail lookup (Film Scout)."""
        return [
            SearchFilmsTool(session=self.session, event_loop=self.event_loop, telemetry_callback=self._emit_tool_metric),
            GetFilmTool(session=self.session, event_loop=self.event_loop, telemetry_callback=self._emit_tool_metric),
        ]

    def _write_tools(self) -> list:
        """Write operations (Account Manager)."""
        return [
            AddToWatchlistTool(session=self.session, event_loop=self.event_loop),
            AddToWatchedTool(session=self.session, event_loop=self.event_loop),
            RateFilmTool(session=self.session, event_loop=self.event_loop),
            ToggleLikeTool(session=self.session, event_loop=self.event_loop),
            WriteReviewTool(session=self.session, event_loop=self.event_loop),
        ]

    def _emit_tool_metric(self, tool_name: str, target: str, elapsed: float, result_summary: str = "") -> None:
        if self.status_callback:
            suffix = f" | {result_summary}" if result_summary else ""
            self.status_callback("tool_metric", f"{tool_name} | {elapsed:.2f}s | {target}{suffix}")

    # ── Main entry point ──────────────────────────────────────────────────────

    def run(self) -> str:
        """Build and kick off the crew synchronously. Returns the final output string."""
        return self._run(include_account_task=True, human_input=True)

    def run_recommendation_only(self) -> str:
        """Run the read-only recommendation pipeline for the web UI."""
        return self._run(include_account_task=False, human_input=False)

    def _run(self, include_account_task: bool, human_input: bool) -> str:
        # Agents (each only sees the tools it actually needs)
        scout = create_film_scout_agent(self._search_tools())
        curator = create_curator_agent()
        use_saved_profile_fast_path = bool(self.skip_live_taste_analysis and self.saved_taste_profile)

        # Tasks (context chain: each receives the outputs of prior tasks it depends on)
        analyst = None
        taste_task = None
        if not use_saved_profile_fast_path:
            analyst = create_taste_analyst_agent(self._context_tools())
            taste_task = create_taste_analysis_task(
                agent=analyst,
                timestamp=self.timestamp,
                saved_taste_profile=self.saved_taste_profile,
            )
        scouting_task = create_film_scouting_task(
            agent=scout,
            mood=self.mood,
            watchlist_only_candidates=self.watchlist_only_candidates,
            taste_task=taste_task,
            saved_taste_profile=self.saved_taste_profile if use_saved_profile_fast_path else None,
        )
        curation_task = create_curation_task(
            agent=curator,
            mood=self.mood,
            timestamp=self.timestamp,
            taste_task=taste_task,
            scouting_task=scouting_task,
            human_input=human_input,
            saved_taste_profile=self.saved_taste_profile if use_saved_profile_fast_path else None,
        )
        agents = ([analyst] if analyst else []) + [scout, curator]
        tasks = ([taste_task] if taste_task else []) + [scouting_task, curation_task]

        if include_account_task:
            account_mgr = create_account_agent(self._write_tools())
            account_task = create_account_task(
                agent=account_mgr,
                curation_task=curation_task,
                human_input=human_input,
            )
            agents.append(account_mgr)
            tasks.append(account_task)

        task_agent_names = [getattr(task.agent, "role", f"Agent {index + 1}") for index, task in enumerate(tasks)]
        current_task_index = {"value": 0}

        def emit(event_type: str, message: str) -> None:
            if self.status_callback:
                self.status_callback(event_type, message)

        def task_callback(output: Any) -> None:
            index = current_task_index["value"]
            agent_name = task_agent_names[index] if index < len(task_agent_names) else "Agent"
            emit("agent_completed", agent_name)
            current_task_index["value"] = index + 1
            if current_task_index["value"] < len(task_agent_names):
                emit("agent_running", task_agent_names[current_task_index["value"]])

        def step_callback(step: Any) -> None:
            agent_name = task_agent_names[current_task_index["value"]] if current_task_index["value"] < len(task_agent_names) else "Agent"
            step_text = self._summarize_step(step)
            if step_text:
                emit("agent_step", f"{agent_name}: {step_text}")

        if task_agent_names:
            if use_saved_profile_fast_path:
                emit("agent_completed", "Personal Taste Analyst")
            emit("agent_running", task_agent_names[0])

        crew = Crew(
            agents=agents,
            tasks=tasks,
            process=Process.sequential,
            verbose=CREW_VERBOSE,
            task_callback=task_callback,
            step_callback=step_callback,
        )

        result = crew.kickoff()
        return str(result)

    @staticmethod
    def _summarize_step(step: Any) -> str:
        tool = getattr(step, "tool", None)
        if tool:
            return f"using tool `{tool}`"
        log = getattr(step, "log", None)
        if isinstance(log, str) and log.strip():
            return log.strip().splitlines()[0][:160]
        thought = getattr(step, "thought", None)
        if isinstance(thought, str) and thought.strip():
            return thought.strip().splitlines()[0][:160]
        return ""
