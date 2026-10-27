"""corpus-store: items.store/v1 on one SQLite file per mode (stdlib sqlite3).

File: <env write path>/<mode>/corpus.db (e.g. .agentbay/data/feeds/feed-briefing/corpus.db), one per mode
so two briefing modes on one env never share selector tags; WAL mode; the file, -wal and -shm are 0600.
Schema version in PRAGMA user_version (SCHEMA_VERSION); older stores are converted by `forge.migrate`.

  items           one row per item, unique on (source, ext_id); kind-specific fields in `ext` (JSON)
  item_selectors  (item, selector): the selector ids an item matches (the shared matcher decides)
  items_fts       FTS5 over title, body and author, kept in step by triggers (own content, so agents can
                  query it without being allowed to read `items` directly). Missing when this Python's
                  SQLite has no FTS5: search then falls back to LIKE, and `bay validate` says so.
  (every item string but its identity is secret-scrubbed before it is stored; every read is scrubbed again)
  state           key -> JSON: cursors (per connector and native query), coverage, budget (per UTC month),
                  deleted (<source>:<extId> never re-stored), checked (last deletion check), selectors
                  (the set last applied)

sync and prune are dispatcher code steps (write). Every other endpoint is read-only: it opens the file with
mode=ro and query_only, and reads through temp views limited to the sources bound in the env and to items
matching at least one selector. `sql` runs agent SQL in bay/sqlsandbox.py.

Budget is enforced before each source fetch exactly as before: a run is capped at the strictest of
maxPostsPerRun, monthlyPosts - used and (spendUsd - spent) / costPerPostUsd (names kept from v0.2; they
count items). Up to DELETION_CHECK_SHARE of a source's budget re-checks stored items still in its window.
"""
from __future__ import annotations

import json
import math
import os
import re
import sqlite3
from datetime import datetime
from pathlib import Path

from bay import model, secretscan, selector as selmod, sqlsandbox as sbx, vault
from bay.config import COST_PER_POST_USD
from bay.connect import ConnectorError
from bay.util import duration, iso, parse_time

SCHEMA_VERSION = 1
DB_NAME = "corpus.db"
DELETION_CHECK_SHARE = 0.5
ENVELOPE = ("id", "extId", "source", "kind", "author", "title", "text", "url", "createdAt", "fetchedAt",
            "container", "labels", "threadId", "matched")
FACET_SQL = {"source": "v.source", "author": "v.author", "container": "v.container", "kind": "v.kind",
             "day": "substr(v.createdAt, 1, 10)"}
ITEM_COLS = "v.*, i.ext AS ext"


class StoreError(ConnectorError):
    pass


def ddl(fts: bool) -> list[str]:
    out = [
        """CREATE TABLE items (
             pk INTEGER PRIMARY KEY, source TEXT NOT NULL, ext_id TEXT NOT NULL, kind TEXT NOT NULL,
             author TEXT, author_name TEXT, title TEXT, body TEXT NOT NULL DEFAULT '', url TEXT,
             created_at TEXT NOT NULL, fetched_at TEXT NOT NULL, container TEXT,
             labels TEXT NOT NULL DEFAULT '[]', thread_id TEXT, ext TEXT NOT NULL DEFAULT '{}',
             UNIQUE (source, ext_id))""",
        "CREATE INDEX items_created ON items (created_at)",
        "CREATE INDEX items_author ON items (author)",
        "CREATE INDEX items_thread ON items (source, thread_id)",
        """CREATE TABLE item_selectors (item INTEGER NOT NULL, selector TEXT NOT NULL,
             PRIMARY KEY (item, selector)) WITHOUT ROWID""",
        "CREATE INDEX item_selectors_selector ON item_selectors (selector)",
        "CREATE TABLE state (key TEXT PRIMARY KEY, value TEXT NOT NULL)",
        "CREATE TRIGGER items_ad_tags AFTER DELETE ON items BEGIN DELETE FROM item_selectors WHERE item = old.pk; END",
    ]
    if fts:
        cols = "coalesce(new.title, ''), new.body, coalesce(new.author, '') || ' ' || coalesce(new.author_name, '')"
        out += [
            "CREATE VIRTUAL TABLE items_fts USING fts5(title, body, author)",
            f"CREATE TRIGGER items_ai AFTER INSERT ON items BEGIN "
            f"INSERT INTO items_fts (rowid, title, body, author) VALUES (new.pk, {cols}); END",
            "CREATE TRIGGER items_ad AFTER DELETE ON items BEGIN DELETE FROM items_fts WHERE rowid = old.pk; END",
            f"CREATE TRIGGER items_au AFTER UPDATE OF title, body, author, author_name ON items BEGIN "
            f"DELETE FROM items_fts WHERE rowid = old.pk; "
            f"INSERT INTO items_fts (rowid, title, body, author) VALUES (new.pk, {cols}); END",
        ]
    return out


def create_schema(con: sqlite3.Connection) -> bool:
    """Create the v1 schema in an empty database. Returns whether FTS5 is in use."""
    fts = sbx.fts5_available()
    for stmt in ddl(fts):
        con.execute(stmt)
    con.execute(f"PRAGMA user_version = {SCHEMA_VERSION}")
    return fts


def open_rw(path: Path) -> sqlite3.Connection:
    """Writer connection (dispatcher code steps only): creates the file and schema on first use."""
    path.parent.mkdir(parents=True, exist_ok=True)
    if not path.exists():
        # the corpus is the user's mail/posts: owner-only. SQLite creates -wal and -shm with the database
        # file's permissions, so creating the file 0600 first covers all three
        os.close(os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600))
    con = sqlite3.connect(path, isolation_level=None)
    con.execute("PRAGMA journal_mode = WAL")
    con.execute("PRAGMA busy_timeout = 5000")
    ver = con.execute("PRAGMA user_version").fetchone()[0]
    if ver == 0:
        if con.execute("SELECT count(*) FROM sqlite_master").fetchone()[0]:
            con.close()
            raise StoreError(f"{path}: not a corpus store (user_version 0 with tables); move it aside")
        con.execute("BEGIN IMMEDIATE")
        create_schema(con)
        con.execute("COMMIT")
    elif ver > SCHEMA_VERSION:
        con.close()
        raise StoreError(f"{path}: store schema v{ver} is newer than this kit (v{SCHEMA_VERSION}); update agentbay")
    return con


IDENTITY = ("id", "extId", "source", "kind", "createdAt", "fetchedAt")


def scrub_item(it: dict) -> dict:
    """Every string in an item except its identity and timestamps, through vault.redact + the pattern secret
    scan: author, title, text, url, container, labels, threadId and every string inside kind fields (ext).
    Done before anything is stored, because scanning only on read can be evaded with SQL transforms
    (upper(), hex(), substr() pieces); a secret that is never stored cannot be rebuilt."""
    def walk(v):
        if isinstance(v, str):
            return scrub(v)
        if isinstance(v, list):
            return [walk(x) for x in v]
        if isinstance(v, dict):
            return {k: walk(x) for k, x in v.items()}
        return v
    return {k: (v if k in IDENTITY else walk(v)) for k, v in it.items()}


def item_row(it: dict) -> dict:
    """The one way an item becomes an `items` row (sync and `bay migrate` both use it); scrubs first."""
    it = scrub_item(it)
    au = it.get("author") or {}
    ext = {k: v for k, v in it.items() if k not in ENVELOPE}
    if au.get("email") and au.get("handle"):
        ext["author"] = au
    return {"source": it["source"], "ext_id": it["extId"], "kind": it["kind"],
            "author": au.get("handle") or au.get("email"), "author_name": au.get("name"),
            "title": it.get("title"), "body": it.get("text") or "", "url": it.get("url"),
            "created_at": it["createdAt"], "fetched_at": it["fetchedAt"], "container": it.get("container"),
            "labels": json.dumps(sorted(set(it.get("labels") or []))), "thread_id": it.get("threadId"),
            "ext": json.dumps(ext, ensure_ascii=False, sort_keys=True)}


def row_item(r: sqlite3.Row) -> dict:
    """A v_items row (+ ext) as an item/v1 dict."""
    ext = json.loads(r["ext"] or "{}")
    author = ext.pop("author", None) or {k: v for k, v in (("handle", r["author"]), ("name", r["authorName"])) if v}
    if "@" in (author.get("handle") or "") and "email" not in author:
        author = {"email": author.pop("handle"), **author}
    out = {"id": r["id"], "extId": r["extId"], "source": r["source"], "kind": r["kind"], "author": author,
           "title": r["title"], "text": r["text"], "url": r["url"], "createdAt": r["createdAt"],
           "fetchedAt": r["fetchedAt"], "container": r["container"], "labels": json.loads(r["labels"] or "[]"),
           "threadId": r["threadId"], "matched": json.loads(r["matched"] or "[]")}
    out.update(ext)
    return out


def _stored(con: sqlite3.Connection, pk: int) -> dict:
    """Base-table row as an item dict (for re-matching; no views needed)."""
    r = con.execute("SELECT * FROM items WHERE pk = ?", (pk,)).fetchone()
    ext = json.loads(r["ext"] or "{}")
    author = ext.pop("author", None) or {"handle": r["author"] or "", "name": r["author_name"] or ""}
    return {"id": f"{r['source']}:{r['ext_id']}", "extId": r["ext_id"], "source": r["source"], "kind": r["kind"],
            "author": author, "title": r["title"], "text": r["body"], "url": r["url"], "createdAt": r["created_at"],
            "fetchedAt": r["fetched_at"], "container": r["container"], "labels": json.loads(r["labels"]),
            "threadId": r["thread_id"], **ext}


def load_state(con: sqlite3.Connection) -> dict:
    s = {k: json.loads(v) for k, v in con.execute("SELECT key, value FROM main.state")}
    s.setdefault("cursors", {})
    s.setdefault("coverage", {"from": None, "to": None})
    s.setdefault("budget", {})
    s.setdefault("deleted", [])
    s.setdefault("checked", {})
    return s


def save_state(con: sqlite3.Connection, state: dict) -> None:
    con.executemany("INSERT OR REPLACE INTO state (key, value) VALUES (?, ?)",
                    [(k, json.dumps(v, ensure_ascii=False, sort_keys=True)) for k, v in state.items()])


def scrub(text: str) -> str:
    """vault.redact (values agentbay resolved) + the pattern secret scan, on item text before it is stored."""
    return secretscan.scrub(vault.redact(text))


def _max_id(a: str | None, b: str) -> str:
    """Snowflake-style ids compare numerically; fall back to string order."""
    if not a:
        return b
    try:
        return a if int(a) >= int(b) else b
    except ValueError:
        return max(a, b)


class CorpusStore:
    def __init__(self, ctx):
        self.ctx = ctx
        mode = ctx.settings.get("mode")
        if not mode:
            raise StoreError("corpus-store needs the calling mode (settings.mode): it keeps one store per mode")
        self.path: Path = ctx.data_dir / mode / DB_NAME
        self._schemas: dict[str, dict] = {}

    # ------------------------------------------------------------ helpers
    def _bound(self) -> list[str]:
        """Sources bound in this env: reads return only their items (offline items never mix into real ones)."""
        return sorted({s.ctx.source_id for s in self.ctx.sources.values() if s.ctx.source_id})

    def _ro(self) -> sqlite3.Connection:
        con = sbx.connect_ro(self.path, self._bound())
        con.row_factory = sqlite3.Row
        return con

    def _rw(self) -> sqlite3.Connection:
        con = open_rw(self.path)
        con.row_factory = sqlite3.Row
        return con

    def _selectors(self) -> list[dict]:
        sels = self.ctx.settings.get("selectors")
        if not sels:
            raise StoreError("no selectors configured: give the mode's config schema a `selectors` default or set "
                             "modes.<mode>.selectors in agentbay.config.yaml (e.g. [{id: all}])")
        return sels

    def _month(self) -> str:
        return f"{self.ctx.now():%Y-%m}"

    def _usage(self, state: dict) -> dict:
        return state["budget"].setdefault(self._month(), {"posts": 0, "usd": 0.0})

    def _cost(self, src=None) -> float:
        if src is not None and src.ctx.cost_per_post is not None:
            return float(src.ctx.cost_per_post)
        return float(self.ctx.caps.get("costPerPostUsd", COST_PER_POST_USD))

    def _remaining(self, state: dict, run_items: int, want: int | None, cost: float) -> tuple[int, str | None]:
        caps = self.ctx.caps
        use = self._usage(state)
        limits = []
        if "maxPostsPerRun" in caps:
            limits.append((caps["maxPostsPerRun"] - run_items, "maxPostsPerRun"))
        if "monthlyPosts" in caps:
            limits.append((caps["monthlyPosts"] - use["posts"], "monthlyPosts"))
        if "spendUsd" in caps and cost > 0:
            limits.append((math.floor(round((caps["spendUsd"] - use["usd"]) / cost, 6)), "spendUsd"))
        if want is not None:
            limits.append((want - run_items, None))
        if not limits:
            return 10 ** 9, None
        n, why = min(limits, key=lambda x: x[0])
        return max(0, n), why

    def coverage(self, state: dict, requested_from: datetime | None = None) -> dict:
        cov = dict(state["coverage"])
        cov["requestedFrom"] = iso(requested_from) if requested_from else None
        complete, note = True, ""
        if cov.get("from") is None:
            complete, note = False, "the store is empty: run the mode's sync endpoint first"
        elif requested_from is not None and requested_from < parse_time(cov["from"], self.ctx.now()):
            complete = False
            note = (f"requested from {iso(requested_from)} but the store only covers from {cov['from']}; "
                    f"older items are not available (source API window or budget limited the history)")
        cov["complete"] = complete
        if note:
            cov["note"] = note
        return cov

    def _overall(self, state: dict) -> dict:
        """Coverage every bound source query can vouch for: latest `from`, earliest `to`."""
        names = set(self.ctx.sources)
        curs = [c for k, c in state["cursors"].items() if not names or k.split("|", 1)[0] in names]
        if not curs or any(not c.get("from") for c in curs):
            return {"from": None, "to": None}
        return {"from": max(c["from"] for c in curs), "to": min(c["to"] for c in curs)}

    def _budget(self, state: dict) -> dict:
        use = self._usage(state)
        caps = {k: v for k, v in self.ctx.caps.items() if k != "costPerPostUsd"}
        return {"month": self._month(), "posts": use["posts"], "usd": round(use["usd"], 4),
                "caps": caps, "costPerPostUsd": self.ctx.caps.get("costPerPostUsd", COST_PER_POST_USD)}

    def _validate(self, it: dict, src_name: str, src_id: str) -> None:
        if it.get("source") != src_id or it.get("id") != f"{src_id}:{it.get('extId')}":
            raise StoreError(f"connector {src_name} returned item {it.get('id')!r} with source {it.get('source')!r}; "
                             f"it declares source '{src_id}' and ids must be '{src_id}:<extId>'")
        kind = it.get("kind", "item")
        if kind not in self._schemas:
            try:
                self._schemas[kind] = model.inline_refs(model.data_schema(f"{kind}/v1"))
            except model.SpecError:
                self._schemas[kind] = model.inline_refs(model.data_schema("item/v1"))
        errs = model.schema_errors(it, self._schemas[kind])
        if errs:
            raise StoreError(f"connector {src_name}: item {it['id']} does not match {kind}/v1: {'; '.join(errs[:3])}")

    def _upsert(self, con, it: dict, sels: list[dict], now) -> tuple[bool, bool]:
        """(new, kept). Labels union with what is stored; the item is kept only if it matches a selector.
        Secrets are scrubbed before anything is stored (scrub_item)."""
        it = scrub_item(it)                                      # match on exactly what will be stored
        old = con.execute("SELECT pk, labels, container FROM items WHERE source = ? AND ext_id = ?",
                          (it["source"], it["extId"])).fetchone()
        labels = set(it.get("labels") or []) | ({it["container"]} if it.get("container") else set())
        if old is not None:
            labels |= set(json.loads(old["labels"]))
        merged = {**it, "labels": sorted(labels), "container": (old["container"] if old else None) or it.get("container")}
        tags = selmod.match_ids(merged, sels, now)
        if old is None and not tags:
            return False, False
        row = item_row(merged)
        if old is None:
            cols = ", ".join(row)
            pk = con.execute(f"INSERT INTO items ({cols}) VALUES ({', '.join('?' * len(row))})",
                             list(row.values())).lastrowid
        else:
            pk = old["pk"]
            con.execute(f"UPDATE items SET {', '.join(f'{k} = ?' for k in row)} WHERE pk = ?", [*row.values(), pk])
        con.execute("DELETE FROM item_selectors WHERE item = ?", (pk,))
        con.executemany("INSERT INTO item_selectors (item, selector) VALUES (?, ?)", [(pk, t) for t in tags])
        return old is None, bool(tags)

    def _rematch(self, con, sels: list[dict], now) -> int:
        """Re-tag every stored item with the shared matcher (selectors changed; nothing is refetched)."""
        changed = 0
        for (pk,) in con.execute("SELECT pk FROM items").fetchall():
            tags = sorted(selmod.match_ids(_stored(con, pk), sels, now))
            have = sorted(t for (t,) in con.execute("SELECT selector FROM item_selectors WHERE item = ?", (pk,)))
            if tags != have:
                changed += 1
                con.execute("DELETE FROM item_selectors WHERE item = ?", (pk,))
                con.executemany("INSERT INTO item_selectors (item, selector) VALUES (?, ?)", [(pk, t) for t in tags])
        return changed

    def _check_candidates(self, con, state: dict, src_id: str, since) -> list[str]:
        """Stored extIds of this source still inside the API window, least recently checked first."""
        rows = con.execute("SELECT ext_id FROM items WHERE source = ? AND created_at >= ?",
                           (src_id, iso(since))).fetchall()
        mine = {f"{src_id}:{r[0]}": r[0] for r in rows}
        checked = state["checked"]
        for k in [k for k in checked if k.startswith(f"{src_id}:") and k not in mine]:
            checked.pop(k)
        return [mine[k] for k in sorted(mine, key=lambda k: (checked.get(k, ""), k))]

    # ------------------------------------------------------------ write endpoints (dispatcher code steps)
    def sync(self, lookback: str | None = None, maxItems: int | None = None) -> dict:
        now = self.ctx.now()
        lookback = lookback or self.ctx.settings.get("lookback")
        if not lookback:
            raise StoreError("no lookback: pass one, or give `lookback` a default in the mode's config schema")
        lb = duration(lookback)
        lb_max = self.ctx.settings.get("lookbackMax")
        if lb_max and lb > duration(lb_max):
            raise StoreError(f"lookback {lookback} exceeds the mode's lookbackMax {lb_max}")
        sels = self._selectors()
        con = self._rw()
        try:
            con.execute("BEGIN IMMEDIATE")
            out = self._sync(con, sels, now, lookback, lb, maxItems)
            con.execute("COMMIT")
        except BaseException:
            if con.in_transaction:
                con.execute("ROLLBACK")
            raise
        finally:
            con.close()
        return out

    def _sync(self, con, sels, now, lookback, lb, max_items) -> dict:
        state = load_state(con)
        deleted = set(state["deleted"])
        window_from = now - lb
        added = fetched = kept = billed = n_deleted = rematched = 0
        spent = 0.0
        stopped: str | None = None
        warnings: list[str] = []
        sources: dict[str, dict] = {}
        if selmod.canonical(state.get("selectors")) != selmod.canonical(sels):
            rematched = self._rematch(con, sels, now)
        active: set[str] = set()
        for name, src in self.ctx.sources.items():
            src_id = src.ctx.source_id
            if not src_id:
                raise StoreError(f"connector {name} declares no `source`; set spec.source in its connector.yaml "
                                 f"so stored items and deletions are keyed correctly")
            groups: dict[str, tuple[dict, list[dict]]] = {}
            for s in sels:
                native, _ = selmod.split(s, src.ctx.selectors)
                groups.setdefault(selmod.native_key(native), (native, []))[1].append(s)
            start_src = window_from
            if src.ctx.window and now - duration(src.ctx.window) > start_src:
                start_src = now - duration(src.ctx.window)
                warnings.append(f"{name}: lookback {lookback} is longer than the source API serves "
                                f"({src.ctx.window}); items before {iso(start_src)} come only from the store")
            rep = sources.setdefault(name, {"fetched": 0, "added": 0, "billed": 0, "requests": 0, "truncated": False,
                                            "checked": 0, "deleted": 0, "queries": []})
            check_pending = self._check_candidates(con, state, src_id, start_src)
            for nkey, (native, group) in groups.items():
                ck = f"{name}|{nkey}"
                active.add(ck)
                cur = state["cursors"].setdefault(ck, {})
                ids = sorted(s["id"] for s in group)
                remaining, why = self._remaining(state, billed, max_items, self._cost(src))
                if remaining <= 0:
                    stopped = stopped or (f"{why} cap reached: nothing fetched from {name}" if why
                                          else f"maxItems {max_items} reached before {name}")
                    rep["queries"].append({"selectors": ids, "skipped": "budget"})
                    continue
                start = start_src
                sinces = [parse_time(s["since"], now) for s in group if s.get("since")]
                if len(sinces) == len(group):
                    start = max(start, min(sinces))
                check = check_pending[: int(remaining * DELETION_CHECK_SHARE)]
                check_pending = []                                  # one deletion pass per source per sync
                req: dict = {"query": {k: v for k, v in native.items() if k != "since"},
                             "maxItems": max(1, remaining - len(check))}
                if check:
                    req["checkIds"] = check
                have_from = parse_time(cur["from"], now) if cur.get("from") else None
                new_sel = set(ids) - set(cur.get("selectors") or [])
                incremental = bool(cur.get("cursor")) and have_from is not None and have_from <= start and not new_sel
                # cursor: only what is newer; backfill: a selector joined this query, so refill its window
                mode = "cursor" if incremental else ("backfill" if new_sel and cur.get("selectors") else "since")
                if incremental:
                    req["cursor"] = cur["cursor"]
                else:
                    req["since"] = iso(start)
                res = src.fetch(**req)
                warnings += res.get("warnings", [])
                got = res["items"]
                n_new = n_kept = 0
                for it in got:
                    self._validate(it, name, src_id)
                    if it["id"] in deleted:
                        continue
                    is_new, was_kept = self._upsert(con, it, sels, now)
                    n_new += is_new
                    n_kept += was_kept
                for xid in res.get("deleted", []):
                    dk = f"{src_id}:{xid}"
                    deleted.add(dk)
                    n_deleted += con.execute("DELETE FROM items WHERE source = ? AND ext_id = ?",
                                             (src_id, xid)).rowcount
                fetched += len(got)
                kept += n_kept
                added += n_new
                billed += res["billed"]
                use = self._usage(state)
                use["posts"] += res["billed"]                       # bill what the source read, not what we kept
                use["usd"] = round(use["usd"] + res["billed"] * self._cost(src), 6)
                spent += res["billed"] * self._cost(src)
                for xid in res.get("checked", []):
                    state["checked"][f"{src_id}:{xid}"] = iso(now)
                src_from = have_from if incremental else start
                if res["truncated"]:
                    # sources return newest first: we hold [oldest fetched, now]; anything older may have a gap
                    src_from = min(parse_time(x["createdAt"], now) for x in got) if got else now
                    rem_after, why_after = self._remaining(state, billed, max_items, self._cost(src))
                    if rem_after <= 0:
                        stopped = (f"{why_after} cap reached during {name} sync" if why_after
                                   else f"maxItems {max_items} reached during {name} sync") \
                            + f"; kept the newest items, coverage now starts {iso(src_from)}"
                    else:
                        stopped = stopped or f"{name} stopped early; see warnings"
                cur["from"], cur["to"], cur["lastSync"] = iso(src_from), iso(now), iso(now)
                cur["selectors"] = ids
                if res.get("cursor"):
                    cur["cursor"] = _max_id(cur.get("cursor"), res["cursor"])
                for k in ("fetched", "added", "billed"):
                    rep[k] += {"fetched": len(got), "added": n_new, "billed": res["billed"]}[k]
                rep["requests"] += res.get("requests", 0)
                rep["truncated"] = rep["truncated"] or res["truncated"]
                rep["checked"] += len(res.get("checked", []))
                rep["deleted"] += len(res.get("deleted", []))
                rep["queries"].append({"selectors": ids, "native": req["query"], "fetched": len(got), "kept": n_kept,
                                       "mode": mode})
        for k in [k for k in state["cursors"] if k.split("|", 1)[0] in self.ctx.sources and k not in active]:
            state["cursors"].pop(k)              # a removed selector's query: re-adding it backfills
        state["coverage"] = self._overall(state)
        state["deleted"] = sorted(deleted)
        state["selectors"] = sels
        save_state(con, state)
        out = {"added": added, "fetched": fetched, "kept": kept, "billed": billed, "deleted": n_deleted,
               "rematched": rematched, "spentUsd": round(spent, 6), "stopped": stopped, "sources": sources,
               "budget": self._budget(state), "coverage": self.coverage(state, window_from)}
        if warnings:
            out["warnings"] = warnings
        return out

    def prune(self, olderThan=None, deletedIds=None) -> dict:
        now = self.ctx.now()
        retention = olderThan or self.ctx.settings.get("retention") or self.ctx.settings.get("lookbackMax")
        if not retention:
            raise StoreError("no retention: pass olderThan, or give `retention` a default in the mode's config schema")
        cutoff = iso(now - duration(retention))
        con = self._rw()
        try:
            con.execute("BEGIN IMMEDIATE")
            state = load_state(con)
            sels = self.ctx.settings.get("selectors")
            if sels and selmod.canonical(state.get("selectors")) != selmod.canonical(sels):
                self._rematch(con, sels, now)
                state["selectors"] = sels
            before = con.execute("SELECT count(*) FROM items").fetchone()[0]
            deleted = set(state["deleted"]) | set(deletedIds or [])
            n_deleted = 0
            for k in deleted:
                src, _, xid = k.partition(":")
                n_deleted += con.execute("DELETE FROM items WHERE source = ? AND ext_id = ?", (src, xid)).rowcount
            con.execute("DELETE FROM items WHERE created_at < ?", (cutoff,))
            unmatched = con.execute("DELETE FROM items WHERE NOT EXISTS "
                                    "(SELECT 1 FROM item_selectors s WHERE s.item = items.pk)").rowcount
            remaining = con.execute("SELECT count(*) FROM items").fetchone()[0]
            state["deleted"] = sorted(deleted)
            for cur in state["cursors"].values():
                if cur.get("from") and cur["from"] < cutoff:
                    cur["from"] = cutoff
            state["coverage"] = self._overall(state)
            save_state(con, state)
            con.execute("COMMIT")
        except BaseException:
            if con.in_transaction:
                con.execute("ROLLBACK")
            raise
        finally:
            con.close()
        return {"removed": before - remaining, "remaining": remaining, "deleted": n_deleted,
                "unmatched": unmatched, "cutoff": cutoff}

    # ------------------------------------------------------------ read endpoints (agents, via use shims)
    def status(self, since=None) -> dict:
        now = self.ctx.now()
        lo = parse_time(since, now) if since else None
        sels = self.ctx.settings.get("selectors")
        if not self.path.exists():
            state = {"coverage": {"from": None, "to": None}, "budget": {}}
            return {"lastSync": None, "coverage": self.coverage(state, lo), "budget": self._budget(state),
                    "count": 0, "selectors": {}, "engine": "fts5" if sbx.fts5_available() else "like",
                    "stale": bool(sels)}
        con = self._ro()
        try:
            state = load_state(con)
            count = con.execute("SELECT count(*) FROM v_items").fetchone()[0]
            per = dict(con.execute("SELECT j.value, count(*) FROM v_items v, json_each(v.matched) j "
                                   "GROUP BY j.value ORDER BY j.value").fetchall())
            engine = "fts5" if sbx.has_fts(con) else "like"
        finally:
            con.close()
        stale = bool(sels) and selmod.canonical(state.get("selectors")) != selmod.canonical(sels)
        return {"lastSync": state["coverage"].get("to"), "coverage": self.coverage(state, lo),
                "budget": self._budget(state), "count": count, "selectors": per, "engine": engine, "stale": stale}

    def query(self, since=None, until=None, author=None, text=None, selector=None, limit=100, ids=None) -> dict:
        now = self.ctx.now()
        lo = parse_time(since, now) if since else None
        if not self.path.exists():
            return {"items": [], "coverage": self.coverage({"coverage": {"from": None, "to": None}}, lo)}
        where, args = self._filters(since, until, selector, now)
        if author:
            where.append("lower(v.author) = ?")
            args.append(author.lower().lstrip("@"))
        if text:
            where.append("instr(lower(coalesce(v.title, '') || ' ' || v.text), ?) > 0")
            args.append(text.lower())
        if ids:
            where.append(f"v.id IN ({', '.join('?' * len(ids))})")
            args += list(ids)
        con = self._ro()
        try:
            state = load_state(con)
            rows = con.execute(f"SELECT {ITEM_COLS} FROM v_items v JOIN main.items i ON i.pk = v.rid "
                               f"{_where(where)} ORDER BY v.createdAt DESC, v.id DESC LIMIT ?",
                               [*args, int(limit or 100)]).fetchall()
        finally:
            con.close()
        return sbx.clean({"items": [row_item(r) for r in rows], "coverage": self.coverage(state, lo)})

    def get(self, ids) -> dict:
        if not self.path.exists():
            return {"items": [], "missing": list(ids)}
        con = self._ro()
        try:
            rows = con.execute(f"SELECT {ITEM_COLS} FROM v_items v JOIN main.items i ON i.pk = v.rid "
                               f"WHERE v.id IN ({', '.join('?' * len(ids))})", list(ids)).fetchall()
        finally:
            con.close()
        found = {r["id"]: row_item(r) for r in rows}
        return sbx.clean({"items": [found[i] for i in ids if i in found], "missing": [i for i in ids if i not in found]})

    def thread(self, id, limit=50) -> dict:
        if not self.path.exists():
            return {"threadId": None, "items": []}
        con = self._ro()
        try:
            head = con.execute("SELECT source, threadId FROM v_items WHERE id = ?", (id,)).fetchone()
            if head is None:
                return {"threadId": None, "items": []}
            if head["threadId"] is None:
                rows = con.execute(f"SELECT {ITEM_COLS} FROM v_items v JOIN main.items i ON i.pk = v.rid "
                                   f"WHERE v.id = ?", (id,)).fetchall()
            else:
                rows = con.execute(f"SELECT {ITEM_COLS} FROM v_items v JOIN main.items i ON i.pk = v.rid "
                                   f"WHERE v.source = ? AND v.threadId = ? ORDER BY v.createdAt, v.id LIMIT ?",
                                   (head["source"], head["threadId"], int(limit))).fetchall()
        finally:
            con.close()
        return sbx.clean({"threadId": head["threadId"], "items": [row_item(r) for r in rows]})

    def facets(self, field, since=None, until=None, selector=None, limit=20) -> dict:
        if not self.path.exists():
            return {"field": field, "values": []}
        now = self.ctx.now()
        where, args = self._filters(since, until, selector, now)
        if field == "selector":
            sql = (f"SELECT j.value AS value, count(*) AS n FROM v_items v, json_each(v.matched) j {_where(where)} "
                   f"GROUP BY j.value ORDER BY n DESC, value LIMIT ?")
        else:
            sql = (f"SELECT {FACET_SQL[field]} AS value, count(*) AS n FROM v_items v {_where(where)} "
                   f"GROUP BY 1 ORDER BY n DESC, value LIMIT ?")
        con = self._ro()
        try:
            rows = con.execute(sql, [*args, int(limit)]).fetchall()
        finally:
            con.close()
        return sbx.clean({"field": field, "values": [{"value": r["value"], "count": r["n"]} for r in rows]})

    def search(self, text, since=None, until=None, selector=None, limit=20) -> dict:
        if not self.path.exists():
            return {"items": [], "engine": "fts5" if sbx.fts5_available() else "like"}
        now = self.ctx.now()
        words = re.findall(r"\w+", text)
        if not words:
            return {"items": [], "engine": "like"}
        where, args = self._filters(since, until, selector, now)
        con = self._ro()
        try:
            if sbx.has_fts(con):
                engine = "fts5"
                sql = (f"SELECT v.id, v.url, v.author, v.createdAt, v.title, v.matched, v.snippet "
                       f"FROM v_fts v {_where(['v.fts MATCH ?', *where])} ORDER BY v.rank, v.createdAt DESC LIMIT ?")
                args = [" ".join(f'"{w}"' for w in words), *args]
            else:
                engine = "like"
                like = [f"instr(lower(coalesce(v.title, '') || ' ' || v.text), ?) > 0" for _ in words]
                sql = (f"SELECT v.id, v.url, v.author, v.createdAt, v.title, v.matched, substr(v.text, 1, 200) AS snippet "
                       f"FROM v_items v {_where([*like, *where])} ORDER BY v.createdAt DESC LIMIT ?")
                args = [*[w.lower() for w in words], *args]
            rows = con.execute(sql, [*args, int(limit)]).fetchall()
        finally:
            con.close()
        items = [{**dict(r), "matched": json.loads(r["matched"] or "[]")} for r in rows]
        return sbx.clean({"items": items, "engine": engine})

    def describe(self) -> dict:
        limits = {"rows": sbx.DEFAULT_ROWS, "maxRows": sbx.MAX_ROWS, "bytes": sbx.MAX_BYTES, "timeMs": sbx.TIME_MS,
                  "cellChars": sbx.CELL_CHARS}
        cols = {v: [{"name": n, "type": t, "description": d} for n, t, d in sbx.COLUMNS[v]] for v in sbx.VIEWS}
        fts = {"view": sbx.FTS_VIEW, "indexes": ["title", "text", "author"],
               "example": "SELECT id, url, snippet FROM v_fts WHERE fts MATCH 'staking AND custody' "
                          "ORDER BY rank LIMIT 20"}
        data_views = [v for v in sbx.VIEWS if v != sbx.FTS_VIEW]
        if not self.path.exists():
            return {"views": [{"name": v, "columns": cols[v], "rows": 0} for v in data_views],
                    "fts": {**fts, "available": sbx.fts5_available()}, "functions": sorted(sbx.FUNCTIONS),
                    "limits": limits}
        con = self._ro()
        try:
            state = load_state(con)
            fts["available"] = sbx.has_fts(con)
            views = []
            for v in data_views:
                n = con.execute(f"SELECT count(*) FROM {v}").fetchone()[0]
                samples = {}
                for c in ("source", "kind", "container", "author"):
                    samples[c] = [r[0] for r in con.execute(
                        f"SELECT {c}, count(*) AS n FROM {v} WHERE {c} IS NOT NULL GROUP BY 1 ORDER BY n DESC LIMIT 5")]
                samples["matched"] = [r[0] for r in con.execute(
                    f"SELECT DISTINCT j.value FROM {v}, json_each({v}.matched) j ORDER BY 1 LIMIT 20")]
                span = con.execute(f"SELECT min(createdAt), max(createdAt) FROM {v}").fetchone()
                views.append({"name": v, "columns": cols[v], "rows": n, "samples": samples,
                              "createdAt": {"min": span[0], "max": span[1]}})
        finally:
            con.close()
        if fts["available"]:
            views.append({"name": sbx.FTS_VIEW, "columns": cols[sbx.FTS_VIEW], "rows": views[0]["rows"]})
        else:
            fts["note"] = "FTS5 is not available in this Python's SQLite: use search (LIKE) or LIKE in sql"
        return sbx.clean({"views": views, "fts": fts, "functions": sorted(sbx.FUNCTIONS), "limits": limits,
                          "coverage": self.coverage(state)})

    def sql(self, sql, limit=None) -> dict:
        try:
            box = sbx.Sandbox(self.path, self._bound())
        except sbx.SqlError as e:
            return {"columns": [], "rows": [], "rowCount": 0, "truncated": None, "error": str(e)}
        try:
            return box.run(sql, limit)
        except sbx.SqlError as e:
            return {"columns": [], "rows": [], "rowCount": 0, "truncated": None, "error": str(e)}
        finally:
            box.close()

    def _filters(self, since, until, selector, now) -> tuple[list[str], list]:
        where, args = [], []
        if since:
            where.append("v.createdAt >= ?")
            args.append(iso(parse_time(since, now)))
        if until:
            where.append("v.createdAt <= ?")
            args.append(iso(parse_time(until, now)))
        if selector:
            where.append("EXISTS (SELECT 1 FROM json_each(v.matched) WHERE value = ?)")
            args.append(selector)
        return where, args


def _where(conds: list[str]) -> str:
    return f"WHERE {' AND '.join(conds)}" if conds else ""


def create(ctx) -> CorpusStore:
    return CorpusStore(ctx)
