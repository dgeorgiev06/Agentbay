"""factory-store: the slicing constraints, the stage engine's fan-out and the findings that hold a slice back."""
from types import SimpleNamespace

from helpers import KIT, NOW, cleanup, connector_pkg, tmpdir

from bay.connect import ConnectorError

fs = connector_pkg("factory-store", "factory_store")
slicing = connector_pkg("factory-store", "slicing")
pipeline = connector_pkg("factory-store", "pipeline")

MODE = KIT / "components/modes/factory"
LENSES = [{"id": "correctness", "title": "Correctness", "blocking": True,
           "checks": [{"id": "L-1", "level": "must", "statement": "every criterion is met"}]},
          {"id": "quality", "title": "Quality", "blocking": False,
           "checks": [{"id": "L-1", "level": "should", "statement": "no leftovers"}]}]


def store(**settings):
    d = tmpdir()
    ctx = SimpleNamespace(data_dir=d, settings={"modeDirs": [str(MODE)], "reviewers": LENSES, **settings},
                          now=lambda: NOW)
    return fs.create(ctx), d


def slice_(sid, outcome="a user can see the thing", paths=None, deps=None, interfaces=None, acceptance=None):
    return {"id": sid, "outcome": outcome, "paths": paths or [f"app/{sid}.py"],
            "acceptance": acceptance or [{"id": "A-1", "level": "must", "statement": f"{sid} works end to end"}],
            **({"deps": deps} if deps else {}), **({"interfaces": interfaces} if interfaces else {})}


def opened(**settings):
    s, d = store(**settings)
    out = s.open("ship the export", requirements="docs/req.md")
    return s, out["runId"], d


def test_a_run_starts_at_the_first_stage_and_names_its_language_profile():
    s, run_id, d = opened()
    try:
        state = s.stages(run_id)
        assert state["status"] == "stage-ready" and state["stage"] == "spec"
        assert state["calls"] == [{"target": "factory.spec", "input": {"runId": run_id}, "label": "stage spec"}]
        assert state["language"]["name"] == "python"
        assert [p["id"] for p in state["language"]["practices"]][:2] == ["P-1", "P-2"]
        assert state["constraints"]["maxSlices"] == 20
    finally:
        cleanup(d)


def test_an_unknown_language_profile_names_the_ones_that_exist():
    s, _ = store()
    try:
        s.open("x", language="cobol")
        raise AssertionError("expected a refusal")
    except ConnectorError as e:
        assert "no language profile 'cobol'" in str(e) and "python" in str(e)


def test_the_approve_stage_binds_the_gate_to_the_file_the_plan_stage_recorded():
    s, run_id, d = opened()
    try:
        s.record(run_id, "spec", "done", artifacts=["docs/factory/x/spec.md"])
        state = s.stages(run_id)
        assert state["stage"] == "plan"
        s.record(run_id, "plan", "done", artifact="docs/factory/x/plan.md")
        state = s.stages(run_id)
        assert state["calls"][0]["target"] == "factory.approve"
        assert state["calls"][0]["input"]["plan"] == "docs/factory/x/plan.md"
    finally:
        cleanup(d)


def test_a_stage_that_ended_badly_blocks_the_run_and_says_which_one():
    s, run_id, d = opened()
    try:
        s.record(run_id, "spec", "partial", summary="the requirements are too vague")
        state = s.stages(run_id)
        assert state["status"] == "blocked" and state["stage"] == "spec"
        assert "too vague" in state["reason"] and "factory.spec again" in state["reason"]
    finally:
        cleanup(d)


def sliced(s, run_id, slices):
    for stage, kw in (("spec", {}), ("plan", {"artifact": "docs/factory/x/plan.md"}), ("approve", {})):
        s.record(run_id, stage, "done", **kw)
    out = s.propose(run_id, slices)
    s.record(run_id, "slice", "done")
    return out


def test_two_slices_of_one_wave_may_not_claim_the_same_path():
    s, run_id, d = opened()
    try:
        out = s.propose(run_id, [slice_("S-1", paths=["app/a.py"]), slice_("S-2", paths=["app/a.py", "app/b.py"])])
        assert out["accepted"] == [] and "stopped" in out
        problems = [p for r in out["rejected"] for p in r["problems"]]
        assert any("same wave" in p and "write the same files" in p for p in problems)
        assert s.get(run_id)["slices"] == []
    finally:
        cleanup(d)


def test_a_dependency_without_a_contract_on_both_sides_is_refused():
    s, run_id, d = opened()
    try:
        out = s.propose(run_id, [slice_("S-1"), slice_("S-2", deps=["S-1"])])
        by_id = {r["id"]: r["problems"] for r in out["rejected"]}
        assert any("declares no interface it consumes that S-1 publishes" in p for p in by_id["S-2"])
        assert any("must declare the interface it" in p for p in by_id["S-1"])
        good = [slice_("S-1", interfaces=[{"name": "export.rows", "role": "publishes", "shape": "rows() -> list"}]),
                slice_("S-2", deps=["S-1"], interfaces=[{"name": "export.rows", "role": "consumes"}])]
        out = s.propose(run_id, good)
        assert out["accepted"] == ["S-1", "S-2"] and out["waves"] == [["S-1"], ["S-2"]]
    finally:
        cleanup(d)


def test_a_cycle_a_forbidden_path_and_a_slice_without_a_must_are_each_named():
    s, run_id, d = opened()
    try:
        iface = [{"name": "x", "role": "publishes"}, {"name": "x", "role": "consumes"}]
        out = s.propose(run_id, [
            slice_("S-1", deps=["S-2"], interfaces=iface), slice_("S-2", deps=["S-1"], interfaces=iface),
            slice_("S-3", paths=[".github/workflows/ci.yml"]),
            slice_("S-4", acceptance=[{"id": "A-1", "level": "should", "statement": "it is tidy"}])])
        by_id = {r["id"]: " ".join(r["problems"]) for r in out["rejected"]}
        assert "cycle" in by_id["S-1"] and "cycle" in by_id["S-2"]
        assert "forbiddenPaths" in by_id["S-3"]
        assert "no acceptance criterion is a must" in by_id["S-4"]
    finally:
        cleanup(d)


def test_too_many_slices_paths_or_criteria_point_at_the_constraint():
    c = {"maxSlices": 2, "maxPaths": 1, "maxAcceptance": 1, "forbiddenPaths": []}
    rejected, _ = slicing.validate([slice_("S-1"), slice_("S-2"), slice_("S-3", paths=["a", "b"])], c)
    joined = {r["id"]: " ".join(r["problems"]) for r in rejected}
    assert "maxSlices 2" in joined["S-1"] and "maxPaths 1" in joined["S-3"]


def test_build_fans_out_over_a_wave_and_waits_for_a_dependency():
    s, run_id, d = opened()
    try:
        sliced(s, run_id, [slice_("S-1", paths=["app/a.py"], interfaces=[{"name": "x", "role": "publishes"}]),
                           slice_("S-2", paths=["app/b.py"]),
                           slice_("S-3", paths=["app/c.py"], deps=["S-1"],
                                  interfaces=[{"name": "x", "role": "consumes"}])])
        state = s.stages(run_id)
        assert state["stage"] == "build"
        assert [c["input"]["sliceId"] for c in state["calls"]] == ["S-1", "S-2"]
        s.record(run_id, "build", "done", sliceId="S-1")
        s.record(run_id, "build", "done", sliceId="S-2")
        state = s.stages(run_id)
        assert state["stage"] == "build" and [c["input"]["sliceId"] for c in state["calls"]] == ["S-3"]
        s.record(run_id, "build", "done", sliceId="S-3")
        state = s.stages(run_id)
        assert state["stage"] == "audit"
        pairs = {(c["input"]["sliceId"], c["input"]["lens"]) for c in state["calls"]}
        every = {(s_id, lens) for s_id in ("S-1", "S-2", "S-3") for lens in ("correctness", "quality")}
        assert len(pairs) == 5 and pairs < every, pairs
    finally:
        cleanup(d)


def test_the_batch_is_capped_by_the_stages_parallel_setting():
    s, run_id, d = opened(pipeline=[{"stage": "build", "parallel": 2}])
    try:
        s.propose(run_id, [slice_(f"S-{i}", paths=[f"app/{i}.py"]) for i in (1, 2, 3)])
        assert len(s.stages(run_id)["calls"]) == 2
    finally:
        cleanup(d)


def verdicts(ids_fail=(), acceptance="A-1", lens_check="L-1"):
    out = []
    for i in (acceptance, lens_check):
        fail = i in ids_fail
        out.append({"id": i, "verdict": "fail" if fail else "pass", "evidence": "app/a.py:3",
                    **({"severity": "blocker", "suggestion": "fix it"} if fail else {})})
    return out


def test_a_verdict_set_that_misses_an_id_is_refused_and_records_nothing():
    s, run_id, d = opened()
    try:
        sliced(s, run_id, [slice_("S-1")])
        out = s.findings(run_id, "S-1", "correctness", [{"id": "A-1", "verdict": "pass", "evidence": "x:1"}])
        assert out["recorded"] == 0 and "miss L-1" in out["stopped"]
        assert s.get(run_id, "S-1")["slices"][0]["findings"] == []
    finally:
        cleanup(d)


def test_a_blocking_finding_sends_the_slice_to_fix_and_the_lenses_judge_it_again():
    s, run_id, d = opened()
    try:
        sliced(s, run_id, [slice_("S-1")])
        s.record(run_id, "build", "done", sliceId="S-1")
        s.findings(run_id, "S-1", "quality", verdicts())
        out = s.findings(run_id, "S-1", "correctness", verdicts(ids_fail=("A-1",)))
        assert out["blocking"] == 1
        s.record(run_id, "audit", "done", sliceId="S-1", lens="correctness")
        s.record(run_id, "audit", "done", sliceId="S-1", lens="quality")
        state = s.stages(run_id)
        assert state["stage"] == "fix" and state["calls"][0]["input"]["sliceId"] == "S-1"
        s.record(run_id, "fix", "done", sliceId="S-1")
        state = s.stages(run_id)
        assert state["stage"] == "audit", state
        assert {c["input"]["lens"] for c in state["calls"]} == {"correctness", "quality"}
        s.findings(run_id, "S-1", "correctness", verdicts())
        s.findings(run_id, "S-1", "quality", verdicts())
        s.record(run_id, "audit", "done", sliceId="S-1", lens="correctness")
        s.record(run_id, "audit", "done", sliceId="S-1", lens="quality")
        state = s.stages(run_id)
        assert state["stage"] == "integrate" and state["calls"][0]["input"]["sliceId"] == "S-1"
        s.record(run_id, "integrate", "done", sliceId="S-1")
        state = s.stages(run_id)
        assert state["status"] == "done" and run_id in state["reason"]
    finally:
        cleanup(d)


def test_a_failing_lens_that_does_not_block_never_holds_a_slice_back():
    s, run_id, d = opened()
    try:
        sliced(s, run_id, [slice_("S-1")])
        s.record(run_id, "build", "done", sliceId="S-1")
        out = s.findings(run_id, "S-1", "quality", verdicts(ids_fail=("L-1",)))
        assert out["blocking"] == 0 and len(out["open"]) == 1
        s.findings(run_id, "S-1", "correctness", verdicts())
        for lens in ("correctness", "quality"):
            s.record(run_id, "audit", "done", sliceId="S-1", lens=lens)
        assert s.stages(run_id)["stage"] == "integrate"
    finally:
        cleanup(d)


def test_a_slice_out_of_fix_rounds_blocks_the_run_and_names_itself():
    s, run_id, d = opened(pipeline=[{"stage": "build"}, {"stage": "audit"}, {"stage": "fix", "maxRounds": 1}])
    try:
        s.propose(run_id, [slice_("S-1")])
        s.record(run_id, "build", "done", sliceId="S-1")
        s.findings(run_id, "S-1", "correctness", verdicts(ids_fail=("A-1",)))
        s.findings(run_id, "S-1", "quality", verdicts())
        for lens in ("correctness", "quality"):
            s.record(run_id, "audit", "done", sliceId="S-1", lens=lens)
        assert s.stages(run_id)["stage"] == "fix"
        s.record(run_id, "fix", "done", sliceId="S-1")
        s.findings(run_id, "S-1", "correctness", verdicts(ids_fail=("A-1",)))
        s.findings(run_id, "S-1", "quality", verdicts())
        for lens in ("correctness", "quality"):
            s.record(run_id, "audit", "done", sliceId="S-1", lens=lens)
        state = s.stages(run_id)
        assert state["status"] == "blocked" and state["stage"] == "fix"
        assert "S-1 still has 1 blocking finding(s) after 1 fix round(s)" in state["blockers"][0]
        assert "maxFixRounds" in state["reason"]
    finally:
        cleanup(d)


def test_the_brief_carries_the_criteria_the_contracts_the_practices_and_the_open_findings():
    s, run_id, d = opened()
    try:
        sliced(s, run_id, [slice_("S-1", interfaces=[{"name": "x", "role": "publishes", "shape": "rows() -> list"}])])
        s.record(run_id, "build", "done", sliceId="S-1")
        s.findings(run_id, "S-1", "correctness", verdicts(ids_fail=("A-1",)))
        b = s.brief(run_id, "S-1", kind="fix")
        assert b["kind"] == "fix" and b["language"] == "python"
        assert [a["id"] for a in b["acceptance"]] == ["A-1"] and b["interfaces"][0]["shape"] == "rows() -> list"
        assert b["commands"]["test"] == ["python3", "-m", "pytest", "-q"]
        assert [f["id"] for f in b["findings"]] == ["A-1"] and b["findings"][0]["blocking"] is True
        assert "lens" not in b
        a = s.brief(run_id, "S-1", lens="quality")
        assert a["kind"] == "audit" and a["lens"]["id"] == "quality" and a["lens"]["blocking"] is False
    finally:
        cleanup(d)


def test_an_unknown_run_slice_lens_or_stage_says_what_exists():
    s, run_id, d = opened()
    try:
        for call, needle in (((lambda: s.stages("F-nope")), "unknown factory run"),
                             ((lambda: s.brief(run_id, "S-9")), "not proposed yet"),
                             ((lambda: s.record(run_id, "polish", "done")), "unknown stage 'polish'")):
            try:
                call()
                raise AssertionError(f"expected a refusal for {needle}")
            except ConnectorError as e:
                assert needle in str(e), (needle, str(e))
        sliced(s, run_id, [slice_("S-1")])
        try:
            s.findings(run_id, "S-1", "speed", verdicts())
            raise AssertionError("expected a refusal")
        except ConnectorError as e:
            assert "unknown review lens 'speed'" in str(e) and "correctness" in str(e)
    finally:
        cleanup(d)


def test_a_pipeline_naming_an_unknown_stage_or_lens_is_refused_at_the_start():
    for settings, needle in (({"pipeline": [{"stage": "ship"}]}, "unknown stage(s) ship"),
                             ({"pipeline": [{"stage": "audit", "lenses": ["taste"]}]}, "names lens 'taste'")):
        s, d = store(**settings)
        try:
            s.open("x")
            raise AssertionError("expected a refusal")
        except ConnectorError as e:
            assert needle in str(e)
        finally:
            cleanup(d)


def test_status_reports_runs_without_their_stage_outputs():
    s, run_id, d = opened()
    try:
        sliced(s, run_id, [slice_("S-1")])
        rows = s.status()["runs"]
        assert rows[0]["runId"] == run_id and rows[0]["language"] == "python"
        assert rows[0]["slices"][0] == {"id": "S-1", "title": "a user can see the thing", "state": "planned",
                                        "rounds": 0, "open": 0, "blocking": 0}
        assert [r["stage"] for r in rows[0]["stages"]][:2] == ["spec", "plan"]
        assert s.status(open=True)["runs"] and not s.status(runId=run_id)["runs"][0].get("results")
    finally:
        cleanup(d)


def test_waves_report_the_slices_a_cycle_holds_back():
    order, cyclic = slicing.waves([slice_("S-1", deps=["S-2"]), slice_("S-2", deps=["S-1"]), slice_("S-3")])
    assert order == [["S-3"]] and cyclic == ["S-1", "S-2"]


def test_records_of_one_stage_are_found_by_slice_and_lens():
    s, run_id, d = opened()
    try:
        sliced(s, run_id, [slice_("S-1")])
        s.record(run_id, "audit", "done", sliceId="S-1", lens="quality")
        run = s._load(run_id)
        assert len(pipeline.records(run, "audit", "S-1", "quality")) == 1
        assert pipeline.records(run, "audit", "S-1", "correctness") == []
    finally:
        cleanup(d)
