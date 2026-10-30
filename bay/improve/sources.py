"""agentbay's own records -> session.episode/v1 and review verdicts; git history -> commit episodes.

Ledger:  .agentbay/ledger/events.jsonl (dispatcher steps, agent runs, guard decisions, notes)
Calls:   .agentbay/calls/<callId>.json (review verdicts submitted to review steps)
Git:     `git log --numstat` of the project (sha, date, revert flag, files and churn; never messages)
"""
from __future__ import annotations

import json
import re
import subprocess
from datetime import datetime
from pathlib import Path

from .. import secretscan
from . import short_hash

EVIDENCE_CHARS = 300
REVERT_BODY = re.compile(r"This reverts commit ([0-9a-f]{7,40})")


MAX_SUBJECT = 200


def in_window(ts: str | None, since: datetime | None, until: datetime | None) -> bool:
    if not ts:
        return since is None
    try:
        t = datetime.fromisoformat(ts.replace("Z", "+00:00"))
    except ValueError:
        return False
    return (since is None or t >= since) and (until is None or t <= until)


LEDGER = ".agentbay/ledger/events.jsonl"
MAX_WARNINGS = 20


def warn(warnings: list | None, msg: str) -> None:
    if warnings is not None and len(warnings) < MAX_WARNINGS:
        warnings.append(msg)


def read_events(project: Path, warnings: list | None = None) -> list[dict]:
    """Ledger events; a line that is not a JSON event is skipped and named (file:line) in `warnings`."""
    p = project / LEDGER
    out = []
    if p.exists():
        for n, line in enumerate(p.read_text(encoding="utf-8", errors="replace").splitlines(), 1):
            if not line.strip():
                continue
            try:
                e = json.loads(line)
            except (ValueError, RecursionError):
                e = None
            if isinstance(e, dict) and isinstance(e.get("type"), str) and isinstance(e.get("ts"), str) \
                    and isinstance(e.get("runId"), str):
                out.append(e)
            else:
                warn(warnings, f"{LEDGER}:{n}: not a ledger event, skipped")
    return out


def _tokens_add(acc: dict, tok) -> None:
    if isinstance(tok, dict):
        for k, v in tok.items():
            if isinstance(v, (int, float)):
                acc[k] = acc.get(k, 0) + int(v)


def _episode(eid: str, kind: str, ts: str, **extra) -> dict:
    return {"id": eid, "source": "ledger", "kind": kind, "start": ts, "end": ts, **extra, "steps": [],
            "toolCalls": [], "errors": 0, "denials": [], "permissionPrompts": 0, "interrupts": 0,
            "instructionChanges": 0, "subagents": []}


class _LedgerFold:
    """Folds ledger events into call episodes (keyed by callId) and agent-run episodes (keyed by runId)."""

    def __init__(self):
        self.calls: dict[str, dict] = {}
        self.runs: dict[str, dict] = {}
        self.by_task: dict[str, list[dict]] = {}
        self.notes: list[dict] = []

    def run(self, rid: str, e: dict) -> dict:
        ep = self.runs.setdefault(rid, _episode(f"ab:run:{rid}", "agent-run", e["ts"]))
        ep["end"] = max(ep["end"], e["ts"])
        return ep

    def event(self, e: dict) -> None:
        t = e["type"]
        if e.get("callId") and (t.startswith("step.") or t == "call.completed"):
            self._call_event(e, t)
        elif t in ("spawned", "completed", "failed", "reclaimed"):
            self._run_event(e, t)
        elif t == "permission.denied":
            ep = self.run(e["runId"], e)
            ep["agent"] = e.get("agent", ep.get("agent"))
            ep["denials"].append({"tool": e.get("tool", "?")})
        elif t == "note" and (e.get("data") or {}).get("kind") == "instruction-change":
            self.notes.append(e)

    def _call_event(self, e: dict, t: str) -> None:
        c = self.calls.setdefault(e["callId"], _episode(
            f"ab:{e['callId']}", "call", e["ts"], target=f"{e.get('mode', '?')}.{e.get('endpoint', '?')}"))
        c["end"] = max(c["end"], e["ts"])
        if t == "call.completed":
            c["status"] = (e.get("data") or {}).get("status", "done")
            if isinstance(e.get("durationMs"), int):
                c["durationMs"] = e["durationMs"]
            if isinstance(e.get("costUsd"), (int, float)):
                c["costUsd"] = e["costUsd"]
            return
        if t in ("step.completed", "step.failed"):
            st = {"id": e.get("step", "?"), "name": f"{c['target']}.{e.get('step', '?')}",
                  "status": "failed" if t == "step.failed" else "done"}
            for k in ("role", "agent", "env", "durationMs", "costUsd", "tokens"):
                if e.get(k) is not None:
                    st[k] = e[k]
            c["steps"].append(st)
            if t == "step.failed":
                c["errors"] += 1
            _tokens_add(c.setdefault("tokens", {}), e.get("tokens"))

    def _run_event(self, e: dict, t: str) -> None:
        ep = self.run(e["runId"], e)
        ep["agent"] = e.get("agent", ep.get("agent"))
        if e.get("taskId"):
            ep["taskId"] = e["taskId"]
            self.by_task.setdefault(e["taskId"], []).append(ep)
        if t in ("completed", "failed"):
            ep["status"] = (e.get("data") or {}).get("status", "failed" if t == "failed" else "done")
            if isinstance(e.get("durationMs"), int):
                ep["durationMs"] = e["durationMs"]
            _tokens_add(ep.setdefault("tokens", {}), e.get("tokens"))
            if t == "failed":
                ep["errors"] += 1

    def attach_notes(self) -> None:
        """An instruction change counts on the call, run or task it names; a note naming none of them becomes
        its own task episode."""
        for n in self.notes:
            targets = []
            if n.get("callId") and n["callId"] in self.calls:
                targets = [self.calls[n["callId"]]]
            elif n["runId"] in self.runs:
                targets = [self.runs[n["runId"]]]
            elif n.get("taskId") in self.by_task:
                targets = self.by_task[n["taskId"]]
            if not targets:
                ref = n.get("callId") or n.get("taskId") or n["runId"]
                key = f"ab:note:{short_hash(ref, 10)}"
                ep = next((x for x in self.runs.values() if x["id"] == key), None)
                if ep is None:
                    ep = self.run(f"note:{short_hash(ref, 10)}", n)
                    ep["id"], ep["kind"] = key, "task"
                targets = [ep]
            for t in targets:
                t["instructionChanges"] += 1

    def episodes(self) -> list[dict]:
        eps = list(self.calls.values()) + list(self.runs.values())
        for ep in eps:
            if ep.get("tokens") == {}:
                ep.pop("tokens")
            if "durationMs" not in ep:
                try:
                    a = datetime.fromisoformat(ep["start"].replace("Z", "+00:00"))
                    b = datetime.fromisoformat(ep["end"].replace("Z", "+00:00"))
                    ep["durationMs"] = int((b - a).total_seconds() * 1000)
                except (ValueError, KeyError):
                    pass
        return eps


def ledger_episodes(project: Path, since: datetime | None = None, until: datetime | None = None) -> tuple[list[dict], dict]:
    """Calls (one episode per callId, with steps), agent runs (spawned/completed + guard decisions) and
    instruction-change notes."""
    warnings: list[str] = []
    evs = [e for e in read_events(project, warnings) if in_window(e.get("ts"), since, until)]
    fold = _LedgerFold()
    for e in evs:
        fold.event(e)
    fold.attach_notes()
    eps = fold.episodes()
    return eps, {"events": len(evs), "calls": len(fold.calls), "runs": len(fold.runs),
                 "instructionNotes": len(fold.notes), **({"warnings": warnings} if warnings else {})}


def _subject(inp: dict, call_id: str) -> str:
    """What a call worked on, so repeated calls on the same thing count as review rounds."""
    for k in ("proposal", "id", "name"):
        if isinstance(inp.get(k), str) and inp[k]:
            return inp[k] if k != "name" else f"{inp.get('kind', '')}:{inp[k]}"
    if isinstance(inp.get("goal"), str):
        return "goal:" + short_hash(inp["goal"].strip().lower(), 10)
    return call_id


def _texts(kit: Path | None, target: str, cache: dict, warnings: list) -> dict:
    """DoD and rule statements of a feature (id -> text), from the kit, for verdict context."""
    if target in cache:
        return cache[target]
    out: dict = {}
    if kit is not None:
        try:
            from .. import model
            k = model.Kit(kit)
            mode, _, ep = target.partition(".")
            md = k.get("Mode", mode)
            e = md.spec["features"].get(ep) if md else None
            if e and e.get("playbook") and (md.dir / e["playbook"]).exists():
                from .. import playbook
                out.update({d.id: d.text for d in playbook.parse(md.dir / e["playbook"]).dod})
            if e and e.get("rules") and (md.dir / e["rules"]).exists():
                from .. import rules
                out.update({r.id: r.statement for r in rules.load(md.dir / e["rules"])})
        except Exception as e:     # verdicts stay usable without the DoD text; say which feature failed
            warn(warnings, f"{target}: DoD/rule texts not loaded ({type(e).__name__}: {str(e)[:120]})")
    cache[target] = out
    return out


def ledger_verdicts(project: Path, kit: Path | None = None, since: datetime | None = None,
                    until: datetime | None = None) -> tuple[list[dict], dict]:
    """Every review.verdict/v1 submitted to a review step, with round numbers per (target, subject)."""
    warnings: list[str] = []
    last_ts = _last_event_ts(project)
    out, texts = [], {}
    for f, st in _call_states(project / ".agentbay" / "calls", warnings):
        cid = st.get("callId") or f.stem
        ts = last_ts.get(cid) or datetime.fromtimestamp(f.stat().st_mtime).astimezone().isoformat(timespec="seconds")
        if not in_window(ts, since, until):
            continue
        target = st.get("target", "?")
        for step, val in (st.get("steps") or {}).items():
            if not _is_review_step(val):
                continue
            tx = _texts(kit, target, texts, warnings)
            items = _review_items(f, step, val["items"], tx, warnings)
            out.append({"callId": cid, "episode": f"ab:{cid}", "target": target, "step": step,
                        "subject": _subject(st.get("input") or {}, cid), "ts": ts, "status": st.get("status"),
                        "items": items})
    out.extend(_recorded_reviews(project, since, until))
    out.sort(key=lambda v: v["ts"])
    _number_rounds(out)
    return out, {"verdicts": len(out), **({"warnings": warnings} if warnings else {})}


def _last_event_ts(project: Path) -> dict[str, str]:
    """The timestamp of the latest ledger event of each call."""
    last_ts: dict[str, str] = {}
    for e in read_events(project):
        if e.get("callId"):
            last_ts[e["callId"]] = max(last_ts.get(e["callId"], ""), e.get("ts", ""))
    return last_ts


def _call_states(cdir: Path, warnings: list[str]):
    """(file, state) of every readable call state under `cdir`, in name order; the others are warned about."""
    for f in sorted(cdir.glob("C-*.json")) if cdir.is_dir() else []:
        try:
            st = json.loads(f.read_text(encoding="utf-8"))
        except (OSError, ValueError, RecursionError) as e:
            warn(warnings, f".agentbay/calls/{f.name}: unreadable call state ({type(e).__name__}), skipped")
            continue
        if not isinstance(st, dict):
            warn(warnings, f".agentbay/calls/{f.name}: not a call state object, skipped")
            continue
        yield f, st


def _is_review_step(val) -> bool:
    """Whether a call-state step holds review items (each with a verdict)."""
    return (isinstance(val, dict) and isinstance(val.get("items"), list)
            and all(isinstance(i, dict) and "verdict" in i for i in val["items"]))


def _review_item(i: dict, tx: dict) -> dict:
    """One verdict item as the detectors see it: bounded and scrubbed."""
    it = {"id": str(i.get("id", "?"))[:40], "verdict": i["verdict"]}
    if i.get("severity") in ("blocker", "should-fix", "nit"):
        it["severity"] = i["severity"]
    if isinstance(i.get("evidence"), str):         # scrub first, then cut: no secret prefix survives
        it["evidence"] = secretscan.scrub(i["evidence"])[:EVIDENCE_CHARS]
    if it["id"] in tx:
        it["text"] = secretscan.scrub(tx[it["id"]])[:EVIDENCE_CHARS]
    return it


def _review_items(f: Path, step: str, raw: list, tx: dict, warnings: list[str]) -> list[dict]:
    """The items of one review step; one whose verdict is not pass|fail|n/a is warned about and skipped."""
    items = []
    for n, i in enumerate(raw):
        if i.get("verdict") not in ("pass", "fail", "n/a"):
            warn(warnings, f".agentbay/calls/{f.name}: steps.{step}.items[{n}]: verdict "
                           f"{str(i.get('verdict'))[:20]!r} is not pass|fail|n/a, skipped")
            continue
        items.append(_review_item(i, tx))
    return items


def _recorded_reviews(project: Path, since: datetime | None, until: datetime | None) -> list[dict]:
    """Reviews the coordinator recorded (`bay review-record`)."""
    out = []
    for e in read_events(project):
        if e["type"] != "review.recorded" or not in_window(e.get("ts"), since, until):
            continue
        items = [{k: (secretscan.scrub(v)[:EVIDENCE_CHARS] if k == "evidence" else v)
                  for k, v in i.items() if k in ("id", "verdict", "severity", "evidence")}
                 for i in (e.get("data") or {}).get("items", []) if isinstance(i, dict) and i.get("verdict") in ("pass", "fail", "n/a")]
        tid = str(e.get("taskId") or e["runId"])
        out.append({"callId": tid, "episode": f"ab:{tid}", "target": "review-record", "step": "review", "subject": tid,
                    "ts": e["ts"], "status": None, "items": items})
    return out


def _number_rounds(verdicts: list[dict]) -> None:
    """Number the verdicts of each (target, subject) 1, 2, ... in list order."""
    rounds: dict = {}
    for v in verdicts:
        k = (v["target"], v["subject"])
        rounds[k] = rounds.get(k, 0) + 1
        v["round"] = rounds[k]


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
