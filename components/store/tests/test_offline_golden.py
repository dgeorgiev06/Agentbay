"""Golden baseline of feed-briefing and mail-briefing on the offline sources, under the fixed clock."""
from __future__ import annotations

import json

import yaml
from helpers import KIT, clock, system, tmpdir

from bay import dispatch

GOLDEN = KIT / "components" / "store" / "tests" / "golden"


def project(cfg: dict | None = None):
    p = tmpdir() / "proj"
    p.mkdir()
    (p / "agentbay.config.yaml").write_text(yaml.safe_dump({"apiVersion": "agentbay/v4", "offline": True,
                                                            **(cfg or {})}))
    return p


def sql(d, unit, q):
    return d.use(unit, "items.store/v2.sql", {"sql": q, "limit": 50})


def collect(mode: str, unit: str, cfg: dict, reads: dict) -> dict:
    p = project(cfg)
    d = dispatch.Dispatcher(system(p), p, clock=clock)
    r = d.call(f"{mode}.sync", {})
    assert r["status"] == "done", r
    out = {"sync": r["output"],
           "describe": d.use(unit, "items.store/v2.describe", {}),
           "status": d.use(unit, "items.store/v2.status", {})}
    out["sql"] = {name: sql(d, unit, q) for name, q in reads["sql"].items()}
    for name, (endpoint, args) in reads.get("use", {}).items():
        out[name] = d.use(unit, endpoint, args)
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
    generic_names(got)
    if deltas:
        deltas(want, got)
    else:
        assert got == want, f"{mode}: output differs from {f.relative_to(KIT)}"


def generic_names(got: dict) -> None:
    """Decision (e) of proposal 0008, item 3: the two changes both modes show; the golden files carry them."""
    cols = {c["name"]: c["description"] for v in got["describe"]["views"] if v["name"] == "v_items"
            for c in v["columns"]}
    assert cols["source"] == "name of the source that produced it"
    assert cols["kind"] == "the content type of the item"
    assert cols["title"] == "subject or headline (null when the kind has none)"
    for budget in (got["status"]["budget"], got["sync"]["budget"]):
        assert budget["items"] == got["sync"]["billed"] and "posts" not in budget
        assert budget["costPerItemUsd"] == 0.005 and "costPerPostUsd" not in budget


def mail_deltas(want: dict, got: dict) -> None:
    """The documented changes of mail-briefing's describe and the key of its `rows` read; the rest must match exactly."""
    want, got = json.loads(json.dumps(want)), json.loads(json.dumps(got))
    assert want["sql"]["v_posts"]["rows"] == [[0]]
    assert "v_posts" in got["sql"]["v_posts"]["error"] and got["sql"]["v_posts"]["rows"] == []
    del want["sql"]["v_posts"], got["sql"]["v_posts"]
    by = {v["name"]: v for v in want["describe"]["views"]}
    del by["v_posts"]
    assert [v["name"] for v in got["describe"]["views"]] == [
        "v_items", "v_email", "v_attachments", "v_threads", "v_fts", "v_attachment_fts"]
    assert {v["name"]: v for v in got["describe"]["views"]} == by
    del want["describe"]["views"], got["describe"]["views"]
    assert "addr_key" in want["describe"]["functions"]
    want["describe"]["functions"].remove("addr_key")
    assert want["threads"]["threads"] == got["threads"]["rows"]
    del want["threads"]["threads"], got["threads"]["rows"]
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
        "use": {"threads": ("items.store/v2.rows", {"name": "threads", "since": "30d", "important": ["*@partner.example"]})}})
    compare("mail-briefing", got, mail_deltas)
