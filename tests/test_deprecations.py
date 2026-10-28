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
  roles: [feed-lead, feed-analyst, my-reader, reviewer]
  workflows:
    sync:
      - { id: fetch, run: feed.store/v1.sync, with: { lookback: "$in.lookback|$config.lookback", maxPosts: "$in.maxPosts" } }
    ask:
      - { id: refresh, run: feed.store/v1.sync, when: "stale > 2h" }
      - { id: context, run: feed.store/v1.status, with: { since: "$in.since|$config.lookback" } }
      - { id: answer, role: my-reader, out: Answer, task: "Answer from stored posts." }
  constraints: { lookbackMax: 30d, spendUsd: 5 }
  needs: [feed.store/v1, feed.source/v1]
  config: config.schema.json
"""
V02_ROLE = """apiVersion: agentbay/v2
kind: Role
metadata: { name: my-reader, description: Reads my posts. }
spec:
  agent: my-agent
  uses: [feed.store/v1.query, feed.store/v1.status]
  prompt: Read posts with your use shim.
  doneWhen: [every claim cites a stored post]
"""
V02_AGENT = """apiVersion: agentbay/v2
kind: Agent
metadata: { name: my-agent, description: Subagent for my-reader. }
spec: { runtime: claude-code-subagent, model: sonnet, effort: medium, env: my-env }
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
  models: [haiku, sonnet, opus, inherit]
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
    cfg = json.loads((k / "modes/feed-briefing/config.schema.json").read_text())
    cfg["properties"].pop("selectors")                                   # v0.2 had no selectors
    (d / "config.schema.json").write_text(json.dumps(cfg))
    shutil.copy(k / "modes/feed-briefing/types/SyncReq.schema.json", d / "types/SyncReq.schema.json")
    answer = (base / "types/Answer.schema.json").read_text().replace("items.coverage/v1", "feed.coverage/v1")
    (d / "types/Answer.schema.json").write_text(answer)
    (d / "mode.yaml").write_text(V02_MODE)
    (k / "roles/my-reader.yaml").write_text(V02_ROLE)
    (k / "agents/my-agent.yaml").write_text(V02_AGENT)
    (k / "envs/my-env.yaml").write_text(V02_ENV)
    # the user's own v0.2 feed mode takes feed-briefing's place: both would list briefing-lead/-analyst (the
    # aliases of feed-lead/-analyst), and one role cannot read two modes' stores until step 3
    shutil.rmtree(k / "modes/feed-briefing")
    return k


def test_v02_user_content_resolves_with_deprecation_warnings():
    k = v02_kit()
    kit = model.Kit(k)
    assert lint.run(kit=kit) == []
    ws = [w for w in lint.warnings(kit) if "deprecated" in w]
    for needle in ("modes/my-feed/mode.yaml: `feed.store/v1.sync` is deprecated (v0.2) and now resolves to "
                   "`items.store/v1.sync`; run `bay migrate`",
                   "modes/my-feed/mode.yaml: `feed-lead` is deprecated", "modes/my-feed/mode.yaml: `feed-analyst`",
                   "modes/my-feed/mode.yaml: `with: { maxPosts }`", "roles/my-reader.yaml: `feed.store/v1.query`",
                   "envs/my-env.yaml: `local-store` is deprecated (v0.2) and now resolves to `corpus-store`",
                   "envs/my-env.yaml: `feed.source/v1`"):
        assert any(needle in w for w in ws), (needle, ws)
    s = model.resolve(kit)
    m = s.modes["my-feed"]
    assert m.coordinator == "briefing-lead" and "briefing-analyst" in m.roles and m.needs == ["items.store/v1", "items.source/v1"]
    assert m.features["sync"].steps[0].with_ == {"lookback": "$in.lookback|$config.lookback", "maxItems": "$in.maxPosts"}
    assert m.config["selectors"] == [{"id": "home"}]                 # no selectors setting: v0.2 behaviour
    assert s.roles["my-reader"].bay_uses == ["items.store/v1.query", "items.store/v1.status"]
    assert kit.get("Environment", "my-env").spec["bind"]["items.store/v1"] == "corpus-store"
    # it runs: sync offline into its own store, and its reader reads it through the aliased grant
    p = project()
    sysk = model.resolve(model.Kit(k, p))
    d = dispatch.Dispatcher(sysk, p, clock=clock)
    r = d.call("my-feed.sync", {"maxPosts": 3})
    assert r["status"] == "partial" and r["output"]["fetched"] == 3 and "maxItems 3" in r["output"]["stopped"]
    assert (p / ".agentbay/data/feeds/my-feed/corpus.db").exists()
    assert len(d.use("my-reader", "items.store/v1.query", {})["items"]) == 3


def test_bay_migrate_rewrites_v02_user_content_cleanly():
    k = v02_kit()
    before = (k / "modes/my-feed/mode.yaml").read_text()
    plan = migrate.plan(k)
    paths = {c["path"] for c in plan["changes"]}
    assert {"modes/my-feed/mode.yaml", "modes/my-feed/types/Answer.schema.json", "roles/my-reader.yaml",
            "envs/my-env.yaml"} <= paths
    assert "+    items.store/v1: corpus-store      # the v0.2 JSONL store" in plan["diff"]
    assert (k / "modes/my-feed/mode.yaml").read_text() == before                   # dry run
    r = subprocess.run([sys.executable, str(k / "bay/cli.py"), "migrate"], capture_output=True, text=True)
    assert r.returncode == 0 and "dry run: nothing written" in r.stdout
    migrate.apply(k)
    mode = (k / "modes/my-feed/mode.yaml").read_text()
    assert "feed." not in mode and "feed-lead" not in mode and "maxPosts:" not in mode
    assert "coordinator: briefing-lead" in mode and 'maxItems: "$in.maxPosts"' in mode
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
