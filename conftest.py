"""pytest support: run `pytest` from the kit root (python3 tests/run.py needs no pytest)."""
import sys
from pathlib import Path

KIT = Path(__file__).resolve().parent
sys.path.insert(0, str(KIT / "tests"))
sys.path.insert(0, str(KIT))
