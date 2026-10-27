"""improve store: fingerprint dedup, evidence merge, reopen, decisions, triage links and priority, backlog
report, claim/handoff, verify, retention; and the secret scan on every write."""
import json
from datetime import timedelta

from helpers import NOW, cleanup, model, tmpdir
from improve_fixtures import CORES, SECRETS

from bay.improve import store as st


def cand(kind="slow-step", key="forge.extend.implement", lens="sessions", refs=("ab:C-1", "ab:C-2"), **kw):
    c = {"lens": lens, "kind": kind, "title": f"{key} is slow", "pattern": "x", "severity": "medium",
         "evidence": [{"kind": "episode", "ref": r} for r in refs], "scope": {"mode": "forge", "feature": "extend"},
         "occurrences": len(refs), "detector": {"name": kind, "key": key}}
    c.update(kw)
    return c


def S(d, now=NOW):
    return st.Store(d, now, {"forge", "improve"})


def test_dedup_by_fingerprint_merges_evidence_and_reopens_fixed():
    d = tmpdir()
    try:
        s = S(d)
        r1 = s.upsert([cand()], "improve.scan")
        r2 = s.upsert([cand(refs=("ab:C-2", "ab:C-3"))], "improve.scan")
        assert r1["new"] == r2["merged"] and len(s.load()) == 1
        f = s.load()[r1["new"][0]]
        assert [e["ref"] for e in f["evidence"]] == ["ab:C-3", "ab:C-1", "ab:C-2"] and f["route"] == "forge.extend"
        s.set_status(f["id"], "verified", "improve.verify")
        assert s.upsert([cand(refs=("ab:C-4",))], "improve.scan")["reopened"] == [f["id"]]
        assert s.load()[f["id"]]["status"] == "open"
        if model.jsonschema:
            for x in s.load().values():
                model.jsonschema.validate(x, model.data_schema("improve.finding/v1"))
    finally:
        cleanup(d)


def test_secret_scan_on_every_write():
    d = tmpdir()
    try:
        s = S(d)
        [fid] = s.upsert([cand(pattern=f"leaked {SECRETS['api-key']}",
                               evidence=[{"kind": "file", "ref": "a.py:1", "detail": SECRETS["private-key"]},
                                         {"kind": "file", "ref": "b.py:2", "detail": SECRETS["connection-string"]}])],
                         "improve.audit")["new"]
        s.annotate([{"id": fid, "rootCause": f"uses {SECRETS['jwt']}", "proposedFix": SECRETS["password"]}], "x")
        rep = s.backlog()
        text = (d / "findings.jsonl").read_text() + open(rep["report"]).read()
        assert all(c not in text for c in CORES)
    finally:
        cleanup(d)


def test_decide_approve_is_human_only_and_backlog_lists_top_items():
    d = tmpdir()
    try:
        s = S(d)
        ids = s.upsert([cand(key=f"k{i}", severity=sev, refs=tuple(f"ab:C-{j}" for j in range(n)))
                        for i, (sev, n) in enumerate([("low", 2), ("severe", 3), ("medium", 5)])], "scan")["new"]
        for by in ("cli", "improve-lead"):
            try:
                s.decide(ids[0], "approve", by)
                raise AssertionError("agents/cli without a TTY must not approve")
            except st.StoreError as e:
                assert "terminal" in str(e)
        s.decide(ids[0], "approve", st.HUMAN)
        s.decide(ids[2], "wontfix", "cli")
        rep = s.backlog(top=5, week="2026-W44")
        assert rep["week"] == "2026-W44" and rep["items"] == [ids[1], ids[0]]       # wontfix excluded; by priority
        text = open(rep["report"]).read()
        assert text.startswith("# improve backlog 2026-W44") and "bay improve decide" in text
        assert f"`{ids[1]}`" in text and "**Evidence:**" in text and "status **approved**" in text
        assert rep["report"].endswith("reports/2026-W44.md")
    finally:
        cleanup(d)


def test_priority_is_impact_times_frequency_over_effort():
    d = tmpdir()
    try:
        s = S(d)
        [a] = s.upsert([cand(severity="high", refs=tuple(f"ab:C-{i}" for i in range(4)))], "scan")["new"]
        assert s.load()[a]["priority"] == 4.0                     # 3 x 4 / 3 (forge.extend)
        s.annotate([{"id": a, "effort": 1, "impact": 5, "route": "mode-fix", "rootCause": "r", "proposedFix": "f"}], "x")
        assert s.load()[a]["priority"] == 20.0
    finally:
        cleanup(d)


def test_triage_links_only_same_file_across_lenses():
    d = tmpdir()
    try:
        s = S(d)
        churn = cand(kind="churn", key="modes/feed-briefing/mode.yaml", scope={"file": "modes/feed-briefing/mode.yaml"})
        conf = cand(kind="conformance", key="C-6:x", lens="artifacts", refs=(),
                    evidence=[{"kind": "file", "ref": "modes/feed-briefing/mode.yaml:12"}],
                    scope={"file": "modes/feed-briefing/mode.yaml"})
        slow = cand(kind="slow-step", key="feed-briefing.digest.gather")
        ineff = cand(kind="inefficient-store-read", key="connectors/local-store/store.py:LocalStore.query",
                     lens="artifacts", refs=(), evidence=[{"kind": "file", "ref": "connectors/local-store/store.py:9"}],
                     scope={"file": "connectors/local-store/store.py"})
        ids = s.upsert([churn, conf, slow, ineff], "x")["new"]
        res = s.triage()
        assert [(l["a"], l["b"]) for l in res["links"]] == [tuple(sorted(ids[:2]))]
        assert res["links"][0]["why"] == "same file modes/feed-briefing/mode.yaml"
        assert s.load()[ids[2]]["links"] == []                                   # no slow-step <-> code heuristics
    finally:
        cleanup(d)


def test_annotate_refuses_findings_that_are_not_open():
    d = tmpdir()
    try:
        s = S(d)
        a, b = s.upsert([cand(key="a"), cand(key="b")], "scan")["new"]
        s.decide(b, "defer", "cli")
        res = s.annotate([{"id": a, "rootCause": "r" * 12}, {"id": b, "rootCause": "r" * 12}, {"id": "F-00000000"}], "x")
        assert res["annotated"] == [a] and res["missing"] == ["F-00000000"]
        assert res["refused"][0]["id"] == b and "rootCause" not in s.load()[b]
    finally:
        cleanup(d)


def test_claim_and_handoff_only_for_human_approved_items():
    d = tmpdir()
    try:
        s = S(d)
        [fid] = s.upsert([cand()], "scan")["new"]
        assert "stopped" in s.claim(fid) and "stopped" in s.claim("F-00000000")
        s.decide(fid, "approve", st.HUMAN)
        draft = {"route": "forge.extend", "title": "Split forge.extend implement", "problem": "slow",
                 "change": "split the step", "tests": ["tests/test_x.py"]}
        out = s.handoff(fid, draft, "T-20261027-ab12")
        assert out["route"] == "forge.extend" and out["next"]["call"] == "forge.extend"
        assert "## Problem" in out["next"]["input"]["context"] and (d / "handoffs" / out["draft"]).exists()
        assert s.load()[fid]["status"] == "in-progress"
        assert "stopped" in s.handoff(fid, draft, "T-x")                      # no second handoff
        [g] = s.upsert([cand(key="other")], "scan")["new"]
        s.decide(g, "approve", st.HUMAN)
        env = s.handoff(g, {"route": "mode-fix", "title": "Tighten digest", "problem": "p" * 12, "change": "c" * 12},
                        "T-20261027-ab13")
        assert env["next"]["envelope"].startswith("```task\nprotocol: TaskEnvelope/v1\ntaskId: T-20261027-ab13")
    finally:
        cleanup(d)


def test_verify_closes_or_reopens_and_needs_new_data():
    d = tmpdir()
    try:
        s = S(d)
        [fid] = s.upsert([cand()], "scan")["new"]
        assert s.verify(fid, False, 3)["result"] == "skipped"                 # still open: nothing shipped
        s.set_status(fid, "in-progress", "x")
        assert s.verify(fid, False, 0)["result"] == "inconclusive"
        assert s.verify(fid, True, 2)["result"] == "reopened" and s.load()[fid]["status"] == "open"
        s.set_status(fid, "in-progress", "x")
        assert s.verify(fid, False, 2)["result"] == "verified"
    finally:
        cleanup(d)


def test_retention_prunes_only_closed_findings():
    d = tmpdir()
    try:
        old = S(d, NOW - timedelta(days=120))
        a, b = old.upsert([cand(key="a"), cand(key="b")], "scan")["new"]
        old.set_status(a, "verified", "x")
        assert S(d).prune(timedelta(days=90)) == 1 and list(S(d).load()) == [b]
    finally:
        cleanup(d)


def test_corrupt_store_line_names_file_and_line():
    d = tmpdir()
    try:
        (d / "findings.jsonl").write_text('{"id": "F-1"}\nnot json\n')
        try:
            S(d).load()
            raise AssertionError
        except st.StoreError as e:
            assert "findings.jsonl:2" in str(e)
        assert json  # noqa
    finally:
        cleanup(d)
