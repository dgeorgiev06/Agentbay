"""Where the kit keeps its extensions, for tests that must name them by what they are, not where they sit (proposal 0008,
stage 5). A logical path is `mode:<name>/<rest>`, `env:<name>` or `connector:<name>/<rest>`; anything else is already
physical. `physical` answers with the folder the extension lives in today (framework/<kind>/ for the shipped control-plane
ones, the top-level <kind>/ for the rest and for names that do not exist), so a test written on logical paths gives the
same rows before and after the extensions move."""
from __future__ import annotations

from helpers import KIT

FOLDERS = {"mode": "modes", "env": "envs", "connector": "connectors"}


def physical(logical: str) -> str:
    kind, sep, rest = logical.partition(":")
    if not sep or kind not in FOLDERS:
        return logical
    folder = FOLDERS[kind]
    if kind == "env":
        return f"{_base(folder, f'{rest}.yaml')}/{rest}.yaml"
    return f"{_base(folder, rest.split('/')[0])}/{rest}"


def _base(folder: str, name: str) -> str:
    return f"framework/{folder}" if (KIT / "framework" / folder / name).exists() else folder
