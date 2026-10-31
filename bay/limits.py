"""`bay check --limits`: the framework may not grow past framework/limits.yaml (proposal 0009).

Every measure is counted from the files git lists (tracked or new, not ignored). A count over its ceiling fails. A
count that differs from its ceiling is a note, and `--write` (at release) writes it (the ratchet; a ceiling lowered
earlier may climb back to the base's, never above). A ceiling above the one at the base needs an `exceptions:
[{ measure, to, reason }]` entry in the proposal's front matter. A base without limits.yaml sets its own numbers.
"""
from __future__ import annotations

import re
import subprocess
from pathlib import Path

import yaml

from . import boundary, proposal

FILE = "framework/limits.yaml"
MEASURES = ("bay_lines", "kit_python_lines", "cli_commands", "framework_folders", "schemas", "top_level_folders",
            "tests")
_TEST_FILE = re.compile(r"(?:tests|(?:connectors|content-types)/[^/]+/tests)/test_[^/]*\.py")


def _lines(path: Path) -> int:
    with path.open("rb") as f:
        return sum(1 for _ in f)


def count(repo: Path) -> dict[str, int]:
    """Each measure: python lines in bay/; python lines in connectors, adapters and content types (tests/ folders
    excluded); `sub.add_parser` calls in bay/cli.py; folders directly under framework/; files in schemas/; top-level
    folders; `def test_` at module level in the test files tests/run.py runs."""
    out = subprocess.run(["git", "-C", str(repo), "-c", "core.quotePath=false", "ls-files", "-co", "--exclude-standard",
                          "-z"], capture_output=True, text=True, check=True).stdout
    paths = [p for p in out.split("\0") if p and (repo / p).is_file()]
    py = [p for p in paths if p.endswith(".py")]
    kit = [p for p in py if p.split("/")[0] in ("connectors", "adapters", "content-types")
           and "tests" not in p.split("/")]
    read = lambda p: (repo / p).read_text(encoding="utf-8")        # noqa: E731
    return {
        "bay_lines": sum(_lines(repo / p) for p in py if p.startswith("bay/")),
        "kit_python_lines": sum(_lines(repo / p) for p in kit),
        "cli_commands": len(re.findall(r"\bsub\.add_parser\(", read("bay/cli.py"))),
        "framework_folders": len({p.split("/")[1] for p in paths if p.startswith("framework/") and p.count("/") > 1}),
        "schemas": sum(p.startswith("schemas/") for p in paths),
        "top_level_folders": len({p.split("/")[0] for p in paths if "/" in p}),
        "tests": sum(len(re.findall(r"^def test_", read(p), re.M)) for p in paths if _TEST_FILE.fullmatch(p)),
    }


def _ceilings(text: str, where: str) -> dict[str, int]:
    doc = yaml.safe_load(text)
    if not (isinstance(doc, dict) and set(doc) == set(MEASURES)
            and all(isinstance(v, int) and not isinstance(v, bool) for v in doc.values())):
        raise RuntimeError(f"{where}: must hold exactly one whole number for each of {', '.join(MEASURES)}")
    return doc


def _exceptions(text: str | None) -> dict[str, int]:
    """measure -> the ceiling the proposal's front matter allows it to rise to."""
    raw = proposal.front_matter(text).get("exceptions") or [] if text else []
    ok = isinstance(raw, list) and all(isinstance(e, dict) and e.get("measure") in MEASURES and isinstance(e.get("to"), int)
                                       and isinstance(e.get("reason"), str) and e["reason"].strip() for e in raw)
    if not ok:
        raise RuntimeError("exceptions: must be a list of { measure, to, reason } with a known measure")
    return {e["measure"]: e["to"] for e in raw}


def check(repo: Path, base: str | None = None, proposal_text: str | None = None, write: bool = False) -> tuple[list[str], list[str]]:
    """(problems, notes). Writes the changed ceilings to limits.yaml only with `write` (`check --limits --write`)."""
    repo = Path(repo)
    path = repo / FILE
    if not path.is_file():
        raise RuntimeError(f"{FILE} does not exist; it holds one ceiling per measure")
    text = path.read_text(encoding="utf-8")
    ceil = _ceilings(text, FILE)
    before = boundary.show(repo, base, FILE) if base else None
    old = _ceilings(before, f"{FILE} at {base}") if before else {}
    allowed = _exceptions(proposal_text)
    problems, notes = [], []
    for m, n in count(repo).items():
        lim = max(ceil[m], old.get(m, ceil[m]))                  # a ceiling lowered on this branch may climb back to the base's
        if ceil[m] > old.get(m, ceil[m]) and allowed.get(m, 0) < ceil[m]:
            problems.append(f"{m}: the ceiling {ceil[m]} is above {old[m]} at {base}; raising it needs "
                            f"`exceptions: [{{ measure: {m}, to: {ceil[m]}, reason }}]` in the proposal")
        if n > lim:
            problems.append(f"{m}: {n} is over the ceiling {lim} (+{n - lim}); remove what the change added "
                            f"or put an exception in the proposal")
        elif n != ceil[m]:
            text = re.sub(rf"^({m}:\s*)\d+", rf"\g<1>{n}", text, flags=re.M)
            notes.append(f"{m}: {n} against the ceiling {ceil[m]}; the ceiling is now {n}")
    if notes and write:
        path.write_text(text, encoding="utf-8")
    return problems, notes
