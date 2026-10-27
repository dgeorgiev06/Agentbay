"""`bay migrate --project`: a v0.2 feed store (posts.jsonl + state.json) becomes corpus.db.
Dry run by default; apply keeps cursors, coverage, budget, deletions and check times; the next sync is
incremental and deleted posts never come back."""
import json
import sqlite3
import subprocess
import sys

from helpers import KIT, SECRETS, FakeHttp, MemProvider, clock, jresp, kit_copy, project, system

from bay import dispatch, migrate

POSTS = [{"id": str(i), "source": "x", "author": {"handle": "alice", "name": "Alice"}, "text": f"post {i} on staking",
          "url": f"https://x.com/alice/status/{i}", "createdAt": f"2026-10-2{i}T10:00:00Z",
          "fetchedAt": "2026-10-27T10:00:00Z", "lang": "en", "metrics": {"like_count": i}} for i in range(3, 7)]
STATE = {"cursors": {"x-api": {"newestId": "6", "from": "2026-10-23T10:00:00Z", "to": "2026-10-27T10:00:00Z",
                               "lastSync": "2026-10-27T10:00:00Z"}},
         "coverage": {"from": "2026-10-23T10:00:00Z", "to": "2026-10-27T10:00:00Z"},
         "budget": {"2026-10": {"posts": 120, "usd": 0.6}}, "deleted": ["x:4"],
         "checked": {"x:3": "2026-10-27T10:00:00Z"}, "count": 4}


def v02(p):
    d = p / ".agentbay/data/feeds"
    d.mkdir(parents=True)
    (d / "posts.jsonl").write_text("".join(json.dumps(x) + "\n" for x in POSTS))
    (d / "state.json").write_text(json.dumps(STATE))
    return d


def tree(p):
    return sorted((str(f.relative_to(p)), f.read_bytes()) for f in p.rglob("*") if f.is_file())


def test_dry_run_writes_nothing_and_shows_the_conversion():
    p = project(source="x-api")
    v02(p)
    before = tree(p)
    plan = migrate.plan(KIT, project=p)
    assert [c["op"] for c in plan["changes"]] == ["convert"] and tree(p) == before
    assert "+items: 3 post/v1 (x: 3)" in plan["diff"] and "1 on the deleted list dropped" in plan["diff"]
    assert '"cursor": "6"' in plan["diff"] and '"posts": 120' in plan["diff"] and "posts.jsonl.v0.2.bak" in plan["diff"]
    r = subprocess.run([sys.executable, str(KIT / "bay/cli.py"), "--project", str(p), "migrate"],
                       capture_output=True, text=True)
    assert r.returncode == 0 and "dry run: nothing written" in r.stdout and tree(p) == before


def test_apply_preserves_state_and_the_next_sync_is_incremental():
    p = project({"connectors": {"x-api": {"userId": "42"}}, "secrets": {"provider": "env"}}, source="x-api")
    d = v02(p)
    res = migrate.apply(KIT, project=p)
    assert res["applied"] == 1
    assert (d / "posts.jsonl.v0.2.bak").exists() and (d / "state.json.v0.2.bak").exists()
    assert not (d / "posts.jsonl").exists() and migrate.plan(KIT, project=p)["changes"] == []
    con = sqlite3.connect(d / "feed-briefing/corpus.db")
    st = {k: json.loads(v) for k, v in con.execute("SELECT key, value FROM state")}
    tags = con.execute("SELECT count(*) FROM item_selectors WHERE selector = 'home'").fetchone()[0]
    con.close()
    assert st["budget"] == STATE["budget"] and st["coverage"] == STATE["coverage"] and st["deleted"] == ["x:4"]
    assert st["checked"] == STATE["checked"] and st["selectors"] == [{"id": "home"}] and tags == 3
    assert st["cursors"] == {"x-api|{}": {"cursor": "6", "from": "2026-10-23T10:00:00Z", "to": "2026-10-27T10:00:00Z",
                                          "lastSync": "2026-10-27T10:00:00Z", "selectors": ["home"]}}
    # the migrated store answers through the views, then syncs incrementally from the kept cursor
    D = dispatch.Dispatcher(system(p), p, clock=clock)
    out = D.use("briefing-analyst", "items.store/v1.sql", {"sql": "SELECT id, likes FROM v_posts ORDER BY id"})
    assert out["rows"] == [["x:3", 3], ["x:5", 5], ["x:6", 6]]
    seen = []

    def timeline(params, headers, form):
        seen.append(params)
        t = {"id": "7", "text": "post 7", "author_id": "1", "created_at": "2026-10-27T11:00:00Z"}
        return jresp({"data": [t], "meta": {"result_count": 1}, "includes": {"users": [{"id": "1", "username": "alice"}]}})

    def lookup(params, headers, form):            # x:4 was deleted before; 3, 5, 6 still exist
        return jresp({"data": [{"id": i} for i in params["ids"].split(",")]})
    routes = {("POST", "/2/oauth2/token"): lambda *a: jresp({"access_token": "at-1"}),
              ("GET", "/2/users/42/timelines/reverse_chronological"): timeline, ("GET", "/2/tweets"): lookup}
    r = dispatch.Dispatcher(system(p), p, transport=FakeHttp(routes), provider=MemProvider(SECRETS),
                            clock=clock).call("feed-briefing.sync", {})
    assert r["status"] == "done" and r["output"]["added"] == 1 and r["output"]["rematched"] == 0
    assert seen[0]["since_id"] == "6" and "start_time" not in seen[0]
    assert r["output"]["budget"]["posts"] == 120 + r["output"]["billed"]
    assert "x:4" not in {i["id"] for i in D.use("briefing-analyst", "items.store/v1.query", {})["items"]}


def test_forge_migrate_never_touches_project_data():
    k = kit_copy()
    v02(k)
    out = dispatch.Dispatcher(system(k, k), k).call("forge.migrate", {})
    plan = out["next"]["review"]["output"] if out["status"] == "needs-agent" else out["output"]
    assert not any(c["op"] == "convert" for c in plan["changes"])
    assert migrate.plan(k, project=k)["changes"][0]["op"] == "convert"      # `bay migrate --project` does it


def bad_lines(p, lines):
    d = p / ".agentbay/data/feeds"
    d.mkdir(parents=True)
    (d / "posts.jsonl").write_text("".join(x + "\n" for x in lines))
    (d / "state.json").write_text(json.dumps(STATE))
    return d


def test_bad_lines_and_state_are_reported_with_file_line_and_fix():
    good = json.dumps(POSTS[0])
    no_source = json.dumps({k: v for k, v in POSTS[1].items() if k != "source"})
    p = project(source="x-api")
    bad_lines(p, [good, no_source, "{broken"])
    plan = migrate.plan(KIT, project=p)
    assert plan["changes"] == []
    note = plan["notes"][0]
    assert ".agentbay/data/feeds/posts.jsonl:2: missing source" in note and "posts.jsonl:3: not JSON" in note
    assert "Fix or delete those lines" in note
    p = project(source="x-api")
    d = bad_lines(p, [good])
    (d / "state.json").write_text('{"cursors": {"x-api": ')
    plan = migrate.plan(KIT, project=p)
    assert plan["changes"] == [] and ".agentbay/data/feeds/state.json:1:" in plan["notes"][0]
    assert "move it aside" in plan["notes"][0]
    r = subprocess.run([sys.executable, str(KIT / "bay/cli.py"), "--project", str(p), "migrate", "--confirm"],
                       capture_output=True, text=True)
    assert r.returncode == 0 and "Traceback" not in r.stderr and "state.json:1:" in r.stdout


def test_duplicates_are_merged_and_counted_and_migrated_rows_are_scrubbed():
    secret = "sk-ant-api03-ABCDEFGHIJKLMNOPQRSTUVWXYZ012345"
    first = dict(POSTS[0], text="old text")
    leaky = dict(POSTS[2], author={"handle": f"api_key={secret}", "name": "x"}, text=f"token {secret}",
                 url=f"https://x.com/a?access_token={secret}")
    p = project({"connectors": {"x-api": {"userId": "42"}}, "secrets": {"provider": "env"}}, source="x-api")
    bad_lines(p, [json.dumps(first), json.dumps(POSTS[0]), json.dumps(leaky)])
    plan = migrate.plan(KIT, project=p)
    assert "1 duplicate line(s) merged" in plan["diff"] and "+items: 2 post/v1" in plan["diff"]
    migrate.apply(KIT, project=p)
    db = p / ".agentbay/data/feeds/feed-briefing/corpus.db"
    assert secret not in db.read_bytes().decode("latin-1")
    D = dispatch.Dispatcher(system(p), p, clock=clock)
    for col in ("text", "author", "url", "title"):
        for f in ("hex({})", "upper({})"):
            out = json.dumps(D.use("briefing-analyst", "items.store/v1.sql", {"sql": f"SELECT {f.format(col)} FROM v_items"}))
            assert secret not in out and secret.upper() not in out and secret.encode().hex().upper() not in out
    texts = D.use("briefing-analyst", "items.store/v1.sql", {"sql": "SELECT text FROM v_items WHERE id = 'x:3'"})
    assert texts["rows"] == [["post 3 on staking"]]                        # the last duplicate wins
