"""Golden baseline of feed-briefing and mail-briefing on the offline sources (proposal 0008, slice 5): the sync
output, `describe` and `status` of the store, and a fixed set of reads, all under the fixed clock. The reference
is tests/golden/<mode>.json, generated from the code as it was before content types moved out of the core. A
failing compare means a behavior changed: there is no update switch, change the code back or explain the delta.
A missing file is written once and the test fails, so a new golden is always a visible new file in git."""
from __future__ import annotations

import json

import yaml
from helpers import KIT, clock, system, tmpdir

from bay import dispatch

GOLDEN = KIT / "tests" / "golden"


def project(cfg: dict | None = None):
    p = tmpdir() / "proj"
    p.mkdir()
    (p / "agentbay.config.yaml").write_text(yaml.safe_dump({"apiVersion": "agentbay/v2", "offline": True,
                                                            **(cfg or {})}))
    return p


def sql(d, unit, q):
    return d.use(unit, "items.store/v1.sql", {"sql": q, "limit": 50})


def collect(mode: str, unit: str, cfg: dict, reads: dict) -> dict:
    p = project(cfg)
    d = dispatch.Dispatcher(system(p), p, clock=clock)
    r = d.call(f"{mode}.sync", {})
    assert r["status"] == "done", r
    out = {"sync": r["output"],
           "describe": d.use(unit, "items.store/v1.describe", {}),
           "status": d.use(unit, "items.store/v1.status", {})}
    out["sql"] = {name: sql(d, unit, q) for name, q in reads["sql"].items()}
    for name, (endpoint, args) in reads.get("use", {}).items():
        out[name] = d.use(unit, endpoint, args)
    # nothing machine-specific in the reference: the project folder is replaced
    return json.loads(json.dumps(out, sort_keys=True).replace(str(p), "<project>"))


def compare(mode: str, got: dict, deltas=None) -> None:
    f = GOLDEN / f"{mode}.json"
    text = json.dumps(got, indent=1, sort_keys=True, ensure_ascii=False) + "\n"
    if not f.exists():
        GOLDEN.mkdir(exist_ok=True)
        f.write_text(text)
        raise AssertionError(f"{f} did not exist and was written from the current code; review it, commit it, "
                             f"and run again")
    want = json.loads(f.read_text())
    if deltas:
        deltas(want, got)
    else:
        assert got == want, f"{mode}: output differs from {f.relative_to(KIT)}"


def mail_deltas(want: dict, got: dict) -> None:
    """The three documented changes of mail-briefing's describe (proposal 0008, item 3, decision (a)); the golden
    file stays as it was and everything else must match it exactly."""
    want, got = json.loads(json.dumps(want)), json.loads(json.dumps(got))
    # 1. no v_posts: the store holds the content types the mode reads, and v_posts had no rows here
    assert want["sql"]["v_posts"]["rows"] == [[0]]
    assert "v_posts" in got["sql"]["v_posts"]["error"] and got["sql"]["v_posts"]["rows"] == []
    del want["sql"]["v_posts"], got["sql"]["v_posts"]
    by = {v["name"]: v for v in want["describe"]["views"]}
    del by["v_posts"]
    # 3. views ordered: base view, the type's views, full-text views (compare the views as a name-keyed map)
    assert [v["name"] for v in got["describe"]["views"]] == [
        "v_items", "v_email", "v_attachments", "v_threads", "v_fts", "v_attachment_fts"]
    assert {v["name"]: v for v in got["describe"]["views"]} == by
    del want["describe"]["views"], got["describe"]["views"]
    # 2. no addr_key function: fromMe, toMe and bulk are stored
    assert "addr_key" in want["describe"]["functions"]
    want["describe"]["functions"].remove("addr_key")
    assert got == want


def test_feed_briefing_offline_golden():
    got = collect("feed-briefing", "analyst--feed-briefing", {}, {"sql": {
        "v_posts": "SELECT id, likes, reposts, replies, lang FROM v_posts ORDER BY id",
        "v_items": "SELECT id, kind, author, createdAt, matched FROM v_items ORDER BY id",
        "v_fts": "SELECT id, snippet FROM v_fts WHERE fts MATCH 'staking' ORDER BY rank, id"}})
    compare("feed-briefing", got)


def test_mail_briefing_offline_golden():
    cfg = {"modes": {"mail-briefing": {"important": ["*@partner.example"]}}}
    got = collect("mail-briefing", "analyst--mail-briefing", cfg, {
        "sql": {
            "v_email": "SELECT id, fromMe, toMe, bulk, hasAttachments, attachmentCount FROM v_email ORDER BY id",
            "v_threads": "SELECT threadId, needsReply, lastBulk, lastFromMe, lastToMe, messages FROM v_threads "
                         "ORDER BY threadId",
            "v_attachments": "SELECT id, n, name, mime, size, textChars, reason FROM v_attachments ORDER BY id, n",
            "v_attachment_fts": "SELECT id, name, snippet FROM v_attachment_fts WHERE fts MATCH 'commitment' "
                                "ORDER BY rank, id",
            "v_posts": "SELECT count(*) FROM v_posts"},
        "use": {"threads": ("items.store/v1.threads", {"since": "30d", "important": ["*@partner.example"]})}})
    compare("mail-briefing", got, mail_deltas)
