"""Entry point for generated role use shims.

Run as a script (`python3 -E <kit>/bay/use_shim.py <role> <project> ...`), never with `-c`:
with `-c` Python puts the current directory first on sys.path, so a file an agent wrote in
the project (e.g. `yaml.py`) would be imported by this auto-allowed command. As a script,
sys.path[0] is this file's folder; we replace it with the kit root so only kit code and
installed packages are importable. `-E` ignores PYTHONPATH and other PYTHON* variables. User site-packages stay on
(pip --user installs of PyYAML must load); agents cannot write there (outside the project).
"""
import sys
from pathlib import Path

KIT = Path(__file__).resolve().parent.parent
sys.path[0] = str(KIT)

from bay import cli  # noqa: E402

if __name__ == "__main__":
    cli.role_use_main(sys.argv[1], Path(sys.argv[2]), sys.argv[3:])
