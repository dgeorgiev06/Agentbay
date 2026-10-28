"""pytest support: `pytest tests connectors framework/connectors` (python3 tests/run.py needs no pytest)."""
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(HERE.parent))
