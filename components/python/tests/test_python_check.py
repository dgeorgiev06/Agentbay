"""python-check: ruff and mypy findings against the call's start commit, and the planted-config proofs."""
import json
import subprocess
import sys
import unittest
from pathlib import Path
from types import SimpleNamespace

import yaml

from helpers import KIT, cleanup, connector_pkg, load_module, tmpdir

from bay import standards

COMMENTS_CASES = KIT / "components/comments/tests/comments_cases.py"
REAL_RUN = standards.run_module
python_check = connector_pkg("python-check", "python_check")
LANGUAGE = yaml.safe_load((KIT / "components/python/component.yaml").read_text())["spec"]["language"]
PINS = {tool["module"]: f"{tool['module']} {tool['version']}\n" for tool in LANGUAGE["tools"]}
GIT = ["git", "-c", "user.name=t", "-c", "user.email=t@example.com"]
INLINE = "x = 1  # mypy: ignore-errors\ny: int = 'a'  # type: ignore[assignment]\nz = '# mypy: not a comment'\n"


def done(code: int, out: str = "", err: str = "") -> SimpleNamespace:
    return SimpleNamespace(returncode=code, stdout=out, stderr=err)


class FakeTools:
    """The subprocess runner behind standards.run_module: canned ruff and mypy JSON for the files of the folder."""

    def __init__(self, versions=None, behaviour=None):
        self.versions = {**PINS, **(versions or {})}
        self.behaviour = behaviour or {}
        self.calls = []

    def __call__(self, cmd, **kw):
        self.calls.append((cmd, kw))
        module, cwd, how = cmd[3], Path(kw["cwd"]), self.behaviour.get(cmd[3])
        if cmd[-1] == "--version":
            return done(1, "", f"No module named {module}") if how == "missing" else done(0, self.versions[module])
        if how == "timeout":
            raise subprocess.TimeoutExpired(cmd, kw["timeout"])
        if how == "exit2":
            return done(2, "", "boom")
        if how == "empty":
            return done(1)
        files = sorted(cwd.glob("*.py"))
        return done(1, self.ruff_json(files) if module == "ruff" else self.mypy_json(files))

    @staticmethod
    def ruff_json(files) -> str:
        return json.dumps([{"code": "F401" if p.name == "new.py" else "E501", "message": "m", "filename": str(p),
                            "location": {"row": len(p.read_text().split("\n"))}} for p in files])

    @staticmethod
    def mypy_json(files) -> str:
        rows = [{"file": p.name, "line": len(p.read_text().split("\n")), "code": "no-untyped-def",
                 "message": "Function is missing a type annotation", "severity": "error"} for p in files]
        if not rows:
            return ""
        return "\n".join(json.dumps(r) for r in rows + [{**rows[0], "severity": "note"}])


def use(tools: FakeTools) -> None:
    standards.run_module = lambda module, args, cwd, timeout, run=None: REAL_RUN(module, args, cwd, timeout, tools)


def checker() -> standards.Checker:
    return standards.Checker("python-check", LANGUAGE["tools"], LANGUAGE["install"])


def flag_values(tools: FakeTools, flag: str) -> set[str]:
    return {cmd[cmd.index(flag) + 1] for cmd, _ in tools.calls if flag in cmd}


def git(repo: Path, *args: str) -> None:
    subprocess.run([*GIT, "-C", str(repo), *args], capture_output=True, check=True)


def compare_with_the_start_commit() -> None:
    repo = tmpdir() / "repo"
    repo.mkdir()
    try:
        git(repo, "init", "-q", "-b", "main")
        (repo / "a.py").write_text("x = 1\n")
        (repo / "mypy.ini").write_text("[mypy]\nstrict = True\n")
        git(repo, "add", "-A")
        git(repo, "commit", "-q", "-m", "base")
        git(repo, "mv", "a.py", "b.py")
        (repo / "b.py").write_text("\nx = 1\n")
        (repo / "new.py").write_text("import os\n")
        (repo / "mypy.ini").write_text("[mypy]\nstrict = False\n")
        (repo / "ruff.toml").write_text("line-length = 1\n")
        tools = FakeTools()
        use(tools)
        check = python_check.create(SimpleNamespace(kit=KIT, project=repo))
        out = standards.check(repo, "HEAD", [checker()], lambda name, args: check.findings(**args))
        assert sorted((r["file"], r["rule"]) for r in out["new"]) == [("new.py", "F401"), ("new.py", "no-untyped-def")]
        assert out["existing"] == 2 and "2 new standards finding(s)" in out["stopped"], out
        assert flag_values(tools, "--config") == {str(KIT / "components/python/ruff.toml")}
        mypy_config = flag_values(tools, "--config-file")
        assert len(mypy_config) == 1 and mypy_config.pop().endswith("/base/mypy.ini")
        for cmd, kw in tools.calls:
            assert cmd[1:3] == ["-I", "-m"] and kw["timeout"] and not kw.get("shell"), cmd
            assert "agentbay-standards-" in str(kw["cwd"]) and not Path(kw["cwd"]).exists(), kw["cwd"]
        use(FakeTools(versions={"ruff": "ruff 0.16.9\n"}))
        out = standards.check(repo, "HEAD", [checker()], lambda name, args: check.findings(**args))
        assert "ruff is ruff 0.16.9, the pin is 0.17.3" in out["warnings"]
        use(FakeTools(behaviour={"mypy": "missing"}))
        out = standards.check(repo, "HEAD", [checker()], lambda name, args: check.findings(**args))
        assert out["stopped"] == "python-check: mypy is not installed; pip install -r requirements-dev.txt", out
    finally:
        cleanup(repo)


def stopped_tools_and_inline_comments() -> None:
    tree = tmpdir()
    (tree / "m.py").write_text(INLINE)
    check = python_check.create(SimpleNamespace(kit=KIT, project=tree))
    for module, how, why in (("ruff", "exit2", "ruff exited with 2"), ("ruff", "timeout", "ruff did not finish"),
                             ("ruff", "empty", "ruff printed no JSON array"), ("mypy", "exit2", "mypy exited with 2"),
                             ("mypy", "timeout", "mypy did not finish")):
        use(FakeTools(behaviour={module: how}))
        assert why in check.findings(str(tree), str(tree))["stopped"], (module, how)
    use(FakeTools())
    rows = check.findings(str(tree), str(tree))["findings"]
    inline = [(r["line"], r["rule"]) for r in rows if r["rule"] in ("mypy-inline", "type-ignore")]
    assert inline == [(1, "mypy-inline"), (2, "type-ignore")], inline
    assert not any("ignore-errors" in r["message"] or "assignment" in r["message"] for r in rows)


def planted_config_plugin_and_module_are_ignored() -> None:
    problems, _ = standards.probe([checker()], tmpdir())
    if problems:
        raise unittest.SkipTest("; ".join(problems))
    base, tree = tmpdir(), tmpdir()
    plant = "from pathlib import Path\nPath('{}').touch()\n"
    files = {"ok.py": "def f(x: int) -> int:\n    return x\n", "bad.py": "import os\n",
             "ruff.py": plant.format("ran_ruff"), "plug.py": plant.format("ran_plugin"),
             "mypy.ini": "[mypy]\nplugins = plug.py\nignore_errors = True\n",
             "ruff.toml": '[lint]\nselect = ["ALL"]\n', "pyproject.toml": '[tool.ruff]\nselect = ["ALL"]\n'}
    for name, text in files.items():
        (tree / name).write_text(text)
    check = python_check.create(SimpleNamespace(kit=KIT, project=tree))
    out = check.findings(str(tree), str(base))
    assert "stopped" not in out, out
    assert [(r["file"], r["rule"]) for r in out["findings"]] == [("bad.py", "F401")], out
    assert not (tree / "ran_ruff").exists() and not (tree / "ran_plugin").exists()
    subprocess.run([sys.executable, "-m", "ruff", "--version"], cwd=tree, capture_output=True)
    assert (tree / "ran_ruff").exists(), "without -I the planted ruff.py would run, so the check above proves -I"
    (base / "mypy.ini").write_text("[mypy]\nplugins = tree_only_plugin\n")
    (tree / "tree_only_plugin.py").write_text(plant.format("ran_tree_plugin"))
    out = check.findings(str(tree), str(base))
    assert "mypy exited with 2" in out["stopped"] and not (tree / "ran_tree_plugin").exists(), out


def test_python_findings_are_blocked_only_when_new_against_the_call_start():
    try:
        compare_with_the_start_commit()
        stopped_tools_and_inline_comments()
    finally:
        standards.run_module = REAL_RUN
    planted_config_plugin_and_module_are_ignored()
    load_module(COMMENTS_CASES).comments_check_blocks_a_file_whose_comment_lines_rise()
