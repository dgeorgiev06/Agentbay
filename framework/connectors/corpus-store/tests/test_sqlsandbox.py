"""Adversarial tests for items.store/v1.sql (bay/sqlsandbox.py): nothing an agent sends can write, read
internal tables, run away, load code or leak a secret stored in an item; every refusal says what to change."""
import json
import sqlite3
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[4] / "tests"))

from helpers import clock, project, system  # noqa: E402

from bay import connect, sqlsandbox  # noqa: E402

SECRET_TEXT = ("rotate soon: sk-ant-api03-ABCDEFGHIJKLMNOPQRSTUVWXYZ012345 and password=hunter2hunter2 "
               "token eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c")


def setup(extra_fixture=None):
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
                             settings={"lookbackMax": "30d", "selectors": [{"id": "home", "in": "home"}]}, clock=clock)
    st.sync(lookback="3d")
    return p, st


def dbfile(p):
    return p / ".agentbay/data/feeds/corpus.db"


def snapshot(p):
    con = sqlite3.connect(dbfile(p))
    try:
        return (con.execute("SELECT count(*), group_concat(body) FROM items").fetchone(),
                con.execute("SELECT group_concat(key || value) FROM state").fetchone(),
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
    out = st.sql("SELECT v.id FROM items_fts JOIN v_items v ON v.rid = items_fts.rowid "
                 "WHERE items_fts MATCH '\"proof of stake\"' ORDER BY bm25(items_fts)")
    assert out["rows"] == [["fake:23"]]
    out = st.sql("WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 5) SELECT sum(i) FROM n")
    assert out["rows"] == [[15]]                          # bounded recursion is fine


def test_writes_and_ddl_are_refused():
    p, st = setup()
    before = snapshot(p)
    for sql in ("DELETE FROM items", "UPDATE items SET body = 'x'", "INSERT INTO state VALUES ('k', 'v')",
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
    refused(st, "PRAGMA table_info(state)", "PRAGMA")
    refused(st, "PRAGMA query_only = 0", "PRAGMA")
    refused(st, "SELECT * FROM pragma_table_info('state')", "pragma_table_info")
    refused(st, "SELECT load_extension('/tmp/evil.so')", "load_extension", "not allowed")
    refused(st, "SELECT randomblob(100000000)", "randomblob")
    refused(st, "SELECT printf('%.*c', 100000000, 'x')", "printf")
    refused(st, "SELECT sqlite_version()", "sqlite_version")
    assert snapshot(p) == before


def test_internal_tables_and_base_tables_are_unreadable():
    p, st = setup()
    for sql, name in (("SELECT * FROM state", "state"), ("SELECT value FROM state WHERE key = 'budget'", "state"),
                      ("SELECT * FROM main.state", "state"), ('SELECT * FROM "StAtE"', "StAtE"),
                      ("SELECT * FROM [state]", "state"), ("SELECT * FROM sqlite_master", "sqlite_master"),
                      ("SELECT * FROM sqlite_temp_master", "sqlite_temp_master"),
                      ("SELECT * FROM items", "items"), ("SELECT * FROM item_selectors", "item_selectors"),
                      ("SELECT * FROM v_items WHERE id IN (SELECT key FROM state)", "state"),
                      ("SELECT (SELECT value FROM state LIMIT 1) FROM v_items", "state"),
                      ("SELECT * FROM v_items UNION ALL SELECT key, value, 1,1,1,1,1,1,1,1,1,1,1,1,1,1 FROM state", "state")):
        err = refused(st, sql, "not allowed")
        assert name.lower() in err.lower() and "describe" in err
    refused(st, "SELECT * FROM main.v_items", "no such table")      # views are temp-only, limited to bound sources
    for sql in ("WITH v_items AS (SELECT * FROM items) SELECT * FROM v_items",
                "WITH v_posts AS (SELECT key FROM state) SELECT * FROM v_posts",
                "WITH items AS (SELECT 1) SELECT * FROM items",
                'WITH "V_ITEMS"(a, b) AS MATERIALIZED (SELECT pk, body FROM items) SELECT * FROM v_items',
                "WITH x AS (SELECT 1), [v_items]/* c */AS NOT MATERIALIZED(SELECT * FROM items) SELECT * FROM v_items",
                "WITH `v_items`\n--c\nAS (SELECT * FROM items) SELECT * FROM v_items"):
        refused(st, sql, "WITH clause may not be named")
    assert st.sql("WITH mine AS (SELECT id FROM v_items) SELECT count(*) FROM mine")["rows"] == [[3]]
    assert st.sql("SELECT count(*) FROM v_items WHERE text != 'v_items AS (x'")["rows"] == [[3]]   # strings are data


def test_runaway_queries_hit_the_time_limit():
    p, st = setup()
    box = sqlsandbox.Sandbox(dbfile(p), ["fake"], time_ms=300)
    try:
        for sql in ("WITH RECURSIVE r(n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM r) SELECT count(*) FROM r",
                    "SELECT count(*) FROM v_items a, v_items b, v_items c, v_items d, v_items e, v_items f, "
                    "v_items g, v_items h, v_items i, v_items j, v_items k, v_items l, v_items m, v_items n, v_items o"):
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
    err = refused(st, "SELECT rowid FROM items_fts WHERE items_fts MATCH '\"unterminated'", "MATCH", "double quotes")
    err2 = refused(st, "SELECT rowid FROM items_fts WHERE items_fts MATCH 'AND OR'", "MATCH")
    assert "proof of stake" in err and err2
    refused(st, "SELECT nope FROM v_items", "no such column", "describe")
    refused(st, "SELECT * FROM nowhere", "no such table", "v_items")


def test_missing_store_is_explained():
    p = project()
    st = connect.instantiate(system(p), "local-feeds-offline", "corpus-store", "items.store/v1", p,
                             settings={"selectors": [{"id": "home"}]}, clock=clock)
    assert "run the mode's sync endpoint first" in st.sql("SELECT 1")["error"]
    assert not dbfile(p).exists()                                     # reads never create the store
