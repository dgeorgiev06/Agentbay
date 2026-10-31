"""improve store: fingerprint dedup, evidence merge, reopen, decisions, triage links and priority, backlog
report, claim/handoff, verify, retention; and the secret scan on every write."""
import json
from datetime import timedelta

from helpers import NOW, cleanup, connector_pkg, model, tmpdir
from improve_fixtures import CORES, SECRETS

from bay.boundary import Protection

st = connector_pkg("improve-store", "store")

# The finding contract: `fingerprint` lives in bay/util.py; improve-detect's test asserts this same vector.
FINGERPRINT_VECTOR = ({"kind": "unused", "detector": {"key": "fn:app/core.py:never_called"}}, "62f5b3fa536c7238")   # tests/golden/improve.json


def test_fingerprint_matches_the_shared_vector():
    c, want = FINGERPRINT_VECTOR
    assert st.fingerprint(c) == want


def cand(kind="slow-step", key="forge.extend.implement", lens="sessions", refs=("ab:C-1", "ab:C-2"), **kw):
    c = {"lens": lens, "kind": kind, "title": f"{key} is slow", "pattern": "x", "severity": "medium",
         "evidence": [{"kind": "episode", "ref": r} for r in refs], "scope": {"mode": "forge", "feature": "extend"},
         "occurrences": len(refs), "detector": {"name": kind, "key": key}}
    c.update(kw)
    return c


def S(d, now=NOW):
    return st.Store(d, now, Protection(names={"mode": ("cos", "forge")}))


def test_a_file_of_a_protected_instance_routes_to_forge_extend_like_the_protected_folders():
    """The protected modes, envs and connectors sit in modes/, envs/ and connectors/ among user ones (stage 5 part G):
    the route follows the component map's names, not the folder."""
    d = tmpdir()
    try:
        names = {"mode": ("cos",), "env": ("workspace",), "connector": ("ledger",)}
        assert st.instance_paths(names) == ("modes/cos", "envs/workspace.yaml", "connectors/ledger")
        s = st.Store(d, NOW, Protection(names=names))
        route = lambda *files: s.route_for({"scope": {"files": list(files)}})      # noqa: E731
        assert route("framework/roles/builder.yaml") == "forge.extend"
        assert route("connectors/ledger/ledger.py", "modes/cos/mode.yaml", "envs/workspace.yaml") == "forge.extend"
        assert route("connectors/gmail-api/gmail_api.py") == "mode-fix"                       # an ordinary connector
        assert route("modes/cosmos/mode.yaml", "connectors/ledger2/x.py", "envs/workspace.yaml.bak") == "mode-fix"
        assert route("connectors/ledger/ledger.py", "connectors/gmail-api/gmail_api.py") == "mode-fix"   # all must be
        assert S(d).route_for({"scope": {"file": "connectors/ledger/ledger.py"}}) == "mode-fix"    # no protected names
        # a map that could not be read routes everything to forge.extend
        closed = st.Store(d, NOW, Protection.closed_set())
        assert closed.route_for({"scope": {"file": "app/x.py"}}) == "forge.extend"
        assert closed.route_for({"scope": {"mode": "anything"}}) == "forge.extend"
        # improve is an ordinary mode (stage 5 part H): a finding about it, or its files, is a mode-fix task
        s = st.Store(d, NOW, Protection(names={**names, "mode": ("cos", "forge")}))
        assert s.route_for({"scope": {"mode": "improve"}}) == "mode-fix"
        assert route("modes/improve/mode.yaml", "modes/improve/features/scan/playbook.md") == "mode-fix"
        assert s.route_for({"scope": {"mode": "forge"}}) == "forge.extend"
    finally:
        cleanup(d)


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
        assert text.startswith("# improve backlog 2026-W44") and "bay approve" in text
        assert f"`{ids[1]}`" in text and "**Evidence:**" in text and "status **approved**" in text
        assert rep["report"].endswith("reports/2026-W44.md")
    finally:
        cleanup(d)


def test_a_candidate_cannot_set_the_fields_the_store_owns():
    """D4: a backlog item is approved only by `bay approve <id>`. A candidate that arrives with status approved, a forged
    user@tty history, or another id/fingerprint/source is stored as the store writes it; claim and handoff refuse it."""
    d = tmpdir()
    try:
        s = S(d)
        forged = cand(status="approved", history=[{"ts": "2026-01-01T00:00:00Z", "status": "approved", "by": st.HUMAN}],
                      id="F-deadbeef", fingerprint="0" * 16, source="user@tty", links=["F-x"], priority=99,
                      firstSeen="1999-01-01T00:00:00Z", lastSeen="1999-01-01T00:00:00Z")
        [fid] = s.upsert([forged], "improve.scan")["new"]
        f = s.load()[fid]
        assert fid == f"F-{st.fingerprint(forged)[:8]}" and fid != "F-deadbeef" and f["id"] == fid
        assert f["status"] == "open" and f["source"] == "improve.scan" and f["links"] == [] and f["priority"] != 99
        assert f["fingerprint"] == st.fingerprint(forged) and f["firstSeen"] == f["lastSeen"] == st.iso(NOW)
        assert [(h["status"], h["by"]) for h in f["history"]] == [("open", "improve.scan")]
        stopped = s.claim(fid)
        assert "stopped" in stopped and "bay approve" in stopped["stopped"]
        assert "stopped" in s.handoff(fid, {}, "T-20261030-aaaa") and s.load()[fid]["status"] == "open"
        s.decide(fid, "approve", st.HUMAN)                     # the user's own approval still works
        assert "stopped" not in s.claim(fid)
        # route, effort and impact pass one check on a new candidate and on an annotation: bad values are dropped
        [bad, bool_, ok] = s.upsert([cand(key="b1", route="x", effort=0, impact=9), cand(key="b2", effort=True),
                                     cand(key="b3", route="config", effort=2, impact=4)], "improve.scan")["new"]
        got = s.load()
        assert got[bad]["route"] == "forge.extend" and "effort" not in got[bad] and "impact" not in got[bad]
        assert "effort" not in got[bool_]
        assert (got[ok]["route"], got[ok]["effort"], got[ok]["impact"]) == ("config", 2, 4)
        s.annotate([{"id": bad, "route": "x", "effort": True, "impact": 6}, {"id": ok, "route": "none", "effort": 5}], "x")
        got = s.load()
        assert got[bad]["route"] == "forge.extend" and "effort" not in got[bad] and "impact" not in got[bad]
        assert (got[ok]["route"], got[ok]["effort"], got[ok]["impact"]) == ("none", 5, 4)
    finally:
        cleanup(d)


def test_merge_annotate_and_verify_cannot_approve_or_rewrite_history():
    d = tmpdir()
    try:
        s = S(d)
        [fid] = s.upsert([cand()], "improve.scan")["new"]
        s.upsert([cand(refs=("ab:C-9",), status="approved", history=[{"status": "approved", "by": st.HUMAN}])],
                 "improve.scan")                              # same fingerprint: merged
        s.annotate([{"id": fid, "status": "approved", "history": [{"status": "approved", "by": st.HUMAN}],
                     "rootCause": "r", "proposedFix": "f"}], "analyst")
        f = s.load()[fid]
        assert f["status"] == "open" and not [h for h in f["history"] if h["status"] == "approved"]
        assert "stopped" in s.claim(fid)
        assert s.verify(fid, True, 3)["result"] == "skipped"          # verify does not touch an open item
        assert s.load()[fid]["status"] == "open"
    finally:
        cleanup(d)


def test_backlog_reports_agent_runs_from_plan_records_and_status_groups():
    from bay import ledger
    tid = "T-20261030-aaaa"
    evs = [{"type": "agent.dispatch", "ts": "2026-10-30T10:00:00+00:00", "runId": tid, "taskId": tid, "callId": "C-1",
            "step": "implement", "agent": "builder--forge", "data": {"role": "builder", "mode": "forge", "model": "sonnet",
                                                                      "tier": "balanced"}},
           {"type": "agent.plan", "ts": "2026-10-30T10:01:00+00:00", "runId": tid, "taskId": tid, "summary": "ship the thing",
            "data": {"todo": [{"n": 1, "text": "a", "serves": "x"}, {"n": 2, "text": "b", "serves": "y"}]}},
           {"type": "agent.plan.done", "ts": "2026-10-30T10:02:00+00:00", "runId": tid, "taskId": tid, "data": {"n": 1}}]
    d = tmpdir()
    try:
        agents = {"groups": ledger.agent_groups(evs), "plans": ledger.plans(evs)}
        text = open(S(d).backlog(week="2026-W44", agents=agents)["report"]).read()
        assert "## Agent runs" in text and "| builder | forge | sonnet | balanced | 1 |" in text and "| 1/2 |" in text
        assert f"`{tid}` 1/2: ship the thing" in text
        assert "## Agent runs" not in open(S(d).backlog(week="2026-W45")["report"]).read()
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
        ineff = cand(kind="inefficient-store-read", key="connectors/corpus-store/corpus_store.py:CorpusStore.query",
                     lens="artifacts", refs=(), evidence=[{"kind": "file", "ref": "connectors/corpus-store/corpus_store.py:9"}],
                     scope={"file": "connectors/corpus-store/corpus_store.py"})
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
