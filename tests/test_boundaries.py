"""B1/S1: agents cannot run endpoints, pick a role, reach write/spend/delete, or touch secrets."""
import json
import subprocess
import sys

from helpers import KIT, cleanup, kit_for, project, system, tmpdir

from bay import guard, vault
from bay.adapter import get, module

COORDINATOR_CMDS = module("claude-code").COORDINATOR_CMDS


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
        shim = p / ".agentbay/roles/analyst--feed-briefing/use"
        assert shim.exists() and not (p / ".agentbay/roles/reviewer--delivery/use").exists()   # no grants -> no shim
        sh(p, str(p / ".agentbay/bay"), "call", "feed-briefing.sync", "{}")
        r = sh(p, str(shim), "items.store/v1.query", '{"author": "lido"}')
        assert r.returncode == 0 and {x["author"]["handle"] for x in json.loads(r.stdout)["items"]} == {"lido"}
        reads = [json.loads(x) for x in (p / ".agentbay/ledger/events.jsonl").read_text().splitlines()
                 if '"data.read"' in x]
        assert reads and reads[-1]["role"] == "analyst" and reads[-1]["mode"] == "feed-briefing" and reads[-1]["summary"] == "items.store/v1.query"
        for ep in ("items.store/v1.sync", "items.store/v1.prune", "items.source/v1.fetch"):
            r = sh(p, str(shim), ep, "{}")
            assert r.returncode != 0 and "not granted" in r.stderr, (ep, r.stderr)
        before = (p / ".agentbay/data/feeds/feed-briefing/corpus.db").read_bytes()
        assert before == (p / ".agentbay/data/feeds/feed-briefing/corpus.db").read_bytes()
    finally:
        cleanup(p)


def test_role_shim_cannot_impersonate_another_role():
    p = built()
    try:
        shim = str(p / ".agentbay/roles/analyst--feed-briefing/use")
        for argv in (["--role", "briefing-lead", "items.store/v1.status", "{}"],
                     ["items.store/v1.status", "{}", "--role", "briefing-lead"],
                     ["--role=briefing-lead", "items.store/v1.status"]):
            r = sh(p, shim, *argv)
            assert r.returncode != 0, argv
            assert "status" not in r.stdout
        # the old generic entry point is gone
        r = sh(p, str(p / ".agentbay/bay"), "use", "--role", "briefing-lead", "items.store/v1.status", "{}")
        assert r.returncode != 0 and "invalid choice" in r.stderr
    finally:
        cleanup(p)


def test_guard_scopes_bash_per_subagent():
    p = built()
    try:
        shim = ".agentbay/roles/analyst--feed-briefing/use"
        ok = [("analyst--feed-briefing", f"{shim} items.store/v1.query '{{\"text\": \"x\"}}'"),
              ("analyst--feed-briefing", f"{p}/{shim} items.store/v1.query '{{}}'"),
              ("reviewer--delivery", "git diff HEAD~1"), ("builder--delivery", "git status")]
        for agent, cmd in ok:
            r = hook(p, agent, cmd)
            assert r.returncode == 0 and "deny" not in r.stdout, (agent, cmd, r.stdout)
            assert ('"allow"' in r.stdout) == ("/use " in cmd), (agent, cmd)   # only the own shim is auto-allowed
        bad = [("analyst--feed-briefing", ".agentbay/bay call feed-briefing.prune '{}'"),
               ("analyst--feed-briefing", ".agentbay/roles/lead--feed-briefing/use items.store/v1.status '{}'"),
               ("analyst--feed-briefing", f"python3 {KIT}/bay/cli.py call feed-briefing.sync '{{}}'"),
               ("analyst--feed-briefing", f"{shim} items.store/v1.query '{{}}'; .agentbay/bay call feed-briefing.sync"),
               ("analyst--feed-briefing", f"{shim} items.store/v1.query \"$(cat .agentbay/data/feeds/state.json)\""),
               ("analyst--feed-briefing", f"{shim} items.store/v1.query '{{}}' > /tmp/x"),
               ("analyst--feed-briefing", "cat .agentbay/data/feeds/feed-briefing/corpus.db"),
               ("analyst--feed-briefing", "security find-generic-password -s agentbay -a X_REFRESH_TOKEN -w"),
               ("reviewer--delivery", "git push origin main"), ("reviewer--delivery", "git diff && rm -rf ."),
               ("builder--delivery", ".agentbay/bay secret set X_REFRESH_TOKEN"),
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
        r = hook(p, "analyst--feed-briefing", "ls")           # no guard.json -> deny, not allow
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
                COORDINATOR_CMDS, perm
        # the invariant behind the list: every pre-approved command is read-only
        assert not ({"call", "submit", "approve", "build", "clean", "secret", "improve", "reclaim"}
                    & set(COORDINATOR_CMDS))
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
        for path in (".agentbay/guard.json", ".agentbay/roles/analyst--feed-briefing/use", ".agentbay/bay",
                     ".claude/settings.json", ".claude/agents/builder.md", ".git/config",
                     f"{p}/.agentbay/guard.json", "src/../.agentbay/guard.json"):
            for t in ("Write", "Edit", "MultiEdit"):
                d, r = tool(p, "builder--delivery", t, {"file_path": path, "content": "x"})
                assert d == "deny" and r.returncode == 2, (t, path)
        d, _ = tool(p, "builder--delivery", "NotebookEdit", {"notebook_path": ".agentbay/x.ipynb", "new_source": "x"})
        assert d == "deny"
        d, _ = tool(p, "builder--delivery", "Write", {"file_path": "src/app.py", "content": "ok"})   # normal work still fine
        assert d == "pass"
        st = json.loads((p / ".claude/settings.json").read_text())
        assert {"Edit(/.agentbay/**)", "Edit(/.claude/**)"} <= set(st["permissions"]["deny"])   # floor for all
    finally:
        cleanup(p)


def test_store_is_not_reachable_with_file_tools():
    p = built()
    try:
        sh(p, str(p / ".agentbay/bay"), "call", "feed-briefing.sync", "{}")
        store = ".agentbay/data/feeds/feed-briefing/corpus.db"
        for agent in ("analyst--feed-briefing", "builder", "reviewer"):
            assert tool(p, agent, "Read", {"file_path": store})[0] == "deny"
            assert tool(p, agent, "Write", {"file_path": store, "content": "{}"})[0] == "deny"
            assert tool(p, agent, "Grep", {"pattern": "x", "path": ".agentbay/data"})[0] == "deny"
            assert tool(p, agent, "Glob", {"pattern": ".agentbay/**/*.jsonl"})[0] == "deny"
            assert tool(p, agent, "Grep", {"pattern": "x", "glob": "**/.agentbay/**"})[0] == "deny"
        assert tool(p, "analyst--feed-briefing", "Read", {"file_path": "README.md"})[0] == "pass"
    finally:
        cleanup(p)


def test_path_normalization_and_symlinks():
    p = built()
    try:
        (p / "docs").mkdir()
        (p / "docs/link").symlink_to(p / ".agentbay")
        for path in ("docs/link/guard.json", "docs/../.agentbay/guard.json", "./.agentbay//guard.json",
                     f"{p}/docs/./../.agentbay/data/feeds/feed-briefing/corpus.db"):
            assert tool(p, "builder--delivery", "Write", {"file_path": path, "content": "x"})[0] == "deny", path
            assert tool(p, "builder--delivery", "Read", {"file_path": path})[0] == "deny", path
    finally:
        cleanup(p)


def test_writes_limited_to_env_fs_write_and_kit_is_off_limits():
    p = built()
    try:
        # analyst's env (local-feeds-offline) writes only .agentbay/data/feeds, which is itself control plane
        assert tool(p, "analyst--feed-briefing", "Write", {"file_path": "notes.md", "content": "x"})[0] == "deny"
        assert tool(p, "builder--delivery", "Write", {"file_path": str(KIT / "bay/guard.py"), "content": "x"})[0] == "deny"
        assert tool(p, "builder--delivery", "Write", {"file_path": "/etc/x", "content": "x"})[0] == "deny"
    finally:
        cleanup(p)


def test_git_file_writing_and_exec_flags_are_refused():
    p = built()
    try:
        for cmd in ("git diff --output=.agentbay/guard.json", "git diff --output .agentbay/x", "git log --output=x",
                    "git diff --ext-diff", "git log -p --textconv", "git diff --no-index /etc/passwd x",
                    "git log --exec-path=/tmp", "git diff -- .agentbay/guard.json", "git add .claude/settings.json"):
            d, r = tool(p, "reviewer--delivery", "Bash", {"command": cmd})
            assert d == "deny" and r.returncode == 2, cmd
        assert tool(p, "reviewer--delivery", "Bash", {"command": "git diff HEAD~1 -- src"})[0] == "pass"   # prompts
    finally:
        cleanup(p)


def test_guard_policy_tampering_does_not_reach_coordinator_commands():
    """The review's exploit: add `.agentbay/bay call` to a role's clis. The edit itself is denied (above);
    even with a tampered policy file, the session-wide deny rules still block the write path."""
    p = built()
    try:
        d, _ = tool(p, "builder--delivery", "Edit", {"file_path": ".agentbay/guard.json", "old_string": "x", "new_string": "y"})
        assert d == "deny"
        assert tool(p, "builder--delivery", "Bash", {"command": ".agentbay/bay call feed-briefing.prune '{}'"})[0] == "deny"
    finally:
        cleanup(p)


def test_missing_agent_type_is_treated_as_an_unknown_subagent():
    p = built()
    try:
        for t, ti in (("Bash", {"command": ".agentbay/bay call feed-briefing.sync '{}'"}),
                      ("Bash", {"command": "./.agentbay/roles/analyst--feed-briefing/use items.store/v1.query '{}'"}),
                      ("Read", {"file_path": ".agentbay/data/feeds/feed-briefing/corpus.db"}),
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
        d, r = tool(p, "analyst--feed-briefing", "Bash", {"command": ".agentbay/roles/analyst--feed-briefing/use items.store/v1.query '{}'"})
        assert d == "allow" and r.returncode == 0
        assert tool(p, "analyst--feed-briefing", "Bash",
                    {"command": ".agentbay/roles/analyst--feed-briefing/use --role briefing-lead items.store/v1.status '{}'"})[0] == "deny"
    finally:
        cleanup(p)


def test_protected_kit_dirs_when_the_project_is_the_kit():
    from helpers import kit_copy
    k = kit_copy()
    try:
        get("claude-code").build(system(k, k), k, k)
        pol = json.loads((k / ".agentbay/guard.json").read_text())
        assert pol["protected"] == ["framework", "bay", "schemas", "adapters"]
        assert tool(k, "builder--delivery", "Write", {"file_path": "bay/guard.py", "content": "x"})[0] == "deny"
        assert tool(k, "builder--delivery", "Write", {"file_path": "framework/roles/x.yaml", "content": "x"})[0] == "deny"
        assert tool(k, "builder--forge--local-authoring", "Write", {"file_path": "modes/x.yaml", "content": "x"})[0] == "pass"
        assert tool(k, "builder--forge--local-authoring", "Write", {"file_path": "roles/x.yaml", "content": "x"})[0] == "deny"
        assert tool(k, "builder--forge--local-authoring", "Write", {"file_path": "bay.sh", "content": "x"})[0] == "deny"
        assert tool(k, "builder--forge--framework-dev", "Write", {"file_path": "bay/x.py", "content": "x"})[0] == "pass"
        st = json.loads((k / ".claude/settings.json").read_text())
        assert not any(d.startswith("Edit(//") for d in st["permissions"]["deny"])   # kit inside project
        from bay import lint, model
        assert any("reaches framework/" in w for w in lint.warnings(model.Kit(k, k)))
    finally:
        cleanup(k)


def test_adapter_code_is_protected_when_the_project_is_the_kit():
    from helpers import kit_copy
    k = kit_copy()
    try:
        get("claude-code").build(system(k, k), k, k)
        p = {"file_path": "adapters/claude-code/x.py", "content": "x"}
        assert tool(k, "builder--forge--local-authoring", "Write", p)[0] == "deny"
        assert tool(k, "builder--delivery", "Write", p)[0] == "deny"
        assert tool(k, "builder--forge--framework-dev", "Write", p)[0] == "pass"
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


# ---------------------------------------------------------------- round 3 (option B)
from bay.guard import Guard  # noqa: E402


def guard_for(p, ci=None):
    return Guard(json.loads((p / ".agentbay/guard.json").read_text()), p, ci=ci)


def decide(g, agent, tool_name, ti, agent_id="a1"):
    payload = {"tool_name": tool_name, "tool_input": ti, "cwd": str(g.project)}
    if agent:
        payload["agent_type"] = agent
    if agent_id:
        payload["agent_id"] = agent_id
    return g.decide(payload)[0]


def test_b1_case_variants_on_case_insensitive_filesystem():
    p = built()
    try:
        g = guard_for(p, ci=True)                     # simulate macOS (APFS default)
        for path in (".AGENTBAY/guard.json", ".Agentbay/roles/briefing-analyst/use", ".CLAUDE/settings.json",
                     ".Git/config", "src/.GIT/hooks/pre-commit", "claude.MD", ".MCP.json", ".ENV.local"):
            assert decide(g, "builder--delivery", "Write", {"file_path": path, "content": "x"}) == "deny", path
        assert decide(g, "analyst--feed-briefing", "Read", {"file_path": ".AgentBay/data/feeds/feed-briefing/corpus.db"}) == "deny"
        assert decide(g, "builder--delivery", "Glob", {"pattern": ".AGENT*/**"}) == "deny"
        assert decide(g, "builder--delivery", "Write", {"file_path": "src/app.py", "content": "x"}) == "pass"
        g = guard_for(p, ci=False)                    # case-sensitive disk: a different, harmless directory
        assert decide(g, "builder--delivery", "Write", {"file_path": ".AGENTBAY/x.txt", "content": "x"}) == "pass"
    finally:
        cleanup(p)


def test_b1_identity_check_catches_aliases_by_inode():
    p = built()
    try:
        (p / "alias").symlink_to(p / ".agentbay")
        g = guard_for(p, ci=False)
        from pathlib import Path as P
        assert g.inside(P(p / "alias" / "guard.json"), g.agentbay)            # by (st_dev, st_ino), unresolved
        assert g.inside(P(p / "alias" / "new-file"), g.agentbay)             # tail does not exist yet
        assert not g.inside(P(p / "src" / "x"), g.agentbay)
    finally:
        cleanup(p)


def test_b2_forge_extend_installed_only_in_the_agentbay_checkout():
    from bay import dispatch
    from helpers import kit_copy
    p = built()
    k = kit_copy()
    try:
        assert not (p / ".claude/agents/builder--forge--framework-dev.md").exists()
        cat = json.loads((p / ".agentbay/catalog.json").read_text())
        assert "forge.extend" not in {e["name"] for m in cat["modes"] for e in m["endpoints"]}
        assert "forge.extend" not in (p / ".agentbay/COORDINATOR.md").read_text()
        try:
            dispatch.Dispatcher(system(p), p).call("forge.extend", {"goal": "change things"})
            raise AssertionError("expected CallError")
        except dispatch.CallError as e:
            assert "installed only when the project is the agentbay checkout" in str(e)
        get("claude-code").build(system(k, k), k, k)
        assert (k / ".claude/agents/builder--forge--framework-dev.md").exists()
    finally:
        cleanup(p)
        cleanup(k)


def test_safety_rule_only_the_own_shim_is_auto_allowed():
    p = built()
    try:
        g = guard_for(p)
        assert decide(g, "analyst--feed-briefing", "Bash", {"command": ".agentbay/roles/analyst--feed-briefing/use items.store/v1.query '{}'"}) == "allow"
        for agent, cmd in (("reviewer--delivery", "git status"), ("builder--delivery", "git add src/a.py"), ("reviewer--delivery", "git diff")):
            assert decide(g, agent, "Bash", {"command": cmd}) == "pass", cmd
        from helpers import kit_copy
        k = kit_copy()
        get("claude-code").build(system(k, k), k, k)
        gk = guard_for(k)
        for agent, cmd in (("builder--forge--framework-dev", "python3 tests/run.py"),
                           ("builder--forge--framework-dev", "./bay.sh validate"), ("builder--forge--local-authoring", "./bay.sh lint")):
            assert decide(gk, agent, "Bash", {"command": cmd}) == "pass", cmd     # code never auto-allowed
        st = json.loads((p / ".claude/settings.json").read_text())
        assert not any(c in a for a in st["permissions"]["allow"] for c in ("bay call", "bay submit"))
        cleanup(k)
    finally:
        cleanup(p)


def test_sa_grep_glob_patterns_against_control_plane_probes():
    p = built()
    try:
        g = guard_for(p)
        for ti in ({"pattern": ".agent*/**"}, {"pattern": "**/.agentbay/**/*.jsonl"}, {"pattern": ".claude/*.json"},
                   {"pattern": "{.agentbay,src}/**"}):
            assert decide(g, "builder--delivery", "Glob", ti) == "deny", ti
            assert decide(g, None, "Glob", ti) == "deny", ti                  # unknown subagents too
        assert decide(g, "builder--delivery", "Grep", {"pattern": "x", "glob": ".agentbay/**"}) == "deny"
        assert decide(g, "builder--delivery", "Glob", {"pattern": ".*"}) == "deny"       # dot-glob at the project root
        assert decide(g, "builder--delivery", "Glob", {"pattern": "../.agentbay/*", "path": "src"}) == "deny"
        for ti in ({"pattern": "**/*.md"}, {"pattern": "src/**/*.py"}):
            assert decide(g, "builder--delivery", "Glob", ti) == "pass", ti
    finally:
        cleanup(p)


def test_sb_unknown_subagents_interpreter_code_and_globs():
    p = built()
    try:
        g = guard_for(p)
        for cmd in ("bash -c 'cat x'", "sh -c ls", "zsh -c ls", "python3 -c 'print(1)'", "python -c x",
                    "node -e 'x'", "/usr/bin/python3.12 -c x", "cat .agent*/guard.json", "ls .clau?e/",
                    "cat .agentbay/data/feeds/feed-briefing/corpus.db"):
            assert decide(g, None, "Bash", {"command": cmd}) == "deny", cmd
            assert decide(g, "Explore", "Bash", {"command": cmd}) == "deny", cmd
        for cmd in ("ls src/*.py", "python3 script.py", "cat README.md"):
            assert decide(g, None, "Bash", {"command": cmd}) == "pass", cmd
    finally:
        cleanup(p)


def test_sd_never_write_list_for_all_subagents():
    p = built()
    try:
        g = guard_for(p, ci=False)
        for path in ("CLAUDE.md", "docs/CLAUDE.md", "CLAUDE.local.md", ".mcp.json", "agentbay.config.yaml", ".envrc",
                     ".env", ".env.production", ".vscode/settings.json", ".idea/x.xml", ".github/workflows/ci.yml",
                     "Makefile", "bay.sh", "vendor/lib/.git/config", "src/.git"):
            for agent in ("builder--delivery", None):
                assert decide(g, agent, "Write", {"file_path": path, "content": "x"}) == "deny", (agent, path)
        assert decide(g, "builder--delivery", "Write", {"file_path": ".github/README.md", "content": "x"}) == "pass"
    finally:
        cleanup(p)


def test_se_more_git_flags_and_flag_values_are_path_checked():
    p = built()
    try:
        g = guard_for(p)
        for cmd in ("git diff --pathspec-from-file=list.txt", "git log -Oorder.txt", "git diff -O order",
                    "git diff --open-files-in-pager=vi", "git log --format=x --since=.agentbay/x",
                    "git diff --src-prefix=.claude/x"):
            assert decide(g, "reviewer--delivery", "Bash", {"command": cmd}) == "deny", cmd
    finally:
        cleanup(p)


def test_sf_builder_has_no_worktree_isolation():
    p = built()
    try:
        s = system(p)
        assert s.roles["builder"].isolation == "none"
        assert "worktree" not in (p / ".agentbay/COORDINATOR.md").read_text()
    finally:
        cleanup(p)


def test_n2_gate_plan_does_not_advertise_submit():
    from bay import dispatch
    from helpers import kit_copy
    k = kit_copy()
    try:
        d = dispatch.Dispatcher(system(k, k), k)
        r = d.call("forge.extend", {"goal": "a change"})
        r = d.submit(r["callId"], "propose", {"status": "done", "summary": "s"})
        assert r["status"] == "awaiting-approval" and "submit" not in r["next"]
        assert "submit" not in r["next"]["approve"]
    finally:
        cleanup(k)


def test_n3_worktree_add_paths_and_no_writes_without_write_tools():
    from helpers import kit_copy
    k = kit_copy()
    try:
        get("claude-code").build(system(k, k), k, k)
        pol = json.loads((k / ".agentbay/guard.json").read_text())
        assert pol["subagents"]["reviewer--delivery"]["write"] == [] and pol["subagents"]["analyst--feed-briefing"]["write"] == []
        assert pol["subagents"]["builder--delivery"]["write"] == ["."]
        g = guard_for(k)
        agent = "builder--forge--framework-dev"
        g.policy["subagents"][agent]["clis"].append("git worktree")      # as if the env granted it
        for cmd in ("git worktree add /tmp/wt", "git worktree add ../outside", "git worktree add .agentbay/wt",
                    "git worktree add -b x .claude/wt"):
            assert decide(g, agent, "Bash", {"command": cmd}) == "deny", cmd
        assert decide(g, agent, "Bash", {"command": "git worktree add -b feat bay/wt-feat"}) == "pass"
        assert decide(g, "reviewer--delivery", "Write", {"file_path": "notes.md", "content": "x"}) == "deny"
    finally:
        cleanup(k)


def test_n4_agent_type_without_agent_id_is_the_main_thread():
    p = built()
    try:
        g = guard_for(p)
        assert decide(g, "some-agent", "Bash", {"command": ".agentbay/bay status"}, agent_id=None) == "pass"
        assert decide(g, "some-agent", "Bash", {"command": ".agentbay/bay status"}, agent_id="a7") == "deny"
        assert decide(g, "analyst--feed-briefing", "Read", {"file_path": ".agentbay/guard.json"}, agent_id=None) == "deny"
    finally:
        cleanup(p)


def test_n5_fake_fixture_must_stay_inside_the_project():
    from bay import connect
    p = project({"connectors": {"fake": {"fixture": "../outside.json"}}})
    try:
        (p.parent / "outside.json").write_text("[]")
        try:
            connect.instantiate(system(p), "local-feeds-offline", "fake", "items.source/v1", p)
            raise AssertionError("expected ConnectorError")
        except connect.ConnectorError as e:
            assert "must be a path inside the project" in str(e)
    finally:
        cleanup(p)



# ---------------------------------------------------------------- confirmation review
def test_use_shim_does_not_import_project_files():
    """The auto-allowed shim must not import modules an agent wrote in the project (e.g. yaml.py)."""
    p = built()
    try:
        marker = p / "PWNED"
        (p / "yaml.py").write_text(f"open({str(marker)!r}, 'w').write('x')\n")
        shim = p / ".agentbay/roles/analyst--feed-briefing/use"
        r = sh(p, str(shim), "items.store/v1.query", "{}")
        assert r.returncode == 0, r.stderr
        assert not marker.exists(), "shim imported a project-root module"
        assert "python3 -E" in shim.read_text() and "python3 -c" not in shim.read_text()
    finally:
        cleanup(p)


def test_shim_is_not_auto_allowed_in_the_agentbay_checkout():
    from helpers import kit_copy
    k = kit_copy()
    try:
        get("claude-code").build(system(k, k), k, k)
        assert json.loads((k / ".agentbay/guard.json").read_text())["autoAllowShim"] is False
        cmd = ".agentbay/roles/analyst--feed-briefing/use items.store/v1.query '{}'"
        assert decide(guard_for(k), "analyst--feed-briefing", "Bash", {"command": cmd}) == "pass"
    finally:
        cleanup(k)


def test_nested_kit_is_protected_and_shim_prompts():
    """A kit inside the project (e.g. vendor/agentbay) is not writable and the shim is not auto-allowed."""
    import shutil
    p = tmpdir() / "proj"
    p.mkdir()
    k = p / "vendor" / "agentbay"
    shutil.copytree(KIT, k, ignore=shutil.ignore_patterns(".git", "__pycache__", ".agentbay"))
    try:
        get("claude-code").build(system(p, k), p, k)
        pol = json.loads((p / ".agentbay/guard.json").read_text())
        assert pol["autoAllowShim"] is False
        g = guard_for(p)
        for f in ("vendor/agentbay/bay/cli.py", "vendor/agentbay/bay/use_shim.py", "vendor/agentbay/connectors/fake/x.py"):
            assert decide(g, "builder--delivery", "Write", {"file_path": f, "content": "x"}) == "deny", f
        assert decide(g, "analyst--feed-briefing", "Bash", {"command": ".agentbay/roles/analyst--feed-briefing/use items.store/v1.query '{}'"}) == "pass"
        st = json.loads((p / ".claude/settings.json").read_text())
        assert "Edit(/vendor/agentbay/**)" in st["permissions"]["deny"]
    finally:
        cleanup(p.parent)


def test_policy_without_auto_allow_key_prompts():
    p = built()
    try:
        pol = json.loads((p / ".agentbay/guard.json").read_text())
        pol.pop("autoAllowShim")
        g = Guard(pol, p)
        assert decide(g, "analyst--feed-briefing", "Bash", {"command": ".agentbay/roles/analyst--feed-briefing/use items.store/v1.query '{}'"}) == "pass"
    finally:
        cleanup(p)


# ---------------------------------------------------------------- 0006 Part G: approvals from chat
import yaml  # noqa: E402

from bay import dispatch as _dispatch, ledger as _ledger  # noqa: E402
from helpers import kit_copy  # noqa: E402

CHAT_WF = {"workflows": {"morning": {"steps": [
    {"id": "sync", "call": "feed-briefing.sync", "with": {"lookback": "$in.lookback"}},
    {"id": "ship", "gate": "send the digest?"}]}}}


def _cli(kit, p, *args):
    return subprocess.run([sys.executable, str(kit / "bay/cli.py"), "approve", *args, "--project", str(p)],
                          capture_output=True, text=True, input="")


def _gated_run(chat):
    p = project({**CHAT_WF, **({"approvals": {"chat": chat}} if chat is not None else {})})
    d = _dispatch.Dispatcher(system(p), p)
    rid = d.call("cos.run", {"workflow": "morning", "input": {"lookback": "1d"}})["output"]["runId"]
    d.call("cos.next", {"runId": rid, "callId": "C-x", "status": "done", "output": {"added": 1}})
    return d, p, rid


def _run_status(d, rid):
    return d.call("cos.status", {"runId": rid})["output"]["runs"][0]["status"]


def test_chat_approval_is_refused_while_the_setting_is_off():
    for chat in (None, False):
        d, p, rid = _gated_run(chat)
        try:
            r = _cli(KIT, p, rid, "--via", "chat", "--quote", "yes, ship it")
            assert r.returncode != 0 and "approvals: { chat: true }" in r.stderr and "agentbay.config.yaml" in r.stderr
            assert _run_status(d, rid) == "awaiting-approval"
        finally:
            cleanup(p)
    # a non-boolean value is a config error, not "on"
    p = project({"approvals": {"chat": "yes"}})
    try:
        r = _cli(KIT, p, "W-x", "--via", "chat", "--quote", "ok")
        assert r.returncode != 0 and "approvals" in r.stderr
    finally:
        cleanup(p)


def test_chat_approval_passes_a_workflow_gate_and_the_ledger_says_chat_with_the_quote():
    d, p, rid = _gated_run(True)
    try:
        r = _cli(KIT, p, rid, "--via", "chat")                       # the quote is mandatory
        assert r.returncode != 0 and "--quote" in r.stderr and _run_status(d, rid) == "awaiting-approval"
        quote = "Yes - approve the ship gate of the morning run."
        r = _cli(KIT, p, rid, "--via", "chat", "--quote", quote)
        assert r.returncode == 0, r.stderr
        assert _run_status(d, rid) != "awaiting-approval"
        evs = [e for e in _ledger.read(p) if e.get("runId") == rid and e["type"] == "step.completed"]
        assert evs and evs[-1]["data"] == {"approved": True, "by": "user@chat-via-cos", "quote": quote}
        assert "user@tty" not in json.dumps(evs)
    finally:
        cleanup(p)


def test_chat_approval_passes_a_call_gate_and_rejects_with_a_reason():
    k = kit_copy()
    try:
        (k / "agentbay.config.yaml").write_text(yaml.safe_dump({"apiVersion": "agentbay/v2", "approvals": {"chat": True}}))
        d = _dispatch.Dispatcher(system(k, k), k)
        ok = {"status": "done", "summary": "s"}
        cid = d.submit(d.call("forge.extend", {"goal": "a small change"})["callId"], "propose", ok)["callId"]
        r = _cli(k, k, cid, "--via", "chat", "--quote", "approve the proposal")
        assert r.returncode == 0, r.stderr
        assert d.show(cid)["next"]["step"] == "implement"
        ev = [e for e in _ledger.read(k) if e.get("callId") == cid and e.get("summary", "").startswith("gate")][-1]
        assert ev["data"] == {"approved": True, "by": "user@chat-via-cos", "quote": "approve the proposal"}
        cid2 = d.submit(d.call("forge.extend", {"goal": "another change"})["callId"], "propose", ok)["callId"]
        r = _cli(k, k, cid2, "--via", "chat", "--quote", "no, not this one", "--reject", "--reason", "too big")
        assert r.returncode != 0 or d.show(cid2)["status"] == "blocked"
        assert d.show(cid2)["status"] == "blocked"
        # a terminal approval without a TTY is still refused, setting on or not, and --quote needs --via chat
        cid3 = d.submit(d.call("forge.extend", {"goal": "third change"})["callId"], "propose", ok)["callId"]
        r = _cli(k, k, cid3)
        assert r.returncode != 0 and "not a TTY" in r.stderr
        r = _cli(k, k, cid3, "--quote", "yes")
        assert r.returncode != 0 and "--via chat" in r.stderr
        assert d.show(cid3)["status"] == "awaiting-approval"
    finally:
        cleanup(k)


def test_chat_setting_does_not_open_secrets_or_logins():
    p = project({"approvals": {"chat": True}})
    try:
        r = subprocess.run([sys.executable, str(KIT / "bay/cli.py"), "--project", str(p), "secret", "set", "X_TOKEN",
                            "--provider", "env"], input="attacker-value\n", text=True, capture_output=True)
        assert r.returncode != 0 and "not a TTY" in r.stderr and "attacker-value" not in r.stdout + r.stderr
        r = subprocess.run([sys.executable, str(KIT / "bay/cli.py"), "--project", str(p), "auth", "gmail-api"],
                           input="", text=True, capture_output=True)
        assert r.returncode != 0 and "interactive terminal" in r.stderr
        for args in (["secret", "set", "--help"], ["auth", "--help"]):
            r = subprocess.run([sys.executable, str(KIT / "bay/cli.py"), *args], capture_output=True, text=True)
            assert "--via" not in r.stdout
    finally:
        cleanup(p)


def test_guard_denies_bay_approve_to_every_subagent_in_any_spelling():
    p = built({"approvals": {"chat": True}})
    try:
        cmds = (".agentbay/bay approve C-1 --via chat --quote yes", "./bay.sh approve C-1", "bay approve C-1",
                f"{sys.executable} -m bay.cli approve C-1 --via chat --quote ok",
                f"python3 {KIT}/bay/cli.py approve W-1 --via chat --quote ok",
                "cd x && bay approve C-1 --via chat --quote ok", "bay --project . approve C-1")
        for agent in ("builder--delivery", "analyst--feed-briefing", "some-other-agent", None):
            for c in cmds:
                d, r = tool(p, agent, "Bash", {"command": c})
                assert d == "deny", (agent, c)
        # a commit message that mentions the command is not running it
        g = guard_for(p)
        assert g.decide({"tool_name": "Bash", "tool_input": {"command": 'git commit -m "docs: bay approve --via chat"'},
                         "agent_type": "some-other-agent", "agent_id": "a1", "cwd": str(p)})[0] == "pass"
        # the main thread is not decided by the guard: settings.json makes Claude Code ask each time
        assert tool(p, None, "Bash", {"command": ".agentbay/bay approve C-1 --via chat --quote ok"}, agent_id=None)[0] == "pass"
        st = json.loads((p / ".claude/settings.json").read_text())
        assert not any("approve" in a for a in st["permissions"]["allow"])
    finally:
        cleanup(p)


def test_no_subagent_writes_agentbay_config_yaml():
    p = built()
    try:
        for agent in ("builder--delivery", "some-other-agent", None):
            for t, ti in (("Write", {"file_path": "agentbay.config.yaml", "content": "approvals: {chat: true}"}),
                          ("Edit", {"file_path": f"{p}/agentbay.config.yaml", "old_string": "a", "new_string": "b"}),
                          ("Bash", {"command": "echo 'approvals: {chat: true}' >> agentbay.config.yaml"}),
                          ("Bash", {"command": "cp /tmp/x agentbay.config.yaml"}),
                          ("Bash", {"command": "sed -i s/false/true/ AGENTBAY.config.yaml"}),
                          ("Bash", {"command": "tee agentbay.c*nfig.yaml"}),
                          ("Bash", {"command": "mv x ./agentbay.config.y?ml"}),
                          ("Bash", {"command": "cp x agentbay.{config,other}.yaml"})):
                d, _ = tool(p, agent, t, ti)
                assert d == "deny", (agent, t, ti)
        # a glob elsewhere that cannot reach the root file is not refused for that reason
        g = guard_for(p)
        assert g.decide({"tool_name": "Bash", "tool_input": {"command": "ls framework/*.yaml"},
                         "agent_type": "some-other-agent", "agent_id": "a1", "cwd": str(p)})[0] == "pass"
    finally:
        cleanup(p)


def test_no_subagent_writes_the_ledger():
    """A recorded `bay approve` in the ledger skips forge.extend's gate for unchanged content, so no subagent may
    forge one: .agentbay/ledger/ is not writable (or readable) by any subagent, by file tool or by Bash."""
    p = built()
    try:
        g = guard_for(p)
        ev = json.dumps({"v": 1, "type": "step.completed", "source": "dispatcher", "step": "approve",
                         "data": {"approved": True, "by": "user@tty",
                                  "approves": {"path": "docs/proposals/0001-x.md", "sha256": "0" * 64}}})
        led = ".agentbay/ledger/events.jsonl"
        for agent in ("builder--forge--framework-dev", "some-other-agent"):
            for path in (led, f"{p}/{led}", ".agentbay/ledger/new.jsonl"):
                assert decide(g, agent, "Write", {"file_path": path, "content": ev + "\n"}) == "deny", (agent, path)
                assert decide(g, agent, "Edit", {"file_path": path, "old_string": "", "new_string": ev}) == "deny"
                assert decide(g, agent, "MultiEdit", {"file_path": path, "edits": [
                    {"old_string": "", "new_string": ev}]}) == "deny"
            for cmd in (f"echo '{ev}' >> {led}", f"tee -a {led}", f"cp /tmp/x {led}", f"sed -i 's/a/b/' {led}",
                        "python3 -c 'open(\".agentbay/ledger/events.jsonl\",\"a\")'"):
                assert decide(g, agent, "Bash", {"command": cmd}) == "deny", (agent, cmd)
        # the front-matter marker grants nothing any more, so writing it is not refused for that reason
        (p / "docs/proposals").mkdir(parents=True)
        approved = "---\nstatus: approved\napprovedBy: user\ndate: 2026-10-29\n---\n# x\n"
        assert decide(g, "some-other-agent", "Write", {"file_path": "docs/proposals/0001-x.md",
                                                       "content": approved}) == "pass"
    finally:
        cleanup(p)


def test_chat_approval_of_a_proposal_is_recorded_and_skips_the_next_gate_while_unchanged():
    k = kit_copy()
    try:
        (k / "agentbay.config.yaml").write_text(yaml.safe_dump({"apiVersion": "agentbay/v2", "approvals": {"chat": True}}))
        (k / "docs/proposals").mkdir(parents=True, exist_ok=True)
        f = k / "docs/proposals/0099-chat.md"
        f.write_text("---\nstatus: approved\napprovedBy: user\ndate: 2026-10-29\ntouches: []\n---\n# chat\n")
        d = _dispatch.Dispatcher(system(k, k), k)
        inp = {"goal": "build the chat-approved proposal", "proposal": "docs/proposals/0099-chat.md"}
        first = d.call("forge.extend", inp)            # the marker grants nothing: propose runs, then the gate
        assert first["next"]["step"] == "propose", first
        cid = d.submit(first["callId"], "propose", {"status": "done", "summary": "s",
                                                    "artifacts": [inp["proposal"]]})["callId"]
        r = _cli(k, k, cid, "--via", "chat", "--quote", "approve 0099 as written")
        assert r.returncode == 0, r.stderr
        assert "docs/proposals/0099-chat.md at sha256 " in r.stdout
        nxt = d.call("forge.extend", inp)
        assert nxt["next"]["step"] == "implement", nxt
        why = d.show(nxt["callId"])["gates"]["approve"]
        assert "approved by user@chat-via-cos on " in why and "content unchanged" in why, why
        f.write_text(f.read_text() + "\nedited\n")
        again = d.call("forge.extend", inp)
        assert again["next"]["step"] == "propose", again       # any edit: propose and the gate both run again
        again = d.submit(again["callId"], "propose", {"status": "done", "summary": "s", "artifacts": [inp["proposal"]]})
        assert again["next"]["step"] == "approve" and "changed since user@chat-via-cos approved it" in again["next"]["why"]
    finally:
        cleanup(k)


def test_bay_plan_is_the_only_bay_command_a_subagent_may_run():
    p = built()
    try:
        tid, other = "T-20261030-abcd", "T-20261030-ffff"
        _ledger.append(p, "agent.dispatch", tid, source="coordinator", taskId=tid, agent="builder--delivery")
        _ledger.append(p, "agent.dispatch", other, source="coordinator", taskId=other, agent="analyst--feed-briefing")
        ok = (f".agentbay/bay plan {tid} '{{\"outcome\": \"o\", \"todo\": []}}'", f".agentbay/bay plan {tid} --done 1")
        for c in ok:
            assert tool(p, "builder--delivery", "Bash", {"command": c})[0] in ("allow", "pass"), c
        denied = (f".agentbay/bay plan {other} --done 1",                            # another agent's task
                  f".agentbay/bay plan T-20261030-0000 --done 1",                    # never dispatched
                  f".agentbay/bay plan {tid}", f".agentbay/bay plan {tid} --done 1 2", f".agentbay/bay plan {tid} --x",
                  ".agentbay/bay status", ".agentbay/bay note T-1 hi", ".agentbay/bay log", ".agentbay/bay dispatched "
                  f"{tid} --agent builder--delivery", ".agentbay/bay submit C-1 s '{}'", f".agentbay/bay plan {tid} --done 1; ls")
        for c in denied:
            assert tool(p, "builder--delivery", "Bash", {"command": c})[0] == "deny", c
        assert tool(p, "some-other-agent", "Bash", {"command": ok[1]})[0] == "deny"
    finally:
        cleanup(p)
