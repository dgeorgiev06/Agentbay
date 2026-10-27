"""Resolver: the shipped kit resolves; every failure mode yields an exact, readable gap."""
from helpers import KIT, assert_gap, edit_yaml, gaps, kit_copy, model


def test_shipped_kit_resolves():
    s = model.resolve(model.Kit(KIT))
    assert {"feed-briefing", "delivery", "forge"} <= set(s.modes)
    d = s.modes["feed-briefing"].features["digest"]
    assert [st.kind for st in d.steps] == ["code", "code", "role", "review"]
    review = d.steps[-1]
    assert review.role == "reviewer" and review.inference.model == "opus" and review.inference.effort == "high"
    assert s.roles["feed-analyst"].bay_uses == ["feed.store/v1.query"]
    assert "Edit" not in s.roles["reviewer"].tools


def test_inference_precedence_step_over_default_over_role_over_agent():
    k = kit_copy()
    edit_yaml(k / "modes/feed-briefing/mode.yaml",
              lambda d: d["spec"]["inference"].update({"default": {"model": "haiku"}, "steps": {"answer": {"effort": "high"}}}))
    s = model.resolve(model.Kit(k))
    ans = next(st for st in s.modes["feed-briefing"].features["ask"].steps if st.id == "answer")
    assert (ans.inference.model, ans.inference.effort) == ("haiku", "high")
    # role default (no mode inference) beats agent default
    edit_yaml(k / "modes/feed-briefing/mode.yaml", lambda d: d["spec"].pop("inference"))
    edit_yaml(k / "roles/feed-analyst.yaml", lambda d: d["spec"].update({"inference": {"model": "opus"}}))
    s = model.resolve(model.Kit(k))
    ans = next(st for st in s.modes["feed-briefing"].features["ask"].steps if st.id == "answer")
    assert ans.inference.model == "opus"


def test_unbound_capability():
    k = kit_copy()
    edit_yaml(k / "envs/local-feeds.yaml", lambda d: d["spec"]["bind"].pop("feed.store/v1"))
    g = assert_gap(k, "feed-briefing.sync step fetch", "feed.store/v1 is not bound in env local-feeds", "unbound capability")
    assert "add `feed.store/v1: <connector>`" in g
    assert_gap(k, "role feed-analyst: uses feed.store/v1", "does not bind it")


def test_effect_not_allowed_by_env():
    k = kit_copy()
    edit_yaml(k / "envs/local-feeds.yaml", lambda d: d["spec"].update({"effects": ["read", "write", "network", "spend"]}))
    assert_gap(k, "feed-briefing.prune step prune", "effect 'delete'", "not allowed by env local-feeds")


def test_effect_not_declared_by_endpoint():
    k = kit_copy()
    edit_yaml(k / "modes/feed-briefing/mode.yaml",
              lambda d: d["spec"]["endpoints"]["sync"].update({"effects": ["network", "write"]}))
    assert_gap(k, "feed-briefing.sync step fetch", "effect 'spend'", "not declared by the endpoint")


def test_model_not_allowed():
    k = kit_copy()
    edit_yaml(k / "envs/local-feeds.yaml", lambda d: d["spec"].update({"models": ["haiku", "inherit"]}))
    assert_gap(k, "feed-briefing.ask step answer", "model 'sonnet'", "not allowed by env local-feeds")


def test_unknown_role_agent_env():
    k = kit_copy()
    edit_yaml(k / "modes/feed-briefing/mode.yaml",
              lambda d: d["spec"]["workflows"]["ask"][2].update({"role": "ghost"}))
    assert_gap(k, "feed-briefing.ask step answer", "unknown role 'ghost'")
    k = kit_copy()
    edit_yaml(k / "roles/feed-analyst.yaml", lambda d: d["spec"].update({"agent": "nobody"}))
    assert_gap(k, "role feed-analyst", "unknown agent 'nobody'")
    k = kit_copy()
    edit_yaml(k / "agents/analyst.yaml", lambda d: d["spec"].update({"env": "nowhere"}))
    assert_gap(k, "agent analyst", "unknown env 'nowhere'")


def test_connector_needs_exceed_env():
    k = kit_copy()
    edit_yaml(k / "envs/local-feeds.yaml", lambda d: d["spec"].update({"network": {"allow": ["example.com"]}}))
    assert_gap(k, "env local-feeds", "connector x-api needs network host api.x.com", "not in network.allow")
    k = kit_copy()
    edit_yaml(k / "envs/local-feeds.yaml", lambda d: d["spec"]["secrets"].update({"allow": ["X_CLIENT_ID"]}))
    assert_gap(k, "connector x-api needs secret X_REFRESH_TOKEN")
    k = kit_copy()
    edit_yaml(k / "envs/local-feeds.yaml", lambda d: d["spec"].update({"fs": {"read": ["."], "write": ["elsewhere"]}}))
    assert_gap(k, "connector local-store needs fs.write .agentbay/data/feeds", "outside env fs.write")


def test_unknown_connector_and_wrong_interface():
    k = kit_copy()
    edit_yaml(k / "envs/local-feeds.yaml", lambda d: d["spec"]["bind"].update({"feed.source/v1": ["bsky"]}))
    assert_gap(k, "binds feed.source/v1 to unknown connector 'bsky'")
    k = kit_copy()
    edit_yaml(k / "envs/local-feeds.yaml", lambda d: d["spec"]["bind"].update({"feed.source/v1": ["local-store"]}))
    assert_gap(k, "connector local-store is bound to feed.source/v1 but implements feed.store/v1")


def test_role_cannot_use_write_connector_endpoint():
    k = kit_copy()
    edit_yaml(k / "roles/feed-analyst.yaml", lambda d: d["spec"].update({"uses": ["feed.store/v1.sync"]}))
    assert_gap(k, "role feed-analyst: uses feed.store/v1.sync", "agents may only call read-only connector endpoints")


def test_unknown_interface_and_endpoint():
    k = kit_copy()
    edit_yaml(k / "roles/feed-analyst.yaml", lambda d: d["spec"].update({"uses": ["feed.store/v1.nope"]}))
    assert_gap(k, "feed.store/v1 has no endpoint 'nope'")
    k = kit_copy()
    edit_yaml(k / "roles/feed-analyst.yaml", lambda d: d["spec"].update({"uses": ["mail.read/v1"]}))
    assert_gap(k, "uses unknown capability interface mail.read/v1")


def test_coordinator_must_run_in_main_thread():
    k = kit_copy()
    edit_yaml(k / "agents/lead.yaml", lambda d: d["spec"].update({"runtime": "claude-code-subagent"}))
    assert_gap(k, "mode feed-briefing: coordinator role feed-lead", "need runtime claude-code-main")


def test_all_gaps_reported_at_once():
    k = kit_copy()
    edit_yaml(k / "envs/local-feeds.yaml", lambda d: d["spec"].update({"models": ["haiku"], "network": {"allow": []}}))
    gs = gaps(k)
    assert any("model 'sonnet'" in g for g in gs) and any("api.x.com" in g for g in gs)


def test_v1_files_are_rejected_with_migration_hint():
    k = kit_copy()
    (k / "roles/old.yaml").write_text("apiVersion: agentbay/v1\nkind: AgentSpec\nmetadata: {name: old}\nspec: {}\n")
    assert_gap(k, "roles/old.yaml", "kind must be Role", "bay migrate")


def test_config_schema_and_removed_bindings_override():
    from helpers import project
    from bay import config
    p = project({"modes": {"feed-briefing": {"lookback": "90d"}}})
    gs = gaps(KIT, p)
    assert any("lookback 90d exceeds mode lookbackMax 30d" in g for g in gs), gs
    p = project({"modes": {"feed-briefing": {"bogus": 1}}})
    assert any("modes.feed-briefing" in g and "bogus" in g for g in gaps(KIT, p))
    p = project({"bindings": {"local-feeds": {"feed.source/v1": ["fake"]}}})
    try:
        model.Kit(KIT, p)
        raise AssertionError("expected ConfigError")
    except config.ConfigError as e:
        assert "`bindings` was removed" in str(e) and "envs/<env>.yaml" in str(e)


def test_env_fs_base_is_rejected_with_a_clear_message():
    k = kit_copy()
    edit_yaml(k / "framework/envs/local-authoring.yaml", lambda d: d["spec"]["fs"].update({"base": "kit"}))
    assert_gap(k, "framework/envs/local-authoring.yaml", "fs.base was removed", "relative to the project root")


def test_forge_create_cannot_be_placed_in_framework_writing_env():
    k = kit_copy()
    edit_yaml(k / "framework/modes/forge/mode.yaml",
              lambda d: d["spec"]["endpoints"]["create"].update({"agents": {"builder": "framework-builder"}}))
    assert_gap(k, "forge.create step fill", "env framework-dev, which can write framework, bay, schemas",
               "only forge.extend may change the framework")
    s = model.resolve(model.Kit(KIT))  # shipped placement is fine: create -> author/local-authoring
    fill = next(st for st in s.modes["forge"].features["create"].steps if st.id == "fill")
    assert (fill.agent, fill.env, fill.subagent) == ("author", "local-authoring", "builder--author")
    ext = next(st for st in s.modes["forge"].features["extend"].steps if st.id == "implement")
    assert ext.env == "framework-dev"


def test_user_mode_cannot_write_framework():
    k = kit_copy()
    edit_yaml(k / "framework/agents/worker.yaml", lambda d: d["spec"].update({"env": "framework-dev"}))
    assert_gap(k, "delivery.build step implement", "only forge.extend may change the framework")


def test_feature_review_block_resolves_to_existing_placeable_reviewer():
    s = model.resolve(model.Kit(KIT))
    for m in s.modes.values():
        for f in m.features.values():
            if f.review:
                st = f.steps[-1] if f.steps[-1].kind == "review" else next(x for x in f.steps if x.kind == "review")
                assert st.role == f.review["role"] and st.role in s.roles and st.env
    k = kit_copy()
    edit_yaml(k / "modes/feed-briefing/mode.yaml",
              lambda d: d["spec"]["endpoints"]["digest"]["review"].update({"role": "nobody"}))
    assert_gap(k, "feed-briefing.digest review", "unknown review role 'nobody'")
