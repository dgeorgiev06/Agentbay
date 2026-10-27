"""improve mode end to end (offline): fixture transcripts + ledger -> scan -> triage (reviewed) -> backlog report;
implement only for approved items behind a gate, writing only its own store; containment; planted secrets."""
import json
import subprocess
import sys

from helpers import KIT, clock, cleanup, kit_copy, kit_for, project, system, tmpdir
from improve_fixtures import CORES, make_ledger, make_transcripts

from bay import dispatch, ledger
from bay.adapters import get

FIXTURE_EVENTS = 18                                   # lines make_ledger writes


def proj(keep_text=False, transcripts=True):
    root = tmpdir() / "cc"
    root.mkdir()
    p = project({"connectors": {"claude-transcripts": {"root": str(root), **({"keepText": True} if keep_text else {})}}})
    if transcripts:
        make_transcripts(root, p)
    make_ledger(p)
    return p


def D(p, kit=None):
    return dispatch.Dispatcher(system(p, kit), p, clock=clock)


def findings(p):
    f = p / ".agentbay/data/improve/findings.jsonl"
    return [json.loads(x) for x in f.read_text().splitlines()] if f.exists() else []


def snapshot(root):
    skip = (".agentbay/ledger", ".agentbay/calls", ".agentbay/data/improve")
    return {str(x.relative_to(root)): x.read_bytes() for x in root.rglob("*")
            if x.is_file() and not str(x.relative_to(root)).startswith(skip)}


def no_secrets_anywhere(p, *outputs):
    """The store, reports, caches, call state and ledger lines written by agentbay (the fixture's own ledger
    lines and call files are inputs and do contain the planted secrets) and every call output."""
    fixture_calls = {f"C-20261025-00000{i}.json" for i in range(3)}
    files = [x for x in (p / ".agentbay").rglob("*") if x.is_file() and x.name not in fixture_calls
             and x.name != "events.jsonl"]
    blob = "".join(x.read_text(errors="replace") for x in files)
    blob += "".join(x for x in (p / ".agentbay/ledger/events.jsonl").read_text().splitlines(True)[FIXTURE_EVENTS:])
    blob += json.dumps(outputs)
    leaked = [c for c in CORES if c in blob]
    assert not leaked, leaked


def scan(d, patterns=None):
    r = d.call("improve.scan", {"since": "7d"})
    assert r["status"] == "needs-agent" and r["next"]["role"] == "improve-analyst", r
    return r, d.submit(r["callId"], "patterns", {"findings": patterns or []})


def verdict_for(plan, ids_fail=()):
    rv = plan["review"]
    ids = [x["id"] for x in rv["definitionOfDone"]] + [x["id"] for x in rv["rules"]]
    return {"items": [{"id": i, "verdict": "fail" if i in ids_fail else "pass", "evidence": "checked the refs",
                       **({"severity": "blocker"} if i in ids_fail else {})} for i in ids]}


def test_mode_and_env_containment():
    p = proj(transcripts=False)
    try:
        s = system(p)
        m = s.modes["improve"]
        assert set(m.features) == {"scan", "audit", "triage", "backlog", "implement", "verify"}
        assert m.features["triage"].review["when"] == "always" and m.features["implement"].review["model"] == "opus"
        assert [st.kind for st in m.features["implement"].steps] == ["code", "role", "review", "gate", "code"]
        assert m.features["scan"].review is None and m.coordinator == "improve-lead"
        env = s.env("improve-local").spec
        assert env["network"]["allow"] == [] and env["fs"]["write"] == [".agentbay/data/improve"]
        assert set(env["effects"]) == {"read", "write"} and "secrets" not in env
        assert s.roles["improve-analyst"].bay_uses == ["improve.findings/v1.query", "session.events/v1.episodes"]
        assert set(s.roles["auditor"].bay_uses) == {"improve.findings/v1.query", "artifacts.read/v1.files",
                                                      "artifacts.read/v1.graph", "artifacts.read/v1.text"}
        get("claude-code").build(s, p, kit_for(p))
        pol = json.loads((p / ".agentbay/guard.json").read_text())["subagents"]
        for role in ("improve-analyst", "auditor"):
            assert pol[role]["read"] == ["."] and pol[role]["write"] == [], pol[role]   # no ~/.claude for roles
        d = D(p)
        for role, target in (("auditor", "session.events/v1.episodes"), ("improve-analyst", "improve.findings/v1.upsert"),
                             ("improve-analyst", "improve.detect/v1.sessions"),
                             ("auditor", "improve.findings/v1.decide"), ("improve-lead", "improve.findings/v1.handoff")):
            try:
                d.use(role, target, {})
                raise AssertionError(f"{role} reached {target}")
            except dispatch.CallError as e:
                assert "not granted" in str(e)
        assert "findings" in d.use("improve-analyst", "improve.findings/v1.query", {})
        merged = d.use("improve-analyst", "session.events/v1.episodes", {"since": "7d"})       # 3 connectors merged
        assert {e["source"] for e in merged["episodes"]} == {"ledger"}
        assert set(merged["stats"]) == {"ledger", "claude-transcripts", "git"}
        payload = {"tool_name": "Read", "tool_input": {"file_path": str(p.parent / "cc" / "x.jsonl")},
                   "agent_type": "auditor", "agent_id": "a1", "cwd": str(p)}
        r = subprocess.run([sys.executable, str(KIT / "bay/guard.py")], input=json.dumps(payload), text=True,
                           capture_output=True, env={"CLAUDE_PROJECT_DIR": str(p), "PATH": "/usr/bin:/bin"})
        assert r.returncode == 2 and "may only read inside" in r.stdout          # transcripts unreachable for roles
    finally:
        cleanup(p)


def test_scan_triage_backlog_on_fixture_transcripts_and_ledger():
    p = proj()
    try:
        d = D(p)
        r, done = scan(d, patterns=[
            {"lens": "sessions", "title": "Reviewer re-spawned after denials", "pattern": "denial then reviewer",
             "evidence": [{"kind": "episode", "ref": "cc:0a1b2c3d-0000-4000-8000-000000000000"},
                          {"kind": "episode", "ref": "cc:0a1b2c3d-0000-4000-8000-000000000001"}]},
            {"lens": "sessions", "title": "Invented", "pattern": "x", "evidence": [{"kind": "episode", "ref": "cc:nope"},
                                                                                     {"kind": "episode", "ref": "ab:C-x"}]},
            {"lens": "sessions", "title": "One episode only", "pattern": "x",
             "evidence": [{"kind": "episode", "ref": "ab:C-20261025-000000"}]}])
        detect = r["next"]["previous"]["detect"]
        assert detect["stats"]["claude-transcripts"]["unknownRecordTypes"] == {"weird-new-type": 2}
        sess = [e for e in detect["episodes"] if e["kind"] == "session"]           # the analyst sees episodes
        assert len(sess) == 2 and sess[0]["statusQuestions"] == 2 and sess[0]["envGaps"] == {"command-not-found": 1}
        assert r["next"]["previous"]["store"]["summary"] and "--usage" in r["next"]["submit"]
        assert done["status"] == "done", done
        assert len(done["output"]["new"]) == 1 and [x["index"] for x in done["output"]["rejected"]] == [1, 2]
        kinds = {f["kind"] for f in findings(p)}
        assert kinds >= {"review-rounds", "rule-repeat", "lintable-blocker", "out-of-scope", "instruction-change",
                         "slow-step", "costly-step", "retry-loop", "permission-friction", "interrupts",
                         "status-questions", "env-gap", "pattern"}, kinds
        for f in findings(p):
            eps = {e["ref"] for e in f["evidence"] if e["kind"] == "episode"}
            assert len(eps) >= 2 or f["severity"] == "severe", f
        # triage: links + priority, analyst annotations, review, then apply
        t = d.call("improve.triage", {"top": 3})
        assert t["status"] == "needs-agent" and t["next"]["step"] == "analyze"
        top = t["next"]["previous"]["rank"]["top"]
        assert len(top) == 3 and top[0]["priority"] >= top[-1]["priority"]
        ann = [{"id": f["id"], "rootCause": "No deterministic check runs before review, so the reviewer finds it.",
                "proposedFix": "Add a lint_clean check to the rule and a test.", "route": "forge.extend", "effort": 2,
                "evidenceChecked": [f["evidence"][0]["ref"]]} for f in top]
        rv = d.submit(t["callId"], "analyze", {"annotations": ann})
        assert rv["next"]["kind"] == "review" and rv["next"]["review"]["output"]["annotations"] == ann
        fin = d.submit(t["callId"], "review", verdict_for(rv["next"]))
        assert fin["status"] == "done" and sorted(fin["output"]["annotated"]) == sorted(a["id"] for a in ann)
        # backlog report
        b = d.call("improve.backlog", {})
        assert b["status"] == "done" and b["output"]["report"] == ".agentbay/data/improve/reports/2026-W44.md"
        text = (p / b["output"]["report"]).read_text()
        assert text.count("\n## ") == len(b["output"]["items"]) == 10
        assert "No deterministic check runs before review" in text and "bay improve decide" in text
        no_secrets_anywhere(p, r, done, t, rv, fin, b)
    finally:
        cleanup(p)


def test_failed_triage_review_stores_nothing():
    p = proj()
    try:
        d = D(p)
        scan(d)
        t = d.call("improve.triage", {"top": 1})
        f = t["next"]["previous"]["rank"]["top"][0]
        rv = d.submit(t["callId"], "analyze", {"annotations": [{"id": f["id"], "rootCause": "the symptom again here",
                                                                 "proposedFix": "fix it somehow", "route": "none",
                                                                 "effort": 1, "evidenceChecked": ["ab:C-made-up"]}]})
        fin = d.submit(t["callId"], "review", verdict_for(rv["next"], ids_fail=("DOD-1",)))
        assert fin["status"] == "partial" and "rootCause" not in [x for x in findings(p) if x["id"] == f["id"]][0]
    finally:
        cleanup(p)


def test_implement_only_for_approved_items_behind_a_gate_and_edits_nothing():
    p = proj()
    try:
        d = D(p)
        scan(d)
        fid = [f for f in findings(p) if f["kind"] == "lintable-blocker"][0]["id"]
        r = d.call("improve.implement", {"id": fid})
        assert r["status"] == "blocked" and "approved" in r["reason"]
        d.run_capability("improve", "improve.findings/v1.decide", {"id": fid, "decision": "approve", "by": "user@tty"})
        before = snapshot(p)
        r = d.call("improve.implement", {"id": fid})
        assert r["status"] == "needs-agent" and r["next"]["step"] == "draft"
        assert r["next"]["previous"]["claim"]["finding"]["id"] == fid
        draft = {"route": "forge.extend", "title": "Run the test suite as a check before forge.extend review",
                 "problem": "Review blockers cite failing tests in 3 of 3 rounds.",
                 "change": "Add a tests_pass check and reference it from forge.extend R-7.",
                 "evidence": ["ab:C-20261025-000000"], "tests": ["tests/test_forge.py::test_tests_pass_check"]}
        rv = d.submit(r["callId"], "draft", draft)
        assert rv["next"]["kind"] == "review" and rv["next"]["model"] == "opus"
        g = d.submit(rv["callId"], "review", verdict_for(rv["next"]))
        assert g["status"] == "awaiting-approval" and g["next"]["step"] == "approve" and "submit" not in g["next"]
        try:
            d.submit(g["callId"], "approve", {"approved": True})
            raise AssertionError("agents cannot pass the gate")
        except dispatch.CallError:
            pass
        out = d.approve(g["callId"], True, by="user@tty")
        assert out["status"] == "done", out
        nxt = out["output"]["next"]
        assert nxt["call"] == "forge.extend" and "## Problem" in nxt["input"]["context"]
        assert (p / ".agentbay/data/improve/handoffs" / out["output"]["draft"]).exists()
        assert [f for f in findings(p) if f["id"] == fid][0]["status"] == "in-progress"
        assert snapshot(p) == before                                  # nothing outside improve's store changed
        v = d.call("improve.verify", {"id": fid})
        assert v["status"] == "done" and v["output"]["result"] == "inconclusive"      # no episodes since the fix
        # a new forge.extend review after the fix still cites failing tests -> reopened
        cid = "C-20261028-000009"
        (p / f".agentbay/calls/{cid}.json").write_text(json.dumps({
            "callId": cid, "target": "forge.extend", "input": {"proposal": "docs/proposals/0003.md"},
            "steps": {"review": {"items": [{"id": "DOD-5", "verdict": "fail", "severity": "blocker",
                                            "evidence": "python3 tests/run.py: 1 failed"}]}}}))
        with open(p / ".agentbay/ledger/events.jsonl", "a") as fh:
            fh.write(json.dumps({"v": 1, "ts": "2026-10-28T09:00:00+00:00", "type": "call.completed", "runId": cid,
                                 "callId": cid, "mode": "forge", "endpoint": "extend"}) + "\n")
        dd = dispatch.Dispatcher(system(p), p, clock=lambda: clock().replace(day=28, hour=12))
        v = dd.call("improve.verify", {"id": fid})
        assert v["output"]["result"] == "reopened" and v["output"]["newData"] == 1
    finally:
        cleanup(p)


def test_decide_cli_approve_needs_a_terminal():
    p = proj(transcripts=False)
    try:
        scan(D(p))
        fid = findings(p)[0]["id"]

        def cli(*a):
            return subprocess.run([sys.executable, str(KIT / "bay/cli.py"), "--project", str(p), *a],
                                  capture_output=True, text=True, input="yes\n")
        r = cli("improve", "decide", fid, "approve")
        assert r.returncode != 0 and "interactive terminal" in r.stderr
        assert [f for f in findings(p) if f["id"] == fid][0]["status"] == "open"
        r = cli("improve", "decide", fid, "defer", "--note", "next quarter")
        assert r.returncode == 0, r.stderr
        f = [f for f in findings(p) if f["id"] == fid][0]
        assert f["status"] == "deferred" and f["history"][-1]["by"] == "cli"
        assert any((e.get("data") or {}).get("kind") == "decision" for e in ledger.read(p))
    finally:
        cleanup(p)


def test_weekly_writes_the_backlog_only_after_the_analysis_steps():
    p = proj(transcripts=False)
    try:
        def weekly():
            r = subprocess.run([sys.executable, str(KIT / "bay/cli.py"), "--project", str(p), "improve", "weekly"],
                               capture_output=True, text=True)
            assert r.returncode == 0, r.stderr
            return json.loads(r.stdout)
        out = weekly()
        assert out["status"] == "pending" and [c["target"] for c in out["calls"]] == \
            ["improve.scan", "improve.audit", "improve.triage"]
        assert all(c["status"] == "needs-agent" for c in out["calls"]) and "improve.backlog" in out["next"][-1]
        assert "--usage" in out["calls"][0]["next"]["submit"]
        assert not (p / ".agentbay/data/improve/reports").exists()               # no report before the analysis
        # when nothing is pending, weekly writes the report itself
        import contextlib
        import io
        from bay import cli
        old, cli.WEEKLY = cli.WEEKLY, ()
        buf = io.StringIO()
        try:
            with contextlib.redirect_stdout(buf):
                cli.main(["--project", str(p), "improve", "weekly"])
        finally:
            cli.WEEKLY = old
        res = json.loads(buf.getvalue())
        assert res["status"] == "done" and res["calls"][-1]["target"] == "improve.backlog"
        assert (p / res["calls"][-1]["output"]["report"]).exists()
    finally:
        cleanup(p)


def test_forge_reviewers_get_the_conformance_rules():
    k = kit_copy()
    try:
        d = dispatch.Dispatcher(system(k, k), k, clock=clock)
        r = d.call("forge.create", {"kind": "role", "name": "summarizer", "intent": "Summarizes things"})
        rv = d.submit(r["callId"], "fill", {"status": "done", "summary": "filled the role"})
        conf = rv["next"]["review"]["rulesets"]["conformance"]
        assert [c["id"] for c in conf][:2] == ["C-1", "C-2"] and conf[0]["check"] == "playbook_matches_workflow"
    finally:
        cleanup(k)


def test_audit_on_the_kit_itself():
    k = kit_copy()
    try:
        d = dispatch.Dispatcher(system(k, k), k, clock=clock)
        r = d.call("improve.audit", {})
        assert r["status"] == "needs-agent" and r["next"]["role"] == "auditor"
        detect = r["next"]["previous"]["detect"]
        assert {m["id"] for m in detect["manual"]} == {"C-8", "C-9", "C-10"}
        assert detect["stats"]["conformanceRules"] == ["C-1", "C-2", "C-3", "C-4", "C-5", "C-6", "C-7"]
        out = d.submit(r["callId"], "judge", {"findings": [
            {"lens": "artifacts", "title": "Role prompt restates the feature rules", "pattern": "C-9",
             "rule": "C-9", "evidence": [{"kind": "file", "ref": "framework/roles/builder.yaml:12"}]},
            {"lens": "artifacts", "title": "Bad ref", "pattern": "x", "evidence": [{"kind": "file", "ref": "nope.py:3"}]}]})
        assert out["status"] == "done" and len(out["output"]["new"]) == 1 and out["output"]["rejected"][0]["index"] == 1
        fs = findings(k)
        c6 = [f for f in fs if f["kind"] == "conformance" and f["scope"]["rule"] == "C-6"]
        assert {f["evidence"][1]["ref"].split(":")[0] for f in c6} == {"modes/feed-briefing/mode.yaml"}
        assert all(f["lens"] == "artifacts" and f["evidence"] for f in fs)
    finally:
        cleanup(k)


def test_improve_role_shims_follow_the_kit_script_pattern():
    p = proj(transcripts=False)
    try:
        get("claude-code").build(system(p), p, kit_for(p))
        for role in ("improve-analyst", "auditor"):
            sh = (p / f".agentbay/roles/{role}/use").read_text()
            assert "python3 -E" in sh and "bay/use_shim.py" in sh and "python3 -c" not in sh, sh
        (p / "yaml.py").write_text("raise SystemExit('project code ran')\n")    # must never be imported
        r = subprocess.run([str(p / ".agentbay/roles/improve-analyst/use"), "improve.findings/v1.query", "{}"],
                           cwd=p, capture_output=True, text=True)
        assert r.returncode == 0 and json.loads(r.stdout)["findings"] == [], r.stderr
        r = subprocess.run([str(p / ".agentbay/roles/improve-analyst/use"), "improve.findings/v1.scan", "{}"],
                           cwd=p, capture_output=True, text=True)
        assert r.returncode != 0 and "not granted" in r.stderr
    finally:
        cleanup(p)
