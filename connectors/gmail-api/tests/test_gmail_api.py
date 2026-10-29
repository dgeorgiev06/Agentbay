"""gmail-api against a fake Gmail API (gmail_fake.py over fixtures/mailbox.json): query mapping, full and
incremental sync, history expiry, body and attachment handling, expired login, backoff, read-only guarantee,
login flow, and the store/views end to end. The live Gmail API is not reachable from tests."""
import base64
import hashlib
import json
import re
import subprocess
import sys
import threading
import urllib.parse
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parents[2] / "tests"))
sys.path.insert(0, str(HERE))

import yaml  # noqa: E402
from gmail_fake import SCOPE, FakeGmail, jr  # noqa: E402
from helpers import KIT, NOW, MemProvider, clock, system, tmpdir  # noqa: E402

from bay import connect, dispatch, model, selector as selmod, vault  # noqa: E402

CONN = HERE.parent / "gmail_api.py"
SECRETS = {"GMAIL_CLIENT_ID": "cid-1234.apps.googleusercontent.com",
           "GMAIL_CLIENT_SECRET": "GOCSPX-client-secret-NEVER-LEAK", "GMAIL_REFRESH_TOKEN": "1//rt-NEVER-LEAK-0001"}
SINCE = "2026-09-27T12:00:00Z"        # NOW - 30d
WORK = [{"id": "work", "in": "label:Work"}]
INBOX = [{"id": "inbox", "in": "inbox"}, {"id": "sent", "in": "sent"}]


def project(cfg: dict | None = None):
    p = tmpdir() / "proj"
    p.mkdir()
    (p / "agentbay.config.yaml").write_text(yaml.safe_dump({"apiVersion": "agentbay/v2",
                                                            "secrets": {"provider": "env"}, **(cfg or {})}))
    return p


def make(fake, provider=None, p=None):
    p = p or project()
    g = connect.instantiate(system(p), "local-mail", "gmail-api", "items.source/v1", p, transport=fake,
                            provider=provider or MemProvider(SECRETS), clock=clock,
                            settings={"lookback": "30d", "mode": "mail-briefing"})
    g.sleep = lambda s: None
    return g


def store(fake, sels, p=None, provider=None):
    p = p or project()
    st = connect.instantiate(system(p), "local-mail", "corpus-store", "items.store/v1", p, transport=fake,
                             provider=provider or MemProvider(SECRETS), clock=clock, caps={"maxItemsPerRun": 500},
                             settings={"mode": "mail-briefing", "lookback": "30d", "lookbackMax": "30d",
                                       "selectors": sels})
    st.ctx.sources["gmail-api"].sleep = lambda s: None
    return st, p


def by_id(out):
    return {i["extId"]: i for i in out["items"]}


# ------------------------------------------------------------------ query mapping
def _gm():
    from importlib import util
    spec = util.spec_from_file_location("gm", CONN)
    gm = util.module_from_spec(spec)
    spec.loader.exec_module(gm)
    return gm


def test_selector_fields_map_to_gmail_search():
    gm = _gm()
    assert gm.native_query({"from": "dana@partner.example"}) == "from:dana@partner.example"
    assert gm.native_query({"from": ["a@x.example", "@bank.example"]}) == "{from:a@x.example from:bank.example}"
    assert gm.native_query({"to": "me@example.com", "in": "inbox"}) == "to:me@example.com in:inbox"
    assert gm.native_query({"in": "label:Work"}) == "label:Work"
    assert gm.native_query({"in": "Client Updates/Q4"}) == "label:Client-Updates-Q4"
    assert gm.native_query({"in": ["inbox", "in:Sent"]}) == "{in:inbox in:sent}"
    assert gm.native_query({"has": ["attachment", "link"]}) == "has:attachment"     # link stays local
    assert gm.native_query({}, since="2026-10-20T00:00:00Z") == "after:1792454400"
    assert gm.native_query({}, since="2026-10-20T00:00:00Z", until="2026-10-21T00:00:00Z") == \
        "after:1792454400 before:1792540801"                                       # until is inclusive


def test_selector_split_with_the_gmail_capability_table():
    caps = model.Kit(KIT).get("Connector", "gmail-api").spec["selectors"]
    native, local = selmod.split({"id": "p", "from": "*@kiln.fi", "subject": "staking"}, caps)
    assert native == {} and local == {"from": "*@kiln.fi", "subject": "staking"}     # wildcards, subject: local
    native, local = selmod.split({"id": "n", "in": "Newsletters", "text": "pil", "not": {"from": "a@b.example"}}, caps)
    assert native == {"in": "Newsletters"} and local == {"text": "pil", "not": {"from": "a@b.example"}}
    native, _ = selmod.split({"id": "a", "from": "a@x.example", "to": "me@x.example", "in": "inbox",
                              "has": "attachment", "since": "7d"}, caps)
    assert set(native) == {"from", "to", "in", "has", "since"}
    fake_caps = model.Kit(KIT).get("Connector", "fake-mail").spec["selectors"]
    assert {k: selmod.mode_of(fake_caps, k) for k in fake_caps} == {k: selmod.mode_of(caps, k) for k in caps}
    item = {"labels": ["INBOX", "Work"], "container": None, "createdAt": "2026-10-27T00:00:00Z"}
    assert selmod.matches(item, {"id": "w", "in": "label:Work"}, NOW) and selmod.matches(item, {"id": "i", "in": "in:inbox"}, NOW)


def test_the_gmail_query_is_never_narrower_than_the_local_match():
    """Review cases: Gmail's -from: also matches display names, negated and free terms and subject: match whole
    words. Whatever the store keeps locally must be among what the generated Gmail query returns."""
    gm = _gm()
    caps = model.Kit(KIT).get("Connector", "gmail-api").spec["selectors"]
    fake = FakeGmail(NOW)
    msg = new_msg("19d0001", frm="Dana Ruiz <dana@kiln.fi>")
    msg["headers"]["Subject"] = "Staking pilot timeline"
    msg["parts"] = [{"mimeType": "text/plain", "text": "The pilot starts Monday."}]
    fake.messages[msg["id"]] = msg
    g = make(fake)
    item = g._to_item(fake.render(msg))
    sels = [{"id": "a", "in": "inbox", "not": {"from": "ruiz"}}, {"id": "b", "in": "inbox", "not": {"text": "kiln"}},
            {"id": "c", "text": "pil"}, {"id": "d", "subject": "pil"}, {"id": "e", "from": "kiln.fi", "text": "pilot"},
            {"id": "f", "not": {"subject": "ruiz"}}, {"id": "g", "from": "dana@kiln.fi", "in": "label:Newsletters"},
            {"id": "h", "to": "me@example.com", "not": {"from": "*@other.example"}}]
    kept = 0
    for sel in sels:
        local = selmod.matches(item, sel, NOW)
        q = gm.native_query(selmod.split(sel, caps)[0])
        assert not local or fake.matches(q, msg), (sel, q)                     # never less than the local match
        kept += local
    assert kept == 7                                                           # every case but g (not labelled Newsletters)
    old = {"a": "in:inbox -from:ruiz", "b": "in:inbox -kiln", "c": "pil", "d": "subject:pil"}
    assert not any(fake.matches(q, msg) for q in old.values())                 # what the old table sent: too narrow


# ------------------------------------------------------------------ full sync, bodies, attachments
def test_full_sync_maps_messages_to_email_items():
    fake = FakeGmail(NOW)
    out = make(fake).fetch(since=SINCE, maxItems=50)
    items = by_id(out)
    assert set(items) == {"18a0001", "18a0002", "18a0003", "18a0004"}       # trash and the 900h-old one excluded
    assert out["cursor"] == "5000" and out["truncated"] is False and out["billed"] == 4
    a = items["18a0001"]
    assert a["author"] == {"email": "dana@partner.example", "name": "Dana Ruiz"} and a["from"] == "dana@partner.example"
    assert a["to"] == ["me@example.com"] and a["cc"] == ["legal@partner.example", "ops@partner.example"]
    assert a["labels"] == ["INBOX", "Work"] and a["threadId"] == "th01" and a["account"] == "me@example.com"
    assert a["text"].startswith("Hi,\nplease send") and "<b>" not in a["text"]        # text/plain preferred
    assert a["createdAt"] == "2026-10-25T10:00:00Z" and a["url"].startswith("https://mail.google.com/")
    assert a["messageId"] == "<p1@partner.example>" and items["18a0002"]["inReplyTo"] == "<p1@partner.example>"
    sch = model.inline_refs(model.data_schema("email/v1"))
    for it in items.values():
        assert model.schema_errors(it, sch) == [], it["id"]
    lst = [q for q in fake.log if q["path"].endswith("/messages")]
    assert lst and "after:" in lst[0]["params"]["q"]


def test_html_only_quoted_replies_and_charsets():
    items = by_id(make(FakeGmail(NOW)).fetch(since=SINCE, maxItems=50))
    news = items["18a0003"]["text"]
    assert news.startswith("Café news: restaking caps rise.")                 # iso-8859-1 decoded, &nbsp; folded
    assert "color:red" not in news and "alert(1)" not in news and "<" not in news
    assert items["18a0002"]["text"] == "Will do today."                        # "On ... wrote:" chain trimmed
    assert "Original Message" not in items["18a0004"]["text"] and "old text" not in items["18a0004"]["text"]


def test_attachments_text_only_for_docx_txt_csv_md_and_metadata_otherwise():
    fake = FakeGmail(NOW)
    items = by_id(make(fake).fetch(since=SINCE, maxItems=50))
    a = {x["name"]: x for x in items["18a0001"]["attachments"] + items["18a0004"]["attachments"]}
    assert a["term-sheet.docx"]["text"].startswith("Term sheet\nFee: 8% of rewards.")
    assert a["term-sheet.docx"]["textChars"] == len(a["term-sheet.docx"]["text"])
    assert a["notes.txt"]["textChars"] > 0 and a["data.csv"]["text"] == "validator,apy\nv1,6.9\nv2,7.1"
    for name, why in (("report.pdf", "PDF: metadata only"), ("huge.txt", "10 MB"), ("photo.jpg", "not extracted"),
                      ("broken.docx", "not a readable docx")):
        assert a[name]["textChars"] == 0 and "text" not in a[name] and why in a[name]["reason"], name
    fetched = {q["path"].rsplit("/", 1)[-1] for q in fake.log if "/attachments/" in q["path"]}
    assert fetched == {"ATT18a0001x2", "ATT18a0004x2", "ATT18a0004x4"}         # never the pdf, jpg or oversized file
    assert items["18a0004"]["hasAttachments"] is True and items["18a0002"]["attachments"] == []


def test_extraction_runs_in_a_limited_subprocess_and_failures_never_raise():
    gm = sys.modules[type(make(FakeGmail(NOW))).__module__]
    assert gm.extract_text(b"a,b\n1,2", "text", max_chars=100) == ("a,b\n1,2", None)
    assert gm.extract_text(b"x" * 50, "text", max_chars=10)[1].startswith("text is over the 10-character cap")
    d = tmpdir()
    real = gm.EXTRACT
    try:
        (d / "slow.py").write_text("import time\ntime.sleep(30)\n")
        gm.EXTRACT = d / "slow.py"
        text, why = gm.extract_text(b"", "text", max_chars=10, timeout_s=1)
        assert text == "" and "time limit" in why
        (d / "hog.py").write_text("x = bytearray(1024 * 1024 * 1024)\nprint('{\"text\": \"never\"}')\n")
        gm.EXTRACT = d / "hog.py"
        text, why = gm.extract_text(b"", "text", max_chars=10, mem_mb=128)
        if sys.platform.startswith("linux"):                    # RLIMIT_AS is enforced on Linux, not on macOS
            assert text == "" and "failed" in why
        (d / "writer.py").write_text("f = open('out.txt', 'w')\nf.write('x' * 10)\nf.close()\n")
        gm.EXTRACT = d / "writer.py"                                    # runs with cwd = the script's folder
        assert gm.extract_text(b"", "text", max_chars=10)[0] == ""
        out = d / "out.txt"
        assert not out.exists() or out.stat().st_size == 0               # RLIMIT_FSIZE 0: no file content
    finally:
        gm.EXTRACT = real
    src = (CONN.parent / "extract.py").read_text()
    assert "-I" in (CONN.read_text()) and "open(" not in src and "tempfile" not in src   # no files: stdin only


def test_docx_with_a_dtd_or_zip_bomb_is_refused():
    import io
    import zipfile
    gm = sys.modules[type(make(FakeGmail(NOW))).__module__]
    w = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
    evil = (f'<?xml version="1.0"?><!DOCTYPE lolz [<!ENTITY lol "lol"><!ENTITY lol2 "&lol;&lol;">]>'
            f'<w:document xmlns:w="{w}"><w:body><w:p><w:r><w:t>&lol2;</w:t></w:r></w:p></w:body></w:document>')
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        z.writestr("word/document.xml", evil)
    assert "DTD refused" in gm.extract_text(buf.getvalue(), "docx", max_chars=1000)[1]
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("word/document.xml", b"<" + b" " * (60 * 1024 * 1024) + b"/>")
    assert "beyond the size cap" in gm.extract_text(buf.getvalue(), "docx", max_chars=1000)[1]


def _docx(xml: bytes) -> bytes:
    import io
    import zipfile
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("word/document.xml", xml)
    return buf.getvalue()


def test_docx_entities_are_refused_by_the_parser_in_any_encoding():
    """Review repro mk.py: a byte search for <!DOCTYPE missed UTF-16, and xml.etree expanded the entities."""
    import time
    gm = sys.modules[type(make(FakeGmail(NOW))).__module__]
    w = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"'
    ent = ('<?xml version="1.0" encoding="{enc}"?><!DOCTYPE d [<!ENTITY a "SECRETENT">]><w:document %s><w:body>'
           '<w:p><w:r><w:t>&a;</w:t></w:r></w:p></w:body></w:document>' % w)
    laughs = ('<?xml version="1.0" encoding="{enc}"?><!DOCTYPE d [<!ENTITY l0 "lollollol">'
              + "".join('<!ENTITY l%d "%s">' % (i, ("&l%d;" % (i - 1)) * 10) for i in range(1, 10))
              + ']><w:document %s><w:body><w:p><w:r><w:t>&l9;</w:t></w:r></w:p></w:body></w:document>' % w)
    xxe = ('<?xml version="1.0" encoding="{enc}"?><!DOCTYPE d [<!ENTITY x SYSTEM "file:///etc/passwd">]>'
           '<w:document %s><w:body><w:p><w:r><w:t>&x;</w:t></w:r></w:p></w:body></w:document>' % w)
    for doc in (ent, laughs, xxe):
        for enc, codec, why in (("UTF-16", "utf-16", "not UTF-8 refused"), ("UTF-8", "utf-8", "DTD refused"),
                                ("UTF-8", "utf-16-le", "not UTF-8 refused"), ("ISO-8859-1", "latin-1", "not UTF-8")):
            text, reason = gm.extract_text(_docx(doc.format(enc=enc).encode(codec)), "docx", max_chars=200_000)
            assert text == "" and why in reason, (enc, codec, reason)
    # quad.py: a 2 MB entity referenced 200 times (400M characters if expanded), refused before any expansion,
    # quickly and within a 64 MB memory limit (the limit is not enforced on macOS; the parser refusal is)
    big = "A" * 2_000_000
    for enc, codec in (("UTF-16", "utf-16"), ("UTF-8", "utf-8")):
        xml = ('<?xml version="1.0" encoding="%s"?><!DOCTYPE d [<!ENTITY e "%s">]><w:document %s><w:body><w:p>'
               '<w:r><w:t>%s</w:t></w:r></w:p></w:body></w:document>' % (enc, big, w, "&e;" * 200))
        t0 = time.monotonic()
        text, reason = gm.extract_text(_docx(xml.encode(codec)), "docx", max_chars=200_000, mem_mb=64)
        assert text == "" and "refused" in reason and time.monotonic() - t0 < 10, reason
    src = (CONN.parent / "extract.py").read_text()
    assert "XML_PARAM_ENTITY_PARSING_NEVER" in src and "StartDoctypeDeclHandler" in src and "ElementTree" not in src
    ok = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document %s><w:body><w:p><w:r><w:t>Fee</w:t>'
          '</w:r><w:r><w:tab/><w:t>8%% &amp; more</w:t></w:r></w:p><w:p><w:r><w:t>Line 2</w:t></w:r></w:p>'
          '</w:body></w:document>' % w)
    assert gm.extract_text(_docx(ok.encode()), "docx", max_chars=1000) == ("Fee\t8% & more\nLine 2", None)
    assert gm.extract_text(_docx(b"\xef\xbb\xbf" + ok.encode()), "docx", max_chars=1000)[0] == "Fee\t8% & more\nLine 2"


def test_messages_per_run_cap_truncates_newest_first():
    fake = FakeGmail(NOW)
    out = make(fake).fetch(since=SINCE, maxItems=2)
    assert [i["extId"] for i in out["items"]] == ["18a0004", "18a0003"]
    assert out["billed"] == 2 and out["truncated"] is True


# ------------------------------------------------------------------ incremental sync, history expiry, pruning
def new_msg(mid, labels=("INBOX", "Label_1"), hours=1, frm="Dana Ruiz <dana@partner.example>"):
    return {"id": mid, "threadId": "th01", "ageHours": hours, "labelIds": list(labels),
            "headers": {"From": frm, "To": "me@example.com", "Subject": "Re: Staking pilot: keys and timeline"},
            "parts": [{"mimeType": "text/plain", "text": "One more thing: who signs the MSA?"}]}


def test_incremental_sync_via_history_adds_relabels_trashes_and_deletes():
    fake = FakeGmail(NOW)
    st, p = store(fake, WORK + [{"id": "inbox", "in": "inbox"}])
    first = st.sync()
    assert first["added"] == 4 and first["sources"]["gmail-api"]["queries"][0]["mode"] == "since"
    fake.add(new_msg("18a0010"))
    fake.relabel("18a0001", remove=["Label_1", "INBOX"])         # left both selectors
    fake.relabel("18a0003", add=["TRASH"])                       # trashed
    fake.delete("18a0004")                                       # deleted for good
    st2, _ = store(fake, WORK + [{"id": "inbox", "in": "inbox"}], p=p)
    out = st2.sync()
    hist = [q for q in fake.log if q["path"].endswith("/history")]
    assert hist and all(q["params"]["startHistoryId"] == "5000" for q in hist)
    assert {q["mode"] for q in out["sources"]["gmail-api"]["queries"]} == {"cursor"}
    ids = {r["id"] for r in st2.query()["items"]}
    assert ids == {"gmail:18a0002", "gmail:18a0010"}
    state = json.loads((p / ".agentbay/data/mail/mail-briefing/state.json").read_text())
    assert "gmail:18a0004" in state["deleted"] and "gmail:18a0003" not in state["deleted"]   # trash may come back
    assert all(c["cursor"] == str(fake.history_id) for c in state["cursors"].values())
    gets = [q for q in fake.log if re.search(r"/messages/18a00\d\d$", q["path"])]
    assert len([q for q in gets if q["path"].endswith("18a0010")]) == 1   # read once although two queries saw it
    fake.relabel("18a0003", remove=["TRASH"])                    # restored from trash: stored again
    st3, _ = store(fake, WORK + [{"id": "inbox", "in": "inbox"}], p=p)
    st3.sync()
    assert "gmail:18a0003" in {r["id"] for r in st3.query()["items"]}


def test_expired_history_falls_back_to_a_full_listing_bounded_by_lookback():
    fake = FakeGmail(NOW)
    st, p = store(fake, INBOX)
    st.sync()
    fake.delete("18a0004")
    fake.expire_history()
    st2, _ = store(fake, INBOX, p=p)
    out = st2.sync()
    assert any("no longer has the history" in w for w in out.get("warnings", []))
    lists = [q for q in fake.log if q["path"].endswith("/messages")]
    assert len(lists) >= 3 and "after:1790510400" in lists[-1]["params"]["q"]       # NOW - 30d
    assert "gmail:18a0004" not in {r["id"] for r in st2.query()["items"]}          # re-read: 404 -> deleted
    assert out["deleted"] == 1


def gets(fake) -> dict[str, int]:
    """messages.get calls per message id in the fake's request log."""
    out: dict[str, int] = {}
    for q in fake.log:
        m = re.search(r"/messages/([^/]+)$", q["path"])
        if m:
            out[m.group(1)] = out.get(m.group(1), 0) + 1
    return out


def store_with(fake, p, *, lookback="30d", cap=500, sels=None):
    st = connect.instantiate(system(p), "local-mail", "corpus-store", "items.store/v1", p, transport=fake,
                             provider=MemProvider(SECRETS), clock=clock, caps={"maxItemsPerRun": cap},
                             settings={"mode": "mail-briefing", "lookback": lookback, "lookbackMax": "30d",
                                       "selectors": sels or [{"id": "inbox", "in": "inbox"}]})
    st.ctx.sources["gmail-api"].sleep = lambda s: None
    return st


def test_a_stored_message_older_than_the_lookback_is_still_rechecked_when_it_changes():
    """Review repro lb.py: a 20-day-old stored message archived, then a sync with lookback 7d. The change must
    be read and the message leave the store; an old message the store does not hold is read but not stored."""
    fake = FakeGmail(NOW)
    m = new_msg("19c0001", hours=24 * 20)
    m["threadId"] = "told"
    fake.messages[m["id"]] = m
    old = new_msg("19c0002", labels=("Label_2",), hours=24 * 20)
    fake.messages[old["id"]] = old
    p = project()
    store_with(fake, p).sync()
    assert "gmail:19c0001" in {i["id"] for i in store_with(fake, p).query()["items"]}
    fake.relabel("19c0001", remove=["INBOX"])                       # archived
    fake.relabel("19c0002", add=["INBOX"])                          # an old message moved to the inbox
    fake.log.clear()
    out = store_with(fake, p, lookback="7d").sync()
    assert [q["mode"] for q in out["sources"]["gmail-api"]["queries"]] == ["cursor"]
    ids = {i["id"] for i in store_with(fake, p, lookback="7d").query()["items"]}
    assert "gmail:19c0001" not in ids                               # re-read and out of scope at any age
    assert "gmail:19c0002" not in ids and gets(fake) == {"19c0001": 1, "19c0002": 1}   # older than the window
    state = json.loads((p / ".agentbay/data/mail/mail-briefing/state.json").read_text())
    assert not [k for k, v in state["checked"].items() if v == "2026-10-27T12:00:00Z"]  # nothing claimed as checked


def test_a_capped_first_sync_backfills_with_history_after_it_and_reads_each_message_once():
    """Review repro trunc.py: 30 messages in the window, 10 per run. Every later sync replays history and
    backfills older mail below what is stored, never re-reading a stored message, until coverage is complete."""
    fake = FakeGmail(NOW)
    for k in range(30):
        m = new_msg(f"19b{k:04d}", hours=2 + k * 10)
        m["threadId"] = f"tx{k}"
        fake.messages[m["id"]] = m                                  # not via history
    in_window = {mid for mid, m in fake.messages.items() if m["ageHours"] <= 720
                 and not {"TRASH", "SPAM"} & set(m["labelIds"]) and "INBOX" in m["labelIds"]}
    p = project()
    outs = []
    for _ in range(6):
        outs.append(store_with(fake, p, cap=10).sync())
        if outs[-1]["coverage"]["complete"]:
            break
    modes = [[q["mode"] for q in o["sources"]["gmail-api"]["queries"]] for o in outs]
    assert modes[0] == ["since"] and all(m == ["cursor", "older"] for m in modes[1:]), modes
    assert len(outs) == 4 and outs[-1]["coverage"]["complete"] and outs[-1]["stopped"] is None
    assert [o["coverage"]["from"] for o in outs[:-1]] == sorted((o["coverage"]["from"] for o in outs[:-1]),
                                                                  reverse=True)   # coverage only grows back
    hist = [q for q in fake.log if q["path"].endswith("/history")]
    assert len(hist) == 3                                           # every sync after the first
    reads = gets(fake)
    assert set(reads) == in_window and set(reads.values()) == {1}   # each message read once
    assert sum(o["billed"] for o in outs) == len(in_window)        # and billed once
    ids = {i["extId"] for i in store_with(fake, p, cap=10).query(limit=100)["items"]}
    assert ids == in_window
    again = store_with(fake, p, cap=10).sync()                      # complete: history only, nothing read
    assert [q["mode"] for q in again["sources"]["gmail-api"]["queries"]] == ["cursor"] and again["billed"] == 0


def test_history_reads_only_changes_that_can_matter_and_pages_within_the_budget():
    fake = FakeGmail(NOW)
    p = project()
    sels = [{"id": "work", "in": "label:Work"}]
    store_with(fake, p, sels=sels).sync()                           # 18a0001, 18a0002 (Work) stored
    other = new_msg("19e0001", labels=("INBOX",), hours=5)
    fake.messages[other["id"]] = other                              # in the mailbox, not in scope
    fake.log.clear()
    fake.relabel("19e0001", add=["UNREAD"])
    fake.relabel("19e0001", add=["STARRED", "CATEGORY_PROMOTIONS"])
    fake.relabel("19e0001", remove=["UNREAD", "INBOX"])
    fake.relabel("18a0002", add=["STARRED"])                        # stored: always re-read
    out = store_with(fake, p, sels=sels).sync()
    assert gets(fake) == {"18a0002": 1} and out["billed"] == 1
    fake.relabel("19e0001", add=["Label_1"])                        # added to Work: now in scope
    fake.log.clear()
    store_with(fake, p, sels=sels).sync()
    assert gets(fake) == {"19e0001": 1}
    assert "gmail:19e0001" in {i["id"] for i in store_with(fake, p, sels=sels).query()["items"]}
    for k in range(5):                                              # 5 new Work messages, 2 reads per run
        fake.add(new_msg(f"19f{k:04d}", labels=("Label_1",), hours=1))
    fake.log.clear()
    runs = []
    while len(runs) < 6:
        runs.append(store_with(fake, p, sels=sels, cap=2).sync())
        if not runs[-1]["stopped"]:
            break
    assert [o["billed"] for o in runs] == [2, 2, 1] and set(gets(fake).values()) == {1}
    starts = [q["params"]["startHistoryId"] for q in fake.log if q["path"].endswith("/history")]
    assert len(set(starts)) == 3                                    # each run continues where the last stopped
    state = json.loads((p / ".agentbay/data/mail/mail-briefing/state.json").read_text())
    assert all(c["cursor"] == str(fake.history_id) for c in state["cursors"].values())


def test_with_a_cursor_check_ids_are_only_claimed_when_read():
    fake = FakeGmail(NOW)
    g = make(fake)
    first = g.fetch(since=SINCE, maxItems=50)
    out = make(fake).fetch(cursor=first["cursor"], maxItems=50, checkIds=["18a0001", "bad id!"])
    assert out["checked"] == ["18a0001"] and out["billed"] == 1


# ------------------------------------------------------------------ expired login, backoff
def test_invalid_grant_blocks_with_the_one_command_and_never_crashes():
    fake = FakeGmail(NOW)
    st, p = store(fake, INBOX)
    st.sync()
    fake.token_error = "invalid_grant"
    st2, _ = store(fake, INBOX, p=p)
    out = st2.sync()
    assert "bay auth gmail" in out["stopped"] and "7 days" in out["stopped"] and out["billed"] == 0
    stt = st2.status()
    assert stt["stale"] is True and "bay auth gmail" in stt["blocked"]["gmail-api"]["reason"]
    assert stt["coverage"]["complete"] is False and "bay auth gmail" in stt["coverage"]["note"]
    assert len(st2.query()["items"]) == 4                                           # stored mail stays readable
    state = json.loads((p / ".agentbay/data/mail/mail-briefing/state.json").read_text())
    assert all(c.get("cursor") == "5000" for c in state["cursors"].values())         # cursors kept
    fake.token_error = None                                                          # after `bay auth gmail`
    st3, _ = store(fake, INBOX, p=p)
    assert st3.sync()["stopped"] is None and "blocked" not in st3.status() and st3.status()["stale"] is False


def test_dispatcher_reports_an_expired_login_as_blocked():
    fake = FakeGmail(NOW)
    fake.token_error = "invalid_grant"
    p = project()
    d = dispatch.Dispatcher(system(p), p, transport=fake, provider=MemProvider(SECRETS), clock=clock)
    r = d.call("mail-briefing.sync", {})
    assert r["status"] == "blocked" and "bay auth gmail" in r["reason"]
    missing = MemProvider({k: v for k, v in SECRETS.items() if k != "GMAIL_REFRESH_TOKEN"})
    d = dispatch.Dispatcher(system(p), p, transport=FakeGmail(NOW), provider=missing, clock=clock)
    r = d.call("mail-briefing.sync", {})
    assert r["status"] == "blocked" and "no Gmail login yet" in r["reason"] and "bay auth gmail" in r["reason"]
    assert SECRETS["GMAIL_CLIENT_SECRET"] not in json.dumps(r)


def test_quota_errors_back_off_exponentially_then_give_up_gracefully():
    fake = FakeGmail(NOW)
    fake.queue += [(r"/messages$", 429, {}), (r"/messages$", 503, {"Retry-After": "7"})]
    g = make(fake)
    slept = []
    g.sleep = slept.append
    out = g.fetch(since=SINCE, maxItems=50)
    assert slept == [1.0, 7.0] and len(out["items"]) == 4
    fake = FakeGmail(NOW)
    fake.queue += [(r"/messages/18a0003$", 429, {})] * 6
    g = make(fake)
    slept = []
    g.sleep = slept.append
    out = g.fetch(since=SINCE, maxItems=50)
    assert slept == [1.0, 2.0, 4.0, 8.0, 16.0] and out["truncated"] is True
    assert any("after 5 retries" in w for w in out["warnings"]) and out["cursor"] is None   # nothing claimed
    assert {i["extId"] for i in out["items"]} == {"18a0004"}                                 # kept what was read


def test_tokens_never_leave_the_connector():
    fake = FakeGmail(NOW)
    g = make(fake)
    out = json.dumps(g.fetch(since=SINCE, maxItems=50))
    for v in SECRETS.values():
        assert v not in out
    assert "ya29.ACCESS" not in out and vault.redact("ya29.ACCESS-1") == "***"


# ------------------------------------------------------------------ read-only guarantee
def test_the_connector_source_has_no_mailbox_write_path():
    src = CONN.read_text()
    calls = re.findall(r"\.request\(\s*\"([A-Z]+)\"\s*,\s*([^,]+),", src)
    assert calls, "no requests found"
    for method, url in calls:
        assert method == "GET" or (method == "POST" and url.strip() == "TOKEN_URL"), (method, url)
    assert sum(1 for m, _ in calls if m == "POST") == 2                    # refresh grant + login code exchange
    assert re.search(r'TOKEN_URL = "https://oauth2\.googleapis\.com/token"', src)
    code = re.sub(r'"""[\s\S]*?"""', "", src)                                 # docstrings may name what is not done
    for verb in ("PUT", "PATCH", "DELETE"):
        assert f'"{verb}"' not in code
    for path in ("/send", "/modify", "/trash", "/untrash", "batchModify", "batchDelete", "/drafts", "/import",
                 "/insert", "/watch", "/settings", "/stop"):
        assert path not in code, path
    assert re.search(r'SCOPE = "https://www\.googleapis\.com/auth/gmail\.readonly"', src)
    assert src.count("googleapis.com/auth/") == 1                            # no other scope is ever named


def test_every_request_in_a_sync_is_a_read_or_the_token_exchange():
    fake = FakeGmail(NOW)
    st, p = store(fake, INBOX)
    st.sync()
    fake.add(new_msg("18a0011"))
    fake.relabel("18a0002", add=["TRASH"])
    store(fake, INBOX, p=p)[0].sync()
    for q in fake.log:
        assert (q["method"], q["host"]) in (("GET", "gmail.googleapis.com"), ("POST", "oauth2.googleapis.com")), q
        if q["method"] == "POST":
            assert q["path"] == "/token" and q["form"]["grant_type"] == "refresh_token"


def test_env_allowlist_and_secret_allowlist_bind_the_connector():
    env = model.Kit(KIT).docs["Environment"]["local-mail"].spec
    assert sorted(env["network"]["allow"]) == ["gmail.googleapis.com", "oauth2.googleapis.com"]
    assert sorted(env["secrets"]["allow"]) == sorted(SECRETS)
    s = system(project())
    s.kit.docs["Environment"]["local-mail"].spec["network"]["allow"] = ["oauth2.googleapis.com"]
    g = connect.instantiate(s, "local-mail", "gmail-api", "items.source/v1", project(), transport=FakeGmail(NOW),
                            provider=MemProvider(SECRETS), clock=clock)
    try:
        g.fetch(since=SINCE, maxItems=5)
        raise AssertionError("expected NetworkDenied")
    except connect.NetworkDenied as e:
        assert "gmail.googleapis.com" in str(e)
    try:
        g.ctx.secrets.get("X_REFRESH_TOKEN")
        raise AssertionError("expected SecretError")
    except vault.SecretError:
        pass


def test_a_broader_grant_is_refused():
    fake = FakeGmail(NOW)
    fake.scope = SCOPE + " https://www.googleapis.com/auth/gmail.modify"
    out = make(fake).fetch(since=SINCE, maxItems=5)
    assert out["items"] == [] and "more than gmail.readonly" in out["blocked"]


# ------------------------------------------------------------------ login (bay auth gmail)
def test_login_uses_pkce_a_loopback_redirect_and_only_the_readonly_scope():
    gm = sys.modules[type(make(FakeGmail(NOW))).__module__]
    seen = {}

    def token(method, url, headers, body):
        form = dict(urllib.parse.parse_qsl(body.decode()))
        seen["token"] = {"method": method, "url": url, "form": form}
        return jr({"access_token": "ya29.LOGIN", "refresh_token": "1//NEW-REFRESH", "scope": SCOPE,
                   "token_type": "Bearer", "expires_in": 3599})

    def browser(url):
        q = dict(urllib.parse.parse_qsl(urllib.parse.urlsplit(url).query))
        seen["auth"] = q
        redirect = f"{q['redirect_uri']}/?state={q['state']}&code=4/CODE&scope={urllib.parse.quote(SCOPE)}"
        threading.Thread(target=lambda: urllib.request.urlopen(redirect, timeout=5).read(), daemon=True).start()

    http = connect.Http(["oauth2.googleapis.com"], token, "test")
    body = gm.login(http, SECRETS["GMAIL_CLIENT_ID"], SECRETS["GMAIL_CLIENT_SECRET"], open_browser=browser,
                    timeout_s=10, say=lambda *_: None)
    a, t = seen["auth"], seen["token"]
    assert a["scope"] == SCOPE and a["code_challenge_method"] == "S256" and a["access_type"] == "offline"
    assert re.fullmatch(r"http://127\.0\.0\.1:\d+", a["redirect_uri"])
    assert t["method"] == "POST" and t["url"] == "https://oauth2.googleapis.com/token"
    f = t["form"]
    assert f["grant_type"] == "authorization_code" and f["code"] == "4/CODE" and f["redirect_uri"] == a["redirect_uri"]
    challenge = base64.urlsafe_b64encode(hashlib.sha256(f["code_verifier"].encode()).digest()).decode().rstrip("=")
    assert challenge == a["code_challenge"] and body["refresh_token"] == "1//NEW-REFRESH"

    def broad(method, url, headers, body):
        return jr({"access_token": "ya29.X", "refresh_token": "1//R", "scope": SCOPE + " openid"})
    try:
        gm.login(connect.Http(["oauth2.googleapis.com"], broad, "test"), "c", "s", open_browser=browser,
                 timeout_s=10, say=lambda *_: None)
        raise AssertionError("expected ConnectorError")
    except connect.ConnectorError as e:
        assert "nothing was stored" in str(e)


def test_bay_auth_gmail_needs_an_interactive_terminal():
    r = subprocess.run([sys.executable, "-m", "bay.cli", "auth", "gmail"], cwd=KIT, stdin=subprocess.DEVNULL,
                       capture_output=True, text=True, timeout=60)
    assert r.returncode != 0 and "interactive terminal" in r.stderr


# ------------------------------------------------------------------ store and views end to end
def test_store_scrubs_bodies_and_attachment_text_in_every_read():
    fake = FakeGmail(NOW)
    st, p = store(fake, INBOX)
    st.sync()
    raw = (p / ".agentbay/data/mail/mail-briefing/corpus.db").read_bytes().decode("latin-1")
    planted = ("hunter2hunter2", "sk-ant-api03-ABCDEFGHIJKLMNOPQRSTUVWXYZ012345", "GOCSPX-abcdefghijklmnop12345")
    for sec in planted:
        assert sec not in raw
    reads = [st.sql(f"SELECT {c} FROM v_attachments") for c in ("text", "upper(text)", "hex(text)", "name")]
    reads += [st.sql("SELECT text, hex(text) FROM v_email"), st.get(["gmail:18a0004", "gmail:18a0001"]),
              st.sql("SELECT snippet FROM v_attachment_fts WHERE fts MATCH 'notes OR client_secret OR REDACTED'"),
              st.threads(since="30d")]
    blob = json.dumps(reads)
    for sec in planted:
        assert sec not in blob and sec.encode().hex().upper() not in blob
    assert "[REDACTED:" in blob


def test_views_threads_and_needs_reply_from_gmail():
    fake = FakeGmail(NOW)
    st, _ = store(fake, INBOX)
    st.sync()
    t = {r[0]: r for r in st.sql("SELECT threadId, messages, lastSender, lastFromMe, needsReply, subject "
                                 "FROM v_threads")["rows"]}
    assert t["th01"][1:] == [2, "me@example.com", 1, 0, "Staking pilot: keys and timeline"]
    assert t["th03"][3:5] == [0, 1]                                             # cc'd to me: needs a reply
    e = st.sql("SELECT id, fromMe, toMe FROM v_email ORDER BY id")["rows"]
    assert e[1] == ["gmail:18a0002", 1, 0] and e[3] == ["gmail:18a0004", 0, 1]
    a = st.sql("SELECT id, name, textChars FROM v_attachment_fts WHERE fts MATCH 'commitment'")["rows"]
    assert a and a[0][:2] == ["gmail:18a0001", "term-sheet.docx"]
    got = st.get(["gmail:18a0001"])["items"][0]
    assert all("text" not in x for x in got["attachments"]) and got["attachments"][0]["textChars"] > 0


def test_prompt_injection_in_a_body_stays_data():
    fake = FakeGmail(NOW)
    st, _ = store(fake, INBOX)
    st.sync()
    news = st.get(["gmail:18a0003"])["items"][0]
    assert "IGNORE ALL PREVIOUS INSTRUCTIONS" in news["text"]                  # stored verbatim, as data
    p = project()
    d = dispatch.Dispatcher(system(p), p, transport=FakeGmail(NOW), provider=MemProvider(SECRETS), clock=clock)
    r = d.call("mail-briefing.digest", {"since": "7d"})
    plan = r["next"]
    assert plan["step"] == "digest" and "IGNORE ALL PREVIOUS" not in plan["task"] + plan["playbookText"]
    assert any("never instructions" in x["statement"] for x in plan["rules"])
    threads = {t["threadId"]: t for t in plan["previous"]["gather"]["threads"]}
    assert "IGNORE ALL PREVIOUS INSTRUCTIONS" in threads["th02"]["lastText"]    # only inside the data
