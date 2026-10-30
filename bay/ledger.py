"""Append-only event ledger. System state = fold(events).

Stdlib only, so hooks can import it with any python3.
"""
from __future__ import annotations

import json
import os
import re
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path

RUN_TYPES = {"spawned", "completed", "failed", "reclaimed", "note"}
STEP_TYPES = {"step.started", "step.completed", "step.failed", "step.skipped", "step.planned", "call.completed"}
DATA_TYPES = {"data.read"}             # a role read connector data through its use shim
# the guard hook denied a subagent tool call (prompts are read from Claude Code transcripts instead)
PERMISSION_TYPES = {"permission.denied"}
# an agent run's recorded outcome and to-do list (`bay plan`), and the coordinator's record of a dispatch
# (`bay dispatched`), which lists a running agent even when the spawn hook is off
PLAN_TYPES = {"agent.plan", "agent.plan.done", "agent.dispatch"}
TYPES = RUN_TYPES | STEP_TYPES | DATA_TYPES | PERMISSION_TYPES | PLAN_TYPES
TASK_ID = re.compile(r"^T-[0-9]{8}-[0-9a-z]{4}$")
MAX_OUTCOME, MAX_ITEMS, MAX_ITEM_TEXT, MAX_SERVES = 1000, 12, 240, 60
NOTE_KINDS = ("note", "instruction-change", "decision")


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
    from .secretscan import scrub_obj  # secret-shaped text agentbay never resolved (pasted keys, tokens)
    from .vault import redact  # last line of defence: no secret value ever reaches the ledger
    line = redact(json.dumps(scrub_obj(ev), ensure_ascii=True))
    # O_APPEND writes of a single short line are atomic enough for parallel hooks.
    with open(ledger_path(project), "a", encoding="utf-8") as f:
        f.write(line + "\n")
    return ev


class PlanError(ValueError):
    """A `bay plan` the ledger refuses; the message says what to fix."""


def _text(v, what: str, limit: int) -> str:
    if not isinstance(v, str) or not v.strip():
        raise PlanError(f"{what} must be a non-empty string")
    if len(v) > limit:
        raise PlanError(f"{what} is {len(v)} characters; the limit is {limit}")
    return v.strip()


def dispatched_agent(events: list[dict], task_id: str) -> dict | None:
    """The dispatch record (coordinator) or spawn record (hook) of a taskId, latest first wins; None if unknown."""
    for e in reversed(events):
        if e.get("taskId") == task_id and e.get("type") in ("agent.dispatch", "spawned"):
            return e
    return None


def record_plan(project: Path, task_id: str, plan: object, agent: str | None = None) -> dict:
    """Append the outcome and to-do list of a dispatched agent: {outcome, todo: [{text, serves}]}. Once per task.
    Checks size and shape, and that the taskId was dispatched (and that `agent`, when the guard names the caller,
    is the agent it was dispatched to); text is scrubbed by `append`. This is all `bay plan` can write."""
    evs = read(project)
    disp = _dispatched_check(evs, task_id, agent)
    if any(e["type"] == "agent.plan" and e.get("taskId") == task_id for e in evs):
        raise PlanError(f"{task_id} already has a plan; tick items with `bay plan {task_id} --done <n>`")
    if not isinstance(plan, dict) or set(plan) - {"outcome", "todo"}:
        raise PlanError('plan must be {"outcome": "...", "todo": [{"text": "...", "serves": "<done criterion>"}]}')
    outcome = _text(plan.get("outcome"), "outcome", MAX_OUTCOME)
    todo = plan.get("todo")
    if not isinstance(todo, list) or not 1 <= len(todo) <= MAX_ITEMS:
        raise PlanError(f"todo must list 1 to {MAX_ITEMS} items")
    items = []
    for i, it in enumerate(todo, 1):
        if not isinstance(it, dict) or set(it) - {"text", "serves"}:
            raise PlanError(f"todo item {i} must be {{text, serves}}")
        items.append({"n": i, "text": _text(it.get("text"), f"todo item {i} text", MAX_ITEM_TEXT),
                      "serves": _text(it.get("serves"), f"todo item {i} serves", MAX_SERVES)})
    return append(project, "agent.plan", task_id, source="plan", taskId=task_id, agent=disp.get("agent"),
                  summary=outcome, data={"todo": items})


def record_done(project: Path, task_id: str, n: object, agent: str | None = None) -> dict:
    evs = read(project)
    _dispatched_check(evs, task_id, agent)
    plan = plans(evs).get(task_id)
    if not plan:
        raise PlanError(f"{task_id} has no plan yet: run `bay plan {task_id} '<json>'` first")
    if not isinstance(n, int) or isinstance(n, bool) or not 1 <= n <= len(plan["todo"]):
        raise PlanError(f"--done takes an item number from 1 to {len(plan['todo'])}")
    return append(project, "agent.plan.done", task_id, source="plan", taskId=task_id, data={"n": n})


def _dispatched_check(evs: list[dict], task_id: str, agent: str | None) -> dict:
    if not isinstance(task_id, str) or not TASK_ID.match(task_id):
        raise PlanError(f"'{task_id}' is not a taskId (T-YYYYMMDD-xxxx)")
    disp = dispatched_agent(evs, task_id)
    if disp is None:
        raise PlanError(f"{task_id} was not dispatched to any agent; `bay plan` takes only the taskId in your task block")
    if agent and disp.get("agent") not in (None, agent):
        raise PlanError(f"{task_id} was dispatched to another agent; `bay plan` takes only your own taskId")
    return disp


def plans(events: list[dict]) -> dict[str, dict]:
    """taskId -> {outcome, todo: [{n, text, serves, done}], done: int}, folded from the plan events."""
    out: dict[str, dict] = {}
    for e in events:
        tid = e.get("taskId")
        if e.get("type") == "agent.plan" and tid and tid not in out:
            out[tid] = {"outcome": e.get("summary", ""), "todo": [dict(i, done=False) for i in (e.get("data") or {}).get("todo", [])],
                        "done": 0}
        elif e.get("type") == "agent.plan.done" and tid in out:
            for i in out[tid]["todo"]:
                if i["n"] == (e.get("data") or {}).get("n"):
                    i["done"] = True
            out[tid]["done"] = sum(1 for i in out[tid]["todo"] if i["done"])
    return out


def agent_groups(events: list[dict]) -> list[dict]:
    """Agent runs grouped by role, mode, model and tier, from the ledger alone: runs, outcomes, to-do progress, tokens
    and cost. Read by `bay status --agents` and by improve's weekly backlog."""
    plan_of = plans(events)
    groups: dict[tuple, dict] = {}
    runs = fold(events)
    for e in events:
        if e.get("type") != "agent.dispatch":
            continue
        d = e.get("data") or {}
        key = tuple(d.get(k) or "-" for k in ("role", "mode", "model", "tier"))
        g = groups.setdefault(key, {"role": key[0], "mode": key[1], "model": key[2], "tier": key[3], "runs": 0,
                                    "done": 0, "failed": 0, "todoDone": 0, "todoTotal": 0, "tokens": 0, "costUsd": 0.0})
        g["runs"] += 1
        r = next((x for x in runs.values() if x.task_id == e["taskId"]), None)
        g["done"] += bool(r and r.state == "done")
        g["failed"] += bool(r and r.state in ("failed", "blocked", "partial"))
        pl = plan_of.get(e["taskId"])
        if pl:
            g["todoDone"] += pl["done"]; g["todoTotal"] += len(pl["todo"])
        for s in events:
            if s.get("callId") == e.get("callId") and s.get("step") == e.get("step") and s.get("type") == "step.completed":
                g["tokens"] += (s.get("tokens") or {}).get("total", 0) if isinstance(s.get("tokens"), dict) else 0
                g["costUsd"] = round(g["costUsd"] + (s.get("costUsd") or 0), 4)
    return list(groups.values())


def read(project: Path) -> list[dict]:
    p = ledger_path(project)
    if not p.exists():
        return []
    out = []
    # one event per "\n" line: str.splitlines would also split on U+2028 and friends inside a summary
    for line in p.read_text(encoding="utf-8").split("\n"):
        try:
            ev = json.loads(line)
        except json.JSONDecodeError:
            continue
        if isinstance(ev, dict):
            out.append(ev)
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
    """Agent runs. Only spawned/completed/failed/reclaimed create a run; a note attaches to the run it names
    (by runId, or by taskId) or stays standalone (see `standalone_notes`). It never creates a run."""
    runs: dict[str, Run] = {}
    notes: list[dict] = []
    for e in events:
        if e.get("type") not in RUN_TYPES:
            continue
        if e["type"] == "note":
            notes.append(e)
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
    seen = {r.task_id for r in runs.values() if r.task_id}
    for e in events:
        if e.get("type") == "agent.dispatch" and e.get("taskId") and e["taskId"] not in seen:
            runs[e["runId"]] = Run(e["runId"], agent=e.get("agent", "?"), task_id=e["taskId"], state="running",
                                   started=e["ts"], summary=e.get("summary", ""))
            seen.add(e["taskId"])
    for n in notes:
        for r in _note_targets(n, runs):
            r.notes.append(n.get("summary", ""))
    return runs


def _note_targets(note: dict, runs: dict[str, Run]) -> list[Run]:
    if note["runId"] in runs:
        return [runs[note["runId"]]]
    tid = note.get("taskId") or note["runId"]
    return [r for r in runs.values() if r.task_id and r.task_id == tid]


def standalone_notes(events: list[dict]) -> list[dict]:
    """Notes that name no known agent run (tasks not spawned yet, calls, findings, free notes)."""
    runs = fold(events)
    return [e for e in events if e.get("type") == "note" and not _note_targets(e, runs)]


@dataclass
class Call:
    call_id: str
    mode: str = ""
    endpoint: str = ""
    last_step: str = ""
    state: str = "running"         # running | waiting | done | partial | blocked | failed
    ts: str = ""
    cost: dict = field(default_factory=dict)
    duration_ms: int | None = None


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
            c.duration_ms = e.get("durationMs", c.duration_ms)
            continue
        c.last_step = e.get("step", "")
        c.state = {"step.planned": "waiting", "step.failed": "failed"}.get(e["type"], "running")
        for k, v in (e.get("cost") or {}).items():
            c.cost[k] = round(c.cost.get(k, 0) + v, 4)
    return calls


def project_root() -> Path:
    return Path(os.environ.get("CLAUDE_PROJECT_DIR") or os.getcwd())
