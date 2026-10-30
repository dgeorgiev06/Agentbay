"""The dead-code check (0008 item 1): improve.detect/v1.change audits the working tree and the tree at a base
revision and returns only the unused / unused-constant / compat-layer / complexity findings that are new; forge.extend
runs it as the `deadcode` step between implement and review."""
import subprocess
import textwrap
from datetime import datetime
from pathlib import Path

from helpers import KIT, cleanup, clock, kit_copy, project, system, tmpdir

from bay import dispatch
from bay.improve import graph
from bay.improve.pipeline import Pipeline

GIT = ["git", "-c", "user.name=t", "-c", "user.email=t@example.com"]


class FakeGraph:
    """artifacts.read/v1 over a directory, as artifact-graph serves it."""

    def __init__(self, root: Path):
        self.root = root

    def files(self, root="project"):
        return {"root": root, "files": graph.files(self.root)}

    def graph(self, root="project"):
        return {"root": root, **graph.build(self.root, KIT).as_dict()}

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
