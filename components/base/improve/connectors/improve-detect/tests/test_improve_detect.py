"""improve-detect: detection and evidence resolution; secrets cut at an evidence boundary never leave a prefix."""
import json
import shutil

from helpers import clock, cleanup, connector_pkg, project, system, tmpdir
from improve_fixtures import CORES, SECRETS, git, make_git_repo, make_ledger, make_transcripts

from bay import connect

FINGERPRINT_VECTOR = ({"kind": "unused", "detector": {"key": "fn:app/core.py:never_called"}}, "62f5b3fa536c7238")


def test_fingerprint_matches_the_shared_vector():
    c, want = FINGERPRINT_VECTOR
    assert connector_pkg("improve-detect", "pipeline").fingerprint(c) == want


def inst(p):
    return connect.instantiate(system(p), "improve-local", "improve-detect", "improve.detect/v1", p, clock=clock)


def proj():
    root = tmpdir() / "cc"
    p = project({"connectors": {"claude-transcripts": {"root": str(root)}}})
    make_transcripts(root, p)
    make_ledger(p)
    return p


def test_sessions_returns_candidates_and_episode_summaries_and_writes_nothing():
    p = proj()
    try:
        before = sorted(x.relative_to(p) for x in p.rglob("*"))
        out = inst(p).sessions(since="7d")
        kinds = {c["kind"] for c in out["candidates"]}
        assert {"status-questions", "env-gap", "slow-step", "lintable-blocker"} <= kinds, kinds
        s = [e for e in out["episodes"] if e["kind"] == "session"][0]
        assert s["statusQuestions"] == 2 and s["tools"]["Bash"] == 3 and s["subagents"] == ["reviewer", "reviewer"]
        assert out["episodesTotal"] == len(out["episodes"]) and "claude-transcripts" in out["stats"]
        assert sorted(x.relative_to(p) for x in p.rglob("*")) == before
        assert all(c not in json.dumps(out) for c in CORES)
    finally:
        cleanup(p)


def test_resolve_checks_every_evidence_kind():
    p = proj()
    try:
        (p / "app.py").write_text("a\nb\n")
        head = None
        if shutil.which("git"):
            make_git_repo(p)
            head = git(p, "rev-parse", "HEAD")[:12]
        d = inst(p)
        ep = ["cc:0a1b2c3d-0000-4000-8000-000000000000", "cc:0a1b2c3d-0000-4000-8000-000000000001"]

        def f(ev, lens="artifacts", **kw):
            return {"lens": lens, "title": "t", "pattern": "p", "evidence": ev, **kw}

        res = d.resolve([
            f([{"kind": "file", "ref": "app.py:2"}]),
            f([{"kind": "file", "ref": "app.py:9"}]),
            f([{"kind": "file", "ref": "../../etc/passwd"}]),
            f([{"kind": "measurement", "ref": "tokens", "value": 9000}]),
            f([{"kind": "episode", "ref": e} for e in ep], lens="sessions"),
            f([{"kind": "episode", "ref": ep[0]}], lens="sessions"),
            f([{"kind": "commit", "ref": "deadbeefdeadbeef"}]),
            f([{"kind": "rule", "ref": "C-4"}, {"kind": "file", "ref": "app.py:1"}], rule="C-4"),
            *([f([{"kind": "commit", "ref": f"git:{head}"}])] if head else []),
        ])
        assert [r["index"] for r in res["rejected"]] == [1, 2, 3, 5, 6], res["rejected"]
        assert "measurement-only" in res["rejected"][2]["reasons"][-1]
        assert "not in the project's git" in res["rejected"][4]["reasons"][0]
        assert len(res["accepted"]) == (4 if head else 3) and res["accepted"][2]["scope"]["rule"] == "C-4"
    finally:
        cleanup(p)


def test_secret_on_an_evidence_cut_leaves_no_prefix():
    p = proj()
    try:
        call = p / ".agentbay/calls/C-20261025-000000.json"
        st = json.loads(call.read_text())
        st["steps"]["review"]["items"][0]["evidence"] = "x" * 290 + " " + SECRETS["api-key"]
        call.write_text(json.dumps(st))
        out = inst(p).sessions(since="7d")
        assert "sk-ant" not in json.dumps(out) and all(c not in json.dumps(out) for c in CORES)
    finally:
        cleanup(p)
