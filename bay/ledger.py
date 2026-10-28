"""Append-only event ledger. System state = fold(events).

Stdlib only, so hooks can import it with any python3.
"""
from __future__ import annotations

import json
import os
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path

RUN_TYPES = {"spawned", "completed", "failed", "reclaimed", "note"}
STEP_TYPES = {"step.started", "step.completed", "step.failed", "step.skipped", "step.planned", "call.completed"}
DATA_TYPES = {"data.read"}             # a role read connector data through its use shim
TYPES = RUN_TYPES | STEP_TYPES | DATA_TYPES


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
    from .vault import redact  # last line of defence: no secret value ever reaches the ledger
    line = redact(json.dumps(ev, ensure_ascii=False))
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
        if e.get("type") in STEP_TYPES | DATA_TYPES:
            continue
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


@dataclass
class Call:
    call_id: str
    mode: str = ""
    endpoint: str = ""
    last_step: str = ""
    state: str = "running"         # running | waiting | done | partial | blocked | failed
    ts: str = ""
    cost: dict = field(default_factory=dict)


def fold_calls(events: list[dict]) -> dict[str, Call]:
    """Dispatcher step events -> one Call per callId."""
    calls: dict[str, Call] = {}
    for e in events:
        if e.get("type") not in STEP_TYPES or not e.get("callId"):
            continue
        c = calls.setdefault(e["callId"], Call(e["callId"]))
        c.mode, c.endpoint, c.ts = e.get("mode", c.mode), e.get("endpoint", c.endpoint), e["ts"]
        if e["type"] == "call.completed":
            c.state = (e.get("data") or {}).get("status", "done")
            continue
        c.last_step = e.get("step", "")
        c.state = {"step.planned": "waiting", "step.failed": "failed"}.get(e["type"], "running")
        for k, v in (e.get("cost") or {}).items():
            c.cost[k] = round(c.cost.get(k, 0) + v, 4)
    return calls


def project_root() -> Path:
    return Path(os.environ.get("CLAUDE_PROJECT_DIR") or os.getcwd())
