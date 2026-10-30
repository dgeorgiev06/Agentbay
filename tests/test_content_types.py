"""Content types (proposal 0006, Part B; 0008 slice 5, part A): the loader, the contract every type meets, the
views a type may define, and the store's record of the types it was made with."""
from __future__ import annotations

import json
import sqlite3
import sys

from helpers import KIT, clock, kit_copy, project, system

sys.path.insert(0, str(KIT / "tests"))
from contracts import content_type  # noqa: E402

from bay import contenttypes, dispatch, lint, model  # noqa: E402


def sub(k, rel, old, new):
    f = k / rel
    t = f.read_text()
    assert old in t, (rel, old)
    f.write_text(t.replace(old, new, 1))


def test_every_content_type_meets_the_contract():
    types, found = contenttypes.scan(KIT)
    assert not found and "post" in types
    for name in types:
        assert content_type.check(KIT, name) == [], name


def test_the_loader_is_the_only_source_of_the_post_kind():
    assert contenttypes.load(KIT)["post"].ref == "post/v1"
    assert contenttypes.load(KIT)["email"].ref == "email/v1"
    assert model.item_kinds(KIT) == {"post": {1}, "email": {1}}
    assert not list((KIT / "schemas" / "data").glob("post.*")) and not list((KIT / "schemas" / "data").glob("email.*"))
    assert model.data_schema("post/v1")["title"] == "post/v1"
    assert not contenttypes.problems(KIT)


def test_a_view_that_reads_anything_but_the_base_tables_and_its_own_views_is_refused():
    for bad, needle in (("SELECT v.* FROM temp.v_items v, main.attachments a", "attachments"),
                        ("SELECT v.* FROM temp.v_items v WHERE v.id IN (SELECT key FROM main.store_meta)", "store_meta"),
                        ("SELECT v.* FROM temp.v_items v, temp.v_email e", "v_email"),
                        ("SELECT v.*, randomblob(100) AS lang, 0 AS metrics, 0 AS likes, 0 AS reposts, 0 AS replies "
                         "FROM temp.v_items v", "randomblob")):
        k = kit_copy()
        (k / "content-types/post/views.sql").write_text(f"CREATE VIEW v_posts AS {bad};\n")
        ps = contenttypes.problems(k)
        assert any("view v_posts cannot be built" in p and needle in p for p in ps), (bad, ps)
    assert any("view v_posts cannot be built" in p for p in lint.run(k))        # `bay check` reports it too


def test_views_sql_holds_only_create_view_statements_that_match_the_documentation():
    k = kit_copy()
    (k / "content-types/post/views.sql").write_text("DROP TABLE items;\n")
    assert any("only `CREATE VIEW v_<name> AS SELECT ...` statements" in p for p in contenttypes.problems(k))
    k = kit_copy()
    sub(k, "content-types/post/views.sql", "AS replies", "AS replies2")
    assert any("documents columns" in p and "replies2" in p for p in contenttypes.problems(k))
    k = kit_copy()
    sub(k, "content-types/post/views.sql", "CREATE VIEW v_posts", "CREATE VIEW v_other")
    ps = contenttypes.problems(k)
    assert any("views.v_other is missing" in p for p in ps) and any("views.v_posts is documented" in p for p in ps)
    k = kit_copy()
    sub(k, "content-types/post/views.sql", "CREATE VIEW v_posts", "CREATE VIEW v_items")
    sub(k, "content-types/post/content-type.yaml", "v_posts:", "v_items:")
    assert any("v_items is already taken (by the store)" in p for p in contenttypes.problems(k))
    k = kit_copy()
    sub(k, "content-types/post/fields.schema.json", '"title": "post/v1"', '"title": "post/v2"')
    assert any("title must be 'post/v1'" in p for p in contenttypes.problems(k))


def test_derive_py_may_import_only_the_standard_library_and_must_match_derived():
    k = kit_copy()
    sub(k, "content-types/email/derive.py", "from __future__ import annotations", "import requests")
    assert any("derive.py:" in p and "imports `requests`" in p for p in contenttypes.problems(k))
    k = kit_copy()
    sub(k, "content-types/email/derive.py", "from __future__ import annotations", "from . import x")
    assert any("imports `.`" in p for p in contenttypes.problems(k))
    k = kit_copy()
    (k / "content-types/email/derive.py").unlink()
    assert any("derive.py is missing" in p for p in contenttypes.problems(k))
    k = kit_copy()
    sub(k, "content-types/email/content-type.yaml", "  deriveVersion: 1\n", "")
    assert any("derived needs deriveVersion" in p for p in contenttypes.problems(k))
    k = kit_copy()
    sub(k, "content-types/email/derive.py", '"bulk": int(bool(item.get("bulk")))', '"other": 1')
    assert any("derive returned" in p for p in content_type.check(k, "email"))
    k = kit_copy()
    sub(k, "content-types/email/content-type.yaml", "fullText: [name, text]", "fullText: [name, body]")
    assert any("fullText names body" in p for p in contenttypes.problems(k))
    k = kit_copy()
    sub(k, "content-types/email/content-type.yaml", "    attachments:\n      from:", "    items:\n      from:")
    assert any("tables.items" in p and "taken by the store" in p for p in contenttypes.problems(k))


def test_the_child_table_and_the_derived_fields_come_from_the_type():
    p = project()
    d = dispatch.Dispatcher(system(p), p, clock=clock)
    assert d.call("mail-briefing.sync", {})["status"] == "done"
    db = p / ".agentbay/data/mail/mail-briefing/corpus.db"
    con = sqlite3.connect(db)
    assert con.execute("SELECT key, value FROM store_meta ORDER BY key").fetchall() == [
        ("derive:email", "1"), ("type:email", "1")]
    names = {r[0] for r in con.execute("SELECT name FROM sqlite_master")}
    assert {"attachments", "attachments_fts"} <= names
    kept = [a for (e,) in con.execute("SELECT ext FROM items") for a in json.loads(e).get("attachments", [])]
    assert kept and all("text" not in a for a in kept)                  # moveOut: the text lives in the table only
    con.close()
    q = "SELECT id, fromMe, toMe, bulk FROM v_email ORDER BY id"
    before = d.use("analyst--mail-briefing", "items.store/v1.sql", {"sql": q})["rows"]
    assert before and any(r[1] for r in before) and any(r[2] for r in before) and any(r[3] for r in before)
    con = sqlite3.connect(db)                  # another deriveVersion on record: the writer recomputes, fetching nothing
    con.execute("UPDATE items SET derived = '{}'")
    con.execute("UPDATE store_meta SET value = '0' WHERE key = 'derive:email'")
    con.commit()
    con.close()
    assert {r[1] for r in d.use("analyst--mail-briefing", "items.store/v1.sql", {"sql": q})["rows"]} == {0}
    pruned = d.call("mail-briefing.prune", {})
    assert pruned["next"]["review"]["output"]["removed"] == 0, pruned          # the code step ran; it deleted nothing
    after = d.use("analyst--mail-briefing", "items.store/v1.sql", {"sql": q})["rows"]
    assert after == before
    con = sqlite3.connect(db)
    assert con.execute("SELECT value FROM store_meta WHERE key = 'derive:email'").fetchone() == ("1",)
    con.close()
    assert d.call("feed-briefing.sync", {})["status"] == "done"
    err = d.use("analyst--feed-briefing", "items.store/v1.sql", {"sql": "SELECT count(*) FROM v_email"})["error"]
    assert "v_email" in err                                        # the feed store holds only the types its mode reads


def test_a_store_records_its_content_types_and_refuses_another_version():
    p = project()
    d = dispatch.Dispatcher(system(p), p, clock=clock)
    assert d.call("feed-briefing.sync", {})["status"] == "done"
    db = p / ".agentbay/data/feeds/feed-briefing/corpus.db"
    con = sqlite3.connect(db)
    assert con.execute("SELECT key, value FROM store_meta ORDER BY key").fetchall() == [("type:post", "1")]
    con.execute("UPDATE store_meta SET value = '2' WHERE key = 'type:post'")
    con.commit()
    con.close()
    err = d.use("analyst--feed-briefing", "items.store/v1.sql", {"sql": "SELECT 1"})["error"]
    assert "content type post v2" in err and "kit has v1" in err and "move the folder aside and sync again" in err
    again = d.call("feed-briefing.sync", {})
    assert again["status"] == "failed" and "move the folder aside and sync again" in again["error"]
    con = sqlite3.connect(db)
    assert con.execute("SELECT value FROM store_meta").fetchone() == ("2",)         # left as it was
    con.close()
