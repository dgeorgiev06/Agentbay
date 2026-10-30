# HANDOFF part 15: T-20261030-db86 (recorded with `bay plan`) - slice 5 of 0008 planned (item 3: finish 0006 step 2 and Part E)

Outcome: slice 5 is split into four sequential builder parts (A to D), each a green commit with its own acceptance, and every path it
needs is listed with its touches status. No code changed; no proposal edited. Branch feat/0008-stage4 (from origin/main 1e5eebe).
All line numbers are at 1e5eebe.

## 1. Current state

Base item record
- `schemas/data/item.v1.schema.json:7-18` (envelope: id, extId, source, kind, author, title, text, url, createdAt, fetchedAt, labels, threadId; description names posts and email at :5 and :18).
- Store tables `framework/connectors/corpus-store/corpus_store.py:93-121` (`ddl`: `items`, `item_selectors`, items_fts + triggers); `item_row` :202-218 (kind fields go to `items.ext` JSON, attachment text is stripped :208-210); `row_item` :233-244; `_stored` :247-255.
- `SCHEMA_VERSION = 2` at `bay/sqlsandbox.py:36` (and corpus_store.py:75). A store of another version is refused (`version_error` sqlsandbox.py:285).

Post (kind `post`)
- Fields `schemas/data/post.v1.schema.json:7-12` (lang, metrics). View `v_posts` `bay/sqlsandbox.py:235-240`; column docs :89-93.
- Producers: `connectors/x-api/connector.yaml:13`, `connectors/fake/connector.yaml:9` (`produces: [post/v1]`). Reader: `modes/feed-briefing/mode.yaml:11` (`reads: [post/v1]`).

Email (kind `email`)
- Fields `schemas/data/email.v1.schema.json:7-35` (from, to, cc, messageId, inReplyTo, account, hasAttachments, bulk, attachments[]).
- Producers: `connectors/gmail-api/connector.yaml:17`, `connectors/fake-mail/connector.yaml:12`. Reader: `modes/mail-briefing/mode.yaml:11`.
- Child table `attachments` (+ `attachments_fts`, triggers): `corpus_store.py:124-142`; rows written by `attachment_rows` :221-230 and `_upsert` :566-568.
- Views: `email_view_sql` `bay/sqlsandbox.py:178-227` = `v_email` :183-194 (fromMe/toMe use the SQL function `addr_key` :190-192), `v_threads` :195-213 (`needsReply` :196, lastFromMe/lastToMe/lastBulk :202), `v_attachments` :214-221, `v_attachment_fts` :224-226. Column docs :94-128, :135-139.
- `addr_key` is `bay/selector.py:71-87` (Gmail dot rules); registered as a SQL function `sqlsandbox.py:256`, in the allowlist :56, and `MAIL_FUNCTIONS` :45.
- Constants that name the types: `VIEWS`, `ITEM_VIEWS`, `MAIL_VIEWS`, `TABLES`, `FTS_VIEWS` `sqlsandbox.py:37-48`; `view_sql` :230-246; `connect_ro` creates all views for every store :269; the authorizer allowlist is `self.views`/`self.tables` :314-315, :347-349 (every store gets `v_posts` and the mail views, whatever the mode reads).

Needs-reply and important-sender logic
- `needsReply` = `lastFromMe = 0 AND lastToMe = 1 AND lastBulk = 0`, `sqlsandbox.py:196`.
- `important`: `CorpusStore.threads` `corpus_store.py:1126-1167` (:1163 `addr_matches(important, sender)` from `bay/selector.py:65-68`); also builds `ids` :1156, `lastText` :1158, `attachments` :1160 from the email views.
- Interface `framework/interfaces/items.store.v1.yaml:145-169` (`threads`, text says "Email threads"); `sql` text :88-93 names the views.
- Mode: `modes/mail-briefing/mode.yaml:23` (`gather` step `items.store/v1.threads`, `important: $config.important`); setting `modes/mail-briefing/config.schema.json:6-9` (already the only key; example `config.example.yaml:9`).
- Describe: `corpus_store.py:1075-1124` (mail views listed only when the store holds an `email` row :1093; `fts.attachments` :1117; functions :1197-1199).

How connectors write items
- A source (`items.source/v1`) returns `item/v1` dicts; `corpus-store.sync` validates each with `_validate` `corpus_store.py:527-539` (`model.data_schema("<kind>/v1")`, falling back to `item/v1`), scrubs (`scrub_item` :183), derives the selector tags, and `_upsert` :541-569 writes `items` + `item_selectors` + `attachments`.
- Kinds are found by `model.item_kinds` `bay/model.py:97-109` (any `schemas/data/<kind>.v<N>.schema.json` that extends `item/v1`) and `model.data_schema` :85-91; B-6 lint `bay/lint.py:399-480` checks `reads:`/`produces:` against them (messages :432, :449 use `post/v1` as the example); `bay/scaffold.py:128` scaffolds `produces: [post/v1]`.

How modes query
- Code steps call `items.store/v1.*` (`mode.yaml` `run:`). Agents go through the role unit's use shim: `bay/cli.py:372-386` -> `Dispatcher.use` `bay/dispatch.py:229-256`, allowed when `target in r.bay_uses` (:237), which `bay/model.py:820-824` fills with every read-only endpoint of every needed interface (per role unit, not per feature).
- Dispatcher settings for the store: `_settings` `dispatch.py:487-492` (`mode`, config), `_use_settings` :258-267 (+ bound `sources`). The store keys on `settings.mode` (`corpus_store.py:364`) and knows nothing else about the mode.
- Skills that name views: `modes/briefing/skills/corpus-sql/SKILL.md:9,13,22` (v_posts), `modes/mail-briefing/skills/{corpus-sql,digest}/SKILL.md`.
- Per-feature `uses:`/`skills:` do not exist yet: `Feature` has no such fields (`mode.schema.json:57-180` allows neither); `_plan` hands a role every mode skill (`dispatch.py:561-562`). Slice 3 folded features into `mode.yaml` (no `feature.yaml`), so Part E lands as two more keys of the `features.<name>` block.

Facts the plan depends on
- Boundary rules: `bay/boundary.py:298-336`. A feature folder of an EXISTING mode passes only if an entry's literal prefix reaches `<mode>/features/` (:326). 0008's slice-5 entry `modes/*/features/*/` has literal prefix `modes/`, so it does NOT cover `modes/mail-briefing/features/*` (it does cover `modes/briefing/features/*`, which is core, B-1). Mode-wide files of an existing mode need an entry that matches the path.
- `framework/components.yaml:31` already declares the `contentType` contract (`content-types/<name>/`, `schemas/content-type.schema.json`, `tests/contracts/content_type.py`); neither file exists yet.
- `tests/run.py:18-22` globs `tests/test_*.py` and `*/tests/test_*.py` of `connectors` and `framework/connectors` only.
- B-11 docs check (`boundary.py:339-359`) will report any line of README/DESIGN/INTERFACES outside a fence that has the bare word `post` or `email` once `content-types/post|email` exist. Today: `docs/DESIGN.md:121`, `docs/INTERFACES.md:220,224,225,274`. Each part rewords the lines it exposes.
- Tests that read describe/views today: `tests/test_mail_briefing.py:132,144-153,278,292-310`; `framework/connectors/corpus-store/tests/test_sqlsandbox.py` (Sandbox(path) built with no mode at :158,:343,:357,:375, reads `v_posts`); `test_corpus_store.py:426-429,482`; `connectors/gmail-api/tests/test_gmail_api.py:143,715-764`; `tests/test_contract_versions.py:24,47-48,106-107` (write `schemas/data/*.v2.schema.json`).

## 2. Target (0006 Part B and Part E, mapped to files)

Content type = a folder `content-types/<name>/` (top level, user space like connectors; ships `post` and `email`):
```
content-types/post/    content-type.yaml  fields.schema.json  views.sql  README.md  fixtures/
content-types/email/   content-type.yaml  fields.schema.json  views.sql  derive.py  README.md  fixtures/
```
- `content-type.yaml` (apiVersion/kind `ContentType`/metadata.name/spec): `version: 1`, `kind: <item kind>`, `deriveVersion` (email), `views: {v_email: {description, item: true, columns: [{name,type,description}]}, ...}` (the column docs that `sbx.COLUMNS` holds today, so `describe` reads them from here), `tables: {attachments: {from: attachments, moveOut: [text], columns: {...}, fullText: [name, text]}}` (0006 Part B syntax; table keeps the name `attachments`, the FTS table `attachments_fts`, so agent SQL does not change), `derived: [fromMe, toMe]`.
- `fields.schema.json` = the current `schemas/data/<name>.v1.schema.json` moved (same `$id`/`title` `post/v1`, `email/v1`).
- `views.sql`: only `CREATE VIEW v_<name> ...` statements. Post: `v_posts` (from sqlsandbox.py:235-240). Email: `v_email`, `v_attachments`, `v_attachment_fts` (:183-194, :214-226) with `fromMe`/`toMe` read from stored fields, not from `addr_key`.
- `derive.py`: `derive(item, version) -> dict` of added fields (`fromMe`, `toMe`), holds `addr_key` (moved from selector.py). Runs in the writer after scrubbing; stdlib imports only (lint scans it). Stored in a new column `items.derived` (JSON) with `items.derived_ver`, NOT in `ext`, so `get`/`query` output stays the same. The store records content types and versions in a `store_meta` table; on a `deriveVersion` change it recomputes `derived` locally (no fetch); another type version is refused ("move the folder aside and sync again"). `SCHEMA_VERSION` goes 2 -> 3.
- Loader: discovery is a new `ContentType` kind in `model.KINDS` (`bay/model.py:44-50`, folder `content-types`, glob `*/content-type.yaml`, schema `content-type`), so collisions and errors reuse `Kit`; `model.item_kinds` and `model.data_schema` read it (no `schemas/data/post|email`). Views, tables, derive and mode-view handling live in NEW `bay/contenttypes.py` (listed under `briefing` `owns:` in `framework/components.yaml`). `schemas/content-type.schema.json` is new. `tests/contracts/content_type.py` is the contract suite, run by `tests/test_content_types.py` against every discovered type (see Part A).
- `produces:`/`reads:` already exist and keep their names (`post/v1`, `email/v1`); B-6 lint stays, now fed by the loader. New lint: content-type.yaml shape, documented columns equal the real view columns (built in memory), view SQL passes the read-only authorizer and reads only base tables and the type's own tables/views (B-10), `derive.py` imports, table names unique across the types one mode reads.
- Generic store (`corpus_store.py`, `sqlsandbox.py`): child tables, their delete and FTS triggers, row writing, derive, and the view set come from the loader for the types the mode reads (`reads` equals what its sources produce, by B-6). `describe` lists a type's views for the types the mode reads, the base views, and the mode's own views; `functions` lists only the fixed allowlist. `Sandbox(path)` keeps its signature: the view set is rebuilt from `store_meta` (types, versions, mode view text), so the sandbox security tests stay unchanged.
- Mode-owned views: `modes/mail-briefing/views.sql` defines `v_threads` (with `needsReply`, built on the type's `v_email`) and `modes/mail-briefing/views.yaml` its column docs and the row metadata (`window: lastDate`, JSON and boolean columns, `ids`, `lastText`, `attachments` as SQL columns). Same validation as a type's views. `items.store/v1.threads` stays (no interface version bump) but becomes generic: rows of the view `v_threads` of the mode, window on its `lastDate`, selector on `matched`, `important` marks rows whose `senders` match the patterns (`addr_matches` stays in selector.py: it is the `from` rule, not mail-specific). A mode with no `v_threads` gets an error naming the fix. mail-briefing config keeps only `important` (unchanged file apart from its wording).
- Part E in the slice-3 shape: `features.<name>.uses: [<iface>/v<N>.<endpoint>, ...]` and `features.<name>.skills: [<short name>, ...]` in `mode.yaml`; `mode.schema.json` allows both; lint: every `uses` entry is granted to a role of that feature (B-9), every skill exists in the mode (B-8), a feature with a role step whose unit has `bayUses` must declare `uses`. Enforcement: `Dispatcher.use` allows `target` only if it is in the `uses` of a feature whose open call (`.agentbay/calls/*.json`, status `needs-agent`, cursor on a role step of this unit) waits for that unit; with no such open call the role-level grant applies as today (so existing security tests do not change). `_plan` hands only the feature's `skills`. Whole-feature override: a child's feature of the same name replaces the parent's whole block (`merge_mode`), and `bay show <mode> --resolved` prints the resolved features with their origin. `bay/use_shim.py` itself stays an entry point (listed by 0008, probably untouched).

## 3. Split (sequential; each part ends with `python3 tests/run.py -q` green and `./bay.sh check` clean)

Common to every part: delete replaced code completely (the `deadcode` step fails on new unused code or compat layers); update README/DESIGN/INTERFACES lines for what changed (DOD-13); reword the B-11 doc lines the part exposes; run `python3 -m bay.cli boundary --base origin/main --proposal docs/proposals/0008-simplify-without-losing-features.md --docs` with the amendment entries below applied by the owner (a builder may not edit a proposal: if the entries are missing the check fails by design; list that in the HANDOFF).

Part A: baseline, loader, `post` moved (about 35 calls)
1. First commit, before any other change: `tests/test_offline_golden.py` + `tests/golden/*.json` (see section 5), generated from the untouched code.
2. `schemas/content-type.schema.json`; `ContentType` kind in `model.py`; `item_kinds`/`data_schema` read content types; `bay/contenttypes.py` (load, view/table SQL, validation); `tests/contracts/content_type.py` + `tests/test_content_types.py` (+ `tests/run.py` also globs `content-types/*/tests`); components.yaml `owns` line.
3. `content-types/post/` (4 files + fixtures); delete `schemas/data/post.v1.schema.json` and the `v_posts` code/docs in sqlsandbox.py; the store builds the `post` views from the loader; `store_meta` + `SCHEMA_VERSION` 3 (the table is generic; email still on the old code path until B).
4. `tests/test_core_names.py` with a ratchet: scans core files (`bay/**`, `framework/**` except extension folders, `schemas/**`, `adapters/**`, `coordinator/**`) for the discovered names (quoted kind strings, `<name>/v<N>` refs, `v_<view>` names of discovered types, hyphenated connector names `x-api`, `gmail-api`, `fake-mail`); `ALLOWED` lists today's hits per file and shrinks in B and C.
Acceptance: golden test identical for feed-briefing and mail-briefing; `v_posts` read by the unchanged sandbox security tests; contract suite passes for `post`; a content-type with a view reading another table is refused; kinds still `{post, email}` (email from the old location until B); no `schemas/data/post.*`; docs lines DESIGN.md:121 and INTERFACES.md:224 reworded.

Part B: `email` moved (about 40 calls)
1. `content-types/email/` (content-type.yaml with `attachments` table and `derived`, fields.schema.json, views.sql with `v_email`/`v_attachments`/`v_attachment_fts`, derive.py with `addr_key`, fixtures); delete `schemas/data/email.v1.schema.json`.
2. Generic child tables and derive in `corpus_store.py` (`attachments_ddl`, `attachment_rows`, `_upsert` :566-568, `item_row` :208-210, `describe` mail logic :1093-1120, `_functions` :1197) and `sqlsandbox.py` (delete `email_view_sql`, `MAIL_*`, `addr_key` registration and allowlist entry); `bay/selector.py` loses `addr_key`/`GMAIL_DOMAINS`.
3. `threads()` still reads `v_threads`; until C the view stays in the email type as a documented, temporary home (its SQL moves out in C). Recompute of `derived` on `deriveVersion` change; store version refusal tests.
Acceptance: golden identical except the documented describe deltas (section 5); fromMe/toMe/bulk/needsReply values identical on the mail fixture; attachment text, FTS and delete-with-item tests unchanged; `derive.py` import scan; test_contract_versions rewritten to write `content-types/*/content-type.yaml` versions; gmail tests use `derive.addr_key` for the unit assertions; INTERFACES lines 220-229, 274, 293-315 reworded.

Part C: mode-owned views, generic `threads`, last core names (about 35 calls)
1. Move `v_threads` SQL (with `needsReply`, `ids`, `lastText`, `attachments`) to `modes/mail-briefing/views.sql` + `views.yaml`; contenttypes.py loads mode views (lookup through the `extends` chain), validates them with the same authorizer, records them in `store_meta`.
2. `CorpusStore.threads` becomes the generic reader over `v_threads` (no email names, `important` marking by `addr_matches`); interface text `framework/interfaces/items.store.v1.yaml` (threads, sql, describe) loses every type name.
3. Skills and playbooks: `modes/briefing/skills/corpus-sql/SKILL.md` (generic text, no `v_posts`), `modes/mail-briefing/skills/*`, `features/digest|ask` wording; `config.schema.json` description ("the store marks threads" -> "rows are marked").
4. Remove the remaining core names: `bay/lint.py:381,432,449`, `bay/scaffold.py:128`, `bay/model.py:86`, `bay/config.py:14`, `schemas/{mode,connector,event}.schema.json` examples, `schemas/data/item.v1.schema.json:5,18`, `framework/rules/conformance.yaml:29,44`, `framework/interfaces/items.source.v1.yaml:6`; `ALLOWED` in `tests/test_core_names.py` becomes empty and the test asserts it.
Acceptance: mail-briefing golden (threads output, `v_threads` reads, offline digest plan) identical; feed-briefing describe has no mail view and no mail function, mail-briefing describe has no `v_posts`; a mode without `v_threads` calling `threads` gets the named error; `tests/test_core_names.py` passes with `ALLOWED == {}`; `boundary --docs` reports 0 B-11 hits.

Part D: Part E and the whole-tree checks (about 40 calls; if `uses:` alone has used 30 calls, stop after it, commit, and report the rest as D2)
1. `uses:`/`skills:` in `schemas/mode.schema.json`, `Feature` in `model.py`, lint (B-8, B-9), `Dispatcher.use` scoping and `_plan` skills in `dispatch.py`, whole-feature override in `merge_mode`, `bay show --resolved` in `cli.py`, `bay/scaffold.py` + `framework/modes/forge/templates/feature/feature.yaml` scaffold the keys.
2. Declare them in `modes/briefing/mode.yaml`, `modes/mail-briefing/mode.yaml` (digest: derive the list from its playbook and skill, which also read `thread` and `sql` for attachment text, so not only `get` as 0006's example says), and the framework modes whose units have `bayUses` (`./bay.sh describe improve` and the others show `bayUses`).
3. Tests: a role step calling an endpoint outside its feature's `uses:` is refused with an open call; allowed inside; skills outside `skills:` are not in the plan; a child's feature replaces the parent's whole; `--resolved` shows origins.
4. Whole tree: `tests/test_core_names.py` still green; the unchanged security files pass (tests/test_boundaries.py, test_resolver.py, test_dispatch.py, test_lint.py, the connector tests, the corpus-store sandbox tests); golden compare final; CLI baseline diff (section 5); boundary `--docs` 0 failing; deadcode step.
Acceptance (0006 step 2 plus the 0008 line): offline sync, describe and status of feed-briefing and mail-briefing identical to the baseline except the three documented deltas; no core file names a content type or connector (test); every security test unchanged and passing; boundary check over the whole tree finds no leak; the dead-code check reports no new findings.

## 4. Path table

Covered = an existing 0008 `touches:` entry matches the path (cited by slice and path). New = needs the amendment entry in the last column (all are `slice: 5`).

| Part | Path | Change | Status |
|---|---|---|---|
| A,B | `content-types/post/*`, `content-types/email/*` | new extensions | Covered: slice 5 `content-types/` |
| A | `tests/test_offline_golden.py`, `tests/golden/`, `tests/test_content_types.py`, `tests/contracts/content_type.py`, `tests/test_core_names.py`, `tests/run.py` | tests | no entry needed (boundary class `other`, `tests/`) |
| A,B,C,D | `HANDOFF.md` | notes | no entry needed (`other`) |
| A | `bay/contenttypes.py` | NEW loader | New: amendment 1 |
| A | `schemas/content-type.schema.json` | NEW | New: amendment 2 |
| A | `schemas/data/post.v1.schema.json` | moved out | New: amendment 3 |
| B | `schemas/data/email.v1.schema.json` | moved out | New: amendment 4 |
| C | `schemas/data/item.v1.schema.json` | wording | New: amendment 5 |
| A,B,C | `bay/sqlsandbox.py` | generic views, store_meta | New: amendment 6 |
| B | `bay/selector.py` | `addr_key` leaves | New: amendment 7 |
| A,B,C | `framework/connectors/corpus-store/` (`corpus_store.py`, `tests/test_corpus_store.py`, `tests/test_sqlsandbox.py`) | generic store | New: amendment 8 |
| C | `framework/interfaces/items.store.v1.yaml` | threads/sql/describe text | New: amendment 9 |
| C | `framework/interfaces/items.source.v1.yaml` | wording at :6 | New: amendment 10 |
| C | `modes/briefing/skills/corpus-sql/SKILL.md` | generic text | New: amendment 11 |
| C | `modes/mail-briefing/views.sql` | NEW mode view | New: amendment 12 |
| C | `modes/mail-briefing/views.yaml` | NEW view docs | New: amendment 13 |
| C | `modes/mail-briefing/skills/` | wording | New: amendment 14 |
| C | `modes/mail-briefing/config.schema.json` | wording | New: amendment 15 |
| C | `modes/mail-briefing/features/digest/` (`playbook.md`, `rules.yaml`) | wording | New: amendment 16 (the slice 5 glob `modes/*/features/*/` has literal prefix `modes/` and fails B-3) |
| C | `modes/mail-briefing/features/ask/` (`playbook.md`, `rules.yaml`) | wording | New: amendment 17 (same reason) |
| A,B,C | `bay/model.py` | KINDS, item_kinds, data_schema | Covered: slice 3 `bay/model.py` |
| A,C | `bay/lint.py` | content-type lint, messages | Covered: slice 1 `bay/lint.py` |
| A | `framework/components.yaml` | add `bay/contenttypes.py` to briefing `owns` | Covered: slice 1 `framework/components.yaml` |
| A,B,C | `bay/dispatch.py` (`_settings` :487), `bay/scaffold.py:128`, `bay/config.py:14` | settings, wording | Covered: slice 3 `bay/dispatch.py`, slice 3 `bay/scaffold.py`, slice 2 `bay/config.py` |
| C | `schemas/mode.schema.json`, `schemas/connector.schema.json`, `schemas/event.schema.json`, `framework/rules/conformance.yaml` | example wording | Covered: slice 3, slice 4, slice 8 (`schemas/event.schema.json`), slice 1 |
| B | `bay/improve/graph.py` (`_data_schemas` :150) | schema nodes follow the move | Covered: slice 6 `bay/improve/` |
| B | `connectors/gmail-api/tests/test_gmail_api.py` | addr_key / views assertions | Covered: slice 7 `connectors/gmail-api/tests/test_gmail_api.py` |
| A,B,C | `README.md`, `docs/DESIGN.md`, `docs/INTERFACES.md` | contracts only, B-11 | Covered: slice 9 (each of the three) |
| C | `modes/mail-briefing/mode.yaml`, `modes/briefing/mode.yaml`, `modes/briefing/features/*/` | gather step, wording | Covered: slice 3 `modes/*/mode.yaml`; slice 5 `modes/*/features/*/` (core, B-1) |
| C | `modes/mail-briefing/README.md`, `modes/feed-briefing/README.md` | wording | Covered: slice 2 (each) |
| C | `modes/mail-briefing/config.example.yaml` | only if wording | Covered: slice 7 |
| D | `bay/model.py`, `bay/dispatch.py`, `bay/lint.py`, `schemas/mode.schema.json` | Part E | Covered: slices 3, 3, 1, 3 |
| D | `bay/cli.py` | `show --resolved` | Covered: slice 4 `bay/cli.py` |
| D | `bay/use_shim.py` | probably untouched | Covered: slice 5 `bay/use_shim.py` |
| D | `modes/*/mode.yaml`, `framework/modes/*/mode.yaml`, `framework/modes/forge/templates/` | `uses`/`skills` | Covered: slice 3 (each) |
| D | `bay/scaffold.py` | scaffold the keys | Covered: slice 3 |

Amendment entries (17), to add to 0008's `touches:` by the owner:
```
  - { path: bay/contenttypes.py, reason: "NEW. content-type loader: views, child tables, derive.py, mode views (0006 Part B)", slice: 5 }
  - { path: schemas/content-type.schema.json, reason: "NEW. shape of content-type.yaml; declared in framework/components.yaml", slice: 5 }
  - { path: schemas/data/post.v1.schema.json, reason: "moved to content-types/post/fields.schema.json", slice: 5 }
  - { path: schemas/data/email.v1.schema.json, reason: "moved to content-types/email/fields.schema.json", slice: 5 }
  - { path: schemas/data/item.v1.schema.json, reason: "wording: no content type named in the envelope description", slice: 5 }
  - { path: bay/sqlsandbox.py, reason: "views, tables and functions come from the content-type loader; no type named; store_meta", slice: 5 }
  - { path: bay/selector.py, reason: "addr_key moves to content-types/email/derive.py", slice: 5 }
  - { path: "framework/connectors/corpus-store/", reason: "generic child tables, derive and views for the types a mode reads; tests follow", slice: 5 }
  - { path: framework/interfaces/items.store.v1.yaml, reason: "threads, sql and describe text name no content type; threads reads the mode's v_threads", slice: 5 }
  - { path: framework/interfaces/items.source.v1.yaml, reason: "wording: no content type named", slice: 5 }
  - { path: modes/briefing/skills/corpus-sql/SKILL.md, reason: "generic text: views come from the content types a mode reads", slice: 5 }
  - { path: modes/mail-briefing/views.sql, reason: "NEW. mode-owned v_threads with needsReply (0006 Part B)", slice: 5 }
  - { path: modes/mail-briefing/views.yaml, reason: "NEW. column docs and row metadata of the mode's views", slice: 5 }
  - { path: "modes/mail-briefing/skills/", reason: "skills follow the views the mode owns", slice: 5 }
  - { path: modes/mail-briefing/config.schema.json, reason: "wording: rows are marked important, not the store", slice: 5 }
  - { path: "modes/mail-briefing/features/digest/", reason: "feature playbook and rules follow the generic threads endpoint (B-3 needs the mode named)", slice: 5 }
  - { path: "modes/mail-briefing/features/ask/", reason: "feature playbook and rules follow the mode's views (B-3 needs the mode named)", slice: 5 }
```

## 5. Baseline for "identical offline sync, describe and status output"

Before part A touches anything (first commit of part A):
1. `./bay.sh check` (note the summary line), `./bay.sh catalog`, `./bay.sh describe feed-briefing`, `./bay.sh describe mail-briefing`. Save each output to the scratchpad with Write (as slice 3 did): `cli_before_check.txt`, `cli_before_catalog.txt`, `cli_before_describe_feed.txt`, `cli_before_describe_mail.txt`.
2. Write `tests/test_offline_golden.py` and generate `tests/golden/feed-briefing.json` and `tests/golden/mail-briefing.json` from the UNCHANGED code. The test builds a project with `offline: true` (as `tests/test_mail_briefing.py:17-22`), the fixed `helpers.clock`, and for each mode records: `Dispatcher.call("<mode>.sync", {})["output"]` (no callId), `Dispatcher.use(unit, "items.store/v1.describe", {})`, `...status`, and for mail also `threads {since: "30d", important: ["*@partner.example"]}`, and `sql` reads of `v_email` (id, fromMe, toMe, bulk), `v_threads` (needsReply, lastBulk), `v_attachments` and `fts` examples; for feed `v_posts` (likes, reposts, lang). The test regenerates the structure and compares it with the stored JSON (`GOLDEN_UPDATE` is not offered: a changed file means a changed behavior).
3. The golden file is the reference; a failing golden test is the compare. No new random or wall-clock values are in it.

After part D, same four CLI commands to `cli_after_*.txt`, then `git diff --no-index --stat` per pair. Expected CLI differences: none in `check` beyond counts of content types if printed, none in `catalog`, `describe` only the new `uses`/`skills` lines if it prints features.

Deliberate describe deltas the golden test must assert exactly (0006's design, not regressions; the acceptance text says "identical", so the owner should confirm these three):
- mail-briefing no longer lists `v_posts` (the allowlist is the base views, the views of the types the mode reads, and the mode's own views; 0006 Part B "What the briefing core does"). It had 0 rows there.
- mail-briefing `functions` no longer lists `addr_key` (computed fields are stored, 0006 "Decided"); the `fromMe`/`toMe` column descriptions keep their wording.
- mail-briefing view order is `v_items, v_email, v_attachments, v_threads, v_fts, v_attachment_fts` (type views, then the mode's views, then full-text views) instead of `v_threads` before `v_attachments`; compare views as a name-keyed map and assert the new order separately.
Everything else (columns, descriptions, row counts, samples, fts, limits, coverage, sync counts and cost, status) must match byte for byte. feed-briefing has no delta.

Decisions to confirm (assumed above): (1) the three describe deltas; (2) `v_threads` is mode-owned (0006 line 224 lists it under email, line 278 makes needs-reply the mode's), and `items.store/v1.threads` stays at v1 as a generic reader instead of a new `rows` endpoint (a removed endpoint would need an interface version bump, R-2); (3) with no open call, a use-shim read falls back to the role-level grant (keeps the security tests unchanged); (4) the store creates tables for the types a mode `reads:` (equal to what its sources produce by B-6), not for those its sources produce.

Not in this slice: catalog listing of content types, `forge.connect`, DOD-4 wording (0006 Part C), the apiVersion bump (slice 9).

# HANDOFF part 14: T-20261030-c870 (recorded with `bay plan`) - stage 3: last DOD-2 finding of the re-review (verdict-s3b)

Outcome: in the main thread the guard hook asks for `note dispatch`, `note review` and `show reclaim` in any quoting,
escaping, option or launcher spelling; the three nits are fixed. Stage 3 of 0008 is complete.

To-do (all ticked with `bay plan --done`):
1. Guard: `main_thread_decision` / `asked_bay_write` in bay/guard.py split the Bash command with the guard's own
   `shlex.split` (+ `dequote` fallback, operators split off for unsafe text) and find a launcher (`.agentbay/bay`,
   `./bay.sh`, `bay.sh`, `python3 -m bay.cli`, `python3 bay/cli.py`) anywhere in the words, so env assignments and
   `x; ...` do not hide it. Commit b900ae3.
2. Hook config: the PreToolUse guard entry (adapters/claude-code/claude_code.py:141-146) has matcher Bash|Read|... with no
   subagent filter, so it already ran for the main thread; but `main()` returned 0 before deciding for non-subagents.
   Now `main()` emits `ask` for the main thread. No adapter change needed. Test:
   test_generated_hook_runs_the_guard_for_the_main_threads_bash_calls. Commit b900ae3.
3. Tests: tests/test_guard_mainthread.py (new). Commit b900ae3.
4. Nits: `ap = argparse` spacing; `note -h/--help` and `show -h/--help` print help (test in tests/test_cli_commands.py).
   Commit 5f38a76.
5. Nit: the cron advisory points at the README only when it has a fenced cron recipe (`^```cron`), bay/lint.py. Commit 5f38a76.
6. Tests, check, boundary run (below).

`approve` is not in the hook on purpose: no allow rule covers it, so any spelling already gets the default prompt, and
tests/test_boundaries.py asserts the main thread's plain `approve` is "pass" from the guard (unchanged).

Spellings tested (main thread -> ask; a role subagent -> deny for each):
`note dispatch|'dispatch'|"dispatch"|disp\atch`, `note 'review'|"review"|re\view`, `show re\claim|'reclaim'|"re""claim"`,
`--project .` / `--project=.` / `--proj .` / `--` before the verb, `FOO=1 ` and `A=1 B='2 3' ` env prefixes, launchers
`.agentbay/bay`, `./bay.sh`, `bay.sh`, `python3 -m bay.cli`, `PYTHONPATH=. python3 -m bay.cli`, `python3 bay/cli.py`,
and `echo hi; ...` / `true && ...` prefixes.
No decision (pass) in the main thread: `note <ref> "text about dispatch"`, `note <ref> dispatch`, `note task`, `status`,
`status --log -n 20`, `show <callId>`, `show '<callId>'`, `catalog`, `catalog forge.extend`, `approve`, `'approve'`,
`./bay.sh check`, a git commit message mentioning the words, `ls`.

Evidence:
- `python3 tests/run.py -q`: `476 passed, 0 failed`
- `./bay.sh check`: `✓ 6 modes, 21 features, 5 roles (17 role units), 8 envs, 13 connectors resolve (agent profile claude-code)` (after `✓ lint clean`)
- boundary: `boundary origin/main...HEAD: 104 changed paths (36 core, 3 docs, 31 extension, 9 feature, 25 other); 0 failing; B-11 docs: 0 hits`

# HANDOFF part 13: T-20261030-9a71 (recorded with `bay plan`) - stage 3 review fixes (verdict-s3-fixed)

Outcome: all four should-fix/nit findings of the stage-3 review fixed; nothing pushed, the proposal not edited, no path outside 0008's touches.
To-do (one commit each, tests green before each):
1 DOD-2 (1ed46df): `bay note` / `bay show` refuse any option directly after the command (`_verb_first` in bay/cli.py, run on the raw argv before `--project` is hoisted), so `note dispatch`, `note review` and `show reclaim` always match their ask prefix. The error names the right spelling. Checked every pre-approved prefix (show, status, note, catalog): the only ledger writers in bay/cli.py are `approve` (asked), `note dispatch`, `note review`, `note <ref> text` (a plain note, read-only in effect, stays allowed) and `show reclaim`; status and catalog write nothing. New tests: tests/test_cli_commands.py `test_a_write_verb_must_directly_follow_note_or_show_so_the_ask_rules_match`, tests/test_guard_7a.py (the canonical write forms each start with an ask prefix; the allow list is exactly show, status, note, catalog).
 Refused spellings (each exits non-zero with "no option may come before the verb", ledger unchanged):
 - `note --agent x dispatch T-20261030-abcd`
 - `note --kind note review T-20261030-abcd {}`
 - `note --project . dispatch T-20261030-abcd --agent x`
 - `note --project=. dispatch T-20261030-abcd --agent x`
 - `note --instruction dispatch T-20261030-abcd`
 - `show --reason r reclaim R-1`
 - `show --project . reclaim R-1`
 `--project` before the command (`bay --project . note dispatch ...`) does not match the allow prefix either, so it prompts.
2 DOD-8 (852d97e): `check --json` needs `--base` (refused like --proposal/--docs); the lint and resolve lines go to stderr, stdout is the boundary JSON only. Test: `test_check_json_prints_only_the_boundary_json_on_stdout` (json.loads of stdout).
3 DOD-13/R-4 (d75b5b5): docs/INTERFACES.md lines 7, 24, 339 and docs/DESIGN.md:12 corrected (no framework/agents/, no schemas/agent.schema.json; profile is `profile:` in adapters/<name>/adapter.yaml; a mode lists features, not workflows).
4 DOD-9 (e179ac4, cc521cf): check summary says `21 features`, the COORDINATOR heading is "Mode features (generated)", the catalog help says features. The JSON keys `endpoints` in catalog.json and the `<mode>.<endpoint>` call targets are data formats and stay. The schedule advisory points at the mode's README cron recipe when that README has one (improve: `see the cron recipe in framework/modes/improve/README.md`), else keeps `run ... from cron`; test in tests/test_lint.py. cc521cf also fixes a missing space in the summary I introduced in e179ac4.
Evidence, last line of each command:
- `python3 tests/run.py -q`: `471 passed, 0 failed`
- `./bay.sh check`: `✓ 6 modes, 21 features, 5 roles (17 role units), 8 envs, 13 connectors resolve (agent profile claude-code)`, after `✓ lint clean` (same four `!` advisories, the improve one now points at the README)
- `./bay.sh check --base origin/main --proposal docs/proposals/0008-simplify-without-losing-features.md --docs`: `boundary origin/main...HEAD: 103 changed paths (36 core, 3 docs, 31 extension, 9 feature, 24 other); 0 failing; B-11 docs: 0 hits` (run before this HANDOFF commit)
- `./bay.sh build --project <scratch>/s3e` (folder was empty): last line `  ! Per-role Bash scope is enforced by the agentbay guard hook; restart Claude Code and accept the workspace trust prompt so hooks run.`
- `./bay.sh clean --project <scratch>/s3e`: `clean`
- Glob `**/*` of <scratch>/s3e afterwards: `<scratch>/s3e/agentbay.config.yaml` only.
Open items: none. Deviations: none.

# HANDOFF part 12: T-20261030-1ca6 (recorded with `bay plan`) - stage 3 of 0008: rename leftovers

Outcome: every "rename leftover" entry of 0008's touches is fixed, plus the four extra hits; the forge coordinator playbook has the `git fetch origin` line. Wording only; no behaviour change, no alias. Branch feat/0008-stage3, nothing pushed, the proposal not edited.
To-do (all done; one commit, 77806d3, because the 26 files are one wording sweep and the tests cover them together):
1 Touches entries "rename leftover" (77806d3): the six offline-env files (connectors/x-api, fake, fake-mail README + connector.yaml, modes/feed-briefing and mail-briefing README) now say `offline: true` in agentbay.config.yaml and the env's `offline:` block instead of `local-*-offline`/`envs:`; bay/playbook.py `features.<feature>.review`; coordinator/commands/bay-status.md `status --log -n 10`; bay/checks.py detail `bay check: lint clean`; bay/registry.py comment; improve.findings.v1.yaml `bay approve <F-id>`; schemas/connector.schema.json (`bay check` twice); scaffold connector.yaml, forge README, create playbook (`bay new <kind>`, `./bay.sh check`), create/extend rules (`bay check`), cos run, improve audit, backlog (playbook DOD-2 and rules R-3 name `bay approve`), implement playbook.
2 Extra hits (77806d3): bay/cli.py:405 note summary is now `approve <F-id> <decision>`; bay/scaffold.py docstring `bay new <kind>`; framework/interfaces/forge.scaffold.v1.yaml `bay new <kind>`. bay/improve/sources.py:314 `"target": "review-record"` is NOT changed: it is not display text. It is the verdict `target` key that `_number_rounds` groups on and that detectors and findings read; tests/test_review_record.py:39 asserts it. The ledger event type is `review.recorded` (unchanged), but a finding's evidence can carry the target string, so renaming would alter data. It stays as a stored value; that is not a command name.
3 Playbook line (77806d3): framework/modes/forge/playbook.md, bullet "Before every `forge.extend` call, run `git fetch origin` yourself, so the deadcode base (origin/main) is current." It is a bullet on purpose: the adapter drops bullets naming an uninstalled endpoint, so projects outside the checkout do not see `forge.extend` (a first try as plain prose failed test_b2; fixed before commit).
4 `git grep -n` of the old spellings (bay lint|validate|boundary|log|dispatched|task new|ls|reclaim, review-record, improve decide|weekly, bay mode|feature|connector|env new, bay <kind> new, local-feeds-offline, local-mail-offline, ./bay.sh lint|validate|boundary), excluding HANDOFF.md, CHANGELOG.md, docs/proposals: remaining hits are exactly
 - bay/improve/sources.py:314 (stored `target` value, above)
 - tests/test_cli_commands.py:11 (OLD tuple: the old names must be unknown commands)
 - tests/test_config.py:15 (asserts the two old env files no longer exist)
 - tests/test_review_record.py:39 (stored target) and :45 (old command refused)
 In history files (hit counts): CHANGELOG.md 4, HANDOFF.md 37 (parts 1-11), docs/proposals 0001 3, 0001a 9, 0003 2, 0004 3, 0005 1, 0006 9, 0008 30 (its own text).
5 Scratch build `s3d`: Grep (case-insensitive) of the whole folder for old command names, `<kind> new`, `local-*-offline`, `endpoints.<feature>`: No matches found. A wider Grep of .agentbay/COORDINATOR.md for lint|validate|boundary|dispatched|reclaim|review-record|improve decide|task new found only the current `show reclaim` and `note dispatch` forms (lines 280, 292); of .claude/ only `status --log -n 10` (bay-status.md) and the English noun "lint" in a skill (improve--pattern-analysis SKILL.md:14). The earlier open item (bay-status.md) is closed.
Evidence, last line of each command:
- `python3 tests/run.py -q`: `469 passed, 0 failed`
- `./bay.sh check`: `✓ 6 modes, 21 endpoints, 5 roles (17 role units), 8 envs, 13 connectors resolve (agent profile claude-code)`, after `✓ lint clean` (same four `!` advisories)
- `python3 -m bay.cli check --base origin/main --proposal docs/proposals/0008-simplify-without-losing-features.md --docs`: `boundary origin/main...HEAD: 81 changed paths (29 core, 3 docs, 24 extension, 1 feature, 24 other); 0 failing; B-11 docs: 0 hits` (run before this HANDOFF commit)
- `./bay.sh build --project <scratch>/s3d` (folder had only its agentbay.config.yaml): last line `  ! Per-role Bash scope is enforced by the agentbay guard hook; restart Claude Code and accept the workspace trust prompt so hooks run.`
- `./bay.sh clean --project <scratch>/s3d`: `clean`
- Glob `**/*` of <scratch>/s3d afterwards: `<scratch>/s3d/agentbay.config.yaml` only.
Open items: none. Deviations: none from the command list.

# HANDOFF part 11: T-20261030-f8ef (recorded with `bay plan`) - slice 4 of 0008: the CLI

Outcome: `bay --help` lists 16 commands (25 before; the proposal's 15 plus `plan` from item 6). An old name is an unknown command (argparse `invalid choice`, exit 2); no alias, no compatibility branch. Branch feat/0008-stage3, nothing pushed, the proposal not edited. Guard decisions keep their meaning (below). One needed fix is outside 0008's touches (open items).
Old -> new:
| old | new |
|---|---|
| `validate`, `lint` | `check` (lint, then resolve, then workflows) |
| `boundary --base ...` | `check --base <ref> [--head --proposal --docs --json]` (options without `--base` are refused) |
| `ls` | `catalog --roles` (role units, resolved from sources, no build needed; the mode/endpoint half of `ls` was `catalog`) |
| `reclaim <run>` | `show reclaim <runId> [--reason]` |
| `log -n` | `status --log -n` |
| `task new` | `note task` |
| `dispatched <taskId> --agent ...` | `note dispatch <taskId> --agent ...` |
| `review-record <taskId> <json>` | `note review <taskId> <json>` |
| `mode\|feature\|connector\|env new <name>` | `new <kind> <name>` (`--mode` for a feature, `--implements` for a connector, checked) |
| `improve decide <id> approve\|defer\|wontfix` | `approve <F-id> [--defer\|--wontfix] [--reason]` (the F- prefix selects it; terminal only, `--via chat`, `--reject`, `--quote`, `--sha` are refused for it) |
| `improve weekly` | removed (proposal: "removed"; item 4 makes the weekly run a cron line or workflow). The improve playbook and README now list the four calls in order, with a cron line. |
Kept as they were: `build clean catalog describe call submit show approve secret auth config status note plan`.
Where the proposal was silent I chose: `note` takes the verb first (`note task|dispatch|review`) and `show` takes `reclaim` first, so a permission rule can match them by prefix; `review-record` goes into `note` (like dispatch) rather than staying a 17th command; `ls` goes into `catalog --roles`.
Guard and permissions (same decisions):
- bay/guard.py needed no rule change: a role subagent may run only `.agentbay/bay plan <own taskId> ...`; every other spelling (including all new ones) is denied by the same checks; `approve` is denied to anyone by `runs_approve`, so `approve <F-id>` is covered. Only the docstring names changed. `secret`, `auth`, config writes: unchanged paths (non-TTY refusal, `names_config`).
- The main thread pre-approves `show|status|note|catalog` (was `show|status|log|note|task|catalog`). Three writes now share a prefix with a pre-approved command, so adapters/claude-code/claude_code.py adds `ask` rules (checked before `allow`) for `show reclaim`, `note dispatch`, `note review` in every spelling that `approve` already had; before, `reclaim`, `dispatched` and `review-record` were not pre-approved and so asked. `approve` keeps its ask rules.
- `bay secret set` and `bay auth` unchanged (interactive terminal only). The Chief of Staff playbook now also says never to relay a backlog decision (`bay approve <F-id>`) from chat.
- The env `clis` for the forge builders (framework/envs/framework-dev.yaml, local-authoring.yaml) list `./bay.sh check` instead of `lint` and `validate`.
Generated text: the cos playbook (so `.agentbay/COORDINATOR.md`), the adapter's control-plane section, improve and forge playbooks, scaffold hints, error messages, README, DESIGN, INTERFACES, conformance.yaml, two schema descriptions. A scratch build's COORDINATOR.md has no old command name (grep of the scratch folder found only `.claude/commands/bay-status.md`, see open items). The checkout's own `.agentbay/COORDINATOR.md` is untracked and generated: it still shows the old names until the coordinator runs `./bay.sh build`.
To-do (all done; the work is in three commits, 4b8da69 the CLI, guard texts, adapter, playbooks and tests together because the names and their tests change together, 46750c0 README/DESIGN/INTERFACES, dd0faaa reverts of edits that the boundary check refused plus a README wording fix):
1 Read proposal, guard, model, adapter, CLI (no commit).
2 Merge commands and remove the old code: `cmd_ls`, `cmd_log`, `cmd_task`, `cmd_reclaim` as a command, `cmd_review_record`, `cmd_dispatched`, `cmd_improve_decide`, `cmd_improve_weekly`, `WEEKLY`, `SCHEDULED_BY` (lint) are gone (4b8da69).
3 Names in guard, adapter, generated text, playbooks, env clis, tests (4b8da69, 46750c0, dd0faaa). Tests: only command names changed in existing tests (test_boundaries, test_review_record, test_ledger, test_selector, test_lint, test_forge, test_adapter, test_improve) plus extra denials in `test_bay_plan_is_the_only_bay_command_a_subagent_may_run` (note review/dispatch/task, show reclaim, approve, approve F-id, secret, auth, check, catalog) and ask-rule asserts in test_guard_7a. `test_weekly_writes_the_backlog_only_after_the_analysis_steps` is deleted with the command it tested. New tests/test_cli_commands.py (16 commands, old names unknown, note/show/new/catalog forms).
4 Checks and this note.
Open items (outside 0008's touches, so editing them fails the boundary check; add to the next amendment):
- BLOCKER-ish: `coordinator/commands/bay-status.md` (kernel-owned, not in touches) still runs `bay log -n 10`; the generated slash command `/bay-status` now calls an unknown command. Change it to `{{BAY}} status --log -n 10` (or drop the log call).
- Feature folders of existing framework modes (B-3, not in touches): `framework/modes/cos/features/run/playbook.md:27` (`bay lint`), `framework/modes/forge/features/create/playbook.md` (lines 11, 13, 17: `bay <kind> new`, `./bay.sh lint` and `./bay.sh validate`; the builder's cli list no longer has them, so create's builder is told to run unknown commands), `framework/modes/forge/features/create/rules.yaml` and `.../extend/rules.yaml` (`bay lint` in a statement), `framework/modes/improve/features/{audit,backlog,implement}/...` (`bay lint`, `bay improve decide` in playbook/rules text, and DOD-2 of backlog, which the report no longer matches: it prints `bay approve`). I made these edits and reverted them when the boundary check refused them.
- Core files not in touches: `bay/checks.py:87` (detail text `bay lint clean`), `bay/registry.py:10` (comment `bay lint`), `framework/interfaces/improve.findings.v1.yaml:117` (`bay improve decide`), `schemas/connector.schema.json:68,152` (`bay lint`, `bay validate` in two descriptions). `docs/proposals/*` and this file's older parts keep the old names as history.
- `lint` still warns that `improve.backlog` (schedule weekly) should be run by `bay call improve.backlog` from cron; that alone writes the report without the scan, audit and triage calls. Slice 6 turns the weekly run into a feature or workflow; until then the improve README has the four-call cron recipe.
Deviations from the task's command list, to be honest about: the checks were run as `./bay.sh check` and `python3 -m bay.cli check --base ...` (the renamed lint, validate and boundary); `./bay.sh lint` and `validate` no longer exist. Two helper edits were done with `python3` (a heredoc for the parser block in bay/cli.py, and a `python3 -c` to delete one test function from tests/test_improve.py); the results are in the commits and the tests pass.
Dead-code check: not run here (it runs when cos re-runs forge.extend). Replaced code was removed completely; grep for `cmd_ls`, `cmd_log`, `cmd_task`, `cmd_improve`, `WEEKLY`, `SCHEDULED_BY`, `cmd_review_record`, `cmd_dispatched` in bay/, tests/, framework/, docs/ finds nothing.
Evidence, last line of each command:
- `python3 tests/run.py -q`: `469 passed, 0 failed` (run on dd0faaa)
- `./bay.sh check` (was lint, then validate): `✓ 6 modes, 21 endpoints, 5 roles (17 role units), 8 envs, 13 connectors resolve (agent profile claude-code)`, after `✓ lint clean` (four `!` advisories as before)
- `python3 -m bay.cli check --base origin/main --proposal docs/proposals/0008-simplify-without-losing-features.md --docs` (was boundary): `boundary origin/main...HEAD: 80 changed paths (29 core, 3 docs, 24 extension, 1 feature, 23 other); 0 failing; B-11 docs: 0 hits` (run on dd0faaa, before this HANDOFF commit)
- `./bay.sh build --project <scratch>/s3c` (folder did not exist): last line `  ! Per-role Bash scope is enforced by the agentbay guard hook; restart Claude Code and accept the workspace trust prompt so hooks run.`
- `./bay.sh clean --project <scratch>/s3c`: `clean`
- Glob `**/*` of <scratch>/s3c afterwards: `<scratch>/s3c/agentbay.config.yaml` only (the user's file, left by clean).
- `./bay.sh lint` now: `bay: error: argument <command>: invalid choice: 'lint' (choose from 'check', 'build', 'clean', 'catalog', 'describe', 'call', 'submit', 'show', 'approve', 'new', 'secret', 'auth', 'config', 'status', 'plan', 'note')`
- `./bay.sh --help` command list (the positional section):
```
check            lint and resolve everything; with --base, also check a change's boundary
build            compile modes and roles into a runtime
clean            remove what build wrote
catalog          the registry: modes, endpoints, schemas, project workflows (--roles: role units)
describe         a mode's or role's resolved definition
call             run <mode>.<endpoint> with a JSON input ('-' reads stdin)
submit           hand back an agentic step's output
show             the state of a call; `show reclaim <runId>` marks a stuck run as reclaimed
approve          pass (or --reject) an approval gate; interactive terminal, or chat when approvals.chat is on; an F-id decides an improve backlog item
new              scaffold a mode, feature, connector or env
secret           store a secret in the keychain (interactive terminal only)
auth             sign in to a source in your browser (interactive terminal only)
config           print every agentbay.config.yaml setting, from the schemas
status           calls, steps and agent runs from the ledger (--agents, --log)
plan             a dispatched agent's outcome and to-do list (append-only; the one command subagents may run)
note             record a note on a run, task or call; `note task` mints a taskId; `note dispatch` and `note review` are the coordinator's records
```

# HANDOFF part 10: T-20261030-72ef (recorded with `bay plan`) - slice 3 of 0008: one feature shape

Outcome: slice 3 is implemented on feat/0008-stage3, nothing pushed, the proposal not edited. Every mode builds from `features:`; a code-only feature has no playbook, no rules and no folder and passes lint; `bay catalog` is unchanged except for ordering. No old-shape reader, alias or compatibility branch was added; no `feature.yaml` (0006 slice 4 lands inside the feature block).
To-do (all done, one commit because schema, loader, lint, modes and tests change together; c9e6dcc):
1 Catalog baseline saved before any change: <scratch>/catalog_before.txt (scratchpad root).
2 Shape: `spec.features.<name>` = `{description, in, out, effects, steps, playbook?, rules?, review?, schedule?, roles?, tier?, effort?}`. schemas/mode.schema.json: `endpoints` and `workflows` are replaced by `features` with `steps`; the step definition moved to `$defs/step`. bay/model.py: `Feature.workflow` field, the workflow lookup and the unknown-workflow gap are gone; `merge_mode` merges features key by key and a child's `steps` replace the parent feature's whole (the `workflows` branch is removed); `role_env_problems`, `mode_envs`, `resolve_mode`, `_feature` read `features`. bay/dispatch.py needed no code change (it runs `Feature.steps`); docstrings follow.
3 Lint (bay/lint.py): a feature with a role or review step and no `playbook` is refused ("runs an agent but has no `playbook`"); rules and playbook are otherwise optional; the "workflow is not used", "unknown workflow" and "feature folder is missing playbook.md/rules.yaml" checks are removed (no workflow, and the files are optional); an orphan feature folder is still refused. Line lookup (`_ep_key_where`, `_step_where`) reads `features:` and matches a feature's own keys (6-space indent), so a step's `roles:` is not mistaken for the feature's.
4 Migrated: modes/{briefing,delivery,mail-briefing}/mode.yaml, framework/modes/{cos,forge,improve}/mode.yaml (steps inline, text of every step unchanged). bay/improve/{conformance,graph,sources}.py read `features`/`steps`. bay/scaffold.py scaffolds the single block: framework/modes/forge/templates/feature/feature.yaml replaces endpoint.yaml and workflow.yaml (deleted); the mode template is one `features:` block. Docs: docs/INTERFACES.md, docs/DESIGN.md, bay/workflows.py docstring, schemas/config.schema.json and framework/rules/conformance.yaml wording.
5 Tests (tests/ is "other" to the boundary): the 22 tests that wrote `endpoints`/`workflows` now write `features`/`steps` (test_dispatch, test_review7a, test_roles, test_resolver, test_inheritance, test_lint); new `test_a_feature_that_runs_an_agent_needs_a_playbook_and_a_code_only_one_needs_no_files` (briefing.sync without playbook, rules or folder: lint empty, resolves with no DoD and code steps only); `test_lint_lines_of_inherited_parts...` now checks a child's own steps are reported at the child's step line; test_forge asserts a scaffolded feature is one `features:` block with no `endpoints`/`workflows`.
Open, outside this slice's touches: bay/playbook.py:62 still says "configure review only in mode.yaml endpoints.<feature>.review" (bay/playbook.py is not in 0008's touches, so editing it would fail the boundary check); add it to the next amendment and change the wording to `features.<feature>.review`. Existing extension READMEs were grepped for `endpoints:`/`workflows:`/`workflow:`: none name the old shape. The apiVersion bump stays in slice 9 (mode documents are still `agentbay/v2`).
Dead-code check: not run here (it runs when cos re-runs forge.extend). Replaced code was removed completely. Grep (`\.workflow\b`, `["workflow"]`, `spec["workflows"]`, `spec["endpoints"]` on modes, `endpoint.yaml`, `workflow.yaml`, `_lineage_where(... 'workflows'`) finds nothing in bay/, framework/, modes/, schemas/ or docs/ outside the proposals and this file. `spec["endpoints"]` that remains is the interface (connector capability) endpoints, which are a different concept.
Evidence, last line of each command:
- `python3 tests/run.py -q`: `464 passed, 0 failed`
- `./bay.sh lint`: `✓ lint clean` (four `!` advisories as before)
- `./bay.sh validate`: `✓ 6 modes, 21 endpoints, 5 roles (17 role units), 8 envs, 13 connectors resolve (agent profile claude-code)`
- `python3 -m bay.cli boundary --base origin/main --proposal docs/proposals/0008-simplify-without-losing-features.md --docs`: `boundary origin/main...HEAD: 57 changed paths (22 core, 3 docs, 16 extension, 16 other); 0 failing; B-11 docs: 0 hits` (run on c9e6dcc, before this HANDOFF commit)
- `./bay.sh build --project <scratch>/s3b`: last line `  ! Per-role Bash scope is enforced by the agentbay guard hook; restart Claude Code and accept the workspace trust prompt so hooks run.` (it reported `built 6 modes for claude-code`)
- `./bay.sh clean --project <scratch>/s3b`: `clean`
- Glob `**/*` of <scratch>/s3b afterwards: `<scratch>/s3b/agentbay.config.yaml` (written by build, left by clean because it is the user's file) and `<scratch>/s3b/proj/.git/**` (a git-init folder that was already in the scratch folder before this task; not created by the build or by me). No generated adapter file is left.
- Catalog before/after: before = `./bay.sh catalog` in the checkout before any change (registry built 14:34:42, includes forge.extend, 21 endpoints); after = `./bay.sh catalog --project <scratch>/s3b` after `build` (registry built 15:15:36). The checkout's own `.agentbay/catalog.json` is only rewritten by a build of the checkout, which was not in the allowed commands, so the after-catalog comes from a scratch project; a scratch project does not install forge.extend (`System.for_project`), which is the only line that differs: all 20 other endpoint lines (names, in -> out types, effects, review roles), all mode headers and the `project workflows: none` line are identical, in the same order. forge.extend is covered by `validate`: still 21 endpoints, and by tests (`test_dispatch` extend flows, `test_deadcode_check` step order, `test_lint` mandatory review).

# HANDOFF part 9: T-20261030-79af (recorded with `bay plan`) - slice 2 of 0008: envs, agent profile, config

Outcome: slice 2 is implemented on feat/0008-stage3 (cut from origin/main 1da7f88), nothing pushed, the proposal not edited. Both offline env files and the committed example config are gone; the fake-source demo runs (`offline: true`); lint refuses an offline block with a network host or a secret, and a config that raises an env limit. No v2 readers, aliases or compat branches were added.
To-do (all done, one commit because the items share schemas and tests; 8742b4e, then 8cf495d for a README wording fix that the B-11 docs check needed):
1 Offline switch in the env: `envs/local-feeds.yaml` and `envs/local-mail.yaml` carry `offline: { bind: { items.source/v1: [fake | fake-mail] } }`; `envs/local-*-offline.yaml` deleted; `substitutes:` removed from schemas/environment.schema.json (now `offline {bind, network, secrets}`), the `envs:` map removed from schemas/config.schema.json (now `offline: boolean`). `Kit._go_offline` (bay/model.py) rebinds the listed capabilities and forces `network: {allow: []}` and `secrets.allow: []`; `Kit.env_name`, `_select_envs`, `env_swap` and `lint_substitutes` are removed, and a role's env name is now the env itself (units are `analyst--feed-briefing`, env `local-feeds`). New `lint.lint_offline`: refuses an `offline:` block that lists a network host or a secret, or rebinds a capability the env does not bind; `lint_contract_versions` checks the offline connectors too (label `env local-mail (offline)`).
2 Agent profile in the adapter: `framework/agents/claude-code.yaml` and schemas/agent.schema.json deleted; the profile is `profile:` in `adapters/claude-code/adapter.yaml` (schemas/adapter.schema.json, optional, same fields). `Kit.profiles()` and `Kit.profile()` return the profile dict; the `Agent` kind, `FRAMEWORK_ONLY["Agent"]` and the `agents/` ownership line in framework/components.yaml are removed; claude_code.py, improve/graph.py and improve/conformance.py follow.
3 Config: `agentbay.config.example.yaml` deleted; `bay build` writes a minimal `agentbay.config.yaml` when the project has none (`config.write_minimal`); `bay config` (no argument) prints every setting from the schemas (`config.describe`); `config.example()`, `fragment()`, the kernel text blocks and the stale-example lint are removed (each extension's `config.example.yaml` stays and lint still checks it against its schema). Limits in one place: `config.caps` refuses a setting above the env `limits` (ConfigError; the step fails with the message), `config.raised` + `lint.lint_config_limits` refuse it in lint; settings no longer enter the `min` in `caps` (they already reach it through `effective_constraints`).
4 Tests: tests/test_config_example.py -> tests/test_config.py (no example, `bay config`, minimal config on build, caps, raised cap fails a call); tests/test_lint.py (offline refusals, raised limits); test_resolver (offline switch, adapter profile); helpers (`project()` sets `offline: true`); test_mail_briefing, test_roles, test_inheritance, test_dispatch, test_selector, test_boundaries, test_contract_versions and the corpus-store tests follow the env rename (`local-feeds-offline` -> `local-feeds`; the corpus-store tests get an `online=True` store built from the same project without `offline`).
5 Docs: README, docs/DESIGN.md, docs/INTERFACES.md (all in touches) and connectors/gmail-api/README.md (in touches) follow.
Open, outside this slice's touches (stale wording, not code): connectors/x-api/README.md:11, connectors/fake/README.md:4, connectors/fake-mail/README.md:4 and connector.yaml:7, modes/feed-briefing/README.md:7 and modes/mail-briefing/README.md:11 still name `local-feeds-offline` / `local-mail-offline` or the `envs:` line. They are existing extensions not listed in 0008's touches, so the boundary check would fail an edit; add them to the next amendment (slice 2 or 9) and fix the wording. The apiVersion bump stays in slice 9 (configs and envs are still `agentbay/v2`).
Dead-code check: not run here (it runs when cos re-runs forge.extend). Replaced code was removed completely; grep for `env_name`, `env_swap`, `substitutes`, `docs["Agent"]`, `config.EXAMPLE`, `framework/agents`, `agentbay.config.example` finds only the stale extension READMEs above and the new tests that assert absence.
Evidence, last line of each command:
- `python3 tests/run.py -q`: `463 passed, 0 failed`
- `./bay.sh lint`: `✓ lint clean` (four `!` advisories as before)
- `./bay.sh validate`: `✓ 6 modes, 21 endpoints, 5 roles (17 role units), 8 envs, 13 connectors resolve (agent profile claude-code)`
- `python3 -m bay.cli boundary --base origin/main --proposal docs/proposals/0008-simplify-without-losing-features.md --docs`: `boundary origin/main...HEAD: 39 changed paths (16 core, 3 docs, 7 extension, 13 other); 0 failing; B-11 docs: 0 hits` (run on 8cf495d, before this HANDOFF commit)
- `./bay.sh build --project <scratch>/s3a` (folder did not exist): last line `  ! Per-role Bash scope is enforced by the agentbay guard hook; restart Claude Code and accept the workspace trust prompt so hooks run.`; the output starts `+ agentbay.config.yaml` (the minimal config)
- `./bay.sh clean --project <scratch>/s3a`: `clean`
- Glob `**/*` of <scratch>/s3a afterwards: `<scratch>/s3a/agentbay.config.yaml` only. `clean` leaves the config because it is the user's file, not generated by an adapter.
- Fake-source demo: `tests/test_mail_briefing.py::test_offline_sync_digest_and_ask` and the feed flows in test_dispatch run on `offline: true` and pass in the 463 above; I did not run `bay call` by hand (not in the allowed commands).

# HANDOFF part 8: T-20261030-f82e (recorded with `bay plan`) - fix round for the stage-2 review of 0008 (C-20261030-79f3e5)

Outcome: every should-fix finding of the review (DOD-5, DOD-7, DOD-8, DOD-13, R-4, R-7, R-9) is fixed; the proposal was not edited; no Guard decision changed. Branch feat/0008-stage2, nothing pushed.
Declared (DOD-7/R-9): cc55bd8 is an out-of-slice refactor of `Guard._bash`, `ClaudeCodeAdapter._settings` and `ledger_verdicts`. It was forced by the stale local `origin/main` (1fc4803, PR #10) that the first deadcode run used as base, and it is behaviour-equivalent per the review. The owner decided to keep it. Add it to the next 0008 amendment's touches (slice 1, reason "complexity refactor surfaced by the first deadcode run"). The owner also accepted the four flagged scope items (test_dispatch stubs, README and INTERFACES edited in slice 1, improve-detect 0.1.0 -> 0.2.0, fixed base `origin/main`); ledger note on C-20261030-79f3e5.
Fixes:
1 (5d7959a) DOD-8 base drift: `Pipeline.change` resolves `git merge-base <base> HEAD` and exports that commit; a base that does not resolve is refused with "fetch <remote> (git fetch <remote>)"; the resolved sha is named in `warnings`. The extend playbook says the coordinator runs `git fetch origin` first. Tests `test_the_base_is_the_merge_base_not_the_moved_ref`, `test_a_base_that_does_not_resolve_says_to_fetch`.
2 (5d7959a) DOD-8 graph asymmetry: when the project is the kit the base graph is built with `graph.build(old, old)`, so it has concept nodes like the current one. Test `test_an_unused_concept_that_existed_at_base_is_not_new_when_the_project_is_the_kit` (project == kit, an unused interface present at base is reported unused now and not new).
3 (5d7959a, 0843c27, d455025) DOD-8 smaller items: findings are compared uncapped (maxFindingsPerDetector raised for both sides, test `test_a_second_finding_with_the_same_fingerprint_is_new` checks the value passed); fingerprints compared as a multiset (same test: a second identical fingerprint is new); tar errors become `ValueError("cannot extract <base>: ...")` (`test_a_broken_archive_is_a_clear_error`); the base reader refuses .env* and files over 1 MB like artifact-graph and names them under `unreadable at base` (`test_the_base_side_refuses_env_files_and_large_files`); the endpoint description names the temporary export (removed on return) and the fingerprint granularity (compat-layer per file, complexity per function) instead of changing `effects`; the B-7 fixtures `lib/tests/helper.py` and `shared/x_entry.py` now contain `import gmail_api` and the test asserts both hits again (0843c27); `ask = perms` spacing (d455025).
4 (afe15c6) DOD-13/R-4: docs/DESIGN.md (Safety model) describes the `deadcode` step in contract terms; DESIGN.md is allowed by touches.
Evidence, last line of each command:
- `python3 tests/run.py -q`: `460 passed, 0 failed`
- `./bay.sh lint`: `✓ lint clean` (four `!` advisories as before)
- `./bay.sh validate`: `✓ 6 modes, 21 endpoints, 5 roles (17 role units), 10 envs, 13 connectors resolve (agent profile claude-code)`
- `python3 -m bay.cli boundary --base origin/main --proposal docs/proposals/0008-simplify-without-losing-features.md --docs`: `boundary origin/main...HEAD: 27 changed paths (10 core, 3 docs, 6 extension, 1 feature, 7 other); 0 failing; B-11 docs: 0 hits`
- `./bay.sh build --project <scratch>/s2fix` (empty folder): last line `  ! Per-role Bash scope is enforced by the agentbay guard hook; restart Claude Code and accept the workspace trust prompt so hooks run.` (it reported `built 6 modes for claude-code`)
- `./bay.sh clean --project <scratch>/s2fix`: `clean`
- Glob `**/*` of <scratch>/s2fix afterwards: `No files found`
- The scratch folder is an empty non-git folder, so there is no `git status` to quote; the Glob shows nothing left behind.
- Fake-source demo (offline switch, no network): `tests/test_mail_briefing.py::test_offline_sync_digest_and_ask` (sync, digest and ask over the fake source) passed (`1 passed, 0 failed` with `-k offline_sync_digest`); `tests/test_adapter.py::test_cli_build_and_clean_on_tmp_repo` and its sibling (the round trip on a tmp repo) passed (`2 passed, 0 failed` with `-k cli_build_and_clean`). I did not run `bay call feed-briefing.sync` by hand (not in the allowed commands).

# HANDOFF part 7: T-20261030-b84c (recorded with `bay plan`) - stage 2 of 0008, the dead-code check (item 5 of part 6)

Outcome: `improve.detect/v1.change` and the `deadcode` step in forge.extend exist, are tested, documented and committed on feat/0008-stage2. Done.
To-do (all done):
1 (019645d) `change {base}` in framework/interfaces/improve.detect.v1.yaml, framework/connectors/improve-detect (connector.yaml 0.2.0, improve_detect.py, README.md) and `Pipeline.change` (bay/improve/pipeline.py): audits the working tree and the base tree (`git archive` into a temp dir, never run), keeps unused, unused-constant, compat-layer and complexity candidates whose fingerprint is absent at base; returns `{new, existing, warnings}` plus `stopped` when `new` is not empty (the dispatcher ends a code step with `stopped` as blocked).
2 (9f07820) forge mode.yaml: step `deadcode` (`run: improve.detect/v1.change`, `base: origin/main`) between implement and review; `improve.detect/v1` in needs; local-authoring binds improve-detect, ledger (session.events, review.verdicts) and artifact-graph.
3 (9f07820) extend playbook: Steps list has `deadcode`; DOD-14.
4 (9f07820) tests/test_deadcode_check.py: unused function plus compat alias give two new findings (the existing unused function counts as `existing`); a base finding does not count; any revision works and a bad one is refused; a new finding blocks the extend call before review; the step plan has deadcode between implement and review. tests/test_dispatch.py: two extend tests that run past implement stub the step (their kit copy is not a git repo); tests/ is "other" to the boundary, not in touches.
5 (640d3da, 168a089) README and docs/INTERFACES.md describe the endpoint and the step.
Note: the base is the literal `origin/main` in mode.yaml; ExtendReq (types, not in touches) has no base field.
Evidence:
- `python3 tests/run.py -q`: 453 passed, 0 failed
- `./bay.sh lint`: ✓ lint clean
- `./bay.sh validate`: ✓ 6 modes, 21 endpoints, 5 roles (17 role units), 10 envs, 13 connectors resolve (agent profile claude-code)
- boundary: boundary origin/main...HEAD: 73 changed paths (28 core, 3 docs, 20 extension, 1 feature, 21 other); 0 failing; B-11 docs: 0 hits

# HANDOFF part 6: T-20261030-882f (recorded with `bay plan`) - stage 2 of 0008, step `implement` of C-20261030-0cbe82

Outcome: slice 1 minus the dead-code check, plus carry-overs (a)-(d). PARTIAL: stopped at the tool-call budget. Branch feat/0008-stage2.
To-do (done: 1, 2, 3, 4, 6, 7; open: 5 = the dead-code check, then the evidence block).
1 (4d673db) (a) `ledger.dispatched_agent` returns the coordinator's latest `agent.dispatch` of a taskId and uses a `spawned` record only when no dispatch exists, so a later spawn cannot launder another call's taskId. Test `test_a_later_spawn_record_does_not_override_the_coordinators_dispatch`.
2 (4d673db) (b) `Dispatcher._close_runs`: a role step's submit appends `completed` for every still-running run dispatched to that call and step (and the run the result names). Test `test_a_steps_submit_closes_every_run_dispatched_to_that_call_and_step`.
3 (bb00394) `CHANGELOG.md` is in the kernel's `owns:` (framework/components.yaml). It was a real B-4 lint failure on this branch before.
4 (bb00394) Misfires: a repo-root file no component owns passes (`boundary.classify`, `boundary.stray`); owned root files (bay.sh, CHANGELOG.md) still need `touches:`. B-7 (`lint.lint_extension_names`) now scans connector code only, for imports (also `import_module("x")`) and the kernel's `agentbay_connector_*`/`agentbay_adapter_*` keys; prose, comments and mode playbooks are not scanned; `mode.yaml` naming a connector is still refused by the mode lint (lint.py ~306). Tests updated to the new spec (`test_no_extension_names_another_b7`, `test_b7_catches_...`, `test_ownership_lint_...`) and added (`test_repo_root_files_pass_...`); an import of another connector and a core edit without touches still fail. INTERFACES and conformance.yaml wording follow. Not done: renaming rules to plain reasons everywhere (messages keep their ids in brackets).
5 OPEN the dead-code check. Design, not built: a new `improve.detect/v1` endpoint `change {base}` -> `{new: [candidates], existing: n}` (framework/interfaces/improve.detect.v1.yaml, connector framework/connectors/improve-detect, `Pipeline.change` in bay/improve/pipeline.py): audit the working tree and the tree at `base` (export with `git archive` into a temp dir, never run its code), keep candidates of kinds unused, unused-constant, compat-layer, complexity whose `fingerprint` (bay/improve/store.py) is absent at base. forge `extend` gets a code step `deadcode` between `implement` and `review` (`run: improve.detect/v1.change`, stopped -> blocked on any new finding); forge needs `improve.detect/v1` in `needs:` and an env that binds improve-detect with its sources (see framework/envs/improve-local.yaml: artifact-graph, ledger). Add DOD-14 to features/extend/playbook.md ("no new unused code or compatibility layers"). Fixture test: add an unused function and a compat alias, expect two new findings; an existing finding does not count. Touches the owner must add to 0008 (editing it voids the approval): framework/interfaces/improve.detect.v1.yaml, framework/connectors/improve-detect/, framework/envs/local-authoring.yaml (or framework-dev) and framework/modes/forge/mode.yaml is covered by `framework/modes/*/mode.yaml`.
6 (this commit) (c) README mentions schedules (cron); suite has no README size test, count is about 900.
7 (d) the probe gate_repro_sha.py in the review-s1 scratchpad (not in the repo) catches `model.ResolveError` for R5: last line `R5 resolve refuses the edit (fixed): ...`.
Tests: 448 pass.

# HANDOFF part 5: T-20261030-ba74 (recorded with `bay plan`) - stage 1 fix round for the review of C-20261030-bc7db5

Outcome: DOD-8, DOD-9, R-7 and the usage double count fixed; the proposal was not edited. To-do: 1-5 done.
1 (92e3019) `Dispatcher._require_plan` takes the result's taskId only when that run's dispatch names this call and step (or no call). Test `test_a_plan_of_another_step_or_call_does_not_count` now expects refusal.
2 (92e3019) Chose to REMOVE the `agent` parameter of `ledger.record_plan`/`record_done` and the AGENTBAY_AGENT claim: nothing sets that variable and the CLI has no caller identity, so making it real would need new adapter plumbing. Plan ownership is per agent type: the guard lets a role subagent run only its own `bay plan`; the dispatch record ties the plan to its call and step. Documented in `ledger._dispatched_check` and `cli.cmd_plan`; pinned by `test_plan_ownership_is_per_agent_type_not_per_run`. Sibling builders of one type can still tick each other's plans (a known limit, not a regression).
3 (610f494) README: code fence on its own line, guard caveat and budget-caps sentence restored; three phrases trimmed to stay near 900 words.
4 (9a2fd62) `ledger.agent_groups` splits a step's submitted usage evenly among the agents dispatched to that call and step (documented in INTERFACES). Test `test_a_steps_usage_is_split_among_the_agents_dispatched_to_it_not_counted_per_agent`.
5 Evidence, last lines of each command:
- `python3 tests/run.py -q`: `445 passed, 0 failed`
- `./bay.sh lint`: `✓ lint clean` (four `!` warnings as before: schedules and the workspace env)
- `./bay.sh validate`: `✓ 6 modes, 21 endpoints, 5 roles (17 role units), 10 envs, 13 connectors resolve (agent profile claude-code)`
- `./bay.sh build --project <scratchpad>/s1fix` (empty folder): `! Per-role Bash scope is enforced by the agentbay guard hook; restart Claude Code and accept the workspace trust prompt so hooks run.`; `./bay.sh clean`: last line `clean`; a glob of the folder afterwards: `No files found`
- `python3 -m bay.cli boundary --base origin/main --proposal docs/proposals/0008-simplify-without-losing-features.md --docs`: `boundary origin/main...HEAD: 59 changed paths (21 core, 3 docs, 16 extension, 1 feature, 18 other); 0 failing; B-11 docs: 0 hits`
- `python3 -I plan_probe.py <kit> <built project>`: every `bay plan` case with a foreign taskId, extra args, `--project`, `dispatched`, `review-record` or `approve` for role subagents is `deny`; non-role subagents: `deny  None  .agentbay/bay plan T-20261030-2908 --done 1`. Last line `pass  None      ./bay.sh  plan T-20261030-2908 '{}'` (no opinion from the guard for `./bay.sh` spellings, as before; Claude Code prompts). The probe needs two arguments (kit, built project).
- `python3 -I gate_repro_sha.py <kit>`: `R1 forged line -> awaiting-approval approve | the gate runs: no recorded approval ...`, `R3 revert to superseded content -> approve`, `R4 no crash`, `R5 gaps: ["forge.create step fill: `when: stale > 1h` is for code steps ..."]`; then the probe's own R5 step raises `ResolveError` at line 66 because resolve now rejects that edit (the probe expects a runtime crash, so it ends with a traceback; the defect it probes is fixed).
- Fake-source demo: no command for it is in this task's allowed list; the fake-source flows run inside the test suite (test_dispatch, test_mail_briefing), counted in the 445 above.

# HANDOFF part 4: T-20261030-b07b (recorded with `bay plan`) - stage 1 of 0008 COMPLETE

Outcome: items 7 and 8 done. To-do (done: 1-4): 1 docs (README 895 words, INTERFACES, DESIGN, cos playbook, four role prompts; COORDINATOR.md rebuilt); 2 cleanup (dead `when: approved` branch in `Dispatcher._skip` and its schema text removed, no test existed for it; `approved` output of forge.scaffold `proposal` removed from connector and interface); 3 evidence; 4 this file.
Tests: 442 pass. lint clean, validate ok, scratch build + clean round trip leaves the folder empty, `bay boundary --docs`: 0 B-11 hits.
Open for the owner: `bay boundary --base origin/main --proposal 0008 --docs` still fails 17 paths (B-1 5, B-2 9, B-3 3) because stage 1 touched paths that 0008's `touches:` does not list (adapters/claude-code, git/gmail-api/claude-transcripts/scaffold connectors, framework/interfaces forge.scaffold + workflow.run, forge extend playbook + Result type, mail-briefing config.example, schemas event/review.verdict/session.episode). Editing the proposal changes its approved sha256, so it was not touched.

# HANDOFF part 3: T-20261030-5110 (recorded with `bay plan`)

Outcome: stage 1 of 0008 complete (all 8 items below). One commit per green item. Tests: 442 pass. Stopped at the tool-call budget after item 6.
To-do (done: 1-6; open: 7, 8):
1 done (1e6a513) `Dispatcher._agents` takes inputs from the dispatch event's data.inputs. 2 done (55e6ba3) `cites` {taskId, outcome, todo[]} in review.verdict/v1 items;
review brief has `review.recordedPlans` (taskId -> step, outcome, todo). 3 done (652b66a) `ledger.agent_groups` (moved from cli), `plans` passed to Store.backlog, "### Agent runs" section in report.py.
4 done (213a915) cause: `TranscriptSource.sessions` only scanned <root>/<folder>/*.jsonl; with root = the project folder nothing matched. Now also <root>/*.jsonl. Test in claude-transcripts tests.
5 done (0916492) commit["subject"] scrubbed, 200 chars, in session.episode/v1; git connector docs and test updated.
6 done (3bb7364) `bay review-record <taskId> '<review.verdict/v1>'` -> event `review.recorded` (ledger.REVIEW_TYPES, schemas/event.schema.json); improve's `ledger_verdicts` reads it (target "review-record");
cannot target a callId, nothing in dispatch reads it; tests/test_review_record.py (incl. subagent guard denial).
7 OPEN docs: README, docs/INTERFACES.md (event type, cites, review brief recordedPlans, commit subject, review-record, dispatched --input), docs/DESIGN.md, framework/modes/cos/playbook.md
(cos runs `bay dispatched ... --input` before every agent dispatch; chat approvals carry `--sha`; out-of-framework review -> `bay review-record`), role brief template (subagents run `bay plan` first; reviewer may cite with `cites`).
Also .agentbay/COORDINATOR.md is generated from the cos playbook/role files: edit the sources, then build. Grep `bay plan|bay dispatched|--sha` for where each already appears.
8 OPEN cleanup: dead `when: approved` branch in Dispatcher._skip and its test; unused `approved` output of the forge.scaffold proposal endpoint.

# HANDOFF part 2: T-20261030-4424 (recorded with `bay plan`)

Outcome: slice 8 finished, slice-7a findings F-1..F-7 fixed with tests, improve blind spots closed.
To-do, as recorded with `bay plan` (done: 1, 2, 6, 7, 8, 9; open: 3, 4, 5, 10, 11, 12). Tests: 436 pass.
1 done F-4/F-5/F-6. 2 done submit refused without plan (`Dispatcher._require_plan`; tests/helpers.py wraps `submit` to
record dispatch+plan, `submit_strict` is the real one; tests/test_submit_needs_plan.py). 3 open: optional outcome/todo citation in
review.verdict/v1 (VERDICT in bay/dispatch.py, `_accept_review`) and the recorded plan (ledger.plans) in the review brief (`_plan`, kind review).
4 open: improve backlog reads ledger.plans and `_agent_groups` (bay/cli.py) figures. 5 PARTIAL: forge.extend skip is done and tested
(mode.yaml `propose` has `when: "!$in.proposal"`; playbook.md updated); docs still open: README, docs/INTERFACES.md, docs/DESIGN.md,
framework/modes/cos/playbook.md (cos runs `bay dispatched` before every Agent dispatch; chat approvals carry `--sha <prefix>`), role brief
template (subagents run `bay plan` first). 6 done F-1 (`--sha`). 7 done F-2 (guard `dequote`). 8 done F-3 (`_state_holds`). 9 done F-7 (adapter ask/deny).
10 open claude-transcripts connector (0 episodes with `root` set; fixture = top-level session .jsonl + subagents/). 11 open git episode subjects (scrubbed).
12 open `bay review-record <taskId> '<verdict json>'` -> review.verdict/v1 event (event type must be added to schemas/event.schema.json and ledger.TYPES).
Note: the dead `when: approved <f>` branch in Dispatcher._skip is no longer used by forge; remove it with its test when convenient.

# HANDOFF: 0008 stage 1 (slice 8, agent run records, plus dogfood bug fixes)

Task T-20261030-c91d, call C-20261030-bc7db5, step `implement`. Stands in for `bay plan` until it exists.

## Outcome (what done looks like)

Slice 8 acceptance line of docs/proposals/0008-simplify-without-losing-features.md:

- A subagent can run `bay plan` and no other `bay` command.
- Plan events are scrubbed, size-limited, append-only and refused for another taskId.
- `step.started` carries the step's inputs.
- `bay status` lists a dispatched agent even with the spawn hook off (cos logs the dispatch).
- A role-step submit without a recorded outcome is refused.
- `bay show` prints outcome, to-do progress and inputs.
- `bay status --agents` groups runs by role, mode, model and tier from the ledger alone.
- A reviewer verdict cites outcome and to-do items.
- improve's weekly backlog reads the same figures.

Dogfood bugs, each with a test:

- (a) result block `protocol:` and the step `Result` type agree.
- (b) with `approvals.chat` on, gate plan and `bay show` name the chat path.
- (c) approval binds to proposal path and sha256 even when written by the same call's propose step.
- (d) one skip rule: ledger approval of the proposal's current content skips propose and approve; front-matter marker grants nothing.
- (e) ledger approval binding for 0008's current content, if (c) makes it derivable.

Constraints: security only stricter (except `bay plan`, which only appends its own events); guard tests only added to; no new dependencies; no compat code; commit per green item; stop near 50 tool calls with this file updated.

## To-do (status: open / done / dropped(reason) / blocked(reason))

1. done. Bug (a): align `protocol:` in the subagent result block and the `Result` type. Serves bug (a).
2. done. Bug (b): gate plan and `bay show` name the chat path when `approvals.chat` is on. Serves bug (b).
3. done. Bug (c): approval binding uses propose-step output artifacts or the call input. Serves bug (c).
4. done. Bug (d): single skip rule by ledger approval; remove front-matter reliance. Serves bug (d).
5. done. `ledger`: `agent.plan` / `agent.plan.done` events, scrubbed, size-limited, taskId-checked, fold. Serves "plan events scrubbed, size-limited, refused for another taskId".
6. done. `bay plan` CLI command, append-only; guard allows it as the only `bay` command for subagents. Serves "subagent can run bay plan and no other".
7. done. `step.started` carries inputs (value, or sha256 plus preview). Serves "step.started carries inputs".
8. done. `agent.dispatch` event via cos (`bay dispatched` or equivalent) and `bay status` lists it. Serves "status lists dispatched agent with hook off".
9. open (blocked on test churn: 48 existing role-step submits in tests lack a taskId/plan; needs its own pass). Refuse role-step submit with no recorded outcome. Serves "submit refused without outcome".
10. done. `bay show` prints outcome, to-do progress, inputs. Serves "bay show prints ...".
11. done. `bay status --agents` grouping by role, mode, model, tier. Serves "status --agents".
12. open (not started; review.verdict/v1 needs optional outcome/todo citations and the review brief needs the plan). Reviewer brief and verdict cite outcome and to-do items. Serves "reviewer verdict cites ...".
13. open (not started). improve weekly backlog reads the same figures. Serves "improve's backlog reads same figures".
14. open (bug (e) already answered: NOT derivable. The 0008 gate event of this call recorded `approves: none`, because the gate then named no file; recording a binding by hand would forge the owner's approval, so it is left to followups). Docs (README, INTERFACES, DESIGN, COORDINATOR/playbooks) and bug (e) binding. Serves R-4 and bug (e).

---

# HANDOFF - proposal 0006, step 1

Branch `feat/source-kinds` (slices 1-3, PR #10); slice 7a on `feat/extend-v2`, based on PR #10's branch. The spec is `docs/proposals/0006-component-contracts-and-content-types.md`
(approved). Step 1 is built in slices. Each slice is done by a fresh builder, ends with tests green, a
commit and a push, and updates this file. This file is removed in the last slice.

## Slices

| # | Slice | Proposal parts | Boundaries | Status |
|---|---|---|---|---|
| 1 | Quiet checks + component map + `bay boundary` (+ proposal `touches:` parsing) | A, F | B-1, B-2, B-3, B-11 | done |
| 2 | Ownership by folder: `adapters/`, `framework/interfaces/`, discovery, `bay auth <connector>`, per-extension README + `config.example.yaml`, `bay config example`, config schemas that extend, docs describe contracts only | A, D | B-4, B-11 | done |
| 3 | Versioned `reads:`/`produces:`/`needs:`/`implements:`, no extension names another, per-mode skill namespaces, C-7 vocabulary | D | B-6, B-7, B-8 | done |
| 4 | `feature.yaml` (workflow, skills, `uses:`), whole-feature override, `bay show <mode> --resolved` | E | B-3, B-8 | todo |
| 5 | Per-feature `uses:` enforced in the use shim (security) | E | B-9 | todo |
| 6 | Contract tests: connector, source (incl. change-feed), mode; run against every instance | A | B-5 | todo |
| 7a | Approvals from chat (Part G, behind `approvals.chat`); forge.extend skips `propose` for a proposal marked approved, the gate only for a recorded approval of its exact content; the kit ignores its own build output | G, C | - | done |
| 7b | The new forge.extend: propose, approve, `foreach:` implement, code `check`, review, release; observable DoD/rules; generated briefs; `HANDOFF.md` protocol | C, F | all existing | todo (plan below) |
| 7c | Shared forge protocol for create/connect; improve `boundary-crossing` detector | C, F | B-1..B-3 | todo (plan below) |

PRs: slices 1-3, 4-5 and 6-7 each make one PR, with an independent review per PR.

## Done
Slice 1 (7970db8, a1493ce, a2e8fa8, 048577a):
- `tests/run.py -q`: only failures (with tracebacks) and the summary line.
- `framework/components.yaml` (kernel, briefing; paths as today) + `schemas/components.schema.json`; `bay lint`
  validates it and checks every `owns:` glob matches a real path (`lint.lint_components`).
- `bay/proposal.py`: front-matter `touches:` parser. 0006 now starts with front matter listing step 1's
  crossings (slice 1 entries, and slices 2-7 marked `planned: true`).
- `bay boundary --base <ref> [--head <ref>] [--proposal <file>] [--docs] [--json]` (`bay/boundary.py`).
- `tests/test_boundary.py` (11 tests, tmp git repos).

Acceptance, PR #9 range with no proposal (`bay boundary --base b8e7512 --head 07aae9e`), exit 1:
```
README.md: core docs - core docs change only when the proposal lists them
agentbay.config.example.yaml, bay/cli.py, bay/connect.py, bay/dispatch.py, bay/lint.py,
schemas/connector.schema.json, schemas/data/email.v1.schema.json: kernel - core path (B-1)
bay/selector.py, bay/sqlsandbox.py, framework/connectors/corpus-store/{corpus_store.py,tests/test_corpus_store.py},
interfaces/items.source.v1.yaml, interfaces/items.store.v1.yaml, modes/briefing/features/sync/playbook.md: briefing - core path (B-1)
connectors/fake/{connector.yaml,fake.py}: connector fake - existing connector folder (B-2)
docs/DESIGN.md, docs/INTERFACES.md: core docs
boundary b8e7512...07aae9e: 47 changed paths (14 core, 3 docs, 22 extension, 8 other); 19 failing (B-1: 14, B-2: 2, docs: 3)
```
(new folders `modes/mail-briefing/`, `connectors/gmail-api/`, `connectors/fake-mail/`, `envs/local-mail*.yaml` pass.)
This branch against 0006: `bay boundary --base 07aae9e --proposal docs/proposals/0006-...md` → 0 failing.

Slice 2, items 1-4 (e769955, 902b7bf, 7419371, 3ae26b7, 463e662):
1. Adapters: `adapters/claude-code/` (`claude_code.py` + `adapter.yaml`: name, module, class). Protocol,
   `BuildReport` and discovery in `bay/adapter.py` (`discover`, `module`, `get`); REGISTRY dict gone;
   `bay/adapters/` removed. Map's adapter contract: `at: ["adapters/<name>/"], protocol: bay/adapter.py`.
2. `items.source.v1.yaml`, `items.store.v1.yaml` moved to `framework/interfaces/` (briefing owns
   `framework/interfaces/items.*`); `interfaces/` is now empty (user interfaces only). `workflow.run` was
   already there.
3. `bay auth <connector> [--env E]`: runs the connector's declared `spec.login` (a function in its entry;
   schema field added). Kernel passes `cli.LoginContext`: `secret`/`store_secret` limited to the connector's
   `needs.secrets` (read values are `vault.remember`ed), `http` limited to its `needs.network` that the env
   allows, `open_browser`, `say`. Env = `--env` or the one env that binds the connector. TTY only, as before.
   Gmail flow is `connectors/gmail-api/gmail_api.py cli_login`. Hints now say `bay auth gmail-api`;
   mail-briefing's playbooks say "the `bay auth <connector>` command the reason names".
4. Config schemas extend: `Doc.config_files` (schema chain along `extends`, root first),
   `model.config_schema(kit, md, gaps)` merges them; redefining an inherited key is a gap and a
   `bay lint` error (`lint.lint_config_schemas`). mail-briefing's `config.schema.json` holds only `important`.
   improve's graph reads config keys from the chain.
Tests added: tests/test_auth.py (4), test_adapter discovery, gmail cli_login, two in test_inheritance.

Slice 2, item 0 and item 5, and item 6 README part (5b15c98, 4a595a0, fca12db, 4127fdb):
0. `adapters` is in `model.PROTECTED` again (owner decision); the claude-code adapter uses `model.PROTECTED`
   (its own copy is gone). Pinned list in tests/test_boundaries.py is `["framework", "bay", "schemas",
   "adapters"]`; new test `test_adapter_code_is_protected_when_the_project_is_the_kit`. framework-dev's
   `fs.write` gains `adapters` (it could write `bay/adapters/` before the move; without it forge.extend could
   not edit adapter code at all).
5. Every settings-taker has `config.example.yaml` (its settings body, no `<name>:` key): feed-briefing,
   mail-briefing, x-api, gmail-api, fake, fake-mail, framework improve and claude-transcripts. READMEs for
   modes briefing, feed-briefing, mail-briefing, delivery; connectors x-api, gmail-api (Gmail setup moved here),
   fake, fake-mail; framework improve, claude-transcripts. `bay/config.py`: `KERNEL_HEADER`,
   `KERNEL_WORKFLOWS`, `OFFLINE_SWITCH`, `takes_settings`, `fragment`, `example(kit)`. `bay config example
   [--stdout]` writes/prints agentbay.config.example.yaml (user extensions first, then framework, by name; envs
   offline switch from `substitutes:`). `lint.lint_self_description`: user modes/connectors need README.md;
   settings-takers need a config.example.yaml their schema accepts (`features` ignored); the example file must
   equal `config.example(kit)` ("agentbay.config.example.yaml is stale; run bay config example").
   Scaffolds write README.md (templates `framework/modes/forge/templates/{mode,connector}/README.md`).
   tests/test_config_example.py (4); helper `helpers.self_describe` for hand-written test modes.
6. (README part) README.md rewritten to contracts only (911 words): instance names only inside fenced
   examples; Settings section; `bay auth <connector>`, `bay config example`, `bay boundary` in the table;
   framework-mode commands (`bay improve ...`) are listed in that mode's README. B-11 now skips instances
   under a core `owns:` path (briefing base mode, corpus-store): they are core, not extensions.

Slice 2, item 6 (rest) and item 7 (9bd9f51, d7e728c):
6. DESIGN.md (1603 words) and INTERFACES.md describe contracts only. Instance text moved to READMEs:
   framework/modes/cos/ and forge/ (new), improve (detectors, interface/connector table, cron);
   framework/connectors/{workflow-runner,ledger,git,artifact-graph,improve-detect,improve-store}/README.md (new);
   connectors/gmail-api/README.md "How it reads" (the DESIGN mail paragraph). Word collisions reworded
   ("run log", "version control", `bay/model.py` `USER_FRAMEWORK_ENVS` for the shareable framework envs,
   `<env>: <offline env>`). B-11 now counts: the `DOCS_COUNTS` switch is removed (always on, no dead
   toggle); hit lines say the fix. `--docs` 0 hits. README.md trimmed to 858 words, setup steps kept.
7. B-4: `lint.lint_ownership` runs `git ls-files` in the kit (skipped when not a checkout) and fails every
   tracked file that is not core docs, other, under a core `owns:` or in an extension `at:` folder
   (`boundary.stray`), naming the file and the fix. The shipped kit has no stray file. Test:
   `test_ownership_lint_names_stray_tracked_files_b4`.

Slice 3, B-6, B-7 and C-7 (commits on feat/source-kinds after 313120a; see `git log`):
- B-6: modes declare `reads: [<kind>/v<N>]`, items.source connectors `produces: [<kind>/v<N>]` (schema fields
  added). `lint.lint_contract_versions` refuses an unversioned `needs:`/`implements:`/`reads:`/`produces:`, an
  unknown kind, an items.source connector without `produces:`, a non-abstract mode needing items.source/v1
  without `reads:`, a version mismatch, and a read no bound connector produces (message names forge.connect).
  Envs checked: every env the mode's `roles:` map (mode-wide and per endpoint) plus every env that
  `substitutes:` one of them. Known kinds = `schemas/data/*.schema.json` whose `allOf` refs item/v1
  (`model.item_kinds`; today post/v1, email/v1). Filled in: feed-briefing reads post/v1, mail-briefing
  email/v1; x-api, fake produce post/v1; gmail-api, fake-mail email/v1. briefing declares none. The connector
  scaffold writes a `produces:` TODO line.
- B-7: `lint.lint_extension_names`: mode files (mode.yaml, playbook.md, config.example.yaml,
  config.schema.json, features/, skills/, types/) never name a connector or another mode (extends ancestors
  excepted); connector .py/.yaml never name a mode or another connector; connector code imports no other
  connector's entry module. Word-bounded like B-11. Fixed hits: mail-briefing config example `in: Work`
  (Gmail notation table now only in connectors/gmail-api/README.md "Selectors in Gmail notation"),
  mail-briefing description "your email", mail-sql skill id example `<source>:...`, fake-mail description
  no longer names gmail-api, forge create playbook "stubbed HTTP layer".
- C-7: "content type" and "item" in the fixed vocabulary; C-4 and C-8 statements name B-7.
- `SLICES_BUILT = 3`; touches: conformance.yaml `planned` off, forge create playbook added.
- tests/test_contract_versions.py (4 tests); briefing-child fixtures in test_inheritance/test_roles now
  declare `reads: [post/v1]` (required by B-6).

Slice 3, B-8 (bc7634a):
- Build writes a mode's skills (own and inherited) to `.claude/skills/<mode>--<skill>/` and a role's own skills
  to `<role>--<skill>/`; the copied SKILL.md `name:` is rewritten to the folder name (`_rename_skill`). A child's
  same-named skill overrides its parent's for that child only (`model.mode_skills`, nearest first).
- `model.skill_id`, `model.role_skill_names`, `SKILL_NAME_MAX = 64`. `ResolvedMode.skills` and
  `ResolvedRole.skills` are keyed by the namespaced name; `ResolvedRole.skill_names` maps short -> namespaced
  (a role's own skill replaces the mode's same-named one for that role).
- References: subagent "## Skills" lists `` `<mode>--<skill>` (<short>) ``; step plans carry
  `skills: {short: namespaced}`; COORDINATOR.md gets a "Skills (generated)" table (skill, from, playbooks call
  it). catalog.json / `bay show` list namespaced names. Playbooks and prompts keep short names.
- mail-briefing's skills renamed back to `corpus-sql` and `digest` (they override briefing's again).
- `lint.lint_skill_names` rewritten for B-8: short name must be `[a-z0-9]+(-[a-z0-9]+)*`; namespaced name at most
  64 (message names the overshoot and the fix); no two sources build the same name; every skill a mode's
  playbooks (mode playbook + each endpoint's resolved playbook) name ("the X skill", "(X skill)") is in the
  mode chain or the skills of a role the mode maps; a role prompt's reference is the role's own or in every
  mode that maps it. `bay clean` removes the folders (manifest), build is idempotent.
- Tests: test_adapter round trip (no clobbering, override child-only, name: rewritten, idempotent rebuild,
  clean removes `.claude/skills/`), test_dispatch plan `skills`, test_lint `*_b8` (3), test_inheritance.
- Touches: `modes/*/skills/` `planned` off; bay/dispatch.py's slice-5 planned entry merged into a slice-3 one.

Slice 7a (32b4eab, 838fbb9, 8dcb8ff, 74cdeb9, 515dbfb; correction de3d779):
- 0006 Part G "Approvals from chat" (owner decision 2026-10-29); 0006 front matter `status: approved`,
  `approvedBy: user`, `date: 2026-10-29`; Part C notes the approved-proposal skip; slice-7a `touches:`.
- `bay approve <id> --via chat --quote "<msg>"` (bay/cli.py `_approval_channel`): refused unless
  `approvals: { chat: true }` (schemas/config.schema.json, `config.chat_approvals`, exactly `true`); the quote is
  mandatory; `--quote` without `--via chat` is refused; the terminal path is unchanged (TTY + "yes").
- Ledger: call gates (`Dispatcher.approve(..., quote=)`) and workflow gates (new `Dispatcher.approve_run`, which
  also writes a `step.completed` event, none existed before) record `data: {approved, by, quote}`;
  `by` is `user@chat-via-cos` or `user@tty`. workflow.run/v1.approve takes `quote`.
- Guard (bay/guard.py): every subagent (agentbay role or not) is denied `bay approve` in any spelling
  (`runs_approve`: bay, bay.sh, .agentbay/bay, bay/cli.py, `-m bay.cli`; parsed words, raw text when the command
  does not parse) and any Bash command naming `agentbay.config.yaml` or a root-level glob matching it
  (`names_config`). File-tool writes to it were already denied (NEVER_FILES). (74cdeb9 also denied a subagent
  write that turned a proposal to `status: approved`; de3d779 removed it, see Decisions.)
- forge.extend: first step `proposal` (code, `forge.scaffold/v1.proposal`, `when: $in.proposal`) reads the
  front matter; `propose` carries `when: "!$steps.proposal.approved"` (approved = status approved +
  approvedBy + date). `approve` carries `approves: $in.proposal` and no `when:` (de3d779): the dispatcher hashes
  the file itself, `bay approve` records `data.approves: {path, sha256}`, and the gate is skipped only when the
  ledger's latest dispatcher decision by `user@tty`/`user@chat-via-cos` on that path and hash is an approval
  (`Dispatcher._gate_check`). An edit while the gate waits makes `bay approve` refuse and re-plan. The plan's
  `why`/`approves` and `bay show`'s `gates` say why the gate ran or was skipped; `bay approve` prints path + sha256.
  Lint: a gate takes no `when:`; `approves:` only on a gate. The path must match `docs/proposals/<name>.md` (interface pattern; the connector also
  resolves it under docs/proposals/).
- `when:` grammar: `[!]$in.<f>`, `[!]$steps.<id>.<f>`, `stale > <age>`; role steps now take `when:`; resolve
  fails when `$steps.<id>` is not an earlier step.
- `.gitignore`: `/.claude/`, `/CLAUDE.md`.
- Docs: cos playbook "Gates from chat"; extend playbook; README, DESIGN, INTERFACES; generated CLAUDE.md.
- Tests: test_boundaries `*chat*` (4), `test_guard_denies_bay_approve_*`, `test_no_subagent_writes_agentbay_config_yaml`,
  `test_no_subagent_writes_the_ledger`, `test_chat_approval_of_a_proposal_*`; test_dispatch
  `test_extend_marker_skips_propose_but_never_the_gate`, `test_a_recorded_approval_*`, `test_an_edit_after_*`,
  `test_only_bay_approve_events_*`, `test_a_gate_takes_no_when_*`, `test_when_names_only_an_earlier_step`; test_adapter `test_building_the_kit_into_itself_*`.
  test_boundary `SLICES_BUILT` is now the set {1, 2, 3, 7}.

### Review round 1 (PR #10, independent review)
Fixed (one commit each, pushed):
- F-2 `bay auth`: LoginContext reads and stores through vault.SecretAccessor (env `secrets.allow` x connector
  `needs.secrets`), `--env` must bind the connector, lint refuses a `login:` whose needs.secrets no binding env
  allows; docstring says it limits the API, not the in-process entry. Test: the reviewer's evil connector.
- F-3 test_roles creates `interfaces/` in the kit copy; stray empty `interfaces/` removed.
- F-1 `bay boundary` diffs with `--name-status --no-renames --no-relative -z` (deletions and both sides of a move;
  independent of git config). 0006 already listed `interfaces/items.*` and `framework/interfaces/`.
- F-4 new-extension detection is casefolded against `git ls-tree` at base; lint rejects case-colliding tracked
  paths and mode/connector/adapter folders without their manifest.
- F-5 B-11 fences follow CommonMark (opening char and length); names match with re.I.
- F-6 B-7: re.I, module form, `agentbay_connector_*`/`agentbay_adapter_*` keys, only top-level `tests/` exempt,
  manifest-referenced files (entry, mode config) scanned unless core; INTERFACES states the scan is incomplete.
- F-7 B-6 flags a bound connector producing a read kind at another version (mixed versions).
- F-8 skill references: re.I and "the skill X" (prose words after "the skill" skipped unless backticked).
- F-9 docs: `adapters/` in the protected lists; skill namespaces and SKILL.md `name:` rewrite; connector `login:`
  and the `bay auth` contract (INTERFACES section 4).
- F-10 `bay boundary` ignores `planned: true`; bay/improve/graph.py listed (slice 2), schemas/ and connectors/*/
  narrowed to this PR's files; later-slice globs stay planned.
- F-11 lint fails when two envs declare `substitutes:` of the same env, naming both (`lint.lint_substitutes`).
- F-12 `schemas/adapter.schema.json` (named in the component map; touches entry added to 0006); lint checks the
  schema, `name` = folder and `module` a file inside the folder (`lint.lint_adapters`, imports nothing).
  `adapter.discover()` leaves bad entries out and reports them (build/clean print them as warnings), so a broken
  runtime cannot stop another; only the selected runtime's code is imported. sys.modules key = folder with every
  non-alphanumeric character escaped (`adapter.module_key`): claude-code and claude_code differ.
- F-13 a child config schema's `$defs` colliding with the parent's, or any top-level keyword outside
  `model.CHILD_CONFIG_KEYS`, is a resolve gap and a lint error naming it.
- F-14 `bay boundary` reads framework/components.yaml at `--base` and the proposal's touches at `--head` (git
  show); an uncommitted proposal is an error. `.github/` dropped from OTHER (unowned: fails unless listed).
- F-15 `model.skill_front_matter` (yaml, CRLF normalised); lint reports an unclosed/non-YAML/non-mapping SKILL.md
  front matter; `_rename_skill` writes `name` first, keeps other keys, and on a bad block removes the copy and
  stops the build.
All round-1 findings (F-1 to F-15) fixed.

### Review round 2 (PR #10, confirmation review)
- N-1 `bay boundary` uses head's component map only when the diff adds it (status A in base...head); then no
  new-extension pass: every changed path outside other must be in touches:. A base without a map that the change
  does not add is an error. The reviewer's backdoor (a map making `bay/<name>` an adapter folder) fails. This PR
  still passes: all 93 paths are listed.
- N-2 the map and the "is this extension new" tree are read at `git merge-base base head` (what base...head diffs
  against); the stale-fork scenario (main deletes a mode after the fork, the PR edits it) fails B-3.
- N-3 `ComponentMap.parse` raises RuntimeError on bad YAML, a non-mapping document or a non-mapping
  `components:`; the CLI prints one line.
- N-4 a skill reference ("the X skill", "the skill X", "(X skill)") counts only when X is backticked or is a skill
  the kit builds (any mode chain or role); "the right skill", "the same skill" are prose.
- N-5 a child config schema may set top-level `type`/`additionalProperties` only to the parent's value; anything
  else is a resolve gap and a lint error naming the keyword.
All round-2 findings (N-1 to N-5) fixed.

## Decisions
- Classification order: other (tests/, HANDOFF.md, docs/proposals/, docs/research/, repo meta, the
  proposal) → core docs → core `owns:` (most specific glob wins, so bay/selector.py is briefing) →
  extension `at:` → unowned (fails unless listed). Core wins over a contract's `at:` (corpus-store,
  modes/briefing/, bay/adapters/ are core today).
- Extension `at:` is a list, so framework instances (framework/modes/, framework/connectors/,
  framework/envs/) are extensions of the same contracts. `framework/interfaces/` is kernel-owned (core
  interfaces); `interfaces/<name>.yaml` is the extension interface contract.
- Kernel also owns coordinator/, bay.sh, requirements.txt,
  framework/components.yaml.
- B-3: a feature path of an existing mode passes only if a `touches:` glob matches it AND the glob's
  literal prefix reaches `<mode>/features/` (so `modes/x/` covers mode-wide files but not features;
  `modes/x/features/*/` covers all features explicitly).
- Globs: `*`/`?` within a segment, `**` across, trailing `/` = folder and everything under it.
- `touches:` entries may carry `slice:` and `planned:`; both informational, every entry counts.
- Diff is of commits only (`git diff base...head`): commit before running the check.
- B-11 (`--docs`) scans the core docs at `--head` for discovered mode, connector, env and content-type
  names (word-bounded; `git.read` is not `git`), skipping ``` and ~~~ fenced blocks. Framework instances
  count (they are extensions), so words like improve, ledger, git, forge, cos hit.
- Contract `schema:`/`tests:` paths are named in the map but not checked for existence yet
  (content-type schema and tests/contracts/ arrive in later slices); lint checks only shape and `owns:`.

- (slice 2) Tests that imported `bay.adapters` now import `bay.adapter`; `COORDINATOR_CMDS` comes from
  `module("claude-code")`. Test bodies, including the guard/security tests, are unchanged.
- (slice 2) `model.PROTECTED` stays `("framework", "bay", "schemas")` (security tests pin it), so the adapter
  code at `adapters/` is no longer inside a protected kit dir when the project is the kit (like `connectors/`
  and `modes/` already). See Open problems.
- (slice 2) `bay auth` takes the connector name (`gmail-api`), not the source id; no alias for `gmail`.
- (slice 2) Touches added to 0006 for crossings the build needed: `bay/adapter.py`, `modes/*/README.md`,
  `modes/*/config.example.yaml`, `modes/mail-briefing/` and `modes/mail-briefing/features/*/playbook.md`.
  `tests/test_boundary.py` `SLICES_BUILT = 2`: entries of later slices must stay `planned`.
- (slice 2) Envs are single files (`envs/<name>.yaml`), not folders, so "per-env README" has no place; the
  offline switch in the generated example should be derived from envs' `substitutes:` (planned, item 5).

- (slice 2) The config example is keyed by installable mode: an abstract mode (briefing) has a README but no
  config.example.yaml; each child ships its own (feed-briefing does, though its schema is briefing's).
- (slice 2) agentbay.config.example.yaml is generated, so `bay boundary` classifies it as other (not kernel):
  adding a settings-taking extension regenerates it and must stay `touches: []` (DOD-4). Lint guarantees it
  holds no hand edits. Removed from kernel `owns:` in framework/components.yaml.
- (slice 2) README.md is required for user modes/connectors only; framework instances get one when touched
  (improve, claude-transcripts so far). Envs are files, so no README.
- (slice 2) Touches added: framework/envs/framework-dev.yaml, framework/modes/improve/,
  framework/connectors/claude-transcripts/, framework/modes/forge/templates/, bay/scaffold.py (now slice 2;
  its slice-3 planned entry merged into it). `planned` flipped off: bay/config.py,
  agentbay.config.example.yaml, README.md.

- (slice 2) B-4 checks tracked files only (an untracked scratch file is not the kit's). It reuses the boundary
  classification, so a file is "owned" exactly when `bay boundary` would classify it.
- (slice 2) Touches added: `framework/modes/*/README.md`, `framework/connectors/*/README.md`. Removed, as slice 2
  did not need them: bay/registry.py (the catalog already lists discovered extensions), `envs/*.yaml` (bindings
  name interfaces, not paths), framework/connectors/corpus-store/. `planned` off: docs/DESIGN.md,
  docs/INTERFACES.md, `modes/*/mode.yaml`.
- (slice 2) B-11 is word-bounded on dotted names, so `forge.extend`, `cos.run` in the docs do not hit; the docs
  still avoid instance endpoints where a contract sentence does the job.

- (slice 3) `reads:`/`produces:` cover item kinds only; framework modes and connectors read/produce no item
  kind and declare none. Presence is required only around items.source/v1.
- (slice 3) B-7 exemptions: README.md (documents the extension's own setup and may name what its env binds) and
  `tests/` inside an extension folder (fixtures pick concrete stand-ins, e.g. the fake connector). Core
  instances (under a core `owns:` path: briefing base mode, corpus-store) are not extensions and are not
  scanned. Framework instances may name each other (they ship and change together, only via forge.extend) but
  never a user extension. A mode may name every `extends:` ancestor, not only its direct parent.
- (slice 3) The kernel's selector matcher still accepts `label:`/`in:` spelling (tests use it); only the mode's
  own files moved to the neutral vocabulary.
- (slice 3) Claude Code skill names (folder under .claude/skills/ and SKILL.md `name:`) allow lowercase
  letters, digits and hyphens only (max 64); Claude Code adds `plugin:` itself for plugins. So B-8 must write
  `<mode>--<skill>` (same separator as role units `<role>--<mode>`), not `<mode>:<skill>`.

- (slice 3, B-8) Separator `--`, not `:` (see above). Note the open Agent Skills spec (agentskills.io) also
  forbids consecutive hyphens; Claude Code's own docs only state the character set and 64. Owner chose `--`.
- (slice 3, B-8) Role skills get the role's namespace (`researcher--research-brief`), not the mode's: written
  under the mode's they would clash with a same-named mode skill for the mode's other roles. A mode named like a
  role could still clash on a name; lint catches it ("also built from").
- (slice 3, B-8) mail-briefing skills: back to `corpus-sql`/`digest` rather than keep `mail-sql`/`mail-digest`
  (the task said `sql`/`digest`, but the pre-workaround names were `corpus-sql`/`digest`). Same churn either way
  (2 renames, 2 playbook words), but keeping the mail- names would leave mail-briefing's analyst with briefing's
  post-oriented `corpus-sql` and `digest` inherited next to its own; overriding is what B-8 is for.
- (slice 3, B-8) Abstract modes are not built, so their skills get no folder of their own; their playbooks are
  still lint-checked against their own chain.
- (slice 3, B-8) The proposal text (D.1, row B-8) still says `<mode>:<skill>`; left as approved, code follows
  the Decision above.

- (review 1) B-7 skips a manifest-referenced file that lies under a core `owns:` path (feed-briefing's config is
  briefing's schema); core is not scanned. Content types get no manifest check yet (manifest name not fixed).
- (review 1, F-14; narrowed in review 2, N-1/N-2) Bootstrap: origin/main has no framework/components.yaml (this
  PR introduces it). The boundary reads the map at the merge-base; only when the diff adds the map (status A) it
  uses the map at `--head`, gives no new-extension pass (every path outside other must be listed) and says so.
  Any other base without a map is an error. Once merged, every later change is judged by the merge-base map.
- (review 1, F-12) The adapter manifest schema lives in schemas/ like the other contracts' (components.yaml
  `adapter` now has `schema:`), rather than inline in bay/adapter.py.
- (review 2, N-5, replaces F-13's note) A child's `type`/`additionalProperties` must equal the parent's value.
- (review 1) Login secrets: the old "does not declare" check stays first (security test pins its message), then
  the SecretAccessor intersection applies.
- (7a) Chat approvals skip the "Type yes" prompt: the quoted message is the confirmation, and Claude Code's
  permission prompt for the command (never pre-approved) is the second check.
- (7a, corrected by de3d779; owner policy: a gate passes only by a recorded approval) The front-matter marker
  skips `propose` only. The `approve` gate is skipped only for a ledger approval by `bay approve` (terminal or
  chat) of this proposal path at the sha256 of its current content; any edit re-runs the gate. The latest
  decision on that exact content wins (a rejection after an approval re-runs it). The 74cdeb9 guard rule that
  denied writing `status: approved` is removed: the marker grants nothing, and no other reason to keep it was
  found (it never covered the main thread or Bash, which was the hole). The ledger is the trust root: subagents
  cannot write `.agentbay/` (guard, tested for `.agentbay/ledger/`); a main-thread Bash write to the ledger is the
  same trust as the main thread typing `bay approve --via chat` (Open problems). Gates take no `when:` at all.
  The hash is computed by the dispatcher from the project file, never taken from connector output.
- (7a) The approval lookup is a forge.scaffold/v1 endpoint (code step, dispatcherOnly interface, forge already
  needs it) plus a generic `when:` negation, rather than a forge-specific dispatcher rule.
- (7a) `names_config` denies even reads of agentbay.config.yaml by Bash (subagents can use Read); a glob counts
  only in the project root, so `ls framework/*.yaml` passes.
- (7a) local-authoring's `fs.write` still lists agentbay.config.yaml; the guard's NEVER_FILES wins for every
  subagent, so it is dead. Left as is (removing it is 7b/7c cleanup with the forge.create protocol).

## Next
- PR #10 ready to merge; then slice 4 (or 7b, if the owner keeps 7 ahead of 4-6).

### Plan: slice 7b, the new forge.extend (Part C), not built
1. Workflow (framework/modes/forge/mode.yaml `extend`):
   `proposal` (code, as 7a) → `propose` (builder; writes problem, change, `touches:`, `slices:`; skipped when
   approved) → `approve` (gate, `approves: $in.proposal`; skipped only for a recorded approval of the unchanged proposal) → `implement` (builder, `foreach: $steps.propose.slices`)
   → `check` (code) → `review` (reviewer, deep, high) → `release` (builder).
   - Slices come from the proposal: for an approved proposal, `forge.scaffold/v1.proposal` also returns its
     `slices:` front matter, so `foreach:` reads `$steps.proposal.slices` there; `propose`'s Result carries them
     otherwise (one `$a|$b` fallback).
2. Dispatcher `foreach:` (bay/dispatch.py, bay/model.py, schemas/mode.schema.json): a role step runs once per
   entry of a list from an earlier step; state keeps `{index, outputs[]}`; each run is a fresh plan (new
   taskId, no shared conversation) whose envelope names the slice and `HANDOFF.md`; the step completes when
   every entry has; `bay show` reports `slice i/n`; lint: the list ref names an earlier step.
3. `check` code step (new dispatcherOnly capability, e.g. forge.check/v1.run, bound in framework-dev's code
   env): runs, quiet, `bay boundary --base <merge-base> --proposal <p> --docs` (B-1, B-2, B-3, B-11),
   `bay lint` (B-4, B-6, B-7, B-8), `bay validate`, `tests/run.py -q`, build + clean in a scratch project.
   Output per check `{id, ok, summary}`; B-5, B-9, B-10, B-12 listed as `pending` (slices 5, 6; no compat
   detector yet) and never reported as pass. A failing check blocks review (`partial`).
4. DoD and rules (features/extend/playbook.md, rules.yaml): DOD-1..DOD-9 and R-1..R-5 exactly as Part C;
   remove the quality-word DoD and "compatibility impact" from the propose task; DOD-1/DOD-3 cite the
   `check` output.
5. Generated builder briefs: the implement plan's envelope is built from the playbook, the DoD, the
   proposal's slice section and `HANDOFF.md` (framework/roles/ or bay/playbook.py); a test renders one for a
   sample proposal (Part "Steps" acceptance: dry run of `bay call forge.extend` gives per-slice plans + brief).
6. `HANDOFF.md` protocol: implement checks the file exists after each slice (done, decisions, next, test status,
   open problems) and writes one ledger note per slice; the last slice removes it.
7. Touches: framework/modes/forge/mode.yaml, features/extend/, bay/dispatch.py, bay/model.py,
   schemas/mode.schema.json, framework/interfaces/ (check capability), framework/connectors/ (its connector),
   framework/envs/framework-dev.yaml, framework/roles/; flip their `planned`.

### Plan: slice 7c, not built
1. Shared forge protocol: the slice-and-handoff protocol and quiet checks move into
   framework/modes/forge/playbook.md; forge.create (and forge.connect once it exists) run the same `check`
   step after `fill`; create's DoD names the boundary checks.
2. improve `boundary-crossing` detector (bay/improve/, framework/modes/improve/features/audit/): runs B-1..B-3
   over git history (each merge commit against its first parent, with the proposal it names), reports a
   crossing no `touches:` covered; fixtures with a seeded crossing; never runs code from history.
3. Touches: bay/improve/, framework/modes/improve/features/audit/, framework/modes/forge/playbook.md,
   framework/modes/forge/features/create/.

## Test status
`python3 tests/run.py -q`: 416 passed, 0 failed on a clean detached checkout of de3d779 (~4 min; use a long
timeout). `bay lint` clean, `bay validate` ok. `bay boundary --base origin/main --proposal docs/proposals/0006-...md
--docs`: 103 changed paths, 0 failing, 0 B-11 hits.

## Open problems
- (7a) The chat path trusts the main thread to relay the owner's words (Part G threat note). A main-thread
  prompt injection could still type `bay approve --via chat`; Claude Code's prompt for the command is the only
  stop then. That is the documented trade-off, off by default.
- (7a) The main thread (not a subagent) can append to `.agentbay/ledger/events.jsonl` by Bash, so it could forge
  a `bay approve` event; that is no more than it can already do by running `bay approve --via chat`. Hashing or
  signing ledger events is out of scope (the ledger is append-only JSON).
- DESIGN.md is 1603 words (target ~1.5k); further trimming would cut contract text (safety, store invariants).
- The `boundary-crossing` improve detector (B-1..B-3 over history) is slice 7.
- B-8 skill-reference lint matches two prose phrasings only; a feature.yaml `skills:` list (slice 4) should
  replace the regex as the declared reference.
- Proposal 0006 D.1 / row B-8 say `<mode>:<skill>`; the owner may want the text amended to `<mode>--<skill>`.
