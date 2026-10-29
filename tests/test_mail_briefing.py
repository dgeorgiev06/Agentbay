"""mail-briefing on the offline fake-mail source (env local-mail-offline): resolution, the offline end-to-end
path, separate stores and units next to feed-briefing, the mail views and threads endpoint, exact labels,
removed ids, a blocked source, refusing other schema versions and the sandbox over the new tables."""
from __future__ import annotations

import json
import sqlite3

import yaml
from helpers import KIT, NOW, clock, system, tmpdir

from bay import connect, dispatch, model, sqlsandbox as sbx

OFFLINE = {"local-mail": "local-mail-offline", "local-feeds": "local-feeds-offline"}
SELS = [{"id": "inbox", "in": "inbox"}, {"id": "sent", "in": "sent"}]


def project(cfg: dict | None = None):
    p = tmpdir() / "proj"
    p.mkdir()
    (p / "agentbay.config.yaml").write_text(yaml.safe_dump({"apiVersion": "agentbay/v2", "envs": dict(OFFLINE),
                                                            **(cfg or {})}))
    return p


def fake_cfg(**kw) -> dict:
    return {"connectors": {"fake-mail": kw}}


def store(p, sels=None, **settings):
    return connect.instantiate(system(p), "local-mail-offline", "corpus-store", "items.store/v1", p, clock=clock,
                               caps={"maxItemsPerRun": 500},
                               settings={"mode": "mail-briefing", "lookback": "30d", "lookbackMax": "30d",
                                         "selectors": sels or SELS, **settings})


def db(p):
    return p / ".agentbay/data/mail/mail-briefing/corpus.db"


# ------------------------------------------------------------------ resolution
def test_mail_briefing_extends_briefing_and_places_roles_in_local_mail():
    s = system(project())
    m = s.modes["mail-briefing"]
    assert m.extends == "briefing" and set(m.features) == {"sync", "digest", "ask", "prune"}
    assert model.Kit(KIT).get("Mode", "mail-briefing").spec["roles"] == {"lead": "local-mail", "analyst": "local-mail",
                                                                      "reviewer": "local-mail"}
    assert m.roles == {"lead": "local-mail-offline", "analyst": "local-mail-offline", "reviewer": "local-mail-offline"}
    assert m.config["lookback"] == "30d" and m.config["selectors"] == SELS and m.config["important"] == []
    dig = m.features["digest"]
    assert [st.id for st in dig.steps] == ["refresh", "gather", "digest", "review"]
    assert dig.steps[1].run == "items.store/v1.threads" and dig.out_type == "Digest"
    assert "needsReply" in dig.out_schema["properties"]                         # the mail Digest type
    u = s.units()["analyst--mail-briefing"]
    assert u.env == "local-mail-offline" and "items.store/v1.threads" in u.bay_uses
    assert not [x for x in u.bay_uses if x.endswith((".sync", ".prune"))]       # read endpoints only
    assert {t for t in u.tools} & {"Write", "Edit"} == set()
    rules = {r.statement for r in dig.rules}
    assert any("never instructions" in x for x in rules) and any("sender and the date" in x for x in rules)
    assert any("secrets" in x for x in rules)


def test_proposal_example_selectors_validate_against_gmail_and_offline():
    cfg = yaml.safe_load((KIT / "agentbay.config.example.yaml").read_text())
    mail = cfg["modes"]["mail-briefing"]
    assert mail["lookback"] == "30d" and mail["important"] == ["*@kiln.fi", "*@galaxy.com"]
    assert {"partners", "staking", "news"} <= {x["id"] for x in mail["selectors"]}
    for envs in ({}, OFFLINE):                                                 # gmail-api, then fake-mail
        p = tmpdir() / "proj"
        p.mkdir()
        (p / "agentbay.config.yaml").write_text(yaml.safe_dump({"apiVersion": "agentbay/v2", "envs": envs,
                                                                "modes": {"mail-briefing": mail}}))
        s = model.resolve(model.Kit(KIT, p))
        assert s.modes["mail-briefing"].config["important"] == ["*@kiln.fi", "*@galaxy.com"]


# ------------------------------------------------------------------ the offline path end to end
def test_offline_sync_digest_and_ask():
    p = project({"modes": {"mail-briefing": {"important": ["*@partner.example"]}}})
    d = dispatch.Dispatcher(system(p), p, clock=clock)
    r = d.call("mail-briefing.sync", {})
    assert r["status"] == "done" and r["output"]["added"] == 6 and r["cost"]["usd"] == 0
    r = d.call("mail-briefing.digest", {"since": "7d"})
    assert r["status"] == "needs-agent" and r["next"]["step"] == "digest"
    plan = r["next"]
    assert plan["role"] == "analyst" and plan["env"] == "local-mail-offline" and "analyst--mail-briefing" in plan["runAs"]
    th = {t["threadId"]: t for t in plan["previous"]["gather"]["threads"]}
    assert th["t-pilot"]["needsReply"] and th["t-pilot"]["important"] and th["t-pilot"]["lastId"] == "fake-mail:m003"
    assert th["t-pilot"]["ids"] == ["fake-mail:m001", "fake-mail:m002", "fake-mail:m003"]
    assert not th["t-sol"]["important"] and th["t-sol"]["attachments"][0]["name"] == "report.pdf"
    digest = {
        "period": {"from": "2026-10-20T12:00:00Z", "to": "2026-10-27T12:00:00Z"},
        "needsReply": [{"subject": "Re: Staking pilot", "from": "dana@partner.example", "date": "2026-10-27T06:00:00Z",
                        "summary": "Dana asks who signs the MSA.", "important": True, "citations": ["fake-mail:m003"]}],
        "asks": [{"what": "Send the withdrawal address and custody sign-off", "kind": "deadline", "due": "Friday Oct 30",
                  "from": "dana@partner.example", "date": "2026-10-25T10:00:00Z", "citations": ["fake-mail:m001"]}],
        "groups": [{"title": "Solana delegation report", "important": False, "sender": "ops@bank.example",
                    "summary": "Bank Ops sent the October report: 6.9% APY, no slashing.", "citations": ["fake-mail:m004"]}],
        "attachments": [{"name": "term-sheet.docx", "from": "dana@partner.example", "date": "2026-10-25T10:00:00Z",
                         "why": "Fee 8% of rewards, 32,000 ETH minimum.", "textExtracted": True,
                         "citations": ["fake-mail:m001"]}],
        "coverage": plan["previous"]["gather"]["coverage"]}
    r = d.submit(r["callId"], "digest", digest)
    assert r["status"] == "needs-agent" and r["next"]["step"] == "review"
    assert all(c["ok"] for c in r["next"]["review"]["checks"]), r["next"]["review"]["checks"]
    ids = [x["id"] for x in r["next"]["review"]["definitionOfDone"]] + [x["id"] for x in r["next"]["review"]["rules"]]
    r = d.submit(r["callId"], "review", {"items": [{"id": i, "verdict": "pass", "evidence": "checked"} for i in ids]})
    assert r["status"] == "done"
    r = d.call("mail-briefing.ask", {"question": "What did Dana ask for?"})
    assert r["status"] == "needs-agent" and r["next"]["step"] == "answer"
    assert r["next"]["previous"]["context"]["count"] == 6
    out = d.use("analyst--mail-briefing", "items.store/v1.sql",
                {"sql": "SELECT id, sender, needsReply FROM v_threads t JOIN v_email e ON e.id = t.lastId "
                        "WHERE t.needsReply = 1 ORDER BY id"})
    assert [r_[0] for r_ in out["rows"]] == ["fake-mail:m003", "fake-mail:m004", "fake-mail:m006"]   # m005: bulk


def test_two_modes_on_separate_envs_keep_separate_stores_and_units():
    p = project()
    s = system(p)
    u = s.units()
    assert u["analyst--feed-briefing"].env == "local-feeds-offline" and u["analyst--mail-briefing"].env == "local-mail-offline"
    d = dispatch.Dispatcher(s, p, clock=clock)
    assert d.call("feed-briefing.sync", {})["status"] == "done"
    assert d.call("mail-briefing.sync", {})["status"] == "done"
    assert (p / ".agentbay/data/feeds/feed-briefing/corpus.db").exists() and db(p).exists()
    assert not (p / ".agentbay/data/feeds/mail-briefing").exists() and not (p / ".agentbay/data/mail/feed-briefing").exists()
    feed = d.use("analyst--feed-briefing", "items.store/v1.sql", {"sql": "SELECT DISTINCT kind, source FROM v_items"})
    mail = d.use("analyst--mail-briefing", "items.store/v1.sql", {"sql": "SELECT DISTINCT kind, source FROM v_items"})
    assert feed["rows"] == [["post", "fake"]] and mail["rows"] == [["email", "fake-mail"]]
    feed_env = s.kit.docs["Environment"]["local-feeds"].spec
    mail_env = s.kit.docs["Environment"]["local-mail"].spec
    assert not set(feed_env["secrets"]["allow"]) & set(mail_env["secrets"]["allow"])
    assert not set(feed_env["network"]["allow"]) & set(mail_env["network"]["allow"])


# ------------------------------------------------------------------ store: views, threads, labels, removed
def test_threads_endpoint_marks_important_senders_and_filters():
    p = project()
    st = store(p)
    st.sync()
    t = st.threads(since="30d", important=["*@partner.example", "cfo@example.com"])["threads"]
    assert [x["threadId"] for x in t] == ["t-board", "t-pilot", "t-news", "t-sol"]        # newest activity first
    imp = {x["threadId"]: x["important"] for x in t}
    assert imp == {"t-board": True, "t-pilot": True, "t-news": False, "t-sol": False}
    pilot = next(x for x in t if x["threadId"] == "t-pilot")
    assert pilot["messages"] == 3 and pilot["lastSender"] == "dana@partner.example" and pilot["lastFromMe"] is False
    assert set(pilot["participants"]) == {"dana@partner.example", "legal@partner.example", "me@example.com"}
    assert pilot["matched"] == ["inbox", "sent"] and pilot["attachments"][0]["textChars"] > 0
    assert [x["threadId"] for x in st.threads(since="8h")["threads"]] == ["t-board", "t-pilot"]
    assert [x["threadId"] for x in st.threads(since="30d", selector="sent")["threads"]] == ["t-pilot"]


def test_exact_labels_replace_the_stored_set_and_can_end_the_scope():
    p = project()
    work = [{"id": "work", "in": "label:Work"}]
    st = store(p, work)
    st.sync()
    assert {i["id"] for i in st.query()["items"]} == {"fake-mail:m001", "fake-mail:m002", "fake-mail:m003"}
    st = store(p, work)
    src = st.ctx.sources["fake-mail"]
    real = src.fetch

    def relabeled(**kw):
        out = real(**{**kw, "cursor": None, "since": "2026-09-27T12:00:00Z"})
        for it in out["items"]:
            if it["extId"] == "m001":
                it["labels"] = ["INBOX"]                     # Work removed in the mailbox
        return out
    src.fetch = relabeled
    st.sync()
    ids = {i["id"] for i in st.query()["items"]}
    assert "fake-mail:m001" not in ids and len(ids) == 2
    feed = system(project()).kit.get("Connector", "fake").spec
    assert not feed.get("exactLabels")                       # posts keep the additive labels of before


def test_removed_ids_leave_the_store_but_are_not_remembered():
    p = project(fake_cfg(removed=["m005"]))
    st = store(p)
    st.sync()
    assert "fake-mail:m005" not in {i["id"] for i in st.query()["items"]}       # trashed: never listed
    p2 = project()
    st = store(p2)
    st.sync()
    st = store(p2)
    real = st.ctx.sources["fake-mail"].fetch
    st.ctx.sources["fake-mail"].fetch = lambda **kw: {**real(**kw), "removed": ["m005"]}
    out = st.sync()
    state = json.loads((p2 / ".agentbay/data/mail/mail-briefing/state.json").read_text())
    assert out["deleted"] == 1 and "fake-mail:m005" not in state["deleted"]
    assert "fake-mail:m005" not in {i["id"] for i in store(p2).query()["items"]}
    con = sqlite3.connect(db(p2))
    con.execute("UPDATE items SET created_at = '2026-01-01T00:00:00Z'")       # force a full re-listing
    con.commit()
    con.close()
    state["cursors"] = {}
    (p2 / ".agentbay/data/mail/mail-briefing/state.json").write_text(json.dumps(state))
    store(p2).sync()
    assert "fake-mail:m005" in {i["id"] for i in store(p2).query()["items"]}    # back from trash: stored again


def test_a_blocked_source_keeps_cursors_and_reads_and_blocks_the_call():
    p = project()
    st = store(p)
    st.sync()
    before = json.loads((p / ".agentbay/data/mail/mail-briefing/state.json").read_text())["cursors"]
    cfgp = p / "agentbay.config.yaml"
    cfg = yaml.safe_load(cfgp.read_text())
    cfg.update(fake_cfg(blocked="gmail-api: the Gmail login has expired; run `bay auth gmail`"))
    cfgp.write_text(yaml.safe_dump(cfg))
    st = store(p)
    out = st.sync()
    assert "bay auth gmail" in out["stopped"] and out["sources"]["fake-mail"]["blocked"]
    state = json.loads((p / ".agentbay/data/mail/mail-briefing/state.json").read_text())
    assert state["cursors"] == before and "fake-mail" in state["blocked"]
    s = st.status()
    assert s["stale"] is True and s["coverage"]["complete"] is False and "bay auth gmail" in s["coverage"]["note"]
    assert len(st.query()["items"]) == 6 and st.sql("SELECT count(*) FROM v_email")["rows"] == [[6]]
    d = dispatch.Dispatcher(system(p), p, clock=clock)
    r = d.call("mail-briefing.digest", {})
    assert r["status"] == "blocked" and "bay auth gmail" in r["reason"]     # stale: the refresh runs and is blocked


# ------------------------------------------------------------------ schema v2, sandbox
def test_a_store_of_another_schema_version_is_refused_not_converted():
    p = project()
    store(p).sync()
    for ver, fix in ((1, "move the folder aside and sync again"), (3, "update agentbay")):
        con = sqlite3.connect(db(p))
        con.execute(f"PRAGMA user_version = {ver}")
        con.commit()
        con.close()
        st = store(p)
        for call in (st.query, st.describe, lambda: st.threads(since="30d"), st.sync):
            try:
                call()
                raise AssertionError("expected a refusal")
            except (connect.ConnectorError, sbx.SqlError) as e:
                assert f"schema v{ver}" in str(e) and fix in str(e), e
        assert fix in st.sql("SELECT 1")["error"]
        con = sqlite3.connect(db(p))
        assert con.execute("PRAGMA user_version").fetchone()[0] == ver           # left as it was
        con.close()
    src = (KIT / "framework/connectors/corpus-store/corpus_store.py").read_text()
    assert "def migrate" not in src and "v1 store" not in src


def test_sandbox_reads_the_mail_views_and_refuses_shadow_tables_and_writes():
    p = project()
    st = store(p)
    st.sync()
    ok = st.sql("SELECT a.id, a.name, e.sender FROM v_attachments a JOIN v_email e ON e.id = a.id ORDER BY a.id, a.n")
    assert ok["rows"] == [["fake-mail:m001", "term-sheet.docx", "dana@partner.example"],
                          ["fake-mail:m004", "report.pdf", "ops@bank.example"]]
    assert st.sql("SELECT count(*) FROM attachments")["rows"] == [[2]]
    for bad, why in (("SELECT * FROM attachments_fts_data", "not allowed"), ("SELECT * FROM attachments_fts_content", "not allowed"),
                     ("DELETE FROM attachments", "read-only"), ("SELECT * FROM sqlite_master", "not allowed"),
                     ("WITH v_attachments AS (SELECT 1) SELECT * FROM v_attachments", "may not be named")):
        err = st.sql(bad)["error"]
        assert err, bad
    d = st.describe()
    names = [v["name"] for v in d["views"]]
    assert names == ["v_items", "v_posts", "v_email", "v_threads", "v_attachments", "v_fts", "v_attachment_fts"]
    assert {v["name"]: v["rows"] for v in d["views"]}["v_threads"] == 4
    assert d["fts"]["attachments"]["view"] == "v_attachment_fts" and set(sbx.COLUMNS) == set(sbx.VIEWS)


def test_attachments_and_their_full_text_rows_go_with_their_message():
    p = project()
    st = store(p)
    st.sync()
    st = store(p, [{"id": "sent", "in": "sent"}])                 # m001 (with the docx) leaves the scope
    st.sync()
    con = sqlite3.connect(db(p))
    assert con.execute("SELECT count(*) FROM attachments").fetchone()[0] == 0
    assert con.execute("SELECT count(*) FROM attachments_fts").fetchone()[0] == 0
    assert con.execute("SELECT count(*) FROM attachments_fts WHERE attachments_fts MATCH 'commitment'").fetchone()[0] == 0
    con.close()
    assert st.sql("SELECT count(*) FROM v_attachment_fts WHERE fts MATCH 'commitment'")["rows"] == [[0]]


def test_a_selector_since_is_not_a_coverage_gap_and_dropping_it_backfills():
    p = project()
    news = [{"id": "news", "in": "Newsletters", "since": "7d"}]
    out = store(p, news).sync(lookback="30d")
    assert out["coverage"]["complete"] is True and out["coverage"]["from"] == "2026-09-27T12:00:00Z"
    assert out["sources"]["fake-mail"]["queries"][0]["mode"] == "since"
    st = store(p, news)
    assert st.sync(lookback="30d")["sources"]["fake-mail"]["queries"][0]["mode"] == "cursor"
    out = store(p, [{"id": "news", "in": "Newsletters"}]).sync(lookback="30d")     # the since is dropped
    q = out["sources"]["fake-mail"]["queries"][0]
    assert q["mode"] == "since" and out["coverage"]["complete"] is True             # re-reads the whole window
