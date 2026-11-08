"""factory-store: factory.runs/v1 and factory.slices/v1. The run's record, its stage cursor and its slices."""
from __future__ import annotations

import json
import secrets as _rand
from pathlib import Path
from typing import Any

import yaml

from bay.connect import ConnectorError

from . import pipeline, slicing

STAGES = ("spec", "plan", "approve", "slice", "build", "audit", "fix", "integrate")
OPEN = ("stage-ready", "waiting")


class FactoryStore:
    def __init__(self, ctx: Any) -> None:
        self.ctx = ctx
        self.dir = Path(ctx.data_dir)
        self.dirs = [Path(d) for d in (ctx.settings.get("modeDirs") or [])]

    def open(self, goal: str, requirements: str | None = None, language: str | None = None) -> dict[str, Any]:
        name = language or str(self._setting("language"))
        profile = self._profile(name)
        run_id = f"F-{self.ctx.now():%Y%m%d}-{_rand.token_hex(3)}"
        run = {
            "runId": run_id, "goal": goal, "requirements": requirements, "status": "stage-ready",
            "startedAt": self.ctx.now().isoformat(timespec="seconds"), "seq": 0,
            "language": profile, "lenses": list(self._setting("reviewers")),
            "constraints": dict(self._setting("constraints") or {}),
            "pipeline": [dict(e) for e in self._setting("pipeline")],
            "worktreeRoot": str(self._setting("worktreeRoot")),
            "branch": f"{self._setting('branchPrefix')}{run_id}/integration",
            "slices": [], "waves": [], "records": [],
        }
        self._check_pipeline(run)
        return self._save(run)

    def stages(self, runId: str) -> dict[str, Any]:
        return self._state(self._load(runId))

    def record(self, runId: str, stage: str, status: str, sliceId: str | None = None, lens: str | None = None,
               summary: str = "", artifacts: list[str] | None = None, artifact: str | None = None,
               approved: bool | None = None, by: str | None = None) -> dict[str, Any]:
        run = self._load(runId)
        if stage not in STAGES:
            raise ConnectorError(f"unknown stage '{stage}' (have: {', '.join(STAGES)})")
        if sliceId is not None and not any(s["id"] == sliceId for s in run["slices"]):
            raise ConnectorError(f"run {runId} has no slice '{sliceId}'; its slices are "
                                 f"{', '.join(s['id'] for s in run['slices']) or 'not proposed yet'}")
        run["seq"] += 1
        files = list(artifacts or ([artifact] if artifact else []))
        run["records"].append({"seq": run["seq"], "stage": stage, "status": status, "at": self._now(),
                               **({"sliceId": sliceId} if sliceId else {}), **({"lens": lens} if lens else {}),
                               "summary": summary, "artifacts": files,
                               **({"approved": approved} if approved is not None else {}),
                               **({"by": by} if by else {})})
        self._mark(run, stage, status, sliceId)
        return self._save(run)

    def status(self, runId: str | None = None, open: bool = False) -> dict[str, Any]:
        runs = [self._load(runId)] if runId else [json.loads(p.read_text()) for p in sorted(self.dir.glob("F-*.json"))]
        if open:
            runs = [r for r in runs if r["status"] in OPEN]
        return {"runs": [self._report(r) for r in sorted(runs, key=lambda r: r["startedAt"], reverse=True)]}

    def propose(self, runId: str, slices: list[dict[str, Any]]) -> dict[str, Any]:
        run = self._load(runId)
        rejected, waves = slicing.validate(slices, run["constraints"])
        out: dict[str, Any] = {"accepted": [], "rejected": rejected, "waves": waves,
                               "constraints": run["constraints"]}
        if rejected:
            named = "; ".join(f"{r['id']}: {r['problems'][0]}" for r in rejected[:3])
            out["stopped"] = (f"{len(rejected)} of {len(slices)} slices break the run's constraints ({named}). "
                              f"Nothing was stored: fix the slicing and call factory.slice again.")
            return out
        run["slices"] = [{**s, "state": "planned", "rounds": 0, "findings": []} for s in slices]
        run["waves"] = waves
        out["accepted"] = [s["id"] for s in run["slices"]]
        self._save(run)
        return out

    def brief(self, runId: str, sliceId: str, lens: str | None = None, kind: str | None = None) -> dict[str, Any]:
        run = self._load(runId)
        s = self._slice(run, sliceId)
        ln = self._lens(run, lens) if lens else None
        out: dict[str, Any] = {
            "runId": runId, "slice": {k: v for k, v in s.items() if k != "findings"},
            "acceptance": list(s["acceptance"]), "interfaces": list(s.get("interfaces") or []),
            "paths": list(s["paths"]), "language": str(run["language"].get("name") or ""),
            "practices": list(run["language"].get("practices") or []),
            "commands": dict(run["language"].get("commands") or {}), "constraints": run["constraints"],
            "kind": kind or ("audit" if lens else "build"),
            "findings": [f for f in s["findings"] if f.get("open")],
            "rounds": len(pipeline.records(run, "fix", sliceId)),
        }
        if ln is not None:
            out["lens"] = ln
        return out

    def get(self, runId: str, sliceId: str | None = None) -> dict[str, Any]:
        run = self._load(runId)
        slices = [self._slice(run, sliceId)] if sliceId else run["slices"]
        return {"slices": slices, "waves": run["waves"]}

    def findings(self, runId: str, sliceId: str, lens: str, items: list[dict[str, Any]]) -> dict[str, Any]:
        run = self._load(runId)
        s = self._slice(run, sliceId)
        ln = self._lens(run, lens)
        missing = slicing.missing_verdicts(s, ln, items)
        if missing:
            return {"runId": runId, "sliceId": sliceId, "lens": lens, "open": [], "blocking": 0, "recorded": 0,
                    "stopped": (f"the {lens} verdicts miss {', '.join(missing)}; the lens reports pass, fail or n/a "
                                f"for every acceptance criterion and every check of the lens, with evidence")}
        round_ = len(pipeline.records(run, "fix", sliceId))
        s["findings"] = [f for f in s["findings"] if f["lens"] != lens] + slicing.to_findings(s, ln, items, round_)
        s["state"] = "blocked" if any(f["blocking"] for f in s["findings"] if f["open"]) else "reviewed"
        self._save(run)
        open_ = [f for f in s["findings"] if f["open"]]
        return {"runId": runId, "sliceId": sliceId, "lens": lens, "open": open_,
                "blocking": sum(1 for f in open_ if f["blocking"]), "recorded": len(items)}

    def _mark(self, run: dict[str, Any], stage: str, status: str, slice_id: str | None) -> None:
        if slice_id is None:
            return
        items: list[dict[str, Any]] = run["slices"]
        s = next((x for x in items if x["id"] == slice_id), None)
        if s is None:
            return
        if stage == "build" and status == "done":
            s["state"] = "built"
        if stage == "fix":
            s["rounds"] = len(pipeline.records(run, "fix", slice_id))
            s["state"] = "built" if status == "done" else "blocked"
        if stage == "integrate" and status == "done":
            s["state"] = "integrated"

    def _state(self, run: dict[str, Any]) -> dict[str, Any]:
        p = pipeline.plan(run)
        run["status"] = p["status"]
        if p["status"] not in OPEN and not run.get("endedAt"):
            run["endedAt"] = self._now()
        return {"runId": run["runId"], "status": p["status"], "stage": p["stage"], "language": run["language"],
                "lenses": run["lenses"], "constraints": run["constraints"], "stages": self._stage_rows(run),
                **{k: v for k, v in p.items() if k in ("calls", "waiting", "blockers", "reason")}}

    @staticmethod
    def _stage_rows(run: dict[str, Any]) -> list[dict[str, Any]]:
        rows = []
        for e in run["pipeline"]:
            recs = pipeline.records(run, e["stage"])
            rows.append({"stage": e["stage"], "enabled": e.get("enabled", True), "parallel": e.get("parallel", 1),
                         "records": len(recs), "failed": sum(1 for r in recs if r["status"] != "done")})
        return rows

    def _report(self, run: dict[str, Any]) -> dict[str, Any]:
        return {"runId": run["runId"], "goal": run["goal"], "status": run["status"], "branch": run["branch"],
                "startedAt": run["startedAt"], **({"endedAt": run["endedAt"]} if run.get("endedAt") else {}),
                "language": run["language"].get("name"), "stages": self._stage_rows(run),
                "slices": [{"id": s["id"], "title": s.get("title") or s["outcome"][:60], "state": s["state"],
                            "rounds": s["rounds"],
                            "open": sum(1 for f in s["findings"] if f.get("open")),
                            "blocking": sum(1 for f in s["findings"] if f.get("open") and f.get("blocking"))}
                           for s in run["slices"]],
                "records": run["records"][-20:]}

    def _check_pipeline(self, run: dict[str, Any]) -> None:
        bad = [e["stage"] for e in run["pipeline"] if e["stage"] not in STAGES]
        if bad:
            raise ConnectorError(f"modes.factory.pipeline names unknown stage(s) {', '.join(bad)}; the stages are "
                                 f"{', '.join(STAGES)}")
        ids = [ln["id"] for ln in run["lenses"]]
        if len(set(ids)) != len(ids):
            raise ConnectorError("modes.factory.reviewers has two lenses with the same id")
        for e in run["pipeline"]:
            for want in e.get("lenses") or []:
                if want not in ids:
                    raise ConnectorError(f"modes.factory.pipeline stage {e['stage']} names lens '{want}', which "
                                         f"reviewers does not define (have: {', '.join(ids)})")

    def _profile(self, name: str) -> dict[str, Any]:
        for d in self.dirs:
            p = d / "languages" / f"{name}.yaml"
            if p.is_file():
                doc = yaml.safe_load(p.read_text(encoding="utf-8")) or {}
                doc["name"] = doc.get("name") or name
                return dict(doc)
        have = sorted(q.stem for d in self.dirs for q in (d / "languages").glob("*.yaml"))
        raise ConnectorError(f"no language profile '{name}' (have: {', '.join(have) or 'none'}); add "
                             f"languages/{name}.yaml to the factory component or set modes.factory.language")

    def _setting(self, key: str) -> Any:
        """A setting, else the default in the mode's config schema, so the connector and `bay config` agree."""
        prop = self._schema(key)
        value = self.ctx.settings.get(key, prop.get("default"))
        if isinstance(value, dict) and prop.get("type") == "object":
            value = {**{k: v["default"] for k, v in (prop.get("properties") or {}).items() if "default" in v},
                     **value}
        if value is None:
            raise ConnectorError(f"setting modes.factory.{key} has no value and no default")
        return value

    def _schema(self, key: str) -> dict[str, Any]:
        for d in self.dirs:
            p = d / "config.schema.json"
            if p.is_file():
                return dict((json.loads(p.read_text(encoding="utf-8")).get("properties") or {}).get(key) or {})
        return {}

    def _now(self) -> str:
        return str(self.ctx.now().isoformat(timespec="seconds"))

    @staticmethod
    def _slice(run: dict[str, Any], slice_id: str) -> dict[str, Any]:
        items: list[dict[str, Any]] = run["slices"]
        s = next((x for x in items if x["id"] == slice_id), None)
        if s is None:
            raise ConnectorError(f"run {run['runId']} has no slice '{slice_id}'; its slices are "
                                 f"{', '.join(x['id'] for x in items) or 'not proposed yet'}")
        return s

    @staticmethod
    def _lens(run: dict[str, Any], lens: str | None) -> dict[str, Any]:
        lenses: list[dict[str, Any]] = run["lenses"]
        ln = next((x for x in lenses if x["id"] == lens), None)
        if ln is None:
            raise ConnectorError(f"unknown review lens '{lens}'; modes.factory.reviewers defines "
                                 f"{', '.join(x['id'] for x in lenses)}")
        return ln

    def _save(self, run: dict[str, Any]) -> dict[str, Any]:
        out = self._state(run)
        self.dir.mkdir(parents=True, exist_ok=True)
        (self.dir / f"{run['runId']}.json").write_text(json.dumps(run, indent=2, ensure_ascii=False) + "\n")
        return out

    def _load(self, run_id: str) -> dict[str, Any]:
        p = self.dir / f"{run_id}.json"
        if not p.exists():
            raise ConnectorError(f"unknown factory run '{run_id}' (see `bay call factory.status '{{}}'`)")
        return dict(json.loads(p.read_text()))


def create(ctx: Any) -> FactoryStore:
    return FactoryStore(ctx)
