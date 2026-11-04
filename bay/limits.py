"""`bay check --limits`: the framework may not grow past framework/limits.yaml (proposal 0009)."""
from __future__ import annotations

import ast
import io
import re
import subprocess
import tokenize
from pathlib import Path

import yaml

from . import boundary, proposal

FILE = "framework/limits.yaml"
MEASURES = ("bay_lines", "kit_python_lines", "cli_commands", "framework_folders", "schemas", "top_level_folders",
            "tests", "long_lines", "comment_lines")
COMMENT = "a # comment"
DOCSTRING_LINE = "a docstring line after the first"
COMMENT_PLACES = ("bay/", "adapters/", "components/", "tests/")
DOCUMENTED = (ast.Module, ast.ClassDef, ast.FunctionDef, ast.AsyncFunctionDef)
_TEST_FILE = re.compile(r"(?:tests|(?:components|adapters)/(?:.+/)?tests)/test_[^/]*\.py")


def comment_rows(text: str) -> list[tuple[int, str]]:
    """(line, kind) of each `#` comment (a shebang is none) and of each docstring line after the first."""
    rows = []
    for token in tokenize.generate_tokens(io.StringIO(text).readline):
        if token.type == tokenize.COMMENT and not (token.start[0] == 1 and token.string.startswith("#!")):
            rows.append((token.start[0], COMMENT))
    for node in ast.walk(ast.parse(text)):
        first = node.body[0] if isinstance(node, DOCUMENTED) and node.body else None
        if isinstance(first, ast.Expr) and isinstance(first.value, ast.Constant) and isinstance(first.value.value, str):
            rows += [(line, DOCSTRING_LINE) for line in range(first.lineno + 1, first.end_lineno + 1)]
    return sorted(rows)


def comment_lines(text: str) -> int:
    """How many comment lines `text` holds: the length of `comment_rows`."""
    return len(comment_rows(text))


def _comments_in(path: str, text: str) -> int:
    try:
        return comment_lines(text)
    except (SyntaxError, tokenize.TokenError, ValueError) as e:
        raise RuntimeError(f"{path}: cannot count its comment lines, the file does not parse: {e}") from None


def _lines(path: Path) -> int:
    with path.open("rb") as f:
        return sum(1 for _ in f)


def count(repo: Path) -> dict[str, int]:
    """Each limits.yaml measure, counted from the files git lists (tracked or new, not ignored)."""
    kernel = repo / "framework/kernel.yaml"
    if not kernel.is_file():
        raise RuntimeError("framework/kernel.yaml does not exist; the limits count the protected components it lists")
    cmap = boundary.ComponentMap.load(kernel)

    def core(p: str) -> bool:
        return p.startswith("adapters/") or cmap.protected_by(p) is not None

    out = subprocess.run(["git", "-C", str(repo), "-c", "core.quotePath=false", "ls-files", "-co", "--exclude-standard",
                          "-z"], capture_output=True, text=True, check=True).stdout
    paths = [p for p in out.split("\0") if p and (repo / p).is_file()]
    py = [p for p in paths if p.endswith(".py")]
    kit = [p for p in py if p.split("/")[0] in ("components", "adapters") and "tests" not in p.split("/") and core(p)]

    def read(p: str) -> str:
        return (repo / p).read_text(encoding="utf-8", newline="")

    bay = [p for p in py if p.startswith("bay/")]
    return {
        "bay_lines": sum(_lines(repo / p) for p in bay),
        "kit_python_lines": sum(_lines(repo / p) for p in kit),
        "cli_commands": len(re.findall(r"\bsub\.add_parser\(", read("bay/cli.py"))),
        "framework_folders": len({p.split("/")[1] for p in paths if p.startswith("framework/") and p.count("/") > 1}),
        "schemas": sum(p.startswith("schemas/") for p in paths),
        "top_level_folders": len({p.split("/")[0] for p in paths if "/" in p}),
        "tests": sum(len(re.findall(r"^def test_", read(p), re.M)) for p in paths if _TEST_FILE.fullmatch(p) and (p.startswith("tests/") or core(p))),
        "long_lines": sum(len(line) > 120 for p in bay + kit for line in read(p).split("\n")),
        "comment_lines": sum(_comments_in(p, read(p)) for p in py if p.startswith(COMMENT_PLACES)),
    }


def _ceilings(text: str, where: str, at_base: bool = False) -> dict[str, int]:
    doc = yaml.safe_load(text)
    names = set(doc) if isinstance(doc, dict) else {None}
    named = names <= set(MEASURES) if at_base else names == set(MEASURES)
    if not (named and all(isinstance(v, int) and not isinstance(v, bool) for v in doc.values())):
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
    old = _ceilings(before, f"{FILE} at {base}", at_base=True) if before else {}
    allowed = _exceptions(proposal_text)
    problems, notes = [], []
    for m, n in count(repo).items():
        lim = max(ceil[m], old.get(m, ceil[m]), allowed.get(m, 0))
        if ceil[m] > old.get(m, ceil[m]) and allowed.get(m, 0) < ceil[m]:
            problems.append(f"{m}: the ceiling {ceil[m]} is above {old[m]} at {base}; raising it needs "
                            f"`exceptions: [{{ measure: {m}, to: {ceil[m]}, reason }}]` in the proposal")
        if n > lim:
            problems.append(f"{m}: {n} is over the ceiling {lim} (+{n - lim}); " + (
                f"the proposal's exception allows up to {allowed[m]}" if m in allowed else
                "remove what the change added or put an exception in the proposal"))
        elif n != ceil[m]:
            text = re.sub(rf"^({m}:\s*)\d+", rf"\g<1>{n}", text, flags=re.M)
            notes.append(f"{m}: {n} against the ceiling {ceil[m]}; the ceiling is now {n}")
    if notes and write:
        path.write_text(text, encoding="utf-8")
    return problems, notes
