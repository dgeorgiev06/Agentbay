"""Read-only SQL over a corpus store (items.store/v1.sql), sandboxed for agents.

Layers, each enough on its own to stop writes:
  1. the connection is opened `mode=ro` and `PRAGMA query_only` is on;
  2. sqlite3's authorizer allows only SELECT, reads of the approved views (v_items, v_posts, v_fts),
     json_each/json_tree, CTEs and an allowlist of functions. Base tables and the full-text table are
     readable only from inside an approved view, so every result is scoped to the env's bound sources and to
     items matching a selector. ATTACH, PRAGMA, writes, DDL, load_extension, sqlite_master, the FTS shadow
     tables and the store's internal tables (state, ...) are denied;
  2b. each query is first prepared as `EXPLAIN <sql>` under the strict authorizer above. Only then does it run,
     with FTS5's own internal reads of its shadow tables allowed (FTS5 prepares those statements while the
     query runs, and they reach the authorizer unattributed). A query cannot name items_fts or a shadow
     table itself, because the strict pass already refused it;
  2c. a WITH clause may not be named like an approved view or a store table (`shadowing()`): inside a CTE
     the authorizer reports the CTE's name as the enclosing "view", so `WITH v_items AS (SELECT * FROM
     items)` would otherwise read the base table unfiltered;
  3. resource limits: a progress handler stops a query after `time_ms`; SQLITE_LIMIT_LENGTH caps any one
     value; PRAGMA hard_heap_limit (HEAP_BYTES, process-wide, only ever lowered) caps memory and
     temp_store=FILE sends sorts to disk; rows, bytes and cell length returned are capped.
Results go through vault.redact and secretscan before they leave this module. Errors are SqlError with a
message that says what to change.

The views are TEMP views created per connection, so they can be limited to the sources bound in the
caller's env (offline sample items never mix into real answers) and always match this code's version.
"""
from __future__ import annotations

import json
import re
import sqlite3
import time
from pathlib import Path

from . import secretscan, vault

VIEWS = ("v_items", "v_posts", "v_fts")
FTS = "items_fts"
FTS_VIEW = "v_fts"
FTS_SHADOW = tuple(f"{FTS}_{x}" for x in ("data", "idx", "content", "docsize", "config"))
VIA_VIEW = ("items", "item_selectors")          # base tables, readable only from inside an approved view
TABLE_FUNCS = ("json_each", "json_tree")
FUNCTIONS = frozenset("""
abs avg bm25 char coalesce count date datetime glob group_concat hex highlight ifnull iif instr json json_array
json_array_length json_extract json_group_array json_group_object json_object json_quote json_type json_valid
julianday length like likelihood lower ltrim match max min nullif round rtrim snippet strftime substr substring
sum time total trim typeof unicode unixepoch upper replace -> ->> row_number rank dense_rank percent_rank
cume_dist ntile lag lead first_value last_value nth_value
""".split())
# deliberately absent: load_extension, randomblob/zeroblob (memory), printf/format (width bombs), sqlite_*.
# snippet/highlight/bm25 need the FTS table itself as an argument, so agents reach them only through v_fts.

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
    ("rid", "INTEGER", "row id"),
]
COLUMNS = {   # what describe tells agents; keep in step with view_sql()
    "v_items": ITEM_COLUMNS,
    "v_posts": [
        ("(all v_items columns)", "", "kind = 'post' only"), ("lang", "TEXT", "language code"),
        ("metrics", "JSON", "engagement counts"), ("likes", "INTEGER", "metrics.like_count"),
        ("reposts", "INTEGER", "metrics.retweet_count"), ("replies", "INTEGER", "metrics.reply_count"),
    ],
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


def _quote(s: str) -> str:
    return "'" + str(s).replace("'", "''") + "'"


def _item_select() -> str:
    return f"""SELECT
            i.source || ':' || i.ext_id AS id, i.source AS source, i.ext_id AS extId, i.kind AS kind,
            i.author AS author, i.author_name AS authorName, i.title AS title, i.body AS text, i.url AS url,
            i.created_at AS createdAt, i.fetched_at AS fetchedAt, i.container AS container, i.labels AS labels,
            i.thread_id AS threadId,
            (SELECT json_group_array(selector) FROM
               (SELECT s.selector FROM main.item_selectors s WHERE s.item = i.pk ORDER BY s.selector)) AS matched,
            i.pk AS rid"""


def view_sql(sources: list[str] | None, fts: bool = False) -> list[str]:
    """v_items: the scope (bound sources, matching a selector). v_posts is built from main.items with the same
    scope and columns (no re-join, so any projection works). v_fts (FTS5 only) is v_items joined to items_fts."""
    where = "EXISTS (SELECT 1 FROM main.item_selectors s WHERE s.item = i.pk)"
    if sources:
        where += f" AND i.source IN ({', '.join(_quote(s) for s in sorted(sources))})"
    out = [
        f"CREATE TEMP VIEW v_items AS {_item_select()} FROM main.items i WHERE {where}",
        f"""CREATE TEMP VIEW v_posts AS {_item_select()},
            json_extract(i.ext, '$.lang') AS lang, json_extract(i.ext, '$.metrics') AS metrics,
            json_extract(i.ext, '$.metrics.like_count') AS likes,
            json_extract(i.ext, '$.metrics.retweet_count') AS reposts,
            json_extract(i.ext, '$.metrics.reply_count') AS replies
          FROM main.items i WHERE i.kind = 'post' AND {where}""",
    ]
    if fts:
        out.append(f"""CREATE TEMP VIEW v_fts AS SELECT v.*, f.{FTS} AS fts, f.rank AS rank,
            snippet({FTS}, 1, '[', ']', '…', 16) AS snippet
          FROM main.{FTS} f JOIN temp.v_items v ON v.rid = f.rowid""")
    return out


def connect_ro(path: Path, sources: list[str] | None = None) -> sqlite3.Connection:
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
        for stmt in view_sql(sources, has_fts(con)):
            con.execute(stmt)
        con.execute("PRAGMA query_only = ON")
    except sqlite3.Error as e:
        con.close()
        raise SqlError(f"the store at {path.name} is not readable ({e}); run `bay migrate` or sync") from None
    return con


def has_fts(con: sqlite3.Connection) -> bool:
    return con.execute("SELECT 1 FROM main.sqlite_master WHERE name = ?", (FTS,)).fetchone() is not None


class Sandbox:
    """One agent query at a time over approved views. Use run(); every result is redacted and scanned."""

    def __init__(self, path: Path, sources: list[str] | None = None, *, time_ms: int = TIME_MS,
                 max_bytes: int = MAX_BYTES):
        self.con = connect_ro(path, sources)
        self.fts = has_fts(self.con)
        self.views = [v for v in VIEWS if v != FTS_VIEW or self.fts]
        self.time_ms, self.max_bytes = time_ms, max_bytes
        self.denied: list[str] = []
        self.strict = True
        self.via_fts_view = False
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
        return ", ".join(self.views)

    def _authorize(self, action, a1, a2, db, view) -> int:
        if action == sqlite3.SQLITE_SELECT or action == 33:          # SELECT, WITH RECURSIVE (time-limited)
            return sqlite3.SQLITE_OK
        if action == sqlite3.SQLITE_READ:
            table = (a1 or "").lower()
            if db is None:            # a CTE or subquery result, not a stored table
                if table in VIEWS or table in VIA_VIEW or table == FTS or table in FTS_SHADOW:
                    # named like an approved view, base reads inside it would look view-scoped
                    return self._deny(f"a WITH clause may not be named `{a1}` (an approved view or store table "
                                      f"name); rename the CTE")
                return sqlite3.SQLITE_OK
            if table in self.views and db == "temp":
                return sqlite3.SQLITE_OK
            if table in VIA_VIEW and db == "main" and view in VIEWS:
                return sqlite3.SQLITE_OK
            if table in TABLE_FUNCS:
                return sqlite3.SQLITE_OK
            if self.fts and db == "main" and table == FTS and view == FTS_VIEW:
                self.via_fts_view = True
                return sqlite3.SQLITE_OK
            if self.fts and db == "main" and table == FTS and not a2 and self.via_fts_view:
                # a flattened count(*) over v_fts reports an unattributed read of no column (row existence
                # only, no data); allowed only when this statement reads items_fts through v_fts
                return sqlite3.SQLITE_OK
            if self.fts and db == "main" and (table == FTS or table in FTS_SHADOW) and not self.strict:
                return sqlite3.SQLITE_OK      # FTS5's own statements while the (already vetted) query runs
            if table == FTS or table in FTS_SHADOW:
                return self._deny(f"reading `{a1}` directly is not allowed; search through {FTS_VIEW} "
                                  f"(WHERE fts MATCH '...' ORDER BY rank), which keeps results in scope")
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
        self.via_fts_view = False
        shadow = shadowing(sql)
        if shadow:
            raise SqlError(f"query refused: a WITH clause may not be named `{shadow}` (an approved view or store "
                           f"table name); rename the CTE")
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
            return f"{msg}; the queryable views are {self._only()}"
        return f"SQL error: {msg}. Run items.store/v1.describe for column names."


PROTECTED_NAMES = (*VIEWS, *VIA_VIEW, FTS, *FTS_SHADOW, "state")


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


_CTE = re.compile(r"(?i)\b(" + "|".join(re.escape(x) for x in PROTECTED_NAMES) +
                  r")\s*(\([^()]*\))?\s*AS\s*(NOT\s+)?(MATERIALIZED\s*)?\(")


_WITH = re.compile(r"(?i)\bWITH\b")


def shadowing(sql: str) -> str | None:
    """Name of a protected view/table that a WITH clause in `sql` redefines, or None (no WITH, no check)."""
    bare = _bare(sql)
    w = _WITH.search(bare)
    if not w:
        return None
    m = _CTE.search(bare, w.start())
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
