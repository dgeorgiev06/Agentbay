"""Mode inheritance: `extends` is resolved at load time, so resolver, lint, conformance and adapters see a
complete mode; children override features, steps, playbooks, rules, review and roles; cycles and missing
parents are errors; abstract bases are linted but never resolved or installed."""
import json

from helpers import KIT, assert_gap, edit_yaml, kit_copy, model, self_describe, whole_feature

from bay import lint


def problems(k):
    return lint.run(k)


def child(k, name="news-briefing", spec=None):
    """A second mode extending briefing, next to feed-briefing (each (role, mode, env) compiles on its own)."""
    d = k / "modes" / name
    d.mkdir(parents=True)
    doc = {"apiVersion": "agentbay/v2", "kind": "Mode", "metadata": {"name": name, "version": "0.1.0"},
           "spec": {"extends": "briefing", "reads": ["post/v1"], **(spec or {})}}   # a briefing child says what it reads (B-6)
    (d / "mode.yaml").write_text(json.dumps(doc))
    self_describe(d)
    return d


def test_feed_briefing_is_complete_after_extends():
    k = model.Kit(KIT)
    md = k.get("Mode", "feed-briefing")
    assert md.parent == "briefing" and md.dirs == [KIT / "modes/feed-briefing", KIT / "modes/briefing"]
    s = md.spec
    assert set(s["features"]) == {"sync", "digest", "ask", "prune"} and s["coordinator"] == "lead"
    assert s["features"]["digest"]["playbook"] == "../briefing/features/digest/playbook.md"     # rebased
    assert s["features"]["sync"]["playbook"] == "../briefing/features/sync/playbook.md"        # inherited
    assert s["features"]["sync"]["rules"] == "../briefing/features/sync/rules.yaml"            # inherited
    assert s["features"]["sync"]["effects"] == ["network", "spend", "write"]                   # merged per key
    assert s["config"] == "../briefing/config.schema.json" and "abstract" not in s and "extends" in s
    assert s["constraints"]["maxItemsPerRun"] == 500 and s["constraints"]["lookbackMax"] == "30d"
    sysm = model.resolve(k)
    m = sysm.modes["feed-briefing"]
    assert m.features["sync"].in_schema["properties"].keys() == {"lookback", "maxItems"}       # parent type
    assert "question" in m.features["ask"].in_schema["properties"]                             # parent type
    assert {"feed-briefing--digest", "feed-briefing--grounded-qa", "feed-briefing--corpus-sql"} <= set(m.skills)
    assert m.playbook.startswith("# feed-briefing (coordinator playbook")                      # own playbook.md
    assert m.config["selectors"] == [{"id": "home"}]


def test_child_overrides_review_steps_roles_and_inherits_the_rest():
    k = kit_copy()
    edit_yaml(k / "modes/feed-briefing/mode.yaml", lambda d: d["spec"].setdefault("features", {}).update(
        {"ask": whole_feature(k, "ask", review={"role": "reviewer", "when": "always", "tier": "balanced"}),
         "prune": whole_feature(k, "prune", steps=[{"id": "trim", "run": "items.store/v1.prune",
                                                    "with": {"olderThan": "7d"}}])}))
    s = model.resolve(model.Kit(k))
    ask = s.modes["feed-briefing"].features["ask"]
    assert ask.review["tier"] == "balanced" and ask.steps[-1].kind == "review"
    assert ask.steps[-1].inference.model == "sonnet"
    assert ask.playbook_path.resolve() == (k / "modes/briefing/features/ask/playbook.md").resolve()
    assert [st.id for st in s.modes["feed-briefing"].features["prune"].steps] == ["trim", "review"]
    # a second child of the same base keeps the base behaviour
    (k / "envs/local-news.yaml").write_text(
        "apiVersion: agentbay/v2\nkind: Environment\nmetadata: { name: local-news, description: Another briefing env. }\n"
        "spec:\n  bind:\n    items.source/v1: [fake]\n    items.store/v1: corpus-store\n  network: { allow: [] }\n"
        "  fs: { read: [\".\"], write: [\".agentbay/data/news\"] }\n  effects: [read, write, network, spend, delete]\n")
    child(k, spec={"purpose": "Mail.", "roles": {"analyst": "local-news", "researcher": "research"}})
    s = model.resolve(model.Kit(k))
    mail = s.modes["news-briefing"]
    assert mail.features["ask"].review is None and mail.extends == "briefing"
    # the roles map is inherited and overridden entry by entry
    assert mail.roles == {"lead": "local-feeds", "analyst": "local-news", "reviewer": "local-feeds",
                          "researcher": "research"}
    assert s.modes["feed-briefing"].roles["analyst"] == "local-feeds"
    assert problems(k) == []


def test_a_child_feature_is_never_merged_key_by_key_with_its_parents():
    k = kit_copy()
    edit_yaml(k / "modes/feed-briefing/mode.yaml", lambda d: d["spec"].setdefault("features", {}).update(
        {"ask": {"review": {"role": "reviewer", "when": "always", "tier": "balanced"}}}))
    gs = __import__("helpers").gaps(k)
    assert any("spec/features/ask: 'steps' is a required property" in g for g in gs), gs     # the rest is not inherited


def test_child_can_add_its_own_feature_and_type():
    k = kit_copy()
    d = child(k, spec={"purpose": "Mail.", "features": {"triage": {
        "in": "TriageReq", "effects": ["read"], "playbook": "features/triage/playbook.md",
        "rules": "features/triage/rules.yaml", "steps": [{"id": "look", "run": "items.store/v1.query"}]}}})
    (d / "types").mkdir()
    (d / "types/TriageReq.schema.json").write_text('{"type": "object"}')
    (d / "features/triage").mkdir(parents=True)
    pb = (k / "modes/briefing/features/prune/playbook.md").read_text().replace("briefing.prune", "news-briefing.triage")
    (d / "features/triage/playbook.md").write_text(pb.replace("`prune`: the dispatcher runs `items.store/v1.prune`",
                                                              "`look`: the dispatcher runs `items.store/v1.query`"))
    (d / "features/triage/rules.yaml").write_text((k / "modes/briefing/features/prune/rules.yaml").read_text())
    s = model.resolve(model.Kit(k))
    assert set(s.modes["news-briefing"].features) == {"sync", "digest", "ask", "prune", "triage"}
    assert problems(k) == []


def test_missing_parent_and_cycles_are_errors_naming_the_fix():
    k = kit_copy()
    edit_yaml(k / "modes/feed-briefing/mode.yaml", lambda d: d["spec"].update({"extends": "nope"}))
    assert any("extends unknown mode 'nope'" in p and "modes/feed-briefing/mode.yaml" in p for p in problems(k))
    assert_gap(k, "extends unknown mode 'nope'")
    k = kit_copy()
    edit_yaml(k / "modes/briefing/mode.yaml", lambda d: d["spec"].update({"extends": "feed-briefing"}))
    ps = problems(k)
    assert any("mode inheritance cycle" in p and "briefing -> feed-briefing -> briefing" in p for p in ps), ps
    k = kit_copy()
    edit_yaml(k / "modes/feed-briefing/mode.yaml", lambda d: d["spec"].update({"extends": "feed-briefing"}))
    assert any("cycle: feed-briefing -> feed-briefing" in p for p in problems(k))


def test_raw_child_may_be_partial_but_the_merged_mode_must_be_complete():
    k = kit_copy()
    child(k, spec={"features": {"extra": {"description": "no steps anywhere"}}})
    ps = problems(k)
    assert any("(after extends briefing)" in p and "'steps' is a required property" in p for p in ps), ps
    k = kit_copy()
    d = k / "modes/orphan"
    d.mkdir()
    (d / "mode.yaml").write_text(json.dumps({"apiVersion": "agentbay/v2", "kind": "Mode",
                                             "metadata": {"name": "orphan", "version": "1"}, "spec": {"purpose": "x"}}))
    assert any("modes/orphan/mode.yaml" in p and "'features' is a required property" in p for p in problems(k))


def test_abstract_base_is_linted_not_installed():
    k = kit_copy()
    s = model.resolve(model.Kit(k))
    assert "briefing" not in s.modes
    (k / "modes/briefing/features/digest/playbook.md").write_text("# nothing\n")
    ps = problems(k)
    assert any("modes/briefing/features/digest/playbook.md" in p for p in ps)        # still linted
    assert not any(": briefing.prune declares schedule" in w for w in lint.warnings(model.Kit(k)))   # children only


def test_lint_lines_of_inherited_parts_point_at_the_parent_mode_yaml():
    def line_of(path, prefix, after=0):
        return next(i for i, ln in enumerate(path.read_text().splitlines(), 1) if i > after and ln.startswith(prefix))
    base = KIT / "modes/briefing/mode.yaml"
    ws = lint.warnings(model.Kit(KIT))
    want = f"modes/briefing/mode.yaml:{line_of(base, '      schedule: daily')}: feed-briefing.prune declares schedule"
    assert any(w.startswith(want) for w in ws), ws
    assert not any("modes/feed-briefing/mode.yaml:1:" in w for w in ws)
    # a child that sets the schedule itself is reported at its own line
    k = kit_copy()
    edit_yaml(k / "modes/feed-briefing/mode.yaml", lambda d: d["spec"].setdefault("features", {}).update(
        {"prune": whole_feature(k, "prune", schedule="weekly")}))
    own = line_of(k / "modes/feed-briefing/mode.yaml", "      schedule: weekly")
    ws = lint.warnings(model.Kit(k))
    assert any(f"modes/feed-briefing/mode.yaml:{own}: feed-briefing.prune declares" in w for w in ws), ws
    # steps a child sets itself are reported at the step in the child's own mode.yaml
    k = kit_copy()
    edit_yaml(k / "modes/feed-briefing/mode.yaml", lambda d: d["spec"].setdefault("features", {}).update(
        {"prune": whole_feature(k, "prune", steps=[{"id": "trim", "roles": {"lead": "workspace"},
                                                    "run": "items.store/v1.prune"}])}))
    step = line_of(k / "modes/feed-briefing/mode.yaml", "      - id: trim")
    ps = problems(k)
    assert any(f"modes/feed-briefing/mode.yaml:{step}: feed-briefing.prune step trim: `roles:` applies to role and "
               f"review steps only" in p for p in ps), ps


def test_child_sets_config_defaults_instead_of_copying_the_config_schema():
    from helpers import project
    k = model.Kit(KIT)
    md = k.get("Mode", "feed-briefing")
    assert not (KIT / "modes/feed-briefing/config.schema.json").exists()          # no copy of briefing's
    assert md.spec["configDefaults"] == {"selectors": [{"id": "home"}]}
    m = model.resolve(k).modes["feed-briefing"]
    assert m.config["selectors"] == [{"id": "home"}] and m.config["lookback"] == "3d"   # child + parent defaults
    # the user's settings still win over configDefaults
    p = project({"modes": {"feed-briefing": {"selectors": [{"id": "staking", "text": "staking"}]}}})
    assert model.resolve(model.Kit(KIT, p)).modes["feed-briefing"].config["selectors"][0]["id"] == "staking"
    # a key the config schema does not declare, or a value it rejects, is a gap naming the mode
    kc = kit_copy()
    edit_yaml(kc / "modes/feed-briefing/mode.yaml", lambda d: d["spec"]["configDefaults"].update(
        {"lookback": "forever", "colour": "blue"}))
    assert_gap(kc, "mode feed-briefing: configDefaults.colour is not a setting of its config schema",
               "modes/briefing/config.schema.json")
    assert_gap(kc, "mode feed-briefing: configDefaults.lookback:", "does not match")


def test_child_config_schema_extends_its_parents():
    from helpers import project
    k = model.Kit(KIT)
    own = json.loads((KIT / "modes/mail-briefing/config.schema.json").read_text())
    assert list(own["properties"]) == ["important"]                                   # only its own key
    md = k.get("Mode", "mail-briefing")
    assert [p.relative_to(KIT).as_posix() for p in md.config_files] == [
        "modes/briefing/config.schema.json", "modes/mail-briefing/config.schema.json"]
    gaps = []
    merged = model.config_schema(k, md, gaps)
    assert not gaps and {"lookback", "retention", "selectors", "important"} <= set(merged["properties"])
    assert merged.get("additionalProperties") is False                                 # the parent's rule holds
    m = model.resolve(k).modes["mail-briefing"]
    assert m.config["important"] == [] and m.config["lookback"] == "30d" and m.config["retention"] == "30d"
    p = project({"modes": {"mail-briefing": {"important": ["dana@partner.example"], "retention": "60d"}}})
    c = model.resolve(model.Kit(KIT, p)).modes["mail-briefing"].config
    assert c["important"] == ["dana@partner.example"] and c["retention"] == "60d"
    p = project({"modes": {"mail-briefing": {"colour": "blue"}}})                    # still closed to unknown keys
    assert_gap(KIT, "modes.mail-briefing", "colour", project=p)


def test_redefining_a_parent_config_key_is_a_lint_error():
    k = kit_copy()
    sch = k / "modes/mail-briefing/config.schema.json"
    doc = json.loads(sch.read_text())
    doc["properties"]["lookback"] = {"type": "string", "default": "1d"}
    sch.write_text(json.dumps(doc))
    want = ("mode mail-briefing: config schema modes/mail-briefing/config.schema.json redefines inherited "
            "setting 'lookback'")
    assert_gap(k, want, "configDefaults")
    assert any(want in e for e in problems(k))                                       # `bay check` reports it too


def test_child_config_schema_defs_collision_and_other_keywords_are_errors_f13():
    k = kit_copy()
    sch = k / "modes/mail-briefing/config.schema.json"
    psch = k / "modes/briefing/config.schema.json"
    parent = json.loads(psch.read_text())
    parent["$defs"] = {"duration": {"type": "string", "pattern": "^[0-9]+d$"}}
    psch.write_text(json.dumps(parent))
    doc = json.loads(sch.read_text())
    clash = "duration"
    doc.setdefault("$defs", {})[clash] = {"type": "string"}
    doc["$defs"]["mailOnly"] = {"type": "string"}
    doc["allOf"] = [{"required": ["lookback"]}]
    doc["patternProperties"] = {"^x-": {}}
    sch.write_text(json.dumps(doc))
    rel = "modes/mail-briefing/config.schema.json"
    want_defs = f"mode mail-briefing: config schema {rel} redefines inherited $defs '{clash}'"
    want_kw = [f"mode mail-briefing: config schema {rel} uses top-level keyword '{kw}'"
               for kw in ("allOf", "patternProperties")]
    for w in [want_defs, *want_kw]:
        assert_gap(k, w)
        assert any(w in e for e in problems(k))
    gaps = []
    merged = model.config_schema(model.Kit(k, None), model.Kit(k, None).get("Mode", "mail-briefing"), gaps)
    assert merged["$defs"][clash] == parent["$defs"][clash] and "mailOnly" in merged["$defs"]   # parent's kept


def test_child_config_schema_type_and_additional_properties_must_equal_the_parents_n5():
    k = kit_copy()
    sch = k / "modes/mail-briefing/config.schema.json"
    doc = json.loads(sch.read_text())
    doc["additionalProperties"] = False                    # restates the parent's value: allowed
    sch.write_text(json.dumps(doc))
    gaps = []
    model.config_schema(model.Kit(k, None), model.Kit(k, None).get("Mode", "mail-briefing"), gaps)
    assert gaps == []
    rel = "modes/mail-briefing/config.schema.json"
    for kw, val in (("additionalProperties", True), ("type", "array")):
        doc2 = dict(doc, **{kw: val})
        sch.write_text(json.dumps(doc2))
        want = f"mode mail-briefing: config schema {rel} sets top-level '{kw}' to {json.dumps(val)}"
        assert_gap(k, want)
        assert any(want in e for e in problems(k))
