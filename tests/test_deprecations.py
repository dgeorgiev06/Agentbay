"""v0.2 names stay working for one release: user modes, roles, envs and connectors written against
feed.source/v1, feed.store/v1, feed.post/v1/feed.coverage/v1, feed-analyst/feed-lead and local-store resolve
to the v0.3 names with a lint warning; `bay migrate` rewrites them; old connector code is flagged for a
hand port."""
import json
import shutil
import subprocess
import sys

from helpers import clock, kit_copy, model, project

from bay import dispatch, lint, migrate

V02_MODE = """apiVersion: agentbay/v2
kind: Mode
metadata: { name: my-feed, version: 0.1.0 }
spec:
  purpose: My v0.2 feed mode.
  endpoints:
    sync:  { workflow: sync, in: SyncReq, effects: [network, spend, write], playbook: features/sync/playbook.md,
             rules: features/sync/rules.yaml, review: { role: reviewer, when: never } }
    ask:   { workflow: ask, in: Question, out: Answer, effects: [read, network, spend, write],
             playbook: features/ask/playbook.md, rules: features/ask/rules.yaml, review: { role: reviewer, when: never } }
  coordinator: feed-lead
  roles: { feed-lead: my-env, feed-analyst: my-env, reviewer: my-env }
  workflows:
    sync:
      - { id: fetch, run: feed.store/v1.sync, with: { lookback: "$in.lookback|$config.lookback", maxPosts: "$in.maxPosts" } }
    ask:
      - { id: refresh, run: feed.store/v1.sync, when: "stale > 2h" }
      - { id: context, run: feed.store/v1.status, with: { since: "$in.since|$config.lookback" } }
      - { id: answer, role: feed-analyst, out: Answer, task: "Answer from stored posts." }
  constraints: { lookbackMax: 30d, spendUsd: 5 }
  needs: [feed.store/v1, feed.source/v1]
  config: config.schema.json
"""
V02_ENV = """apiVersion: agentbay/v2
kind: Environment
metadata: { name: my-env, description: My v0.2 env. }
spec:
  bind:
    feed.source/v1: [fake]
    feed.store/v1: local-store      # the v0.2 JSONL store
  network: { allow: [] }
  fs: { read: ["."], write: [".agentbay/data/feeds"] }
  effects: [read, write, network, spend, delete]
"""
OLD_CONNECTOR_PY = '''def create(ctx):
    return Old()


class Old:
    def fetch(self, sinceId=None, startTime=None, maxPosts=100, checkIds=None):
        return {"posts": [], "newestId": None, "truncated": False, "billed": 0}
'''


def v02_kit():
    k = kit_copy()
    d = k / "modes/my-feed"
    for sub in ("features/sync", "features/ask", "types"):
        (d / sub).mkdir(parents=True)
    base = k / "modes/briefing"
    for f in ("features/sync/playbook.md", "features/sync/rules.yaml", "features/ask/playbook.md",
              "features/ask/rules.yaml", "types/Question.schema.json"):
        shutil.copy(base / f, d / f)
    cfg = json.loads((k / "modes/briefing/config.schema.json").read_text())
    cfg["properties"].pop("selectors")                                   # v0.2 had no selectors
    (d / "config.schema.json").write_text(json.dumps(cfg))
    shutil.copy(k / "modes/feed-briefing/types/SyncReq.schema.json", d / "types/SyncReq.schema.json")
    answer = (base / "types/Answer.schema.json").read_text().replace("items.coverage/v1", "feed.coverage/v1")
    (d / "types/Answer.schema.json").write_text(answer)
    (d / "mode.yaml").write_text(V02_MODE)
    (k / "envs/my-env.yaml").write_text(V02_ENV)
    return k


def test_v02_user_content_resolves_with_deprecation_warnings():
    k = v02_kit()
    kit = model.Kit(k)
    assert lint.run(kit=kit) == []
    ws = [w for w in lint.warnings(kit) if "deprecated" in w]
    for needle in ("modes/my-feed/mode.yaml: `feed.store/v1.sync` is deprecated (v0.2) and now resolves to "
                   "`items.store/v1.sync`; run `bay migrate`",
                   "modes/my-feed/mode.yaml: `feed-lead` is deprecated", "modes/my-feed/mode.yaml: `feed-analyst`",
                   "modes/my-feed/mode.yaml: `with: { maxPosts }`",
                   "envs/my-env.yaml: `local-store` is deprecated (v0.2) and now resolves to `corpus-store`",
                   "envs/my-env.yaml: `feed.source/v1`"):
        assert any(needle in w for w in ws), (needle, ws)
    s = model.resolve(kit)
    m = s.modes["my-feed"]
    assert m.coordinator == "lead" and "analyst" in m.roles and m.needs == ["items.store/v1", "items.source/v1"]
    assert m.features["sync"].steps[0].with_ == {"lookback": "$in.lookback|$config.lookback", "maxItems": "$in.maxPosts"}
    assert m.config["selectors"] == [{"id": "home"}]                 # no selectors setting: v0.2 behaviour
    assert "items.store/v1.query" in s.units()["analyst--my-feed"].bay_uses
    assert kit.get("Environment", "my-env").spec["bind"]["items.store/v1"] == "corpus-store"
    # it runs: sync offline into its own store, and its reader reads it through the aliased grant
    p = project()
    sysk = model.resolve(model.Kit(k, p))
    d = dispatch.Dispatcher(sysk, p, clock=clock)
    r = d.call("my-feed.sync", {"maxPosts": 3})
    assert r["status"] == "partial" and r["output"]["fetched"] == 3 and "maxItems 3" in r["output"]["stopped"]
    assert (p / ".agentbay/data/feeds/my-feed/corpus.db").exists()
    assert len(d.use("analyst--my-feed", "items.store/v1.query", {})["items"]) == 3


def test_bay_migrate_rewrites_v02_user_content_cleanly():
    k = v02_kit()
    before = (k / "modes/my-feed/mode.yaml").read_text()
    plan = migrate.plan(k)
    paths = {c["path"] for c in plan["changes"]}
    assert {"modes/my-feed/mode.yaml", "modes/my-feed/types/Answer.schema.json", "envs/my-env.yaml"} <= paths
    assert "+    items.store/v1: corpus-store      # the v0.2 JSONL store" in plan["diff"]
    assert (k / "modes/my-feed/mode.yaml").read_text() == before                   # dry run
    r = subprocess.run([sys.executable, str(k / "bay/cli.py"), "migrate"], capture_output=True, text=True)
    assert r.returncode == 0 and "dry run: nothing written" in r.stdout
    migrate.apply(k)
    mode = (k / "modes/my-feed/mode.yaml").read_text()
    assert "feed." not in mode and "feed-lead" not in mode and "maxPosts:" not in mode
    assert "coordinator: lead" in mode and "feed-analyst: my-env" not in mode and "analyst: my-env" in mode
    assert 'maxItems: "$in.maxPosts"' in mode
    assert "items.coverage/v1" in (k / "modes/my-feed/types/Answer.schema.json").read_text()
    kit = model.Kit(k)
    assert [w for w in lint.warnings(kit) if "deprecated" in w] == [] and lint.run(kit=kit) == []
    model.resolve(kit)
    assert migrate.plan(k)["changes"] == []


def test_connector_on_the_old_fetch_signature_needs_a_hand_port():
    k = v02_kit()
    c = k / "connectors/bsky"
    c.mkdir()
    (c / "bsky.py").write_text(OLD_CONNECTOR_PY)
    (c / "connector.yaml").write_text("apiVersion: agentbay/v2\nkind: Connector\nmetadata: { name: bsky, description: "
                                      "Bluesky. }\nspec: { implements: feed.source/v1, entry: bsky.py, source: bsky, "
                                      "window: 7d }\n")
    # unbound: a warning, and the rest of the kit still validates and builds
    kit = model.Kit(k)
    assert lint.run(kit=kit) == []
    msg = next(w for w in lint.warnings(kit) if "connectors/bsky/connector.yaml" in w and "hand port" in w)
    assert "fetch(sinceId, startTime, maxPosts, checkIds) is the v0.2 signature" in msg and "No env binds it" in msg
    assert "fetch(query, since, cursor, maxItems, checkIds)" in msg and "connectors/fake/fake.py" in msg
    model.resolve(kit)
    r = subprocess.run([str(k / "bay.sh"), "validate"], capture_output=True, text=True)
    assert r.returncode == 0 and "! connectors/bsky/connector.yaml" in r.stdout, r.stdout + r.stderr
    proj = project()
    r = subprocess.run([str(k / "bay.sh"), "build", "--project", str(proj)], capture_output=True, text=True)
    assert r.returncode == 0, r.stdout + r.stderr
    # bound: an error naming the env, since a sync would run the old code
    env = (k / "envs/my-env.yaml").read_text()
    (k / "envs/my-env.yaml").write_text(env.replace("feed.source/v1: [fake]", "feed.source/v1: [fake, bsky]"))
    ps = lint.run(k)
    msg = next(p for p in ps if "connectors/bsky/connector.yaml" in p and "hand port" in p)
    assert "It is bound in env my-env." in msg
    r = subprocess.run([str(k / "bay.sh"), "validate"], capture_output=True, text=True)
    assert r.returncode == 1 and "bound in env my-env" in r.stdout
    plan = migrate.plan(k)
    assert any("connectors/bsky/connector.yaml: connector implements a v0.2 feed interface" in n for n in plan["notes"])
    assert any(c["path"] == "connectors/bsky/connector.yaml" for c in plan["changes"])
    assert not any(c["path"].endswith(".py") for c in plan["changes"])               # code is never rewritten


def test_migrate_renames_max_posts_in_a_block_form_with():
    from bay import aliases
    k = v02_kit()
    block = V02_MODE.replace(
        '      - { id: fetch, run: feed.store/v1.sync, with: { lookback: "$in.lookback|$config.lookback", '
        'maxPosts: "$in.maxPosts" } }\n',
        '      - id: fetch\n'
        '        with:                        # block form, keys before and after run\n'
        '          lookback: "$in.lookback|$config.lookback"\n'
        '          maxPosts: "$in.maxPosts"\n'
        '        run: feed.store/v1.sync\n'
        '      - id: other\n'
        '        run: feed.store/v1.status\n'
        '        with:\n'
        '          maxPosts: 1                # not a sync step: left alone\n')
    assert block != V02_MODE
    (k / "modes/my-feed/mode.yaml").write_text(block)
    new = aliases.rewrite_text(block, set(), set())
    assert '          maxItems: "$in.maxPosts"\n        run: items.store/v1.sync' in new
    assert "          maxPosts: 1" in new and new.count("maxPosts:") == 1
    migrate.apply(k)
    mode = (k / "modes/my-feed/mode.yaml").read_text()
    assert '          maxItems: "$in.maxPosts"' in mode and "# block form, keys before and after run" in mode


def test_03_cap_names_keep_working_with_warnings_and_migrate_renames_them():
    """maxPostsPerRun / monthlyPosts (0.3) are the deprecated names of maxItemsPerRun / monthlyItems (0.4) in
    mode constraints, env limits, mode config schemas and agentbay.config.yaml."""
    from helpers import edit_yaml
    k = kit_copy()
    edit_yaml(k / "envs/local-feeds-offline.yaml", lambda d: d["spec"]["limits"].update(
        {"monthlyPosts": d["spec"]["limits"].pop("monthlyItems")}))
    edit_yaml(k / "modes/feed-briefing/mode.yaml", lambda d: d["spec"]["constraints"].update(
        {"maxPostsPerRun": d["spec"]["constraints"].pop("maxItemsPerRun")}))
    p = project({"modes": {"feed-briefing": {"maxPostsPerRun": 2}}})
    kit = model.Kit(k, p)
    ws = [w for w in lint.warnings(kit) if "deprecated" in w]
    for needle in ("envs/local-feeds-offline.yaml limits: `monthlyPosts` -> `monthlyItems`",
                   "modes/feed-briefing/mode.yaml constraints: `maxPostsPerRun` -> `maxItemsPerRun`",
                   "agentbay.config.yaml modes.feed-briefing: `maxPostsPerRun` -> `maxItemsPerRun`"):
        assert any(needle in w and "bay migrate" in w for w in ws), (needle, ws)
    assert lint.run(kit=kit) == []
    r = dispatch.Dispatcher(model.resolve(kit), p, clock=clock).call("feed-briefing.sync", {})
    assert r["output"]["fetched"] == 2 and "maxItemsPerRun" in r["stopped"]       # config (2) < mode (500)
    before = (p / "agentbay.config.yaml").read_text()
    plan = migrate.plan(k, project=p)
    paths = {c["path"] for c in plan["changes"]}
    assert {"envs/local-feeds-offline.yaml", "modes/feed-briefing/mode.yaml",
            str((p / "agentbay.config.yaml").resolve())} <= paths, paths
    assert (p / "agentbay.config.yaml").read_text() == before                    # dry run
    migrate.apply(k, project=p)
    assert "maxItemsPerRun: 2" in (p / "agentbay.config.yaml").read_text()
    kit = model.Kit(k, p)
    assert not [w for w in lint.warnings(kit) if "deprecated" in w]
    assert migrate.plan(k, project=p)["changes"] == []


# ------------------------------------------------------------------ 0.3 roles/agents/envs shape (0.4 aliases)
V03_MODE = """apiVersion: agentbay/v2
kind: Mode
metadata: { name: my-brief, version: 0.1.0 }
spec:
  purpose: My 0.3 briefing mode.
  endpoints:
    sync:  { workflow: sync, in: SyncReq, effects: [network, spend, write], playbook: features/sync/playbook.md,
             rules: features/sync/rules.yaml, review: { role: reviewer, when: never } }
    ask:   { workflow: ask, in: Question, out: Answer, effects: [read, network, spend, write],
             playbook: features/ask/playbook.md, rules: features/ask/rules.yaml,
             agents: { briefing-analyst: my-agent },
             review: { role: reviewer, when: always, model: sonnet } }
  coordinator: briefing-lead
  roles: [briefing-lead, briefing-analyst, reviewer]
  workflows:
    sync:
      - { id: fetch, run: items.store/v1.sync, with: { lookback: "$in.lookback|$config.lookback" } }
    ask:
      - { id: context, run: items.store/v1.status, with: { since: "$in.since|$config.lookback" } }
      - { id: answer, role: briefing-analyst, out: Answer, task: "Answer from stored items." }
  inference:
    default: { model: sonnet, effort: medium }
    steps: { answer: { effort: high } }
  constraints: { lookbackMax: 30d, spendUsd: 5, maxPostsPerRun: 50 }
  needs: [items.store/v1, items.source/v1]
  config: config.schema.json
"""
V03_AGENT = """apiVersion: agentbay/v2
kind: Agent
metadata: { name: my-agent, description: Subagent for the analyst in my env. }
spec: { runtime: claude-code-subagent, model: haiku, effort: medium, env: my-env }
"""
V03_ENV = """apiVersion: agentbay/v2
kind: Environment
metadata: { name: my-env, description: My 0.3 env. }
spec:
  bind:
    items.source/v1: [fake]
    items.store/v1: corpus-store
  network: { allow: [] }
  fs: { read: ["."], write: [".agentbay/data/mine"] }
  models: [haiku, sonnet]      # my cap
  effects: [read, write, network, spend, delete]
"""
V03_ROLE = """apiVersion: agentbay/v2
kind: Role
metadata: { name: my-summarizer, description: Summarizes stored items in three bullets. }
spec:
  agent: my-agent
  uses: [items.store/v1.query]
  prompt: Summarize the stored items in exactly three bullets, each citing an item id.
  doneWhen: [three bullets, each with a citation]
  rules: [never more than three bullets]
"""


def v03_kit(user_role: bool = False):
    k = kit_copy()
    d = k / "modes/my-brief"
    for sub in ("features/sync", "features/ask", "types"):
        (d / sub).mkdir(parents=True)
    base = k / "modes/briefing"
    for f in ("features/sync/playbook.md", "features/sync/rules.yaml", "features/ask/playbook.md",
              "features/ask/rules.yaml", "types/Question.schema.json", "types/Answer.schema.json",
              "types/SyncReq.schema.json", "config.schema.json"):
        shutil.copy(base / f, d / f)
    mode = V03_MODE
    if user_role:
        mode = mode.replace("      - { id: answer, role: briefing-analyst,",
                            "      - { id: sum, role: my-summarizer, out: Answer, task: \"Summarize.\" }\n"
                            "      - { id: answer, role: briefing-analyst,")
        mode = mode.replace("roles: [briefing-lead, briefing-analyst, reviewer]",
                            "roles: [briefing-lead, briefing-analyst, reviewer, my-summarizer]")
        (k / "roles").mkdir()
        (k / "roles/my-summarizer.yaml").write_text(V03_ROLE)
    (d / "mode.yaml").write_text(mode)
    (k / "agents").mkdir()
    (k / "agents/my-agent.yaml").write_text(V03_AGENT)
    (k / "envs/my-env.yaml").write_text(V03_ENV)
    return k


def _shape(s):
    m = s.modes["my-brief"]
    ask = m.features["ask"]
    ans = next(st for st in ask.steps if st.id == "answer")
    rv = ask.steps[-1]
    return {"roles": m.roles, "coordinator": m.coordinator, "answer": (ans.env, ans.subagent, ans.inference.tier,
            ans.inference.effort), "review": (rv.env, rv.inference.tier, rv.inference.effort),
            "tiers": s.env("my-env").spec.get("tiers"), "caps": m.constraints.get("maxItemsPerRun")}


def test_03_shape_resolves_with_deprecation_warnings():
    k = v03_kit()
    kit = model.Kit(k)
    assert lint.run(kit=kit) == [], lint.run(kit=kit)
    ws = [w for w in lint.warnings(kit) if "deprecated" in w]
    for needle in ("modes/my-brief/mode.yaml: `roles:` list form, endpoint ask `agents:`, endpoint ask review "
                   "`model`, `inference` is deprecated (0.3 shape) and now resolves to `roles: {lead: local-feeds, "
                   "analyst: local-feeds, reviewer: workspace}`",
                   "modes/my-brief/mode.yaml: role `briefing-analyst` is deprecated (0.3) and now resolves to the "
                   "framework role `analyst`",
                   "modes/my-brief/mode.yaml: role `briefing-lead` is deprecated",
                   "agents/my-agent.yaml: per-role agent files are deprecated (0.3); agent my-agent now only gives "
                   "env my-env",
                   "envs/my-env.yaml: `models` is deprecated (0.3)", "`tiers: [fast, balanced]`",
                   "modes/my-brief/mode.yaml constraints: `maxPostsPerRun` -> `maxItemsPerRun`"):
        assert any(needle in w and "bay migrate" in w for w in ws), (needle, ws)
    s = model.resolve(kit)
    got = _shape(s)
    # 0.3: answer ran on my-agent (env my-env) at the mode default sonnet with the step's effort high; the review
    # at sonnet (its own model) in the reviewer's 0.3 env (critic: workspace)
    assert got == {"roles": {"lead": "local-feeds", "analyst": "local-feeds", "reviewer": "workspace"},
                   "coordinator": "lead", "answer": ("my-env", "analyst--my-brief", "balanced", "high"),
                   "review": ("workspace", "balanced", "medium"), "tiers": ["fast", "balanced"], "caps": 50}, got
    # it runs: the coordinator's env syncs, the analyst reads its own env's store through its unit
    p = project()
    d = dispatch.Dispatcher(model.resolve(model.Kit(k, p)), p, clock=clock)
    assert d.call("my-brief.sync", {})["status"] in ("done", "partial")
    plan = d.call("my-brief.ask", {"question": "what is new?"})["next"]
    assert plan["runAs"] == "subagent_type=analyst--my-brief" and plan["env"] == "my-env" and plan["effort"] == "high"
    return got


def test_bay_migrate_rewrites_the_03_shape_and_leaves_nothing_to_migrate():
    k = v03_kit()
    before = {p: (k / p).read_text() for p in ("modes/my-brief/mode.yaml", "envs/my-env.yaml", "agents/my-agent.yaml")}
    got = _shape(model.resolve(model.Kit(k)))
    plan = migrate.plan(k)
    changes = {(c["op"], c["path"]) for c in plan["changes"]}
    assert {("update", "modes/my-brief/mode.yaml"), ("update", "envs/my-env.yaml"),
            ("delete", "agents/my-agent.yaml")} <= changes, changes
    assert all((k / p).read_text() == t for p, t in before.items())                  # dry run writes nothing
    r = subprocess.run([sys.executable, str(k / "bay/cli.py"), "migrate"], capture_output=True, text=True)
    assert r.returncode == 0 and "dry run: nothing written" in r.stdout
    migrate.apply(k)
    mode = (k / "modes/my-brief/mode.yaml").read_text()
    for gone in ("inference", "agents:", "model:", "briefing-", "maxPostsPerRun", "roles: ["):
        assert gone not in mode, (gone, mode)
    assert "tiers: [fast, balanced]      # my cap" in (k / "envs/my-env.yaml").read_text()   # comment kept
    assert not (k / "agents").exists()
    kit = model.Kit(k)
    assert [w for w in lint.warnings(kit) if "deprecated" in w] == [] and lint.run(kit=kit) == []
    assert _shape(model.resolve(kit)) == got                                       # same behaviour, new shape
    assert migrate.plan(k)["changes"] == []


def test_a_user_role_file_is_an_error_and_migrate_moves_it_into_its_mode_as_a_skill():
    k = v03_kit(user_role=True)
    kit = model.Kit(k)
    errs = lint.run(kit=kit)
    assert any("roles/my-summarizer.yaml: roles are framework-level; customize behaviour in your mode's "
               "playbooks/skills, or propose a new role via forge.extend" in e for e in errs), errs
    plan = migrate.plan(k)
    changes = {(c["op"], c["path"]) for c in plan["changes"]}
    assert {("create", "modes/my-brief/skills/my-summarizer/SKILL.md"), ("delete", "roles/my-summarizer.yaml"),
            ("update", "modes/my-brief/mode.yaml")} <= changes, changes
    migrate.apply(k)
    skill = (k / "modes/my-brief/skills/my-summarizer/SKILL.md").read_text()
    assert "name: my-summarizer" in skill and "exactly three bullets" in skill and "never more than three" in skill
    assert not (k / "roles").exists()
    kit = model.Kit(k)
    assert lint.run(kit=kit) == [] and not [w for w in lint.warnings(kit) if "deprecated" in w]
    s = model.resolve(kit)
    st = next(x for x in s.modes["my-brief"].features["ask"].steps if x.id == "sum")
    # read-only uses -> analyst; its 0.3 agent's env is kept (a step override: the mode runs analyst in
    # local-feeds) and so is its 0.3 model (the mode's inference default sonnet beat the agent's haiku); the
    # step follows the skill
    assert (st.role, st.env, st.inference.tier) == ("analyst", "my-env", "balanced"), (st.role, st.env, st.inference)
    assert "roles: {analyst: my-env}" in (k / "modes/my-brief/mode.yaml").read_text()
    assert "Follow the my-summarizer skill" in st.task and "my-summarizer" in st.resolved.skills
    assert migrate.plan(k)["changes"] == []
