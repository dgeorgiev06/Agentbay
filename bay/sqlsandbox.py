"""Read-only SQL over a corpus store (items.store/v1.sql), sandboxed for agents.

Scope is structural, not filtered here: the store file holds exactly the mode's scope (items of the sources
bound to the mode's env that match at least one current selector; corpus-store deletes everything else on
every sync and prune) and no internal state (cursors, budget, coverage, deletions and selectors live in a
separate state.json this connection never opens). So there is nothing out of scope for a query to reach;
this module only keeps queries read-only and bounded:
  1. the connection is opened `mode=ro` and `PRAGMA query_only` is on;
  2. sqlite3's authorizer allows SELECT, reads of the views (v_items, v_fts and the views of the store's content
     types) and the store tables (items, item_selectors, items_fts and the child tables of the store's content
     types with their FTS5 tables), json_each/json_tree, CTEs and an allowlist of functions. It denies writes,
     DDL, ATTACH, PRAGMA, load_extension, sqlite_schema and the FTS shadow tables;
  2b. each query is first prepared as `EXPLAIN <sql>` under that authorizer, and only then runs with FTS5's own
     internal reads of its shadow tables allowed (FTS5 prepares those while the query runs, unattributed);
     a query can therefore never name a shadow table itself;
  2c. a WITH clause may not take the name of any view or table in the store (`shadowing()`), so a name
     always means the stored object, and a read of no column (count(*), which the authorizer reports
     without a database) of a stored table meets the same allowlist as any other read;
  3. resource limits: a progress handler stops a query after `time_ms`; SQLITE_LIMIT_LENGTH caps any one
     value; PRAGMA hard_heap_limit (HEAP_BYTES, process-wide, only ever lowered) caps memory and
     temp_store=FILE sends sorts to disk; rows, bytes and cell length returned are capped.
Results go through vault.redact and secretscan before they leave this module. Errors are SqlError with a
message that says what to change.
"""
from __future__ import annotations

import json
import re
import sqlite3
import time
from pathlib import Path

from . import contenttypes, secretscan, vault

SCHEMA_VERSION = 3          # PRAGMA user_version of a corpus store; any other version is refused
# the views the store itself creates; a content type adds its own (contenttypes.py)
VIEWS = ("v_items", "v_fts")
FTS = "items_fts"
FTS_VIEW = "v_fts"
ITEM_VIEWS = ("v_items",)                                # one row per item (describe samples these)
# the base store tables: every row in them (and in a content type's child tables) is in the mode's scope
BASE_TABLES = ("items", "item_selectors")
TABLE_FUNCS = ("json_each", "json_tree")
SCHEMA_TABLES = {"sqlite_master", "sqlite_schema", "sqlite_temp_master", "sqlite_temp_schema"}
FUNCTIONS = frozenset("""
abs avg bm25 char coalesce count date datetime glob group_concat hex highlight ifnull iif instr json json_array
json_array_length json_extract json_group_array json_group_object json_object json_quote json_type json_valid
julianday length like likelihood lower ltrim match max min nullif round rtrim snippet strftime substr substring
sum time total trim typeof unicode unixepoch upper replace -> ->> row_number rank dense_rank percent_rank
cume_dist ntile lag lead first_value last_value nth_value
""".split())
# deliberately absent: load_extension, randomblob/zeroblob (memory), printf/format (width bombs), sqlite_*.

ACTIONS = {1: "CREATE INDEX", 2: "CREATE TABLE", 3: "CREATE TEMP INDEX", 4: "CREATE TEMP TABLE",
           5: "CREATE TEMP TRIGGER", 6: "CREATE TEMP VIEW", 7: "CREATE TRIGGER", 8: "CREATE VIEW", 9: "DELETE",
           10: "DROP INDEX", 11: "DROP TABLE", 12: "DROP TEMP INDEX", 13: "DROP TEMP TABLE",
           14: "DROP TEMP TRIGGER", 15: "DROP TEMP VIEW", 16: "DROP TRIGGER", 17: "DROP VIEW", 18: "INSERT",
           19: "PRAGMA", 20: "READ", 21: "SELECT", 22: "TRANSACTION", 23: "UPDATE", 24: "ATTACH", 25: "DETACH",
           26: "ALTER TABLE", 27: "REINDEX", 28: "ANALYZE", 29: "CREATE VTABLE", 30: "DROP VTABLE",
           31: "FUNCTION", 32: "SAVEPOINT", 33: "RECURSIVE"}

DEFAULT_ROWS, MAX_ROWS = 200, 1000
MAX_BYTES = 200_000
CELL_CHARS = 4000
TIME_MS = 2000
MAX_VALUE = 1_000_000
HEAP_BYTES = 256 * 1024 * 1024

ITEM_COLUMNS = [
    ("id", "TEXT", "item id <source>:<extId>; cite this"), ("source", "TEXT", "x, fake, gmail, ..."),
    ("extId", "TEXT", "the source's own id"), ("kind", "TEXT", "post, email, ..."),
    ("author", "TEXT", "handle or address"), ("authorName", "TEXT", "display name"),
    ("title", "TEXT", "subject or headline (null for posts)"), ("text", "TEXT", "body"),
    ("url", "TEXT", "link to the original (cite it as stored)"), ("createdAt", "TEXT", "ISO-8601 UTC, sortable"),
    ("fetchedAt", "TEXT", "ISO-8601 UTC"), ("container", "TEXT", "where it was fetched from (home, list:<id>)"),
    ("labels", "JSON", "array of containers/labels; filter with json_each(labels)"),
    ("threadId", "TEXT", "thread or conversation id"),
    ("matched", "JSON", "array of selector ids the item matches; filter with json_each(matched)"),
    ("rid", "INTEGER", "row id (= items_fts.rowid)"),
]
COLUMNS = {   # what describe tells agents, for the views above; a content type documents its own views
    "v_items": ITEM_COLUMNS,
    "v_fts": [
        ("(all v_items columns)", "", "same scope as v_items"),
        ("fts", "MATCH", "full-text target: WHERE fts MATCH 'staking AND \"proof of stake\"'"),
        ("rank", "REAL", "relevance (bm25); ORDER BY rank puts the best match first"),
        ("snippet", "TEXT", "the matching part of the text, matches in [brackets]"),
    ],
}


class SqlError(Exception):
    """A query the sandbox refused or could not run; the message says what to change."""


def fts5_available() -> bool:
    try:
        c = sqlite3.connect(":memory:")
        c.execute("CREATE VIRTUAL TABLE t USING fts5(x)")
        c.close()
        return True
    except sqlite3.OperationalError:
        return False


def _item_select() -> str:
    return """SELECT
            i.source || ':' || i.ext_id AS id, i.source AS source, i.ext_id AS extId, i.kind AS kind,
            i.author AS author, i.author_name AS authorName, i.title AS title, i.body AS text, i.url AS url,
            i.created_at AS createdAt, i.fetched_at AS fetchedAt, i.container AS container, i.labels AS labels,
            i.thread_id AS threadId,
            (SELECT json_group_array(selector) FROM
               (SELECT s.selector FROM main.item_selectors s WHERE s.item = i.pk ORDER BY s.selector)) AS matched,
            i.pk AS rid"""


BASE_DDL = (   # the item tables every store has; the store adds its triggers and the full-text tables
    """CREATE TABLE items (
         pk INTEGER PRIMARY KEY, source TEXT NOT NULL, ext_id TEXT NOT NULL, kind TEXT NOT NULL,
         author TEXT, author_name TEXT, title TEXT, body TEXT NOT NULL DEFAULT '', url TEXT,
         created_at TEXT NOT NULL, fetched_at TEXT NOT NULL, container TEXT,
         labels TEXT NOT NULL DEFAULT '[]', thread_id TEXT, ext TEXT NOT NULL DEFAULT '{}',
         derived TEXT NOT NULL DEFAULT '{}', UNIQUE (source, ext_id))""",
    "CREATE INDEX items_created ON items (created_at)",
    "CREATE INDEX items_author ON items (author)",
    "CREATE INDEX items_thread ON items (source, thread_id)",
    """CREATE TABLE item_selectors (item INTEGER NOT NULL, selector TEXT NOT NULL,
         PRIMARY KEY (item, selector)) WITHOUT ROWID""",
    "CREATE INDEX item_selectors_selector ON item_selectors (selector)",
)
ITEMS_VIEW = f"CREATE TEMP VIEW v_items AS {_item_select()} FROM main.items i"


def store_types(con: sqlite3.Connection) -> list[contenttypes.ContentType]:
    """The content types a store was made with (store_meta), as the kit has them now. A store whose type is gone
    or has another version is refused: stores are never converted."""
    held = dict(con.execute("SELECT substr(key, 6), value FROM main.store_meta WHERE key LIKE 'type:%' ORDER BY key"))
    try:
        have = contenttypes.load()
    except Exception as e:
        raise SqlError(str(e)) from None
    out = []
    for name, ver in held.items():
        if name not in have or str(have[name].version) != ver:
            now = f"the kit has v{have[name].version}" if name in have else "the kit has no such type"
            raise SqlError(f"this store holds content type {name} v{ver}, but {now}; stores are never converted: "
                           f"move the folder aside and sync again")
        out.append(have[name])
    return out


FTS_VIEW_SQL = f"""CREATE TEMP VIEW v_fts AS SELECT v.*, f.{FTS} AS fts, f.rank AS rank,
            snippet({FTS}, 1, '[', ']', '…', 16) AS snippet
          FROM main.{FTS} f JOIN temp.v_items v ON v.rid = f.rowid"""


def view_sql(fts: bool, types: list[contenttypes.ContentType]) -> list[tuple[str, str]]:
    """(name, CREATE statement) of the views over the store (which holds only the mode's scope), in the order
    describe lists them: v_items, the content types' views, v_fts (FTS5 only: items_fts joined to v_items, the
    simplest documented way to search, with rank and snippet as columns), then the types' full-text views."""
    full = {v for ct in types for v in ct.fulltext_views()}
    own = [(v, sql) for ct in types for v, sql in ct.views if v not in full]
    return [("v_items", ITEMS_VIEW), *own, *([(FTS_VIEW, FTS_VIEW_SQL)] if fts else []),
            *([(v, sql) for ct in types for v, sql in ct.views if v in full] if fts else [])]


def connect_ro(path: Path) -> sqlite3.Connection:
    """Read-only connection with the temp views and resource limits. Raises SqlError when there is no store."""
    path = Path(path)
    if not path.exists():
        raise SqlError("the store is empty: run the mode's sync endpoint first")
    con = sqlite3.connect(path.resolve().as_uri() + "?mode=ro", uri=True, check_same_thread=False)
    try:
        cur = con.execute("PRAGMA hard_heap_limit").fetchone()[0]
        if not cur or cur > HEAP_BYTES:
            con.execute(f"PRAGMA hard_heap_limit = {HEAP_BYTES}")
        con.execute("PRAGMA temp_store = FILE")
        ver = con.execute("PRAGMA main.user_version").fetchone()[0]
        if ver != SCHEMA_VERSION:
            raise SqlError(version_error(path, ver))
        # kept on purpose: refusing a pre-release store fails closed for the scope invariant
        if con.execute("SELECT 1 FROM main.sqlite_master WHERE name = 'state'").fetchone():
            raise SqlError(f"{path}: written by a pre-release build (internal state inside corpus.db); move the "
                           f"folder aside and sync again")
        fts = has_fts(con)
        types = store_types(con)
        for _, stmt in view_sql(fts, types):
            con.execute(stmt)
        for t in fts_tables(fts, types):
            # FTS5 reads its config table when the table first connects, which happens while a statement is
            # prepared: connect it now, so a query naming an FTS table never trips the strict pre-pass
            con.execute(f"SELECT 1 FROM main.{t} LIMIT 0").fetchall()
        con.execute("PRAGMA query_only = ON")
    except SqlError:
        con.close()
        raise
    except sqlite3.Error as e:
        con.close()
        raise SqlError(f"the store at {path.name} is not readable ({e}); move it aside and sync again") from None
    return con


def version_error(path, ver: int) -> str:
    """Why a store of another schema version is refused (stores are never converted)."""
    if ver > SCHEMA_VERSION:
        return f"{path}: store schema v{ver} is newer than this kit (v{SCHEMA_VERSION}); update agentbay"
    return (f"{path}: store schema v{ver} is older than this kit (v{SCHEMA_VERSION}) and is never converted; move "
            f"the folder aside and sync again")


def has_fts(con: sqlite3.Connection) -> bool:
    """Whether the store was created with FTS5 (items_fts and the types' FTS5 tables); without it the full-text
    views are missing and search falls back to LIKE."""
    return con.execute("SELECT 1 FROM main.sqlite_master WHERE name = ?", (FTS,)).fetchone() is not None


def views_of(fts: bool, types: list[contenttypes.ContentType]) -> list[str]:
    """The views a read-only connection has, in describe order (no full-text views without FTS5)."""
    return [v for v, _ in view_sql(fts, types)]


def tables_of(fts: bool, types: list[contenttypes.ContentType]) -> list[str]:
    """The tables a read-only connection may read: the base tables, the types' child tables, then the FTS5
    tables (items_fts and the types')."""
    plain = [t for ct in types for t in ct.table_names(False)]
    return [*BASE_TABLES, *plain, *fts_tables(fts, types)]


def fts_tables(fts: bool, types: list[contenttypes.ContentType]) -> list[str]:
    """The FTS5 tables of a store: items_fts and each type's `<table>_fts`."""
    return [FTS, *(t for ct in types for t in ct.table_names(True) if t.endswith("_fts"))] if fts else []


class Sandbox:
    """One agent query at a time over approved views. Use run(); every result is redacted and scanned."""

    def __init__(self, path: Path, *, time_ms: int = TIME_MS, max_bytes: int = MAX_BYTES):
        self.con = connect_ro(path)
        self.fts = has_fts(self.con)
        types = store_types(self.con)
        self.views = views_of(self.fts, types)
        self.tables = tables_of(self.fts, types)
        self.shadow = {f"{t}_{x}" for t in fts_tables(self.fts, types)
                       for x in ("data", "idx", "content", "docsize", "config")}
        self.time_ms, self.max_bytes = time_ms, max_bytes
        # every name the file and the temp views define, read before the authorizer is on. A read of no column
        # reports db None both for a stored table and for a CTE; a CTE may not take a stored name (shadowing),
        # so a db-None read naming one of these is the stored object and goes through the allowlist
        self.stored = {n.lower() for (n,) in self.con.execute(
            "SELECT name FROM main.sqlite_master UNION SELECT name FROM temp.sqlite_master")} | SCHEMA_TABLES
        self.denied: list[str] = []
        self.strict = True
        for lim, val in (("SQLITE_LIMIT_LENGTH", MAX_VALUE), ("SQLITE_LIMIT_SQL_LENGTH", 20000),
                         ("SQLITE_LIMIT_ATTACHED", 0)):
            if hasattr(self.con, "setlimit") and hasattr(sqlite3, lim):
                self.con.setlimit(getattr(sqlite3, lim), val)
        self.con.set_authorizer(self._authorize)

    def close(self) -> None:
        self.con.close()

    def _deny(self, why: str) -> int:
        self.denied.append(why)
        return sqlite3.SQLITE_DENY

    def _only(self) -> str:
        return ", ".join([*self.views, *self.tables])

    def _authorize(self, action, a1, a2, db, _trigger) -> int:
        if action == sqlite3.SQLITE_SELECT or action == 33:          # SELECT, WITH RECURSIVE (time-limited)
            return sqlite3.SQLITE_OK
        if action == sqlite3.SQLITE_READ:
            table = (a1 or "").lower()
            if db is None and table not in self.stored:
                return sqlite3.SQLITE_OK      # a CTE (recursive or materialized) read without columns
            if table in self.views and db in ("temp", None):
                return sqlite3.SQLITE_OK
            if table in self.tables and db in ("main", None):
                return sqlite3.SQLITE_OK
            if table in TABLE_FUNCS:
                return sqlite3.SQLITE_OK
            if table in self.shadow and db == "main" and not self.strict:
                return sqlite3.SQLITE_OK      # FTS5's own statements while the (already vetted) query runs
            return self._deny(f"reading `{a1}` is not allowed; query only {self._only()}")
        if action == sqlite3.SQLITE_FUNCTION:
            name = (a2 or "").lower()
            if name in FUNCTIONS:
                return sqlite3.SQLITE_OK
            return self._deny(f"function `{a2}` is not allowed (allowed: {', '.join(sorted(FUNCTIONS))})")
        if action == sqlite3.SQLITE_PRAGMA and (a1 or "").lower() == "data_version" and a2 is None:
            return sqlite3.SQLITE_OK                                   # FTS5 issues this internally
        return self._deny(f"{ACTIONS.get(action, f'action {action}')} is not allowed: this is a read-only "
                          f"SELECT over {self._only()}")

    def run(self, sql: str, limit: int | None = None) -> dict:
        limit = max(1, min(int(limit or DEFAULT_ROWS), MAX_ROWS))
        self.denied = []
        shadow = shadowing(sql, self.stored)
        if shadow:
            raise SqlError(f"query refused: a WITH clause may not be named `{shadow}` (the name of a view or table "
                           f"in the store); rename the CTE")
        deadline = time.monotonic() + self.time_ms / 1000
        self.con.set_progress_handler(lambda: 1 if time.monotonic() > deadline else 0, 1000)
        rows, size, truncated = [], 0, None
        try:
            self.strict = True
            self.con.execute("EXPLAIN " + sql).fetchall()       # vet the statement's own references, run nothing
            self.strict = False
            cur = self.con.execute(sql)
            cols = [d[0] for d in cur.description or []]
            while True:
                batch = cur.fetchmany(100)
                if not batch:
                    break
                for r in batch:
                    if len(rows) >= limit:
                        truncated = f"row cap {limit} reached; add LIMIT/WHERE or aggregate"
                        break
                    row = [_cell(v) for v in r]
                    size += len(json.dumps(row, ensure_ascii=False))
                    if size > self.max_bytes:
                        truncated = f"byte cap {self.max_bytes} reached; select fewer or shorter columns"
                        break
                    rows.append(row)
                if truncated:
                    break
        except sqlite3.ProgrammingError as e:
            if "one statement" in str(e):
                raise SqlError("send exactly one SELECT statement per call (remove the `;` and what follows)") from None
            raise SqlError(f"SQL error: {e}") from None
        except (sqlite3.Error, MemoryError) as e:
            raise SqlError(self._explain(e)) from None
        finally:
            self.strict = True
            self.con.set_progress_handler(None, 0)
        out = {"columns": cols, "rows": rows, "rowCount": len(rows), "truncated": truncated}
        return clean(out)

    def _explain(self, e) -> str:
        msg = str(e) or type(e).__name__
        low = msg.lower()
        if self.denied:
            return f"query refused: {self.denied[0]}. Run items.store/v1.describe for the views and columns."
        if "not authorized" in low or "prohibited" in low:
            return f"query refused ({msg}); only read-only SELECTs over {self._only()} are allowed"
        if "out of memory" in low or isinstance(e, MemoryError):
            return (f"query stopped: it needed more than {HEAP_BYTES // (1024 * 1024)} MB of memory; aggregate, add "
                    f"WHERE/LIMIT, or select shorter columns")
        if "interrupted" in low:
            return (f"query stopped after the {self.time_ms} ms time limit; narrow it with WHERE on createdAt, add "
                    f"LIMIT, and avoid cross joins and unbounded recursive CTEs")
        if "fts5" in low or ("syntax error" in low and "match" in low) or "unterminated string" in low \
                or ("no such column" in low and FTS in low) or "unable to use function match" in low:
            return (f"full-text MATCH error ({msg}); use {FTS_VIEW} with `WHERE fts MATCH '...'` and quote phrases and "
                    f"words with special characters in double quotes, e.g. fts MATCH '\"proof of stake\" OR solana'")
        if "too big" in low:
            return f"a value exceeded {MAX_VALUE} bytes ({msg}); select shorter values or use substr()"
        if "readonly" in low or "read-only" in low:
            return "the store is read-only here: use SELECT only"
        if "no such table" in low:
            return f"{msg}; you can query {self._only()}"
        return f"SQL error: {msg}. Run items.store/v1.describe for column names."


def _bare(sql: str) -> str:
    """The SQL with string literals and comments removed and quoted identifiers unquoted (SQLite's lexical
    rules: '..' strings with '' escapes, "..", [..] and `..` identifiers, -- and /* */ comments)."""
    out, i, n = [], 0, len(sql)
    while i < n:
        c = sql[i]
        if c == "'":
            j = i + 1
            while j < n and not (sql[j] == "'" and (j + 1 >= n or sql[j + 1] != "'")):
                j += 2 if sql[j] == "'" else 1
            out.append(" '' ")
            i = j + 1
        elif c in '"`[':
            close = "]" if c == "[" else c
            j = sql.find(close, i + 1)
            j = n if j < 0 else j
            out.append(" " + sql[i + 1:j] + " ")
            i = j + 1
        elif sql.startswith("--", i):
            j = sql.find("\n", i)
            i = n if j < 0 else j
            out.append(" ")
        elif sql.startswith("/*", i):
            j = sql.find("*/", i + 2)
            i = n if j < 0 else j + 2
            out.append(" ")
        else:
            out.append(c)
            i += 1
    return "".join(out)


_WITH = re.compile(r"(?i)\bWITH\b")


def shadowing(sql: str, names) -> str | None:
    """Which of `names` (the store's views and tables) a WITH clause in `sql` defines, or None (no WITH, no
    check)."""
    bare = _bare(sql)
    w = _WITH.search(bare)
    if not w:
        return None
    cte = re.compile(r"(?i)(?<![\w$])(" + "|".join(re.escape(x) for x in sorted(names, key=len, reverse=True)) +
                     r")\s*(\([^()]*\))?\s*AS\s*(NOT\s+)?(MATERIALIZED\s*)?\(")
    m = cte.search(bare, w.start())
    return m.group(1) if m else None


def _cell(v):
    if isinstance(v, bytes):
        return f"<blob {len(v)} bytes>"
    if isinstance(v, str) and len(v) > CELL_CHARS:
        return v[:CELL_CHARS] + f"…[cut {len(v) - CELL_CHARS} chars; use substr()]"
    return v


def clean(obj):
    """vault.redact, then the pattern secret scan: what every `use` read gets."""
    return secretscan.scrub_obj(json.loads(vault.redact(json.dumps(obj, ensure_ascii=False))))
