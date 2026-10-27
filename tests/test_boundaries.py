"""B1/S1: agents cannot run endpoints, pick a role, reach write/spend/delete, or touch secrets."""
import json
import subprocess
import sys

from helpers import KIT, cleanup, kit_for, project, system, tmpdir

from bay import guard, vault
from bay.adapters import get


def built(config=None):
    p = project(config)
    get("claude-code").build(system(p), p, kit_for(p))
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
        reads = [json.loads(x) for x in (p / ".agentbay/ledger/events.jsonl").read_text().splitlines()
                 if '"data.read"' in x]
        assert reads and reads[-1]["role"] == "feed-analyst" and reads[-1]["summary"] == "feed.store/v1.query"
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
                ("call", "submit", "show", "status", "log", "note", "task"), perm
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


# ---------------------------------------------------------------- N1: file tools, git flags, unknown callers
def tool(p, agent, tool_name, tool_input, agent_id="a1"):
    payload = {"hook_event_name": "PreToolUse", "tool_name": tool_name, "tool_input": tool_input,
               "cwd": str(p)}
    if agent:
        payload["agent_type"] = agent
    if agent_id:
        payload["agent_id"] = agent_id
    r = subprocess.run([sys.executable, str(KIT / "bay/guard.py")], input=json.dumps(payload), text=True,
                       capture_output=True, env={"CLAUDE_PROJECT_DIR": str(p), "PATH": "/usr/bin:/bin"})
    decision = json.loads(r.stdout)["hookSpecificOutput"]["permissionDecision"] if r.stdout.strip() else "pass"
    return decision, r


def test_builder_cannot_edit_guard_policy_or_shims_or_settings():
    p = built()
    try:
        for path in (".agentbay/guard.json", ".agentbay/roles/feed-analyst/use", ".agentbay/bay",
                     ".claude/settings.json", ".claude/agents/builder.md", ".git/config",
                     f"{p}/.agentbay/guard.json", "src/../.agentbay/guard.json"):
            for t in ("Write", "Edit", "MultiEdit"):
                d, r = tool(p, "builder", t, {"file_path": path, "content": "x"})
                assert d == "deny" and r.returncode == 2, (t, path)
        d, _ = tool(p, "builder", "NotebookEdit", {"notebook_path": ".agentbay/x.ipynb", "new_source": "x"})
        assert d == "deny"
        d, _ = tool(p, "builder", "Write", {"file_path": "src/app.py", "content": "ok"})   # normal work still fine
        assert d == "pass"
        st = json.loads((p / ".claude/settings.json").read_text())
        assert {"Edit(/.agentbay/**)", "Edit(/.claude/**)"} <= set(st["permissions"]["deny"])   # floor for all
    finally:
        cleanup(p)


def test_store_is_not_reachable_with_file_tools():
    p = built()
    try:
        sh(p, str(p / ".agentbay/bay"), "call", "feed-briefing.sync", "{}")
        store = ".agentbay/data/feeds/posts.jsonl"
        for agent in ("feed-analyst", "builder", "reviewer"):
            assert tool(p, agent, "Read", {"file_path": store})[0] == "deny"
            assert tool(p, agent, "Write", {"file_path": store, "content": "{}"})[0] == "deny"
            assert tool(p, agent, "Grep", {"pattern": "x", "path": ".agentbay/data"})[0] == "deny"
            assert tool(p, agent, "Glob", {"pattern": ".agentbay/**/*.jsonl"})[0] == "deny"
            assert tool(p, agent, "Grep", {"pattern": "x", "glob": "**/.agentbay/**"})[0] == "deny"
        assert tool(p, "feed-analyst", "Read", {"file_path": "README.md"})[0] == "pass"
    finally:
        cleanup(p)


def test_path_normalization_and_symlinks():
    p = built()
    try:
        (p / "docs").mkdir()
        (p / "docs/link").symlink_to(p / ".agentbay")
        for path in ("docs/link/guard.json", "docs/../.agentbay/guard.json", "./.agentbay//guard.json",
                     f"{p}/docs/./../.agentbay/data/feeds/posts.jsonl"):
            assert tool(p, "builder", "Write", {"file_path": path, "content": "x"})[0] == "deny", path
            assert tool(p, "builder", "Read", {"file_path": path})[0] == "deny", path
    finally:
        cleanup(p)


def test_writes_limited_to_env_fs_write_and_kit_is_off_limits():
    p = built()
    try:
        # analyst's env (local-feeds-offline) writes only .agentbay/data/feeds, which is itself control plane
        assert tool(p, "feed-analyst", "Write", {"file_path": "notes.md", "content": "x"})[0] == "deny"
        assert tool(p, "builder", "Write", {"file_path": str(KIT / "bay/guard.py"), "content": "x"})[0] == "deny"
        assert tool(p, "builder", "Write", {"file_path": "/etc/x", "content": "x"})[0] == "deny"
    finally:
        cleanup(p)


def test_git_file_writing_and_exec_flags_are_refused():
    p = built()
    try:
        for cmd in ("git diff --output=.agentbay/guard.json", "git diff --output .agentbay/x", "git log --output=x",
                    "git diff --ext-diff", "git log -p --textconv", "git diff --no-index /etc/passwd x",
                    "git log --exec-path=/tmp", "git diff -- .agentbay/guard.json", "git add .claude/settings.json"):
            d, r = tool(p, "reviewer", "Bash", {"command": cmd})
            assert d == "deny" and r.returncode == 2, cmd
        assert tool(p, "reviewer", "Bash", {"command": "git diff HEAD~1 -- src"})[0] == "allow"
    finally:
        cleanup(p)


def test_guard_policy_tampering_does_not_reach_coordinator_commands():
    """The review's exploit: add `.agentbay/bay call` to a role's clis. The edit itself is denied (above);
    even with a tampered policy file, the session-wide deny rules still block the write path."""
    p = built()
    try:
        d, _ = tool(p, "builder", "Edit", {"file_path": ".agentbay/guard.json", "old_string": "x", "new_string": "y"})
        assert d == "deny"
        assert tool(p, "builder", "Bash", {"command": ".agentbay/bay call feed-briefing.prune '{}'"})[0] == "deny"
    finally:
        cleanup(p)


def test_missing_agent_type_is_treated_as_an_unknown_subagent():
    p = built()
    try:
        for t, ti in (("Bash", {"command": ".agentbay/bay call feed-briefing.sync '{}'"}),
                      ("Bash", {"command": "./.agentbay/roles/feed-analyst/use feed.store/v1.query '{}'"}),
                      ("Read", {"file_path": ".agentbay/data/feeds/posts.jsonl"}),
                      ("Write", {"file_path": ".agentbay/guard.json", "content": "{}"})):
            assert tool(p, None, t, ti, agent_id="a9")[0] == "deny", (t, ti)
        # an unknown subagent may still do unrelated work
        assert tool(p, None, "Bash", {"command": "ls src"}, agent_id="a9")[0] == "pass"
        # exact paths, not substrings: a file merely named like it is fine
        assert tool(p, "Explore", "Bash", {"command": "cat docs/agentbay-notes.md"})[0] == "pass"
        # main thread (no agent fields): no decision from the guard; settings.json applies
        assert tool(p, None, "Bash", {"command": ".agentbay/bay call feed-briefing.sync '{}'"}, agent_id=None)[0] == "pass"
    finally:
        cleanup(p)


def test_role_shim_is_auto_allowed_and_takes_no_flags():
    p = built()
    try:
        d, r = tool(p, "feed-analyst", "Bash", {"command": ".agentbay/roles/feed-analyst/use feed.store/v1.query '{}'"})
        assert d == "allow" and r.returncode == 0
        assert tool(p, "feed-analyst", "Bash",
                    {"command": ".agentbay/roles/feed-analyst/use --role feed-lead feed.store/v1.status '{}'"})[0] == "deny"
    finally:
        cleanup(p)


def test_protected_kit_dirs_when_the_project_is_the_kit():
    from helpers import kit_copy
    k = kit_copy()
    try:
        get("claude-code").build(system(k, k), k, k)
        pol = json.loads((k / ".agentbay/guard.json").read_text())
        assert pol["protected"] == ["framework", "bay", "schemas"]
        assert tool(k, "builder", "Write", {"file_path": "bay/guard.py", "content": "x"})[0] == "deny"
        assert tool(k, "builder", "Write", {"file_path": "framework/roles/x.yaml", "content": "x"})[0] == "deny"
        assert tool(k, "builder--author", "Write", {"file_path": "roles/x.yaml", "content": "x"})[0] == "pass"
        assert tool(k, "builder--author", "Write", {"file_path": "bay.sh", "content": "x"})[0] == "deny"
        assert tool(k, "builder--framework-builder", "Write", {"file_path": "bay/x.py", "content": "x"})[0] == "pass"
        st = json.loads((k / ".claude/settings.json").read_text())
        assert not any(d.startswith("Edit(//") for d in st["permissions"]["deny"])   # kit inside project
        from bay import lint, model
        assert any("reaches framework/" in w for w in lint.warnings(model.Kit(k, k)))
    finally:
        cleanup(k)


def test_approve_requires_a_terminal():
    p = built()
    try:
        r = subprocess.run([sys.executable, str(KIT / "bay/cli.py"), "--project", str(p), "approve", "C-x"],
                           input="yes\n", text=True, capture_output=True)
        assert r.returncode != 0 and "not a TTY" in r.stderr
        st = json.loads((p / ".claude/settings.json").read_text())
        assert not any("approve" in a for a in st["permissions"]["allow"])
    finally:
        cleanup(p)
