---
# Approval is recorded in the ledger by `bay approve`; this file grants nothing. Design only: nothing is changed before the gate. Scope approved by the owner on 2026-11-02 ("All recommended"): the eight items of the call, nothing more. The design behind it was written against 1.1.2; every line cited here was checked against 2.0.0.
id: "0016"
status: draft
touches:
  - { path: bay/model.py, reason: "STORE_IFACE is items.store/v2; the one-level check replaces the cycle check in _apply_extends; merge_mode lets a child's feature inherit playbook and rules; check_connector skips an unbound `needs.optional` capability" }
  - { path: bay/lint.py, reason: "`local` is a reserved source name; the three messages that spell items.store/v1" }
  - { path: bay/connect.py, reason: "instantiate loads the connectors of `needs.optional` capabilities that the env binds" }
  - { path: bay/dispatch.py, reason: "_settings carries sourceKinds, the item kinds that any items.source connector produces, for the kind guard" }
  - { path: bay/contenttypes.py, reason: "views.yaml names its row views under `rows:` (one block per name) instead of the single `threads:` block" }
  - { path: bay/limits.py, reason: "kit_python_lines and tests count bay-side kit code only for adapters/ and the protected components" }
  - { path: bay/sqlsandbox.py, reason: "two error messages name items.store/v2" }
  - { path: bay/templates/, reason: "the example in the TODO comments of the feature and mode templates names items.store/v2" }
  - { path: bay/workflows.py, reason: "the docstring example called briefing.digest, a mode that no longer exists" }
  - { path: schemas/connector.schema.json, reason: "`needs.optional`: capabilities the connector uses when the env binds them" }
  - { path: schemas/mode.schema.json, reason: "two example endpoint names in descriptions say items.store/v2" }
  - { path: framework/kernel.yaml, reason: "components/store is protected and core-owned (B-11 would otherwise find the word `store` 16 times in the core docs); `store` is a reserved mode name; two protected paths of components/briefing collapse into one" }
  - { path: framework/limits.yaml, reason: "release step: the ceilings are written down to the counts of the new scope" }
  - { path: adapters/claude-code/tests/, reason: "the adapter test names briefing's skills, extends value and paths" }
  - { path: components/store/, reason: "new abstract base mode: receives the corpus-store connector, both interfaces (items.store becomes v2), data/selector, the corpus-sql and grounded-qa skills, the shared types, the ask feature and the offline golden from components/briefing" }
  - { path: components/briefing/, reason: "removed: everything in it moves to components/store, components/feed-briefing or components/mail-briefing (see What moves where)" }
  - { path: components/mail-briefing/, reason: "extends store; declares sync, prune, digest and ask; own config schema, prune playbook and rules; ask playbook and rules go (0012 item 2); `threads` becomes `rows` in mode.yaml, views.yaml, playbook, skills and README" }
  - { path: components/feed-briefing/, reason: "extends store; declares sync, prune, digest and ask; receives local-feeds, the digest and prune playbooks and rules, the digest skill, the Digest type, a config schema and the coordinator playbook" }
  - { path: components/forge/envs/framework-dev.yaml, reason: "its write list repeats kernel.yaml's two components/briefing paths" }
  - { path: components/forge/tests/, reason: "the env fixture moves from components/briefing/envs to components/feed-briefing/envs; items.store/v2" }
  - { path: components/gmail-api/README.md, reason: "the link to the briefing README points to the store README" }
  - { path: components/gmail-api/tests/, reason: "mode dirs, items.store/v2, `rows`" }
  - { path: components/improve/connectors/improve-detect/tests/, reason: "fixtures edit components/briefing paths and list briefing.* endpoints" }
  - { path: tests/, reason: "existing tests rewritten for store, v2, rows, one level; two tests added, two merged away; the guard-matrix golden is not edited (a named rename in the test)" }
  - { path: README.md, reason: "the data-flow example says `extends store`" }
  - { path: docs/DESIGN.md, reason: "one-level inheritance, the store base, local items, delete, the limits scope; paid for by cuts (see Cost)" }
  - { path: docs/INTERFACES.md, reason: "inheritance, section 11, the recipe, `needs.optional`; paid for by cuts (see Cost)" }
  - { path: bay/__init__.py, reason: "release step: version 3.0.0" }
  - { path: CHANGELOG.md, reason: "release step: entry, with an Upgrading section" }
exceptions:
  - { measure: bay_lines, to: 9695, reason: "9670 is the ceiling and the count. The item-by-item estimate in Cost is +20 gross in bay/ (limits scope +6, rows in contenttypes +8, playbook fallback +3, needs.optional +2, source kinds +3, reserved source name +2, one-level check -1 because it replaces the cycle check). Every payer that can be named from today's code is already counted. 9695 is an upper bound with a margin of 5; if it must shrink, the first to go is the multi-block `rows:` (a single block saves about 6). The release lowers the ceiling to the real count." }
---

# 0016: A store base mode

## Problem

Every mode that keeps items shares one database, but the base that owns it is called `briefing` and is shaped for one kind of mode, the ones that pull items from a source. `components/briefing/mode.yaml:13-59` gives every child `sync`, `digest`, `ask` and `prune`, and a child cannot drop an inherited feature (`merge_mode`, `bay/model.py:378-410`). The store itself can be written only by `sync` and `prune` (`components/briefing/interfaces/items.store.v1.yaml:5-13`), and its one write function deletes whatever no selector matches (`corpus_store.py:583-587`, `:612-620`). An item that you or Claude wrote would be removed by the next sync. So the owner's to-do mode cannot be built on it: it has no source, no digest and nothing to prune.

This proposal turns the base into a generic `store` that owns the database and the writes that every data mode shares, and moves the source-specific features down into the two modes that need them. It does the eight things the owner approved and nothing else. The to-do mode and test effectiveness (0017) are out of scope. The proposal touches 29 entries, has an exception and touches sensitive paths (`bay/dispatch.py`, `bay/model.py`, `bay/connect.py`, `framework/kernel.yaml`, `schemas/`), so forge.extend's plan step runs. Nothing is implemented before the gate.

## What moves where

| In `components/briefing/` today | Goes to | Change on the way |
|---|---|---|
| `connectors/corpus-store/` and its tests | `components/store/connectors/corpus-store/` | add, update, delete, `rows`, local items (items 2 to 4) |
| `interfaces/items.store.v1.yaml` | `components/store/interfaces/items.store.v2.yaml` | item 2 |
| `interfaces/items.source.v1.yaml`, `data/selector.v1.schema.json` | `components/store/` | none |
| `skills/corpus-sql`, `skills/grounded-qa` | `components/store/skills/` | `items.store/v2` in the text |
| `types/Question`, `Answer`, `SyncReq`, `PruneReq`, `DigestReq` | `components/store/types/` | none (the two children share the last three; one level leaves no other shared home) |
| `types/Digest`, `skills/digest` | `components/feed-briefing/` | none |
| `features/ask/` playbook and rules | `components/store/features/ask/` | gains three pieces from mail's version (item 6) |
| `features/digest/`, `features/prune/` playbooks and rules | `components/feed-briefing/features/`; prune also copied to `components/mail-briefing/features/prune/` | none |
| `mode.yaml` features `sync`, `prune`, `digest` | declared by each child | `run:` names items.store/v2 |
| `mode.yaml` constraints `lookbackMax: 30d`, `spendUsd: 5` | each child | same values |
| `config.schema.json` | the keys `lookback`, `retention`, `selectors`, `maxItemsPerRun`, `monthlyItems`, `spendUsd`, `costPerItemUsd` go into each child's schema; `store` has no schema | mail's schema now stands alone and holds `important` too |
| `playbook.md` (coordinator) | `components/feed-briefing/playbook.md`; `store` gets a short generic one | mail keeps its own |
| `envs/local-feeds.yaml` | `components/feed-briefing/envs/` | none |
| (new) | `components/store/envs/store-local.yaml` | binds only items.store/v2; the base needs an env because `roles` is required (see item 1) |
| `tests/test_offline_golden.py` and `golden/` | `components/store/tests/` | the two JSON files keep their bytes; the test changes names (item 2) |
| `README.md` | `components/store/README.md` | items, selectors, layout, SQL, plus add, update, delete and local items |

Which features exist after the change:

| Feature | `store` | `mail-briefing` | `feed-briefing` |
|---|---|---|---|
| `add`, `update`, `delete`, `query`, `get` | yes | inherited | inherited |
| `ask` | yes, no refresh step | own block: adds `refresh` and `rows` | own block: adds `refresh` |
| `sync`, `prune` | no | own | own |
| `digest` | no | own (thread based) | own |

## The changes

**1. `store` replaces `briefing`.**

*Today.* See Problem. `needs: [items.store/v1, items.source/v1]` sits in the base (`mode.yaml:65`), so a child without a source would fail `bay check`: the connector's `needs.capabilities: [items.source/v1]` (`corpus-store/connector.yaml:14-15`) makes `check_connector` flag every env that binds no source (`bay/model.py:672-676`).

*Change.* `components/store/mode.yaml` is `abstract: true`, `needs: [items.store/v2]`, with six features, all `review: never`:

| Feature | Steps | Effects |
|---|---|---|
| `add` | `run: items.store/v2.add` | write |
| `update` | `run: items.store/v2.update` | write |
| `delete` | `get` (preview), `gate`, `run: items.store/v2.delete` | read, write, delete |
| `query`, `get` | the endpoint of the same name | read |
| `ask` | `context` (status), then the analyst | read |

The sources move down: each child adds `needs: [items.source/v1]`. The connector's capability becomes optional with one new key, `needs.optional` in `schemas/connector.schema.json`: `instantiate` loads the optional capabilities the env binds and `check_connector` does not flag one it does not. A store with no source and no selectors is never stale (`_stale` compares two empty selector lists, `corpus_store.py:391-399` and `bay/selector.py:184`), so its reads are not refused.

Two things I found that the design did not say. First, `roles` is required by the mode schema even for an abstract base: I tried a base without it (`spec: 'roles' is a required property`) and with `roles: {}` (`should be non-empty`). So `store` carries a small env, `store-local`, that binds only the store and the read tools and writes under `.agentbay/data/store`; each child overrides the roles with its own env as `mail-briefing` already does. Second, B-11: a mode named `store` is an instance name, and the bare word appears 16 times in README.md, DESIGN.md and INTERFACES.md outside fences (I ran `doc_hits` on today's docs with the name added). `components/store/` therefore joins `owns:` in `framework/kernel.yaml`, which makes it core and not an extension (`bay/boundary.py:22`); it also replaces the two `components/briefing/...` protected paths with one and reserves the mode name.

*Test that fails on `main`.* The new `test_a_store_mode_with_no_source_resolves_adds_and_reads` in `tests/test_inheritance.py`: a test child extends `store`, binds only items.store/v2 in its env, resolves with no gap, takes an `add`, and answers `get`, `query` and `sql` without a "run sync" refusal. On `main` there is no `store` and no v2. The existing tests of the two modes that stay behaviour-preserving, and prove it, are listed under item 5.

**2. `items.store/v2`: add, update, delete, `rows`, and a `local` source.**

*Today.* `_upsert` (`corpus_store.py:572-601`) is the one write path and `sync` is its only caller (through `_store_fetched`, `:873-904`). `_enforce_scope` deletes every row whose source is not bound (`:612-614`) or that no selector matches (`:615-626`), and `prune` deletes by age (`:975`).

*Change.* The interface is renamed to v2, with no v1 alias (B-12). New endpoints:

| Endpoint | In | Out | Effects |
|---|---|---|---|
| `add` | `{item}`: `kind`, optional `extId`, `title`, `text`, `author`, `labels`, the kind's own fields | `{item}` | write |
| `update` | `{id, set}`: a partial item; `id`, `source`, `extId`, `kind` and `createdAt` cannot be set | `{item}` | write |
| `delete` | `{ids}` (1 to 50) | `{deleted, missing, remembered}` | write, delete |
| `rows` (replaces `threads`) | `{name, since, until, selector, important, limit}` | `{rows, coverage}` | read |

`sync` is unchanged in what it does and now reads as "insert from a source": the write half of `_upsert` becomes one function that `add`, `update` and `sync` all call, and the selector match stays in the `sync` half. Writes take the same exclusive lock as `sync` and `prune`, scrub the item as `sync` does (`scrub_item`), and validate it against `<kind>/v1`. `add` fills what a person does not give: source `local`, `extId` (the day's next number, `yyyymmdd-nnnn`, unless given), `author`, `createdAt` and `fetchedAt`. The id is `local:<extId>`.

Local items are protected in the three places that delete: `_enforce_scope` (both loops) and `prune` skip `source = 'local'`. The store's scope is now "the items of the bound sources that match a selector, plus the local items". `local` is reserved: lint refuses a source connector that declares `source: local`. No data migration: the table layout and `SCHEMA_VERSION` do not change, so a store written by 2.0.0 opens as it is.

`rows` generalises `threads`. `views.yaml` keeps its `views:` and replaces the single `threads:` block by `rows:`, one block per name, each with the keys it has today (`view`, `window`, `selector`, `important`, `order`, `json`, `flags`, `details`). Mail's block is named `threads`. A to-do agenda later adds a second name. An unknown name, or a mode with no `rows:`, gets the error the connector gives today, naming the fix (`corpus_store.py:1180-1184`).

*Tests.* Behaviour-preserving, proven unchanged by the existing tests: reads, `sync`, `prune`, scope, budget. The offline golden (`test_feed_briefing_offline_golden`, `test_mail_briefing_offline_golden`) keeps both JSON files byte for byte. The test changes only names: `items.store/v2.*`, the golden path, and `rows` with `{"name": "threads"}`. The one value that differs is the key of the rows list, `threads` before and `rows` after, and it is a named delta in `mail_deltas` (the mechanism the test already has for its three documented changes), not an edit of the golden. The mail tests that read `gather["threads"]` (`mail-briefing/tests`, `gmail-api/tests`) change the key the same way. New behaviour is added to three existing corpus-store tests, so no test is added: `test_out_of_scope_rows_are_deleted_by_sync_and_prune` (an `add`ed item survives a sync, a prune with `olderThan: 1m` and a selector change; `update` changes it), `test_prune_retention_and_deletions` (item 3) and `test_connector_without_source_or_with_foreign_ids_is_rejected` (item 4). Each fails on `main` at the first call, because `add` is not an endpoint.

**3. Delete is a hard delete behind a gate, and a synced item is never stored again.**

*Today.* The store already keeps `state.json` `deleted`, the ids that a source reported deleted: `sync` skips them (`_store_fetched`, `corpus_store.py:885`) and `prune` removes them (`:970-974`). Nothing lets an owner add to it.

*Change.* The `delete` feature in `store`: step `preview` runs `items.store/v2.get` on `$in.ids`; step `confirm` is a gate with no `approves` (so it always runs; the dispatcher prints earlier step outputs with a gate, `_gate_plan`, `bay/dispatch.py:658-668`, so the owner sees the items); step `remove` runs `items.store/v2.delete`. The endpoint removes the rows (the FTS triggers and child tables follow) in one transaction. For an item whose source is not `local` it also adds `<source>:<extId>` to `state["deleted"]`, saved before the commit with the other durable parts (`DURABLE`, `:85`). A later `sync` then does not bring it back, even if the message is still in Gmail, and `prune` keeps it out. For mail this removes only the local copy: `items.source/v1` has only `fetch` (`items.source.v1.yaml:12-57`) and the Gmail scope is read-only (`gmail-api/connector.yaml:6`), so nothing can reach the mailbox. `approve.from` decides whether you pass the gate in a terminal or in chat, as for every gate. Agents cannot call `delete`: their use shim serves read endpoints only, and the write goes through `bay call`, which Claude Code asks you to confirm.

*Test that fails on `main`.* The new `test_delete_asks_first_and_never_touches_the_source` in `components/mail-briefing/tests`. After a sync, `mail-briefing.delete` on one message id stops at `awaiting-approval` with the message in `inputs.preview` and the store unchanged; `bay approve` removes it; the fake mailbox's recorded calls are the same before and after; a second `sync` does not bring it back and `state.json` lists the id. On `main` the feature does not exist. The hard-delete and never-restore halves are also asserted at the connector in `test_prune_retention_and_deletions`.

**4. `add` and `update` refuse what a source produces.**

*Today.* Nothing stops a writer from naming `kind: email`, because there is no writer. Once there is one, an `add` of an email would look like mail in a `v_email` query.

*Change.* `add` refuses a kind that is not in the mode's `reads:` and a kind that any `items.source/v1` connector produces (`produces:` in its manifest, now `email/v1` and `post/v1`). The dispatcher builds that list once into the mode settings as `sourceKinds` (it already passes `reads` and `modeDirs`, `bay/dispatch.py:580-589`). Using every source in the kit, not only the bound one, means a mode with no source cannot plant an email either, and a new source connector extends the guard with no further edit (DOD-4). `update` refuses any item whose source is not `local`, so a synced message or post is never edited, and refuses to change `kind`. The refusals name the fix: use `delete` to drop a synced item; a note kind (`note/v1`, which the owner has deferred) is the way to annotate one. In `mail-briefing` and `feed-briefing` the two endpoints therefore exist and always refuse. That is the cost of one level (item 8), since a child cannot drop what it inherits.

*Test that fails on `main`.* In `test_connector_without_source_or_with_foreign_ids_is_rejected` (the existing validation test, extended): `add` of `kind: email` and of `kind: post` is refused, `add` of an item with `source: gmail` is refused, `update` of a synced id is refused and leaves the row's bytes unchanged. Fails on `main` at the first call.

**5. `mail-briefing` and `feed-briefing` extend `store` directly.**

*Today.* Mail replaces `digest` and `ask` and inherits `sync` and `prune` (`mail-briefing/mode.yaml:17-44`); feed inherits all four and declares only `reads` and constraints (`feed-briefing/mode.yaml:8-17`).

*Change.* Both set `extends: store`, `needs: [items.source/v1]`, and declare `sync` and `prune` (the blocks of `briefing/mode.yaml:13-19` and `:48-59`, with `items.store/v2` in `run:` and `uses:`), `digest` and `ask`. `ask` is the base block plus the `refresh` step the base cannot have (`briefing/mode.yaml:45`); feed's keeps its refresh. Mail's `gather` step runs `rows` with `name: threads`. Mail's digest, `v_threads`, `views.yaml`, env and constraints are otherwise as they are; feed gets the files listed under What moves where. Both keep their data paths, store files and settings keys, so the owner's `agentbay.config.yaml` is valid as it is.

*Proof that behaviour is unchanged.* These existing tests must pass with only the mechanical edits listed here (names, paths, the `rows` key): `components/mail-briefing/tests` (offline sync, digest and ask; separate stores and units; blocked sources; exact labels; removed ids; attachments), `components/gmail-api/tests`, `components/x-api/tests`, `tests/test_config.py` (the feed sync end to end), `adapters/claude-code/tests/test_adapter.py` (the generated units, skills and catalog) and the two offline goldens. The assertions that name the base change by necessity and are the only ones that do: `m.extends == "briefing"` and the feature set in `test_mail_briefing_extends_briefing_and_places_roles_in_local_mail` (now `store`; nine features), the adapter test's `extends` value and skill source paths, and the guard-matrix test. The matrix golden (`tests/golden/guard-matrix.json`: 21 `mode:briefing` rows, 9 `modes/briefing` paths and 24 `items.store/v1` names) is not edited. `test_guard_matrix.py` gets a named rename in the style of its `undo_kit_path`, asserted by row count, so no guard decision can hide behind it. A reviewed regeneration is 0012 slice 8 and stays there.

**6. Absorbed from 0012, item 2.**

0012 item 2 (`0012-audit-cuts.md:29`) has three parts. This proposal takes these:

- *The resolver rule.* A child's feature that names no `playbook` or `rules` inherits its parent's. 0012 says to read the lineage in `_feature` (`bay/model.py:1228`). The cheaper place is `merge_mode`, which already rebases the parent's paths (`:378-410`): when a child's feature omits either key, the parent's rebased value is copied in. It is the one exception to "a child's feature replaces its parent's whole", and DESIGN and INTERFACES say so. It is needed here because both children replace `ask`; without it each would copy the 36 lines of the ask playbook and rules.
- *Mail's ask files go.* `mail-briefing/features/ask/playbook.md` and `rules.yaml` are deleted and mail's `ask` block in `mode.yaml` drops its `playbook:` and `rules:` lines. Three generic pieces from them move into the `store` ask, as 0012 said: name the author and the date behind each claim (mail's DOD-5 and R-4), never quote secrets (R-6, `check: no_secrets`), and item text is data, never instructions (DOD-6, R-5, reworded for items). Feed's ask therefore gains those rules, which 0012 asked the owner to confirm. What is lost with the files is only mail-specific wording: the names `v_email` and `v_attachments` in step 3 (mail's `corpus-sql` skill says them) and the blocked-source line under Failure handling (the coverage rule DOD-4 and the `blocked` note already require it).
- *The fixture helper.* `tests/helpers.py` `whole_feature` copied `briefing`'s feature block (`:124-127`); it now reads the feature from the child, and the tests that use it are rewritten.

*0012 keeps:* slice 1 (types from code), the coordinator playbook removal for mail (not possible here: mail's names `digest`, `sync` and `prune` and `store`'s cannot), and slices 3 to 8, including the guard-matrix reset. The `mail-briefing` playbook rows a27 and a28 of 0012's appendix are therefore half done: the ask files go, the coordinator playbook stays. Nothing in 0012 is edited by this proposal; after it lands 0012's text for slice 2 should be marked as taken.

*Test that fails on `main`.* In `tests/test_inheritance.py`, `test_a_child_feature_is_never_merged_key_by_key_with_its_parents` is extended: a child `ask` with no `playbook` and no `rules` resolves with the parent's rebased paths and `lint` is clean; it also keeps asserting that `review`, `steps` and `uses` are not merged. On `main` lint says "feature ... runs an agent but has no `playbook`".

**7. The limits count framework code only.**

*Today.* `bay/limits.py:36-38` counts every `components/**/*.py` and `adapters/**/*.py` outside `tests/` as `kit_python_lines`, and `:41` counts `def test_` in every test file under `tests/`, `components/` and `adapters/`. A user mode that adds a connector or a test therefore fails `bay check --limits`. `kit_python_lines` is 6579 and `tests` 539, both at their ceilings (`framework/limits.yaml:2,7`; the design said 6580).

*Change.* Two measures change scope, and no other. `kit_python_lines` counts the Python files of `adapters/` and of the protected components, and `tests` counts the test files of `tests/`, `adapters/` and the protected components. "Protected" is `protected.paths` in `framework/kernel.yaml`, read with `boundary.ComponentMap` (`limits.py` already imports `boundary`); `bay_lines` already counts only `bay/`, and `cli_commands`, `framework_folders`, `schemas` and `top_level_folders` do not look at components. What leaves the count today, by my count on 2.0.0:

| Measure | Counted today | Counted after | Leaves the count |
|---|---|---|---|
| `kit_python_lines` | 6579 | 5066 | the source connectors and content types `gmail-api` (992), `x-api` (263), `email` (165), `post` (93) |
| `tests` | 539 | 462 (460 plus the two goldens that move to protected `components/store`) | `gmail-api` (37), `x-api` (15), `mail-briefing` (14), the `improve` mode tests (11) |

What this costs is stated plainly: a growing `gmail-api` or `improve` mode is no longer stopped by a ceiling, only by review. The tests still run and still must pass. This is also what makes room for item 2: `corpus_store.py` grows by about 75 lines, which the old scope would have needed an exception for (6579 plus 75 is over). The ceilings do not stay high: the release step writes the new counts (about 5140 and 462), so the measures only fall from there. A change to the protected list is itself a change to `kernel.yaml`, which B-1 and the gate cover, so the list cannot be edited quietly to shrink a count. If `framework/kernel.yaml` is missing, `limits.check` stops with the existing "does not exist" style of error.

*Test that fails on `main`.* `test_limits_count_the_ceiling_the_ratchet_and_the_exception` (`tests/test_limits.py`) is extended: its fixture repo gets a `framework/kernel.yaml` that protects `components/c`, and a second component `components/u` with a Python file and a test file; the expected counts include only `c`. On `main` both are counted.

**8. One level of inheritance, enforced.**

*Today.* The resolver accepts any depth and only guards against loops (`_apply_extends`, `bay/model.py:255-292`; loop check `:270-276`, unknown parent `:278`). The one-level rule is the owner's policy and no code enforces it.

*Change.* In `_apply_extends`, a parent must be an `abstract` mode that itself `extends` nothing, and the error says so and names the file: `components/x/mode.yaml: extends 'y', which is not an abstract base (or extends another mode); a mode extends an abstract mode directly`. The check runs before the parent is resolved, so it also catches every loop (a loop needs a parent that extends) and a mode that extends itself; the cycle check and its `trail` bookkeeping are removed, which is where the line count is paid (-1 net). A missing parent still reports as today. `forge`, `cos`, `improve` and `delivery` extend nothing; `mail-briefing`, `feed-briefing` and the future to-do mode extend `store`. The rule is resolver-level, not a boundary id.

*Test that fails on `main`.* `test_missing_parent_and_cycles_are_errors_naming_the_fix` (`tests/test_inheritance.py:99`) keeps its missing-parent case. Its two cycle cases now expect the one-level message, and a new case makes `feed-briefing` extend `mail-briefing`: an error on this change, a clean resolve on `main`.

## Build order, and where to split

The change is large but its items depend on each other, so I do not recommend two proposals. Items 1 to 5 cannot be separated: the base, v2, the moves and the two children must land together or the tree does not resolve. Items 7 and 8 are independent kernel changes of about 30 lines. The plan step should order the work in four commits, each with the suite green and `bay check` clean: (1) items 7 and 8, no component moves; (2) the `store` folder, v2 and the connector (the old `briefing` and `items.store/v1` still in place only until commit 3, never both in one tree that is released); (3) the moves, the two children and item 6; (4) docs. If the owner finds the review too big, the seam is commit 1: items 7 and 8 become their own small proposal, which also lands the headroom items 1 to 6 would use. Merging them into a single review is cheaper, and item 7 is what lets items 1 to 6 fit, so the single proposal is the recommendation.

## Cost against the ceilings

All seven measures are covered. Counts are mine from 2.0.0 and are estimates until the code is written.

- **`bay_lines` (9670, count 9670): over, so the exception above.** Item by item, in the units `limits.count` uses (every line of `bay/*.py`): `limits.py` +6 (the kernel.yaml read and the predicate); `contenttypes.py` +8 (`rows` blocks: parse +1, the two checks loop over the names +7); `model.py` +3 (playbook fallback) +2 (`needs.optional`) -1 (the one-level check replaces the cycle check); `dispatch.py` +3 (`sourceKinds`); `lint.py` +2 (reserved name); `connect.py` 0. About +20. The payer I can name from the code is the cycle check, already counted. I cannot count more without writing the code, so the exception is an upper bound.
- **`kit_python_lines` (6579): not over, by the new scope.** `corpus_store.py` +75: `add` 18, `update` 14, `delete` 14, one shared write function -4, the three `local` exemptions +4, the kind guard +8, a lock helper for writes +6, `rows` +6, locks and state for deletes +9. Under the old scope that is 6654, over by 75. Under the new scope it is about 5141 against a ceiling of 6579, a note; the release writes about 5141.
- **`tests` (539): not over, and not growing.** Two tests are added (item 1 and item 3). Two are merged away that the change made obsolete: `test_feed_briefing_is_complete_after_extends` into `test_child_overrides_review_steps_roles_and_inherits_the_rest` (four of its assertions say feed inherits `sync`, `digest` and `prune`, which is false by design now, and the rest repeat the second test against the same base), and `test_mail_briefing_extends_briefing_and_places_roles_in_local_mail` into `test_two_modes_on_separate_envs_keep_separate_stores_and_units` (both assert which env each unit of the two modes runs in). The plan step re-checks both and names others if either does not hold. Everything else extends a named existing test. Counted under the new scope: 462, then 462.
- **`cli_commands` (16), `schemas` (16), `framework_folders` (2), `top_level_folders` (7): unchanged.** No `sub.add_parser`, no schema file (`connector.schema.json` and `mode.schema.json` are edited), no folder directly under `framework/` and none at the top; `components/store` is under `components/`.
- **`docs/DESIGN.md` (3000 words by `len(text.split())`) and `docs/INTERFACES.md` (2999): at their budget; additions are paid in the same file.** I applied the edits to scratch copies of the two files: DESIGN comes to 2992 and INTERFACES to 3000. The plan step re-measures on the real text.
  - DESIGN, additions: the one-level sentence (+10), the store paragraph replacing the four-feature paragraph (+10), the scope invariant's local items (+11), `delete` asks first and never touches the source (+25), the size bullet (+5). Paid by: the "misplaced connector" sentence, which INTERFACES repeats (-12); the parenthetical on internal connectors (-16); the run-log sentence on hooks (-14); the re-check wording (-5); "the loader finds these by folder name", which INTERFACES repeats (-7); and the section title (-2).
  - INTERFACES, additions: the inheritance bullet (one level, fallback) +23, `needs.optional` +3, section 11 +11, the recipe +3. Paid by: the `bay check` refusals paragraph (-15), the login paragraph (-7), the adapter catalog paragraph (-11), and the `store` wording of the section 11 sentence that said "the component that owns the base source mode" (-9).

So one exception (`bay_lines`), and `framework/limits.yaml` changes only at the release step.

## Compatibility and safety impact

- **Breaks, with no alias.** A mode that says `extends: briefing`, a connector that implements `items.store/v1`, a call to `items.store/v1.*` and a `views.yaml` with a `threads:` block stop working. `bay check` names the unknown parent or the old key. B-12 forbids a compatibility layer, so there is none. The release is 3.0.0 for that reason, with an Upgrading section in the CHANGELOG. `agentbay/v4` does not change: the manifest shapes only gain the optional `needs.optional`, and the contract that changes, `items.store`, is versioned by its own name (B-6, DOD-11). `views.yaml` has no version field, so the loader refuses the old key with a message.
- **Unchanged for the owner.** Data folders, store files, `state.json`, `SCHEMA_VERSION`, settings keys, endpoint names `mail-briefing.*` and `feed-briefing.*`, workflows and the generated unit and skill names. After the upgrade run `./bay.sh build` so the generated use shims and agent files name items.store/v2. New in the catalog: `add`, `update`, `delete`, `query` and `get` on both modes.
- **Safety.** No secret is read, written or shown by any change. Every write goes through the dispatcher as a code step, so `bay call` asks you before it runs and agents cannot write (their shim serves read endpoints only, B-9). `delete` always asks, shows what it will remove, and for mail never reaches the mailbox. Local text is scrubbed like synced text. The kind guard stops a planted email or post. The coordinator playbook for `store` says to add or change data only when your latest message asks for it. `local` is a reserved source name. The sandbox for agent SQL (B-10) is unchanged.
- **Extensibility (DOD-4).** A new source is still one connector and one env binding line. Its `produces` feeds the kind guard with no other edit.
- **Out of scope.** The to-do mode and its content type, test effectiveness (0017), the guard-matrix regeneration (0012 slice 8), a `note/v1` kind for annotating mail, and the rest of 0012.

## Owner decisions

The owner took every recommendation below in chat on 2026-11-03 ("Agree with recommendation"). For choice 4 that is the kernel.yaml protected list as written here.

1. **`components/store/` is core-owned in `kernel.yaml`.** Needed because B-11 finds the word `store` 16 times in the core docs. The alternative is a base name the docs do not use as a bare word, such as `data-store`. Recommended: keep `store`, as you approved.
2. **`rows` returns `{rows, coverage}`.** The mail golden and the mail tests then change one key, as a named delta. The alternative is to key the list by the name asked for (`{threads: [...]}`), which leaves every mail line alone but makes the interface's output schema dynamic. Recommended: the fixed `rows`.
3. **Sibling copies.** One level means `mail-briefing` and `feed-briefing` each hold their own copy of the prune playbook and rules (31 lines), the settings schema keys (19 lines) and a coordinator playbook (about 16 lines). Pointing both at one file would break "a component uses another only through what it provides". Recommended: copy, and accept the drift risk.
4. **Which components count as framework code for the limits.** The protected list in `kernel.yaml`. The alternative is a separate list in `limits.yaml`, which would say it more explicitly and be one more thing to keep in step. Recommended: `kernel.yaml`.
5. **Release number.** 3.0.0, because a mode that extends `briefing` stops resolving. 2.1.0 would understate it. Recommended: 3.0.0.
6. **Guard-matrix golden.** A named rename in the test now, a reviewed regeneration later (0012 slice 8). Recommended as written.

## Citations re-checked against 2.0.0

The design cited 1.1.2. Everything below was opened and read on the branch.

| Cite in the design | Today | Changed |
|---|---|---|
| `items.store.v1.yaml:18-25, 51-55` | same | no |
| `corpus_store.py:572-601` (`_upsert`) | same; no-match branch `:583-587` | no |
| `corpus_store.py:603-626` (`_enforce_scope`, unbound `:612-619`) | `:603-630`; unbound delete `:612-614`, unmatched `:615-626` | grew 4 lines |
| `corpus_store.py:21,35` (never re-store) | docstring `:21,35`; code `state["deleted"]` at `:664,671,885,895,970,977` | no |
| `bay/model.py:378-410` (inheritance) | same; the `needs` union is `:406`, not `:404-405` | 2 lines |
| `bay/model.py:273-284` (resolver) | `_apply_extends` `:255-292`; cycle check `:270-276`, unknown parent `:278`, resolve `:279` | moved |
| `bay/model.py:179,283`, `:672-676` | same | no |
| `corpus-store/connector.yaml:14-15` | same | no |
| `briefing/mode.yaml:13-19, 45, 48-59`; `mail-briefing/mode.yaml:17-44`; `feed-briefing/mode.yaml:8-17` | same | no |
| `items.source.v1.yaml:12-57`; `local-mail.yaml:6` | same | no |
| `bay/dispatch.py:556-568` (citation check reads every `corpus.db`) | `:591-603` | moved +35 (0015) |
| `docs/DESIGN.md:192, 194-217, 62, 88-90` | `:189, 191-214, 60, 84-88` | moved (0015) |
| `bay/limits.py:37-42` | `:36-38` (kit), `:41` (tests) | moved |
| `framework/limits.yaml:2,7` (6580 and 539) | `kit_python_lines` 6579, `tests` 539 | the first was 1 off |
| `framework/kernel.yaml:9,13` | same | no |
| `bay/sqlsandbox.py:45-50`, `cos/playbook.md:16-19`, `claude_code.py:57, 496-499`, `improve/mode.yaml:77-81`, `workspace.yaml:15`, `delivery/mode.yaml:20-29`, `CreateReq.schema.json:6` | same (the sandbox allows `date`, `datetime`, `strftime`, `time`) | no |
| 0015's files (design section 6) | landed in 2.0.0: `approve.from`, plan approval, config v4; nothing of 0016 conflicts | landed |
| 0012 item 2: `bay/model.py:1181,1201` | not landed; `_feature` reads `md.dir / ep["playbook"]` at `:1228` | the fix goes in `merge_mode` instead (item 6) |

Two facts the design did not have: `roles` is required even for an abstract base, and `store` as a bare word trips B-11. Both are in item 1.
