"""The content type contract (framework/components.yaml, contract `contentType`): what every folder
content-types/<name>/ must satisfy, run by tests/test_content_types.py against each type the kit finds.

    check(root, name) -> list of problems (empty: the contract holds)

A type loads (shape, fields schema, views.sql), has a README, ships fixtures that validate against its fields
schema, and its views build under the sandbox's read-only rules, document the columns they have and return one
row per fixture item of the kind when they are item views."""
from __future__ import annotations

import importlib.util
import json
import sqlite3
import sys
from pathlib import Path

from bay import contenttypes, model, sqlsandbox as sbx

STORE = Path(__file__).resolve().parents[2] / "framework" / "connectors" / "corpus-store" / "corpus_store.py"


def _store_module():
    spec = importlib.util.spec_from_file_location("contract_corpus_store", STORE)
    mod = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = mod            # its dataclasses look their module up here
    spec.loader.exec_module(mod)
    return mod


def check(root: Path, name: str) -> list[str]:
    types, found = contenttypes.scan(root)
    if name not in types:
        return [*found, f"content type {name} did not load"]
    ct = types[name]
    out = [p for p in found if f"/{name}/" in p] + contenttypes.check_views(ct)
    if not (ct.dir / "README.md").is_file():
        out.append(f"{model.rel(ct.dir)}: README.md is missing (what the type is, its fields, its views)")
    fx = ct.dir / "fixtures" / "items.json"
    try:
        items = json.loads(fx.read_text(encoding="utf-8"))
    except (OSError, ValueError) as e:
        return [*out, f"{model.rel(fx)}: fixtures are missing or not JSON ({e})"]
    if not isinstance(items, list) or not items:
        return [*out, f"{model.rel(fx)}: must be a non-empty list of items of kind {ct.kind}"]
    schema = model.inline_refs(ct.fields)
    for it in items:
        errs = model.schema_errors(it, schema)
        if errs or it.get("kind") != ct.kind:
            out.append(f"{model.rel(fx)}: item {it.get('id')} does not match {ct.ref}: "
                       f"{'; '.join(errs[:3]) or 'wrong kind'}")
    if out:
        return out
    store = _store_module()
    con = sqlite3.connect(":memory:")
    try:
        for stmt in sbx.BASE_DDL:
            con.execute(stmt)
        for it in items:
            row = store.item_row(it)
            con.execute(f"INSERT INTO items ({', '.join(row)}) VALUES ({', '.join('?' * len(row))})", list(row.values()))
        con.execute(sbx.ITEMS_VIEW)
        for _, sql in ct.views:
            con.execute(sql)
        for v in ct.item_views():
            n = con.execute(f"SELECT count(*) FROM {v}").fetchone()[0]
            if n != len(items):
                out.append(f"{model.rel(ct.dir / contenttypes.VIEWS)}: item view {v} returns {n} rows for "
                           f"{len(items)} fixture items")
    except sqlite3.Error as e:
        out.append(f"{model.rel(ct.dir)}: the views fail over the fixtures: {e}")
    finally:
        con.close()
    return out
