"""The dead-code check (0008 item 1): improve.detect/v1.change audits the working tree and the tree at a base
revision and returns only the unused / unused-constant / compat-layer / complexity findings that are new; forge.extend
runs it as the `deadcode` step between implement and review."""
import subprocess
import textwrap
from datetime import datetime
from pathlib import Path

from helpers import KIT, cleanup, clock, connector_pkg, kit_copy, project, system, tmpdir

from bay import dispatch, graph

pipeline = connector_pkg("improve-detect", "pipeline")
detect_artifacts = pipeline.detect_artifacts
Pipeline = pipeline.Pipeline

GIT = ["git", "-c", "user.name=t", "-c", "user.email=t@example.com"]


class FakeGraph:
    """artifacts.read/v1 over a directory, as artifact-graph serves it."""

    def __init__(self, root: Path, kit: Path = KIT):
        self.root, self.kit = root, kit

    def files(self, root="project"):
        return {"root": root, "files": graph.files(self.root)}

    def graph(self, root="project"):
        return {"root": root, **graph.build(self.root, self.kit).as_dict()}

    def raw_text(self, path, root="project"):
        return (self.root / path).read_text()


def git(repo: Path, *args: str) -> str:
    return subprocess.run([*GIT, "-C", str(repo), *args], capture_output=True, text=True, check=True).stdout


def write(repo: Path, files: dict) -> None:
    for rel, text in files.items():
        p = repo / rel
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(textwrap.dedent(text))


BASE = {
    "pkg/core.py": "def used():\n    return 1\n\ndef old_dead():\n    return 2\n",
    "pkg/main.py": "from pkg.core import used\n\ndef main():\n    return used()\n\nif __name__ == '__main__':\n    main()\n",
}


def repo_at_base() -> Path:
    repo = tmpdir() / "repo"
    repo.mkdir()
    git(repo, "init", "-q", "-b", "main")
    write(repo, BASE)
    git(repo, "add", "-A")
    git(repo, "commit", "-q", "-m", "base")
    return repo


def change(repo: Path, base="HEAD") -> dict:
    pl = Pipeline({"artifact-graph": FakeGraph(repo)}, KIT, repo, {}, datetime(2026, 10, 30))
    return pl.change(base)


def test_an_unused_function_and_a_compat_alias_are_two_new_findings():
    repo = repo_at_base()
    try:
        write(repo, {
            "pkg/core.py": BASE["pkg/core.py"] + "\ndef brand_new_helper():\n    return 3\n",
            "pkg/main.py": BASE["pkg/main.py"].replace(
                "return used()", "return old_used()") + "\ndef old_used():\n    # alias for used until callers move\n"
                                                         "    return used()\n",
        })
        out = change(repo)
        found = sorted((c["kind"], c["detector"]["key"]) for c in out["new"])
        assert found == [("compat-layer", "pkg/main.py"), ("unused", "fn:pkg/core.py:brand_new_helper")], found
        assert out["existing"] == 1                                     # old_dead was already there
        assert "2 new dead-code finding(s)" in out["stopped"]
    finally:
        cleanup(repo)


def test_a_finding_that_existed_at_base_does_not_count():
    repo = repo_at_base()
    try:
        out = change(repo)
        assert out["new"] == [] and out["existing"] == 1 and "stopped" not in out
        # a different change that leaves old_dead alone still reports nothing
        write(repo, {"pkg/main.py": BASE["pkg/main.py"] + "\ndef extra():\n    return used()\n\nextra()\n"})
        assert change(repo)["new"] == []
    finally:
        cleanup(repo)


def test_the_base_may_be_any_revision_and_a_bad_one_is_refused():
    repo = repo_at_base()
    try:
        write(repo, {"pkg/core.py": BASE["pkg/core.py"] + "\ndef later_dead():\n    return 4\n"})
        git(repo, "add", "-A")
        git(repo, "commit", "-q", "-m", "second")
        assert [c["detector"]["key"] for c in change(repo, "HEAD~1")["new"]] == ["fn:pkg/core.py:later_dead"]
        assert change(repo, "HEAD")["new"] == []
        for bad in ("no-such-rev", "--output=x"):
            try:
                change(repo, bad)
            except ValueError as e:
                assert "base" in str(e) or "git archive" in str(e)
            else:
                raise AssertionError(bad)
    finally:
        cleanup(repo)


def test_an_unused_concept_that_existed_at_base_is_not_new_when_the_project_is_the_kit():
    k = kit_copy()
    try:
        iface = k / "framework/interfaces/orphan.thing.v1.yaml"
        iface.write_text((k / "framework/interfaces/improve.detect.v1.yaml").read_text()
                         .replace("name: improve.detect", "name: orphan.thing", 1))
        git(k, "init", "-q", "-b", "main")
        git(k, "add", "-A")
        git(k, "commit", "-q", "-m", "base")
        pl = Pipeline({"artifact-graph": FakeGraph(k, k)}, k, k, {}, datetime(2026, 10, 30))
        now = detect_artifacts.run(pl.artifacts("project"), {}, only="unused")
        keys = [c["detector"]["key"] for c in now]
        assert any(x.startswith("interface:orphan.thing") for x in keys), keys    # the concept is reported as unused
        out = pl.change("HEAD")
        assert out["new"] == [] and out["existing"] >= 1 and "stopped" not in out, out["new"]
    finally:
        cleanup(k)


def test_the_base_is_the_merge_base_not_the_moved_ref():
    repo = repo_at_base()
    try:
        git(repo, "branch", "feature")
        write(repo, {"pkg/core.py": "def used():\n    return 1\n"})          # main removes old_dead
        git(repo, "commit", "-q", "-am", "main removes dead code")
        git(repo, "checkout", "-q", "feature")                                 # the feature still has it
        out = change(repo, "main")
        assert out["new"] == [] and out["existing"] == 1, out
        assert any("merge-base" in w for w in out["warnings"]), out["warnings"]
    finally:
        cleanup(repo)


def test_a_base_that_does_not_resolve_says_to_fetch():
    repo = repo_at_base()
    try:
        try:
            change(repo, "origin/main")
        except ValueError as e:
            assert "fetch origin" in str(e), str(e)
        else:
            raise AssertionError("an unresolved base was accepted")
    finally:
        cleanup(repo)


def test_a_second_finding_with_the_same_fingerprint_is_new():
    repo = repo_at_base()
    real = detect_artifacts.run
    c = {"kind": "unused", "title": "Unused function dup", "detector": {"name": "unused", "key": "fn:a.py:dup"}}
    calls = []

    def fake(a, cfg=None, only=None, **kw):
        if only != "unused":
            return []
        calls.append(cfg["thresholds"]["maxFindingsPerDetector"])            # compared before any cap
        return [c] if a.root != repo else [c, dict(c)]
    try:
        pipeline.detect_artifacts.run = fake
        out = change(repo)
        assert len(out["new"]) == 1 and out["existing"] == 1 and min(calls) > 1000, (out, calls)
    finally:
        pipeline.detect_artifacts.run = real
        cleanup(repo)


def test_a_broken_archive_is_a_clear_error():
    repo = repo_at_base()

    def run(cmd, **kw):
        if "archive" in cmd:
            Path(cmd[cmd.index("-o") + 1]).write_bytes(b"not a tar file" * 100)
            return subprocess.CompletedProcess(cmd, 0, "", "")
        return subprocess.run(cmd, **kw)
    try:
        pl = Pipeline({"artifact-graph": FakeGraph(repo)}, KIT, repo, {}, datetime(2026, 10, 30), run=run)
        try:
            pl.change("HEAD")
        except ValueError as e:
            assert "cannot extract HEAD" in str(e) or "cannot extract" in str(e), str(e)
        else:
            raise AssertionError("a broken archive was accepted")
    finally:
        cleanup(repo)


def test_the_base_side_refuses_env_files_and_large_files():
    repo = repo_at_base()
    try:
        write(repo, {".env.local": "KEY=1\n"})
        (repo / "big.py").write_text("x = 1\n" + "# pad\n" * 200_000)
        git(repo, "add", "-f", "-A")
        git(repo, "commit", "-q", "-m", "env and big")
        out = change(repo)
        refused = [w for w in out["warnings"] if w.startswith("unreadable at base")]
        assert any(".env.local" in w for w in refused) or any("big.py" in w for w in refused), out["warnings"]
        assert not any(".env.local" in str(c) for c in out["new"])
    finally:
        cleanup(repo)


def test_a_new_finding_blocks_the_extend_call_before_review():
    k = kit_copy()
    try:
        d = dispatch.Dispatcher(system(k, k), k, clock=clock)
        d._invoke = lambda env, conn, iface, ep, args, **kw: \
            {"new": [{"kind": "unused"}], "existing": 0, "stopped": "1 new dead-code finding(s) against origin/main"}
        ok = {"status": "done", "summary": "s"}
        r = d.call("forge.extend", {"goal": "x change"})
        r = d.approve(d.submit(r["callId"], "propose", ok)["callId"], True)
        r = d.submit(r["callId"], "implement", ok)
        assert r["status"] == "blocked" and "dead-code" in r["reason"] and "next" not in r, r
    finally:
        cleanup(k)


def test_forge_extend_runs_deadcode_between_implement_and_review():
    p = project()
    try:
        feat = system(p).modes["forge"].features["extend"]
        ids = [s.id for s in feat.steps]
        assert ids.index("implement") + 1 == ids.index("deadcode") and ids.index("deadcode") + 1 == ids.index("review")
        step = feat.steps[ids.index("deadcode")]
        assert step.run == "improve.detect/v1.change"
    finally:
        cleanup(p)


def test_the_functions_the_complexity_check_flagged_stay_under_its_threshold():
    import ast

    da = detect_artifacts
    flagged = [("adapters/claude-code/claude_code.py", "ClaudeCodeAdapter._settings"),
               ("bay/guard.py", "Guard._bash"), ("connectors/ledger/ledger_sources.py", "ledger_verdicts"),
               ("bay/contenttypes.py", "_one"), ("bay/contenttypes.py", "check_mode_views"),
               ("bay/dispatch.py", "Dispatcher._plan")]
    for rel, qual in flagged:
        funcs = dict(da._functions(ast.parse((KIT / rel).read_text())))
        cc = da._branches(funcs[qual])
        assert cc <= da.DEFAULTS["maxComplexity"], f"{qual} has complexity {cc}"
