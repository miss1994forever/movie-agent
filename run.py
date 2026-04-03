#!/usr/bin/env python3
"""
Movie Agent Launcher — crewAI + DashScope edition.
Adds src/ to sys.path and delegates to movie_rec.main.
"""
import sys
from pathlib import Path

_src = Path(__file__).parent / "src"
if str(_src) not in sys.path:
    sys.path.insert(0, str(_src))

from movie_rec.main import main

if __name__ == "__main__":
    main()