"""Part E of proposal 0006 (0008 slice 5): a feature's `uses:` and `skills:`, a child's whole-feature override and
`bay show <mode> --resolved`. The role-level grant with no open call is unchanged (decision (c)); the unchanged
security tests (test_boundaries, test_dispatch) cover that path."""
import json
import subprocess
import sys
from pathlib import Path

from helpers import KIT, clock, gaps, kit_copy, project, system

from bay import dispatch, lint, model

ANALYST = "analyst--feed-briefing"
REVIEWER = "reviewer--feed-briefing"


def D(p):
    return dispatch.Dispatcher(system(p), p, clock=clock)


def refused(fn, *needles):
    try:
        fn()
    except dispatch.CallError as e:
        for n in needles:
            assert n in str(e), str(e)
        return
    raise AssertionError("expected CallError")


def sub(k, rel, old, new):
    f = k / rel
    text = f.read_text()
    assert old in text, (rel, old)
    f.write_text(text.replace(old, new, 1))


def test_a_role_step_reaches_only_its_features_uses_while_its_call_is_open():
    p = project()
    d = D(p)
    assert d.call("feed-briefing.sync", {})["status"] == "done"
    d.use(ANALYST, "items.store/v1.status", {})                      # no open call: the role-level grant
    r = d.call("feed-briefing.digest", {"since": "3d"})
    assert r["status"] == "needs-agent" and r["next"]["role"] == "analyst"
    assert d.use(ANALYST, "items.store/v1.sql", {"sql": "SELECT count(*) FROM v_items"})["rows"] == [[7]]   # in uses
    refused(lambda: d.use(ANALYST, "items.store/v1.status", {}), "not granted items.store/v1.status by the feature",
            "items.store/v1.sql")                                                      # granted to the role, not to digest
    refused(lambda: d.use(ANALYST, "items.store/v1.facets", {}), "by the feature")
    d.use(REVIEWER, "items.store/v1.status", {})                     # another unit, no step of its own waiting
    ask = d.call("feed-briefing.ask", {"question": "what is new?"})
    assert ask["status"] == "needs-agent"                            # two open calls for one unit: their uses add up
    d.use(ANALYST, "items.store/v1.status", {})
    d.use(ANALYST, "items.store/v1.sql", {"sql": "SELECT 1"})


def test_the_step_plan_hands_a_role_only_its_features_skills_and_endpoints():
    p = project()
    d = D(p)
    dg = d.call("feed-briefing.digest", {"since": "3d"})["next"]
    ask = d.call("feed-briefing.ask", {"question": "what is new?"})["next"]
    assert {"digest", "corpus-sql"} <= set(dg["skills"]) and "grounded-qa" not in dg["skills"]
    assert {"grounded-qa", "corpus-sql"} <= set(ask["skills"]) and "digest" not in ask["skills"]
    assert not any(t.endswith("items.store/v1.status '<json>'") for t in dg["tools"])
    assert any(t.endswith("items.store/v1.status '<json>'") for t in ask["tools"])


def test_a_childs_feature_replaces_its_parents_whole_and_the_rest_is_inherited():
    parent = {"features": {
        "a": {"effects": ["read"], "uses": ["items.store/v1.sql"], "skills": ["s"], "playbook": "features/a/playbook.md",
              "review": {"role": "reviewer", "when": "always"}, "steps": [{"id": "x", "run": "items.store/v1.sync"}]},
        "b": {"effects": ["read"], "playbook": "features/b/playbook.md", "steps": [{"id": "y", "run": "items.store/v1.sync"}]}}}
    child = {"features": {"a": {"effects": ["write"], "steps": [{"id": "z", "run": "items.store/v1.prune"}]}}}
    out = model.merge_mode(parent, child, Path("/m/parent"), Path("/m/child"))
    assert out["features"]["a"] == child["features"]["a"]                  # no uses, skills, review or playbook left over
    assert out["features"]["b"]["playbook"] == "../parent/features/b/playbook.md"        # inherited, rebased


def test_show_resolved_names_the_file_each_feature_comes_from():
    out = subprocess.run([sys.executable, "-m", "bay.cli", "show", "mail-briefing", "--resolved"], cwd=KIT,
                         capture_output=True, text=True, check=True).stdout
    feats = json.loads(out)["features"]
    assert {n: f["origin"] for n, f in feats.items()} == {
        "sync": "modes/briefing/mode.yaml", "prune": "modes/briefing/mode.yaml",
        "digest": "modes/mail-briefing/mode.yaml", "ask": "modes/mail-briefing/mode.yaml"}
    assert feats["digest"]["uses"] == ["items.store/v1.describe", "items.store/v1.sql", "items.store/v1.get",
                                       "items.store/v1.thread"]
    bad = subprocess.run([sys.executable, "-m", "bay.cli", "show", "mail-briefing", "--resolved", "--reason", "x"],
                         cwd=KIT, capture_output=True, text=True)
    assert bad.returncode != 0 and "usage: bay show <mode> --resolved" in bad.stderr + bad.stdout


def test_check_refuses_a_uses_no_role_is_granted_a_missing_uses_and_an_unknown_skill():
    k = kit_copy()
    sub(k, "modes/briefing/mode.yaml", "uses: [items.store/v1.status, items.store/v1.sql]",
        "uses: [items.store/v1.status, items.store/v1.nope]")
    assert any("prune: `uses:` names items.store/v1.nope" in g for g in gaps(k, project()))
    k = kit_copy()
    sub(k, "modes/briefing/mode.yaml",
        "      uses: [items.store/v1.describe, items.store/v1.sql, items.store/v1.query, items.store/v1.get, "
        "items.store/v1.thread]   # B-9\n", "")
    assert any("feed-briefing.digest: its role steps can read the store" in g and "declare `uses:`" in g
               for g in gaps(k, project()))
    k = kit_copy()
    sub(k, "modes/briefing/mode.yaml", "skills: [digest, corpus-sql]   ", "skills: [digest, nope]   ")
    assert any("`skills:` names 'nope', which is not a skill of mode feed-briefing" in g for g in gaps(k, project()))


def test_lint_refuses_a_playbook_that_names_a_skill_its_feature_does_not_list():
    k = kit_copy()
    sub(k, "modes/briefing/mode.yaml", "skills: [digest, corpus-sql]   ", "skills: [digest]   ")
    assert any("names skill 'corpus-sql', which feed-briefing.digest does not list in its `skills:`"
               in e for e in lint.run(k))
