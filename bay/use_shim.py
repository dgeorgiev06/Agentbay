"""Use shim entry: a script run with -E, never -c, so no project file is importable."""
import sys
from pathlib import Path

KIT = Path(__file__).resolve().parent.parent
sys.path[0] = str(KIT)

from bay import cli

if __name__ == "__main__":
    cli.role_use_main(sys.argv[1], Path(sys.argv[2]), sys.argv[3:])
