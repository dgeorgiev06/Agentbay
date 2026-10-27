"""B1/S1: agents cannot run endpoints, pick a role, reach write/spend/delete, or touch secrets."""
import json
import subprocess
import sys

from helpers import KIT, cleanup, project, system, tmpdir

from bay import guard, vault
from bay.adapters import get


def built(config=None):
    p = project(config)
    get("claude-code").build(system(p), p, KIT)
    return p


def sh(p, *args, stdin=None):
    return subprocess.run(list(args), cwd=p, capture_output=True, text=True, input=stdin)


def hook(p, agent, command):
    payload = {"hook_event_name": "PreToolUse", "tool_name": "Bash", "tool_input": {"command": command},
               "agent_type": agent, "agent_id": "a1", "cwd": str(p)}
    r = subprocess.run([sys.executable, str(KIT / "bay/guard.py")], input=json.dumps(payload), text=True,
                       capture_output=True, env={"CLAUDE_PROJECT_DIR": str(p), "PATH": "/usr/bin:/bin"})
    return r


def test_role_shim_reads_only_its_grants_and_cannot_write_spend_or_delete():
    p = built()
    try:
        shim = p / ".agentbay/roles/feed-analyst/use"
        assert shim.exists() and not (p / ".agentbay/roles/reviewer/use").exists()   # no grants -> no shim
        sh(p, str(p / ".agentbay/bay"), "call", "feed-briefing.sync", "{}")
        r = sh(p, str(shim), "feed.store/v1.query", '{"author": "lido"}')
        assert r.returncode == 0 and {x["author"]["handle"] for x in json.loads(r.stdout)["posts"]} == {"lido"}
        for ep in ("feed.store/v1.sync", "feed.store/v1.prune", "feed.source/v1.fetch", "feed.store/v1.status"):
            r = sh(p, str(shim), ep, "{}")
            assert r.returncode != 0 and "not granted" in r.stderr, (ep, r.stderr)
        before = (p / ".agentbay/data/feeds/posts.jsonl").read_text()
        assert before == (p / ".agentbay/data/feeds/posts.jsonl").read_text()
    finally:
        cleanup(p)


def test_role_shim_cannot_impersonate_another_role():
    p = built()
    try:
        shim = str(p / ".agentbay/roles/feed-analyst/use")
        for argv in (["--role", "feed-lead", "feed.store/v1.status", "{}"],
                     ["feed.store/v1.status", "{}", "--role", "feed-lead"],
                     ["--role=feed-lead", "feed.store/v1.status"]):
            r = sh(p, shim, *argv)
            assert r.returncode != 0, argv
            assert "status" not in r.stdout
        # the old generic entry point is gone
        r = sh(p, str(p / ".agentbay/bay"), "use", "--role", "feed-lead", "feed.store/v1.status", "{}")
        assert r.returncode != 0 and "invalid choice" in r.stderr
    finally:
        cleanup(p)


def test_guard_scopes_bash_per_subagent():
    p = built()
    try:
        shim = ".agentbay/roles/feed-analyst/use"
        ok = [("feed-analyst", f"{shim} feed.store/v1.query '{{\"text\": \"x\"}}'"),
              ("feed-analyst", f"{p}/{shim} feed.store/v1.query '{{}}'"),
              ("reviewer", "git diff HEAD~1"), ("builder", "git status")]
        for agent, cmd in ok:
            r = hook(p, agent, cmd)
            assert r.returncode == 0 and "deny" not in r.stdout, (agent, cmd, r.stdout)
        bad = [("feed-analyst", ".agentbay/bay call feed-briefing.prune '{}'"),
               ("feed-analyst", ".agentbay/roles/feed-lead/use feed.store/v1.status '{}'"),
               ("feed-analyst", f"python3 {KIT}/bay/cli.py call feed-briefing.sync '{{}}'"),
               ("feed-analyst", f"{shim} feed.store/v1.query '{{}}'; .agentbay/bay call feed-briefing.sync"),
               ("feed-analyst", f"{shim} feed.store/v1.query \"$(cat .agentbay/data/feeds/state.json)\""),
               ("feed-analyst", f"{shim} feed.store/v1.query '{{}}' > /tmp/x"),
               ("feed-analyst", "cat .agentbay/data/feeds/posts.jsonl"),
               ("feed-analyst", "security find-generic-password -s agentbay -a X_REFRESH_TOKEN -w"),
               ("reviewer", "git push origin main"), ("reviewer", "git diff && rm -rf ."),
               ("builder", ".agentbay/bay secret set X_REFRESH_TOKEN"),
               ("Explore", ".agentbay/bay call feed-briefing.sync '{}'")]   # non-agentbay subagent
        for agent, cmd in bad:
            r = hook(p, agent, cmd)
            assert r.returncode == 2, (agent, cmd)
            assert json.loads(r.stdout)["hookSpecificOutput"]["permissionDecision"] == "deny"
        # main thread: no decision, normal permissions apply
        r = subprocess.run([sys.executable, str(KIT / "bay/guard.py")], text=True, capture_output=True,
                           input=json.dumps({"tool_name": "Bash", "tool_input": {"command": ".agentbay/bay call x"}}),
                           env={"CLAUDE_PROJECT_DIR": str(p), "PATH": "/usr/bin:/bin"})
        assert r.returncode == 0 and r.stdout == ""
    finally:
        cleanup(p)


def test_guard_fails_closed_for_subagents():
    p = tmpdir()
    try:
        r = hook(p, "feed-analyst", "ls")           # no guard.json -> deny, not allow
        assert r.returncode == 2 and "guard error" in r.stderr
    finally:
        cleanup(p)


def test_unsafe_detection():
    assert guard.unsafe("a 'b; c' \"d\"") is None
    for cmd in ("a; b", "a && b", "a | b", "a > f", "a `b`", "a $(b)", "a\nb", "a \"$HOME\"", "(a)"):
        assert guard.unsafe(cmd), cmd


def test_settings_have_no_wildcards():
    p = built()
    try:
        st = json.loads((p / ".claude/settings.json").read_text())
        for perm in st["permissions"]["allow"]:
            assert "*" not in perm.split(":")[0] and perm not in ("Bash", "Bash(*)")
            assert perm.startswith("Bash(.agentbay/bay ") and perm.split()[1].rstrip(":*)") in \
                ("call", "submit", "status", "log", "note", "task"), perm
        assert not any("secret" in x or "build" in x or "roles/" in x for x in st["permissions"]["allow"])
    finally:
        cleanup(p)


def test_secret_set_refuses_non_tty_stdin():
    r = subprocess.run([sys.executable, str(KIT / "bay/cli.py"), "secret", "set", "X_REFRESH_TOKEN",
                        "--provider", "env"], input="attacker-value\n", text=True, capture_output=True)
    assert r.returncode != 0 and "not a TTY" in r.stderr and "attacker-value" not in r.stdout + r.stderr


def test_keychain_set_never_puts_value_in_argv():
    seen = []

    class R:
        returncode = 0

    def run(cmd, **kw):
        seen.append((cmd, kw.get("input")))
        return R()
    prov = vault.KeychainProvider(run=run, platform="darwin")
    assert prov.set("X_REFRESH_TOKEN", "rt-VERY-SECRET-42")
    argv, stdin = seen[0]
    assert all("rt-VERY-SECRET-42" not in a for a in argv) and argv == ["security", "-i"]
    assert "rt-VERY-SECRET-42" in stdin and "-a X_REFRESH_TOKEN" in stdin
    for bad in ('a"b', "a\nb", "a\\b"):
        try:
            prov.set("X_REFRESH_TOKEN", bad)
            raise AssertionError("expected SecretError")
        except vault.SecretError as e:
            assert bad not in str(e)
