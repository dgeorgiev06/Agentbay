"""Golden baseline of the two stage syntaxes (proposal 0008, stage 5 part A): the `when` / `with` / `gate` forms of a
mode feature's steps (schemas/mode.schema.json + model._feature_steps, run by Dispatcher._skip) and of a project
workflow's stages (schemas/config.schema.json + workflows.structure_problems, run by workflow_runner._advance), each
form with what the validator says today (accepted or the message) and, for `when`, what the runner does with it on
given data. tests/golden/stages.json was generated from the code before stage 5 unified the syntax; part E changes
only the rows its decisions D6 to D8 name. A failing compare means a behavior changed (see golden_util).

Stage ids are `a` then `b` in both syntaxes, so one list of forms serves both."""
from __future__ import annotations

import json
from types import SimpleNamespace

from golden_util import compare, normal
from helpers import KIT, cleanup, clock, edit_yaml, kit_copy, project, system

from bay import config, dispatch, model, workflows
from bay.model import Kit

WHEN_FORMS = [
    "$in.x", "!$in.x", "$in.X1", "$in.x1", "$in.1x", "$in.x-y", "$in.x.y", "$in.", "$in", "!!$in.x", "! $in.x",
    "$steps.a.x", "!$steps.a.x", "$steps.a.x.y", "$steps.a.x-y", "$steps.A.x", "$steps.a", "$steps.nope.x", "$steps.b.x",
    "$config.x", "$in.x|$in.y", "stale > 2h", "stale>2h", "stale > 2", "stale > 2x", "stale > 90m", "stale > 1w",
    "!stale > 2h", "approved $in.f", "!approved $in.f", "true", "", " $in.x", "$in.x ", "$out.x", "x",
]
GATE_WHEN_FORMS = ["$in.x", "!$in.x", "$steps.a.x", "!$steps.a.x", "$steps.nope.x", "stale > 2h"]
WITH_VALUES = {
    "in": "$in.x", "in nested": "$in.x.y", "in hyphen": "$in.x-y", "steps": "$steps.a.x", "steps nested": "$steps.a.x.y",
    "steps unknown": "$steps.nope.x", "steps self": "$steps.b.x", "steps later": "$steps.c.x", "config": "$config.x",
    "alternatives": "$in.x|$steps.a.x", "alternative bad": "$in.x|$foo", "alternative config": "$in.x|$config.y",
    "dollar word": "$foo", "dollar alone": "$", "not a reference": "price $5", "literal": "1d", "negated": "!$in.x",
    "in a list": ["$in.x", "$bogus"], "in a dict": {"k": "$in.x", "j": "$bogus"}, "number": 3, "undeclared in": "$in.zz",
}

SKIP_ROWS = [
    ("$in.x", {"x": 1}, {}), ("$in.x", {"x": 0}, {}), ("$in.x", {"x": ""}, {}), ("$in.x", {"x": []}, {}),
    ("$in.x", {"x": {"y": 1}}, {}), ("$in.x", {}, {}), ("$in.x", {"x": None}, {}), ("$in.x", {"x": False}, {}),
    ("!$in.x", {"x": 1}, {}), ("!$in.x", {"x": 0}, {}), ("!$in.x", {}, {}),
    ("$in.x.y", {"x": {"y": 1}}, {}), ("$in.x.y", {"x": {"y": 0}}, {}), ("$in.x.y", {"x": 1}, {}),
    ("$in.x-y", {"x-y": 1}, {}),
    ("$steps.a.x", {}, {"a": {"x": 1}}), ("$steps.a.x", {}, {"a": {"x": 0}}), ("$steps.a.x", {}, {"a": {"x": None}}),
    ("$steps.a.x", {}, {"a": {}}), ("$steps.a.x", {}, {}), ("!$steps.a.x", {}, {"a": {"x": 1}}),
    ("!$steps.a.x", {}, {"a": {"x": 0}}), ("!$steps.a.x", {}, {}), ("$steps.a.x.y", {}, {"a": {"x": {"y": 2}}}),
    ("$steps.a.x-y", {}, {"a": {"x-y": 2}}), ("$config.x", {}, {}), ("$in.x|$in.y", {"y": 1}, {}),
    ("$in.x|$in.y", {}, {}), ("true", {}, {}), ("x", {}, {}), ("approved $in.f", {"f": 1}, {}),
]
STALE_ROWS = [
    ("stale > 2h", {"lastSync": "2026-10-27T11:00:00+00:00"}), ("stale > 2h", {"lastSync": "2026-10-27T09:00:00+00:00"}),
    ("stale > 2h", {"lastSync": "2026-10-27T11:00:00+00:00", "stale": True}), ("stale > 2h", {}),
    ("stale>2h", {"lastSync": "2026-10-27T11:00:00+00:00"}), ("stale > 90m", {"lastSync": "2026-10-27T10:45:00+00:00"}),
    ("stale > 1w", {"lastSync": "2026-10-20T13:00:00+00:00"}), ("stale > 2x", {"lastSync": "2026-10-27T11:00:00+00:00"}),
]
ADVANCE_ROWS = [
    ("$steps.a.x", {}, {"x": 1}), ("$steps.a.x", {}, {"x": 0}), ("$steps.a.x", {}, {}), ("$steps.a.x.y", {}, {"x": {"y": 1}}),
    ("$steps.a.x-y", {}, {"x-y": 1}), ("$in.x", {"x": 1}, {}), ("$in.x", {"x": 0}, {}), ("$in.x", {}, {}),
    ("$in.x.y", {"x": {"y": 1}}, {}), ("$in.x-y", {"x-y": 1}, {}), ("!$in.x", {"x": 0}, {}), ("!$steps.a.x", {}, {"x": 0}),
    ("$config.x", {}, {}), ("stale > 2h", {}, {}), ("true", {}, {}),
]


# ------------------------------------------------------------------------------------------------ project workflows
def project_result(steps: list) -> dict:
    p = project({"workflows": {"w": {"steps": steps}}})
    try:
        try:
            kit = Kit(KIT, p)
        except config.ConfigError as e:
            return {"accepted": False, "layer": "schema", "problems": [ln.strip() for ln in str(e).splitlines()[1:]]}
        problems = workflows.structure_problems(kit)
        return {"accepted": not problems, "layer": None if not problems else "structure", "problems": problems}
    finally:
        cleanup(p)


def call(sid: str, **kw) -> dict:
    return {"id": sid, "call": "feed-briefing.sync", **kw}


def project_tables() -> dict:
    when = {f: project_result([call("a"), call("b", when=f)]) for f in WHEN_FORMS}
    gate = {f: project_result([call("a"), {"id": "b", "gate": "ok?", "when": f}, call("c")]) for f in GATE_WHEN_FORMS}
    with_ = {name: project_result([call("a"), call("b", **{"with": {"k": v}}), call("c")]) for name, v in WITH_VALUES.items()}
    declared = project({"workflows": {"w": {"in": {"type": "object", "properties": {"x": {"type": "string"}}},
                                            "steps": [call("a"), call("b", **{"with": {"k": "$in.zz"}, "when": "$in.zz"})]}}})
    try:
        undeclared = workflows.structure_problems(Kit(KIT, declared))
    finally:
        cleanup(declared)
    return {"when": when, "gateWithWhen": gate, "with": with_, "undeclaredInput": undeclared}


# ------------------------------------------------------------------------------------------------ mode features
ROLE = {"role": "builder", "out": "Result", "task": "Do it and return a Result."}


def feature_result(k, step_b: dict) -> dict:
    """delivery.build with steps a (a role step) and b (`step_b`), resolved with the rest of the kit."""
    edit_yaml(k / "modes/delivery/mode.yaml",
              lambda doc: doc["spec"]["features"]["build"].update({"steps": [{"id": "a", **ROLE}, {"id": "b", **step_b}]}))
    try:
        model.resolve(Kit(k, k))
    except model.SpecError as e:
        return {"accepted": False, "layer": "schema", "problems": [ln.strip() for ln in str(e).splitlines()[1:]]}
    except model.ResolveError as e:
        return {"accepted": False, "layer": "resolve", "problems": list(e.gaps)}
    return {"accepted": True, "layer": None, "problems": []}


def feature_tables() -> dict:
    k = kit_copy()
    try:
        when = {f: feature_result(k, {**ROLE, "when": f}) for f in WHEN_FORMS}
        gate = {f: feature_result(k, {"gate": "ok?", "when": f}) for f in GATE_WHEN_FORMS}
        gate_clean = {name: feature_result(k, {"gate": "ok?", **extra})
                      for name, extra in {"no when": {}, "approves in": {"approves": "$in.proposal"},
                                          "approves steps": {"approves": "$in.proposal|$steps.a.artifacts"},
                                          "approves bad": {"approves": "$steps.a.x"}}.items()}
        return normal({"when": when, "gateWithWhen": gate, "gate": gate_clean}, {str(k): "<kit>"})
    finally:
        cleanup(k)


# ------------------------------------------------------------------------------------------------ what the runners do
def dispatcher_skip() -> list:
    p = project()
    try:
        d = dispatch.Dispatcher(system(p), p, clock=clock)
        out = []
        for when, inp, steps in SKIP_ROWS:
            step = model.Step(id="b", kind="role", when=when)
            try:
                got = d._skip(step, None, None, {"input": inp, "steps": steps})
            except Exception as e:                                  # recorded: what an unparsed form does
                got = f"{type(e).__name__}: {e}"
            out.append({"when": when, "input": inp, "steps": steps, "skipped": got})
        for when, status in STALE_ROWS:
            step = model.Step(id="b", kind="code", run="items.store/v1.sync", when=when)
            d._invoke = lambda *a, _s=status, **kw: _s
            d._settings = lambda mode: {}
            try:
                got = d._skip(step, None, None, {"input": {}, "steps": {}})
            except Exception as e:
                got = f"{type(e).__name__}: {e}"
            out.append({"when": when, "status": status, "skipped": got})
        return out
    finally:
        cleanup(p)


def runner_advance() -> list:
    out = []
    for when, inp, result in ADVANCE_ROWS:
        p = project({"workflows": {"w": {"steps": [call("a"), call("b", when=when)]}}})
        try:
            try:
                d = dispatch.Dispatcher(system(p), p, clock=clock)
            except config.ConfigError:
                out.append({"when": when, "input": inp, "output": result, "result": "rejected by the config schema"})
                continue
            run = d.call("cos.run", {"workflow": "w", "input": inp})["output"]
            nxt = d.call("cos.next", {"runId": run["runId"], "callId": "C-x", "status": "done", "output": result})["output"]
            out.append({"when": when, "input": inp, "output": result,
                        "result": {k: nxt[k] for k in ("status", "stage", "skipped") if k in nxt}})
        finally:
            cleanup(p)
    return out


def test_stage_syntax_table():
    got = {"project": project_tables(), "feature": feature_tables(), "dispatcherSkip": dispatcher_skip(),
           "runnerAdvance": runner_advance()}
    compare("stages", json.loads(json.dumps(got, sort_keys=True)))
