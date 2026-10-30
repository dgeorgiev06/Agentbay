"""Slice 8: a subagent role step's result is accepted only when its run recorded an outcome (`bay plan`)."""
import pytest

from bay import dispatch, ledger
from helpers import cleanup, clock, kit_copy, system


def _at_propose():
    k = kit_copy()
    d = dispatch.Dispatcher(system(k, k), k, clock=clock)
    return k, d, d.call("forge.extend", {"goal": "a change"})["callId"]


def test_submit_is_refused_without_a_recorded_outcome_and_accepted_after_bay_plan():
    k, d, cid = _at_propose()
    try:
        ok = {"status": "done", "summary": "s"}
        with pytest.raises(dispatch.CallError, match="recorded no outcome"):
            d.submit_strict(cid, "propose", ok)
        tid = "T-20261030-aaaa"
        ledger.append(k, "agent.dispatch", tid, source="coordinator", taskId=tid, callId=cid, step="propose", agent="b")
        with pytest.raises(dispatch.CallError, match="recorded no outcome"):      # dispatched, but no plan yet
            d.submit_strict(cid, "propose", ok)
        ledger.record_plan(k, tid, {"outcome": "o", "todo": [{"text": "t", "serves": "s"}]})
        assert d.submit_strict(cid, "propose", ok)["next"]["step"] == "approve"
    finally:
        cleanup(k)


def test_bay_show_prints_the_inputs_a_dispatch_recorded():
    k, d, cid = _at_propose()
    try:
        tid = "T-20261030-cccc"
        ledger.append(k, "agent.dispatch", tid, source="coordinator", taskId=tid, callId=cid, step="propose", agent="b",
                      data={"inputs": ["docs/proposals/0008.md", "HANDOFF.md"]})
        ledger.append(k, "agent.dispatch", "T-20261030-dddd", source="coordinator", taskId="T-20261030-dddd", callId=cid,
                      step="propose", agent="b")
        agents = {a["taskId"]: a for a in d.show(cid)["agents"]}
        assert agents[tid]["inputs"] == ["docs/proposals/0008.md", "HANDOFF.md"]
        assert agents["T-20261030-dddd"]["inputs"] != ["docs/proposals/0008.md", "HANDOFF.md"]
    finally:
        cleanup(k)


def test_a_plan_of_another_step_or_call_does_not_count():
    k, d, cid = _at_propose()
    try:
        tid = "T-20261030-bbbb"
        ledger.append(k, "agent.dispatch", tid, source="coordinator", taskId=tid, callId="C-other", step="propose", agent="b")
        ledger.record_plan(k, tid, {"outcome": "o", "todo": [{"text": "t", "serves": "s"}]})
        with pytest.raises(dispatch.CallError, match="recorded no outcome"):
            d.submit_strict(cid, "propose", {"status": "done", "summary": "s"})
        # naming that taskId in the result block does not borrow its plan: it was dispatched to another call
        with pytest.raises(dispatch.CallError, match="recorded no outcome"):
            d.submit_strict(cid, "propose", {"status": "done", "summary": "s", "taskId": tid})
        # nor one dispatched to another step of this call
        t2 = "T-20261030-eeee"
        ledger.append(k, "agent.dispatch", t2, source="coordinator", taskId=t2, callId=cid, step="implement", agent="b")
        ledger.record_plan(k, t2, {"outcome": "o", "todo": [{"text": "t", "serves": "s"}]})
        with pytest.raises(dispatch.CallError, match="recorded no outcome"):
            d.submit_strict(cid, "propose", {"status": "done", "summary": "s", "taskId": t2})
    finally:
        cleanup(k)


def test_a_result_taskid_counts_when_its_dispatch_names_this_call_and_step_or_no_call():
    k, d, cid = _at_propose()
    try:
        tid = "T-20261030-ffff"
        ledger.append(k, "agent.dispatch", tid, source="coordinator", taskId=tid, agent="b")      # no callId logged
        ledger.record_plan(k, tid, {"outcome": "o", "todo": [{"text": "t", "serves": "s"}]})
        assert d.submit_strict(cid, "propose", {"status": "done", "summary": "s", "taskId": tid})["next"]["step"] == "approve"
    finally:
        cleanup(k)


def test_plan_ownership_is_per_agent_type_not_per_run():
    """`bay plan` takes any logged dispatch's taskId: the CLI has no caller identity, so there is no per-run check
    (the guard limits a subagent to `bay plan`; the dispatch record ties the plan to its call and step)."""
    import inspect
    assert "agent" not in inspect.signature(ledger.record_plan).parameters
    assert "agent" not in inspect.signature(ledger.record_done).parameters
    k, d, cid = _at_propose()
    try:
        a, b = "T-20261030-1111", "T-20261030-2222"
        for t in (a, b):
            ledger.append(k, "agent.dispatch", t, source="coordinator", taskId=t, callId=cid, step="propose", agent="same-type")
        ledger.record_plan(k, b, {"outcome": "o", "todo": [{"text": "t", "serves": "s"}]})      # a sibling's plan
        ledger.record_done(k, b, 1)
        with pytest.raises(ledger.PlanError, match="not dispatched"):
            ledger.record_plan(k, "T-20261030-9999", {"outcome": "o", "todo": [{"text": "t", "serves": "s"}]})
    finally:
        cleanup(k)
