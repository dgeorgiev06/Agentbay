"""`bay note review`: a review that ran outside a framework review step becomes a ledger event improve reads,
and it can pass no gate."""
import json
import subprocess
import sys
from pathlib import Path

from helpers import KIT, cleanup, clock, connector_pkg, kit_copy, project, system
from test_boundaries import built, tool

from bay import dispatch, ledger

sources = connector_pkg("ledger", "ledger_sources")

TID = "T-20261030-aaaa"
VERDICT = {"summary": "reviewed outside the framework",
           "items": [{"id": "DOD-1", "verdict": "pass", "evidence": "tests ran", "cites": {"outcome": True, "todo": [1]}},
                     {"id": "R-2", "verdict": "fail", "severity": "blocker", "evidence": "no migration"}]}


def cli(p, *args):
    return subprocess.run([sys.executable, str(KIT / "bay/cli.py"), "--project", str(p), *args],
                          capture_output=True, text=True)


def test_review_record_appends_a_scrubbed_event_improve_reads_and_refuses_bad_input():
    p = project()
    try:
        secret = "sk-ant-api03-" + "a" * 40
        v = json.loads(json.dumps(VERDICT))
        v["items"][1]["evidence"] = f"no migration, key {secret}"
        r = cli(p, "note", "review", TID, json.dumps(v))
        assert r.returncode == 0, r.stderr
        raw = (p / ".agentbay/ledger/events.jsonl").read_text()
        assert secret not in raw and "review.recorded" in raw
        (ev,) = [e for e in ledger.read(p) if e["type"] == "review.recorded"]
        assert ev["taskId"] == TID and [i["verdict"] for i in ev["data"]["items"]] == ["pass", "fail"]
        got, stats = sources.ledger_verdicts(p)
        assert [(g["target"], g["subject"], [i["id"] for i in g["items"]]) for g in got] == \
            [("review-record", TID, ["DOD-1", "R-2"])] and secret not in json.dumps(got)
        for bad in ({"items": []}, {"items": [{"id": "DOD-1", "verdict": "maybe", "evidence": "x"}]},
                    {"items": [{"id": "X-1", "verdict": "pass", "evidence": "x"}]},
                    {"items": [{"id": "DOD-1", "verdict": "pass", "evidence": "x" * 1001}]}, {"nope": 1}):
            assert cli(p, "note", "review", TID, json.dumps(bad)).returncode != 0, bad
        assert cli(p, "note", "review", "T-1", json.dumps(VERDICT)).returncode != 0          # not a taskId
        assert cli(p, "review-record", TID, json.dumps(VERDICT)).returncode != 0             # the old name is gone
        assert len([e for e in ledger.read(p) if e["type"] == "review.recorded"]) == 1
    finally:
        cleanup(p)


def test_a_recorded_review_passes_no_gate_and_nothing_in_the_dispatcher_reads_it():
    k = kit_copy()
    try:
        d = dispatch.Dispatcher(system(k, k), k, clock=clock)
        cid = d.call("forge.extend", {"goal": "a change"})["callId"]
        before = d.show(cid)
        ledger.record_review(k, TID, {"items": [{"id": "DOD-1", "verdict": "pass", "evidence": "fine"}]})
        try:
            ledger.record_review(k, cid, {"items": [{"id": "DOD-1", "verdict": "pass", "evidence": "fine"}]})
            raise AssertionError("a review is recorded on a taskId, never on a call")
        except ledger.PlanError:
            pass
        after = d.show(cid)
        assert {x: after[x] for x in ("status", "next")} == {x: before[x] for x in ("status", "next")}
        assert "review.recorded" in ledger.TYPES and "review.recorded" not in ledger.RUN_TYPES | ledger.STEP_TYPES
        assert ledger.fold(ledger.read(k)) == {}                                  # it creates no run
        for src in ("bay/dispatch.py", "bay/approvals.py", "bay/checks.py"):
            f = KIT / src
            assert not f.exists() or "review.recorded" not in f.read_text(), src   # no gate or step reads it
    finally:
        cleanup(k)


def test_a_subagent_may_not_record_a_review():
    p = built()
    try:
        ledger.append(p, "agent.dispatch", TID, source="coordinator", taskId=TID, agent="builder--delivery")
        c = f".agentbay/bay note review {TID} '{json.dumps(VERDICT)}'"
        assert tool(p, "builder--delivery", "Bash", {"command": c})[0] == "deny"
    finally:
        cleanup(p)
