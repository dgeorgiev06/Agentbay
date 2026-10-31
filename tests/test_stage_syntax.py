"""Golden baseline of the two stage syntaxes (proposal 0008, stage 5 part A): the `when` / `with` / `gate` forms of a
mode feature's steps (schemas/mode.schema.json + model._feature_steps, run by Dispatcher._skip) and of a project
workflow's stages (schemas/config.schema.json + workflows.structure_problems, run by workflow_runner._advance), each
form with what the validator says today (accepted or the message) and, for `when`, what the runner does with it on
given data. tests/golden/stages.json was generated from the code before stage 5 unified the syntax; part E changes
only the rows its decisions D6 to D8 name. A failing compare means a behavior changed (see golden_util).

Stage ids are `a` then `b` in both syntaxes, so one list of forms serves both."""
from __future__ import annotations

import json
import re
from types import SimpleNamespace

from golden_util import GOLDEN, compare, normal
from helpers import KIT, cleanup, clock, edit_yaml, kit_copy, project, system
from layout import PROTECTED_INSTANCES

from bay import config, dispatch, lint, model, workflows
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
            try:
                got = workflows.skip(when, inp, steps)
            except Exception as e:                                  # recorded: what an unparsed form does
                got = f"{type(e).__name__}: {e}"
            out.append({"when": when, "input": inp, "steps": steps, "skipped": got})
        for when, status in STALE_ROWS:
            step = model.Step(id="b", kind="code", run="items.store/v1.sync", when=when)
            d._invoke = lambda *a, _s=status, **kw: _s
            d._settings = lambda mode: {}
            try:
                got = workflows.skip(when, {}, {}, lambda age: d._fresh(step, None, age))
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


# ------------------------------------------------------------------------------------------------ the documented deltas
# stage 5 part E (proposal 0008 D6 to D8) changed the syntax in two ways. tests/golden/stages.json stays as the
# untouched code produced it: the rows named here are checked against their new value, put back to the golden's
# value, and PATTERN_TEXT is undone in the messages that quote a schema pattern; everything else must equal the golden.
OLD_PATTERNS = {                         # what a schema error quoted before part E -> the same pattern now
    r"^\$(in|steps)\.[A-Za-z][A-Za-z0-9-]*(\.[A-Za-z][A-Za-z0-9-]*)*$": workflows.WHEN_PATTERN,
    r"^(stale\s*>\s*[0-9]+[mhdw]|!?approved\s+\$in\.[A-Za-z][A-Za-z0-9]*|!?\$in\.[A-Za-z][A-Za-z0-9]*"
    r"|!?\$steps\.[a-z][a-z0-9-]*\.[A-Za-z][A-Za-z0-9]*)$": workflows.FEATURE_WHEN_PATTERN,
    r"^\$in\.[A-Za-z][A-Za-z0-9]*(\|\$steps\.[a-z][a-z0-9-]*\.[A-Za-z][A-Za-z0-9]*)?$": workflows.APPROVES_PATTERN,
}
GATE_WHEN = "a gate takes no when:"
D7 = ("D7: a gate with `when:` in a project workflow is refused (its value came from the output the coordinator passes "
      "to cos.next, so an agent could fabricate it); features already refused it")
D8_PROJECT = "D8: a project `when` accepts a leading `!` (the union of the two grammars); it only accepts more"
D8_FEATURE = ("D8: a feature `when` takes hyphens and nested paths in a field ($in.x-y, $in.x.y, $steps.a.x.y), a "
              "`$steps.<name>` with no field, and a step id in capitals; it only accepts more")


def accepted_row():
    return {"accepted": True, "layer": None, "problems": []}


def refused_gate_row(stage_id: str = "b"):
    return {"accepted": False, "layer": "structure",
            "problems": [f"agentbay.config.yaml workflows.w step {stage_id}: {GATE_WHEN} {workflows.PROJECT_GATE_FIX}"]}


D9 = "D9: a feature `when: approved $in.f` is refused at load (the dispatcher cannot evaluate it; it crashed)"


def refused_when_row(when: str):
    return {"accepted": False, "layer": "resolve", "problems": [
        f"<kit>/modes/delivery/mode.yaml:\n    spec/features/build/steps/1/when: '{when}' does not match "
        f"{workflows.FEATURE_WHEN_PATTERN!r}"]}


EXPECTED_DELTAS = {
    **{("project", "when", f): {"was": False, "now": accepted_row(), "why": D8_PROJECT}
       for f in ("!$in.x", "!$steps.a.x")},
    **{("project", "gateWithWhen", f): {"was": was, "now": refused_gate_row(), "why": D7}
       for f, was in {"$in.x": True, "$steps.a.x": True, "!$in.x": False, "!$steps.a.x": False,
                      "$steps.nope.x": False}.items()},
    **{("feature", "when", f): {"was": False, "now": accepted_row(), "why": D8_FEATURE}
       for f in ("$in.x-y", "$in.x.y", "$steps.a.x-y", "$steps.a.x.y", "$steps.a", "$steps.A.x")},
    **{("feature", "when", f): {"was": True, "now": refused_when_row(f), "why": D9}
       for f in ("approved $in.f", "!approved $in.f")},
}
EXPECTED_RUNNER_DELTAS = {          # (when, input, output) -> (was, now): the project `when` the schema used to refuse
    ("!$in.x", '{"x": 0}', "{}"): ("rejected by the config schema", {"stage": "b", "status": "stage-ready"}),
    ("!$steps.a.x", "{}", '{"x": 0}'): ("rejected by the config schema", {"stage": "b", "status": "stage-ready"}),
}


def undo_pattern_text(node):
    """The messages that quote a schema pattern, with the pattern as it was before part E."""
    if isinstance(node, str):
        for old, new in OLD_PATTERNS.items():
            node = node.replace(repr(new)[1:-1], repr(old)[1:-1])
        return node
    if isinstance(node, list):
        return [undo_pattern_text(x) for x in node]
    if isinstance(node, dict):
        return {k: undo_pattern_text(v) for k, v in node.items()}
    return node


def undo_expected_deltas(got: dict) -> dict:
    """`got` with every named delta checked and put back to the golden's value."""
    golden = json.loads((GOLDEN / "stages.json").read_text())
    for path, delta in EXPECTED_DELTAS.items():
        node, old = got, golden
        for key in path[:-1]:
            node, old = node[key], old[key]
        assert node[path[-1]] == delta["now"], f"{'/'.join(path)}: expected {delta['now']} ({delta['why']}), got {node[path[-1]]}"
        assert old[path[-1]]["accepted"] is delta["was"], f"{'/'.join(path)}: the golden row changed"
        node[path[-1]] = old[path[-1]]
    for row in got["runnerAdvance"]:
        key = (row["when"], json.dumps(row["input"]), json.dumps(row["output"]))
        if key in EXPECTED_RUNNER_DELTAS:
            was, now = EXPECTED_RUNNER_DELTAS[key]
            assert row["result"] == now, f"{key}: expected {now} (D8), got {row['result']}"
            row["result"] = was
    return undo_pattern_text(got)


def test_stage_syntax_table():
    got = {"project": project_tables(), "feature": feature_tables(), "dispatcherSkip": dispatcher_skip(),
           "runnerAdvance": runner_advance()}
    compare("stages", undo_expected_deltas(json.loads(json.dumps(got, sort_keys=True))))


# ------------------------------------------------------------------------------------------------ one parser (D6, D8)
def test_the_reference_grammar_is_spelled_once_and_the_schemas_equal_it():
    root = KIT / "bay"
    shipped = [KIT / p for p in PROTECTED_INSTANCES if p.startswith("connectors/")]      # the files scanned before the move
    files = [*root.glob("*.py"), *(f for d in shipped for f in d.glob("*.py")), *(KIT / "adapters").glob("*/*.py")]
    spelled = [str(f.relative_to(KIT)) for f in files if re.search(r"\\\$\(?(\?:)?(in|steps)", f.read_text())]
    assert spelled == ["bay/workflows.py"], spelled
    mode = json.loads((KIT / "schemas" / "mode.schema.json").read_text())
    step = mode["$defs"]["step"]["properties"] if "step" in mode.get("$defs", {}) else None
    assert step is not None, "mode.schema.json no longer has $defs.step"
    assert step["when"]["pattern"] == workflows.FEATURE_WHEN_PATTERN
    assert step["approves"]["pattern"] == workflows.APPROVES_PATTERN
    cfg = json.loads((KIT / "schemas" / "config.schema.json").read_text())
    stage = cfg["properties"]["workflows"]["additionalProperties"]["properties"]["steps"]["items"]["properties"]
    assert stage["when"]["pattern"] == workflows.WHEN_PATTERN


def test_the_dispatcher_and_the_cursor_share_one_skip_rule_and_one_substitution():
    runner = (KIT / "connectors" / "workflow-runner" / "workflow_runner.py").read_text()
    assert not hasattr(dispatch, "substitute") and "substitute" not in runner
    assert "wfmod.advance(" in runner and "wfmod.advance(" in (KIT / "bay" / "dispatch.py").read_text()
    assert not hasattr(dispatch.Dispatcher, "_skip")
    for when, inp, steps in SKIP_ROWS:
        if when.startswith(("$in.", "!$in.", "$steps.", "!$steps.")):
            stages = [workflows.Stage(id="a", call="x.y"), workflows.Stage(id="b", call="x.y", when=when)]
            mv = workflows.advance(stages, 1, inp, steps)
            skipped = workflows.skip(when, inp, steps)
            assert (mv.kind == "done") == skipped and (mv.skipped == ["b"]) == skipped, (when, inp, steps)


# ------------------------------------------------------------------------------------------------ D7: a gate takes no when
def gate_config(when) -> dict:
    return {"workflows": {"w": {"steps": [call("a"), {"id": "g", "gate": "ship it?", "when": when}, call("c")]}}}


def test_a_project_workflow_gate_with_when_is_refused_and_the_message_names_the_fix():
    for when in ("$in.go", "!$in.go", "$steps.a.ok", "!$steps.a.ok"):
        p = project(gate_config(when))
        try:
            problems = workflows.structure_problems(Kit(KIT, p))
            assert problems == [f"agentbay.config.yaml workflows.w step g: {GATE_WHEN} {workflows.PROJECT_GATE_FIX}"], problems
            assert "Remove `when:` from this gate" in problems[0]
        finally:
            cleanup(p)


def test_lint_reports_a_project_gate_with_when():
    p = project(gate_config("$in.go"))
    try:
        assert any(GATE_WHEN in x and "Remove `when:`" in x for x in lint.run(kit=Kit(KIT, p)))
    finally:
        cleanup(p)


def test_no_output_passed_to_cos_next_skips_a_gate():
    """Even a config that reaches the cursor with `when:` on a gate (not linted) cannot be skipped: the run fails."""
    p = project(gate_config("$steps.a.ok"))
    try:
        d = dispatch.Dispatcher(system(p), p, clock=clock)
        for output in ({"ok": 0}, {"ok": ""}, {}, {"ok": 1}):
            run = d.call("cos.run", {"workflow": "w", "input": {}})["output"]
            nxt = d.call("cos.next", {"runId": run["runId"], "callId": "C-x", "status": "done", "output": output})["output"]
            assert nxt["status"] == "failed" and "a gate takes no when:" in nxt["reason"], nxt
            assert "skipped" not in nxt and "gate" not in nxt
    finally:
        cleanup(p)
    stages = [workflows.Stage(id="g", gate="ok?", when="!$in.nope")]
    assert workflows.advance(stages, 0, {}, {}).kind == "refused"


def test_a_gate_without_when_still_waits_for_the_owner():
    p = project({"workflows": {"w": {"steps": [call("a"), {"id": "g", "gate": "ship it?"}, call("c")]}}})
    try:
        d = dispatch.Dispatcher(system(p), p, clock=clock)
        run = d.call("cos.run", {"workflow": "w", "input": {}})["output"]
        nxt = d.call("cos.next", {"runId": run["runId"], "callId": "C-x", "status": "done", "output": {"ok": 0}})["output"]
        assert nxt["status"] == "awaiting-approval" and nxt["gate"] == "ship it?"
    finally:
        cleanup(p)
