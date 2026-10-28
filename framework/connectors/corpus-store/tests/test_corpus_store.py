"""corpus-store via the fake source: dedup, lookback/coverage, budget caps, deletions, selectors
(native/local split, matched tags, re-match without refetch, backfill, prune), read endpoints."""
import json
import sqlite3
import sys
from datetime import timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[4] / "tests"))

from helpers import NOW, clock, project, system  # noqa: E402

from bay import connect  # noqa: E402

HOME = [{"id": "home", "in": "home"}]


def store(p, caps=None, settings=None, now=clock, fixture=None, env="local-feeds-offline"):
    if fixture is not None:
        (p / "fx.json").write_text(json.dumps(fixture))
        cfgp = p / "agentbay.config.yaml"
        import yaml
        cfg = yaml.safe_load(cfgp.read_text())
        cfg.setdefault("connectors", {})["fake"] = {"fixture": "fx.json"}
        cfgp.write_text(yaml.safe_dump(cfg))
    s = system(p)
    return connect.instantiate(s, env, "corpus-store", "items.store/v1", p, caps=caps or {},
                               settings={"lookbackMax": "30d", "selectors": HOME, "mode": "feed-briefing", **(settings or {})},
                               clock=now)


def db(p) -> Path:
    return p / ".agentbay/data/feeds/feed-briefing/corpus.db"


def rows(p, sql="SELECT source || ':' || ext_id AS id FROM items ORDER BY ext_id"):
    con = sqlite3.connect(db(p))
    con.row_factory = sqlite3.Row
    try:
        return [dict(r) for r in con.execute(sql)]
    finally:
        con.close()


def ids(p) -> set[str]:
    return {r["id"] for r in rows(p)}


def state(p) -> dict:
    return json.loads((p / ".agentbay/data/feeds/feed-briefing/state.json").read_text())


def test_schema_wal_user_version_fts_and_owner_only_file():
    p = project()
    store(p).sync(lookback="3d")
    con = sqlite3.connect(db(p))
    assert con.execute("PRAGMA journal_mode").fetchone()[0] == "wal"
    assert con.execute("PRAGMA user_version").fetchone()[0] == 1
    names = {r[0] for r in con.execute("SELECT name FROM sqlite_master")}
    assert {"items", "item_selectors", "items_fts", "items_ai", "items_ad", "items_au"} <= names
    assert "state" not in names                                    # internal state lives in state.json
    assert con.execute("SELECT count(*) FROM items_fts WHERE items_fts MATCH 'firedancer'").fetchone()[0] == 1
    con.execute("UPDATE items SET body = 'renamed to frankendancer' WHERE ext_id = '1008'")   # trigger keeps FTS in step
    assert con.execute("SELECT count(*) FROM items_fts WHERE items_fts MATCH 'firedancer'").fetchone()[0] == 0
    con.close()
    assert db(p).stat().st_mode & 0o777 == 0o600
    assert (db(p).parent / "state.json").stat().st_mode & 0o777 == 0o600
    con = sqlite3.connect(db(p))                    # a writer brings up -wal and -shm: same mode as the file
    con.execute("BEGIN IMMEDIATE")
    con.execute("UPDATE items SET title = 'x' WHERE ext_id = '1009'")
    side = [Path(str(db(p)) + x) for x in ("-wal", "-shm")]
    assert all(f.exists() and f.stat().st_mode & 0o777 == 0o600 for f in side), [oct(f.stat().st_mode) for f in side]
    con.rollback()
    con.close()


def test_newer_schema_is_refused_with_the_fix():
    p = project()
    store(p).sync(lookback="3d")
    con = sqlite3.connect(db(p))
    con.execute("PRAGMA user_version = 9")
    con.close()
    try:
        store(p).sync(lookback="3d")
        raise AssertionError("expected StoreError")
    except Exception as e:
        assert "schema v9 is newer than this kit (v1)" in str(e)


def test_sync_dedups_and_is_incremental():
    p = project()
    out = store(p).sync(lookback="3d")
    assert out["added"] == 7 and out["fetched"] == 7 and out["kept"] == 7 and out["coverage"]["complete"]
    st = store(p)
    out2 = st.sync(lookback="3d")
    assert out2["added"] == 0 and out2["fetched"] == 0
    assert out2["sources"]["fake"]["queries"][0]["mode"] == "cursor"
    call = st.ctx.sources["fake"].calls[0]
    assert call["cursor"] == "1009" and call["query"] == {"in": "home"}
    assert len(ids(p)) == 7


def test_lookback_beyond_api_window_is_reported_and_coverage_gap_stated():
    p = project()
    out = store(p).sync(lookback="10d")
    assert any("longer than the source API serves (7d)" in w for w in out["warnings"])
    assert out["coverage"]["from"] == "2026-10-20T12:00:00Z" and out["coverage"]["complete"] is False
    assert "only covers from" in out["coverage"]["note"]
    assert store(p).query(since="10d")["coverage"]["complete"] is False
    q = store(p).query(since="2d")
    assert q["coverage"]["complete"] is True and len(q["items"]) == 5


def test_lookback_max_enforced():
    try:
        store(project()).sync(lookback="45d")
        raise AssertionError("expected StoreError")
    except Exception as e:
        assert "exceeds the mode's lookbackMax 30d" in str(e)


def test_query_filters():
    p = project()
    store(p).sync(lookback="7d")
    st = store(p)
    assert {x["author"]["handle"] for x in st.query(author="@vitalik")["items"]} == {"vitalik"}
    assert [x["id"] for x in st.query(text="STAKING", limit=2)["items"]] == ["fake:1008", "fake:1007"]
    assert [x["id"] for x in st.query(since="2026-10-26T12:00:00Z", until="10h")["items"]] == ["fake:1006"]
    created = [x["createdAt"] for x in st.query()["items"]]
    assert created == sorted(created, reverse=True)
    it = st.query(ids=["fake:1008"])["items"][0]
    assert it["matched"] == ["home"] and it["kind"] == "post" and it["extId"] == "1008"


def test_budget_caps_stop_and_report():
    p = project()
    out = store(p, caps={"maxPostsPerRun": 3}).sync(lookback="3d")
    assert out["fetched"] == 3 and "maxPostsPerRun cap reached" in out["stopped"]
    assert out["coverage"]["complete"] is False
    p = project()

    def priced(**kw):                      # the fake source is free; price it like a paid API for this test
        st = store(p, **kw)
        st.ctx.sources["fake"].ctx.cost_per_post = None
        return st
    out = priced(caps={"spendUsd": 0.02, "costPerPostUsd": 0.005}).sync(lookback="3d")
    assert out["fetched"] == 4 and "spendUsd" in out["stopped"] and out["budget"]["usd"] == 0.02
    out = priced(caps={"spendUsd": 0.02, "costPerPostUsd": 0.005}).sync(lookback="3d")
    assert out["fetched"] == 0 and "spendUsd cap reached: nothing fetched" in out["stopped"]
    p = project()
    store(p, caps={"monthlyPosts": 5}).sync(lookback="3d")
    out = store(p, caps={"monthlyPosts": 5}).sync(lookback="3d")
    assert out["fetched"] == 0 and "monthlyPosts" in out["stopped"]
    out = store(p, caps={"monthlyPosts": 5}, now=lambda: NOW + timedelta(days=10)).sync(lookback="3d")
    assert out["budget"]["month"] == "2026-11" and out["stopped"] is None
    assert out["budget"]["posts"] == out["billed"]


def test_gap_after_capped_run_refetches_window():
    p = project()
    store(p, caps={"maxPostsPerRun": 2}).sync(lookback="3d")
    st = store(p)
    out = st.sync(lookback="3d")
    assert st.ctx.sources["fake"].calls[0]["since"] is not None      # coverage gap -> refetch by time
    assert out["coverage"]["complete"] is True and len(ids(p)) == 7


def test_prune_retention_and_deletions():
    p = project()
    store(p).sync(lookback="7d")
    out = store(p).prune(olderThan="2d", deletedIds=["fake:1009"])
    assert out["deleted"] == 1 and out["remaining"] == 4 and out["cutoff"] == "2026-10-25T12:00:00Z"
    assert "fake:1009" not in ids(p) and "fake:1004" not in ids(p)
    st = state(p)
    assert "fake:1009" in st["deleted"] and st["coverage"]["from"] == "2026-10-25T12:00:00Z"
    store(p).sync(lookback="1d")   # a deleted item is never re-stored
    assert "fake:1009" not in ids(p)
    assert rows(p, "SELECT count(*) AS n FROM item_selectors")[0]["n"] == 4      # tags follow deletes


def test_source_reported_deletions_are_honored_on_sync():
    p = project()
    store(p).sync(lookback="3d")
    import yaml
    cfg = yaml.safe_load((p / "agentbay.config.yaml").read_text())
    cfg["connectors"] = {"fake": {"deleted": ["1008"]}}
    (p / "agentbay.config.yaml").write_text(yaml.safe_dump(cfg))
    st = store(p)
    out = st.sync(lookback="3d")
    assert set(st.ctx.sources["fake"].calls[0]["checkIds"]) >= {"1008", "1009"}
    assert out["deleted"] == 1 and "fake:1008" not in ids(p)
    assert out["billed"] == out["sources"]["fake"]["checked"] - 1
    assert "fake:1008" in state(p)["deleted"]


def test_budget_counts_reads_not_kept_items():
    p = project()
    store(p).sync(lookback="3d")
    out = store(p, caps={"maxPostsPerRun": 4}).sync(lookback="3d")
    assert out["fetched"] == 0 and out["billed"] == 2 and out["budget"]["posts"] == 7 + 2


def test_deletion_checks_are_reserved_and_only_checked_ids_are_marked():
    p = project()
    store(p).sync(lookback="3d")
    st = store(p, caps={"maxPostsPerRun": 6})
    out = st.sync(lookback="3d")
    call = st.ctx.sources["fake"].calls[0]
    assert len(call["checkIds"]) == 3 and call["maxItems"] == 3
    assert sorted(state(p)["checked"]) == sorted(f"fake:{i}" for i in call["checkIds"])
    st = store(p, caps={"maxPostsPerRun": 6})
    real = st.ctx.sources["fake"].fetch
    st.ctx.sources["fake"].fetch = lambda **kw: {**real(**kw), "checked": kw.get("checkIds", [])[:1]}
    st.sync(lookback="3d")
    assert len(state(p)["checked"]) == 4 and out["billed"] == 3


def test_connector_without_source_or_with_foreign_ids_is_rejected():
    p = project()
    st = store(p)
    st.ctx.sources["fake"].ctx.source_id = None
    try:
        st.sync(lookback="1d")
        raise AssertionError("expected StoreError")
    except Exception as e:
        assert "declares no `source`" in str(e)
    st = store(p)
    real = st.ctx.sources["fake"].fetch

    def foreign(**kw):
        out = real(**kw)
        return {**out, "items": [{**out["items"][0], "id": "x:1"}, *out["items"][1:]]}
    st.ctx.sources["fake"].fetch = foreign
    try:
        st.sync(lookback="1d")
        raise AssertionError("expected StoreError")
    except Exception as e:
        assert "ids must be 'fake:<extId>'" in str(e)
    assert ids(p) == set()                            # one transaction: nothing half-written


def test_store_writes_only_inside_env_write_path():
    p = project()
    store(p).sync(lookback="3d")
    written = sorted(str(x.relative_to(p)) for x in p.rglob("*") if x.is_file())
    assert written[-1] == "agentbay.config.yaml"
    assert set(written[:-1]) == {".agentbay/data/feeds/feed-briefing/corpus.db",
                                 ".agentbay/data/feeds/feed-briefing/state.json"}


def test_reads_never_write_the_store_or_state():
    p = project()
    store(p).sync(lookback="3d")
    con = sqlite3.connect(db(p))
    con.execute("PRAGMA wal_checkpoint(TRUNCATE)")
    con.close()
    before = db(p).read_bytes()
    st_before = (p / ".agentbay/data/feeds/feed-briefing/state.json").read_bytes()
    st = store(p)
    assert len(st.query()["items"]) == 7
    st.describe(), st.search("staking"), st.facets("author"), st.get(["fake:1008"]), st.thread("fake:1008")
    st.status(), st.sql("SELECT count(*) FROM v_fts")
    assert db(p).read_bytes() == before
    assert (p / ".agentbay/data/feeds/feed-briefing/state.json").read_bytes() == st_before


def test_status_counts_from_sqlite_and_reports_selectors_and_engine():
    p = project()
    store(p).sync(lookback="7d")
    st = store(p).status()
    assert st["count"] == 8 and st["selectors"] == {"home": 8} and st["engine"] == "fts5" and st["stale"] is False
    assert store(p, settings={"selectors": [{"id": "all"}]}).status()["stale"] is True


# ------------------------------------------------------------------ selectors
FX = [{"id": "11", "handle": "vitalik", "text": "PeerDAS on mainnet soon", "ageHours": 2},
      {"id": "12", "handle": "lido", "text": "Staking module update", "ageHours": 3, "list": "9"},
      {"id": "13", "handle": "spam", "text": "Staking giveaway, click", "ageHours": 4},
      {"id": "14", "handle": "vitalik", "text": "Staking and decentralization", "ageHours": 30}]


def test_native_query_and_local_filter_with_matched_tags():
    p = project()
    sels = [{"id": "staking", "in": "home", "text": "staking", "not": {"from": "spam"}},
            {"id": "vitalik", "from": "vitalik"}]
    st = store(p, settings={"selectors": sels}, fixture=FX)
    out = st.sync(lookback="3d")
    calls = st.ctx.sources["fake"].calls
    assert [c["query"] for c in calls] == [{"in": "home"}, {"from": "vitalik"}]   # text/not stay local
    tags = {r["id"]: r for r in st.query()["items"]}
    assert tags["fake:12"]["matched"] == ["staking"] and tags["fake:14"]["matched"] == ["staking", "vitalik"]
    assert tags["fake:11"]["matched"] == ["vitalik"] and "fake:13" not in tags          # `not` excluded it
    assert out["fetched"] == 6 and out["kept"] == 5
    assert ids(p) == {"fake:11", "fake:12", "fake:14"}
    assert [x["id"] for x in st.query(selector="vitalik")["items"]] == ["fake:11", "fake:14"]


def test_selector_change_rematches_without_refetch_and_new_selector_backfills():
    p = project()
    store(p, fixture=FX).sync(lookback="3d")
    assert ids(p) == {"fake:11", "fake:12", "fake:13", "fake:14"}
    # narrow: same native query (in: home), local text filter -> re-match only, cursor kept
    sels = [{"id": "home", "in": "home", "text": "staking"}]
    st = store(p, settings={"selectors": sels})
    assert st.status()["stale"] is True
    out = st.sync(lookback="3d")
    assert out["rematched"] == 1 and out["fetched"] == 0
    assert st.ctx.sources["fake"].calls[0]["cursor"] == "14"           # nothing refetched
    assert [x["id"] for x in st.query()["items"]] == ["fake:12", "fake:13", "fake:14"]
    # a new selector with its own native query backfills the lookback window
    sels2 = sels + [{"id": "lists", "in": "list:9"}]
    st = store(p, settings={"selectors": sels2})
    st.sync(lookback="3d")
    lst = [c for c in st.ctx.sources["fake"].calls if c["query"] == {"in": "list:9"}][0]
    assert lst["cursor"] is None and lst["since"] == "2026-10-24T12:00:00Z"
    item = st.query(ids=["fake:12"])["items"][0]
    assert item["matched"] == ["home", "lists"] and item["labels"] == ["home", "list:9"]
    # joining an existing native query also backfills (its cursor would skip older items)
    sels3 = sels2 + [{"id": "everything", "in": "home"}]
    st = store(p, settings={"selectors": sels3})
    out = st.sync(lookback="3d")
    home = [c for c in st.ctx.sources["fake"].calls if c["query"] == {"in": "home"}][0]
    assert home["cursor"] is None and home["since"] is not None
    assert [q["mode"] for q in out["sources"]["fake"]["queries"]] == ["backfill", "cursor"]
    assert "fake:11" in {x["id"] for x in st.query(selector="everything")["items"]}


def test_removed_selector_items_leave_the_store_at_once_without_refetch():
    sels = [{"id": "home", "in": "home", "not": {"text": "staking"}}, {"id": "staking", "in": "home", "text": "staking"}]
    keep = [sels[0]]
    p = project()
    store(p, settings={"selectors": sels}, fixture=FX).sync(lookback="3d")
    assert len(ids(p)) == 4
    st = store(p, settings={"selectors": keep})
    out = st.sync(lookback="3d")
    assert out["outOfScope"] == 3 and out["fetched"] == 0 and ids(p) == {"fake:11"}       # gone, not hidden
    assert st.ctx.sources["fake"].calls[0]["cursor"] == "14"                               # kept item: no refetch
    con = sqlite3.connect(db(p))
    assert con.execute("SELECT count(*) FROM items_fts").fetchone()[0] == 1                # FTS follows
    con.close()
    # prune alone applies a selector change too
    p = project()
    store(p, settings={"selectors": sels}, fixture=FX).sync(lookback="3d")
    out = store(p, settings={"selectors": keep}).prune(olderThan="30d")
    assert out["unmatched"] == 3 and ids(p) == {"fake:11"}


def plant(p, rows_):
    """Rows written straight into the store, bypassing sync (the FTS triggers index them)."""
    con = sqlite3.connect(db(p))
    try:
        for src, xid, body, tag in rows_:
            pk = con.execute("INSERT INTO items (source, ext_id, kind, author, body, created_at, fetched_at) VALUES "
                             "(?, ?, 'post', 'eve', ?, '2026-10-27T11:30:00Z', '2026-10-27T12:00:00Z')",
                             (src, xid, body)).lastrowid
            if tag:
                con.execute("INSERT INTO item_selectors (item, selector) VALUES (?, ?)", (pk, tag))
        con.commit()
    finally:
        con.close()


def test_out_of_scope_rows_are_deleted_by_sync_and_prune():
    for run in ("sync", "prune"):
        p = project()
        store(p).sync(lookback="3d")
        plant(p, [("x", "900", "acquisition zebra unbound source", "home"),       # source not bound offline
                  ("fake", "901", "acquisition zebra no tag", None),             # matches no selector
                  ("fake", "902", "acquisition zebra removed selector", "gone")])  # tagged by a removed selector
        st = store(p)
        out = st.sync(lookback="3d") if run == "sync" else st.prune(olderThan="30d")
        if run == "prune":
            assert out["unbound"] == 1 and out["unmatched"] == 2
        else:
            assert out["outOfScope"] == 3
        assert not {"x:900", "fake:901", "fake:902"} & ids(p) and len(ids(p)) == 7, run
        con = sqlite3.connect(db(p))
        try:
            assert con.execute("SELECT count(*) FROM items_fts WHERE items_fts MATCH 'zebra'").fetchone()[0] == 0
            assert con.execute("SELECT count(*) FROM items_fts").fetchone()[0] == 7
            assert con.execute("SELECT count(*) FROM item_selectors WHERE selector != 'home'").fetchone()[0] == 0
        finally:
            con.close()


def test_unbinding_a_source_removes_its_items_and_cursors():
    p = project()
    store(p).sync(lookback="3d")
    assert len(ids(p)) == 7 and any(k.startswith("fake|") for k in state(p)["cursors"])
    online = store(p, env="local-feeds")                      # x-api bound instead of the fake source
    assert online.status()["stale"] is True                   # the next sync changes the scope
    out = online.prune(olderThan="30d")
    assert out["unbound"] == 7 and ids(p) == set() and not any(k.startswith("fake|") for k in state(p)["cursors"])
    assert state(p)["sources"] == ["x"]


# ------------------------------------------------------------------ read endpoints
def test_get_thread_facets_search_describe():
    p = project()
    store(p).sync(lookback="7d")
    st = store(p)
    g = st.get(["fake:1008", "fake:nope"])
    assert [i["id"] for i in g["items"]] == ["fake:1008"] and g["missing"] == ["fake:nope"]
    assert [i["id"] for i in st.thread("fake:1008")["items"]] == ["fake:1008"]
    con = sqlite3.connect(db(p))
    con.execute("UPDATE items SET thread_id = 't1' WHERE ext_id IN ('1006', '1009')")
    con.commit()
    con.close()
    th = st.thread("fake:1009")
    assert th["threadId"] == "t1" and [i["id"] for i in th["items"]] == ["fake:1006", "fake:1009"]
    assert st.facets("author")["values"][0] == {"value": "custody_news", "count": 2}   # ties by name
    assert st.facets("selector")["values"] == [{"value": "home", "count": 8}]
    assert len(st.facets("day", since="1d")["values"]) == 2
    s = st.search("staking yields")
    assert s["engine"] == "fts5" and [i["id"] for i in s["items"]] == ["fake:1008"] and "[" in s["items"][0]["snippet"]
    d = st.describe()
    v = {x["name"]: x for x in d["views"]}
    assert v["v_items"]["rows"] == 8 and v["v_posts"]["rows"] == 8 and d["fts"]["available"] is True
    assert v["v_items"]["samples"]["matched"] == ["home"] and "load_extension" not in d["functions"]


def test_like_fallback_when_fts5_is_missing():
    from bay import sqlsandbox
    p = project()
    real = sqlsandbox.fts5_available
    sqlsandbox.fts5_available = lambda: False
    try:
        store(p).sync(lookback="7d")
    finally:
        sqlsandbox.fts5_available = real
    names = {r["name"] for r in rows(p, "SELECT name FROM sqlite_master")}
    assert "items_fts" not in names
    st = store(p)
    s = st.search("staking yields")
    assert s["engine"] == "like" and [i["id"] for i in s["items"]] == ["fake:1008"]
    assert st.status()["engine"] == "like" and st.describe()["fts"]["available"] is False
    err = st.sql("SELECT rowid FROM items_fts")["error"]
    assert "items_fts" in err and "v_items" in err


SECRETS = ("sk-ant-api03-ABCDEFGHIJKLMNOPQRSTUVWXYZ012345", "hunter2hunter2",
           "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c")


def test_every_stored_column_is_scrubbed_at_ingest():
    p = project()
    st = store(p)
    real = st.ctx.sources["fake"].fetch

    def planted(**kw):
        out = real(**kw)
        it = out["items"][0]
        it.update({"author": {"handle": f"h {SECRETS[0]}", "name": f"password={SECRETS[1]}"},
                   "title": SECRETS[2], "url": f"https://example.com/?access_token={SECRETS[0]}",
                   "container": f"home {SECRETS[0]}", "labels": ["home", f"api_key={SECRETS[0]}"],
                   "threadId": SECRETS[2], "metrics": {"like_count": 1},
                   "lang": f"secret={SECRETS[0]}"})
        return out
    st.ctx.sources["fake"].fetch = planted
    st.sync(lookback="3d")
    raw = db(p).read_bytes().decode("latin-1")
    for sec in SECRETS:
        assert sec not in raw and sec.upper() not in raw.upper()
    box = store(p)
    cols = ["id", "source", "extId", "kind", "author", "authorName", "title", "text", "url", "createdAt", "fetchedAt",
            "container", "labels", "threadId", "matched"]
    for c in cols:
        for f in ("hex({})", "upper({})", "{}"):
            out = json.dumps(box.sql(f"SELECT {f.format(c)} FROM v_items"))
            for sec in SECRETS:
                assert sec not in out and sec.upper() not in out.upper() and sec.encode().hex().upper() not in out
    out = json.dumps(box.sql("SELECT hex(lang), upper(metrics) FROM v_posts"))
    assert SECRETS[0] not in out and SECRETS[0].encode().hex().upper() not in out


def test_dict_keys_and_identity_fields_are_scrubbed_at_ingest():
    """A secret in a kind field's key (metrics) or in the source's own id (extId, so also id) never reaches
    corpus.db; the stored id stays <source>:<extId>, and a deletion reported for that raw id still applies."""
    p = project()
    st = store(p)
    real = st.ctx.sources["fake"].fetch
    leaky_id = f"77-password={SECRETS[1]}"

    def planted(**kw):
        out = real(**kw)
        a, b = out["items"][0], out["items"][1]
        a["metrics"] = {f"api_key={SECRETS[0]}": 1, "like_count": 2}
        b.update({"extId": leaky_id, "id": f"fake:{leaky_id}"})
        return out
    st.ctx.sources["fake"].fetch = planted
    st.sync(lookback="3d")
    raw = db(p).read_bytes().decode("latin-1")
    for sec in SECRETS[:2]:
        assert sec not in raw and sec.upper() not in raw.upper()
    rows_ = rows(p, "SELECT source || ':' || ext_id AS id, ext FROM items")
    leaky = [r for r in rows_ if r["id"].startswith("fake:77-")]
    assert len(leaky) == 1 and "[REDACTED:password]" in leaky[0]["id"]
    assert any('"api_key=[REDACTED:api-key]": 1' in r["ext"] and '"like_count": 2' in r["ext"] for r in rows_)
    got = store(p).query(ids=[leaky[0]["id"]])["items"]
    assert got and got[0]["id"] == f"fake:{got[0]['extId']}"                     # id rebuilt from the scrubbed parts
    for sec in SECRETS[:2]:
        assert sec not in json.dumps(store(p).sql("SELECT hex(id), hex(extId) FROM v_items"))
    st = store(p)                                                              # the source deletes the leaky item
    real = st.ctx.sources["fake"].fetch
    st.ctx.sources["fake"].fetch = lambda **kw: {**real(**kw), "deleted": [leaky_id]}
    st.sync(lookback="3d")
    assert not any(i.startswith("fake:77-") for i in ids(p))
    assert leaky[0]["id"] in state(p)["deleted"] and SECRETS[1] not in json.dumps(state(p))


def test_two_modes_on_one_env_keep_separate_stores():
    p = project()
    a = store(p, settings={"mode": "feed-briefing", "selectors": [{"id": "home"}]})
    b = store(p, settings={"mode": "news-briefing", "selectors": [{"id": "staking", "text": "staking"}]})
    a.sync(lookback="3d")
    b.sync(lookback="3d")
    base = p / ".agentbay/data/feeds"
    assert (base / "feed-briefing/corpus.db").exists() and (base / "news-briefing/corpus.db").exists()
    assert a.status()["selectors"] == {"home": 7} and b.status()["selectors"] == {"staking": 5}
    assert a.status()["stale"] is False and b.status()["stale"] is False     # neither re-tags the other
    try:
        store(p, settings={"mode": None})
        raise AssertionError("expected StoreError")
    except Exception as e:
        assert "one store per mode" in str(e)
