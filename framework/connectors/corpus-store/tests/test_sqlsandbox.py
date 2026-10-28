"""Adversarial tests for items.store/v1.sql (bay/sqlsandbox.py): nothing an agent sends can write, read
internal tables, run away, load code or leak a secret stored in an item; every refusal says what to change.
Scope is structural (the store holds only the mode's scope), so every full-text and count form that once
leaked out-of-scope rows now finds nothing out of scope."""
import json
import sqlite3
import subprocess
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[4] / "tests"))

from helpers import clock, project, system  # noqa: E402

from bay import connect, sqlsandbox  # noqa: E402

SECRET_TEXT = ("rotate soon: sk-ant-api03-ABCDEFGHIJKLMNOPQRSTUVWXYZ012345 and password=hunter2hunter2 "
               "token eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c")


HOME = [{"id": "home", "in": "home"}]


def setup(extra_fixture=None, selectors=None):
    p = project()
    fx = [{"id": "21", "handle": "ops", "text": SECRET_TEXT, "ageHours": 1},
          {"id": "22", "handle": "lido", "text": "Staking module update", "ageHours": 2},
          {"id": "23", "handle": "vitalik", "text": "Proof of stake research", "ageHours": 3}] + (extra_fixture or [])
    (p / "fx.json").write_text(json.dumps(fx))
    import yaml
    cfg = yaml.safe_load((p / "agentbay.config.yaml").read_text())
    cfg["connectors"] = {"fake": {"fixture": "fx.json"}}
    (p / "agentbay.config.yaml").write_text(yaml.safe_dump(cfg))
    st = connect.instantiate(system(p), "local-feeds-offline", "corpus-store", "items.store/v1", p,
                             settings={"lookbackMax": "30d", "selectors": selectors or HOME,
                                       "mode": "feed-briefing"}, clock=clock)
    st.sync(lookback="3d")
    return p, st


def dbfile(p):
    return p / ".agentbay/data/feeds/feed-briefing/corpus.db"


def snapshot(p):
    con = sqlite3.connect(dbfile(p))
    try:
        return (con.execute("SELECT count(*), group_concat(body) FROM items").fetchone(),
                con.execute("SELECT group_concat(item || selector) FROM item_selectors").fetchone(),
                con.execute("SELECT group_concat(sql) FROM sqlite_master").fetchone())
    finally:
        con.close()


def refused(st, sql, *needles):
    out = st.sql(sql)
    assert out.get("error"), f"not refused: {sql} -> {out}"
    for n in needles:
        assert n in out["error"], f"{sql}: {out['error']!r} lacks {n!r}"
    return out["error"]


def test_approved_reads_work():
    p, st = setup()
    out = st.sql("SELECT id, author FROM v_items ORDER BY id")
    assert out["rows"] == [["fake:21", "ops"], ["fake:22", "lido"], ["fake:23", "vitalik"]] and out["truncated"] is None
    assert st.sql("SELECT count(*) FROM v_posts WHERE lang IS NULL")["rows"] == [[3]]
    assert st.sql("SELECT count(*) FROM temp.v_items v, json_each(v.matched) j WHERE j.value = 'home'")["rows"] == [[3]]
    out = st.sql("SELECT id, snippet FROM v_fts WHERE fts MATCH '\"proof of stake\"' ORDER BY rank")
    assert out["rows"] == [["fake:23", "[Proof of stake] research"]]
    out = st.sql("WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 5) SELECT sum(i) FROM n")
    assert out["rows"] == [[15]]                          # bounded recursion is fine


def test_writes_and_ddl_are_refused():
    p, st = setup()
    before = snapshot(p)
    for sql in ("DELETE FROM items", "UPDATE items SET body = 'x'", "INSERT INTO item_selectors VALUES (1, 'k')",
                "DROP TABLE items", "CREATE TABLE evil (a)", "CREATE TEMP TABLE evil (a)",
                "CREATE TEMP VIEW v_items2 AS SELECT 1", "DROP VIEW v_items", "ALTER TABLE items ADD COLUMN x",
                "CREATE TRIGGER t AFTER INSERT ON items BEGIN DELETE FROM items; END", "REINDEX", "ANALYZE",
                "VACUUM", "BEGIN", "SAVEPOINT a", "INSERT INTO items_fts (items_fts) VALUES ('delete-all')",
                "UPDATE v_items SET text = 'x'"):
        err = refused(st, sql)
        assert "Traceback" not in err
    assert snapshot(p) == before


def test_attach_pragma_and_load_extension_are_refused():
    p, st = setup()
    before = snapshot(p)
    refused(st, f"ATTACH DATABASE '{p / 'x.db'}' AS x", "ATTACH")
    assert not (p / "x.db").exists()
    refused(st, "PRAGMA writable_schema = 1", "PRAGMA")
    refused(st, "PRAGMA table_info(items)", "PRAGMA")
    refused(st, "PRAGMA query_only = 0", "PRAGMA")
    refused(st, "SELECT * FROM pragma_table_info('items')", "pragma_table_info")
    refused(st, "SELECT load_extension('/tmp/evil.so')", "load_extension", "not allowed")
    refused(st, "SELECT randomblob(100000000)", "randomblob")
    refused(st, "SELECT printf('%.*c', 100000000, 'x')", "printf")
    refused(st, "SELECT sqlite_version()", "sqlite_version")
    assert snapshot(p) == before


def plant_internal_table(p):
    """A table the sandbox does not know, as an internal table would be (internal state lives in state.json,
    outside corpus.db; this proves the authorizer is an allowlist, not a list of known names)."""
    con = sqlite3.connect(dbfile(p))
    try:
        con.execute("CREATE TABLE cursors (key TEXT, value TEXT)")
        con.execute("INSERT INTO cursors VALUES ('fake|{}', '{\"cursor\": \"23\"}')")
        con.commit()
    finally:
        con.close()


def test_internal_state_is_not_in_the_store_and_unknown_tables_are_unreadable():
    p, st = setup()
    assert (dbfile(p).parent / "state.json").exists()                  # cursors, budget, ... live here
    for t in ("state", "budget", "cursors", "coverage", "deleted"):
        for sql in (f"SELECT count(*) FROM {t}", f"SELECT (SELECT count(*) FROM main.{t}) FROM v_items LIMIT 1",
                    f"SELECT count(*) FROM v_items WHERE EXISTS (SELECT 1 FROM {t})"):
            refused(st, sql)
    plant_internal_table(p)
    for sql, name in (("SELECT count(*) FROM cursors", "cursors"), ("SELECT * FROM main.cursors", "cursors"),
                      ('SELECT * FROM "CuRsOrS"', "CuRsOrS"), ("SELECT * FROM [cursors]", "cursors"),
                      ("SELECT (SELECT count(*) FROM cursors) FROM v_items", "cursors"),
                      ("SELECT * FROM v_items WHERE id IN (SELECT key FROM cursors)", "cursors"),
                      ("SELECT * FROM sqlite_master", "sqlite_master"), ("SELECT * FROM sqlite_schema", "sqlite_"),
                      ("SELECT count(*) FROM sqlite_temp_master", "sqlite_temp_master")):
        err = refused(st, sql, "not allowed")
        assert name.lower() in err.lower() and "describe" in err
    # reads of no column (count(*), EXISTS) reach the authorizer without a database: same allowlist
    for t in ("items_fts_data", "items_fts_idx", "items_fts_config", "items_fts_docsize", "items_fts_content",
              "sqlite_master", "cursors"):
        refused(st, f"SELECT count(*) FROM {t}", "not allowed")
        refused(st, f"SELECT 1 WHERE EXISTS (SELECT 1 FROM {t})", "not allowed")
        refused(st, f"SELECT count(*) FROM (SELECT 1 FROM {t})", "not allowed")
    refused(st, "WITH cursors AS (SELECT 1) SELECT count(*) FROM cursors", "WITH clause may not be named")
    assert st.sql("WITH RECURSIVE r(n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM r WHERE n < 4) "
                  "SELECT count(*) FROM r")["rows"] == [[4]]                       # a CTE counted is fine
    refused(st, "SELECT * FROM main.v_items", "no such table")      # views are temp, built by this code
    for sql in ("WITH v_items AS (SELECT * FROM cursors) SELECT * FROM v_items",
                "WITH items AS (SELECT 1) SELECT * FROM items",
                "WITH items_fts AS (SELECT 1) SELECT * FROM items_fts",
                'WITH "V_ITEMS"(a, b) AS MATERIALIZED (SELECT pk, body FROM items) SELECT * FROM v_items',
                "WITH x AS (SELECT 1), [v_items]/* c */AS NOT MATERIALIZED(SELECT * FROM items) SELECT * FROM v_items",
                "WITH `v_items`\n--c\nAS (SELECT * FROM items) SELECT * FROM v_items"):
        refused(st, sql, "WITH clause may not be named")
    assert st.sql("WITH mine AS (SELECT id FROM v_items) SELECT count(*) FROM mine")["rows"] == [[3]]
    assert st.sql("SELECT count(*) FROM v_items WHERE text != 'v_items AS (x'")["rows"] == [[3]]   # strings are data
    assert st.sql("SELECT count(*) FROM items")["rows"] == [[3]]     # store tables hold only the scope


def test_runaway_queries_hit_the_time_limit():
    p, st = setup()
    box = sqlsandbox.Sandbox(dbfile(p), time_ms=300)
    try:
        for sql in ("WITH RECURSIVE r(n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM r) SELECT count(*) FROM r",
                    "SELECT count(*) FROM v_items a, v_items b, v_items c, v_items d, v_items e, v_items f, v_items p, v_items q, "
                    "v_items g, v_items h, v_items i, v_items j, v_items k, v_items l, v_items m, v_items n, v_items o, "
                    "v_items r, v_items s, v_items t"):
            t0 = time.monotonic()
            try:
                box.run(sql)
                raise AssertionError("expected SqlError")
            except sqlsandbox.SqlError as e:
                assert "time limit" in str(e) and "LIMIT" in str(e)
            assert time.monotonic() - t0 < 3
        # a value that doubles every step stops at the length cap (or the clock), never at memory exhaustion
        try:
            box.run("WITH RECURSIVE r(s) AS (SELECT 'x' UNION ALL SELECT s || s FROM r) SELECT length(s) FROM r "
                    "ORDER BY 1 DESC LIMIT 1")
            raise AssertionError("expected SqlError")
        except sqlsandbox.SqlError as e:
            assert "time limit" in str(e) or "exceeded" in str(e)
        assert box.run("SELECT count(*) FROM v_items")["rows"] == [[3]]     # the connection is still usable
    finally:
        box.close()


def test_row_and_byte_caps():
    extra = [{"id": str(100 + i), "handle": "bulk", "text": "y" * 3000, "ageHours": 5} for i in range(150)]
    p, st = setup(extra)
    out = st.sql("SELECT id FROM v_items", limit=10)
    assert out["rowCount"] == 10 and "row cap 10" in out["truncated"]
    out = st.sql("SELECT id FROM v_items", limit=5000)                  # clamped to MAX_ROWS
    assert out["rowCount"] == 153 and out["truncated"] is None
    out = st.sql("SELECT text FROM v_items", limit=1000)
    assert "byte cap" in out["truncated"] and len(json.dumps(out["rows"])) <= sqlsandbox.MAX_BYTES
    out = st.sql("SELECT text || text FROM v_items WHERE author = 'bulk' LIMIT 1")
    assert out["rows"][0][0].endswith("chars; use substr()]")        # long cells are cut, not dropped


def test_planted_secrets_never_leave_any_read():
    p, st = setup()
    outs = [st.sql("SELECT text FROM v_items WHERE author = 'ops'"),
            st.sql("SELECT upper(text), substr(text, 14, 60) FROM v_items WHERE author = 'ops'"),
            st.get(["fake:21"]), st.query(author="ops"), st.search("rotate"), st.thread("fake:21")]
    blob = json.dumps(outs)
    for s in ("sk-ant-api03-ABCDEFGHIJKLMNOPQRSTUVWXYZ012345", "hunter2hunter2", "eyJhbGciOiJIUzI1NiJ9.eyJzdWIi"):
        assert s not in blob and s.upper() not in blob
    assert "[REDACTED:api-key]" in blob and "[REDACTED:password]" in blob and "[REDACTED:jwt]" in blob
    for sql in ("SELECT hex(text) FROM v_items WHERE author = 'ops'", "SELECT replace(text, 'sk-', 's k-') FROM v_items",
                "SELECT group_concat(substr(text, 1, 10), '|') FROM v_items"):
        assert "hunter2" not in json.dumps(st.sql(sql)) and "4142434445" not in json.dumps(st.sql(sql))
    con = sqlite3.connect(dbfile(p))                      # scrubbed at ingest, so no transform can rebuild it
    try:
        body = con.execute("SELECT body FROM items WHERE ext_id = '21'").fetchone()[0]
        fts = con.execute("SELECT count(*) FROM items_fts WHERE items_fts MATCH 'hunter2hunter2'").fetchone()[0]
    finally:
        con.close()
    assert "hunter2" not in body and "sk-ant" not in body and fts == 0


def test_comment_and_quoting_tricks():
    p, st = setup()
    before = snapshot(p)
    refused(st, "SELECT 1; DELETE FROM items", "exactly one SELECT")
    refused(st, "SELECT 1 /* harmless */; DROP TABLE items --", "exactly one SELECT")
    refused(st, "/* SELECT */ DELETE FROM items", "not allowed")
    refused(st, "SELECT 1 --\n; DELETE FROM items", "exactly one SELECT")
    out = st.sql("SELECT count(*) FROM v_items WHERE text = ''';DROP TABLE items;--'")
    assert out["rows"] == [[0]]                                       # a quoted string is just a string
    out = st.sql("SELECT 'a; DELETE FROM items' AS s -- trailing comment")
    assert out["rows"] == [["a; DELETE FROM items"]]
    refused(st, "SELECT * FROM v_items WHERE id = 'x' UNION SELECT name, 1,1,1,1,1,1,1,1,1,1,1,1,1,1,1 FROM sqlite_master",
            "sqlite_master")
    assert snapshot(p) == before


def test_fts_match_syntax_errors_say_how_to_quote():
    p, st = setup()
    err = refused(st, "SELECT id FROM v_fts WHERE fts MATCH '\"unterminated'", "MATCH", "double quotes")
    err2 = refused(st, "SELECT id FROM v_fts WHERE fts MATCH 'AND OR'", "MATCH")
    assert "proof of stake" in err and err2
    refused(st, "SELECT nope FROM v_items", "no such column", "describe")
    refused(st, "SELECT * FROM nowhere", "no such table", "v_items")


def test_missing_store_is_explained():
    p = project()
    st = connect.instantiate(system(p), "local-feeds-offline", "corpus-store", "items.store/v1", p,
                             settings={"selectors": [{"id": "home"}], "mode": "feed-briefing"}, clock=clock)
    assert "run the mode's sync endpoint first" in st.sql("SELECT 1")["error"]
    assert not dbfile(p).exists()                                     # reads never create the store


def plant_out_of_scope(p):
    """Rows the reviewer's oracle found, written straight into the store (the FTS triggers index them): one
    from a source not bound offline (x), one fake item no selector matches."""
    con = sqlite3.connect(dbfile(p))
    try:
        for src, xid, body in (("x", "900", "acquisition zebra from an unbound source"),
                               ("fake", "901", "acquisition zebra no selector matches")):
            pk = con.execute("INSERT INTO items (source, ext_id, kind, author, body, created_at, fetched_at) VALUES "
                             "(?, ?, 'post', 'eve', ?, '2026-10-27T11:30:00Z', '2026-10-27T12:00:00Z')",
                             (src, xid, body)).lastrowid
            con.execute("INSERT INTO item_selectors (item, selector) VALUES (?, 'home')", (pk,))
        con.commit()
    finally:
        con.close()


ZEBRA = [{"id": "home", "in": "home", "not": {"text": "zebra"}}, {"id": "zebra", "text": "zebra"}]
ORACLES = (   # every form that once counted or matched out-of-scope rows, with what it must return now
    ("SELECT (SELECT count(*) FROM v_fts), (SELECT count(*) FROM main.items_fts('acquisition AND zebra*'))", [[3, 0]]),
    ("SELECT count(*) FROM items_fts('zebra')", [[0]]),
    ("SELECT * FROM items_fts('acquisition')", []),
    ("SELECT rowid FROM items_fts WHERE items_fts MATCH 'zeb*'", []),
    ("SELECT count(*) FROM items_fts WHERE items_fts MATCH 'body: zebra'", [[0]]),
    ("SELECT count(*) FROM items_fts WHERE items_fts MATCH '{title body author}: acqui*'", [[0]]),
    ("SELECT count(*) FROM items_fts WHERE items_fts MATCH 'author: eve'", [[0]]),
    ("SELECT count(*) FROM items_fts", [[3]]),
    ("SELECT count(*), (SELECT count(*) FROM items), (SELECT count(*) FROM item_selectors) FROM v_fts", [[3, 3, 3]]),
    ("SELECT count(*) FROM v_fts WHERE fts MATCH 'zebra OR acquisition'", [[0]]),
    ("SELECT count(*) FROM v_fts v JOIN items_fts f ON f.rowid = v.rid WHERE f.items_fts MATCH 'zebra'", [[0]]),
    ("SELECT count(*) FROM v_fts v, items_fts('acqui*') f", [[0]]),
    ("SELECT id FROM v_items WHERE rid IN (SELECT rowid FROM items_fts('zebra'))", []),
    ("SELECT (SELECT count(*) FROM items_fts WHERE items_fts MATCH 'zebra') + (SELECT count(*) FROM items "
     "WHERE body LIKE '%zebra%')", [[0]]),
    ("SELECT DISTINCT source FROM items", [["fake"]]),
    ("SELECT count(*) FROM item_selectors WHERE selector != 'home'", [[0]]),
    ("SELECT count(*) FROM items i WHERE NOT EXISTS (SELECT 1 FROM item_selectors s WHERE s.item = i.pk)", [[0]]),
)


def test_out_of_scope_rows_are_gone_so_no_oracle_form_finds_them():
    extra = [{"id": "24", "handle": "lido", "text": "acquisition zebra talks", "ageHours": 2}]
    p, st = setup(extra, selectors=ZEBRA)
    assert st.sql("SELECT count(*) FROM v_fts WHERE fts MATCH 'zebra'")["rows"] == [[1]]    # in scope via `zebra`
    plant_out_of_scope(p)
    # the `zebra` selector is removed; sync deletes its item and the planted rows from items and items_fts
    st = connect.instantiate(system(p), "local-feeds-offline", "corpus-store", "items.store/v1", p,
                             settings={"lookbackMax": "30d", "selectors": ZEBRA[:1], "mode": "feed-briefing"},
                             clock=clock)
    out = st.sync(lookback="3d")
    assert out["outOfScope"] == 3 and out["fetched"] == 0                   # the kept items were not refetched
    for sql, want in ORACLES:
        res = st.sql(sql)
        assert res.get("error") is None and res["rows"] == want, (sql, res)
    assert [i["id"] for i in st.search("acquisition zebra")["items"]] == []
    assert st.search("staking")["items"][0]["id"] == "fake:22"
    for t in ("items_fts_content", "items_fts_data", "items_fts_idx", "items_fts_docsize", "items_fts_config",
              '"items_fts_content"', "main.items_fts_data"):
        refused(st, f"SELECT * FROM {t}", "not allowed")
    refused(st, "SELECT f.c0 FROM v_items v JOIN items_fts_content f ON f.id = v.rid", "not allowed")
    refused(st, "WITH v_fts AS (SELECT * FROM items_fts) SELECT * FROM v_fts", "WITH clause")
    err = refused(st, "SELECT * FROM v_items AS items (SELECT 1)", "SQL error")     # no WITH: plain syntax error
    assert "WITH clause" not in err


def test_full_text_on_the_store_table_and_the_view_agree():
    p, st = setup()
    via_view = st.sql("SELECT id FROM v_fts WHERE fts MATCH 'stake OR staking' ORDER BY id")["rows"]
    direct = st.sql("SELECT i.source || ':' || i.ext_id FROM items_fts('stake OR staking') f "
                    "JOIN items i ON i.pk = f.rowid ORDER BY 1")["rows"]
    assert via_view == direct == [["fake:22"], ["fake:23"]]
    assert st.sql("SELECT snippet(items_fts, 1, '[', ']', '', 4) FROM items_fts WHERE items_fts MATCH 'module'"
                  )["rows"] == [["Staking [module] update"]]


def test_every_view_accepts_narrow_projections():
    p, st = setup()
    assert st.sql("SELECT id, url FROM v_posts WHERE text LIKE '%stake%'")["rows"] == \
        [["fake:23", "https://example.com/vitalik/status/23"]]                    # the README example
    for sql, want in (("SELECT url FROM v_items WHERE author = 'lido'", [["https://example.com/lido/status/22"]]),
                      ("SELECT likes FROM v_posts WHERE id = 'fake:22'", [[None]]),
                      ("SELECT count(*) FROM v_posts", [[3]]),
                      ("SELECT kind FROM v_posts GROUP BY kind", [["post"]]),
                      ("SELECT rank < 0 FROM v_fts WHERE fts MATCH 'staking'", [[1]]),
                      ("SELECT snippet FROM v_fts WHERE fts MATCH 'module'", [["Staking [module] update"]]),
                      ("SELECT p.id FROM v_posts p JOIN v_fts f ON f.id = p.id WHERE f.fts MATCH 'research'",
                       [["fake:23"]])):
        out = st.sql(sql)
        assert out.get("error") is None and out["rows"] == want, (sql, out)


def test_big_sort_fails_cleanly():
    extra = [{"id": str(300 + i), "handle": "bulk", "text": f"row {i} " + "z" * 200, "ageHours": 5} for i in range(60)]
    p, st = setup(extra)
    box = sqlsandbox.Sandbox(dbfile(p), time_ms=300)
    try:
        try:
            box.run("SELECT a.text || b.text || c.text || d.text AS t FROM v_items a, v_items b, v_items c, v_items d "
                    "ORDER BY t DESC")
            raise AssertionError("expected SqlError")
        except sqlsandbox.SqlError as e:
            assert "time limit" in str(e) or "MB of memory" in str(e)
    finally:
        box.close()
    # the memory cap itself, in a child process (hard_heap_limit is process-wide and can only be lowered)
    code = (f"import sys; sys.path.insert(0, {str(Path(sqlsandbox.__file__).parents[1])!r})\n"
            "from bay import sqlsandbox as s\n"
            "s.HEAP_BYTES = 6 * 1024 * 1024\n"
            f"b = s.Sandbox({str(dbfile(p))!r}, time_ms=20000)\n"
            "try:\n"
            "    b.run(\"SELECT group_concat(t) FROM (SELECT a.text || b.text || c.text AS t FROM v_items a, v_items b, "
            "v_items c ORDER BY t DESC)\")\n"
            "    print('NO ERROR')\n"
            "except s.SqlError as e:\n"
            "    print('ERR', e)\n")
    r = subprocess.run([sys.executable, "-c", code], capture_output=True, text=True, timeout=60)
    assert r.returncode == 0 and r.stdout.startswith("ERR"), (r.stdout, r.stderr[-500:])
    assert "MB of memory" in r.stdout or "exceeded" in r.stdout, r.stdout
