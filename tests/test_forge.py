"""forge: scaffolds share templates with the CLI and are lint-clean; migrate dry-run changes nothing."""
import hashlib
import subprocess
import sys

from helpers import KIT, edit_yaml, kit_copy, model, project, system

from bay import dispatch, lint, migrate, scaffold


def digest_tree(root):
    h = hashlib.sha1()
    for p in sorted(root.rglob("*")):
        if p.is_file() and ".git" not in p.parts and "__pycache__" not in p.parts:
            h.update(str(p.relative_to(root)).encode() + p.read_bytes())
    return h.hexdigest()


def test_bay_mode_new_is_lint_clean_and_resolves():
    k = kit_copy()
    r = subprocess.run([sys.executable, str(k / "bay/cli.py"), "mode", "new", "release-notes",
                        "--intent", "Write release notes from merged PRs"], capture_output=True, text=True)
    assert r.returncode == 0, r.stderr
    assert (k / "modes/release-notes/features/run/playbook.md").exists()
    assert lint.run(k) == []
    s = model.resolve(model.Kit(k))
    f = s.modes["release-notes"].features["run"]
    assert f.review["when"] == "always" and [st.kind for st in f.steps] == ["role", "review"]


def test_feature_role_env_connector_scaffolds_are_lint_clean():
    k = kit_copy()
    scaffold.create(k, "feature", "weekly", target="feed-briefing", role="feed-analyst",
                    effects=["read"], intent="Weekly roundup")
    scaffold.create(k, "role", "summarizer", intent="Summarizes things")
    scaffold.create(k, "env", "sandbox", intent="A sandbox")
    res = scaffold.create(k, "connector", "bsky", implements="feed.source/v1", intent="Bluesky timeline")
    assert "connectors/bsky/tests/test_bsky.py" in res["files"]
    assert lint.run(k) == [], lint.run(k)
    s = model.resolve(model.Kit(k))
    wk = s.modes["feed-briefing"].features["weekly"]
    assert wk.review is None and [st.role for st in wk.steps] == ["feed-analyst"]   # read-only: review off by default
    # write effects -> review on by default
    scaffold.create(k, "feature", "export", target="delivery", effects=["read", "write"], intent="Export a file")
    s = model.resolve(model.Kit(k))
    assert s.modes["delivery"].features["export"].review["when"] == "always"
    # generated connector test runs offline
    r = subprocess.run([sys.executable, "-c", f"import runpy; m = runpy.run_path('{k}/connectors/bsky/tests/test_bsky.py'); "
                        "m['test_bsky_allowlist_is_enforced_before_any_request']()"], capture_output=True, text=True)
    assert r.returncode == 0, r.stderr


def test_adding_a_source_is_connector_plus_one_binding():
    k = kit_copy()
    before = {p: (k / p).read_text() for p in ("modes/feed-briefing/mode.yaml", "roles/feed-analyst.yaml")}
    scaffold.create(k, "connector", "bsky", implements="feed.source/v1", intent="Bluesky timeline")
    edit_yaml(k / "envs/local-feeds.yaml", lambda d: d["spec"]["bind"].update({"feed.source/v1": ["x-api", "bsky"]}))
    edit_yaml(k / "connectors/bsky/connector.yaml", lambda d: d["spec"]["needs"].update({"network": ["api.x.com"]}))
    s = model.resolve(model.Kit(k))
    assert s.env("local-feeds").spec["bind"]["feed.source/v1"] == ["x-api", "bsky"]
    assert all((k / p).read_text() == t for p, t in before.items())


def test_scaffold_refuses_framework_names_and_overwrites():
    k = kit_copy()
    for kind, name in (("mode", "forge"), ("role", "reviewer"), ("env", "workspace")):
        try:
            scaffold.create(k, kind, name)
            raise AssertionError("expected ScaffoldError")
        except scaffold.ScaffoldError as e:
            assert "framework name" in str(e)
    try:
        scaffold.create(k, "feature", "xx", target="forge")
        raise AssertionError("expected ScaffoldError")
    except scaffold.ScaffoldError as e:
        assert "forge.extend" in str(e)
    scaffold.create(k, "role", "dup")
    try:
        scaffold.create(k, "role", "dup")
        raise AssertionError("expected ScaffoldError")
    except scaffold.ScaffoldError as e:
        assert "never overwrite" in str(e)


def test_forge_create_runs_scaffold_then_plans_author_builder():
    k = kit_copy()
    p = project()
    d = dispatch.Dispatcher(system(p, k), p)
    r = d.call("forge.create", {"kind": "role", "name": "digest-writer", "intent": "Writes digests"})
    assert r["status"] == "needs-agent" and r["next"]["runAs"] == "subagent_type=builder--author"
    assert r["next"]["previous"]["scaffold"]["files"] == ["roles/digest-writer.yaml"]
    assert (k / "roles/digest-writer.yaml").exists()
    ids = {x["id"] for x in r["next"]["rules"]}
    assert "R-6" in ids and "R-3" not in ids and "R-7" not in ids          # kind-scoped rules


def test_migrate_dry_run_produces_diff_and_changes_nothing():
    k = kit_copy()
    (k / "specs").mkdir()
    (k / "layers/code").mkdir(parents=True)
    (k / "layers/code/layer.yaml").write_text("apiVersion: agentbay/v1\nkind: Layer\n")
    (k / "specs/writer.yaml").write_text(
        "apiVersion: agentbay/v1\nkind: AgentSpec\nmetadata: {name: writer, description: 'writes docs well'}\n"
        "spec: {model: sonnet, layers: [code], prompt: 'you are the writer, write docs'}\n")
    h = digest_tree(k)
    plan = migrate.plan(k)
    assert digest_tree(k) == h
    assert "+++ b/roles/writer.yaml" in plan["diff"] and "--- a/specs/writer.yaml" in plan["diff"]
    assert {(c["op"], c["path"]) for c in plan["changes"]} == {
        ("create", "roles/writer.yaml"), ("delete", "specs/writer.yaml"), ("delete", "layers/code")}
    r = subprocess.run([sys.executable, str(k / "bay/cli.py"), "migrate"], capture_output=True, text=True)
    assert r.returncode == 0 and "dry run: nothing written" in r.stdout and digest_tree(k) == h
    # forge.migrate without confirm is also a dry run
    p = project()
    out = dispatch.Dispatcher(system(p, k), p).call("forge.migrate", {})
    assert out["status"] == "needs-agent" and out["next"]["kind"] == "review" and digest_tree(k) == h
    res = migrate.apply(k)
    assert res["applied"] == 3 and not (k / "specs").exists() and not (k / "layers").exists()
    assert model.Kit(k).get("Role", "writer").spec["uses"] == ["workspace.read/v1", "workspace.write/v1"]
    assert migrate.plan(k)["changes"] == []
