"""The CLI surface (proposal 0008, item 2): about 15 commands, and an old command name is an unknown command."""
import os
import subprocess
import sys
import time

from helpers import KIT, cleanup, kit_copy, project

from bay import ledger

COMMANDS = {"check", "build", "clean", "catalog", "describe", "call", "submit", "show", "approve", "new", "secret",
            "auth", "config", "status", "note", "plan"}
OLD = ("validate", "lint", "boundary", "ls", "reclaim", "log", "task", "improve", "dispatched", "review-record",
       "mode", "feature", "connector", "env", "use")


def cli(p, *args):
    return subprocess.run([sys.executable, str(KIT / "bay/cli.py"), "--project", str(p), *args],
                          capture_output=True, text=True)


def test_the_cli_has_about_fifteen_commands_and_no_old_names():
    r = subprocess.run([sys.executable, str(KIT / "bay/cli.py"), "--help"], capture_output=True, text=True)
    assert r.returncode == 0
    listed = {line.split()[0] for line in r.stdout.split("positional arguments:")[1].split("options:")[0].splitlines()
              if line.startswith("    ") and not line.startswith("     ")}
    assert listed == COMMANDS and len(listed) <= 16
    p = project()
    try:
        for old in OLD:
            r = cli(p, old)
            assert r.returncode == 2 and f"invalid choice: '{old}'" in r.stderr, old
    finally:
        cleanup(p)


def test_check_takes_boundary_options_only_with_a_base_and_json_prints_only_the_boundary_json():
    import json
    p = project()
    try:
        for option in (["--docs"], ["--json"], ["--proposal", "docs/proposals/x.md"]):
            r = cli(p, "check", *option)
            assert r.returncode != 0 and "--base" in r.stderr, option
        k = kit_copy()      # a throwaway repo: the base must hold the map, which the checkout's own HEAD may not yet
        for g in (("init", "-q", "-b", "main"), ("add", "-A"), ("commit", "-q", "-m", "c")):
            subprocess.run(["git", "-C", str(k), "-c", "user.email=t@t", "-c", "user.name=t", *g], check=True)
        r = subprocess.run([sys.executable, str(k / "bay/cli.py"), "check", "--base", "HEAD", "--json"],
                           capture_output=True, text=True, cwd=k)
        assert isinstance(json.loads(r.stdout), dict), r.stdout + r.stderr
    finally:
        cleanup(p)


def test_note_task_mints_an_id_and_dispatch_and_review_take_the_task_first():
    p = project()
    try:
        r = cli(p, "note", "task")
        assert r.returncode == 0 and ledger.TASK_ID.match(r.stdout.strip())
        tid = r.stdout.strip()
        assert cli(p, "note", "dispatch", tid).returncode != 0                       # --agent is required
        dispatch = ("note", "dispatch", tid, "--agent", "builder--delivery")
        r = cli(p, *dispatch)                                                   # no guard heartbeat: refused, no event
        dispatched = [e for e in ledger.read(p) if e["type"] == "agent.dispatch"]
        assert r.returncode != 0 and "--unguarded" in r.stderr and not dispatched
        assert cli(p, *dispatch, "--unguarded", "").returncode != 0                  # an empty reason is no reason
        assert cli(p, *dispatch, "--unguarded", "   ").returncode != 0               # nor is one of only spaces
        assert cli(p, *dispatch, "--unguarded", "x").returncode == 0
        assert [e["data"]["unguarded"] for e in ledger.read(p) if e["type"] == "agent.dispatch"] == ["x"]
        assert cli(p, "note", tid, "text", "--unguarded", "x").returncode != 0       # --unguarded goes with `dispatch`
        seen = p / ".agentbay/ledger/guard.seen"                                     # one hook call touches it
        seen.parent.mkdir(parents=True, exist_ok=True)
        seen.touch()
        assert cli(p, *dispatch).returncode == 0                                     # fresh: no flag needed
        old = time.time() - 1000
        os.utime(seen, (old, old))
        assert cli(p, *dispatch).returncode != 0                                     # older than 900 s: refused again
        future = time.time() + 86400 * 365
        os.utime(seen, (future, future))
        assert cli(p, *dispatch).returncode != 0                                     # dated in the future: stale
        seen.unlink()
        seen.mkdir()
        assert cli(p, *dispatch).returncode != 0                                     # a directory is no heartbeat
        seen.rmdir()
        real = p / "real.seen"
        real.touch()
        seen.symlink_to(real)
        assert cli(p, *dispatch).returncode != 0                                     # nor is a symlink
        seen.unlink()
        assert cli(p, "note", tid, "text", "--agent", "x").returncode != 0           # dispatch flags need `dispatch`
        assert sum(e["type"] == "agent.dispatch" and e["taskId"] == tid for e in ledger.read(p)) == 2
    finally:
        cleanup(p)


BYPASSES = (
    ("note", "--agent", "x", "dispatch", "T-20261030-abcd"),
    ("note", "--kind", "note", "review", "T-20261030-abcd", "{}"),
    ("note", "--project", ".", "dispatch", "T-20261030-abcd", "--agent", "x"),
    ("note", "--project=.", "dispatch", "T-20261030-abcd", "--agent", "x"),
    ("note", "--instruction", "dispatch", "T-20261030-abcd"),
    ("show", "--reason", "r", "reclaim", "R-1"),
    ("show", "--project", ".", "reclaim", "R-1"),
)


def test_a_write_verb_must_directly_follow_note_or_show_so_the_ask_rules_match():
    """`note`/`show` are pre-approved by prefix; an option before the verb would skip the `note dispatch` /
    `note review` / `show reclaim` ask rules."""
    p = project()
    try:
        for argv in BYPASSES:
            r = cli(p, *argv)
            assert r.returncode != 0 and "no option may come before the verb" in r.stderr, argv
        assert not any(e["type"] in ("agent.dispatch", "reclaimed") for e in ledger.read(p))
        # also with no leading --project (how the coordinator types it)
        r = subprocess.run([sys.executable, str(KIT / "bay/cli.py"), *BYPASSES[0]], capture_output=True, text=True)
        assert r.returncode != 0 and "no option may come before the verb" in r.stderr
        # the canonical spellings still work
        assert cli(p, "note", "dispatch", "T-20261030-abcd", "--agent", "x", "--unguarded", "test").returncode == 0
        assert cli(p, "show", "reclaim", "R-1", "--reason", "r").returncode == 0
    finally:
        cleanup(p)


def test_help_after_note_and_show_prints_help_instead_of_being_refused():
    p = project()
    try:
        for argv in (("note", "-h"), ("note", "--help"), ("show", "-h"), ("show", "--help")):
            r = cli(p, *argv)
            assert r.returncode == 0 and "usage:" in r.stdout and "no option may come" not in r.stderr, argv
    finally:
        cleanup(p)


def test_catalog_roles_lists_the_role_units():
    r = subprocess.run([sys.executable, str(KIT / "bay/cli.py"), "catalog", "--roles"], capture_output=True, text=True)
    assert r.returncode == 0 and "role units" in r.stdout and "builder--forge--framework-dev" in r.stdout


def test_new_checks_the_options_its_kind_needs():
    p = project()
    try:
        assert "--mode" in cli(p, "new", "feature", "x").stderr
        assert "--implements" in cli(p, "new", "connector", "x").stderr
    finally:
        cleanup(p)
