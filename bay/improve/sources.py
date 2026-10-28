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


def ledger_episodes(project: Path, since: datetime | None = None, until: datetime | None = None) -> tuple[list[dict], dict]:
    """Calls (one episode per callId, with steps), agent runs (spawned/completed + guard decisions) and
    instruction-change notes."""
    warnings: list[str] = []
    evs = [e for e in read_events(project, warnings) if in_window(e.get("ts"), since, until)]
    calls: dict[str, dict] = {}
    runs: dict[str, dict] = {}
    by_task: dict[str, list[dict]] = {}
    notes: list[dict] = []

    def run(rid: str, e: dict) -> dict:
        ep = runs.setdefault(rid, {"id": f"ab:run:{rid}", "source": "ledger", "kind": "agent-run",
                                   "start": e["ts"], "end": e["ts"], "steps": [], "toolCalls": [], "errors": 0,
                                   "denials": [], "permissionPrompts": 0, "interrupts": 0, "instructionChanges": 0,
                                   "subagents": []})
        ep["end"] = max(ep["end"], e["ts"])
        return ep

    for e in evs:
        t = e["type"]
        if e.get("callId") and (t.startswith("step.") or t == "call.completed"):
            c = calls.setdefault(e["callId"], {
                "id": f"ab:{e['callId']}", "source": "ledger", "kind": "call", "start": e["ts"], "end": e["ts"],
                "target": f"{e.get('mode', '?')}.{e.get('endpoint', '?')}", "steps": [], "toolCalls": [],
                "errors": 0, "denials": [], "permissionPrompts": 0, "interrupts": 0, "instructionChanges": 0,
                "subagents": []})
            c["end"] = max(c["end"], e["ts"])
            if t == "call.completed":
                c["status"] = (e.get("data") or {}).get("status", "done")
                if isinstance(e.get("durationMs"), int):
                    c["durationMs"] = e["durationMs"]
                if isinstance(e.get("costUsd"), (int, float)):
                    c["costUsd"] = e["costUsd"]
                continue
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
        elif t in ("spawned", "completed", "failed", "reclaimed"):
            ep = run(e["runId"], e)
            ep["agent"] = e.get("agent", ep.get("agent"))
            if e.get("taskId"):
                ep["taskId"] = e["taskId"]
                by_task.setdefault(e["taskId"], []).append(ep)
            if t in ("completed", "failed"):
                ep["status"] = (e.get("data") or {}).get("status", "failed" if t == "failed" else "done")
                if isinstance(e.get("durationMs"), int):
                    ep["durationMs"] = e["durationMs"]
                _tokens_add(ep.setdefault("tokens", {}), e.get("tokens"))
                if t == "failed":
                    ep["errors"] += 1
        elif t == "permission.denied":
            ep = run(e["runId"], e)
            ep["agent"] = e.get("agent", ep.get("agent"))
            ep["denials"].append({"tool": e.get("tool", "?")})
        elif t == "note" and (e.get("data") or {}).get("kind") == "instruction-change":
            notes.append(e)
    standalone = 0
    for n in notes:
        targets = []
        if n.get("callId") and n["callId"] in calls:
            targets = [calls[n["callId"]]]
        elif n["runId"] in runs:
            targets = [runs[n["runId"]]]
        elif n.get("taskId") in by_task:
            targets = by_task[n["taskId"]]
        if not targets:
            ref = n.get("callId") or n.get("taskId") or n["runId"]
            key = f"ab:note:{short_hash(ref, 10)}"
            ep = next((x for x in runs.values() if x["id"] == key), None)
            if ep is None:
                ep = run(f"note:{short_hash(ref, 10)}", n)
                ep["id"], ep["kind"] = key, "task"
                standalone += 1
            targets = [ep]
        for t in targets:
            t["instructionChanges"] += 1
    eps = list(calls.values()) + list(runs.values())
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
    return eps, {"events": len(evs), "calls": len(calls), "runs": len(runs), "instructionNotes": len(notes),
                 **({"warnings": warnings} if warnings else {})}


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
            e = md.spec["endpoints"].get(ep) if md else None
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
    cdir = project / ".agentbay" / "calls"
    warnings: list[str] = []
    last_ts: dict[str, str] = {}
    for e in read_events(project):
        if e.get("callId"):
            last_ts[e["callId"]] = max(last_ts.get(e["callId"], ""), e.get("ts", ""))
    out, texts = [], {}
    for f in sorted(cdir.glob("C-*.json")) if cdir.is_dir() else []:
        try:
            st = json.loads(f.read_text(encoding="utf-8"))
        except (OSError, ValueError, RecursionError) as e:
            warn(warnings, f".agentbay/calls/{f.name}: unreadable call state ({type(e).__name__}), skipped")
            continue
        if not isinstance(st, dict):
            warn(warnings, f".agentbay/calls/{f.name}: not a call state object, skipped")
            continue
        cid = st.get("callId") or f.stem
        ts = last_ts.get(cid) or datetime.fromtimestamp(f.stat().st_mtime).astimezone().isoformat(timespec="seconds")
        if not in_window(ts, since, until):
            continue
        target = st.get("target", "?")
        for step, val in (st.get("steps") or {}).items():
            if not (isinstance(val, dict) and isinstance(val.get("items"), list)
                    and all(isinstance(i, dict) and "verdict" in i for i in val["items"])):
                continue
            tx = _texts(kit, target, texts, warnings)
            items = []
            for n, i in enumerate(val["items"]):
                if i.get("verdict") not in ("pass", "fail", "n/a"):
                    warn(warnings, f".agentbay/calls/{f.name}: steps.{step}.items[{n}]: verdict "
                                   f"{str(i.get('verdict'))[:20]!r} is not pass|fail|n/a, skipped")
                    continue
                it = {"id": str(i.get("id", "?"))[:40], "verdict": i["verdict"]}
                if i.get("severity") in ("blocker", "should-fix", "nit"):
                    it["severity"] = i["severity"]
                if isinstance(i.get("evidence"), str):         # scrub first, then cut: no secret prefix survives
                    it["evidence"] = secretscan.scrub(i["evidence"])[:EVIDENCE_CHARS]
                if it["id"] in tx:
                    it["text"] = secretscan.scrub(tx[it["id"]])[:EVIDENCE_CHARS]
                items.append(it)
            out.append({"callId": cid, "episode": f"ab:{cid}", "target": target, "step": step,
                        "subject": _subject(st.get("input") or {}, cid), "ts": ts, "status": st.get("status"),
                        "items": items})
    out.sort(key=lambda v: v["ts"])
    rounds: dict = {}
    for v in out:
        k = (v["target"], v["subject"])
        rounds[k] = rounds.get(k, 0) + 1
        v["round"] = rounds[k]
    return out, {"verdicts": len(out), **({"warnings": warnings} if warnings else {})}


def git_episodes(project: Path, since: datetime | None = None, until: datetime | None = None,
                 run=subprocess.run) -> tuple[list[dict], dict]:
    """Commits in the window: sha, date, revert flag/target, files touched and churn. Messages are read only
    to detect reverts and are never returned."""
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
        commit = {"sha": sha[:12], "isRevert": subject.startswith('Revert "') or bool(m), "files": files,
                  "added": added, "removed": removed}
        if m:
            commit["revertOf"] = m.group(1)[:12]
        eps.append({"id": f"git:{sha[:12]}", "source": "git", "kind": "commit", "start": date, "end": date,
                    "steps": [], "toolCalls": [], "errors": 0, "denials": [], "permissionPrompts": 0,
                    "interrupts": 0, "instructionChanges": 0, "subagents": [], "commit": commit})
    return eps, {"commits": len(eps), "reverts": sum(1 for e in eps if e["commit"]["isRevert"])}
