"""0.4 roles: five framework roles, placed per mode in an env by the mode's `roles:` map; access comes from the
mode's `needs`; each (role, mode, env) compiles to its own subagent, use shim, guard entry and store; one agent
profile maps tiers to models."""
import json
import subprocess
import sys

import yaml

from helpers import KIT, clock, edit_yaml, kit_copy, model, project, system

from bay import dispatch
from bay.adapters import get

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
                             ("describe", "sql", "get", "thread", "facets", "search", "query", "status")]
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
    assert (u["analyst--feed-briefing"].env, u["analyst--news-briefing"].env) == ("local-feeds-offline", "local-news")
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
    assert {(e["role"], e["mode"], e["env"]) for e in reads} >= {("analyst", "feed-briefing", "local-feeds-offline"),
                                                                 ("analyst", "news-briefing", "local-news")}
    # a digest step plan runs the unit of its own mode
    plan = call(d, "news-briefing.digest")["next"]
    assert plan["runAs"] == "subagent_type=analyst--news-briefing" and plan["env"] == "local-news"
    assert all("/analyst--news-briefing/use " in t for t in plan["tools"])


def test_a_step_override_runs_one_role_in_two_envs_within_one_mode():
    k = kit_copy()
    (k / "envs/local-news.yaml").write_text(NEWS_ENV)
    edit_yaml(k / "modes/briefing/mode.yaml",
              lambda d: d["spec"]["workflows"]["digest"][2].update({"roles": {"analyst": "local-news"}}))
    p = project()
    s = system(p, k)
    themes = next(st for st in s.modes["feed-briefing"].features["digest"].steps if st.id == "themes")
    answer = next(st for st in s.modes["feed-briefing"].features["ask"].steps if st.id == "answer")
    assert (themes.env, themes.subagent) == ("local-news", "analyst--feed-briefing--local-news")
    assert (answer.env, answer.subagent) == ("local-feeds-offline", "analyst--feed-briefing--local-feeds-offline")
    get("claude-code").build(s, p, k)
    pol = json.loads((p / ".agentbay/guard.json").read_text())["subagents"]
    assert pol["analyst--feed-briefing--local-news"]["env"] == "local-news"
    assert pol["analyst--feed-briefing--local-feeds-offline"]["env"] == "local-feeds-offline"
    assert (p / ".agentbay/roles/analyst--feed-briefing--local-news/use").exists()
    d = dispatch.Dispatcher(s, p, clock=clock)
    call(d, "feed-briefing.sync")
    # each unit reads the store of its own env: nothing was synced in local-news, so that unit finds an empty
    # store (and is told to sync), never the other env's items
    feed = d.use("analyst--feed-briefing--local-feeds-offline", "items.store/v1.query", {})["items"]
    assert feed
    news = d.use("analyst--feed-briefing--local-news", "items.store/v1.query", {})
    assert news["items"] == [] and "run the mode's sync" in news["coverage"]["note"]
    assert not (p / ".agentbay/data/news/feed-briefing/corpus.db").exists()


def test_swapping_the_agent_profile_changes_only_the_model_names():
    k = kit_copy()
    other = (k / "framework/agents/claude-code.yaml").read_text().replace("name: claude-code", "name: other-llm") \
        .replace("{ fast: haiku, balanced: sonnet, deep: opus }", "{ fast: tiny-1, balanced: mid-2, deep: big-3 }")
    (k / "framework/agents/other-llm.yaml").write_text(other)
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
