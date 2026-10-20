"""Compatibility entrypoint for the existing Bothost Python bot.

Bothost currently points its Python interpreter at this path. Python accepts
any extension for a script, so keep this file until the entrypoint is changed
to main.py in the hosting panel.
"""

from pathlib import Path
import runpy
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
runpy.run_path(str(ROOT / "main.py"), run_name="__main__")
