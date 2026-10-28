"""forge: scaffolds share templates with the CLI and are lint-clean."""
import hashlib
import subprocess
import sys

from helpers import edit_yaml, kit_copy, model, project, system

from bay import dispatch, lint, scaffold


def digest_tree(root):
    h = hashlib.sha1()
    for p in sorted(root.rglob("*")):
        if p.is_file() and not {".git", "__pycache__", ".agentbay"} & set(p.parts):   # content, not runtime state
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
    scaffold.create(k, "feature", "weekly", target="feed-briefing", role="analyst",
                    effects=["read"], intent="Weekly roundup")
    scaffold.create(k, "env", "sandbox", intent="A sandbox")
    res = scaffold.create(k, "connector", "bsky", implements="items.source/v1", intent="Bluesky timeline")
    assert "connectors/bsky/tests/test_bsky.py" in res["files"]
    assert lint.run(k) == [], lint.run(k)
    s = model.resolve(model.Kit(k))
    wk = s.modes["feed-briefing"].features["weekly"]
    assert wk.review is None and [st.role for st in wk.steps] == ["analyst"]   # read-only: review off by default
    # write effects -> review on by default
    scaffold.create(k, "feature", "export", target="delivery", role="builder", effects=["read", "write"],
                    intent="Export a file")
    s = model.resolve(model.Kit(k))
    assert s.modes["delivery"].features["export"].review["when"] == "always"
    # generated connector test runs offline
    r = subprocess.run([sys.executable, "-c", f"import runpy; m = runpy.run_path('{k}/connectors/bsky/tests/test_bsky.py'); "
                        "m['test_bsky_allowlist_is_enforced_before_any_request']()"], capture_output=True, text=True)
    assert r.returncode == 0, r.stderr


def test_adding_a_source_is_connector_plus_one_binding():
    k = kit_copy()
    before = {p: (k / p).read_text() for p in ("modes/feed-briefing/mode.yaml", "framework/roles/analyst.yaml")}
    scaffold.create(k, "connector", "bsky", implements="items.source/v1", intent="Bluesky timeline")
    edit_yaml(k / "envs/local-feeds.yaml", lambda d: d["spec"]["bind"].update({"items.source/v1": ["x-api", "bsky"]}))
    edit_yaml(k / "connectors/bsky/connector.yaml", lambda d: d["spec"]["needs"].update({"network": ["api.x.com"]}))
    s = model.resolve(model.Kit(k))
    assert s.env("local-feeds").spec["bind"]["items.source/v1"] == ["x-api", "bsky"]
    assert all((k / p).read_text() == t for p, t in before.items())


def test_scaffold_refuses_framework_names_and_overwrites():
    k = kit_copy()
    for kind, name in (("mode", "forge"), ("env", "workspace")):
        try:
            scaffold.create(k, kind, name)
            raise AssertionError("expected ScaffoldError")
        except scaffold.ScaffoldError as e:
            assert "framework name" in str(e)
    try:
        scaffold.create(k, "role", "summarizer")                 # roles are framework-level
        raise AssertionError("expected ScaffoldError")
    except scaffold.ScaffoldError as e:
        assert "roles are framework-level" in str(e) and "forge.extend" in str(e)
    try:
        scaffold.create(k, "feature", "xx", target="forge")
        raise AssertionError("expected ScaffoldError")
    except scaffold.ScaffoldError as e:
        assert "forge.extend" in str(e)
    scaffold.create(k, "env", "dup")
    try:
        scaffold.create(k, "env", "dup")
        raise AssertionError("expected ScaffoldError")
    except scaffold.ScaffoldError as e:
        assert "never overwrite" in str(e)


def test_forge_create_runs_scaffold_then_plans_author_builder():
    k = kit_copy()
    other = project()                       # forge refuses a project that is not the agentbay checkout
    r = dispatch.Dispatcher(system(other, k), other).call("forge.create", {"kind": "env", "name": "x1", "intent": "xxxxx"})
    assert r["status"] == "failed" and "forge writes the agentbay checkout" in r["error"]
    assert not (k / "envs/x1.yaml").exists() and not (other / "envs").exists()
    d = dispatch.Dispatcher(system(k, k), k)   # the checkout is the project: paths resolve inside the kit
    err = None
    try:
        d.call("forge.create", {"kind": "role", "name": "digest-writer", "intent": "Writes digests"})
    except dispatch.CallError as e:
        err = str(e)
    assert err and "kind" in err                                            # roles are framework-level: no kind
    r = d.call("forge.create", {"kind": "env", "name": "digest-env", "intent": "Where digests are written"})
    assert r["status"] == "needs-agent" and r["next"]["runAs"] == "subagent_type=builder--forge--local-authoring"
    assert r["next"]["previous"]["scaffold"]["files"] == ["envs/digest-env.yaml"]
    assert (k / "envs/digest-env.yaml").exists()
    ids = {x["id"] for x in r["next"]["rules"]}
    assert "R-8" in ids and "R-3" not in ids and "R-6" not in ids and "R-7" not in ids     # kind-scoped rules


def test_connector_scaffold_for_feed_source_declares_source_and_window():
    k = kit_copy()
    scaffold.create(k, "connector", "rss", implements="items.source/v1", intent="RSS feeds")
    spec = model.Kit(k).get("Connector", "rss").spec
    assert spec["source"] == "rss" and spec["window"] == "7d" and spec["selectors"]["since"] == "native"
    scaffold.create(k, "connector", "store2", implements="items.store/v1", intent="Another store")
    assert "source" not in model.Kit(k).get("Connector", "store2").spec
    assert lint.run(k) == []


def test_feature_new_defaults_to_first_worker_role():
    k = kit_copy()
    scaffold.create(k, "feature", "weekly", target="feed-briefing", effects=["read"])
    s = model.resolve(model.Kit(k))
    assert [st.role for st in s.modes["feed-briefing"].features["weekly"].steps] == ["analyst"]
