"""Content types (proposal 0006, Part B; 0008 slice 5, part A): the loader, the contract every type meets, the
views a type may define, and the store's record of the types it was made with."""
from __future__ import annotations

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
    assert model.item_kinds(KIT) == {"post": {1}, "email": {1}}          # email: still schemas/data until part B
    assert not list((KIT / "schemas" / "data").glob("post.*"))
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
