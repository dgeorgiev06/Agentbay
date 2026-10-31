"""Claude Code adapter v2: merge/manifest/clean guarantees, generated agents, coordinator, catalog; hook."""
import json
import shutil
import subprocess
import sys

from helpers import KIT, model, system, tmpdir

from bay import ledger
from bay.adapter import Adapter, get, module

COORDINATOR_CMDS = module("claude-code").COORDINATOR_CMDS


def _proj():
    d = tmpdir()
    (d / ".claude").mkdir()
    (d / ".claude" / "settings.json").write_text(json.dumps({"model": "opus", "permissions": {"allow": ["Bash(ls:*)"]}}))
    (d / "CLAUDE.md").write_text("# mine\n")
    (d / ".mcp.json").write_text(json.dumps({"mcpServers": {"mine": {"command": "x"}}}))
    return d


def test_adapter_round_trip():
    ad = get("claude-code")
    assert isinstance(ad, Adapter)
    proj = _proj()
    before = {p: (proj / p).read_text() for p in ["CLAUDE.md", ".mcp.json", ".claude/settings.json"]}
    s = system(None)
    ad.build(s, proj, KIT)
    first = {str(p.relative_to(proj)): p.read_text() for p in proj.rglob("*") if p.is_file()
             and "catalog" not in p.name and "manifest" not in p.name}
    ad.build(s, proj, KIT)  # idempotent
    second = {str(p.relative_to(proj)): p.read_text() for p in proj.rglob("*") if p.is_file()
              and "catalog" not in p.name and "manifest" not in p.name}
    assert first == second
    st = json.loads((proj / ".claude/settings.json").read_text())
    assert st["model"] == "opus" and "Bash(ls:*)" in st["permissions"]["allow"]
    assert [h["matcher"] for h in st["hooks"]["PreToolUse"]] == \
        ["Bash|Read|Edit|Write|MultiEdit|NotebookEdit|Glob|Grep", "Task|Agent"]               # guard first
    assert_no_wildcards(st)
    ours = [p for p in st["permissions"]["allow"] if p != "Bash(ls:*)"]
    assert sorted(ours) == sorted(f"Bash(.agentbay/bay {c}:*)" for c in COORDINATOR_CMDS)
    assert st["hooks"]["PreToolUse"][0]["hooks"][0]["onFailure"] == "block"
    assert {"Edit(/.agentbay/**)", "Edit(/.claude/**)", "Read(/.agentbay/data/**)"} <= set(st["permissions"]["deny"])
    assert any(d.startswith("Edit(//") and d.endswith("/**)") for d in st["permissions"]["deny"])   # kit outside
    agents = {p.stem for p in (proj / ".claude/agents").glob("*.md")}
    assert agents == {"researcher--delivery", "builder--delivery", "reviewer--delivery", "analyst--feed-briefing",
                      "reviewer--feed-briefing", "analyst--mail-briefing", "reviewer--mail-briefing",
                      "builder--forge", "reviewer--forge",
                      "analyst--improve", "reviewer--improve"}       # no framework-dev here, so no --<env> suffix
    assert not any(a.startswith("lead--") for a in agents)                      # coordinators run in main thread
    fa = (proj / ".claude/agents/analyst--feed-briefing.md").read_text()
    assert "tools: Bash\n" in fa and ".agentbay/roles/analyst--feed-briefing/use items.store/v1.query" in fa
    assert "Result/v1" in fa and "--role" not in fa and "mode `feed-briefing`, env `local-feeds`" in fa
    assert "corpus-sql" in fa                                                   # the mode's skills
    rv = (proj / ".claude/agents/reviewer--delivery.md").read_text()
    assert "model: opus" in rv and "Edit" not in rv.split("---")[1]
    claude = (proj / "CLAUDE.md").read_text()
    assert claude.startswith("<!-- agentbay:begin") and "@.agentbay/COORDINATOR.md" in claude and "# mine" in claude
    coord = (proj / ".agentbay/COORDINATOR.md").read_text()
    assert "Chief of Staff" in coord and "`feed-briefing.digest`" in coord and "coordinator role `lead`" in coord
    assert coord.count("# You are the Chief of Staff") == 1          # preamble only, not also a mode section
    assert "### Mode `cos`" not in coord
    assert "`cos.run`" in coord                                      # but its endpoints are in the table
    sk_dir = proj / ".claude/skills"
    built = {d.name for d in sk_dir.iterdir()}
    assert {"feed-briefing--corpus-sql", "feed-briefing--digest", "feed-briefing--grounded-qa",
            "mail-briefing--corpus-sql", "mail-briefing--digest", "mail-briefing--grounded-qa",
            "researcher--research-brief", "improve--pattern-analysis"} <= built
    assert all("--" in n for n in built)                                    # no bare (global) skill folders
    def body(p):                                                            # SKILL.md minus its `name:` line
        return [ln for ln in p.read_text().splitlines() if not ln.startswith("name:")]
    for n in built:                                                         # name: is the namespaced folder name
        assert f"\nname: {n}\n" in (sk_dir / n / "SKILL.md").read_text()
    for sk in ("digest", "corpus-sql", "grounded-qa"):  # same short name in two modes: no clobbering
        assert body(sk_dir / f"feed-briefing--{sk}/SKILL.md") == body(KIT / f"modes/briefing/skills/{sk}/SKILL.md")
    for sk in ("digest", "corpus-sql"):                 # mail-briefing overrides these, for itself only
        assert body(sk_dir / f"mail-briefing--{sk}/SKILL.md") == body(KIT / f"modes/mail-briefing/skills/{sk}/SKILL.md")
        assert body(KIT / f"modes/mail-briefing/skills/{sk}/SKILL.md") != body(KIT / f"modes/briefing/skills/{sk}/SKILL.md")
    assert body(sk_dir / "mail-briefing--grounded-qa/SKILL.md") == body(KIT / "modes/briefing/skills/grounded-qa/SKILL.md")
    ma = (proj / ".claude/agents/analyst--mail-briefing.md").read_text()
    assert "`feed-briefing--corpus-sql` (corpus-sql)" in fa and "mail-briefing--" not in fa
    assert "`mail-briefing--corpus-sql` (corpus-sql)" in ma and "feed-briefing--" not in ma
    assert "| `mail-briefing--digest` | mode mail-briefing | digest |" in coord
    assert "| `researcher--research-brief` | role researcher | research-brief |" in coord
    assert "`researcher--research-brief` (research-brief)" in (proj / ".claude/agents/researcher--delivery.md").read_text()
    cat = json.loads((proj / ".agentbay/catalog.json").read_text())
    assert {m["name"] for m in cat["modes"]} == {"cos", "delivery", "feed-briefing", "forge", "improve",
                                                  "mail-briefing"}
    #  ^ briefing is abstract; cos is the root coordinator's own mode
    assert next(m for m in cat["modes"] if m["name"] == "feed-briefing")["extends"] == "briefing"
    dg = next(e for m in cat["modes"] for e in m["endpoints"] if e["name"] == "feed-briefing.digest")
    assert dg["review"]["role"] == "reviewer" and [s["kind"] for s in dg["steps"]][-1] == "review"
    assert {r["subagent"] for r in cat["roles"]} == agents
    skills_before = {str(f.relative_to(sk_dir)): f.read_text() for f in sk_dir.rglob("*") if f.is_file()}
    ad.build(s, proj, KIT)                                                  # idempotent: same skills, nothing extra
    assert {str(f.relative_to(sk_dir)): f.read_text() for f in sk_dir.rglob("*") if f.is_file()} == skills_before
    ad.clean(proj)
    assert not (proj / ".claude/skills").exists()                           # namespaced folders removed
    for p, txt in before.items():
        if p.endswith(".json"):
            assert json.loads((proj / p).read_text()) == json.loads(txt), p
        else:
            assert (proj / p).read_text() == txt, p
    assert not (proj / ".claude/agents").exists()
    assert not (proj / ".agentbay/roles").exists() and not (proj / ".agentbay/guard.json").exists()
    assert not (proj / ".agentbay/COORDINATOR.md").exists()
    shutil.rmtree(proj)


def assert_no_wildcards(settings: dict) -> None:
    for p in settings["permissions"]["allow"]:
        assert p not in ("Bash", "Bash(*)", "Bash(*:*)"), p
        assert not p.startswith("Bash(.agentbay/bay:"), p             # no blanket control plane
        assert not p.startswith("Bash(.agentbay/roles"), p            # role shims are per role, via the guard
        assert "*" not in p.split(":")[0], p


def test_clean_removes_files_agentbay_created_and_keeps_formatting():
    proj = tmpdir()
    try:
        (proj / ".claude").mkdir()
        odd = '{"model":   "opus"}\n'
        (proj / ".claude/settings.json").write_text(odd)
        ad = get("claude-code")
        ad.build(system(None), proj, KIT)
        assert (proj / "CLAUDE.md").exists()
        ad.clean(proj)
        assert not (proj / "CLAUDE.md").exists() and not (proj / ".mcp.json").exists()
        assert (proj / ".claude/settings.json").read_text() == odd     # byte-identical
        assert sorted(str(p.relative_to(proj)) for p in proj.rglob("*") if p.is_file()) == [".claude/settings.json"]
    finally:
        shutil.rmtree(proj)


def test_build_removes_stale_files_from_previous_build():
    ad = get("claude-code")
    proj = _proj()
    ad.build(system(None), proj, KIT)
    man = json.loads((proj / ".agentbay/manifest.json").read_text())
    (proj / ".claude/agents/old-role.md").write_text("x")
    man["files"].append(".claude/agents/old-role.md")
    (proj / ".agentbay/manifest.json").write_text(json.dumps(man))
    rep = ad.build(system(None), proj, KIT)
    assert not (proj / ".claude/agents/old-role.md").exists() and any("old-role" in r for r in rep.removed)


def test_cli_build_and_clean_on_tmp_repo():
    proj = _proj()
    r = subprocess.run(["sh", str(KIT / "bay.sh"), "--project", str(proj), "build"], capture_output=True, text=True)
    assert r.returncode == 0, r.stderr
    assert (proj / ".agentbay/bay").exists()
    r = subprocess.run([str(proj / ".agentbay/bay"), "catalog"], capture_output=True, text=True)
    assert r.returncode == 0 and "feed-briefing.digest" in r.stdout
    r = subprocess.run(["sh", str(KIT / "bay.sh"), "--project", str(proj), "clean"], capture_output=True, text=True)
    assert r.returncode == 0 and (proj / "CLAUDE.md").read_text() == "# mine\n"


def test_hook_never_fails():
    r = subprocess.run([sys.executable, str(KIT / "bay/hook.py"), "post"], input="not json", text=True,
                       capture_output=True, cwd=tmpdir())
    assert r.returncode == 0


def test_hook_records_spawn_and_result():
    proj = tmpdir()
    pre = {"tool_name": "Agent", "tool_use_id": "tu1", "session_id": "s",
           "tool_input": {"subagent_type": "briefing-analyst", "prompt": "```task\ntaskId: T-20261027-ab12\n```"}}
    post = dict(pre, tool_response="done\n```result\nprotocol: Result/v1\ntaskId: T-20261027-ab12\nstatus: done\nsummary: ok\n```")
    for phase, payload in (("pre", pre), ("post", post)):
        subprocess.run([sys.executable, str(KIT / "bay/hook.py"), phase], input=json.dumps(payload), text=True,
                       env={"CLAUDE_PROJECT_DIR": str(proj), "PATH": "/usr/bin:/bin"}, check=True)
    run = ledger.fold(ledger.read(proj))["tu1"]
    assert run.state == "done" and run.agent == "briefing-analyst" and run.task_id == "T-20261027-ab12"


def test_project_flag_accepted_before_or_after_subcommand():
    from bay import cli
    assert cli._hoist_project(["build", "--project", "/x"]) == ["--project", "/x", "build"]
    assert cli._hoist_project(["--project=/x", "catalog"]) == ["--project", "/x", "catalog"]
    assert cli._hoist_project(["call", "m.e", "{}"]) == ["call", "m.e", "{}"]


def test_build_twice_then_clean_leaves_an_empty_project_empty():
    proj = tmpdir()
    ad = get("claude-code")
    ad.build(system(None), proj, KIT)
    ad.build(system(None), proj, KIT)
    ad.clean(proj)
    assert sorted(str(p.relative_to(proj)) for p in proj.rglob("*")) == []


def test_gitignore_is_stable_across_builds_and_kept_while_runtime_data_exists():
    proj = tmpdir()
    ad = get("claude-code")
    ad.build(system(None), proj, KIT)
    rep = ad.build(system(None), proj, KIT)
    assert not any(".gitignore" in r for r in rep.removed)
    (proj / ".agentbay/ledger").mkdir(exist_ok=True)
    (proj / ".agentbay/ledger/events.jsonl").write_text("{}\n")
    ad.clean(proj)
    assert (proj / ".agentbay/.gitignore").exists()


def test_adapters_are_discovered_by_folder_with_no_registry():
    from bay import adapter
    assert "claude-code" in adapter.discover()
    root = tmpdir()
    (root / "echo").mkdir()
    (root / "echo/adapter.yaml").write_text("name: echo\nmodule: echo.py\nclass: Echo\n")
    (root / "echo/echo.py").write_text(
        "from bay.adapter import BuildReport\n"
        "class Echo:\n    name = 'echo'\n"
        "    def build(self, system, project, kit): return BuildReport('echo')\n"
        "    def clean(self, project): return BuildReport('echo')\n")
    assert sorted(adapter.discover(root)) == ["echo"]
    ad = adapter.get("echo", root)
    assert isinstance(ad, Adapter) and ad.clean(root).runtime == "echo"
    try:
        adapter.get("nope", root)
        raise AssertionError("unknown runtime accepted")
    except KeyError as e:
        assert "adapters/<name>/adapter.yaml" in str(e)


def _adapter(root, folder, manifest, code=None):
    (root / folder).mkdir(parents=True, exist_ok=True)
    (root / folder / "adapter.yaml").write_text(manifest)
    if code is not None:
        (root / folder / "mod.py").write_text(code)


ECHO = ("from bay.adapter import BuildReport\n"
        "class Echo:\n    name = 'echo'\n"
        "    def build(self, system, project, kit): return BuildReport('echo')\n"
        "    def clean(self, project): return BuildReport('echo')\n")


def test_lint_checks_adapter_manifests_f12():
    from bay import lint
    from helpers import cleanup, kit_copy
    k = kit_copy()
    try:
        assert not lint.lint_adapters(model.Kit(k, None))
        a = k / "adapters"
        _adapter(a, "extra", "name: extra\nmodule: mod.py\nclass: X\nregistry: true\n", "")
        _adapter(a, "noclass", "name: noclass\nmodule: mod.py\n", "")
        _adapter(a, "renamed", "name: other\nmodule: mod.py\nclass: X\n", "")
        _adapter(a, "escape", "name: escape\nmodule: ../claude-code/claude_code.py\nclass: X\n")
        _adapter(a, "nomodule", "name: nomodule\nmodule: gone.py\nclass: X\n")
        _adapter(a, "notyaml", "name: [\n")
        errs = lint.lint_adapters(model.Kit(k, None))
        assert any(e.startswith("adapters/extra/adapter.yaml: ") and "registry" in e for e in errs)
        assert any(e.startswith("adapters/noclass/adapter.yaml: ") and "'class' is a required property" in e
                   for e in errs)
        assert "adapters/renamed/adapter.yaml: name 'other' must match its folder 'renamed'" in errs
        assert ("adapters/escape/adapter.yaml: module '../claude-code/claude_code.py' must be inside the adapter "
                "folder") in errs
        assert "adapters/nomodule/adapter.yaml: module 'gone.py' does not exist" in errs
        assert any(e.startswith("adapters/notyaml/adapter.yaml: unreadable") for e in errs)
        assert set(errs) <= set(lint.run(k))
    finally:
        cleanup(k)


def test_a_bad_adapter_entry_is_reported_and_never_imported_f12():
    from bay import adapter
    root = tmpdir()
    marker = root / "imported"
    boom = f"open({str(marker)!r}, 'w').write('x')\nraise RuntimeError('imported')\n"
    _adapter(root, "echo", "name: echo\nmodule: mod.py\nclass: Echo\n", ECHO)
    _adapter(root, "broken", "name: broken\nmodule: mod.py\nclass: Echo\nextra: 1\n", boom)
    _adapter(root, "other", "name: other\nmodule: mod.py\nclass: Echo\n", boom)   # well-formed, not selected
    _adapter(root, "garbled", ": : [\n")
    problems = []
    assert sorted(adapter.discover(root, problems)) == ["echo", "other"]
    assert any("broken/adapter.yaml" in p for p in problems) and any("garbled/adapter.yaml" in p for p in problems)
    ad = adapter.get("echo", root)
    assert ad.build(None, root, root).runtime == "echo" and ad.clean(root).runtime == "echo"
    assert not marker.exists()                       # neither the bad entry nor the unselected one was imported
    try:
        adapter.get("broken", root)
        raise AssertionError("bad adapter loaded")
    except ValueError as e:
        assert "runtime 'broken' is not loadable" in str(e) and "extra" in str(e)
    assert not marker.exists()


def test_adapter_modules_are_keyed_by_folder_f12():
    from bay import adapter
    keys = {adapter.module_key(f) for f in ("claude-code", "claude_code", "claude_2dcode", "claudecode")}
    assert len(keys) == 4 and all(k.startswith("agentbay_adapter_") and k.isidentifier() for k in keys)
    m = module("claude-code")
    assert m.__name__ == adapter.module_key("claude-code") and sys.modules[m.__name__] is m
    assert "agentbay_adapter_claude_code" not in sys.modules


def test_cli_build_and_clean_report_a_broken_other_runtime_f12():
    import os
    from helpers import cleanup, kit_copy
    k, proj = kit_copy(), _proj()
    try:
        _adapter(k / "adapters", "zz-broken", "name: wrong\nmodule: mod.py\nclass: X\n", "raise SystemExit(3)\n")
        env = {**os.environ, "PYTHONPATH": str(k)}
        for cmd in ("build", "clean"):
            r = subprocess.run([sys.executable, "-m", "bay.cli", "--project", str(proj), cmd], cwd=k, env=env,
                               text=True, capture_output=True)
            assert r.returncode == 0, r.stderr
            assert "zz-broken/adapter.yaml: name 'wrong' must match its folder 'zz-broken'" in r.stdout
    finally:
        cleanup(k)


def test_rename_skill_parses_front_matter_as_yaml_and_normalises_crlf_f15():
    import yaml
    from bay.model import SpecError
    rename = module("claude-code")._rename_skill
    d = tmpdir() / "m--s"
    d.mkdir()
    p = d / "SKILL.md"
    p.write_text("---\r\ndescription: \"a: b\"\r\nname:\r\n  s\r\nx: [1, 2]\r\n---\r\n# S\r\nbody --- here\r\n",
                 newline="")
    rename(p, "m--s")
    text = p.read_bytes().decode()
    assert "\r" not in text and text.startswith("---\nname: m--s\n") and text.endswith("---\n# S\nbody --- here\n")
    meta = yaml.safe_load(text.split("---\n")[1])
    assert meta == {"name": "m--s", "description": "a: b", "x": [1, 2]}
    p.write_text("# plain\n")
    rename(p, "m--s")
    assert p.read_text() == "---\nname: m--s\n---\n# plain\n"
    p.write_text("---\nname: s\ndescription: never closed\n# S\n")
    try:
        rename(p, "m--s")
        raise AssertionError("unclosed front matter accepted")
    except SpecError as e:
        assert "skill m--s: SKILL.md: front matter opens with '---' on line 1 but has no closing '---' line" in str(e)
    assert not d.exists()                                    # no malformed skill left behind


def test_lint_reports_a_skill_md_whose_front_matter_never_closes_f15():
    from bay import lint
    from helpers import cleanup, kit_copy
    k = kit_copy()
    try:
        f = k / "modes/briefing/skills/digest/SKILL.md"
        f.write_text(f.read_text().replace("\n---\n", "\n\n", 1))
        g = k / "modes/briefing/skills/grounded-qa/SKILL.md"
        g.write_text("---\n- not\n- a mapping\n---\n# x\n")
        errs = lint.run(k)
        want = "modes/briefing/skills/digest/SKILL.md:1: front matter opens with '---' on line 1 but has no closing"
        assert sum(want in e for e in errs) == 1                  # once, though two modes inherit the skill
        assert any("modes/briefing/skills/grounded-qa/SKILL.md:1: front matter must be a YAML mapping" in e
                   for e in errs)
    finally:
        cleanup(k)


def test_building_the_kit_into_itself_leaves_git_status_clean():
    """The kit ignores its own build output (/.claude/, /CLAUDE.md, .agentbay/), so `bay build` and `bay clean`
    into the kit checkout never show up as changes to commit."""
    from helpers import cleanup, kit_copy
    k = kit_copy()
    try:
        g = ["git", "-c", "user.name=t", "-c", "user.email=t@t", "-c", "commit.gpgsign=false"]
        for c in (["init", "-q"], ["add", "-A"], ["commit", "-qm", "kit"]):
            assert subprocess.run(g + c, cwd=k, capture_output=True).returncode == 0
        status = lambda: subprocess.run(["git", "status", "--porcelain"], cwd=k, capture_output=True, text=True).stdout
        assert status() == ""
        for cmd in ("build", "clean"):
            r = subprocess.run([sys.executable, str(k / "bay/cli.py"), cmd, "--project", str(k)],
                               capture_output=True, text=True)
            assert r.returncode == 0, r.stderr
            if cmd == "build":
                assert (k / "CLAUDE.md").exists() and (k / ".claude/settings.json").exists()
            assert status() == "", (cmd, status())
    finally:
        cleanup(k)
