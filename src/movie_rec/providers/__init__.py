"""Taste-data providers used by local and portfolio-safe recommendation flows."""

from .base import TasteDataProvider
from .demo import DemoTasteDataProvider

__all__ = ["TasteDataProvider", "DemoTasteDataProvider"]
