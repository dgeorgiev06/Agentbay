"""git connector: commits as episodes with revert detection and churn; messages are never returned."""
import json
import shutil

from helpers import clock, cleanup, project, system
from improve_fixtures import CORES, make_git_repo

from bay import connect
from bay.improve import sources


def test_commits_reverts_and_churn_without_messages():
    if not shutil.which("git"):
        return
    p = project()
    try:
        bad = make_git_repo(p)
        g = connect.instantiate(system(p), "improve-local", "git", "session.events/v1", p, clock=clock)
        out = g.episodes(since="7d")
        eps = out["episodes"]
        assert len(eps) == 7 and out["stats"]["reverts"] == 1
        rv = [e for e in eps if e["commit"]["isRevert"]][0]
        assert rv["commit"]["revertOf"] == bad[:12] and rv["commit"]["files"] == ["bad.py"]
        assert sum(1 for e in eps if "hot.py" in e["commit"]["files"]) == 5
        blob = json.dumps(out)
        assert "tweak" not in blob and "add bad" not in blob and all(c not in blob for c in CORES)
    finally:
        cleanup(p)


def test_not_a_repo_is_empty_not_an_error():
    p = project()
    try:
        eps, stats = sources.git_episodes(p)
        assert eps == [] and stats["note"] in ("not a git repository", "git not available")
    finally:
        cleanup(p)
