"""Mode inheritance: `extends` is resolved at load time, so resolver, lint, conformance and adapters see a
complete mode; children override endpoints, workflows, playbooks, rules, review and roles; cycles and missing
parents are errors; abstract bases are linted but never resolved or installed."""
import json

from helpers import KIT, assert_gap, edit_yaml, kit_copy, model

from bay import lint


def problems(k):
    return lint.run(k)


def child(k, name="mail-briefing", spec=None):
    """A second mode extending briefing. It replaces feed-briefing: until per-mode role placement (proposal
    0003 step 3) two such modes would share briefing-analyst, which validate refuses (see the last test)."""
    import shutil
    shutil.rmtree(k / "modes/feed-briefing", ignore_errors=True)
    d = k / "modes" / name
    d.mkdir(parents=True)
    doc = {"apiVersion": "agentbay/v2", "kind": "Mode", "metadata": {"name": name, "version": "0.1.0"},
           "spec": {"extends": "briefing", **(spec or {})}}
    (d / "mode.yaml").write_text(json.dumps(doc))
    return d


def test_feed_briefing_is_complete_after_extends():
    k = model.Kit(KIT)
    md = k.get("Mode", "feed-briefing")
    assert md.parent == "briefing" and md.dirs == [KIT / "modes/feed-briefing", KIT / "modes/briefing"]
    s = md.spec
    assert set(s["endpoints"]) == {"sync", "digest", "ask", "prune"} and s["coordinator"] == "briefing-lead"
    assert s["endpoints"]["digest"]["playbook"] == "../briefing/features/digest/playbook.md"     # rebased
    assert s["endpoints"]["sync"]["playbook"] == "features/sync/playbook.md"                    # own override
    assert s["endpoints"]["sync"]["rules"] == "../briefing/features/sync/rules.yaml"            # inherited
    assert s["endpoints"]["sync"]["effects"] == ["network", "spend", "write"]                   # merged per key
    assert s["config"] == "config.schema.json" and "abstract" not in s and "extends" in s
    assert s["constraints"]["maxItemsPerRun"] == 500 and s["constraints"]["lookbackMax"] == "30d"
    sysm = model.resolve(k)
    m = sysm.modes["feed-briefing"]
    assert m.features["sync"].in_schema["properties"].keys() == {"lookback", "maxPosts"}       # child type
    assert "question" in m.features["ask"].in_schema["properties"]                             # parent type
    assert {"digest", "grounded-qa", "corpus-sql"} <= set(m.skills)
    assert m.playbook.startswith("# feed-briefing (coordinator playbook")                      # own playbook.md
    assert m.config["selectors"] == [{"id": "home"}]
    assert m.features["sync"].steps[0].with_ == {"lookback": "$in.lookback|$config.lookback", "maxItems": "$in.maxPosts"}


def test_child_overrides_review_workflow_roles_and_inherits_the_rest():
    k = kit_copy()
    edit_yaml(k / "modes/feed-briefing/mode.yaml", lambda d: d["spec"]["endpoints"].update(
        {"ask": {"review": {"role": "reviewer", "when": "always", "model": "sonnet"}}}))
    edit_yaml(k / "modes/feed-briefing/mode.yaml", lambda d: d["spec"]["workflows"].update(
        {"prune": [{"id": "trim", "run": "items.store/v1.prune", "with": {"olderThan": "7d"}}]}))
    s = model.resolve(model.Kit(k))
    ask = s.modes["feed-briefing"].features["ask"]
    assert ask.review["model"] == "sonnet" and ask.steps[-1].kind == "review"
    assert ask.playbook_path.resolve() == (k / "modes/briefing/features/ask/playbook.md").resolve()
    assert [st.id for st in s.modes["feed-briefing"].features["prune"].steps] == ["trim", "review"]
    # a second child of the same base keeps the base behaviour
    child(k, spec={"purpose": "Mail.", "roles": ["briefing-lead", "briefing-analyst", "reviewer", "researcher"]})
    s = model.resolve(model.Kit(k))
    mail = s.modes["mail-briefing"]
    assert mail.features["ask"].review is None and mail.roles[-1] == "researcher" and mail.extends == "briefing"
    assert problems(k) == []


def test_child_can_add_its_own_feature_and_type():
    k = kit_copy()
    d = child(k, spec={"purpose": "Mail.", "endpoints": {"triage": {
        "workflow": "triage", "in": "TriageReq", "effects": ["read"], "playbook": "features/triage/playbook.md",
        "rules": "features/triage/rules.yaml"}},
        "workflows": {"triage": [{"id": "look", "run": "items.store/v1.query"}]}})
    (d / "types").mkdir()
    (d / "types/TriageReq.schema.json").write_text('{"type": "object"}')
    (d / "features/triage").mkdir(parents=True)
    pb = (k / "modes/briefing/features/prune/playbook.md").read_text().replace("briefing.prune", "mail-briefing.triage")
    (d / "features/triage/playbook.md").write_text(pb.replace("`prune`: the dispatcher runs `items.store/v1.prune`",
                                                              "`look`: the dispatcher runs `items.store/v1.query`"))
    (d / "features/triage/rules.yaml").write_text((k / "modes/briefing/features/prune/rules.yaml").read_text())
    s = model.resolve(model.Kit(k))
    assert set(s.modes["mail-briefing"].features) == {"sync", "digest", "ask", "prune", "triage"}
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
    child(k, spec={"endpoints": {"extra": {"description": "no workflow anywhere"}}})
    ps = problems(k)
    assert any("(after extends briefing)" in p and "'workflow' is a required property" in p for p in ps), ps
    k = kit_copy()
    d = k / "modes/orphan"
    d.mkdir()
    (d / "mode.yaml").write_text(json.dumps({"apiVersion": "agentbay/v2", "kind": "Mode",
                                             "metadata": {"name": "orphan", "version": "1"}, "spec": {"purpose": "x"}}))
    assert any("modes/orphan/mode.yaml" in p and "'endpoints' is a required property" in p for p in problems(k))


def test_abstract_base_is_linted_not_installed():
    k = kit_copy()
    s = model.resolve(model.Kit(k))
    assert "briefing" not in s.modes
    (k / "modes/briefing/features/digest/playbook.md").write_text("# nothing\n")
    ps = problems(k)
    assert any("modes/briefing/features/digest/playbook.md" in p for p in ps)        # still linted
    assert not any("briefing.prune declares schedule" in w and "feed" not in w for w in lint.warnings(model.Kit(k)))


def test_a_second_briefing_mode_fails_validate_naming_the_modes_and_step_3():
    """Two modes extending briefing share briefing-analyst; each keeps its own store and a role's read reaches
    one, so every analyst read would fail at runtime (dispatch: "reads items.store/v1 for several modes").
    validate says so up front instead."""
    import subprocess
    k = kit_copy()
    d = k / "modes/news-briefing"
    d.mkdir()
    (d / "mode.yaml").write_text("apiVersion: agentbay/v2\nkind: Mode\nmetadata: { name: news-briefing, version: "
                                 "0.1.0, description: News. }\nspec:\n  extends: briefing\n  purpose: Brief me on "
                                 "the news.\n")
    g = assert_gap(k, "role briefing-analyst reads items.store/v1 for several modes (feed-briefing, news-briefing)")
    assert "step 3 of docs/proposals/0003-briefing-sources.md" in g and "own reader roles" in g
    assert_gap(k, "role briefing-lead reads items.store/v1 for several modes")
    r = subprocess.run([str(k / "bay.sh"), "validate"], capture_output=True, text=True)
    assert r.returncode != 0 and "several modes (feed-briefing, news-briefing)" in r.stdout + r.stderr


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
    edit_yaml(k / "modes/feed-briefing/mode.yaml", lambda d: d["spec"]["endpoints"].update(
        {"prune": {"schedule": "weekly"}}))
    own = line_of(k / "modes/feed-briefing/mode.yaml", "      schedule: weekly")
    ws = lint.warnings(model.Kit(k))
    assert any(f"modes/feed-briefing/mode.yaml:{own}: feed-briefing.prune declares" in w for w in ws), ws
    # an inherited workflow no endpoint uses any more is reported where the parent defines it
    k = kit_copy()
    edit_yaml(k / "modes/feed-briefing/mode.yaml", lambda d: (
        d["spec"]["endpoints"].update({"prune": {"workflow": "trim"}}),
        d["spec"]["workflows"].update({"trim": [{"id": "trim", "run": "items.store/v1.prune"}]})))
    kbase = k / "modes/briefing/mode.yaml"
    wf = line_of(kbase, "    prune:", after=line_of(kbase, "  workflows:"))
    ps = problems(k)
    assert any(f"modes/briefing/mode.yaml:{wf}: workflow 'prune' is not used" in p for p in ps), ps
