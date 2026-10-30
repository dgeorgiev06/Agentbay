"""Content types (proposal 0006, Part B): the loader.

A content type is a folder content-types/<name>/ in the kit: content-type.yaml (shape: schemas/content-type.schema.json),
fields.schema.json (what the kind adds to item/v1) and views.sql (only `CREATE VIEW v_<name> AS ...` statements).
The briefing core reads a type only through this module: `scan` finds the folders and reports every problem,
`load` returns the types or raises, and `check_views` proves that a type's views read nothing but the base
tables, the base view and the type's own views (the same allowlist the agents' sandbox enforces), and that the
columns `describe` documents are the columns the views have.
"""
from __future__ import annotations

import json
import re
import sqlite3
from dataclasses import dataclass
from pathlib import Path

from . import model

FOLDER = "content-types"
YAML, FIELDS, VIEWS = "content-type.yaml", "fields.schema.json", "views.sql"
_CREATE = re.compile(r"(?is)^\s*CREATE\s+VIEW\s+(v_[A-Za-z0-9_]+)\s+AS\s")
_cache: dict = {}


@dataclass(frozen=True)
class ContentType:
    name: str
    kind: str
    version: int
    dir: Path
    fields: dict
    docs: dict        # view name -> {item, includes, columns} as in content-type.yaml, in file order
    views: tuple      # (view name, CREATE TEMP VIEW statement) in file order

    @property
    def ref(self) -> str:
        return f"{self.name}/v{self.version}"

    def view_names(self) -> list[str]:
        return [v for v, _ in self.views]

    def item_views(self) -> list[str]:
        return [v for v, d in self.docs.items() if d.get("item")]

    def column_docs(self, view: str) -> list[tuple[str, str, str]]:
        """(name, type, description) for describe: the included base columns as one line, then the own columns."""
        d = self.docs[view]
        out = [("(all v_items columns)", "", d["includes"]["note"])] if d.get("includes") else []
        return out + [(c["name"], c["type"], c["description"]) for c in d["columns"]]


def _statements(text: str) -> list[str]:
    """views.sql split into statements (a `;` inside a string or a comment does not end one)."""
    out, cur = [], ""
    for line in text.splitlines(keepends=True):
        if not cur and (not line.strip() or line.lstrip().startswith("--")):
            continue
        cur += line
        if sqlite3.complete_statement(cur):
            out.append(cur.strip())
            cur = ""
    if cur.strip():
        out.append(cur.strip())
    return out


def _one(d: Path) -> tuple[ContentType | None, list[str]]:
    where = model.rel(d / YAML)
    try:
        doc = model.load_yaml(d / YAML)
    except model.SpecError as e:
        return None, [str(e)]
    errs = model.schema_errors(doc, model.schema("content-type"))
    if errs:
        return None, [f"{where}: {e}" for e in errs]
    meta, spec = doc["metadata"], doc["spec"]
    out = []
    if meta["name"] != d.name:
        out.append(f"{where}: metadata.name '{meta['name']}' must match the folder name '{d.name}'")
    try:
        fields = json.loads((d / FIELDS).read_text(encoding="utf-8"))
    except (OSError, ValueError) as e:
        return None, [*out, f"{model.rel(d / FIELDS)}: not readable as JSON ({e})"]
    want = f"{spec['kind']}/v{spec['version']}"
    if fields.get("title") != want:
        out.append(f"{model.rel(d / FIELDS)}: title must be '{want}' (the kind and version in {YAML})")
    if not any(isinstance(a, dict) and a.get("$ref") == "item/v1" for a in fields.get("allOf", [])):
        out.append(f"{model.rel(d / FIELDS)}: must extend the base item (allOf: [{{$ref: item/v1}}])")
    try:
        text = (d / VIEWS).read_text(encoding="utf-8")
    except OSError as e:
        return None, [*out, f"{model.rel(d / VIEWS)}: not readable ({e})"]
    views = []
    for stmt in _statements(text):
        m = _CREATE.match(stmt)
        if not m:
            out.append(f"{model.rel(d / VIEWS)}: only `CREATE VIEW v_<name> AS SELECT ...` statements are allowed; "
                       f"found `{stmt[:50]}`")
            continue
        views.append((m.group(1), f"CREATE TEMP VIEW {m.group(1)} AS " + stmt[m.end():]))
    names = [v for v, _ in views]
    docs = spec["views"]
    for v in names:
        if v not in docs:
            out.append(f"{where}: views.{v} is missing: document every view views.sql creates (columns, item)")
    for v in docs:
        if v not in names:
            out.append(f"{where}: views.{v} is documented but {VIEWS} does not create it")
    if len(set(names)) != len(names):
        out.append(f"{model.rel(d / VIEWS)}: a view is created twice")
    if out:
        return None, out
    ct = ContentType(meta["name"], spec["kind"], spec["version"], d, fields,
                     {v: docs[v] for v in names}, tuple(views))
    return ct, []


def scan(root: Path = model.KIT) -> tuple[dict[str, ContentType], list[str]]:
    """Every content type of the kit at `root` and every problem found, by file. Cached while the files stay
    as they are."""
    root = Path(root)
    base = root / FOLDER
    files = sorted(p for p in base.glob(f"*/*") if p.is_file())
    key = (str(root), tuple((str(p), p.stat().st_mtime_ns, p.stat().st_size) for p in files))
    if key in _cache:
        return _cache[key]
    types: dict[str, ContentType] = {}
    problems: list[str] = []
    for y in sorted(base.glob(f"*/{YAML}")):
        ct, errs = _one(y.parent)
        problems += errs
        if ct is not None:
            types[ct.name] = ct
    for d in sorted(p for p in base.glob("*") if p.is_dir() and not (p / YAML).exists()):
        problems.append(f"{model.rel(d)}: a content type folder needs {YAML}")
    from . import sqlsandbox as sbx
    seen: dict[str, str] = {}
    for ct in list(types.values()):
        for v in ct.view_names():
            if v in sbx.VIEWS or v in seen:
                problems.append(f"{model.rel(ct.dir / VIEWS)}: view {v} is already taken "
                                f"({'by the store' if v in sbx.VIEWS else 'by content type ' + seen[v]}); "
                                f"rename it")
            seen.setdefault(v, ct.name)
    _cache.clear()
    _cache[key] = (types, problems)
    return types, problems


def load(root: Path = model.KIT) -> dict[str, ContentType]:
    types, problems = scan(root)
    if problems:
        raise model.SpecError("content types:\n    " + "\n    ".join(problems))
    return types


def item_kinds(root: Path = model.KIT) -> dict[str, set[int]]:
    """kind -> versions of the content types that load (a broken one is a lint problem, not a kind)."""
    out: dict[str, set[int]] = {}
    for ct in scan(root)[0].values():
        out.setdefault(ct.kind, set()).add(ct.version)
    return out


def fields_schema(ref: str, root: Path = model.KIT) -> dict | None:
    """The fields schema of `<name>/v<N>`, or None when no content type has that name and version."""
    name, _, ver = ref.partition("/v")
    ct = scan(root)[0].get(name)
    return ct.fields if ct and ver == str(ct.version) else None


# ----------------------------------------------------------------- views
def check_views(ct: ContentType) -> list[str]:
    """Build the type's views over an empty store (base tables and v_items only) under the read-only authorizer.
    Problems: a view that reads anything else (another table, a view of another type), uses a function the sandbox
    does not allow, or has other columns than it documents."""
    from . import sqlsandbox as sbx
    con = sqlite3.connect(":memory:")
    allowed = {"items", "item_selectors", "v_items", *ct.view_names()}
    reads: list[str] = []
    problems: list[str] = []
    where = model.rel(ct.dir / VIEWS)
    try:
        for stmt in sbx.BASE_DDL:
            con.execute(stmt)
        con.execute(sbx.ITEMS_VIEW)
        for _, stmt in ct.views:
            con.execute(stmt)
        stored = {n.lower() for (n,) in con.execute(
            "SELECT name FROM main.sqlite_master UNION SELECT name FROM temp.sqlite_master")}

        def auth(action, a1, a2, db, _t) -> int:
            if action in (sqlite3.SQLITE_SELECT, 33):
                return sqlite3.SQLITE_OK
            if action == sqlite3.SQLITE_READ:
                t = (a1 or "").lower()
                if (db is None and t not in stored) or t in allowed or t in sbx.TABLE_FUNCS:
                    return sqlite3.SQLITE_OK
                reads.append(a1)
                return sqlite3.SQLITE_DENY
            if action == sqlite3.SQLITE_FUNCTION:
                if (a2 or "").lower() in sbx.FUNCTIONS:
                    return sqlite3.SQLITE_OK
                reads.append(f"function {a2}")
                return sqlite3.SQLITE_DENY
            return sqlite3.SQLITE_DENY

        base_cols = [d[0] for d in con.execute("SELECT * FROM v_items LIMIT 0").description]
        con.set_authorizer(auth)
        for v in ct.view_names():
            reads.clear()
            try:
                cols = [d[0] for d in con.execute(f"SELECT * FROM {v} LIMIT 0").description]
            except sqlite3.Error as e:
                bad = f" (it reads {', '.join(dict.fromkeys(reads))})" if reads else ""
                problems.append(f"{where}: view {v} cannot be built{bad}: {e}. A view may read only the base tables "
                                f"(items, item_selectors), v_items and its own type's views")
                continue
            d = ct.docs[v]
            want = (base_cols if d.get("includes") else []) + [c["name"] for c in d["columns"]]
            if cols != want:
                problems.append(f"{model.rel(ct.dir / YAML)}: views.{v} documents columns {want} but the view has "
                                f"{cols}")
    except sqlite3.Error as e:
        problems.append(f"{where}: {e}")
    finally:
        con.close()
    return problems


def problems(root: Path = model.KIT) -> list[str]:
    """Everything wrong with the content types of the kit at `root` (lint)."""
    types, errs = scan(root)
    out = list(errs)
    for ct in types.values():
        out += check_views(ct)
    return out
