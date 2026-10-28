"""Project workflows: config -> lint -> the cos stage loop, and the boundaries it must keep.

The loop under test is the one the coordinator runs: cos.run hands back a `<mode>.<endpoint>` call,
the coordinator drives that call itself, and cos.next records it and returns the next stage. Nothing
recurses into the dispatcher, so a stage's own grants, review and gates stay its own.
"""
import json

from helpers import KIT, clock, cleanup, project, system, tmpdir

from bay import dispatch, lint, registry, workflows as wfmod
from bay.adapters import get
from bay.model import Kit

MORNING = {
    "workflows": {
        "morning": {
            "description": "refresh the feed, then digest it",
            "in": {"type": "object", "properties": {"lookback": {"type": "string"}}},
            "steps": [
                {"id": "sync", "call": "feed-briefing.sync", "with": {"lookback": "$in.lookback"}},
                {"id": "ship", "gate": "send the digest?"},
                {"id": "prune", "call": "feed-briefing.prune", "when": "$steps.sync.added"},
            ],
        }
    }
}


def _d(cfg=None):
    p = project(cfg or MORNING)
    return dispatch.Dispatcher(system(p), p, clock=clock), p


# --------------------------------------------------------------------- loading and lint
def test_loads_stages_and_kinds():
    p = project(MORNING)
    wfs = wfmod.load(Kit(KIT, p))
    assert list(wfs) == ["morning"]
    assert [(s.id, s.kind) for s in wfs["morning"].stages] == \
        [("sync", "call"), ("ship", "gate"), ("prune", "call")]
    cleanup(p)


def test_effects_are_the_union_of_the_endpoints_called():
    p = project(MORNING)
    s = system(p)
    eff = wfmod.effects(s, wfmod.load(s.kit)["morning"])
    assert eff == ["read", "write", "network", "spend", "delete"]     # sync + prune, declared order
    cleanup(p)


def test_lint_rejects_unknown_target():
    cfg = {"workflows": {"w": {"steps": [{"id": "a", "call": "nope.sync"}]}}}
    p = project(cfg)
    s = system(p)
    probs = wfmod.target_problems(s.kit, s)
    assert any("cannot call 'nope.sync'" in x and "unknown mode" in x for x in probs), probs
    cleanup(p)


def test_lint_rejects_unknown_endpoint_on_a_real_mode():
    p = project({"workflows": {"w": {"steps": [{"id": "a", "call": "feed-briefing.nope"}]}}})
    s = system(p)
    assert any("has no endpoint 'nope'" in x for x in wfmod.target_problems(s.kit, s))
    cleanup(p)


def test_lint_rejects_with_that_does_not_match_the_input_schema():
    p = project({"workflows": {"w": {"steps": [
        {"id": "a", "call": "feed-briefing.sync", "with": {"lookbac": "1d"}}]}}})
    s = system(p)
    probs = wfmod.target_problems(s.kit, s)
    assert any("does not match feed-briefing.sync input" in x for x in probs), probs
    cleanup(p)


def test_lint_allows_a_required_field_that_arrives_from_an_earlier_stage():
    """`required` is dropped for the literal check: the value shows up at run time."""
    p = project({"workflows": {"w": {"steps": [
        {"id": "a", "call": "feed-briefing.sync"},
        {"id": "b", "call": "feed-briefing.ask", "with": {"question": "$steps.a.added"}}]}}})
    s = system(p)
    assert wfmod.target_problems(s.kit, s) == []
    cleanup(p)


def test_lint_rejects_forward_and_self_references():
    p = project({"workflows": {"w": {"steps": [
        {"id": "a", "call": "feed-briefing.sync", "with": {"lookback": "$steps.b.x"}},
        {"id": "b", "call": "feed-briefing.sync", "with": {"lookback": "$steps.b.x"}}]}}})
    probs = wfmod.structure_problems(Kit(KIT, p))
    assert any("runs later" in x for x in probs), probs
    assert any("refers to its own stage" in x for x in probs), probs
    cleanup(p)


def test_lint_rejects_reading_a_gate_and_an_undeclared_input():
    p = project({"workflows": {"w": {
        "in": {"type": "object", "properties": {"only": {"type": "string"}}},
        "steps": [
            {"id": "g", "gate": "ok?"},
            {"id": "a", "call": "feed-briefing.sync", "with": {"lookback": "$steps.g.approved"}},
            {"id": "b", "call": "feed-briefing.sync", "with": {"lookback": "$in.nope"}}]}}})
    probs = wfmod.structure_problems(Kit(KIT, p))
    assert any("is an approval gate" in x for x in probs), probs
    assert any("not declared in workflows.w.in.properties" in x for x in probs), probs
    cleanup(p)


def test_lint_rejects_gates_only_and_duplicate_ids():
    p = project({"workflows": {"w": {"steps": [{"id": "g", "gate": "ok?"}, {"id": "g", "gate": "again?"}]}}})
    probs = wfmod.structure_problems(Kit(KIT, p))
    assert any("no `call` stage" in x for x in probs), probs
    assert any("duplicate stage id 'g'" in x for x in probs), probs
    cleanup(p)


def test_bay_lint_runs_the_structural_checks():
    p = project({"workflows": {"w": {"steps": [{"id": "g", "gate": "ok?"}]}}})
    assert any("no `call` stage" in x for x in lint.run(kit=Kit(KIT, p)))
    cleanup(p)


# --------------------------------------------------------------------- the stage loop
def test_run_hands_back_a_call_and_does_not_execute_it():
    d, p = _d()
    out = d.call("cos.run", {"workflow": "morning", "input": {"lookback": "1d"}})
    assert out["status"] == "done"                      # cos.run itself is one code step
    stage = out["output"]
    assert stage["status"] == "stage-ready" and stage["stage"] == "sync"
    assert stage["nextCall"] == {"target": "feed-briefing.sync", "input": {"lookback": "1d"}}
    # the stage endpoint never ran: no call for it exists
    assert not list((p / ".agentbay/calls").glob("*")) or \
        all(json.loads(f.read_text())["target"].startswith("cos.") for f in (p / ".agentbay/calls").glob("*.json"))
    cleanup(p)


def test_next_records_output_and_later_stages_read_it():
    d, p = _d()
    run = d.call("cos.run", {"workflow": "morning", "input": {"lookback": "1d"}})["output"]
    rid = run["runId"]
    # stage 'sync' finished; the gate comes next
    gate = d.call("cos.next", {"runId": rid, "callId": "C-x", "status": "done",
                               "output": {"added": 3}})["output"]
    assert gate["status"] == "awaiting-approval" and gate["gate"] == "send the digest?"
    # a gate is not passable through cos.next
    st = d.call("cos.next", {"runId": rid})
    assert st["status"] == "failed" and "bay approve" in st["error"]
    # the user passes it; `prune` then runs because $steps.sync.added was truthy
    after = d.run_capability("cos", "workflow.run/v1.approve", {"runId": rid, "approved": True, "by": "user@tty"})
    assert after["status"] == "stage-ready" and after["nextCall"]["target"] == "feed-briefing.prune"
    cleanup(p)


def test_falsy_when_skips_the_stage_and_the_run_ends():
    d, p = _d()
    rid = d.call("cos.run", {"workflow": "morning", "input": {"lookback": "1d"}})["output"]["runId"]
    d.call("cos.next", {"runId": rid, "callId": "C-x", "status": "done", "output": {"added": 0}})
    out = d.run_capability("cos", "workflow.run/v1.approve", {"runId": rid, "approved": True})
    assert out["status"] == "done" and out["skipped"] == ["prune"]
    cleanup(p)


def test_a_rejected_gate_blocks_the_run():
    d, p = _d()
    rid = d.call("cos.run", {"workflow": "morning", "input": {"lookback": "1d"}})["output"]["runId"]
    d.call("cos.next", {"runId": rid, "callId": "C-x", "status": "done", "output": {"added": 1}})
    out = d.run_capability("cos", "workflow.run/v1.approve",
                           {"runId": rid, "approved": False, "by": "user@tty", "reason": "not today"})
    assert out["status"] == "blocked" and out["reason"] == "not today"
    cleanup(p)


def test_a_failed_stage_ends_the_run_naming_the_stage():
    d, p = _d()
    rid = d.call("cos.run", {"workflow": "morning", "input": {"lookback": "1d"}})["output"]["runId"]
    out = d.call("cos.next", {"runId": rid, "callId": "C-y", "status": "failed"})["output"]
    assert out["status"] == "failed" and "sync" in out["reason"] and "C-y" in out["reason"]
    cleanup(p)


def test_status_reports_stages_without_endpoint_output():
    d, p = _d()
    rid = d.call("cos.run", {"workflow": "morning", "input": {"lookback": "1d"}})["output"]["runId"]
    d.call("cos.next", {"runId": rid, "callId": "C-x", "status": "done", "output": {"added": 3, "secretish": "x"}})
    runs = d.call("cos.status", {"runId": rid})["output"]["runs"]
    assert len(runs) == 1 and runs[0]["status"] == "awaiting-approval"
    assert [s["state"] for s in runs[0]["stages"]] == ["completed", "running", "pending"]
    assert runs[0]["stages"][0]["callId"] == "C-x"
    assert "results" not in json.dumps(runs[0]) and "secretish" not in json.dumps(runs[0])
    cleanup(p)


def test_unknown_workflow_and_unknown_run_fail_with_what_exists():
    d, p = _d()
    st = d.call("cos.run", {"workflow": "nope"})
    assert st["status"] == "failed" and "morning" in st["error"]
    st = d.call("cos.next", {"runId": "W-20261027-aaaaaa"})
    assert st["status"] == "failed" and "unknown workflow run" in st["error"]
    cleanup(p)


def test_editing_the_workflow_under_a_live_run_fails_loudly():
    import yaml
    d, p = _d()
    rid = d.call("cos.run", {"workflow": "morning", "input": {"lookback": "1d"}})["output"]["runId"]
    cfg = yaml.safe_load((p / "agentbay.config.yaml").read_text())
    cfg["workflows"]["morning"]["steps"] = [{"id": "other", "call": "feed-briefing.sync"}]
    (p / "agentbay.config.yaml").write_text(yaml.safe_dump(cfg))
    d2 = dispatch.Dispatcher(system(p), p, clock=clock)
    out = d2.call("cos.next", {"runId": rid, "callId": "C-x", "status": "done", "output": {"added": 1}})
    # the call succeeds: it correctly reports that the *run* failed
    assert out["status"] == "done"
    assert out["output"]["status"] == "failed" and "no longer in workflows.morning" in out["output"]["reason"]
    cleanup(p)


# --------------------------------------------------------------------- registry
def test_registry_publishes_resolved_schemas_and_workflows():
    p = project(MORNING)
    s = system(p)
    get("claude-code").build(s, p, KIT)
    cat = registry.load(p)
    ep = next(e for m in cat["modes"] for e in m["endpoints"] if e["name"] == "feed-briefing.sync")
    assert ep["inSchema"]["type"] == "object" and "lookback" in ep["inSchema"]["properties"]
    assert "$ref" not in json.dumps(ep["inSchema"])                 # refs are inlined for the reader
    assert ep["needs"] and "constraints" in ep
    wf = cat["workflows"]["morning"]
    assert wf["effects"] == ["read", "write", "network", "spend", "delete"]
    assert [x["id"] for x in wf["stages"]] == ["sync", "ship", "prune"]
    cos = next(m for m in cat["modes"] if m["name"] == "cos")
    assert sorted(e["name"] for e in cos["endpoints"]) == ["cos.next", "cos.run", "cos.status"]
    cleanup(p)


# --------------------------------------------------------------------- the gate is the user's
def test_bay_approve_on_a_workflow_run_needs_a_terminal():
    """`bay approve W-...` routes to the workflow runner, and refuses without a TTY exactly as a call's
    gate does: no agent and no permission mode can pass a gate."""
    import subprocess
    import sys as _sys
    d, p = _d()
    rid = d.call("cos.run", {"workflow": "morning", "input": {"lookback": "1d"}})["output"]["runId"]
    d.call("cos.next", {"runId": rid, "callId": "C-x", "status": "done", "output": {"added": 1}})
    r = subprocess.run([_sys.executable, str(KIT / "bay/cli.py"), "approve", rid, "--project", str(p)],
                       capture_output=True, text=True, input="yes\n")
    assert r.returncode != 0 and "interactive terminal" in r.stderr
    # the run is untouched
    assert d.call("cos.status", {"runId": rid})["output"]["runs"][0]["status"] == "awaiting-approval"
    cleanup(p)


def test_lint_catches_a_dollar_value_that_is_not_a_reference():
    """substitute() drops any `$...` it does not recognise, so the endpoint would silently receive
    nothing for that key. Lint says so rather than letting the stage run short an argument."""
    p = project({"workflows": {"w": {"steps": [
        {"id": "a", "call": "feed-briefing.sync", "with": {"lookback": "$5.00"}}]}}})
    probs = wfmod.structure_problems(Kit(KIT, p))
    assert any("'$5.00'" in x and "would be dropped" in x for x in probs), probs
    cleanup(p)
