"""Contract tests. Run: python3 tests/test_contracts.py  (or pytest)"""
import json
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

KIT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(KIT))

from bay import ledger, model  # noqa: E402
from bay.adapters import Adapter, get  # noqa: E402

try:
    import jsonschema
except ImportError:
    jsonschema = None


def _proj():
    d = Path(tempfile.mkdtemp())
    (d / ".claude").mkdir()
    (d / ".claude" / "settings.json").write_text(json.dumps({"model": "opus", "permissions": {"allow": ["Bash(ls:*)"]}}))
    (d / "CLAUDE.md").write_text("# mine\n")
    (d / ".mcp.json").write_text(json.dumps({"mcpServers": {"mine": {"command": "x"}}}))
    return d


def test_specs_resolve():
    agents = model.resolve_all(KIT / "specs", KIT / "layers")
    names = {a.name for a in agents}
    assert {"researcher", "builder", "reviewer", "chief-of-staff"} <= names
    r = next(a for a in agents if a.name == "reviewer")
    assert r.layers == ["base", "review"] and "Edit" not in r.tools


def test_adapter_contract_and_roundtrip():
    ad = get("claude-code")
    assert isinstance(ad, Adapter)
    proj = _proj()
    before = {p: (proj / p).read_text() for p in ["CLAUDE.md", ".mcp.json", ".claude/settings.json"]}
    agents = model.resolve_all(KIT / "specs", KIT / "layers")
    ad.build(agents, proj, KIT)
    ad.build(agents, proj, KIT)  # idempotent
    s = json.loads((proj / ".claude/settings.json").read_text())
    assert s["model"] == "opus" and "Bash(ls:*)" in s["permissions"]["allow"]
    assert len(s["hooks"]["PreToolUse"]) == 1
    assert (proj / ".claude/agents/builder.md").exists()
    cat = json.loads((proj / ".agentbay/catalog.json").read_text())
    assert {a["name"] for a in cat["agents"]} == {"researcher", "builder", "reviewer"}
    ad.clean(proj)
    for p, txt in before.items():
        assert json.loads((proj / p).read_text()) == json.loads(txt) if p.endswith(".json") else (proj / p).read_text() == txt, p
    assert not (proj / ".claude/agents/builder.md").exists()
    shutil.rmtree(proj)


def test_ledger_events_match_schema():
    proj = Path(tempfile.mkdtemp())
    ledger.append(proj, "spawned", "r1", agent="builder", taskId="T-20260101-abcd", source="hook", summary="x")
    ledger.append(proj, "completed", "r1", agent="builder", source="hook", data={"status": "partial"})
    evs = ledger.read(proj)
    if jsonschema:
        schema = json.loads((KIT / "schemas/event.schema.json").read_text())
        for e in evs:
            jsonschema.validate(e, schema)
    assert ledger.fold(evs)["r1"].state == "partial"
    shutil.rmtree(proj)


def test_bad_specs_fail_loudly():
    tmp = Path(tempfile.mkdtemp())
    shutil.copytree(KIT / "layers", tmp / "layers")
    (tmp / "specs").mkdir()
    (tmp / "specs" / "xx.yaml").write_text(
        "apiVersion: agentbay/v1\nkind: AgentSpec\nmetadata: {name: xx, description: 'does a thing well'}\n"
        "spec: {model: sonnet, layers: [nope], prompt: 'you are x, a test agent'}\n")
    try:
        model.resolve_all(tmp / "specs", tmp / "layers")
        raise AssertionError("expected SpecError")
    except model.SpecError as e:
        assert "unknown layer 'nope'" in str(e)
    shutil.rmtree(tmp)


def test_hook_never_fails():
    r = subprocess.run([sys.executable, str(KIT / "bay/hook.py"), "post"], input="not json", text=True,
                       capture_output=True, cwd=tempfile.mkdtemp())
    assert r.returncode == 0


if __name__ == "__main__":
    fns = [v for k, v in dict(globals()).items() if k.startswith("test_")]
    for f in fns:
        f()
        print(f"✓ {f.__name__}")
