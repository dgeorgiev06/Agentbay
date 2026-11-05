"""Mode inheritance: `extends` is resolved at load time, so resolver, lint, conformance and adapters see a mode."""
import json

from helpers import KIT, assert_gap, edit_yaml, kit_copy, model, self_describe, unshare, whole_feature

from bay import lint


def problems(k):
    return lint.run(k)


def note_type(k):
    """A content type no source produces (`note/v1`), so a store mode with no source has a kind it may write."""
    d = k / "components/modes/feed-briefing/content-types/note"
    (d / "fixtures").mkdir(parents=True)
    (d / "content-type.yaml").write_text(
        "apiVersion: agentbay/v4\nkind: ContentType\nmetadata: { name: note, description: A note you wrote. }\n"
        "spec:\n  version: 1\n  kind: note\n  views:\n    v_notes:\n      item: true\n"
        "      includes: { view: v_items, note: \"kind = 'note' only\" }\n      columns: []\n")
    (d / "fields.schema.json").write_text(json.dumps({
        "$schema": "https://json-schema.org/draft/2020-12/schema", "$id": "agentbay/data/note/v1", "title": "note/v1",
        "description": "item/v1 kind extension for notes: kind `note`, no further fields.",
        "allOf": [{"$ref": "item/v1"}], "properties": {"kind": {"const": "note"}}, "unevaluatedProperties": False}))
    (d / "views.sql").write_text("CREATE VIEW v_notes AS SELECT v.* FROM temp.v_items v JOIN main.items i ON i.pk = v.rid WHERE i.kind = 'note';\n")
    (d / "fixtures/items.json").write_text("[]\n")
    (d / "README.md").write_text("# note\n\nA note you wrote: the item kind `note` (`note/v1`), no source produces it.\n")


def child(k, name="news-briefing", spec=None):
    """A second mode extending store, in an env of its own because a user mode may not put roles in store-local."""
    if not (k / "components/modes/feed-briefing/content-types/note").exists():
        note_type(k)
    d = k / "components" / "modes" / name
    (d / "envs").mkdir(parents=True)
    (d / f"envs/{name}-local.yaml").write_text(
        f"apiVersion: agentbay/v4\nkind: Environment\nmetadata: {{ name: {name}-local, description: Its own store. }}\n"
        f"spec:\n  bind:\n    items.store/v2: corpus-store\n    workspace.read/v1: {{ tools: [Read, Glob, Grep] }}\n"
        f"  fs: {{ read: [\".\"], write: [\".agentbay/data/{name}\"] }}\n  effects: [read, write, delete]\n")
    spec = {**(spec or {}), "roles": {**dict.fromkeys(("lead", "analyst", "reviewer"), f"{name}-local"),
                                       **(spec or {}).get("roles", {})}}
    doc = {"apiVersion": "agentbay/v4", "kind": "Mode", "metadata": {"name": name, "version": "0.1.0"},
           "spec": {"extends": "store", "composes": ["feed-briefing"], "reads": ["note/v1"], **spec}}
    (d / "mode.yaml").write_text(json.dumps(doc))
    self_describe(d)
    return d


def test_a_store_mode_with_no_source_resolves_adds_and_reads():
    from helpers import project
    from bay import dispatch
    k = kit_copy()
    child(k, "notes", {"purpose": "Keep my notes.", "reads": ["note/v1", "post/v1"]})
    assert problems(k) == []
    p = project()
    s = model.resolve(model.Kit(k, p))
    m = s.modes["notes"]
    assert set(m.features) == {"add", "update", "delete", "query", "get", "ask"} and m.roles["analyst"] == "notes-local"
    d = dispatch.Dispatcher(s, p)
    r = d.call("notes.add", {"item": {"kind": "note", "title": "milk", "text": "two litres"}})
    assert r["status"] == "done", r
    iid = r["output"]["item"]["id"]
    assert iid.startswith("local:")
    assert d.call("notes.get", {"ids": [iid]})["output"]["items"][0]["title"] == "milk"
    assert [i["id"] for i in d.call("notes.query", {})["output"]["items"]] == [iid]
    rows = d.use("analyst--notes", "items.store/v2.sql", {"sql": "SELECT id FROM v_items"})["rows"]
    assert rows == [[iid]]
    assert d.call("notes.ask", {"question": "what is there?"})["next"]["previous"]["context"]["count"] == 1
    r = d.call("notes.add", {"item": {"kind": "post", "text": "x"}})
    assert r["status"] != "done" and "produced by a source" in json.dumps(r), r


def test_child_overrides_review_steps_roles_and_inherits_the_rest():
    k = kit_copy()
    edit_yaml(k / "components/modes/feed-briefing/mode.yaml", lambda d: d["spec"].setdefault("features", {}).update(
        {"ask": whole_feature(k, "ask", review={"role": "reviewer", "when": "always", "tier": "balanced"}),
         "prune": whole_feature(k, "prune", steps=[{"id": "trim", "run": "items.store/v2.prune",
                                                    "with": {"olderThan": "7d"}}])}))
    s = model.resolve(model.Kit(k))
    ask = s.modes["feed-briefing"].features["ask"]
    assert ask.review["tier"] == "balanced" and ask.steps[-1].kind == "review"
    assert ask.steps[-1].inference.model == "sonnet"
    assert ask.playbook_path.resolve() == (k / "components/base/store/features/ask/playbook.md").resolve()
    assert [st.id for st in s.modes["feed-briefing"].features["prune"].steps] == ["trim", "review"]
    fb = s.modes["feed-briefing"]
    assert set(fb.features) == {"add", "update", "delete", "query", "get", "ask", "sync", "digest", "prune"}
    assert "question" in ask.in_schema["properties"] and fb.features["sync"].in_schema["properties"].keys() == {"lookback", "maxItems"}
    assert {"feed-briefing--digest", "feed-briefing--grounded-qa", "feed-briefing--corpus-sql"} <= set(fb.skills)
    d = child(k, spec={"purpose": "Mail.", "roles": {"analyst": "local-news", "researcher": "research"}})
    (d / "envs/local-news.yaml").write_text((d / "envs/news-briefing-local.yaml").read_text().replace("news-briefing-local", "local-news"))
    s = model.resolve(model.Kit(k))
    mail = s.modes["news-briefing"]
    assert mail.features["ask"].review is None and mail.extends == "store"
    assert mail.roles == {"lead": "news-briefing-local", "analyst": "local-news", "reviewer": "news-briefing-local",
                          "researcher": "research"}
    assert s.modes["feed-briefing"].roles["analyst"] == "local-feeds"
    assert problems(k) == []


def test_a_child_feature_is_never_merged_key_by_key_with_its_parents():
    k = kit_copy()
    edit_yaml(k / "components/modes/feed-briefing/mode.yaml", lambda d: d["spec"].setdefault("features", {}).update(
        {"ask": {"review": {"role": "reviewer", "when": "always", "tier": "balanced"}}}))
    gs = __import__("helpers").gaps(k)
    assert any("spec/features/ask: 'steps' is a required property" in g for g in gs), gs
    k = kit_copy()
    edit_yaml(k / "components/modes/feed-briefing/mode.yaml", lambda d: d["spec"].setdefault("features", {}).update(
        {"ask": {k2: v for k2, v in whole_feature(k, "ask").items() if k2 not in ("playbook", "rules")}}))
    ask = model.resolve(model.Kit(k)).modes["feed-briefing"].features["ask"]
    assert ask.playbook_path == k / "components/base/store/features/ask/playbook.md" and ask.dod
    assert problems(k) == []


def test_child_can_add_its_own_feature_and_type():
    k = kit_copy()
    d = child(k, spec={"purpose": "Mail.", "features": {"triage": {
        "in": "TriageReq", "effects": ["read"], "playbook": "features/triage/playbook.md",
        "rules": "features/triage/rules.yaml", "review": {"role": "reviewer", "when": "always"}, "uses": [], "steps": [{"id": "look", "run": "items.store/v2.query"}]}}})
    (d / "types").mkdir()
    (d / "types/TriageReq.schema.json").write_text('{"type": "object"}')
    (d / "features/triage").mkdir(parents=True)
    pb = (k / "components/modes/feed-briefing/features/prune/playbook.md").read_text().replace("briefing.prune",
            "news-briefing.triage")
    (d / "features/triage/playbook.md").write_text(pb.replace("`prune`: the dispatcher runs `items.store/v2.prune`",
                                                              "`look`: the dispatcher runs `items.store/v2.query`"))
    prune_rules = k / "components/modes/feed-briefing/features/prune/rules.yaml"
    (d / "features/triage/rules.yaml").write_text(prune_rules.read_text())
    s = model.resolve(model.Kit(k))
    assert set(s.modes["news-briefing"].features) == {"add", "update", "delete", "query", "get", "ask", "triage"}
    assert problems(k) == []


def test_missing_parent_and_cycles_are_errors_naming_the_fix():
    k = kit_copy()
    edit_yaml(k / "components/modes/feed-briefing/mode.yaml", lambda d: d["spec"].update({"extends": "nope"}))
    assert any("extends unknown mode 'nope'" in p and "components/modes/feed-briefing/mode.yaml" in p
               for p in problems(k))
    assert_gap(k, "extends unknown mode 'nope'")
    k = kit_copy()
    edit_yaml(k / "components/base/store/mode.yaml", lambda d: d["spec"].update({"extends": "feed-briefing"}))
    ps = problems(k)
    assert any("components/base/store/mode.yaml" in p and "extends 'feed-briefing', which is not an abstract base" in p
               for p in ps), ps
    k = kit_copy()
    edit_yaml(k / "components/modes/feed-briefing/mode.yaml", lambda d: d["spec"].update({"extends": "feed-briefing"}))
    assert any("extends 'feed-briefing', which is not an abstract base" in p for p in problems(k))
    k = kit_copy()
    edit_yaml(k / "components/modes/feed-briefing/mode.yaml", lambda d: d["spec"].update({"extends": "mail-briefing"}))
    assert any("components/modes/feed-briefing/mode.yaml" in p and "extends 'mail-briefing', which is not an abstract base" in p
               for p in problems(k))


def test_raw_child_may_be_partial_but_the_merged_mode_must_be_complete():
    k = kit_copy()
    child(k, spec={"features": {"extra": {"description": "no steps anywhere"}}})
    ps = problems(k)
    assert any("(after extends store)" in p and "'steps' is a required property" in p for p in ps), ps
    k = kit_copy()
    d = k / "components/modes/orphan"
    d.mkdir()
    (d / "mode.yaml").write_text(json.dumps({"apiVersion": "agentbay/v4", "kind": "Mode",
                                             "metadata": {"name": "orphan", "version": "1"}, "spec": {"purpose": "x"}}))
    assert any("components/modes/orphan/mode.yaml" in p and "'features' is a required property" in p
               for p in problems(k))


def test_abstract_base_is_linted_not_installed():
    k = kit_copy()
    s = model.resolve(model.Kit(k))
    assert "store" not in s.modes
    (k / "components/modes/feed-briefing/features/digest/playbook.md").write_text("# nothing\n")
    ps = problems(k)
    assert any("components/modes/feed-briefing/features/digest/playbook.md" in p for p in ps)
    assert not any(": store.prune declares schedule" in w for w in lint.warnings(model.Kit(k)))


def test_lint_lines_of_inherited_parts_point_at_the_parent_mode_yaml():
    def line_of(path, prefix, after=0):
        return next(i for i, ln in enumerate(path.read_text().splitlines(), 1) if i > after and ln.startswith(prefix))
    base = KIT / "components/modes/feed-briefing/mode.yaml"
    ws = lint.warnings(model.Kit(KIT))
    want = f"components/modes/feed-briefing/mode.yaml:{line_of(base,
            '      schedule: daily')}: feed-briefing.prune declares schedule"
    assert any(w.startswith(want) for w in ws), ws
    assert not any("components/modes/feed-briefing/mode.yaml:1:" in w for w in ws)
    k = kit_copy()
    edit_yaml(k / "components/modes/feed-briefing/mode.yaml", lambda d: d["spec"].setdefault("features", {}).update(
        {"prune": whole_feature(k, "prune", schedule="weekly")}))
    own = line_of(k / "components/modes/feed-briefing/mode.yaml", "      schedule: weekly")
    ws = lint.warnings(model.Kit(k))
    assert any(f"components/modes/feed-briefing/mode.yaml:{own}: feed-briefing.prune declares" in w for w in ws), ws
    k = kit_copy()
    edit_yaml(k / "components/modes/feed-briefing/mode.yaml", lambda d: d["spec"].setdefault("features", {}).update(
        {"prune": whole_feature(k, "prune", steps=[{"id": "trim", "roles": {"lead": "workspace"},
                                                    "run": "items.store/v2.prune"}])}))
    step = line_of(k / "components/modes/feed-briefing/mode.yaml", "      - id: trim")
    ps = problems(k)
    assert any(f"components/modes/feed-briefing/mode.yaml:{step}: feed-briefing.prune step trim: "
               f"`roles:` applies to role and review steps only" in p for p in ps), ps


def shared_config(k):
    """The settings every child shares are held by the base, as the child-schema rules need."""
    base = k / "components/modes/feed-briefing/config.schema.json"
    (k / "components/base/store/config.schema.json").write_text(base.read_text())
    base.unlink()
    mail = k / "components/modes/mail-briefing/config.schema.json"
    doc = json.loads(mail.read_text())
    doc["properties"] = {"important": doc["properties"]["important"]}
    doc.pop("additionalProperties")
    unshare(mail)
    mail.write_text(json.dumps(doc))
    edit_yaml(k / "components/base/store/mode.yaml", lambda d: d["spec"].update({"config": "config.schema.json"}))
    edit_yaml(k / "components/modes/feed-briefing/mode.yaml", lambda d: d["spec"].pop("config"))


def test_child_sets_config_defaults_instead_of_copying_the_config_schema():
    from helpers import project
    k = model.Kit(KIT)
    md = k.get("Mode", "feed-briefing")
    assert md.spec["configDefaults"] == {"selectors": [{"id": "home"}]}
    m = model.resolve(k).modes["feed-briefing"]
    assert m.config["selectors"] == [{"id": "home"}] and m.config["lookback"] == "3d"
    p = project({"modes": {"feed-briefing": {"selectors": [{"id": "staking", "text": "staking"}]}}})
    assert model.resolve(model.Kit(KIT, p)).modes["feed-briefing"].config["selectors"][0]["id"] == "staking"
    kc = kit_copy()
    edit_yaml(kc / "components/modes/feed-briefing/mode.yaml", lambda d: d["spec"]["configDefaults"].update(
        {"lookback": "forever", "colour": "blue"}))
    assert_gap(kc, "mode feed-briefing: configDefaults.colour is not a setting of its config schema",
               "components/modes/feed-briefing/config.schema.json")
    assert_gap(kc, "mode feed-briefing: configDefaults.lookback:", "does not match")


def test_child_config_schema_extends_its_parents():
    from helpers import project
    kc = kit_copy()
    shared_config(kc)
    k = model.Kit(kc)
    own = json.loads((kc / "components/modes/mail-briefing/config.schema.json").read_text())
    assert list(own["properties"]) == ["important"]
    md = k.get("Mode", "mail-briefing")
    assert [p.relative_to(kc).as_posix() for p in md.config_files] == [
        "components/base/store/config.schema.json", "components/modes/mail-briefing/config.schema.json"]
    gaps = []
    merged = model.config_schema(k, md, gaps)
    assert not gaps and {"lookback", "retention", "selectors", "important"} <= set(merged["properties"])
    assert merged.get("additionalProperties") is False
    m = model.resolve(k).modes["mail-briefing"]
    assert m.config["important"] == [] and m.config["lookback"] == "30d" and m.config["retention"] == "30d"
    p = project({"modes": {"mail-briefing": {"important": ["dana@partner.example"], "retention": "60d"}}})
    c = model.resolve(model.Kit(kc, p)).modes["mail-briefing"].config
    assert c["important"] == ["dana@partner.example"] and c["retention"] == "60d"
    p = project({"modes": {"mail-briefing": {"colour": "blue"}}})
    assert_gap(kc, "modes.mail-briefing", "colour", project=p)


def test_redefining_a_parent_config_key_is_a_lint_error():
    k = kit_copy()
    shared_config(k)
    sch = k / "components/modes/mail-briefing/config.schema.json"
    doc = json.loads(sch.read_text())
    doc["properties"]["lookback"] = {"type": "string", "default": "1d"}
    sch.write_text(json.dumps(doc))
    want = ("mode mail-briefing: config schema components/modes/mail-briefing/config.schema.json redefines inherited "
            "setting 'lookback'")
    assert_gap(k, want, "configDefaults")
    assert any(want in e for e in problems(k))


def test_child_config_schema_defs_collision_and_other_keywords_are_errors_f13():
    k = kit_copy()
    shared_config(k)
    sch = k / "components/modes/mail-briefing/config.schema.json"
    psch = k / "components/base/store/config.schema.json"
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
    rel = "components/modes/mail-briefing/config.schema.json"
    want_defs = f"mode mail-briefing: config schema {rel} redefines inherited $defs '{clash}'"
    want_kw = [f"mode mail-briefing: config schema {rel} uses top-level keyword '{kw}'"
               for kw in ("allOf", "patternProperties")]
    for w in [want_defs, *want_kw]:
        assert_gap(k, w)
        assert any(w in e for e in problems(k))
    gaps = []
    merged = model.config_schema(model.Kit(k, None), model.Kit(k, None).get("Mode", "mail-briefing"), gaps)
    assert merged["$defs"][clash] == parent["$defs"][clash] and "mailOnly" in merged["$defs"]


def test_child_config_schema_type_and_additional_properties_must_equal_the_parents_n5():
    k = kit_copy()
    shared_config(k)
    sch = k / "components/modes/mail-briefing/config.schema.json"
    doc = json.loads(sch.read_text())
    doc["additionalProperties"] = False
    sch.write_text(json.dumps(doc))
    gaps = []
    model.config_schema(model.Kit(k, None), model.Kit(k, None).get("Mode", "mail-briefing"), gaps)
    assert gaps == []
    rel = "components/modes/mail-briefing/config.schema.json"
    for kw, val in (("additionalProperties", True), ("type", "array")):
        doc2 = dict(doc, **{kw: val})
        sch.write_text(json.dumps(doc2))
        want = f"mode mail-briefing: config schema {rel} sets top-level '{kw}' to {json.dumps(val)}"
        assert_gap(k, want)
        assert any(want in e for e in problems(k))
