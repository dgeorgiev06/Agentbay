"""bay lint: one test per failure mode, plus the shipped kit is clean."""
from helpers import KIT, edit_yaml, kit_copy, project

from bay import lint


def problems(k, p=None):
    return lint.run(k, p)


def has(k, *needles, p=None):
    ps = problems(k, p)
    for x in ps:
        if all(n in x for n in needles):
            return x
    raise AssertionError(f"no lint problem with {needles}; got:\n  " + "\n  ".join(ps))


PB = "modes/feed-briefing/features/digest/playbook.md"
RULES = "modes/feed-briefing/features/digest/rules.yaml"


def sub(k, rel, old, new):
    f = k / rel
    t = f.read_text()
    assert old in t, (rel, old)
    f.write_text(t.replace(old, new, 1))


def test_shipped_kit_is_lint_clean():
    assert problems(KIT) == []


def test_missing_section():
    k = kit_copy()
    sub(k, PB, "## Outputs\n", "## Results\n")
    has(k, PB, "missing required section '## Outputs'")


def test_sections_out_of_order():
    k = kit_copy()
    f = k / PB
    t = f.read_text()
    purpose = t[t.index("## Purpose"):t.index("## Inputs")]
    f.write_text(t.replace(purpose, "") + "\n" + purpose)
    x = has(k, PB, "sections out of order")
    assert ":" in x.split(" ")[0]          # file:line


def test_steps_must_be_numbered():
    k = kit_copy()
    sub(k, PB, "2. `gather`", "- `gather`")
    has(k, PB, "Steps item is not numbered")
    k = kit_copy()
    sub(k, PB, "3. `themes`", "5. `themes`")
    has(k, PB, "Steps numbering: expected 3, found 5")


def test_dod_item_format_and_unique_ids():
    k = kit_copy()
    sub(k, PB, "- [DOD-5] (should)", "- Themes are ordered (should)")
    has(k, f"{PB}:", "Definition of Done item must look like")
    k = kit_copy()
    sub(k, PB, "- [DOD-5] (should)", "- [DOD-5] (maybe)")
    has(k, "Definition of Done item must look like")
    k = kit_copy()
    sub(k, PB, "[DOD-5]", "[DOD-4]")
    has(k, PB, "duplicate DoD id DOD-4")


def test_rules_schema_and_unique_ids_and_refs():
    k = kit_copy()
    sub(k, RULES, "level: should", "level: nice-to-have")
    has(k, RULES, "rules schema")
    k = kit_copy()
    sub(k, RULES, "id: R-5", "id: R-4")
    has(k, RULES, "duplicate rule id R-4 (first on line")
    k = kit_copy()
    sub(k, RULES, "refs: [DOD-4]", "refs: [DOD-99]")
    has(k, f"{RULES}:7", "refs DOD-99, which is not a Definition of Done id")
    k = kit_copy()
    sub(k, RULES, "check: citations_resolve", "check: vibes_ok")
    has(k, RULES, "unknown check 'vibes_ok'")


def test_every_feature_has_both_files():
    k = kit_copy()
    (k / RULES).unlink()
    has(k, "feature feed-briefing.digest rules file features/digest/rules.yaml does not exist")
    has(k, "features/digest: feature folder is missing rules.yaml")
    k = kit_copy()
    edit_yaml(k / "modes/feed-briefing/mode.yaml", lambda d: d["spec"]["endpoints"]["ask"].pop("playbook"))
    has(k, "feature feed-briefing.ask has no `playbook`")


def test_review_settings_only_in_mode_yaml():
    k = kit_copy()
    sub(k, PB, "## Outputs\n", "review: { role: reviewer, when: never }\n\n## Outputs\n")
    has(k, PB, "review settings found in playbook")
    k = kit_copy()
    (k / RULES).write_text((k / RULES).read_text() + "review: { when: never }\n")
    has(k, RULES, "review settings found in rules file")
    k = kit_copy()
    edit_yaml(k / "roles/feed-analyst.yaml", lambda d: d["spec"].update({"review": {"when": "always"}}))
    has(k, "roles/feed-analyst.yaml")   # schema rejects it (additionalProperties) - reported at load


def test_review_role_must_exist_be_listed_and_placeable():
    k = kit_copy()
    edit_yaml(k / "modes/feed-briefing/mode.yaml",
              lambda d: d["spec"]["endpoints"]["digest"]["review"].update({"role": "ghost"}))
    has(k, "feed-briefing.digest review role 'ghost' does not exist")
    k = kit_copy()
    edit_yaml(k / "modes/feed-briefing/mode.yaml",
              lambda d: d["spec"]["endpoints"]["digest"]["review"].update({"role": "researcher"}))
    has(k, "review role 'researcher' is not listed in mode feed-briefing roles")
    k = kit_copy()
    edit_yaml(k / "framework/envs/workspace.yaml", lambda d: d["spec"].update({"models": ["haiku", "sonnet"]}))
    has(k, "feed-briefing.digest review role reviewer cannot be placed", "review model 'opus' is not allowed")


def test_forge_extend_review_cannot_be_disabled_or_weakened():
    for change in ({"when": "never"}, {"model": "sonnet"}, None):
        k = kit_copy()

        def f(d, change=change):
            ep = d["spec"]["endpoints"]["extend"]
            if change is None:
                ep.pop("review")
            else:
                ep["review"].update(change)
        edit_yaml(k / "framework/modes/forge/mode.yaml", f)
        has(k, "framework/modes/forge/mode.yaml", "forge.extend must declare review", "cannot be disabled")


def test_kind_scoped_rules_are_linted():
    k = kit_copy()
    sub(k, "framework/modes/forge/features/create/rules.yaml", "when: { kind: role }", "when: { kind: plugin }")
    has(k, "rule R-6 when.kind 'plugin' is not one of")
    k = kit_copy()
    (k / RULES).write_text((k / RULES).read_text().rstrip() + "\n  - { id: R-9, level: must, statement: \"x y z\", "
                           "appliesTo: both, when: { kind: mode } }\n")
    has(k, "rule R-9 uses when.kind but the feature's input type has no `kind` enum")


def test_name_collision_between_user_and_framework():
    k = kit_copy()
    (k / "modes/forge").mkdir()
    (k / "modes/forge/mode.yaml").write_text((k / "modes/delivery/mode.yaml").read_text().replace("name: delivery", "name: forge"))
    has(k, "Mode 'forge' is defined by both the framework", "modes/forge/mode.yaml", "rename yours")
    k = kit_copy()
    (k / "roles/reviewer.yaml").write_text((k / "framework/roles/reviewer.yaml").read_text())
    has(k, "Role 'reviewer' is defined by both the framework")


def test_modes_must_not_name_connectors_or_tools():
    k = kit_copy()
    sub(k, "modes/feed-briefing/mode.yaml", "needs: [feed.store/v1, feed.source/v1]",
        "needs: [feed.store/v1, feed.source/v1]   # ok comment mentions x-api\n  # x-api in comment is fine")
    assert problems(k) == []
    k = kit_copy()
    sub(k, "modes/feed-briefing/mode.yaml", "with: { olderThan:", "with: { source: x-api, olderThan:")
    has(k, "mode names connector 'x-api'")


def test_orphan_workflow_and_feature_folder():
    k = kit_copy()
    edit_yaml(k / "modes/feed-briefing/mode.yaml",
              lambda d: d["spec"]["workflows"].update({"unused": [{"id": "x", "run": "feed.store.query"}]}))
    has(k, "workflow 'unused' is not used by any endpoint")
    k = kit_copy()
    (k / "modes/feed-briefing/features/stray").mkdir()
    has(k, "features/stray: feature folder is not referenced by any endpoint")


def test_validate_cli_runs_lint():
    import subprocess
    import sys
    k = kit_copy()
    sub(k, PB, "## Outputs\n", "## Results\n")
    r = subprocess.run([sys.executable, str(k / "bay/cli.py"), "validate"], capture_output=True, text=True)
    assert r.returncode == 1 and "missing required section '## Outputs'" in r.stdout
    r = subprocess.run([sys.executable, str(KIT / "bay/cli.py"), "validate"], capture_output=True, text=True)
    assert r.returncode == 0 and "✓ lint clean" in r.stdout and "resolve" in r.stdout


def test_extra_rules_stack_strictest_wins():
    from helpers import system
    p = project()
    (p / "extra.yaml").write_text(
        "rules:\n"
        "  - { id: R-5, level: must, statement: 'Summaries under 40 words.', appliesTo: both }\n"
        "  - { id: R-10, level: must_not, statement: 'Mention prices.', appliesTo: both }\n")
    import yaml
    cfg = yaml.safe_load((p / "agentbay.config.yaml").read_text())
    cfg["modes"] = {"feed-briefing": {"features": {"digest": {"extraRules": "extra.yaml"}}}}
    (p / "agentbay.config.yaml").write_text(yaml.safe_dump(cfg))
    s = system(p)
    rules = {r.id: r for r in s.modes["feed-briefing"].features["digest"].rules}
    assert rules["R-5"].level == "must" and "AND" in rules["R-5"].statement and rules["R-5"].applies_to == "both"
    assert rules["R-10"].level == "must_not"
    assert "R-10" not in {r.id for r in s.modes["feed-briefing"].features["ask"].rules}
    cfg["modes"]["feed-briefing"]["features"]["digest"]["extraRules"] = "missing.yaml"
    (p / "agentbay.config.yaml").write_text(yaml.safe_dump(cfg))
    from helpers import gaps
    assert any("extraRules" in g and "not found" in g for g in gaps(KIT, p))
