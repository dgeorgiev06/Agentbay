"""factory end to end on a temp project: the stages, the plan gate, the fan-out, a failed lens, a fix and the merge."""
from __future__ import annotations

import yaml
from helpers import clock, no_code_checks, system, tmpdir

from bay import dispatch, model

KIT = model.KIT
MODE = KIT / "components/modes/factory"
IFACE = "factory.tree/v1"


def project():
    p = tmpdir() / "proj"
    p.mkdir()
    (p / "agentbay.config.yaml").write_text(yaml.safe_dump({"apiVersion": "agentbay/v4", "offline": True}))
    (p / "docs").mkdir()
    (p / "docs" / "req.md").write_text("# Requirements\n\nExport reports as CSV.\n")
    return p


class Trees:
    """The worktree connector, played by the test: the factory's own state and stages are the real ones."""

    def __init__(self, d: dispatch.Dispatcher):
        self.merged: list[str] = []
        self.failing: set[str] = set()
        real = d._invoke

        def invoke(env, conn, iface, ep, args, **kw):
            if iface != IFACE:
                return real(env, conn, iface, ep, args, **kw)
            return getattr(self, ep)(args)
        d._invoke = invoke

    def open(self, a: dict) -> dict:
        return {"runId": a["runId"], "sliceId": a["sliceId"], "base": f"factory/{a['runId']}/integration",
                "branch": f"factory/{a['runId']}/{a['sliceId']}", "created": True,
                "path": f".factory/trees/{a['runId']}/{a['sliceId']}", "head": "abc1234"}

    def checks(self, a: dict) -> dict:
        ok = a["sliceId"] not in self.failing
        ran = [{"name": "test", "command": "python3 -m pytest -q", "ok": ok, "exitCode": 0 if ok else 1, "tail": "x"}]
        out = {"runId": a["runId"], "sliceId": a["sliceId"], "ran": ran, "failed": [] if ok else ["test"],
               "changedFiles": ["app/a.py"], "summary": "1 check", "language": a.get("language", "")}
        if not ok:
            out["stopped"] = "test failed in the slice's worktree"
        return {k: v for k, v in out.items() if k != "language"}

    def integrate(self, a: dict) -> dict:
        self.merged.append(a["sliceId"])
        return {"runId": a["runId"], "sliceId": a["sliceId"], "merged": True,
                "branch": f"factory/{a['runId']}/integration", "commit": "def5678", "conflicts": [],
                "summary": f"{a['sliceId']} is on the integration branch"}


def caller():
    p = project()
    d = dispatch.Dispatcher(system(p), p, clock=clock)
    no_code_checks(d)
    return d, p, Trees(d)


def agent(d, target: str, inp: dict, step: str, output: dict) -> dict:
    """One call with one role step: the step plan is checked, then the role's output is submitted."""
    r = d.call(target, inp)
    assert r["status"] == "needs-agent" and r["next"]["step"] == step, r
    return d.submit(r["callId"], step, output)


SPEC = {"status": "done", "summary": "two outcomes", "artifacts": ["docs/factory/spec.md"],
        "outcomes": [{"id": "O-1", "statement": "a user exports CSV", "acceptance": ["the file downloads"],
                      "source": "docs/req.md:3"}], "questions": []}
PLAN = {"status": "done", "summary": "two components", "artifacts": ["docs/factory/plan.md"],
        "components": [{"name": "exporter", "responsibility": "writes CSV", "publishes": ["export.rows"]}],
        "order": ["exporter"]}


def slices(*ids: str) -> dict:
    out = []
    for i, sid in enumerate(ids, 1):
        out.append({"id": sid, "title": f"slice {i}", "outcome": f"a user can do thing {i}",
                    "paths": [f"app/{sid}.py"],
                    "acceptance": [{"id": "A-1", "level": "must", "statement": f"thing {i} works",
                                    "check": "python3 -m pytest -q"}]})
    return {"status": "done", "summary": "one slice per outcome", "slices": out}


def verdict(brief: dict, fail: bool = False) -> dict:
    """A verdict for every id the lens has to cover: the slice's criteria and the lens's own checks."""
    ids = [a["id"] for a in brief["acceptance"]] + [c["id"] for c in brief["lens"]["checks"]]
    items = [{"id": i, "verdict": "pass", "evidence": "app/a.py:1"} for i in ids]
    if fail:
        items[0] = {"id": ids[0], "verdict": "fail", "evidence": "app/a.py:1 returns None",
                    "severity": "blocker", "suggestion": "return the rows"}
    return {"status": "done", "summary": "one slice judged", "items": items}


def judged(d, call: dict, fail: bool = False) -> dict:
    r = d.call("factory.audit", call["input"])
    assert r["next"]["step"] == "judge" and r["next"]["previous"]["brief"]["lens"]["id"] == call["input"]["lens"]
    return d.submit(r["callId"], "judge", verdict(r["next"]["previous"]["brief"], fail))


def start(d) -> str:
    r = d.call("factory.start", {"goal": "Export reports as CSV", "requirements": "docs/req.md"})
    assert r["status"] == "done", r
    assert r["output"]["stage"] == "spec" and r["output"]["language"]["name"] == "python"
    return r["output"]["runId"]


def next_calls(d, run_id: str) -> tuple[str, list[dict]]:
    r = d.call("factory.next", {"runId": run_id})
    assert r["status"] == "done", r
    return r["output"]["stage"], r["output"].get("calls") or []


def through_the_gate(d, p, run_id: str) -> None:
    agent(d, "factory.spec", {"runId": run_id}, "draft", SPEC)
    agent(d, "factory.plan", {"runId": run_id}, "draft", PLAN)
    stage, calls = next_calls(d, run_id)
    assert stage == "approve" and calls[0]["input"]["plan"] == "docs/factory/plan.md"
    (p / "docs" / "factory").mkdir(parents=True, exist_ok=True)
    (p / "docs" / "factory" / "plan.md").write_text("# plan\n")
    r = d.call("factory.approve", calls[0]["input"])
    assert r["status"] == "awaiting-approval" and "Build from this technical plan?" in r["next"]["gate"]
    r = d.approve(r["callId"], True)
    assert r["status"] == "done", r


def test_a_run_walks_the_stages_from_requirements_to_an_integrated_slice():
    d, p, trees = caller()
    run_id = start(d)
    through_the_gate(d, p, run_id)
    r = agent(d, "factory.slice", {"runId": run_id}, "propose", slices("S-1"))
    assert r["status"] == "done" and r["output"]["stage"] == "build"
    rows = d.call("factory.status", {"runId": run_id})["output"]["runs"][0]
    assert [s["id"] for s in rows["slices"]] == ["S-1"] and rows["slices"][0]["state"] == "planned"

    stage, calls = next_calls(d, run_id)
    assert stage == "build" and calls == [{"target": "factory.build", "label": "build S-1",
                                           "input": {"runId": run_id, "sliceId": "S-1"}}]
    r = d.call("factory.build", calls[0]["input"])
    assert r["next"]["step"] == "implement"
    brief = r["next"]["previous"]["brief"]
    assert brief["slice"]["id"] == "S-1" and brief["paths"] == ["app/S-1.py"]
    assert brief["commands"]["test"] == ["python3", "-m", "pytest", "-q"]
    assert r["next"]["previous"]["tree"]["path"] == f".factory/trees/{run_id}/S-1"
    r = d.submit(r["callId"], "implement", {"status": "done", "summary": "wrote the exporter",
                                            "artifacts": ["app/S-1.py"], "met": ["A-1"]})
    assert r["status"] == "done", r

    stage, calls = next_calls(d, run_id)
    assert stage == "audit"
    lenses = [c["input"]["lens"] for c in calls]
    assert lenses == ["correctness", "structure", "quality", "performance", "security"]
    for call in calls:
        assert judged(d, call)["status"] == "done"
    row = d.call("factory.status", {"runId": run_id})["output"]["runs"][0]["slices"][0]
    assert row["open"] == 0 and row["blocking"] == 0 and row["state"] == "reviewed"

    stage, calls = next_calls(d, run_id)
    assert stage == "integrate" and calls[0]["input"]["sliceId"] == "S-1"
    r = d.call("factory.integrate", calls[0]["input"])
    assert r["status"] == "done" and trees.merged == ["S-1"]
    r = d.call("factory.next", {"runId": run_id})
    assert r["output"]["status"] == "done" and f"factory/{run_id}/integration" in r["output"]["reason"]


def test_a_blocking_verdict_sends_the_slice_to_a_fix_round_and_the_lenses_judge_it_again():
    d, p, trees = caller()
    run_id = start(d)
    through_the_gate(d, p, run_id)
    agent(d, "factory.slice", {"runId": run_id}, "propose", slices("S-1"))
    _, calls = next_calls(d, run_id)
    agent(d, "factory.build", calls[0]["input"], "implement",
          {"status": "done", "summary": "wrote it", "artifacts": ["app/S-1.py"]})
    _, calls = next_calls(d, run_id)
    for i, call in enumerate(calls):
        assert judged(d, call, fail=(i == 0))["status"] == "done"
    row = d.call("factory.status", {"runId": run_id})["output"]["runs"][0]["slices"][0]
    assert row["open"] == 1 and row["blocking"] == 1 and row["state"] == "blocked"

    stage, calls = next_calls(d, run_id)
    assert stage == "fix" and calls[0]["input"]["sliceId"] == "S-1"
    r = d.call("factory.fix", calls[0]["input"])
    findings = r["next"]["previous"]["brief"]["findings"]
    assert [f["id"] for f in findings] == ["A-1"] and findings[0]["suggestion"] == "return the rows"
    assert r["next"]["previous"]["brief"]["kind"] == "fix"
    r = d.submit(r["callId"], "fix", {"status": "done", "summary": "returns the rows now",
                                      "artifacts": ["app/S-1.py"]})
    assert r["status"] == "done", r

    stage, calls = next_calls(d, run_id)
    assert stage == "audit" and len(calls) == 5
    for call in calls:
        judged(d, call)
    assert next_calls(d, run_id)[0] == "integrate"


def test_a_slicing_that_breaks_a_constraint_is_refused_and_nothing_is_stored():
    d, p, trees = caller()
    run_id = start(d)
    through_the_gate(d, p, run_id)
    bad = slices("S-1", "S-2")
    bad["slices"][1]["paths"] = bad["slices"][0]["paths"]
    r = agent(d, "factory.slice", {"runId": run_id}, "propose", bad)
    assert r["status"] == "blocked" and "break the run's constraints" in r["stopped"]
    assert "Nothing was stored" in r["reason"] and "write the same files" in r["reason"]
    r = d.call("factory.status", {"runId": run_id})
    assert r["output"]["runs"][0]["slices"] == []
    assert next_calls(d, run_id)[0] == "slice"


def test_a_failing_check_in_the_worktree_blocks_the_build_call():
    d, p, trees = caller()
    run_id = start(d)
    through_the_gate(d, p, run_id)
    agent(d, "factory.slice", {"runId": run_id}, "propose", slices("S-1"))
    trees.failing.add("S-1")
    _, calls = next_calls(d, run_id)
    r = agent(d, "factory.build", calls[0]["input"], "implement",
              {"status": "done", "summary": "it is done, honestly", "artifacts": ["app/S-1.py"]})
    assert r["status"] == "blocked" and "test failed in the slice's worktree" in r["stopped"]
    assert next_calls(d, run_id)[0] == "build"


def test_the_status_endpoint_reports_the_run_without_running_anything():
    d, p, trees = caller()
    run_id = start(d)
    r = d.call("factory.status", {"open": True})
    assert r["status"] == "done" and r["output"]["runs"][0]["runId"] == run_id
    assert r["output"]["runs"][0]["goal"] == "Export reports as CSV"


def test_every_role_works_in_the_env_its_grants_come_from():
    sysm = system(None)
    f = sysm.modes["factory"]
    assert f.roles == {"lead": "factory-local", "analyst": "factory-design", "builder": "factory-build",
                       "reviewer": "factory-review"}
    envs = {e.name: e for e in sysm.kit.docs["Environment"].values()}
    assert envs["factory-design"].spec["fs"]["write"] == ["docs/factory"]
    assert envs["factory-build"].spec["fs"]["write"] == [".factory/trees"]
    assert "write" not in envs["factory-review"].spec["fs"]
    assert envs["factory-review"].spec["effects"] == ["read"]
    for env in ("factory-design", "factory-build", "factory-review"):
        assert not envs[env].spec.get("network", {}).get("allow")
        assert not envs[env].spec.get("secrets")
    assert set(f.features) == {"start", "next", "spec", "plan", "approve", "slice", "build", "audit", "fix",
                               "integrate", "status"}


def test_no_role_step_can_reach_a_factory_endpoint_through_a_shim():
    """The factory's state reaches a worker as the output of the code step before it, never through a shim."""
    sysm = system(None)
    for name, feat in sorted(sysm.modes["factory"].features.items()):
        assert feat.uses in (None, []), (name, feat.uses)
        for step in feat.steps:
            if step.kind == "role":
                assert step.resolved.bay_uses == [], (name, step.id, step.resolved.bay_uses)


def test_a_verdict_set_that_misses_a_lens_check_blocks_the_audit_call():
    d, p, trees = caller()
    run_id = start(d)
    through_the_gate(d, p, run_id)
    agent(d, "factory.slice", {"runId": run_id}, "propose", slices("S-1"))
    _, calls = next_calls(d, run_id)
    agent(d, "factory.build", calls[0]["input"], "implement",
          {"status": "done", "summary": "wrote it", "artifacts": ["app/S-1.py"]})
    _, calls = next_calls(d, run_id)
    r = d.call("factory.audit", calls[0]["input"])
    r = d.submit(r["callId"], "judge", {"status": "done", "summary": "half a review",
                                        "items": [{"id": "A-1", "verdict": "pass", "evidence": "app/a.py:1"}]})
    assert r["status"] == "blocked" and "miss L-1" in r["stopped"]
    row = d.call("factory.status", {"runId": run_id})["output"]["runs"][0]["slices"][0]
    assert row["open"] == 0 and row["state"] == "built"
    assert next_calls(d, run_id)[0] == "audit"
