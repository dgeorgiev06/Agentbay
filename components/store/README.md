# store (abstract base mode)

The base of every mode that keeps items in the local corpus store, with or without a source. It is never installed
or called itself: a mode with `extends: store` gets its features and adds what differs (a source, `sync`, `prune`,
`digest`, its own `ask`, constraints, config schema, roles and their envs). It has no config schema; the children
carry theirs. A child extends it directly: one level, nothing deeper.

**Contract:** needs `items.store/v2`; a child that reads a source adds `items.source/v1` to its `needs`. Features:

| feature | does |
|---|---|
| `store.add` | store a local item (source `local`, id `local:<extId>`); a kind a source produces is refused |
| `store.update` | change fields of a local item; a synced item is refused |
| `store.delete` | show the items, ask, then remove them (a reviewer checks the result); a synced item is not stored again, and the source is never touched |
| `store.query`, `store.get` | read items |
| `store.ask` | answer a question from stored items through read-only SQL, with citations |

Local items are part of the store's scope: no sync, scope change or prune removes them. A store with no source
and no selectors is never stale, so its reads are not refused. `store-local` is the env of the base itself.

The endpoints of `items.source/v1` and `items.store/v2` are documented in their interface files in `interfaces/`.
The rest of this page describes what those files do not: the item envelope, content types, selectors, the
store layout and the SQL sandbox.

## Items

An item is the unit a source produces and the store keeps. Its envelope is `item/v1`
(`schemas/data/item.v1.schema.json`).

- `id` is `<source>:<extId>`. It is unique, and it is what agents cite. `extId`, `source` and `kind` are also fields of their own.
- `author` is an object with three optional fields: `handle`, `name` and `email`. `email` is the author's address, for example a sender.
- `title`, `text`, `url`, `createdAt` and `fetchedAt` describe the item.
- `container`, `labels` and `threadId` say where it sits.
- `matched` lists the selectors that kept the item. The store sets it.

## Content types

A content type is the versioned kind of an item, written `<kind>/v<N>`. It is a component whose folder holds
`content-type.yaml`, `fields.schema.json`, `views.sql` and, when it derives fields, `derive.py`. A kind adds
fields by extending `item/v1` with `allOf` and `unevaluatedProperties: false`. The type declares:

- `tables`: one child table for each list field of the item. A table lists its columns (the element fields,
  moved out of the stored item) and can have an FTS5 index named `<table>_fts`. The store writes the rows with the
  item and deletes them with it.
- `derived` and `deriveVersion`: `derive(item, version)` in `derive.py` (standard library only) computes fields
  once, when the store writes the item. The store keeps them in `items.derived`, and the views read them. When
  `deriveVersion` changes, the next sync or prune recomputes them from the stored items and fetches nothing.

The store records the types it was made with, which are the ones its mode `reads:`, and refuses another
version. It validates each item against `<kind>/v<N>` when that schema exists. The folder of each type documents
its own fields.

## Selectors

A selector is `selector/v1` (`data/selector.v1.schema.json`): `{id, from?, to?, subject?, text?, in?, has?, since?, not?}`.

- Every field takes one value or a list. An item matches when any value matches.
- Matching is case-insensitive. `has` is `link` or `attachment`.
- `*` is the only wildcard, and it works only in `from` and `to`. A field with a `*` value is matched locally and is never sent to the source's search.
- `in` ignores a `label:` or `in:` prefix, so `label:Work` matches the label `Work`.
- The fields of one selector are ANDed, and selectors are ORed. `not` excludes an item when any of its fields matches.
- `bay/selector.py` `matches()` is the only place that decides which items are kept.

A connector lists the fields its search can handle in `spec.selectors: {<field>: native|local | {mode, as}}`.

- `split()` turns a selector into a native query and a local filter. A source may return more than the local matcher keeps, but never less. So a field is `native` only where the source's search is at least as broad as the matcher. `not` and `*` values are always local. Gmail also keeps `subject` and `text` local, because its search matches whole words and its negation also matches display names.
- Selectors with the same native query share one fetch and one cursor.
- A selector field that the source does not list cannot be expressed, and `bay check` reports an error.
- A `local` field on a paid source (`costPerItemUsd` above 0) gets a warning.

## Store layout

Each mode has one store at `<env data folder>/<mode>/corpus.db`. The file and its `-wal` and `-shm` files are
mode 0600. The database uses WAL mode and `user_version` 3, and `store_meta` records the content types and their
versions. The store refuses a store of any other version. Move the folder aside and sync again, because stores are never converted.

- `items` is unique on source and `ext_id`. Kind fields are in `ext` and derived fields are in `derived`.
- `item_selectors` links items to the selectors that matched them.
- `store_meta` holds the content types (`type:<name>`) and their derive versions (`derive:<name>`).
- The child tables of the content types the mode reads each have a trigger that deletes a row with its item.
- `items_fts` is an FTS5 index over title, body and author. Triggers keep it current.
- The `<table>_fts` tables of the child tables that declare `fullText` are also kept by triggers.

Without FTS5 the store falls back to LIKE matching, and `bay check` warns.

The internal state is in `<mode>/state.json` (mode 0600, never opened by agents). It holds the cursors for each
`<connector>|<native query>`, the coverage, the budget, deletions, the ids last checked, and the selectors and
sources last applied. In a cursor, `from` is what was fetched and `covers` is what coverage reports. `covers` is
the window start when every selector of the query has its own `since`.

## Read-only SQL

Agents query the store with `items.store/v2.sql`. The sandbox in `bay/sqlsandbox.py` works as follows.

- The queries run over temporary views: `v_items`, the views of the store's content types (`views.sql`, with
  columns documented by `describe` from `content-type.yaml`), `v_fts`, and the full-text views of the types. A
  full-text view is queried with `WHERE fts MATCH '...' ORDER BY rank` and has a `snippet` column. A mode sees only the views of the types it reads.
- The connection is opened with `mode=ro` and `query_only`.
- A pre-pass prepares `EXPLAIN <sql>` first and refuses the FTS shadow tables. The query then runs, and FTS5's own internal reads are allowed.
- An authorizer allows SELECT and reads of those views and of `items`, `item_selectors`, `items_fts`, the child tables of the types and their FTS5 tables. It also allows `json_each`, CTEs and a list of functions. It denies everything else. A read that names no column, such as `count(*)`, passes only for a stored table on that list.
- A `WITH` clause may not take the name of a view or a store table.
- Scope is structural: the store file holds only the mode's scope and no internal state (cursors, budget and selectors
  live in `state.json`, which this connection never opens), and a store with an internal `state` table is refused.
- Not in the function list on purpose: `load_extension`, `randomblob` and `zeroblob` (memory), `printf` and `format`
  (width bombs) and `sqlite_*`. Each FTS5 table is connected before the authorizer is on, so its config read never
  trips the pre-pass.
- Limits: 2 seconds of run time, 1 MB for a value, a 256 MB heap cap (`temp_store=FILE`, so sorts go to disk), 200 rows by default and 1000 at most, 200 kB per result and 4,000 characters per cell.

Errors come back as `error` and say what to change. The store scrubs every item string and `extId`, and the keys
of dicts in kind fields, for secrets when it ingests them. Every read is redacted and scanned again.
