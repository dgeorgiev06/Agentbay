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


def test_a_plan_of_another_step_or_call_does_not_count():
    k, d, cid = _at_propose()
    try:
        tid = "T-20261030-bbbb"
        ledger.append(k, "agent.dispatch", tid, source="coordinator", taskId=tid, callId="C-other", step="propose", agent="b")
        ledger.record_plan(k, tid, {"outcome": "o", "todo": [{"text": "t", "serves": "s"}]})
        with pytest.raises(dispatch.CallError, match="recorded no outcome"):
            d.submit_strict(cid, "propose", {"status": "done", "summary": "s"})
        # the taskId in the result block names the run when no dispatch was logged
        assert d.submit_strict(cid, "propose", {"status": "done", "summary": "s", "taskId": tid})["next"]["step"] == "approve"
    finally:
        cleanup(k)
