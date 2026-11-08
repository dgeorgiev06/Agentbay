"""factory-tree: a worktree per slice, the profile's checks inside it, and a merge that rolls back on a failure."""
import subprocess
from pathlib import Path
from types import SimpleNamespace

import yaml

from helpers import KIT, NOW, cleanup, connector_pkg, tmpdir

from bay.connect import ConnectorError

ft = connector_pkg("factory-tree", "factory_tree")
gt = connector_pkg("factory-tree", "git_tree")

MODE = KIT / "components/modes/factory"
GIT = ["git", "-c", "user.name=t", "-c", "user.email=t@example.com"]
PROFILE = {"name": "tiny", "files": ["*.py"],
           "commands": {"ok": ["python3", "-c", "print('fine')"],
                        "guard": ["python3", "-c", "import pathlib,sys; sys.exit(0 if pathlib.Path('ok.txt').exists() "
                                                   "else 1)"]}}


def git(cwd, *args):
    return subprocess.run([*GIT, "-C", str(cwd), *args], capture_output=True, text=True, check=True).stdout.strip()


def repo():
    """A project with one commit, and a mode folder whose language profile is two cheap commands."""
    d = tmpdir()
    project = d / "proj"
    project.mkdir()
    (project / "app.py").write_text("x = 1\n")
    (project / "ok.txt").write_text("yes\n")
    git(project, "init", "-q", "-b", "main")
    git(project, "add", "-A")
    git(project, "commit", "-qm", "first")
    mode = d / "mode"
    (mode / "languages").mkdir(parents=True)
    (mode / "languages" / "tiny.yaml").write_text(yaml.safe_dump(PROFILE))
    return d, project, mode


def tree(project, mode, **settings):
    ctx = SimpleNamespace(project=project, data_dir=project / ".factory",
                          settings={"modeDirs": [str(mode), str(MODE)], "language": "tiny", **settings},
                          now=lambda: NOW)
    return ft.create(ctx)


def commit_in(path, name, body="y = 2\n"):
    (path / name).write_text(body)
    git(path, "add", "-A")
    git(path, "commit", "-qm", f"add {name}")


def test_opening_a_slice_cuts_a_branch_and_a_worktree_and_asking_again_returns_the_same_one():
    d, project, mode = repo()
    try:
        t = tree(project, mode)
        out = t.open("F-1", "S-1")
        assert out["created"] is True and out["branch"] == "factory/F-1/S-1"
        assert out["base"] == "factory/F-1/integration"
        assert out["path"] == ".factory/trees/F-1/S-1" and (project / out["path"] / "app.py").exists()
        assert (project / ".factory/.gitignore").read_text() == "*\n"
        again = t.open("F-1", "S-1")
        assert again["created"] is False and again["head"] == out["head"]
        other = t.open("F-1", "S-2")
        assert other["path"] == ".factory/trees/F-1/S-2"
        trees = t.trees("F-1")
        assert {x["branch"] for x in trees["trees"]} == {"refs/heads/factory/F-1/S-1", "refs/heads/factory/F-1/S-2"}
        assert trees["integration"]["branch"] == "factory/F-1/integration"
        assert git(project, "rev-parse", "--abbrev-ref", "HEAD") == "main"
        assert not git(project, "status", "--porcelain")
    finally:
        cleanup(project)


def test_checks_run_in_the_slices_tree_and_a_failure_stops_the_step():
    d, project, mode = repo()
    try:
        t = tree(project, mode)
        out = t.open("F-2", "S-1")
        path = project / out["path"]
        commit_in(path, "feature.py")
        ran = t.checks("F-2", "S-1")
        assert {r["name"] for r in ran["ran"]} == {"ok", "guard"} and ran["failed"] == []
        assert "fine" in next(r["tail"] for r in ran["ran"] if r["name"] == "ok")
        assert ran["changedFiles"] == ["feature.py"] and "2/2 checks passed" in ran["summary"]
        (path / "ok.txt").unlink()
        git(path, "add", "-A")
        git(path, "commit", "-qm", "drop the guard file")
        bad = t.checks("F-2", "S-1")
        assert bad["failed"] == ["guard"] and "guard failed in the slice's worktree" in bad["stopped"]
        assert "stays out of integration" in bad["stopped"]
        assert t.checks("F-2", "S-1", only=["ok"])["failed"] == []
    finally:
        cleanup(project)


def test_checks_on_a_slice_that_was_never_opened_name_the_step_that_cuts_the_tree():
    d, project, mode = repo()
    try:
        tree(project, mode).checks("F-3", "S-9")
        raise AssertionError("expected a refusal")
    except ConnectorError as e:
        assert "has no worktree" in str(e) and "factory.tree/v1.open" in str(e)
    finally:
        cleanup(project)


def test_integrate_merges_a_slice_and_leaves_the_owners_branch_alone():
    d, project, mode = repo()
    try:
        t = tree(project, mode)
        commit_in(project / t.open("F-4", "S-1")["path"], "one.py")
        out = t.integrate("F-4", "S-1")
        assert out["merged"] is True and out["branch"] == "factory/F-4/integration" and out["checks"]["failed"] == []
        integration = project / ".factory/trees/F-4/_integration"
        assert (integration / "one.py").exists()
        assert not (project / "one.py").exists()
        assert git(project, "log", "--oneline", "main") == git(project, "log", "--oneline", "-1", "main")
    finally:
        cleanup(project)


def test_uncommitted_work_is_not_integrated_and_says_so():
    d, project, mode = repo()
    try:
        t = tree(project, mode)
        path = project / t.open("F-5", "S-1")["path"]
        (path / "loose.py").write_text("z = 3\n")
        out = t.integrate("F-5", "S-1")
        assert out["merged"] is False and "are not committed" in out["stopped"] and "loose.py" in out["stopped"]
    finally:
        cleanup(project)


def test_a_conflict_is_undone_and_names_the_files():
    d, project, mode = repo()
    try:
        t = tree(project, mode)
        commit_in(project / t.open("F-6", "S-1")["path"], "shared.py", "a = 1\n")
        commit_in(project / t.open("F-6", "S-2")["path"], "shared.py", "a = 2\n")
        assert t.integrate("F-6", "S-1")["merged"] is True
        out = t.integrate("F-6", "S-2")
        assert out["merged"] is False and out["conflicts"] == ["shared.py"]
        assert "the merge was undone" in out["stopped"] and "Rebase" in out["stopped"]
        integration = project / ".factory/trees/F-6/_integration"
        assert (integration / "shared.py").read_text() == "a = 1\n"
        assert not git(integration, "status", "--porcelain")
    finally:
        cleanup(project)


def test_a_check_that_fails_only_after_the_merge_is_rolled_back():
    d, project, mode = repo()
    try:
        t = tree(project, mode)
        path = project / t.open("F-7", "S-1")["path"]
        (path / "ok.txt").unlink()
        git(path, "add", "-A")
        git(path, "commit", "-qm", "drop the file the guard needs")
        before = git(project / ".factory/trees/F-7/_integration", "rev-parse", "HEAD")
        out = t.integrate("F-7", "S-1")
        assert out["merged"] is False and out["checks"]["failed"] == ["guard"]
        assert "merges cleanly but guard fail" in out["stopped"] and "rolled back" in out["stopped"]
        integration = project / ".factory/trees/F-7/_integration"
        assert git(integration, "rev-parse", "HEAD") == before and (integration / "ok.txt").exists()
    finally:
        cleanup(project)


def test_a_command_that_is_not_installed_is_reported_not_skipped():
    d, project, mode = repo()
    try:
        (mode / "languages" / "tiny.yaml").write_text(yaml.safe_dump(
            {"name": "tiny", "commands": {"missing": ["definitely-not-a-command-1234", "--version"]}}))
        t = tree(project, mode)
        t.open("F-8", "S-1")
        out = t.checks("F-8", "S-1")
        assert out["failed"] == ["missing"] and out["ran"][0]["exitCode"] == 127
        assert "is not installed in this environment" in out["ran"][0]["tail"]
    finally:
        cleanup(project)


def test_a_project_without_a_commit_says_what_to_do():
    d = tmpdir()
    project = d / "proj"
    project.mkdir()
    (d / "mode" / "languages").mkdir(parents=True)
    (d / "mode" / "languages" / "tiny.yaml").write_text(yaml.safe_dump(PROFILE))
    try:
        tree(project, d / "mode").open("F-9", "S-1")
        raise AssertionError("expected a refusal")
    except ConnectorError as e:
        assert "not a git repository with a commit" in str(e) and "git init" in str(e)
    finally:
        cleanup(project)


def test_an_unknown_profile_names_the_ones_that_exist():
    d, project, mode = repo()
    try:
        t = tree(project, mode, language="klingon")
        t.open("F-10", "S-1")
        t.checks("F-10", "S-1")
        raise AssertionError("expected a refusal")
    except ConnectorError as e:
        assert "no language profile 'klingon'" in str(e) and "tiny" in str(e)
    finally:
        cleanup(project)


def test_the_worktree_root_setting_moves_the_trees():
    d, project, mode = repo()
    try:
        out = tree(project, mode, worktreeRoot="build/slices").open("F-11", "S-1")
        assert out["path"] == "build/slices/F-11/S-1"
        assert (project / "build/.gitignore").read_text() == "*\n"
        assert Path(project / out["path"] / ".git").exists()
    finally:
        cleanup(project)
