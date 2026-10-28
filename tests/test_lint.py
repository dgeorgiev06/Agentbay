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


PB = "modes/briefing/features/digest/playbook.md"
RULES = "modes/briefing/features/digest/rules.yaml"


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
    # an inherited endpoint is reported once, as the parent's, at the parent's mode.yaml line, normalized path
    has(k, "modes/briefing/mode.yaml:21: feature briefing.digest rules file "
           "modes/briefing/features/digest/rules.yaml does not exist")
    assert not [x for x in problems(k) if "feed-briefing.digest rules file" in x]
    has(k, "features/digest: feature folder is missing rules.yaml")
    k = kit_copy()
    edit_yaml(k / "modes/briefing/mode.yaml", lambda d: d["spec"]["endpoints"]["ask"].pop("playbook"))
    has(k, "feature briefing.ask has no `playbook`")
    assert len([x for x in problems(k) if "ask has no `playbook`" in x]) == 1


def test_review_settings_only_in_mode_yaml():
    k = kit_copy()
    sub(k, PB, "## Outputs\n", "review: { role: reviewer, when: never }\n\n## Outputs\n")
    has(k, PB, "review settings found in playbook")
    k = kit_copy()
    (k / RULES).write_text((k / RULES).read_text() + "review: { when: never }\n")
    has(k, RULES, "review settings found in rules file")
    k = kit_copy()
    edit_yaml(k / "framework/roles/analyst.yaml", lambda d: d["spec"].update({"review": {"when": "always"}}))
    has(k, "framework/roles/analyst.yaml")   # schema rejects it (additionalProperties) - reported at load


def test_review_role_must_exist_and_be_in_the_mode():
    k = kit_copy()
    edit_yaml(k / "modes/briefing/mode.yaml",
              lambda d: d["spec"]["endpoints"]["digest"]["review"].update({"role": "ghost"}))
    has(k, "briefing.digest review role 'ghost' does not exist")
    assert len([x for x in problems(k) if "review role 'ghost' does not exist" in x]) == 1
    k = kit_copy()
    edit_yaml(k / "modes/briefing/mode.yaml",
              lambda d: d["spec"]["endpoints"]["digest"]["review"].update({"role": "researcher"}))
    has(k, "briefing.digest review: role researcher is not in mode briefing `roles:`", "add `researcher: <env>`")


def line_of(path, needle):
    return next(i for i, ln in enumerate(path.read_text().splitlines(), 1) if needle in ln)


def test_role_env_errors_name_mode_feature_and_step():
    base = "modes/briefing/mode.yaml"
    # a step naming a role that is not in the mode
    k = kit_copy()
    sub(k, base, "{ id: answer, role: analyst,", "{ id: answer, role: researcher,")
    has(k, f"{base}:{line_of(k / base, '{ id: answer, role: researcher,')}: briefing.ask step answer: role "
           "researcher is not in mode briefing `roles:` (lead, analyst, reviewer); add `researcher: <env>` there")
    # reported once, for the abstract base that declares it, not again for each child (same file:line)
    assert len([x for x in problems(k) if "step answer: role researcher is not in mode" in x]) == 1
    # a role with no env
    k = kit_copy()
    sub(k, base, "analyst: local-feeds,", "analyst: ,")
    has(k, f"{base}:{line_of(k / base, 'role: analyst, out: Digest')}: briefing.digest step themes: role analyst "
           "has no env; give it one in mode briefing `roles:` (`analyst: <env>`)")
    # two envs for one step
    k = kit_copy()
    sub(k, base, "{ id: answer, role: analyst,", "{ id: answer, role: analyst, roles: { analyst: local-feeds, reviewer: workspace },")
    has(k, "briefing.ask step answer: two envs for one step (analyst: local-feeds, reviewer: workspace)",
        "keep only `analyst: <env>`")
    # a step override naming another role, `roles:` on a code step, a feature override of a role not in the mode
    k = kit_copy()
    sub(k, base, "{ id: answer, role: analyst,", "{ id: answer, role: analyst, roles: { reviewer: workspace },")
    sub(k, base, "{ id: prune, run: items.store/v1.prune,", "{ id: prune, roles: { lead: workspace }, run: items.store/v1.prune,")
    edit_yaml(k / "modes/briefing/mode.yaml", lambda d: d["spec"]["endpoints"]["ask"].update({"roles": {"builder": "workspace"}}))
    has(k, "briefing.ask step answer: `roles:` names reviewer, but this step runs role analyst")
    has(k, "briefing.prune step prune: `roles:` applies to role and review steps only")
    has(k, "briefing.ask: `roles:` gives role builder an env, but mode briefing does not list builder")
    # an unknown (or user-defined) role
    k = kit_copy()
    edit_yaml(k / base, lambda d: d["spec"]["roles"].update({"briefing-writer": "local-feeds"}))
    has(k, "mode briefing: `roles:` names unknown role 'briefing-writer' (framework roles: analyst, builder, lead, "
           "researcher, reviewer)", "roles are framework-level")
    # the same problems are resolve gaps (bay build does not lint)
    from helpers import assert_gap
    k = kit_copy()
    sub(k, base, "analyst: local-feeds,", "analyst: ,")
    assert_gap(k, "feed-briefing.digest step themes: role analyst has no env")


def test_a_user_space_role_or_agent_profile_is_an_error():
    k = kit_copy()
    (k / "roles").mkdir()
    (k / "roles/summarizer.yaml").write_text((k / "framework/roles/analyst.yaml").read_text().replace("analyst", "summarizer"))
    has(k, "roles/summarizer.yaml: roles are framework-level; customize behaviour in your mode's playbooks/skills, or "
           "propose a new role via forge.extend")
    k = kit_copy()
    (k / "agents").mkdir()
    (k / "agents/other.yaml").write_text((k / "framework/agents/claude-code.yaml").read_text().replace("name: claude-code", "name: other"))
    has(k, "agents/other.yaml: agent profiles are framework-level")


def test_forge_extend_review_cannot_be_disabled_or_weakened():
    for change in ({"when": "never"}, {"tier": "balanced"}, {"effort": "medium"}, None):
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
    sub(k, "framework/modes/forge/features/create/rules.yaml", "when: { kind: env }", "when: { kind: plugin }")
    has(k, "rule R-8 when.kind 'plugin' is not one of")
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
    (k / "envs/workspace.yaml").write_text((k / "framework/envs/workspace.yaml").read_text())
    has(k, "Environment 'workspace' is defined by both the framework")


def test_modes_must_not_name_connectors_or_tools():
    k = kit_copy()
    sub(k, "modes/briefing/mode.yaml", "needs: [items.store/v1, items.source/v1]",
        "needs: [items.store/v1, items.source/v1]   # ok comment mentions x-api\n  # x-api in comment is fine")
    assert problems(k) == []
    k = kit_copy()
    sub(k, "modes/briefing/mode.yaml", "with: { olderThan:", "with: { source: x-api, olderThan:")
    has(k, "mode names connector 'x-api'")


def test_orphan_workflow_and_feature_folder():
    k = kit_copy()
    edit_yaml(k / "modes/feed-briefing/mode.yaml",
              lambda d: d["spec"].setdefault("workflows", {}).update({"unused": [{"id": "x", "run": "items.store/v1.query"}]}))
    has(k, "workflow 'unused' is not used by any endpoint")
    k = kit_copy()
    (k / "modes/briefing/features/stray").mkdir()
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


def test_feed_source_connectors_must_declare_source_and_window():
    k = kit_copy()
    edit_yaml(k / "connectors/x-api/connector.yaml", lambda d: d["spec"].pop("source"))
    has(k, "connectors/x-api/connector.yaml:", "connector x-api implements items.source/v1 but declares no spec.source")
    k = kit_copy()
    edit_yaml(k / "connectors/fake/connector.yaml", lambda d: d["spec"].pop("window"))
    has(k, "connector fake implements items.source/v1 but declares no spec.window")


def test_schedule_is_a_warning_not_an_error():
    from bay import model
    kit = model.Kit(KIT)
    ws = lint.warnings(kit)
    assert any("feed-briefing.prune declares schedule 'daily' but no runtime acts on it" in w and "cron" in w for w in ws)
    assert problems(KIT) == []


def test_run_steps_use_versioned_capability_spelling():
    k = kit_copy()
    sub(k, "modes/briefing/mode.yaml", "run: items.store/v1.prune", "run: feed.store.prune")
    has(k, "modes/briefing/mode.yaml", "does not match")
