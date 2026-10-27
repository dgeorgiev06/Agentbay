"""local-store via the fake source: dedup, lookback/coverage, budget caps, prune + deletions."""
import json
from datetime import timedelta

from helpers import NOW, clock, project, system

from bay import connect


def store(p, caps=None, settings=None, now=clock, fixture=None):
    if fixture is not None:
        (p / "fx.json").write_text(json.dumps(fixture))
        cfgp = p / "agentbay.config.yaml"
        import yaml
        cfg = yaml.safe_load(cfgp.read_text())
        cfg.setdefault("connectors", {})["fake"] = {"fixture": "fx.json"}
        cfgp.write_text(yaml.safe_dump(cfg))
    s = system(p)
    return connect.instantiate(s, "local-feeds", "local-store", "feed.store/v1", p, caps=caps or {},
                               settings={"lookbackMax": "30d", **(settings or {})}, clock=now)


def lines(p):
    return [json.loads(x) for x in (p / ".agentbay/data/feeds/posts.jsonl").read_text().splitlines()]


def test_sync_dedups_and_is_incremental():
    p = project()
    out = store(p).sync(lookback="3d")
    assert out["added"] == 7 and out["fetched"] == 7 and out["coverage"]["complete"]
    st = store(p)
    out2 = st.sync(lookback="3d")
    assert out2["added"] == 0 and out2["fetched"] == 0 and out2["sources"]["fake"]["mode"] == "since_id"
    assert st.ctx.sources["fake"].calls[0]["sinceId"] == "1009"
    keys = [f"{x['source']}:{x['id']}" for x in lines(p)]
    assert len(keys) == len(set(keys)) == 7


def test_lookback_beyond_api_window_is_reported_and_coverage_gap_stated():
    p = project()
    out = store(p).sync(lookback="10d")
    assert any("longer than the source API serves (7d)" in w for w in out["warnings"])
    assert out["coverage"]["from"] == "2026-10-20T12:00:00Z" and out["coverage"]["complete"] is False
    assert "only covers from" in out["coverage"]["note"]
    q = store(p).query(since="10d")
    assert q["coverage"]["complete"] is False
    q = store(p).query(since="2d")
    assert q["coverage"]["complete"] is True and len(q["posts"]) == 5


def test_lookback_max_enforced():
    p = project()
    try:
        store(p).sync(lookback="45d")
        raise AssertionError("expected StoreError")
    except Exception as e:
        assert "exceeds the mode's lookbackMax 30d" in str(e)


def test_query_filters():
    p = project()
    store(p).sync(lookback="7d")
    st = store(p)
    assert {x["author"]["handle"] for x in st.query(author="@vitalik")["posts"]} == {"vitalik"}
    assert [x["id"] for x in st.query(text="STAKING", limit=2)["posts"]] == ["1008", "1007"]
    win = st.query(since="2026-10-26T12:00:00Z", until="10h")["posts"]
    assert [x["id"] for x in win] == ["1006"]   # 24h..10h ago
    created = [x["createdAt"] for x in st.query()["posts"]]
    assert created == sorted(created, reverse=True)


def test_budget_caps_stop_and_report():
    p = project()
    out = store(p, caps={"maxPostsPerRun": 3}).sync(lookback="3d")
    assert out["fetched"] == 3 and "maxPostsPerRun cap reached" in out["stopped"]
    assert out["coverage"]["complete"] is False   # older part of the window was not fetched
    p = project()
    out = store(p, caps={"spendUsd": 0.02, "costPerPostUsd": 0.005}).sync(lookback="3d")
    assert out["fetched"] == 4 and "spendUsd" in out["stopped"] and out["budget"]["usd"] == 0.02
    out = store(p, caps={"spendUsd": 0.02, "costPerPostUsd": 0.005}).sync(lookback="3d")
    assert out["fetched"] == 0 and "spendUsd cap reached: nothing fetched" in out["stopped"]
    p = project()
    store(p, caps={"monthlyPosts": 5}).sync(lookback="3d")
    out = store(p, caps={"monthlyPosts": 5}).sync(lookback="3d")
    assert out["fetched"] == 0 and "monthlyPosts" in out["stopped"]
    # a new month resets usage
    nxt = lambda: NOW + timedelta(days=10)
    out = store(p, caps={"monthlyPosts": 5}, now=nxt).sync(lookback="3d")
    assert out["budget"]["month"] == "2026-11" and out["stopped"] is None
    assert out["budget"]["posts"] == out["fetched"]           # usage counted for the new month only


def test_gap_after_capped_run_refetches_window():
    p = project()
    store(p, caps={"maxPostsPerRun": 2}).sync(lookback="3d")
    st = store(p)
    out = st.sync(lookback="3d")
    assert st.ctx.sources["fake"].calls[0]["startTime"] is not None    # coverage gap -> refetch by time
    assert out["coverage"]["complete"] is True and len(lines(p)) == 7


def test_prune_retention_and_deletions():
    p = project()
    store(p).sync(lookback="7d")
    out = store(p).prune(olderThan="2d", deletedIds=["fake:1009"])
    assert out["deleted"] == 1 and out["remaining"] == 4
    ids = {x["id"] for x in lines(p)}
    assert "1009" not in ids and "1004" not in ids
    st = json.loads((p / ".agentbay/data/feeds/state.json").read_text())
    assert "fake:1009" in st["deleted"] and st["coverage"]["from"] == "2026-10-25T12:00:00Z"
    store(p).sync(lookback="1d")   # a deleted post is never re-stored
    assert "1009" not in {x["id"] for x in lines(p)}


def test_source_reported_deletions_are_honored_on_sync():
    p = project()
    store(p).sync(lookback="3d")
    assert "1008" in {x["id"] for x in lines(p)}
    import yaml
    cfg = yaml.safe_load((p / "agentbay.config.yaml").read_text())
    cfg["connectors"] = {"fake": {"deleted": ["1008"]}}          # deleted at the source after the first sync
    (p / "agentbay.config.yaml").write_text(yaml.safe_dump(cfg))
    st = store(p)
    out = st.sync(lookback="3d")
    assert set(st.ctx.sources["fake"].calls[0]["checkIds"]) >= {"1008", "1009"}   # stored ids in the window
    assert out["deleted"] == 1 and "1008" not in {x["id"] for x in lines(p)}
    assert out["billed"] == out["sources"]["fake"]["checked"] - 1   # checks are billed; the missing one is not
    state = json.loads((p / ".agentbay/data/feeds/state.json").read_text())
    assert "fake:1008" in state["deleted"]


def test_budget_counts_reads_not_kept_posts():
    p = project()
    store(p).sync(lookback="3d")
    out = store(p, caps={"maxPostsPerRun": 4}).sync(lookback="3d")
    # nothing new on the timeline, but re-checking 2 stored posts (50% of 4) is billed
    assert out["fetched"] == 0 and out["billed"] == 2 and out["budget"]["posts"] == 7 + 2


def test_connector_without_source_is_rejected():
    p = project()
    s = system(p)
    from bay import connect
    st = connect.instantiate(s, "local-feeds", "local-store", "feed.store/v1", p, settings={}, clock=clock)
    st.ctx.sources["fake"].ctx.source_id = None
    try:
        st.sync(lookback="1d")
        raise AssertionError("expected StoreError")
    except Exception as e:
        assert "declares no `source`" in str(e)


def test_store_writes_only_inside_env_write_path():
    p = project()
    store(p).sync(lookback="3d")
    written = sorted(str(x.relative_to(p)) for x in p.rglob("*") if x.is_file())
    assert written == [".agentbay/data/feeds/posts.jsonl", ".agentbay/data/feeds/state.json", "agentbay.config.yaml"]


def test_corrupt_line_error_names_file_and_line():
    p = project()
    store(p).sync(lookback="3d")
    f = p / ".agentbay/data/feeds/posts.jsonl"
    f.write_text(f.read_text() + "{not json\n")
    try:
        store(p).query()
        raise AssertionError("expected StoreError")
    except Exception as e:
        assert "posts.jsonl:8: corrupt line" in str(e)
