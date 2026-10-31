"""Resolver: the shipped kit resolves; every failure mode yields an exact, readable gap."""
from helpers import KIT, assert_gap, edit_yaml, gaps, kit_copy, model, whole_feature


def test_shipped_kit_resolves():
    s = model.resolve(model.Kit(KIT))
    assert {"feed-briefing", "delivery", "forge"} <= set(s.modes)
    d = s.modes["feed-briefing"].features["digest"]
    assert [st.kind for st in d.steps] == ["code", "code", "role", "review"]
    review = d.steps[-1]
    assert review.role == "reviewer" and review.inference.model == "opus" and review.inference.effort == "high"
    units = s.units()
    assert units["analyst--feed-briefing"].bay_uses == [f"items.store/v1.{e}" for e in (
        "describe", "sql", "get", "thread", "threads", "facets", "search", "query", "status")]
    assert "briefing" not in s.modes and s.modes["feed-briefing"].extends == "briefing"    # abstract base
    assert "Edit" not in units["reviewer--feed-briefing"].tools
    assert s.agent == "claude-code" and set(model.Kit(KIT).profiles()) == {"claude-code"}   # one profile


def step(s, target, sid):
    mode, ep = target.split(".")
    return next(st for st in s.modes[mode].features[ep].steps if st.id == sid)


def test_tier_resolution_step_over_feature_over_role_mapped_by_the_profile():
    k = kit_copy()
    s = model.resolve(model.Kit(k))
    ans = step(s, "feed-briefing.ask", "answer")
    assert (ans.inference.tier, ans.inference.model, ans.inference.effort) == ("balanced", "sonnet", "medium")  # role
    rv = step(s, "feed-briefing.digest", "review")
    assert (rv.inference.tier, rv.inference.model, rv.inference.effort) == ("deep", "opus", "high")    # review block
    # a feature's tier beats the role's; a step's beats the feature's; review steps keep their review block's
    edit_yaml(k / "modes/briefing/mode.yaml", lambda d: (
        d["spec"]["features"]["ask"].update({"tier": "fast", "effort": "low"}),
        d["spec"]["features"]["digest"].update({"tier": "fast"}),
        d["spec"]["features"]["digest"]["steps"][2].update({"tier": "deep", "effort": "high"})))
    s = model.resolve(model.Kit(k))
    ans = step(s, "feed-briefing.ask", "answer")
    assert (ans.inference.tier, ans.inference.model, ans.inference.effort) == ("fast", "haiku", "low")
    th = step(s, "feed-briefing.digest", "themes")
    assert (th.inference.tier, th.inference.model, th.inference.effort) == ("deep", "opus", "high")
    assert step(s, "feed-briefing.digest", "review").inference.tier == "deep"
    # the role's default tier, when nothing else sets one
    edit_yaml(k / "framework/roles/analyst.yaml", lambda d: d["spec"].update({"tier": "deep"}))
    s = model.resolve(model.Kit(k))
    assert step(s, "feed-briefing.prune", "review").inference.model == "sonnet"            # review block: balanced
    assert s.units()["analyst--feed-briefing"].inference.model == "opus"          # role default
    # the profile maps tiers: another model name for `deep` changes only the model
    edit_yaml(k / "adapters/claude-code/adapter.yaml", lambda d: d["profile"]["tiers"].update({"deep": "opus-next"}))
    s = model.resolve(model.Kit(k))
    assert step(s, "feed-briefing.digest", "themes").inference.model == "opus-next"


def test_env_tier_cap_names_mode_feature_step_role_env_and_tier():
    k = kit_copy()
    edit_yaml(k / "envs/local-feeds.yaml", lambda d: d["spec"].update({"tiers": ["fast"]}))
    g = assert_gap(k, "feed-briefing.ask step answer: role analyst in env local-feeds runs at tier "
                      "'balanced' (from role analyst's default)", "allows: fast")
    assert "envs/local-feeds.yaml" in g
    edit_yaml(k / "modes/briefing/mode.yaml", lambda d: d["spec"]["features"]["ask"]["steps"][2].update({"tier": "deep"}))
    assert_gap(k, "feed-briefing.ask step answer", "tier 'deep' (from the step)", "env local-feeds")
    edit_yaml(k / "modes/briefing/mode.yaml", lambda d: (d["spec"]["features"]["ask"]["steps"][2].pop("tier"),
                                                         d["spec"]["features"]["ask"].update({"tier": "deep"})))
    assert_gap(k, "feed-briefing.ask step answer", "tier 'deep' (from the feature)")
    edit_yaml(k / "modes/briefing/mode.yaml", lambda d: d["spec"]["features"]["ask"].update({"tier": "fast"}))
    assert not any("feed-briefing.ask step answer" in x for x in gaps(k))


def test_unbound_capability():
    k = kit_copy()
    edit_yaml(k / "envs/local-feeds.yaml", lambda d: d["spec"]["bind"].pop("items.store/v1"))
    g = assert_gap(k, "feed-briefing.sync step fetch", "items.store/v1 is not bound in env local-feeds", "unbound capability")
    assert "add `items.store/v1: <connector>`" in g
    # (the analyst then simply has no store grant in that env: test_roles)


def test_effect_not_allowed_by_env():
    k = kit_copy()
    edit_yaml(k / "envs/local-feeds.yaml", lambda d: d["spec"].update({"effects": ["read", "write", "network", "spend"]}))
    assert_gap(k, "feed-briefing.prune step prune", "effect 'delete'", "not allowed by env local-feeds")


def test_effect_not_declared_by_endpoint():
    k = kit_copy()
    edit_yaml(k / "modes/feed-briefing/mode.yaml",
              lambda d: d["spec"].setdefault("features", {}).update(
                  {"sync": whole_feature(k, "sync", effects=["network", "write"])}))
    assert_gap(k, "feed-briefing.sync step fetch", "effect 'spend'", "not declared by the endpoint")


def test_unknown_role_env_and_agent_profile():
    from helpers import project
    k = kit_copy()
    edit_yaml(k / "modes/briefing/mode.yaml",
              lambda d: d["spec"]["features"]["ask"]["steps"][2].update({"role": "ghost"}))
    assert_gap(k, "feed-briefing.ask step answer", "unknown role 'ghost'")
    k = kit_copy()
    edit_yaml(k / "modes/briefing/mode.yaml", lambda d: d["spec"]["roles"].update({"analyst": "nowhere"}))
    assert_gap(k, "feed-briefing.digest step themes: role analyst in env nowhere: unknown env 'nowhere'",
               "fix mode feed-briefing `roles:`")
    gs = gaps(KIT, project({"agent": "nobody"}))
    assert any("agent profile 'nobody' not found (have: claude-code)" in g for g in gs), gs


def test_connector_needs_exceed_env():
    k = kit_copy()
    edit_yaml(k / "envs/local-feeds.yaml", lambda d: d["spec"].update({"network": {"allow": ["example.com"]}}))
    assert_gap(k, "env local-feeds", "connector x-api needs network host api.x.com", "not in network.allow")
    k = kit_copy()
    edit_yaml(k / "envs/local-feeds.yaml", lambda d: d["spec"]["secrets"].update({"allow": ["X_CLIENT_ID"]}))
    assert_gap(k, "connector x-api needs secret X_REFRESH_TOKEN")
    k = kit_copy()
    edit_yaml(k / "envs/local-feeds.yaml", lambda d: d["spec"].update({"fs": {"read": ["."], "write": ["elsewhere"]}}))
    edit_yaml(k / "connectors/x-api/connector.yaml", lambda d: d["spec"]["needs"].update({"fs": {"write": [".agentbay/data/feeds"]}}))
    assert_gap(k, "connector x-api needs fs.write .agentbay/data/feeds", "outside env fs.write")


def test_unknown_connector_and_wrong_interface():
    k = kit_copy()
    edit_yaml(k / "envs/local-feeds.yaml", lambda d: d["spec"]["bind"].update({"items.source/v1": ["bsky"]}))
    assert_gap(k, "binds items.source/v1 to unknown connector 'bsky'")
    k = kit_copy()
    edit_yaml(k / "envs/local-feeds.yaml", lambda d: d["spec"]["bind"].update({"items.source/v1": ["corpus-store"]}))
    assert_gap(k, "connector corpus-store is bound to items.source/v1 but implements items.store/v1")


def test_coordinator_must_run_in_main_thread():
    k = kit_copy()
    edit_yaml(k / "adapters/claude-code/adapter.yaml",
              lambda d: d["profile"]["runtime"].update({"coordinator": "claude-code-subagent"}))
    assert_gap(k, "agent profile claude-code: coordinators run on runtime claude-code-subagent",
               "need claude-code-main")


def test_all_gaps_reported_at_once():
    k = kit_copy()
    edit_yaml(k / "envs/local-feeds.yaml", lambda d: d["spec"].update({"tiers": ["fast"], "network": {"allow": []}}))
    gs = gaps(k)
    assert any("tier 'balanced'" in g for g in gs) and any("api.x.com" in g for g in gs)


def test_wrong_kind_is_rejected():
    k = kit_copy()
    (k / "modes/old").mkdir()
    (k / "modes/old/mode.yaml").write_text("apiVersion: agentbay/v1\nkind: Layer\nmetadata: {name: old}\nspec: {}\n")
    assert_gap(k, "modes/old/mode.yaml", "kind must be Mode")


def test_config_schema_rejects_unknown_settings():
    from helpers import project
    from bay import config
    p = project({"modes": {"feed-briefing": {"lookback": "90d"}}})
    gs = gaps(KIT, p)
    assert any("lookback 90d exceeds mode lookbackMax 30d" in g for g in gs), gs
    p = project({"modes": {"feed-briefing": {"bogus": 1}}})
    assert any("modes.feed-briefing" in g and "bogus" in g for g in gaps(KIT, p))
    p = project({"bindings": {"local-feeds": {"items.source/v1": ["fake"]}}})
    try:
        model.Kit(KIT, p)
        raise AssertionError("expected ConfigError")
    except config.ConfigError as e:
        assert "bindings" in str(e)


def test_forge_create_cannot_be_placed_in_framework_writing_env():
    k = kit_copy()
    edit_yaml(k / "modes/forge/mode.yaml",
              lambda d: d["spec"]["features"]["create"].update({"roles": {"builder": "framework-dev"}}))
    assert_gap(k, "forge.create step fill", "env framework-dev, which can write framework, bay, schemas",
               "only forge.extend may change the framework")
    s = model.resolve(model.Kit(KIT))  # shipped: create uses the mode's env, extend overrides it
    fill = next(st for st in s.modes["forge"].features["create"].steps if st.id == "fill")
    assert (fill.agent, fill.env, fill.subagent) == ("claude-code", "local-authoring", "builder--forge--local-authoring")
    ext = next(st for st in s.modes["forge"].features["extend"].steps if st.id == "implement")
    assert ext.env == "framework-dev"


def test_user_mode_cannot_write_framework():
    k = kit_copy()
    edit_yaml(k / "modes/delivery/mode.yaml", lambda d: d["spec"]["roles"].update({"builder": "framework-dev"}))
    assert_gap(k, "mode delivery: role builder works in the framework env framework-dev",
               "delivery.build step implement", "user modes may put roles only in their own envs")
    # a framework mode is still checked for the framework boundary
    edit_yaml(k / "modes/improve/mode.yaml", lambda d: d["spec"]["roles"].update({"analyst": "framework-dev"}))
    assert_gap(k, "improve.scan step patterns", "env framework-dev", "only forge.extend may change the framework")


def test_feature_review_block_resolves_to_existing_placeable_reviewer():
    s = model.resolve(model.Kit(KIT))
    for m in s.modes.values():
        for f in m.features.values():
            if f.review:
                st = f.steps[-1] if f.steps[-1].kind == "review" else next(x for x in f.steps if x.kind == "review")
                assert st.role == f.review["role"] and st.role in s.roles and st.env and st.resolved.mode == m.name
    k = kit_copy()
    edit_yaml(k / "modes/briefing/mode.yaml",
              lambda d: d["spec"]["features"]["digest"]["review"].update({"role": "nobody"}))
    assert_gap(k, "feed-briefing.digest review", "unknown review role 'nobody'")


def test_offline_switch_rebinds_the_source_and_closes_network_and_secrets():
    from helpers import project
    real = model.Kit(KIT, project(source="x-api")).get("Environment", "local-feeds").spec
    assert real["bind"]["items.source/v1"] == ["x-api"] and real["network"]["allow"] == ["api.x.com"]
    k = model.Kit(KIT, project())
    off = k.get("Environment", "local-feeds").spec
    assert off["bind"]["items.source/v1"] == ["fake"] and off["bind"]["items.store/v1"] == "corpus-store"
    assert off["network"] == {"allow": []} and off["secrets"]["allow"] == []
    assert k.get("Environment", "local-mail").spec["bind"]["items.source/v1"] == ["fake-mail"]
    assert k.get("Environment", "workspace").spec == model.Kit(KIT, project(source="x-api")).get(
        "Environment", "workspace").spec                      # an env without an `offline:` block is unchanged
    s = model.resolve(k)
    assert s.units()["analyst--feed-briefing"].env == "local-feeds"      # the env keeps its name
    assert s.modes["feed-briefing"].features["sync"].steps[0].connector == "corpus-store"
    from bay import config
    for bad, word in (({"offline": "yes"}, "offline"), ({"envs": {"local-feeds": "workspace"}}, "envs")):
        try:                                                  # not a boolean; the `envs:` map is gone
            model.Kit(KIT, project(bad))
            raise AssertionError("expected ConfigError")
        except config.ConfigError as e:
            assert word in str(e)
