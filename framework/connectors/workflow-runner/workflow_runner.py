"""workflow-runner: workflow.run/v1. The stage cursor for project workflows.

What it does: reads the workflow from agentbay.config.yaml, keeps one JSON file per run under
ctx.data_dir, and answers each call with the next stage to run.

What it deliberately does not do: run the stage. `start`, `next` and `approve` return the
`<mode>.<endpoint>` call the coordinator is to make. The coordinator drives that call through the
ordinary dispatcher loop, so the stage keeps its own grants, effects, budget, review and gates, and
nothing recurses. This connector cannot call an endpoint, spawn an agent or read connector data.
"""
from __future__ import annotations

import json
import secrets as _rand
from pathlib import Path

from bay import workflows as wfmod
from bay.connect import ConnectorError
from bay.dispatch import substitute

OPEN = ("stage-ready", "awaiting-approval")
ENDED = ("done", "blocked", "failed")


class WorkflowRunner:
    def __init__(self, ctx):
        self.ctx = ctx
        self.dir = Path(ctx.data_dir)
        self.defs = wfmod.load(_kit(ctx))

    # ------------------------------------------------------------ endpoints
    def start(self, workflow: str, input: dict | None = None) -> dict:
        wf = self.defs.get(workflow)
        if wf is None:
            raise ConnectorError(f"unknown workflow '{workflow}'; agentbay.config.yaml defines "
                                 f"{', '.join(self.defs) or 'none'}")
        run = {
            "runId": f"W-{self.ctx.now():%Y%m%d}-{_rand.token_hex(3)}",
            "workflow": workflow, "status": "stage-ready", "startedAt": self.ctx.now().isoformat(timespec="seconds"),
            "cursor": 0, "input": dict(input or {}), "results": {},
            "stages": [{"id": s.id, "kind": s.kind, **({"call": s.call} if s.call else {}), "state": "pending"}
                       for s in wf.stages],
        }
        return self._advance(run, wf)

    def next(self, runId: str, callId: str = None, output: dict | None = None, status: str = None) -> dict:
        run = self._load(runId)
        wf = self._def(run)
        if run["status"] in ENDED:
            raise ConnectorError(f"run {runId} is {run['status']}; nothing left to run")
        if run["status"] == "awaiting-approval":
            raise ConnectorError(f"run {runId} waits at the approval gate '{run['stages'][run['cursor']]['id']}'; "
                                 f"only `bay approve {runId}` passes it, and no agent can")
        cur = run["stages"][run["cursor"]]
        rec = {"state": "completed", "status": status or "done", **({"callId": callId} if callId else {})}
        if status in ("blocked", "failed"):
            rec["state"] = status
        cur.update(rec)
        if output is not None:
            run["results"][cur["id"]] = output
        if rec["state"] in ("blocked", "failed"):
            run["status"] = rec["state"]
            run["reason"] = (f"stage {cur['id']} ({cur.get('call')}) ended {rec['state']}"
                             + (f"; see `bay show {callId}`" if callId else ""))
            return self._finish(run)
        run["cursor"] += 1
        return self._advance(run, wf)

    def approve(self, runId: str, approved: bool, by: str = "user", reason: str = "") -> dict:
        run = self._load(runId)
        wf = self._def(run)
        if run["status"] != "awaiting-approval":
            raise ConnectorError(f"run {runId} is {run['status']}, not awaiting approval")
        cur = run["stages"][run["cursor"]]
        if not approved:
            cur.update({"state": "blocked", "status": "rejected"})
            run["status"] = "blocked"
            run["reason"] = reason or f"gate '{cur['id']}' rejected by {by}"
            return self._finish(run)
        cur.update({"state": "completed", "status": "approved"})
        run["results"][cur["id"]] = {"approved": True, "by": by}
        run["cursor"] += 1
        return self._advance(run, wf)

    def show(self, runId: str = None, open: bool = False) -> dict:
        if runId:
            return {"runs": [_public(self._load(runId))]}
        runs = [json.loads(p.read_text()) for p in sorted(self.dir.glob("W-*.json"))]
        if open:
            runs = [r for r in runs if r["status"] in OPEN]
        return {"runs": [_public(r) for r in sorted(runs, key=lambda r: r["startedAt"], reverse=True)]}

    # ------------------------------------------------------------ engine
    def _advance(self, run: dict, wf) -> dict:
        """Walk stages until one needs the coordinator (a call), needs the user (a gate), or the run ends."""
        skipped: list[str] = []
        while run["cursor"] < len(run["stages"]):
            rec = run["stages"][run["cursor"]]
            stage = wf.stage(rec["id"])
            if stage is None:                   # the workflow was edited under a live run
                run["status"] = "failed"
                run["reason"] = (f"stage '{rec['id']}' is no longer in workflows.{run['workflow']}; "
                                 f"the workflow changed after this run started. Start a new run.")
                return self._finish(run)
            if stage.when and not substitute({"v": stage.when}, run["input"], run["results"], {}).get("v"):
                rec["state"] = "skipped"
                skipped.append(rec["id"])
                run["cursor"] += 1
                continue
            if stage.kind == "gate":
                rec["state"] = "running"
                run["status"] = "awaiting-approval"
                return self._save(run, {"gate": stage.gate, "stage": rec["id"],
                                        **({"skipped": skipped} if skipped else {})})
            rec["state"] = "running"
            run["status"] = "stage-ready"
            args = substitute(stage.with_, run["input"], run["results"], {})
            return self._save(run, {"stage": rec["id"], "nextCall": {"target": stage.call, "input": args},
                                    **({"skipped": skipped} if skipped else {})})
        run["status"] = "done"
        return self._finish(run, {"skipped": skipped} if skipped else {})

    def _finish(self, run: dict, extra: dict | None = None) -> dict:
        run["endedAt"] = self.ctx.now().isoformat(timespec="seconds")
        return self._save(run, {**(extra or {}), "results": run["results"],
                                **({"reason": run["reason"]} if run.get("reason") else {})})

    def _save(self, run: dict, extra: dict) -> dict:
        self.dir.mkdir(parents=True, exist_ok=True)
        (self.dir / f"{run['runId']}.json").write_text(json.dumps(run, indent=2, ensure_ascii=False) + "\n")
        return {"runId": run["runId"], "workflow": run["workflow"], "status": run["status"], **extra}

    def _load(self, run_id: str) -> dict:
        p = self.dir / f"{run_id}.json"
        if not p.exists():
            raise ConnectorError(f"unknown workflow run '{run_id}' (see `bay call cos.status '{{}}'`)")
        return json.loads(p.read_text())

    def _def(self, run: dict):
        wf = self.defs.get(run["workflow"])
        if wf is None:
            raise ConnectorError(f"workflow '{run['workflow']}' is no longer defined in agentbay.config.yaml; "
                                 f"run {run['runId']} cannot continue")
        return wf


def _public(run: dict) -> dict:
    """A run without its per-stage outputs: show() reports progress, not endpoint data."""
    return {k: v for k, v in run.items() if k != "results"}


def _kit(ctx):
    """A Kit just for agentbay.config.yaml; no resolution, no connector reaches another."""
    from bay.model import Kit
    return Kit(ctx.kit, ctx.project)


def create(ctx):
    return WorkflowRunner(ctx)
