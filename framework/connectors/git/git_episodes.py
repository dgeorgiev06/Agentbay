"""`git log --numstat` of the project -> commit episodes (sha, date, revert flag, files and churn; never messages)."""
from __future__ import annotations

import re
import subprocess
from datetime import datetime
from pathlib import Path

from bay import secretscan

REVERT_BODY = re.compile(r"This reverts commit ([0-9a-f]{7,40})")
MAX_SUBJECT = 200


def git_episodes(project: Path, since: datetime | None = None, until: datetime | None = None,
                 run=subprocess.run) -> tuple[list[dict], dict]:
    """Commits in the window: sha, scrubbed subject line, date, revert flag/target, files touched and churn. Bodies are
    read only to detect reverts and are never returned."""
    args = ["git", "-C", str(project), "log", "--no-color", "--no-merges", "--numstat",
            "--format=%x1e%H%x1f%aI%x1f%s%x1f%b%x1f"]
    if since:
        args.append(f"--since={since.isoformat()}")
    if until:
        args.append(f"--until={until.isoformat()}")
    try:
        r = run(args, capture_output=True, text=True, timeout=60)
    except (OSError, subprocess.SubprocessError):
        return [], {"commits": 0, "note": "git not available"}
    if r.returncode != 0:
        return [], {"commits": 0, "note": "not a git repository"}
    eps = []
    for chunk in r.stdout.split("\x1e"):
        if not chunk.strip():
            continue
        parts = chunk.split("\x1f")
        if len(parts) < 5:
            continue
        sha, date, subject, body, rest = parts[0].strip(), parts[1], parts[2], parts[3], parts[4]
        m = REVERT_BODY.search(body)
        files, added, removed = [], 0, 0
        for line in rest.strip().splitlines():
            cols = line.split("\t")
            if len(cols) != 3:
                continue
            a, d, path = cols
            files.append(path)
            added += int(a) if a.isdigit() else 0
            removed += int(d) if d.isdigit() else 0
        commit = {"sha": sha[:12], "subject": secretscan.scrub(subject.strip())[:MAX_SUBJECT],
                  "isRevert": subject.startswith('Revert "') or bool(m), "files": files,
                  "added": added, "removed": removed}
        if m:
            commit["revertOf"] = m.group(1)[:12]
        eps.append({"id": f"git:{sha[:12]}", "source": "git", "kind": "commit", "start": date, "end": date,
                    "steps": [], "toolCalls": [], "errors": 0, "denials": [], "permissionPrompts": 0,
                    "interrupts": 0, "instructionChanges": 0, "subagents": [], "commit": commit})
    return eps, {"commits": len(eps), "reverts": sum(1 for e in eps if e["commit"]["isRevert"])}
