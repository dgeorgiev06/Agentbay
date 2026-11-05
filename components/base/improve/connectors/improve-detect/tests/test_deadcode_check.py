"""The dead-code check: improve.detect/v1.change returns only the findings new against the base revision."""
import subprocess
import textwrap
from datetime import datetime, timezone
from pathlib import Path

from types import SimpleNamespace

from helpers import KIT, cleanup, clock, connector_pkg, edit_yaml, kit_copy, project, system, tmpdir

from bay import dispatch, graph, standards

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
    pl = Pipeline({"artifact-graph": FakeGraph(repo)}, KIT, repo, {}, datetime(2026, 10, 30, tzinfo=timezone.utc))
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
        assert out["existing"] == 1
        assert "2 new dead-code finding(s)" in out["stopped"]
    finally:
        cleanup(repo)


def test_a_finding_that_existed_at_base_does_not_count():
    repo = repo_at_base()
    try:
        out = change(repo)
        assert out["new"] == [] and out["existing"] == 1 and "stopped" not in out
        write(repo, {"pkg/main.py": BASE["pkg/main.py"] + "\ndef extra():\n    return used()\n\nextra()\n"})
        assert change(repo)["new"] == []
    finally:
        cleanup(repo)


def test_a_finding_in_a_renamed_file_is_not_new():
    repo = repo_at_base()
    try:
        git(repo, "mv", "pkg/core.py", "pkg/base.py")
        write(repo, {"pkg/main.py": BASE["pkg/main.py"].replace("pkg.core", "pkg.base")})
        out = change(repo)
        assert out["new"] == [] and out["existing"] == 1 and "stopped" not in out, out["new"]
        write(repo, {"pkg/base.py": BASE["pkg/core.py"] + "\ndef fresh():\n    return 3\n"})
        assert [c["detector"]["key"] for c in change(repo)["new"]] == ["fn:pkg/base.py:fresh"]
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
        iface = k / "components/base/improve/interfaces/orphan.thing.v1.yaml"
        iface.write_text((k / "components/base/improve/interfaces/improve.detect.v1.yaml").read_text()
                         .replace("name: improve.detect", "name: orphan.thing", 1))
        git(k, "init", "-q", "-b", "main")
        git(k, "add", "-A")
        git(k, "commit", "-q", "-m", "base")
        pl = Pipeline({"artifact-graph": FakeGraph(k, k)}, k, k, {}, datetime(2026, 10, 30, tzinfo=timezone.utc))
        now = detect_artifacts.run(pl.artifacts("project"), {}, only="unused")
        keys = [c["detector"]["key"] for c in now]
        assert any(x.startswith("interface:orphan.thing") for x in keys), keys
        out = pl.change("HEAD")
        assert out["new"] == [] and out["existing"] >= 1 and "stopped" not in out, out["new"]
    finally:
        cleanup(k)


def test_the_base_is_the_merge_base_not_the_moved_ref():
    repo = repo_at_base()
    try:
        git(repo, "branch", "feature")
        write(repo, {"pkg/core.py": "def used():\n    return 1\n"})
        git(repo, "commit", "-q", "-am", "main removes dead code")
        git(repo, "checkout", "-q", "feature")
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
        calls.append(cfg["thresholds"]["maxFindingsPerDetector"])
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
        pl = Pipeline({"artifact-graph": FakeGraph(repo)}, KIT, repo, {}, datetime(2026, 10, 30, tzinfo=timezone.utc), run=run)
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
        real = d._invoke
        d._invoke = lambda env, conn, iface, ep, args, **kw: real(env, conn, iface, ep, args, **kw) if iface.startswith("forge.") else \
            {"new": [{"kind": "unused"}], "existing": 0, "stopped": "1 new dead-code finding(s) against origin/main"}
        ok = {"status": "done", "summary": "s"}
        r = d.call("forge.extend", {"goal": "x change"})
        r = d.approve(d.submit(r["callId"], "propose", ok)["callId"], True)
        r = d.submit(r["callId"], "implement", ok)
        assert r["status"] == "blocked" and "dead-code" in r["reason"] and "next" not in r, r
    finally:
        cleanup(k)


STUB_CHECKER = ("apiVersion: agentbay/v4\nkind: Connector\nmetadata:\n  name: {name}\n  description: A stub checker.\n"
                "spec:\n  implements: standards.check/v1\n  entry: stub.py\n")


def bind_stub_checkers(k: Path, names: list[str]) -> None:
    for name in names:
        folder = k / "components" / "base" / "forge" / "connectors" / name
        folder.mkdir(parents=True)
        (folder / "connector.yaml").write_text(STUB_CHECKER.format(name=name))
        (folder / "stub.py").write_text("def create(ctx):\n    return None\n")
    edit_yaml(k / "components" / "base" / "forge" / "envs" / "local-authoring.yaml",
              lambda doc: doc["spec"]["bind"].update({"standards.check/v1": names}))


def test_forge_extend_runs_deadcode_and_several_standards_checkers_between_implement_and_review():
    p = project()
    try:
        feat = system(p).modes["forge"].features["extend"]
        ids = [s.id for s in feat.steps]
        assert ids.index("implement") + 1 == ids.index("deadcode") and ids.index("deadcode") + 1 == ids.index("limits")
        assert ids[ids.index("limits"):] == ["limits", "standards", "review", "release", "release-standards"]
        assert feat.steps[ids.index("deadcode")].run == "improve.detect/v1.change"
        assert feat.steps[ids.index("limits")].run == "improve.detect/v1.limits"
        assert feat.steps[ids.index("limits")].with_["proposal"] == "$in.proposal|$steps.propose.artifacts"
    finally:
        cleanup(p)
    repo = k = kit_copy()
    calls, seen = [], []
    try:
        git(repo, "init", "-q", "-b", "main")
        write(repo, {"base.py": "a = 1\n"})
        git(repo, "add", "base.py")
        git(repo, "commit", "-q", "-m", "base")
        bind_stub_checkers(k, ["stub-a", "stub-b"])
        d = dispatch.Dispatcher(system(k, k), k, clock=clock)
        steps = system(k, k).modes["forge"].features["extend"].steps
        assert steps[ids.index("standards")].connectors == ["stub-a", "stub-b"]
        assert steps[ids.index("release-standards")].connectors == ["stub-a", "stub-b"]
        real = d._invoke

        def fake(env, conn, iface, ep, args, **kw):
            if iface.startswith("forge."):
                return real(env, conn, iface, ep, args, **kw)
            if iface != "standards.check/v1":
                return {"new": [], "existing": 0} if ep == "change" else {"problems": [], "notes": []}
            root = Path(args["root"])
            calls.append((conn, args["root"], args["configRoot"]))
            seen.append((root / ".agentbay").exists())
            row = {"file": "new.py", "line": 1, "rule": "X1", "message": "m"}
            return {"findings": [row] if conn == "stub-a" and (root / "new.py").exists() else []}
        d._invoke = fake
        ok = {"status": "done", "summary": "s"}
        first = d.call("forge.extend", {"goal": "x change"})["callId"]
        start = git(repo, "rev-parse", "HEAD").strip()
        assert d._load(first)["base"] == start
        write(repo, {"new.py": "x = 1\n", "later.py": "y = 2\n"})
        git(repo, "add", "later.py")
        git(repo, "commit", "-q", "-m", "later")
        r = d.approve(d.submit(first, "propose", ok)["callId"], True)
        r = d.submit(r["callId"], "implement", ok)
        assert r["status"] == "blocked" and "new.py:1 X1" in r["reason"] and "next" not in r, r
        assert [(c, root == config) for c, root, config in calls] == [
            ("stub-a", True), ("stub-a", False), ("stub-b", True), ("stub-b", False)]
        assert len({config for _, _, config in calls}) == 1 and not any(seen)
        assert not any(Path(root).exists() for _, root, _ in calls)
        again = d.call("forge.extend", {"goal": "x change", "replaces": first})["callId"]
        assert d._load(again)["base"] == start and d._load(first)["status"] == "blocked"
        assert git(repo, "rev-parse", "HEAD").strip() != start
        assert d._standards(None, None, {"callId": "C-1"}, {}, {})["stopped"].startswith("no base commit")
        replaced = {"callId": "C-2", "input": {"replaces": "C-1"}}
        assert "the call that call C-2 replaces had none" in d._standards(None, None, replaced, {}, {})["stopped"]
    finally:
        cleanup(repo)
        cleanup(k)
    standards_comparison_probe_and_stopped_checkers()


def standards_comparison_probe_and_stopped_checkers():
    rows = [{"file": "a.py", "rule": "r", "message": "m"}, {"file": "a.py", "rule": "r", "message": "m"}]
    assert standards.compare(rows, [{**rows[0], "file": "b.py"}], {"a.py": "b.py"}) == ([], 1)
    assert standards.compare(rows[:1], [rows[0]] * 2, {}) == ([rows[0]], 1)
    answer = {"code": SimpleNamespace(returncode=0, stdout="tool 1.0\n", stderr=""),
              "old": SimpleNamespace(returncode=0, stdout="tool 0.9\n", stderr=""),
              "none": SimpleNamespace(returncode=1, stdout="", stderr="No module named tool")}
    ran = []

    def run(cmd, **kw):
        ran.append((cmd, kw))
        return answer[cmd[-2]]
    tool = [{"module": "old", "version": "1.0"}, {"module": "code", "version": "1.0"}]
    problems, warnings = standards.probe([standards.Checker("c", tool)], Path("."), run)
    assert problems == [] and warnings == ["old is tool 0.9, the pin is 1.0"]
    tool = [{"module": "none", "version": "1.0"}]
    problems, _ = standards.probe([standards.Checker("c", tool, "pip install tool")], Path("."), run)
    assert problems == ["c: none is not installed; pip install tool"]
    assert all(cmd[1:3] == ["-I", "-m"] and kw["timeout"] and not kw.get("shell") for cmd, kw in ran)
    repo = repo_at_base()
    try:
        out = standards.check(repo, "HEAD", [standards.Checker("c")], lambda name, args: {
            "findings": [], "stopped": "timed out", "warnings": ["w"]})
        assert out["stopped"] == "c on the base: timed out; c on the tree: timed out" and out["warnings"] == ["w", "w"]
        try:
            standards.check(repo, "--output=x", [], None)
        except ValueError as e:
            assert "git revision" in str(e)
        else:
            raise AssertionError("a base that looks like an option was accepted")
        (repo / "link.py").symlink_to("pkg/core.py")
        out = standards.check(repo, "HEAD", [standards.Checker("c")], lambda name, args: {"findings": []})
        assert out["warnings"] == ["1 symlink(s) or special file(s) not copied to the working-tree check"]
    finally:
        cleanup(repo)


