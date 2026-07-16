from __future__ import annotations

from typing import Protocol


class TasteDataProvider(Protocol):
    """Boundary between recommendation logic and the source of viewing data."""

    @property
    def source(self) -> str:
        """Return a short, non-secret identifier for the data source."""

    def context_text(self) -> str:
        """Return normalized taste evidence suitable for a recommendation prompt."""
