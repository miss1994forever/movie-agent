#!/usr/bin/env python3
"""
Movie Agent Launcher
Launches the main movie recommendation agent from the src directory.
"""

import sys
import os
import subprocess
from pathlib import Path

def main():
    """Launch the movie agent with proper Python path handling."""
    # Get the project root and src directory paths
    project_root = Path(__file__).parent
    src_path = project_root / "src"
    
    # Ensure src directory exists
    if not src_path.exists():
        print(f"Error: Source directory not found at {src_path}")
        sys.exit(1)
    
    # Set PYTHONPATH to include src directory
    env = os.environ.copy()
    current_path = env.get('PYTHONPATH', '')
    if current_path:
        env['PYTHONPATH'] = f"{src_path}{os.pathsep}{current_path}"
    else:
        env['PYTHONPATH'] = str(src_path)
    
    # Build command to run movie_agent.py with all passed arguments
    cmd = [sys.executable, str(src_path / "movie_agent.py")] + sys.argv[1:]
    
    # Execute the movie agent
    try:
        result = subprocess.run(cmd, env=env, cwd=project_root)
        sys.exit(result.returncode)
    except KeyboardInterrupt:
        sys.exit(130)  # Standard exit code for Ctrl+C
    except Exception as e:
        print(f"Error launching movie agent: {e}")
        sys.exit(1)

if __name__ == "__main__":
    main()