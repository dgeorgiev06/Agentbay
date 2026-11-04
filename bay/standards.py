"""The standards step: each checker runs on the call's start commit and the working tree; new findings block."""
from __future__ import annotations

import shutil
import subprocess
import sys
import tempfile
from collections import Counter
from collections.abc import Callable
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from . import boundary

PROBE_TIMEOUT = 30
LISTED_FINDINGS = 5
LEDGER_DIR = ".agentbay"
PLACEHOLDER = "agentbay-symlink-placeholder"

Row = dict[str, Any]
Runner = boundary.Runner
Invoke = Callable[[str, dict[str, str]], dict[str, Any]]


@dataclass
class Checker:
    name: str
    tools: list[dict[str, str]] = field(default_factory=list)
    install: str = ""


def run_module(module: str, args: list[str], cwd: Path, timeout: int, run: Runner = subprocess.run) -> Any:
    """Run `python3 -I -m module` with a list of arguments, no shell and a timeout; -I keeps a planted module out."""
    return run([sys.executable, "-I", "-m", module, *args], cwd=cwd, capture_output=True, text=True, timeout=timeout)


def compare(before: list[Row], now: list[Row], renames: dict[str, str]) -> tuple[list[Row], int]:
    """The findings in `now` that `before` lacks, counted as a multiset by (file, rule, message)."""
    seen = Counter((renames.get(row["file"], row["file"]), row["rule"], row["message"]) for row in before)
    new = []
    for row in now:
        key = (row["file"], row["rule"], row["message"])
        if seen[key] > 0:
            seen[key] -= 1
        else:
            new.append(row)
    return new, len(now) - len(new)


def probe(checkers: list[Checker], cwd: Path, run: Runner = subprocess.run) -> tuple[list[str], list[str]]:
    """(problems, warnings): a tool that is not installed stops the step, a version other than the pin only warns."""
    problems, warnings = [], []
    for checker in checkers:
        for tool in checker.tools:
            module = tool["module"]
            try:
                done = run_module(module, ["--version"], cwd, PROBE_TIMEOUT, run)
            except (OSError, subprocess.SubprocessError) as e:
                problems.append(f"{checker.name}: cannot run {module}: {type(e).__name__}")
                continue
            if done.returncode != 0:
                missing = "No module named" in (done.stderr or "")
                why = f"{module} is not installed; {checker.install}" if missing else f"{module} --version failed"
                problems.append(f"{checker.name}: {why}")
            elif tool["version"] not in (done.stdout or "").split():
                warnings.append(f"{module} is {(done.stdout or '').strip()}, the pin is {tool['version']}")
    return problems, warnings


def copy_tree(project: Path, dest: Path, run: Runner = subprocess.run) -> list[str]:
    """Copy the regular files git lists to `dest`; a symlink becomes a link to an empty file; no .agentbay."""
    done = run(["git", "-C", str(project), "ls-files", "-co", "--exclude-standard", "-z"],
               capture_output=True, text=True, timeout=boundary.GIT_TIMEOUT)
    if done.returncode != 0:
        raise ValueError(f"cannot list the working tree: {(done.stderr or '').strip()[:200]}")
    skipped = 0
    listed = dict.fromkeys(p for p in done.stdout.split("\0") if p)
    for rel in [p for p in listed if not p.startswith(f"{LEDGER_DIR}/")]:
        src = project / rel
        try:
            if src.is_symlink() or (src.exists() and not src.is_file()):
                skipped += 1
                if src.is_symlink():
                    (dest / rel).parent.mkdir(parents=True, exist_ok=True)
                    (dest / PLACEHOLDER).write_text("")
                    (dest / rel).symlink_to(dest / PLACEHOLDER)
            elif src.exists():
                (dest / rel).parent.mkdir(parents=True, exist_ok=True)
                shutil.copyfile(src, dest / rel)
        except OSError as e:
            raise ValueError(
                f"cannot copy {rel} to the working-tree check ({type(e).__name__}); "
                f"rename it if it is called {PLACEHOLDER}, and replace a symlinked parent folder with a real folder"
            ) from e
    return [f"{skipped} symlink(s) or special file(s) not copied to the working-tree check"] if skipped else []


def check(project: Path, base: str, checkers: list[Checker], invoke: Invoke, run: Runner = subprocess.run) -> Row:
    """{new, existing, stopped?, warnings}: the findings of `checkers` on the working tree that the base lacks."""
    sha = boundary.base_commit(project, base, run)
    renames = boundary.renames(project, sha, run)
    with tempfile.TemporaryDirectory(prefix="agentbay-standards-") as tmp:
        work = Path(tmp)
        problems, warnings = probe(checkers, work, run)
        if problems:
            return {"new": [], "existing": 0, "stopped": "; ".join(problems), "warnings": warnings}
        old, tree = work / "base", work / "tree"
        old.mkdir()
        tree.mkdir()
        boundary.export(project, sha, old, run)
        warnings += copy_tree(project, tree, run)
        new, existing, stopped = [], 0, []
        for checker in checkers:
            rows = {}
            for label, root in (("base", old), ("tree", tree)):
                out = invoke(checker.name, {"root": str(root), "configRoot": str(old)})
                rows[label] = out["findings"]
                warnings += out.get("warnings", [])
                if out.get("stopped"):
                    stopped.append(f"{checker.name} on the {label}: {out['stopped']}")
            added, kept = compare(rows["base"], rows["tree"], renames)
            new += [{**row, "checker": checker.name} for row in added]
            existing += kept
    out = {"new": new, "existing": existing, "warnings": warnings}
    if new:
        listed = ", ".join(f"{row['file']}:{row['line']} {row['rule']}" for row in new[:LISTED_FINDINGS])
        stopped.insert(0, f"{len(new)} new standards finding(s) against {sha[:8]}: {listed}")
    if stopped:
        out["stopped"] = "; ".join(stopped)
    return out
