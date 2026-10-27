"""Claude Code adapter v2: merge/manifest/clean guarantees, generated agents, coordinator, catalog; hook."""
import json
import shutil
import subprocess
import sys

from helpers import KIT, model, system, tmpdir

from bay import ledger
from bay.adapters import Adapter, get


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
    assert [h["matcher"] for h in st["hooks"]["PreToolUse"]] == ["Bash", "Task|Agent"]   # guard first
    assert_no_wildcards(st)
    ours = [p for p in st["permissions"]["allow"] if p != "Bash(ls:*)"]
    assert sorted(ours) == sorted(f"Bash(.agentbay/bay {c}:*)" for c in ("call", "submit", "status", "log", "note", "task"))
    agents = {p.stem for p in (proj / ".claude/agents").glob("*.md")}
    assert agents == {"researcher", "builder", "reviewer", "feed-analyst", "builder--author", "builder--framework-builder"}
    assert "feed-lead" not in agents and "forge-lead" not in agents          # coordinators run in main thread
    fa = (proj / ".claude/agents/feed-analyst.md").read_text()
    assert "tools: Bash\n" in fa and ".agentbay/roles/feed-analyst/use feed.store/v1.query" in fa and "Result/v1" in fa
    assert "--role" not in fa
    rv = (proj / ".claude/agents/reviewer.md").read_text()
    assert "model: opus" in rv and "Edit" not in rv.split("---")[1]
    claude = (proj / "CLAUDE.md").read_text()
    assert claude.startswith("<!-- agentbay:begin") and "@.agentbay/COORDINATOR.md" in claude and "# mine" in claude
    coord = (proj / ".agentbay/COORDINATOR.md").read_text()
    assert "Chief of Staff" in coord and "`feed-briefing.digest`" in coord and "coordinator role `feed-lead`" in coord
    assert (proj / ".claude/skills/feed-digest/SKILL.md").exists() and (proj / ".claude/skills/research-brief/SKILL.md").exists()
    cat = json.loads((proj / ".agentbay/catalog.json").read_text())
    assert {m["name"] for m in cat["modes"]} == {"delivery", "feed-briefing", "forge"}
    dg = next(e for m in cat["modes"] for e in m["endpoints"] if e["name"] == "feed-briefing.digest")
    assert dg["review"]["role"] == "reviewer" and [s["kind"] for s in dg["steps"]][-1] == "review"
    assert {r["subagent"] for r in cat["roles"]} == agents
    ad.clean(proj)
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
    r = subprocess.run([str(proj / ".agentbay/bay"), "ls"], capture_output=True, text=True)
    assert r.returncode == 0 and "feed-briefing.digest" in r.stdout
    r = subprocess.run(["sh", str(KIT / "bay.sh"), "--project", str(proj), "clean"], capture_output=True, text=True)
    assert r.returncode == 0 and (proj / "CLAUDE.md").read_text() == "# mine\n"


def test_ledger_run_events_match_schema():
    proj = tmpdir()
    ledger.append(proj, "spawned", "r1", agent="builder", taskId="T-20260101-abcd", source="hook", summary="x")
    ledger.append(proj, "completed", "r1", agent="builder", source="hook", data={"status": "partial"})
    evs = ledger.read(proj)
    if model.jsonschema:
        schema = json.loads((KIT / "schemas/event.schema.json").read_text())
        for e in evs:
            model.jsonschema.validate(e, schema)
    assert ledger.fold(evs)["r1"].state == "partial"


def test_hook_never_fails():
    r = subprocess.run([sys.executable, str(KIT / "bay/hook.py"), "post"], input="not json", text=True,
                       capture_output=True, cwd=tmpdir())
    assert r.returncode == 0


def test_hook_records_spawn_and_result():
    proj = tmpdir()
    pre = {"tool_name": "Agent", "tool_use_id": "tu1", "session_id": "s",
           "tool_input": {"subagent_type": "feed-analyst", "prompt": "```task\ntaskId: T-20261027-ab12\n```"}}
    post = dict(pre, tool_response="done\n```result\nprotocol: Result/v1\ntaskId: T-20261027-ab12\nstatus: done\nsummary: ok\n```")
    for phase, payload in (("pre", pre), ("post", post)):
        subprocess.run([sys.executable, str(KIT / "bay/hook.py"), phase], input=json.dumps(payload), text=True,
                       env={"CLAUDE_PROJECT_DIR": str(proj), "PATH": "/usr/bin:/bin"}, check=True)
    run = ledger.fold(ledger.read(proj))["tu1"]
    assert run.state == "done" and run.agent == "feed-analyst" and run.task_id == "T-20261027-ab12"


def test_project_flag_accepted_before_or_after_subcommand():
    from bay import cli
    assert cli._hoist_project(["build", "--project", "/x"]) == ["--project", "/x", "build"]
    assert cli._hoist_project(["--project=/x", "ls"]) == ["--project", "/x", "ls"]
    assert cli._hoist_project(["call", "m.e", "{}"]) == ["call", "m.e", "{}"]
