"""comments-check cases, run by the python-check test through bay.standards.check."""
import subprocess
from pathlib import Path
from types import SimpleNamespace

import yaml
from helpers import KIT, cleanup, connector_pkg, tmpdir

from bay import standards

comments_check = connector_pkg("comments-check", "comments_check")
GIT = ["git", "-c", "user.name=t", "-c", "user.email=t@example.com"]
C_SYNTAX = {"line": ["//"], "block": [["/*", "*/"]]}
C_COMPONENT = {"apiVersion": "agentbay/v4", "kind": "Component", "metadata": {"name": "clang", "description": "d"},
               "spec": {"version": 1, "language": {"files": ["*.c"], "comments": C_SYNTAX}}}
C_BASE = "int a; // old\n"
C_TREE = 'int a; // old\n/* two\nlines */\nchar *s = "// not a comment";\n/* one */\n'
RULE_OFF = "connectors:\n  comments-check:\n    rule: off\n"
DOC_ONE = 'def f():\n    """One line."""\n'
DOC_TWO = 'def f():\n    """One line.\n\n    And more.\n    """\n'


def make_kit() -> Path:
    kit = tmpdir() / "kit"
    base = kit / "components" / "base"
    (base / "python").mkdir(parents=True)
    (base / "python" / "component.yaml").write_text(
        (KIT / "components" / "base" / "python" / "component.yaml").read_text())
    (base / "clang").mkdir()
    (base / "clang" / "component.yaml").write_text(yaml.safe_dump(C_COMPONENT))
    return kit


def git(repo: Path, *args: str) -> None:
    subprocess.run([*GIT, "-C", str(repo), *args], capture_output=True, check=True)


def repo_with(files: dict) -> Path:
    repo = tmpdir() / "repo"
    repo.mkdir()
    git(repo, "init", "-q", "-b", "main")
    write(repo, files)
    git(repo, "add", "-A")
    git(repo, "commit", "-q", "-m", "base")
    return repo


def write(repo: Path, files: dict) -> None:
    for name, text in files.items():
        (repo / name).parent.mkdir(parents=True, exist_ok=True)
        (repo / name).write_text(text)


def run(repo: Path, kit: Path) -> dict:
    check = comments_check.create(SimpleNamespace(kit=kit, project=repo))
    checkers = [standards.Checker("comments-check")]
    return standards.check(repo, "HEAD", checkers, lambda name, args: check.findings(**args))


def new_in(base: dict, tree: dict, kit: Path, rename: tuple[str, str] | None = None) -> dict:
    repo = repo_with(base)
    try:
        if rename:
            git(repo, "mv", *rename)
        write(repo, tree)
        return run(repo, kit)
    finally:
        cleanup(repo)


def comments_check_blocks_a_file_whose_comment_lines_rise():
    kit = make_kit()
    out = new_in({"a.py": "x = 1\n", "d.py": DOC_ONE}, {"a.py": "x = 1\n# note\n", "d.py": DOC_TWO}, kit)
    found = sorted((r["file"], r["line"], r["message"]) for r in out["new"])
    after_first = "a docstring line after the first"
    assert found == [("a.py", 2, "a # comment"), ("d.py", 3, after_first), ("d.py", 4, after_first),
                     ("d.py", 5, after_first)], found
    assert "4 new standards finding(s)" in out["stopped"] and out["existing"] == 0
    assert new_in({"d.py": "x = 1\n"}, {"d.py": DOC_ONE}, kit)["new"] == []
    out = new_in({"r.py": "x = 1  # c\n"}, {"s.py": "x = 1  # c\n"}, kit, rename=("r.py", "s.py"))
    assert out["new"] == [] and out["existing"] == 1, out
    out = new_in({"a.py": "x = 1\n"}, {"n.py": "# c\n"}, kit)
    assert [(r["file"], r["line"]) for r in out["new"]] == [("n.py", 1)]
    assert [r["line"] for r in new_in({"m.c": C_BASE}, {"m.c": C_TREE}, kit)["new"]] == [2, 3, 5]
    off = {"agentbay.config.yaml": RULE_OFF}
    out = new_in({"a.py": "x = 1\n", **off}, {"a.py": "x = 1\n# note\n"}, kit)
    assert out["new"] == [] and any("is off" in w for w in out["warnings"]), out
    out = new_in({"a.py": "x = 1\n"}, {"a.py": "x = 1\n# note\n", **off}, kit)
    assert [r["file"] for r in out["new"]] == ["a.py"], out
    languages_come_from_the_base_when_the_project_is_the_kit()


def languages_come_from_the_base_when_the_project_is_the_kit():
    component = "components/base/python/component.yaml"
    document = yaml.safe_load((KIT / component).read_text())
    document["spec"]["language"]["files"] = []
    repo = repo_with({component: (KIT / component).read_text(), "a.py": "x = 1\n"})
    try:
        write(repo, {component: yaml.safe_dump(document), "a.py": "x = 1\n# note\n"})
        out = run(repo, repo)
        assert [(r["file"], r["line"]) for r in out["new"]] == [("a.py", 2)], out
    finally:
        cleanup(repo)
