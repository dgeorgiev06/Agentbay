"""Git plumbing for the slice worktrees: one place that runs git, so the endpoints stay about the factory."""
from __future__ import annotations

import subprocess
from pathlib import Path
from typing import Any

from bay.connect import ConnectorError

IDENTITY = ["-c", "user.name=agentbay factory", "-c", "user.email=factory@agentbay.local"]
TAIL = 2000


def git(cwd: Path, *args: str, timeout: int = 120) -> tuple[int, str, str]:
    try:
        r = subprocess.run(["git", "-C", str(cwd), *IDENTITY, *args], capture_output=True, text=True, timeout=timeout)
    except OSError as e:
        raise ConnectorError(f"git is not available: {e}") from None
    except subprocess.TimeoutExpired:
        raise ConnectorError(f"git {' '.join(args)} took longer than {timeout}s in {cwd}") from None
    return r.returncode, r.stdout.strip(), r.stderr.strip()


def must(cwd: Path, *args: str, timeout: int = 120) -> str:
    code, out, err = git(cwd, *args, timeout=timeout)
    if code:
        raise ConnectorError(f"git {' '.join(args)} failed in {cwd}: {(err or out)[:400]}")
    return out


def repo_head(project: Path) -> str:
    code, out, _ = git(project, "rev-parse", "HEAD")
    if code:
        raise ConnectorError(f"{project} is not a git repository with a commit; the factory builds slices in git "
                             f"worktrees, so run `git init` and make one commit first")
    return out


def branch_exists(project: Path, name: str) -> bool:
    return git(project, "rev-parse", "--verify", f"refs/heads/{name}")[0] == 0


def ensure_branch(project: Path, name: str, base: str) -> bool:
    if branch_exists(project, name):
        return False
    must(project, "branch", name, base)
    return True


def ensure_worktree(project: Path, path: Path, branch: str) -> bool:
    """Add a worktree for an existing branch, unless it is already checked out there."""
    if (path / ".git").exists():
        return False
    path.parent.mkdir(parents=True, exist_ok=True)
    must(project, "worktree", "add", str(path), branch, timeout=300)
    return True


def ignore_root(project: Path, root: Path) -> None:
    """Keep the worktrees out of the project's own status: the folder that holds them ignores everything."""
    root.mkdir(parents=True, exist_ok=True)
    f = root / ".gitignore"
    if not f.exists():
        f.write_text("*\n", encoding="utf-8")


def changed_files(tree: Path, base: str) -> list[str]:
    out = must(tree, "diff", "--name-only", f"{base}...HEAD")
    dirty = must(tree, "status", "--porcelain")
    files = [ln for ln in out.splitlines() if ln]
    files += [ln[3:] for ln in dirty.splitlines() if ln]
    return sorted(dict.fromkeys(files))


def dirty(tree: Path) -> list[str]:
    return [ln[3:] for ln in must(tree, "status", "--porcelain").splitlines() if ln]


def run_command(tree: Path, name: str, command: list[str], timeout: int = 900) -> dict[str, Any]:
    """One command of the language profile, inside one worktree. Its output is kept as a tail, never parsed."""
    try:
        r = subprocess.run(command, cwd=str(tree), capture_output=True, text=True, timeout=timeout)
    except FileNotFoundError:
        return {"name": name, "command": " ".join(command), "ok": False, "exitCode": 127,
                "tail": f"{command[0]} is not installed in this environment; install it or drop '{name}' from the "
                        f"language profile's commands"}
    except subprocess.TimeoutExpired:
        return {"name": name, "command": " ".join(command), "ok": False, "exitCode": 124,
                "tail": f"no output in {timeout}s: the command was stopped"}
    text = (r.stdout + r.stderr).strip()
    return {"name": name, "command": " ".join(command), "ok": r.returncode == 0, "exitCode": r.returncode,
            "tail": text[-TAIL:]}


def merge(integration: Path, branch: str, message: str) -> tuple[bool, list[str]]:
    """Merge a slice branch into the integration worktree; a conflict is undone and reported, never left behind."""
    code, out, err = git(integration, "merge", "--no-ff", "-m", message, branch, timeout=300)
    if code == 0:
        return True, []
    conflicts = [ln for ln in must(integration, "diff", "--name-only", "--diff-filter=U").splitlines() if ln]
    git(integration, "merge", "--abort")
    if not conflicts:
        raise ConnectorError(f"merging {branch} failed without a conflict: {(err or out)[:400]}")
    return False, conflicts


def reset_to(tree: Path, commit: str) -> None:
    must(tree, "reset", "--hard", commit)


def worktrees(project: Path) -> list[dict[str, str]]:
    out = must(project, "worktree", "list", "--porcelain")
    trees: list[dict[str, str]] = []
    for block in out.split("\n\n"):
        row: dict[str, str] = {}
        for line in block.splitlines():
            key, _, value = line.partition(" ")
            if key in ("worktree", "HEAD", "branch"):
                row[key] = value
        if row.get("worktree"):
            trees.append(row)
    return trees
