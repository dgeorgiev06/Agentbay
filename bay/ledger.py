"""Append-only event ledger. System state = fold(events).

Stdlib only, so hooks can import it with any python3.
"""
from __future__ import annotations

import json
import os
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path

TYPES = {"spawned", "completed", "failed", "reclaimed", "note"}


def ledger_path(project: Path) -> Path:
    p = project / ".agentbay" / "ledger" / "events.jsonl"
    p.parent.mkdir(parents=True, exist_ok=True)
    return p


def now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def append(project: Path, type: str, run_id: str, **fields) -> dict:
    if type not in TYPES:
        raise ValueError(f"unknown event type {type!r}")
    ev = {"v": 1, "ts": now(), "type": type, "runId": run_id}
    ev.update({k: v for k, v in fields.items() if v not in (None, "", {}, [])})
    line = json.dumps(ev, ensure_ascii=False)
    # O_APPEND writes of a single short line are atomic enough for parallel hooks.
    with open(ledger_path(project), "a", encoding="utf-8") as f:
        f.write(line + "\n")
    return ev


def read(project: Path) -> list[dict]:
    p = ledger_path(project)
    if not p.exists():
        return []
    out = []
    for line in p.read_text(encoding="utf-8").splitlines():
        try:
            out.append(json.loads(line))
        except json.JSONDecodeError:
            continue
    return out


@dataclass
class Run:
    run_id: str
    agent: str = "?"
    task_id: str = ""
    state: str = "running"          # running | done | partial | blocked | failed | reclaimed
    started: str = ""
    ended: str = ""
    summary: str = ""
    notes: list[str] = field(default_factory=list)


def fold(events: list[dict]) -> dict[str, Run]:
    runs: dict[str, Run] = {}
    for e in events:
        r = runs.setdefault(e["runId"], Run(e["runId"]))
        r.agent = e.get("agent", r.agent)
        r.task_id = e.get("taskId", r.task_id)
        t = e["type"]
        if t == "spawned":
            r.started, r.state = e["ts"], "running"
            r.summary = e.get("summary", r.summary)
        elif t == "completed":
            r.ended = e["ts"]
            r.state = (e.get("data") or {}).get("status", "done")
            r.summary = e.get("summary", r.summary)
        elif t == "failed":
            r.ended, r.state = e["ts"], "failed"
            r.summary = e.get("summary", r.summary)
        elif t == "reclaimed":
            r.ended, r.state = e["ts"], "reclaimed"
        elif t == "note":
            r.notes.append(e.get("summary", ""))
    return runs


def project_root() -> Path:
    return Path(os.environ.get("CLAUDE_PROJECT_DIR") or os.getcwd())
