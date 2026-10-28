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
    tags = con.execute("SELECT count(*) FROM item_selectors WHERE selector = 'home'").fetchone()[0]
    tables = {r[0] for r in con.execute("SELECT name FROM sqlite_master WHERE type = 'table'")}
    con.close()
    st = json.loads((d / "feed-briefing/state.json").read_text())        # internal state: outside corpus.db
    assert "state" not in tables and (d / "feed-briefing/state.json").stat().st_mode & 0o777 == 0o600
    assert st["budget"] == STATE["budget"] and st["coverage"] == STATE["coverage"] and st["deleted"] == ["x:4"]
    assert st["checked"] == STATE["checked"] and st["selectors"] == [{"id": "home"}] and tags == 3
    assert st["sources"] == ["x"]
    assert st["cursors"] == {"x-api|{}": {"cursor": "6", "from": "2026-10-23T10:00:00Z", "to": "2026-10-27T10:00:00Z",
                                          "lastSync": "2026-10-27T10:00:00Z", "selectors": ["home"]}}
    # the migrated store answers through the views, then syncs incrementally from the kept cursor
    D = dispatch.Dispatcher(system(p), p, clock=clock)
    out = D.use("analyst--feed-briefing", "items.store/v1.sql", {"sql": "SELECT id, likes FROM v_posts ORDER BY id"})
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
    assert "x:4" not in {i["id"] for i in D.use("analyst--feed-briefing", "items.store/v1.query", {})["items"]}


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
            out = json.dumps(D.use("analyst--feed-briefing", "items.store/v1.sql", {"sql": f"SELECT {f.format(col)} FROM v_items"}))
            assert secret not in out and secret.upper() not in out and secret.encode().hex().upper() not in out
    texts = D.use("analyst--feed-briefing", "items.store/v1.sql", {"sql": "SELECT text FROM v_items WHERE id = 'x:3'"})
    assert texts["rows"] == [["post 3 on staking"]]                        # the last duplicate wins


def test_migrated_store_already_holds_exactly_the_modes_scope():
    """Posts from a source the env does not bind, and posts no current selector matches, are not written: the
    store satisfies the corpus-store invariant before any sync or prune runs."""
    sels = [{"id": "staking", "text": "staking"}]
    p = project({"connectors": {"x-api": {"userId": "42"}}, "secrets": {"provider": "env"},
                 "modes": {"feed-briefing": {"selectors": sels}}}, source="x-api")
    off_topic = dict(POSTS[0], id="7", text="cooking tips")
    other_src = dict(POSTS[1], id="8", source="fake", url="https://example.com/8")
    d = bad_lines(p, [json.dumps(x) for x in [*POSTS, off_topic, other_src]])
    plan = migrate.plan(KIT, project=p)
    assert "+items: 3 post/v1 (x: 3), matched: [staking]" in plan["diff"]
    assert "1 on the deleted list dropped" in plan["diff"] and "1 matching no selector dropped" in plan["diff"]
    assert "1 from sources not bound in env local-feeds (x) dropped" in plan["diff"]
    migrate.apply(KIT, project=p)
    con = sqlite3.connect(d / "feed-briefing/corpus.db")
    got = {r[0] for r in con.execute("SELECT source || ':' || ext_id FROM items")}
    fts = con.execute("SELECT count(*) FROM items_fts").fetchone()[0]
    con.close()
    assert got == {"x:3", "x:5", "x:6"} and fts == 3
    st = json.loads((d / "feed-briefing/state.json").read_text())
    assert st["selectors"] == sels and st["sources"] == ["x"]
    assert st["cursors"]["x-api|{}"]["selectors"] == ["staking"]          # text is local on x: same native query
    # the next prune finds nothing out of scope, and status does not call the scope stale
    D = dispatch.Dispatcher(system(p), p, clock=clock)
    out = D.run_capability("feed-briefing", "items.store/v1.prune", {"olderThan": "3650d"})
    assert out["unbound"] == 0 and out["unmatched"] == 0 and out["remaining"] == 3
    assert D.use("analyst--feed-briefing", "items.store/v1.status", {})["stale"] is False


def test_wrong_shape_json_is_reported_with_file_line_and_fix_never_a_crash():
    """Each shape that used to raise (bay/migrate.py at 438ef0e): author as a string (:156, dict()), cursors as a
    string or a list (:236, .items()), deleted as a number (:246, sorted()), a line that is not UTF-8 (:202,
    read_text). Each is now a note naming the file (and line) and what to fix; nothing is written."""
    cfg = {"connectors": {"x-api": {"userId": "42"}}, "secrets": {"provider": "env"}}
    good = json.dumps(POSTS[0]).encode()
    cases = [
        ([good, json.dumps(dict(POSTS[1], author="bob")).encode()], STATE,
         ['.agentbay/data/feeds/posts.jsonl:2: "author" must be an object, got a string ("bob")']),
        ([good, b'{"id": "9", "text": "caf\xe9"}'], STATE,
         [".agentbay/data/feeds/posts.jsonl:2: not UTF-8 (byte 0xe9 at column 25)"]),
        ([good, json.dumps(dict(POSTS[1], createdAt="yesterday")).encode()], STATE,
         ['posts.jsonl:2: "createdAt" and "fetchedAt" must be ISO-8601']),
        ([good, b"[1, 2]"], STATE, ["posts.jsonl:2: expected a JSON object, got a list"]),
        ([good], dict(STATE, cursors="x-api"),
         ['.agentbay/data/feeds/state.json: not a valid v0.2 state file ("cursors" must be an object, got a string']),
        ([good], dict(STATE, cursors=["x-api"]), ['("cursors" must be an object, got a list']),
        ([good], dict(STATE, cursors={"x-api": "6"}), ['"cursors.x-api" must be an object']),
        ([good], dict(STATE, deleted=5), ['("deleted" must be a list, got a number (5))']),
        ([good], dict(STATE, deleted=[4]), ['"deleted" must be a list of "<source>:<id>" strings']),
        ([good], dict(STATE, budget={"2026-10": 5}), ['"budget.2026-10" must be {"posts": <number>']),
        ([good], dict(STATE, coverage={"from": 5}), ['"coverage" and "cursors" times must be ISO-8601']),
    ]
    for lines, state, needles in cases:
        p = project(cfg, source="x-api")
        d = p / ".agentbay/data/feeds"
        d.mkdir(parents=True)
        (d / "posts.jsonl").write_bytes(b"\n".join(lines) + b"\n")
        (d / "state.json").write_text(json.dumps(state))
        plan = migrate.plan(KIT, project=p)
        assert plan["changes"] == [], (needles, plan)
        for n in needles:
            assert n in plan["notes"][0], (n, plan["notes"])
        assert "Fix" in plan["notes"][0] or "fix" in plan["notes"][0]
        r = subprocess.run([sys.executable, str(KIT / "bay/cli.py"), "--project", str(p), "migrate", "--confirm"],
                           capture_output=True, text=True)
        assert r.returncode == 0 and "Traceback" not in r.stderr and not (d / "feed-briefing").exists(), r.stderr
    p = project(cfg, source="x-api")                          # a state.json that is not UTF-8
    d = bad_lines(p, [good.decode()])
    (d / "state.json").write_bytes(b'{"cursors": "\xff"}')
    assert "state.json: not a valid v0.2 state file (not UTF-8)" in migrate.plan(KIT, project=p)["notes"][0]


def test_inner_author_fields_deep_nesting_and_scrub_collisions_never_crash():
    cfg = {"connectors": {"x-api": {"userId": "42"}}, "secrets": {"provider": "env"}}
    deep = '{"id": "9", "source": "x", "url": "u", "createdAt": "2026-10-26T10:00:00Z", "x": ' + \
        "[" * 100_000 + "]" * 100_000 + "}"
    for lines, needle in (
            ([json.dumps(dict(POSTS[0], author={"handle": ["a"]}))],
             'posts.jsonl:1: "author.handle" must be a string, got a list (["a"])'),
            ([json.dumps(dict(POSTS[0], author={"handle": "a", "name": {"first": "A"}}))],
             'posts.jsonl:1: "author.name" must be a string, got an object'),
            ([json.dumps(dict(POSTS[0], metrics={"like_count": [1]}))], '"metrics.like_count" must be a whole number'),
            ([json.dumps(POSTS[0]), deep], "posts.jsonl:2: JSON nested too deeply")):
        p = project(cfg, source="x-api")
        d = bad_lines(p, lines)
        plan = migrate.plan(KIT, project=p)
        assert plan["changes"] == [] and needle in plan["notes"][0], (needle, plan["notes"])
        r = subprocess.run([sys.executable, str(KIT / "bay/cli.py"), "--project", str(p), "migrate", "--confirm"],
                           capture_output=True, text=True)
        assert r.returncode == 0 and "Traceback" not in r.stderr and not (d / "feed-briefing").exists(), r.stderr
    p = project(cfg, source="x-api")                         # a state.json nested too deeply
    d = bad_lines(p, [json.dumps(POSTS[0])])
    (d / "state.json").write_text('{"cursors": ' + "[" * 100_000 + "]" * 100_000 + "}")
    assert "state.json: not a valid v0.2 state file (JSON nested too deeply)" in migrate.plan(KIT, project=p)["notes"][0]
    # two ids that differ only in a secret scrub to one id: one row (the last), counted, no UNIQUE error
    p = project(cfg, source="x-api")
    d = bad_lines(p, [json.dumps(dict(POSTS[0], id="password=hunter2hunter2a", text="first")),
                      json.dumps(dict(POSTS[1], id="password=hunter2hunter2b", text="second"))])
    plan = migrate.plan(KIT, project=p)
    assert "+items: 1 post/v1 (x: 1)" in plan["diff"]
    assert "1 merged because their ids are the same once secrets are scrubbed" in plan["diff"]
    assert migrate.apply(KIT, project=p)["applied"] == 1
    con = sqlite3.connect(d / "feed-briefing/corpus.db")
    rows_ = con.execute("SELECT ext_id, body FROM items").fetchall()
    con.close()
    assert rows_ == [("[REDACTED:password]", "second")]


def test_a_failed_conversion_leaves_no_partial_folder():
    p = project({"connectors": {"x-api": {"userId": "42"}}, "secrets": {"provider": "env"}}, source="x-api")
    d = v02(p)
    real = migrate._corpus_module

    def failing():
        cs = real()

        def boom(path, state):
            raise OSError("disk full")
        cs.save_state = boom
        return cs
    migrate._corpus_module = failing
    try:
        migrate.apply(KIT, project=p)
        raise AssertionError("expected the conversion to fail")
    except OSError:
        pass
    finally:
        migrate._corpus_module = real
    assert sorted(f.name for f in d.iterdir()) == ["posts.jsonl", "state.json"]       # untouched, nothing new
    assert migrate.apply(KIT, project=p)["applied"] == 1                                # and it can run again


def test_created_at_is_normalized_to_utc():
    p = project({"connectors": {"x-api": {"userId": "42"}}, "secrets": {"provider": "env"}}, source="x-api")
    d = bad_lines(p, [json.dumps(dict(POSTS[0], createdAt="2026-10-24T12:00:00+02:00", fetchedAt="2026-10-27T10:00:00"))])
    migrate.apply(KIT, project=p)
    con = sqlite3.connect(d / "feed-briefing/corpus.db")
    got = con.execute("SELECT created_at, fetched_at FROM items").fetchone()
    con.close()
    assert got == ("2026-10-24T10:00:00Z", "2026-10-27T10:00:00Z")
