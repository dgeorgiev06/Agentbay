"""The stage engine: what a run has to call now, computed from what it has recorded. Nothing here runs a call."""
from __future__ import annotations

from typing import Any

SINGLE = ("spec", "plan", "approve", "slice")


def entries(run: dict[str, Any]) -> list[dict[str, Any]]:
    return [e for e in run["pipeline"] if e.get("enabled", True)]


def records(run: dict[str, Any], stage: str, slice_id: str | None = None,
            lens: str | None = None) -> list[dict[str, Any]]:
    return [r for r in run["records"] if r["stage"] == stage
            and (slice_id is None or r.get("sliceId") == slice_id) and (lens is None or r.get("lens") == lens)]


def _done(recs: list[dict[str, Any]]) -> dict[str, Any] | None:
    return next((r for r in recs if r["status"] == "done"), None)


def _changed_at(run: dict[str, Any], slice_id: str) -> int:
    """The sequence number of the newest change to a slice: its build, or the last fix round that ended."""
    seqs = [r["seq"] for r in run["records"] if r.get("sliceId") == slice_id and r["stage"] in ("build", "fix")]
    return max(seqs, default=0)


def _audited(run: dict[str, Any], slice_id: str, lens: str) -> bool:
    """A lens has judged this slice as it stands now: its record is newer than the slice's last change."""
    at = _changed_at(run, slice_id)
    return any(r["seq"] > at and r["status"] in ("done", "partial") for r in records(run, "audit", slice_id, lens))


def _open_blocking(slice_: dict[str, Any]) -> list[dict[str, Any]]:
    return [f for f in slice_.get("findings") or [] if f.get("open") and f.get("blocking")]


def _lenses(run: dict[str, Any], entry: dict[str, Any]) -> list[dict[str, Any]]:
    want = entry.get("lenses")
    return [ln for ln in run["lenses"] if want is None or ln["id"] in want]


def _blocking_lenses(run: dict[str, Any]) -> list[dict[str, Any]]:
    audit = next((e for e in entries(run) if e["stage"] == "audit"), None)
    return [] if audit is None else [ln for ln in _lenses(run, audit) if ln.get("blocking", True)]


def _call(target: str, label: str, **inp: Any) -> dict[str, Any]:
    return {"target": f"factory.{target}", "input": inp, "label": label}


def _single(run: dict[str, Any], stage: str) -> tuple[list[dict[str, Any]], str | None]:
    recs = records(run, stage)
    if _done(recs):
        return [], None
    if recs:
        last = recs[-1]
        return [], (f"stage {stage} ended {last['status']}: {last.get('summary') or 'no summary'}; fix it and call "
                    f"factory.{stage} again, or close the run")
    if stage == "approve":
        plan = _done(records(run, "plan"))
        files = (plan or {}).get("artifacts") or []
        if not files:
            return [], ("stage approve has no plan file to bind the gate to: the plan stage recorded no artifact")
        return [_call("approve", "approve the technical plan", runId=run["runId"], plan=files[0])], None
    return [_call(stage, f"stage {stage}", runId=run["runId"])], None


def _build_ready(run: dict[str, Any], slices: list[dict[str, Any]]) -> list[dict[str, Any]]:
    built = {s["id"] for s in slices if _done(records(run, "build", s["id"]))}
    return [s for s in slices if s["id"] not in built and set(s.get("deps") or []) <= built]


def _audit_calls(run: dict[str, Any], entry: dict[str, Any], slices: list[dict[str, Any]]) -> list[dict[str, Any]]:
    out = []
    for s in slices:
        if not _done(records(run, "build", s["id"])):
            continue
        for ln in _lenses(run, entry):
            if not _audited(run, s["id"], ln["id"]):
                out.append(_call("audit", f"{s['id']} through the {ln['id']} lens", runId=run["runId"],
                                 sliceId=s["id"], lens=ln["id"]))
    return out


def _fix_calls(run: dict[str, Any], entry: dict[str, Any],
               slices: list[dict[str, Any]]) -> tuple[list[dict[str, Any]], list[str]]:
    rounds = int(entry.get("maxRounds", run["constraints"].get("maxFixRounds", 2)))
    calls, stuck = [], []
    for s in slices:
        open_ = _open_blocking(s)
        if not open_:
            continue
        if len(records(run, "fix", s["id"])) >= rounds:
            stuck.append(f"{s['id']} still has {len(open_)} blocking finding(s) after {rounds} fix round(s): "
                         + "; ".join(f"{f['lens']} {f['id']}" for f in open_))
            continue
        calls.append(_call("fix", f"fix {s['id']} ({len(open_)} blocking)", runId=run["runId"], sliceId=s["id"]))
    return calls, stuck


def _integrate_calls(run: dict[str, Any], slices: list[dict[str, Any]]) -> tuple[list[dict[str, Any]], list[str]]:
    done = {s["id"] for s in slices if _done(records(run, "integrate", s["id"]))}
    needed = _blocking_lenses(run)
    calls, waiting = [], []
    for s in slices:
        if s["id"] in done:
            continue
        if not _done(records(run, "build", s["id"])):
            waiting.append(f"{s['id']} is not built yet")
        elif _open_blocking(s):
            waiting.append(f"{s['id']} has blocking findings open")
        elif any(not _audited(run, s["id"], ln["id"]) for ln in needed):
            waiting.append(f"{s['id']} is waiting on a review by every blocking lens")
        elif not set(s.get("deps") or []) <= done:
            waiting.append(f"{s['id']} waits for {', '.join(sorted(set(s.get('deps') or []) - done))} to integrate")
        else:
            calls.append(_call("integrate", f"integrate {s['id']}", runId=run["runId"], sliceId=s["id"]))
    return calls, waiting


def plan(run: dict[str, Any]) -> dict[str, Any]:
    """The stage the run stands at, the calls to make now (which may run in parallel), and why it is held up."""
    slices = run.get("slices") or []
    for entry in entries(run):
        stage, limit = entry["stage"], int(entry.get("parallel", 1))
        calls: list[dict[str, Any]] = []
        waiting: list[str] = []
        blockers: list[str] = []
        reason: str | None = None
        if stage in SINGLE:
            calls, reason = _single(run, stage)
            if reason:
                return {"status": "blocked", "stage": stage, "reason": reason}
            if not calls:
                continue
        elif not slices:
            continue
        elif stage == "build":
            ready = _build_ready(run, slices)
            calls = [_call("build", f"build {s['id']}", runId=run["runId"], sliceId=s["id"]) for s in ready]
            if not calls:
                continue
        elif stage == "audit":
            calls = _audit_calls(run, entry, slices)
            if not calls:
                continue
        elif stage == "fix":
            calls, blockers = _fix_calls(run, entry, slices)
            if not calls and not blockers:
                continue
            if not calls:
                return {"status": "blocked", "stage": stage, "blockers": blockers,
                        "reason": "a slice is out of fix rounds; widen constraints.maxFixRounds, change the plan, "
                                  "or decide the findings yourself"}
        elif stage == "integrate":
            calls, waiting = _integrate_calls(run, slices)
            if not calls and not waiting:
                continue
            if not calls:
                return {"status": "waiting", "stage": stage, "waiting": waiting,
                        "reason": "integration waits on earlier stages: " + "; ".join(waiting[:5])}
        return {"status": "stage-ready", "stage": stage, "calls": calls[:limit],
                **({"waiting": waiting} if waiting else {}), **({"blockers": blockers} if blockers else {})}
    return {"status": "done", "stage": "integrate",
            "reason": f"every stage is complete; the run's work is on branch {run['branch']}"}
