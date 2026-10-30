"""Content types (proposal 0006, Part B): the loader.

A content type is a folder content-types/<name>/ in the kit: content-type.yaml (shape: schemas/content-type.schema.json),
fields.schema.json (what the kind adds to item/v1), views.sql (only `CREATE VIEW v_<name> AS ...` statements) and,
for a type with derived fields, derive.py. The type may also declare child tables (one row per element of a list
field, with an optional FTS5 index) and the fields derive.py computes when the store writes an item.
The briefing core reads a type only through this module: `scan` finds the folders and reports every problem,
`load` returns the types or raises, and `check_views` proves that a type's views read nothing but the base
tables, the base view and the type's own tables and views (the same allowlist the agents' sandbox enforces), and
that the columns `describe` documents are the columns the views have.
"""
from __future__ import annotations

import ast
import importlib.util
import json
import re
import sqlite3
import sys
from dataclasses import dataclass
from pathlib import Path

from . import model

FOLDER = "content-types"
YAML, FIELDS, VIEWS, DERIVE = "content-type.yaml", "fields.schema.json", "views.sql", "derive.py"
_CREATE = re.compile(r"(?is)^\s*CREATE\s+VIEW\s+(v_[A-Za-z0-9_]+)\s+AS\s")
_cache: dict = {}
_modules: dict = {}
RESERVED_TABLES = ("items", "item_selectors", "store_meta")      # the store's own; a type's table may not take them


@dataclass(frozen=True)
class ContentType:
    name: str
    kind: str
    version: int
    dir: Path
    fields: dict
    docs: dict        # view name -> {item, includes, fullText, columns} as in content-type.yaml, in file order
    views: tuple      # (view name, CREATE TEMP VIEW statement) in file order
    tables: dict = None           # child table name -> its content-type.yaml entry
    derived: tuple = ()           # the keys derive.py returns
    derive_version: int | None = None

    @property
    def ref(self) -> str:
        return f"{self.name}/v{self.version}"

    def view_names(self) -> list[str]:
        return [v for v, _ in self.views]

    def item_views(self) -> list[str]:
        return [v for v, d in self.docs.items() if d.get("item")]

    def fulltext_views(self) -> dict[str, dict]:
        """Views over a child table's FTS5 index: they exist only with FTS5 and come after the other views."""
        return {v: d["fullText"] for v, d in self.docs.items() if d.get("fullText")}

    def column_docs(self, view: str) -> list[tuple[str, str, str]]:
        """(name, type, description) for describe: the included columns as one line, then the own columns."""
        d = self.docs[view]
        out = [(f"(all {d['includes']['view']} columns)", "", d["includes"]["note"])] if d.get("includes") else []
        return out + [(c["name"], c["type"], c["description"]) for c in d["columns"]]

    # ---- child tables
    def table_names(self, fts: bool = True) -> list[str]:
        """The tables a store made for this type has: each child table and, with FTS5, its `<table>_fts`."""
        return [n for t, s in (self.tables or {}).items() for n in (t, *([f"{t}_fts"] if fts and s.get("fullText") else []))]

    def table_ddl(self, fts: bool) -> list[str]:
        out = []
        for t, s in (self.tables or {}).items():
            cols = ", ".join(f"{c['name']} {c['type']}" + ("" if c.get("nullable") else
                             " NOT NULL DEFAULT " + ("0" if c["type"] == "INTEGER" else "''")) for c in s["columns"])
            out += [f"CREATE TABLE {t} (pk INTEGER PRIMARY KEY, item INTEGER NOT NULL, n INTEGER NOT NULL, {cols}, "
                    f"UNIQUE (item, n))",
                    f"CREATE TRIGGER items_ad_{t} AFTER DELETE ON items BEGIN DELETE FROM {t} WHERE item = old.pk; END"]
            if fts and s.get("fullText"):
                fc = ", ".join(s["fullText"])
                out += [f"CREATE VIRTUAL TABLE {t}_fts USING fts5({fc})",
                        f"CREATE TRIGGER {t}_ai AFTER INSERT ON {t} BEGIN INSERT INTO {t}_fts (rowid, {fc}) "
                        f"VALUES (new.pk, {', '.join('new.' + c for c in s['fullText'])}); END",
                        f"CREATE TRIGGER {t}_ad AFTER DELETE ON {t} BEGIN DELETE FROM {t}_fts WHERE rowid = old.pk; END"]
        return out

    def table_insert(self, table: str) -> str:
        names = [c["name"] for c in self.tables[table]["columns"]]
        return f"INSERT INTO {table} (item, n, {', '.join(names)}) VALUES ({', '.join('?' * (len(names) + 2))})"

    def table_rows(self, table: str, item: dict) -> list[tuple]:
        """(n, column values...) per element of the item's list field; the position n counts skipped elements."""
        s = self.tables[table]
        out = []
        for n, el in enumerate(item.get(s["from"]) or []):
            if not isinstance(el, dict):
                continue
            row = [n]
            for c in s["columns"]:
                v = el.get(c.get("from", c["name"]))
                row.append(v if c.get("nullable") else int(v or 0) if c["type"] == "INTEGER" else str(v or ""))
            out.append(tuple(row))
        return out

    def stored_fields(self, ext: dict) -> dict:
        """`ext` of an item without the element fields that live only in a child table (`moveOut`)."""
        ext = dict(ext)
        for s in (self.tables or {}).values():
            if isinstance(ext.get(s["from"]), list):
                gone = set(s.get("moveOut") or ())
                ext[s["from"]] = [{k: v for k, v in el.items() if k not in gone} if isinstance(el, dict) else el
                                  for el in ext[s["from"]]]
        return ext

    # ---- derived fields
    def derive_module(self):
        """derive.py as a module (loaded once per file state)."""
        f = self.dir / DERIVE
        st = f.stat()
        key = (str(f), st.st_mtime_ns, st.st_size)
        if key not in _modules:
            spec = importlib.util.spec_from_file_location(f"agentbay_contenttype_{self.name}_derive", f)
            mod = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(mod)
            _modules[key] = mod
        return _modules[key]

    def derive(self, item: dict) -> dict:
        """The derived fields of an item of this type ({} for a type that derives nothing)."""
        if not self.derived:
            return {}
        out = self.derive_module().derive(item, self.derive_version)
        if set(out) != set(self.derived):
            raise model.SpecError(f"{model.rel(self.dir / DERIVE)}: derive returned {sorted(out)} but "
                                  f"content-type.yaml derived is {sorted(self.derived)}")
        return out


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
    views, view_errs = _parse_views(d, text)
    out += view_errs
    names = [v for v, _ in views]
    docs = spec["views"]
    tables = spec.get("tables") or {}
    out += _view_doc_problems(d, where, docs, names)
    out += _table_problems(where, tables)
    out += _view_link_problems(where, docs, names, tables)
    derived = tuple(spec.get("derived") or ())
    out += _derived_problems(d, where, spec, derived)
    if out:
        return None, out
    ct = ContentType(meta["name"], spec["kind"], spec["version"], d, fields,
                     {v: docs[v] for v in names}, tuple(views), tables, derived, spec.get("deriveVersion"))
    return ct, []


def _parse_views(d: Path, text: str) -> tuple[list[tuple[str, str]], list[str]]:
    """The (name, CREATE TEMP VIEW statement) of every view views.sql creates, and a problem per other statement."""
    views, out = [], []
    for stmt in _statements(text):
        m = _CREATE.match(stmt)
        if not m:
            out.append(f"{model.rel(d / VIEWS)}: only `CREATE VIEW v_<name> AS SELECT ...` statements are allowed; "
                       f"found `{stmt[:50]}`")
            continue
        views.append((m.group(1), f"CREATE TEMP VIEW {m.group(1)} AS " + stmt[m.end():]))
    return views, out


def _view_doc_problems(d: Path, where: str, docs: dict, names: list[str]) -> list[str]:
    """Every view views.sql creates is documented in content-type.yaml, and the other way round."""
    out = [f"{where}: views.{v} is missing: document every view views.sql creates (columns, item)"
           for v in names if v not in docs]
    out += [f"{where}: views.{v} is documented but {VIEWS} does not create it" for v in docs if v not in names]
    if len(set(names)) != len(names):
        out.append(f"{model.rel(d / VIEWS)}: a view is created twice")
    return out


def _table_problems(where: str, tables: dict) -> list[str]:
    """The declared tables: names the store does not own, unique columns, full-text columns that exist."""
    out = []
    for t, s in tables.items():
        cols = {c["name"] for c in s["columns"]}
        if t in RESERVED_TABLES or t.endswith("_fts") or t.startswith("sqlite_"):
            out.append(f"{where}: tables.{t}: the name is taken by the store or reserved; rename it")
        if len(cols) != len(s["columns"]) or cols & {"pk", "item", "n"}:
            out.append(f"{where}: tables.{t}: column names must be unique and not pk, item or n")
        for c in s.get("fullText") or ():
            if c not in cols:
                out.append(f"{where}: tables.{t}.fullText names {c}, which is not a column")
    return out


def _view_link_problems(where: str, docs: dict, names: list[str], tables: dict) -> list[str]:
    """The views a view includes and the full-text index it declares must exist (and come earlier)."""
    out = []
    for v, dd in docs.items():
        inc = (dd.get("includes") or {}).get("view")
        if inc and inc != "v_items" and (inc not in names or v not in names or names.index(inc) >= names.index(v)):
            out.append(f"{where}: views.{v}.includes.view {inc} must be v_items or a view created earlier in {VIEWS}")
        ft = dd.get("fullText")
        if ft and (ft["table"] not in tables or not tables[ft["table"]].get("fullText") or ft["over"] not in docs):
            out.append(f"{where}: views.{v}.fullText needs a table with fullText and an existing `over` view")
    return out


def _derived_problems(d: Path, where: str, spec: dict, derived: tuple) -> list[str]:
    """`derived`, `deriveVersion` and derive.py go together."""
    has_derive = (d / DERIVE).is_file()
    out = []
    if derived and "deriveVersion" not in spec:
        out.append(f"{where}: derived needs deriveVersion")
    if spec.get("deriveVersion") and not derived:
        out.append(f"{where}: deriveVersion is set but derived is empty")
    if derived and not has_derive:
        out.append(f"{where}: derived is declared but {model.rel(d / DERIVE)} is missing")
    if has_derive and not derived:
        out.append(f"{model.rel(d / DERIVE)}: this type declares no `derived` fields, so derive.py would never run")
    if derived and has_derive:
        out += _derive_problems(d / DERIVE)
    return out


def _derive_problems(f: Path) -> list[str]:
    """derive.py runs inside the writer: standard library imports only, and a `derive(item, version)` function."""
    where = model.rel(f)
    try:
        tree = ast.parse(f.read_text(encoding="utf-8"))
    except (OSError, SyntaxError, ValueError) as e:
        return [f"{where}: not readable as Python ({e})"]
    out = []
    for node in ast.walk(tree):
        mods = ([a.name for a in node.names] if isinstance(node, ast.Import)
                else [node.module or ""] if isinstance(node, ast.ImportFrom) and not node.level else
                ["."] if isinstance(node, ast.ImportFrom) else [])
        for m in mods:
            if m.split(".")[0] not in sys.stdlib_module_names:
                out.append(f"{where}:{node.lineno}: imports `{m}`; derive.py may import only the standard library")
    if not any(isinstance(n, ast.FunctionDef) and n.name == "derive" for n in tree.body):
        out.append(f"{where}: must define derive(item, version)")
    return out


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
        for t in ct.table_names():
            if t in seen:
                problems.append(f"{model.rel(ct.dir / YAML)}: table {t} is already taken by content type {seen[t]}; "
                                f"rename it")
            seen.setdefault(t, ct.name)
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
    """Build the type's views over an empty store (base tables, the type's own tables and v_items only) under the
    read-only authorizer. Problems: a view that reads anything else (another table, a view of another type), uses
    a function the sandbox does not allow, or has other columns than it documents."""
    from . import sqlsandbox as sbx
    con = sqlite3.connect(":memory:")
    fts = sbx.fts5_available()
    allowed = {"items", "item_selectors", "v_items", *ct.view_names(), *ct.table_names(fts)}
    reads: list[str] = []
    problems: list[str] = []
    where = model.rel(ct.dir / VIEWS)
    try:
        for stmt in (*sbx.BASE_DDL, *ct.table_ddl(fts)):
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

        have = {"v_items": [d[0] for d in con.execute("SELECT * FROM v_items LIMIT 0").description]}
        for t in ct.table_names(fts):
            if t.endswith("_fts"):
                con.execute(f"SELECT 1 FROM main.{t} LIMIT 0").fetchall()     # FTS5 connects on first use
        con.set_authorizer(auth)
        for v in ct.view_names():
            if v in ct.fulltext_views() and not fts:
                continue
            reads.clear()
            try:
                cols = [d[0] for d in con.execute(f"SELECT * FROM {v} LIMIT 0").description]
            except sqlite3.Error as e:
                bad = f" (it reads {', '.join(dict.fromkeys(reads))})" if reads else ""
                problems.append(f"{where}: view {v} cannot be built{bad}: {e}. A view may read only the base tables "
                                f"(items, item_selectors), v_items and its own type's tables and views")
                continue
            have[v] = cols
            d = ct.docs[v]
            want = (have.get(d["includes"]["view"], []) if d.get("includes") else []) + [c["name"] for c in d["columns"]]
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


# ----------------------------------------------------------------- views a mode owns
YAML_MODE = "views.yaml"
DETAIL_SHAPES = ("values", "value", "rows")
_PARAM = re.compile(r":([A-Za-z_]\w*)")


@dataclass(frozen=True)
class ModeViews:
    """The views a mode defines over the content types it reads: views.sql (only `CREATE VIEW v_<name> AS ...`)
    and views.yaml (`views`: the documented columns of each; `threads`: how items.store/v1.threads reads one)."""
    dir: Path
    docs: dict        # view name -> {columns}
    views: tuple      # (view name, CREATE TEMP VIEW statement) in file order
    threads: dict | None = None

    def view_names(self) -> list[str]:
        return [v for v, _ in self.views]

    def column_docs(self, view: str) -> list[tuple[str, str, str]]:
        return [(c["name"], c["type"], c["description"]) for c in self.docs[view]["columns"]]


def _mode_one(d: Path) -> tuple[ModeViews | None, list[str]]:
    sql, yml = d / VIEWS, d / YAML_MODE
    out: list[str] = []
    try:
        text = sql.read_text(encoding="utf-8")
        doc = model.load_yaml(yml)
    except (OSError, model.SpecError) as e:
        return None, [f"{model.rel(d)}: a mode that defines views needs {VIEWS} and {YAML_MODE} ({e})"]
    if not isinstance(doc, dict) or not isinstance(doc.get("views"), dict) or set(doc) - {"views", "threads"}:
        return None, [f"{model.rel(yml)}: must be a mapping with `views` (view -> columns) and optionally `threads`"]
    views = []
    for stmt in _statements(text):
        m = _CREATE.match(stmt)
        if not m:
            out.append(f"{model.rel(sql)}: only `CREATE VIEW v_<name> AS SELECT ...` statements are allowed; "
                       f"found `{stmt[:50]}`")
            continue
        views.append((m.group(1), f"CREATE TEMP VIEW {m.group(1)} AS " + stmt[m.end():]))
    names = [v for v, _ in views]
    if len(set(names)) != len(names):
        out.append(f"{model.rel(sql)}: a view is created twice")
    docs = doc["views"]
    for v in names:
        if v not in docs:
            out.append(f"{model.rel(yml)}: views.{v} is missing: document every view {VIEWS} creates")
    for v, dd in docs.items():
        if v not in names:
            out.append(f"{model.rel(yml)}: views.{v} is documented but {VIEWS} does not create it")
        cols = dd.get("columns") if isinstance(dd, dict) else None
        if not cols or not all(isinstance(c, dict) and {"name", "type", "description"} <= set(c) for c in cols):
            out.append(f"{model.rel(yml)}: views.{v}.columns must list {{name, type, description}} entries")
    out += _threads_problems(doc.get("threads"), docs, yml)
    if out:
        return None, out
    return ModeViews(d, {v: docs[v] for v in names}, tuple(views), doc.get("threads")), []


def _threads_problems(th, docs: dict, yml: Path) -> list[str]:
    if th is None:
        return []
    where = f"{model.rel(yml)}: threads"
    if not isinstance(th, dict) or th.get("view") not in docs:
        return [f"{where}.view must name a view documented under `views`"]
    cols = {c["name"] for c in (docs[th["view"]].get("columns") or []) if isinstance(c, dict) and "name" in c}
    out = []
    for key in ("window", "selector", "important"):
        if th.get(key) not in cols:
            out.append(f"{where}.{key} must name a column of {th['view']} (the column the {key} rule reads)")
    for key in ("json", "flags"):
        for c in th.get(key) or []:
            if c not in cols:
                out.append(f"{where}.{key}: {c} is not a column of {th['view']}")
    if not isinstance(th.get("order"), str):
        out.append(f"{where}.order must be an ORDER BY expression over the view's columns")
    for name, det in (th.get("details") or {}).items():
        if not isinstance(det, dict) or det.get("as") not in DETAIL_SHAPES or not isinstance(det.get("sql"), str):
            out.append(f"{where}.details.{name} needs `sql` and `as` (one of {', '.join(DETAIL_SHAPES)})")
            continue
        for p in _PARAM.findall(det["sql"]):
            if p not in cols:
                out.append(f"{where}.details.{name}: parameter :{p} is not a column of {th['view']}")
    return out


def mode_views(dirs) -> ModeViews | None:
    """The views of the mode whose folders are `dirs` (own folder, then each ancestor's; the nearest folder that has
    a views.sql wins), or None. Raises SpecError for a folder whose files are wrong."""
    for d in map(Path, dirs):
        if (d / VIEWS).exists() or (d / YAML_MODE).exists():
            mv, errs = _mode_one(d)
            if errs:
                raise model.SpecError("mode views:\n    " + "\n    ".join(errs))
            return mv
    return None


def mode_problems(dirs, reads, root: Path = model.KIT) -> list[str]:
    """Everything wrong with the views of the mode whose folders are `dirs` and which `reads` the item kinds
    `reads` (`<kind>/v<N>`): the files, the types the views may read, the documented columns and the threads rules."""
    for d in map(Path, dirs):
        if (d / VIEWS).exists() or (d / YAML_MODE).exists():
            mv, errs = _mode_one(d)
            return errs or check_mode_views(mv, reads, root)
    return []


def check_mode_views(mv: ModeViews, reads, root: Path = model.KIT) -> list[str]:
    """Build the mode's views over an empty store of the types it reads under the read-only authorizer. A mode view
    may read only the base views and the views of those types (and the mode's own earlier views): not a table, not
    a view of a type the mode does not read."""
    from . import sqlsandbox as sbx
    have = scan(root)[0]
    kinds = {r.partition("/v")[0] for r in reads}
    types = [ct for ct in have.values() if ct.kind in kinds]
    fts = sbx.fts5_available()
    taken = {v for ct in types for v in (*ct.view_names(), *ct.table_names(fts))} | set(sbx.VIEWS)
    problems = [f"{model.rel(mv.dir / VIEWS)}: view {v} is already taken by the store or a content type the mode "
                f"reads; rename it" for v in mv.view_names() if v in taken]
    own = {v.lower() for v in mv.view_names()}
    readable = {v.lower() for v in (*sbx.VIEWS, *(v for ct in types for v in ct.view_names()), *mv.view_names())}
    con = sqlite3.connect(":memory:")
    reads_seen: list[str] = []
    try:
        stored = _build_empty_store(con, mv, types, fts)
        con.set_authorizer(_mode_view_authorizer(stored, own, readable, reads_seen))
        cols_of = _view_column_problems(con, mv, kinds, reads_seen, problems)
        _threads_query_problems(con, mv, cols_of, reads_seen, problems)
    except sqlite3.Error as e:
        problems.append(f"{model.rel(mv.dir / VIEWS)}: {e}")
    finally:
        con.close()
    return problems


def _build_empty_store(con, mv: ModeViews, types, fts: bool) -> set[str]:
    """Create the store's tables and views, the types' tables and the mode's views in `con`; the lower-cased names
    of everything stored."""
    from . import sqlsandbox as sbx
    for stmt in (*sbx.BASE_DDL, *(s for ct in types for s in ct.table_ddl(fts))):
        con.execute(stmt)
    for _, stmt in sbx.view_sql(fts, types, mv.views):
        con.execute(stmt)
    stored = {n.lower() for (n,) in con.execute(
        "SELECT name FROM main.sqlite_master UNION SELECT name FROM temp.sqlite_master")}
    for ct in types:
        for t in ct.table_names(fts):
            if t.endswith("_fts"):
                con.execute(f"SELECT 1 FROM main.{t} LIMIT 0").fetchall()
    return stored


def _mode_view_authorizer(stored: set[str], own: set[str], readable: set[str], reads_seen: list[str]):
    """The sqlite authorizer of the check: reads outside `readable` and unknown functions are denied and noted."""
    from . import sqlsandbox as sbx

    def auth(action, a1, a2, db, via) -> int:
        if action in (sqlite3.SQLITE_SELECT, 33):
            return sqlite3.SQLITE_OK
        if action == sqlite3.SQLITE_READ:
            t = (a1 or "").lower()
            if (db is None and t not in stored) or t in sbx.TABLE_FUNCS:
                return sqlite3.SQLITE_OK
            if via is None or via.lower() in own:      # read by a mode view (or by the checked query itself)
                if t in readable:
                    return sqlite3.SQLITE_OK
                reads_seen.append(a1)
                return sqlite3.SQLITE_DENY
            return sqlite3.SQLITE_OK                   # inside a view of the store or of a content type
        if action == sqlite3.SQLITE_FUNCTION:
            if (a2 or "").lower() in sbx.FUNCTIONS:
                return sqlite3.SQLITE_OK
            reads_seen.append(f"function {a2}")
            return sqlite3.SQLITE_DENY
        return sqlite3.SQLITE_DENY
    return auth


def _view_column_problems(con, mv: ModeViews, kinds: set[str], reads_seen: list[str],
                          problems: list[str]) -> dict[str, list[str]]:
    """Build each mode view; the columns of those that build, with a problem for each that does not or whose columns
    differ from the documented ones."""
    cols_of: dict[str, list[str]] = {}
    for v in mv.view_names():
        reads_seen.clear()
        try:
            cols_of[v] = [d[0] for d in con.execute(f"SELECT * FROM {v} LIMIT 0").description]
        except sqlite3.Error as e:
            bad = f" (it reads {', '.join(dict.fromkeys(reads_seen))})" if reads_seen else ""
            problems.append(f"{model.rel(mv.dir / VIEWS)}: view {v} cannot be built{bad}: {e}. A mode view may read "
                            f"only the base views (v_items, v_fts) and the views of the content types the mode reads "
                            f"({', '.join(sorted(kinds)) or 'none'})")
            continue
        want = [c["name"] for c in mv.docs[v]["columns"]]
        if cols_of[v] != want:
            problems.append(f"{model.rel(mv.dir / YAML_MODE)}: views.{v} documents columns {want} but the view "
                            f"has {cols_of[v]}")
    return cols_of


def _threads_query_problems(con, mv: ModeViews, cols_of: dict[str, list[str]], reads_seen: list[str],
                            problems: list[str]) -> None:
    """The threads rules: the columns they name exist, and the order and detail queries run."""
    th = mv.threads
    if not th or th["view"] not in cols_of:
        return
    yml = model.rel(mv.dir / YAML_MODE)
    for key in ("window", "selector", "important", *th.get("json", []), *th.get("flags", [])):
        c = th[key] if key in th else key
        if c not in cols_of[th["view"]]:
            problems.append(f"{yml}: threads names column {c}, which {th['view']} does not have")
    queries = {"order": f"SELECT * FROM {th['view']} ORDER BY {th['order']} LIMIT 0",
               **{f"details.{n}": d["sql"] for n, d in (th.get("details") or {}).items()}}
    for name, q in queries.items():
        reads_seen.clear()
        try:
            con.execute(q, {p: None for p in _PARAM.findall(q)}).fetchall()
        except sqlite3.Error as e:
            bad = f" (it reads {', '.join(dict.fromkeys(reads_seen))})" if reads_seen else ""
            problems.append(f"{yml}: threads.{name} cannot run{bad}: {e}")
