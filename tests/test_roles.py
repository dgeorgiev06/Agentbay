"""Roles: five framework roles, placed per mode in an env by the mode's `roles:` map; access comes from the
mode's `needs`; each (role, mode, env) compiles to its own subagent, use shim, guard entry and store; one agent
profile maps tiers to models."""
import json
import subprocess
import sys

import yaml

from helpers import KIT, clock, edit_yaml, kit_copy, model, project, system

from bay import dispatch
from bay.adapter import get

NEWS_ENV = """apiVersion: agentbay/v2
kind: Environment
metadata: { name: local-news, description: A second offline briefing env with its own data folder. }
spec:
  bind:
    items.source/v1: [fake]
    items.store/v1: corpus-store
  network: { allow: [] }
  fs: { read: ["."], write: [".agentbay/data/news"] }
  effects: [read, write, network, spend, delete]
"""


def news_kit(step_override: bool = False):
    """feed-briefing plus news-briefing (also extending briefing) whose roles work in env local-news."""
    k = kit_copy()
    (k / "envs/local-news.yaml").write_text(NEWS_ENV)
    d = k / "modes/news-briefing"
    d.mkdir()
    (d / "mode.yaml").write_text(yaml.safe_dump({
        "apiVersion": "agentbay/v2", "kind": "Mode", "metadata": {"name": "news-briefing", "version": "0.1.0"},
        "spec": {"extends": "briefing", "purpose": "Brief me on the news.",
                 "roles": {"lead": "local-news", "analyst": "local-news", "reviewer": "local-news"},
                 "configDefaults": {"selectors": [{"id": "lido", "from": "lido"}]}}}))
    return k


def call(d, target, inp=None):
    return d.call(target, inp or {})


def test_shipped_roles_are_five_generic_framework_roles_without_data_access():
    kit = model.Kit(KIT)
    assert set(kit.docs["Role"]) == {"lead", "analyst", "researcher", "builder", "reviewer"}
    assert all(d.root == "framework" and "uses" not in d.spec for d in kit.docs["Role"].values())
    assert not (KIT / "roles").exists() and not (KIT / "agents").exists()
    assert [d.name for d in kit.docs["Role"].values() if d.spec.get("access") == "write"] == ["builder"]


def test_access_comes_from_the_mode_needs_through_the_env():
    s = system(project())
    u = s.units()
    feed, imp = u["analyst--feed-briefing"], u["analyst--improve"]
    assert feed.bay_uses == [f"items.store/v1.{e}" for e in
                             ("describe", "sql", "get", "thread", "threads", "facets", "search", "query", "status")]
    assert {x.rsplit(".", 1)[0] for x in imp.bay_uses} == {"improve.findings/v1", "session.events/v1",
                                                            "review.verdicts/v1", "artifacts.read/v1"}
    assert "improve.findings/v1.upsert" not in imp.bay_uses and "improve.findings/v1.verify" not in imp.bay_uses
    assert not any(x.startswith("improve.detect/") for x in imp.bay_uses)           # dispatcherOnly
    assert feed.tools == ["Bash"] and "Edit" not in imp.tools                          # read-only roles
    assert "Edit" in u["builder--delivery"].tools and "Edit" not in u["reviewer--delivery"].tools
    assert "WebSearch" in u["researcher--delivery"].tools and "WebSearch" not in u["builder--delivery"].tools
    p = project()
    d = dispatch.Dispatcher(system(p), p, clock=clock)
    call(d, "feed-briefing.sync")
    assert d.use("analyst--feed-briefing", "items.store/v1.query", {})["items"]
    for unit, target in (("analyst--feed-briefing", "improve.findings/v1.query"),
                         ("analyst--feed-briefing", "session.events/v1.episodes"),
                         ("analyst--feed-briefing", "items.store/v1.sync"),
                         ("analyst--feed-briefing", "items.store/v1.prune"),
                         ("analyst--improve", "items.store/v1.query"),
                         ("analyst--improve", "improve.findings/v1.upsert"),
                         ("analyst--improve", "improve.detect/v1.artifacts")):
        try:
            d.use(unit, target, {})
            raise AssertionError(f"{unit} reached {target}")
        except dispatch.CallError as e:
            assert "not granted" in str(e), e
    assert "findings" in d.use("analyst--improve", "improve.findings/v1.query", {})


def test_one_reader_role_in_two_modes_and_envs_compiles_separately_with_separate_stores():
    k = news_kit()
    p = project()
    s = system(p, k)
    u = s.units()
    assert (u["analyst--feed-briefing"].env, u["analyst--news-briefing"].env) == ("local-feeds", "local-news")
    get("claude-code").build(s, p, k)
    for unit in ("analyst--feed-briefing", "analyst--news-briefing"):
        assert (p / f".claude/agents/{unit}.md").exists()
        shim = (p / f".agentbay/roles/{unit}/use").read_text()
        assert f"bay/use_shim.py' {unit} " in shim or f"use_shim.py {unit} " in shim, shim
    pol = json.loads((p / ".agentbay/guard.json").read_text())["subagents"]
    assert pol["analyst--news-briefing"]["mode"] == "news-briefing" and pol["analyst--news-briefing"]["env"] == "local-news"
    assert pol["analyst--feed-briefing"]["shim"] != pol["analyst--news-briefing"]["shim"]
    # each runs the other's shim only through Claude Code's normal deny (not its own shim, not a CLI prefix)
    from bay.guard import Guard
    g = Guard(json.loads((p / ".agentbay/guard.json").read_text()), p, ci=False)
    payload = {"agent_type": "analyst--feed-briefing", "agent_id": "a1", "tool_name": "Bash", "cwd": str(p),
               "tool_input": {"command": ".agentbay/roles/analyst--news-briefing/use items.store/v1.query '{}'"}}
    assert g.decide(payload)[0] == "deny"
    payload["tool_input"]["command"] = ".agentbay/roles/analyst--feed-briefing/use items.store/v1.query '{}'"
    assert g.decide(payload)[0] == "allow"
    # separate stores: each mode syncs into its env's data folder and each shim reads only its own
    d = dispatch.Dispatcher(s, p, clock=clock)
    assert call(d, "feed-briefing.sync")["status"] == "done" and call(d, "news-briefing.sync")["status"] == "done"
    assert (p / ".agentbay/data/feeds/feed-briefing/corpus.db").exists()
    assert (p / ".agentbay/data/news/news-briefing/corpus.db").exists()
    assert not (p / ".agentbay/data/news/feed-briefing").exists() and not (p / ".agentbay/data/feeds/news-briefing").exists()
    feed = {x["author"]["handle"] for x in d.use("analyst--feed-briefing", "items.store/v1.query", {})["items"]}
    news = {x["author"]["handle"] for x in d.use("analyst--news-briefing", "items.store/v1.query", {})["items"]}
    assert news == {"lido"} and len(feed) > 1
    news_sql = d.use("analyst--news-briefing", "items.store/v1.sql", {"sql": "SELECT count(*) AS n FROM v_items"})
    assert json.dumps(news_sql).count("lido") == 0 and news_sql["rows"][0][0] == 1, news_sql
    for unit, mode in (("analyst--feed-briefing", "feed-briefing"), ("analyst--news-briefing", "news-briefing")):
        r = subprocess.run([str(p / f".agentbay/roles/{unit}/use"), "items.store/v1.status", "{}"], cwd=p,
                           capture_output=True, text=True)
        assert r.returncode == 0, r.stderr
    reads = [json.loads(x) for x in (p / ".agentbay/ledger/events.jsonl").read_text().splitlines() if '"data.read"' in x]
    assert {(e["role"], e["mode"], e["env"]) for e in reads} >= {("analyst", "feed-briefing", "local-feeds"),
                                                                 ("analyst", "news-briefing", "local-news")}
    # a digest step plan runs the unit of its own mode
    plan = call(d, "news-briefing.digest")["next"]
    assert plan["runAs"] == "subagent_type=analyst--news-briefing" and plan["env"] == "local-news"
    assert all("/analyst--news-briefing/use " in t for t in plan["tools"])


def test_a_step_override_runs_one_role_in_two_envs_within_one_mode():
    k = kit_copy()
    (k / "envs/local-news.yaml").write_text(NEWS_ENV)
    edit_yaml(k / "modes/briefing/mode.yaml",
              lambda d: d["spec"]["features"]["digest"]["steps"][2].update({"roles": {"analyst": "local-news"}}))
    p = project()
    s = system(p, k)
    themes = next(st for st in s.modes["feed-briefing"].features["digest"].steps if st.id == "themes")
    answer = next(st for st in s.modes["feed-briefing"].features["ask"].steps if st.id == "answer")
    assert (themes.env, themes.subagent) == ("local-news", "analyst--feed-briefing--local-news")
    assert (answer.env, answer.subagent) == ("local-feeds", "analyst--feed-briefing--local-feeds")
    get("claude-code").build(s, p, k)
    pol = json.loads((p / ".agentbay/guard.json").read_text())["subagents"]
    assert pol["analyst--feed-briefing--local-news"]["env"] == "local-news"
    assert pol["analyst--feed-briefing--local-feeds"]["env"] == "local-feeds"
    assert (p / ".agentbay/roles/analyst--feed-briefing--local-news/use").exists()
    d = dispatch.Dispatcher(s, p, clock=clock)
    call(d, "feed-briefing.sync")
    # each unit reads the store of its own env: nothing was synced in local-news, so that unit finds an empty
    # store (and is told to sync), never the other env's items
    feed = d.use("analyst--feed-briefing--local-feeds", "items.store/v1.query", {})["items"]
    assert feed
    news = d.use("analyst--feed-briefing--local-news", "items.store/v1.query", {})
    assert news["items"] == [] and "run the mode's sync" in news["coverage"]["note"]
    assert not (p / ".agentbay/data/news/feed-briefing/corpus.db").exists()


def test_swapping_the_agent_profile_changes_only_the_model_names():
    k = kit_copy()
    other = yaml.safe_load((k / "adapters/claude-code/adapter.yaml").read_text())
    other["name"] = "other-llm"
    other["profile"]["tiers"] = {"fast": "tiny-1", "balanced": "mid-2", "deep": "big-3"}
    (k / "adapters/other-llm").mkdir()
    (k / "adapters/other-llm/adapter.yaml").write_text(yaml.safe_dump(other))
    outs = {}
    for agent in ("claude-code", "other-llm"):
        p = project({"agent": agent} if agent != "claude-code" else {})
        s = system(p, k)
        assert s.agent == agent
        get("claude-code").build(s, p, k)
        outs[agent] = {str(f.relative_to(p)): f.read_text().replace(str(p), "<project>") for f in sorted(p.rglob("*"))
                       if f.is_file() and f.name not in ("manifest.json", "catalog.json", "agentbay.config.yaml")}
    a, b = outs["claude-code"], outs["other-llm"]
    assert a.keys() == b.keys()
    swap = {"haiku": "tiny-1", "sonnet": "mid-2", "opus": "big-3"}
    changed = []
    for f in a:
        if a[f] == b[f]:
            continue
        changed.append(f)
        for la, lb in zip(a[f].splitlines(), b[f].splitlines()):
            if la != lb:
                for old, new in swap.items():
                    la = la.replace(old, new)
                assert la == lb, (f, la, lb)
    assert changed and all(f.startswith(".claude/agents/") or f == ".agentbay/COORDINATOR.md" for f in changed), changed
    assert "model: big-3" in b[".claude/agents/reviewer--delivery.md"]
    from helpers import gaps
    assert any("agent profile 'nope' not found" in g for g in gaps(k, project({"agent": "nope"})))


# ------------------------------------------------------------------ grants, envs and tier caps
NOTES_IFACE = """apiVersion: agentbay/v2
kind: Interface
metadata: { name: notes.edit, description: notes }
spec:
  version: 1
  binding: tools
  endpoints:
    open: { description: open notes, effects: [read] }
"""


def test_a_read_capability_never_gives_read_roles_write_tools_or_paths():
    """Review case t6: a read-effect tools capability bound to Edit/Write and arbitrary CLIs."""
    from bay import lint
    k = kit_copy()
    (k / "interfaces").mkdir(exist_ok=True)              # user interfaces/ may not exist in a clean checkout
    (k / "interfaces/notes.edit.v1.yaml").write_text(NOTES_IFACE)
    edit_yaml(k / "envs/local-feeds.yaml", lambda d: d["spec"]["bind"].update(
        {"notes.edit/v1": {"tools": ["Edit", "Write", "Bash"], "clis": ["rm", "git push"]}}))
    edit_yaml(k / "modes/briefing/mode.yaml", lambda d: d["spec"]["needs"].append("notes.edit/v1"))
    env = k / "envs/local-feeds.yaml"
    line = next(i for i, ln in enumerate(env.read_text().splitlines(), 1) if "notes.edit/v1:" in ln)
    ps = lint.run(k)
    assert any(p.endswith(f"envs/local-feeds.yaml:{line}: env local-feeds binds Edit, Write, rm, git push under "
                          f"notes.edit/v1, which has no `write` effect; file-writing tools and CLIs other than git "
                          f"status, git diff, git log, git show belong under a capability with the write effect "
                          f"(e.g. workspace.write/v1)") for p in ps), ps
    # even without lint (bay build does not lint), read-only roles get neither the tools nor write paths
    p = project(source="x-api")
    s = system(p, k)
    for unit in ("analyst--feed-briefing", "reviewer--feed-briefing"):
        u = s.units()[unit]
        assert u.access == "read" and not set(u.tools) & {"Edit", "Write"} and u.clis == [], (unit, u.tools, u.clis)
    get("claude-code").build(s, p, k)
    pol = json.loads((p / ".agentbay/guard.json").read_text())["subagents"]
    assert pol["analyst--feed-briefing"]["write"] == [] and pol["reviewer--feed-briefing"]["write"] == []
    assert pol["builder--delivery"]["write"] == ["."]                                # access: write keeps them
    fm = (p / ".claude/agents/analyst--feed-briefing.md").read_text().split("---")[1]
    assert "Edit" not in fm and "Write" not in fm


def test_user_modes_may_not_put_roles_in_framework_envs_other_than_workspace_and_research():
    """Review case t7: a user mode reading improve's findings and episodes through env improve-local."""
    from helpers import assert_gap
    k = kit_copy()
    d = k / "modes/spy"
    d.mkdir()
    (d / "mode.yaml").write_text(yaml.safe_dump({
        "apiVersion": "agentbay/v2", "kind": "Mode", "metadata": {"name": "spy", "version": "0.1.0"},
        "spec": {"purpose": "read improve findings", "coordinator": "lead",
                 "roles": {"lead": "improve-local", "analyst": "improve-local"},
                 "needs": ["improve.findings/v1", "session.events/v1"],
                 "features": {"look": {"effects": ["read"], "review": {"when": "never"},
                                       "steps": [{"id": "a", "role": "analyst", "task": "x"}]}}}}))
    assert_gap(k, "mode spy: role analyst works in the framework env improve-local (spy.look step a)",
               "user modes may put roles only in their own envs (envs/) or the framework envs workspace and research")
    assert_gap(k, "mode spy: role lead works in the framework env improve-local")
    # workspace and research stay open to user modes (delivery uses both); framework modes are unaffected
    assert system(None).modes["delivery"].roles == {"researcher": "research", "builder": "workspace",
                                                    "reviewer": "workspace"}
    assert system(None).units()["analyst--improve"].env == "improve-local"


def test_a_units_default_tier_is_checked_against_the_env_cap():
    """Review case t1: the reviewer's subagent compiled with opus (deep) in an env capped to fast, balanced."""
    from helpers import assert_gap
    k = kit_copy()
    edit_yaml(k / "envs/local-feeds.yaml", lambda d: d["spec"].update({"tiers": ["fast", "balanced"]}))
    edit_yaml(k / "modes/briefing/mode.yaml", lambda d: d["spec"]["features"]["digest"]["review"].update(
        {"tier": "balanced"}))
    assert_gap(k, "mode feed-briefing: role reviewer in env local-feeds: its default tier 'deep' (the model its "
                  "subagent is compiled with) is not allowed by env local-feeds (allows: fast, balanced)")


def test_lint_warns_when_a_partial_roles_override_splits_a_store_reading_mode():
    """Review case t10: a child moves lead and analyst to the offline env but inherits reviewer in local-feeds."""
    from bay import lint
    k = kit_copy()
    d = k / "modes/news-briefing"
    d.mkdir()
    (d / "mode.yaml").write_text(
        "apiVersion: agentbay/v2\nkind: Mode\nmetadata: { name: news-briefing, version: 0.1.0, description: news }\n"
        "spec:\n  extends: briefing\n  purpose: Brief me on news from my sources for testing.\n"
        "  roles: { lead: local-news, analyst: local-news }\n  reads: [post/v1]\n")
    (k / "envs/local-news.yaml").write_text(NEWS_ENV)
    from helpers import self_describe
    self_describe(d)
    ws = lint.warnings(model.Kit(k))
    assert any("modes/news-briefing/mode.yaml:7: mode news-briefing puts role reviewer in env local-feeds, whose "
               "items.store/items.source bindings differ from env local-news, where its code steps (sync, "
               "prune) run" in w for w in ws), ws
    assert not any("mode feed-briefing puts role" in w for w in lint.warnings(model.Kit(KIT)))   # shipped: no split
    assert lint.run(k) == []                                                                       # a warning only


def test_lint_reports_an_unknown_env_in_a_roles_map_with_file_and_line():
    from bay import lint
    k = kit_copy()
    base = k / "modes/briefing/mode.yaml"
    base.write_text(base.read_text().replace("reviewer: local-feeds }", "reviewer: nowhere }"))
    line = next(i for i, ln in enumerate(base.read_text().splitlines(), 1) if ln.startswith("  roles:"))
    ps = lint.run(k)
    assert any(p.endswith(f"modes/briefing/mode.yaml:{line}: mode briefing: `roles:` puts role reviewer in unknown "
                          f"env 'nowhere' (have: cos-local, framework-dev, improve-local, local-authoring, local-feeds, "
                          f"local-mail, research, workspace)") for p in ps), ps
