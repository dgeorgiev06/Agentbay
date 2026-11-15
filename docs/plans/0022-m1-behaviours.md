# M1 behaviours: the store, the fake source and the feed briefing

Slice M1 of plan 0022 rebuilt `components/base/store` (the corpus store connector and its SQL sandbox), the
feed briefing's fake connector and the feed briefing itself. This file lists every test function of the old test
files, as DOD-6 asks. Each one is **kept** (and where), **changed** (and how) or **dropped** (and why, and whether
the proposal, the plan or the stage 4 contracts name the drop). An item marked **owner** is a drop or a change that
none of them names, so the owner decides it.

The old files, on `main`:

- `components/base/store/connectors/corpus-store/tests/test_corpus_store.py` (33 tests)
- `components/base/store/connectors/corpus-store/tests/test_sqlsandbox.py` (15 tests)
- `components/base/store/tests/test_offline_golden.py` (2 tests)

The feed briefing had no test file of its own on `main` (there is no `test_feed_briefing.py`). Its offline
golden test lives in `test_offline_golden.py` and is listed below.

New test files, by shorthand:

| shorthand | file |
|---|---|
| items | `components/base/store/tests/store-items.test.ts` |
| query | `components/base/store/tests/store-query.test.ts` |
| sql | `components/base/store/tests/store-sql.test.ts` |
| schemas | `components/base/store/tests/store-schemas.test.ts` |
| fake | `components/modes/fake-source/tests/fake-source.test.ts` |
| briefing | `components/modes/feed-briefing/tests/feed-briefing.test.ts` |
| citations | `components/modes/feed-briefing/tests/citations.test.ts` |
| session | `tests/feed-briefing-session.test.ts` |
| kernel | `tests/broker-partitions.test.ts`, `tests/engine-caller.test.ts`, `tests/script-runner.test.ts`, `tests/tools.test.ts` |

## The scope invariant (owner)

The old store held exactly the mode's scope: the items of the bound sources that match at least one current
selector, plus local items. After a selector or binding change it refused every read except `status` until a
sync re-scoped it. The proposal's table of modes says the store "keeps the scope rule". The plan lists "the
store's scope rule" among the behaviours to carry over. The stage 4 contracts do not list it as kept.

What M1 does, the smallest honest design:

- `put` applies the shared matcher with the selector the page was fetched with, so the store keeps only what
  that selector asks for, even from a source that returns more.
- `status` reports, per source, the selector of its last sync.
- `digest` compares that selector with the configured one. It sets `selectorChanged` in the skill's input and in
  the finished digest, and the digest skill must then say in its notes that a sync is due (DOD-6 of the skill).
- `sync` re-reads its whole window with the new selector when the selector changed.
- What it does **not** do: items stored under an old selector or an unbound source stay in the store until they
  are pruned or deleted, agents' `sql` sees them, and no read is refused.

The tests that cover this are in briefing: "digest says when the configured selector differs from the one the
store was last synced with", and in items: "put keeps only the items the selector they were fetched with
matches". The owner decides whether the full rule comes back: re-scoping on change, and refusing reads while
the selector is stale.

## test_corpus_store.py

| old test | verdict | where, how or why |
|---|---|---|
| `test_schema_wal_user_version_fts_and_owner_only_file` | changed; **owner** for the file mode | WAL comes from the kernel's database layer. The FTS5 index and its three triggers are in `migrations/0001-items.sql`, and migrations are tracked per partition in `_migrations` instead of `user_version` (kernel: "migrations are tracked per partition file"). The old store created its file with mode 0600. The kernel creates database files with the default mode, and no document names this drop. |
| `test_newer_schema_is_refused_with_the_fix` | dropped | No store of agentbay 4 is read ("Nothing reads agentbay 4 manifests, state or data", proposal summary). The kernel applies the mode's numbered migrations, and there is no schema version to refuse. |
| `test_sync_dedups_and_is_incremental` | kept | briefing: "sync fills the store…", "a second sync continues from the saved cursor and adds nothing new"; items: "put replaces an item with the same id…" |
| `test_lookback_beyond_api_window_is_reported_and_coverage_gap_stated` | dropped; **owner** | The source API window, coverage (`from`, `to`, `complete`, `note`) and its warnings are gone. A source does not declare a window, and the store keeps no coverage. The stage 4 contracts' fetch returns "items, the next cursor and what it cost" and names nothing more. |
| `test_lookback_max_enforced` | changed; **owner** | The mode constraint `lookbackMax` is gone. `lookback` is bounded only by its pattern, and each sync is bounded by `maxItems` and the run's budget. |
| `test_query_filters` | kept | query: the selector table (authors with `@` and case, text, since and until, kinds), "query returns the newest first…" |
| `test_budget_caps_stop_and_report` | changed; **owner** for the monthly caps | The connector's caps (`maxItemsPerRun`, `monthlyItems`, `spendUsd`) are replaced by the engine's run budget (items, usd), which every nested call draws from, and the setting `maxItems`. That change is named by the plan ("budget is enforced by one connector… the engine enforces it for every run"). A cap per calendar month is not enforced; the store only reports the spend per month in `status`. briefing: "with a budget smaller than one page the run waits for budget…", "sync stops at maxItems…" |
| `test_gap_after_capped_run_refetches_window` | changed | A sync stopped by `maxItems` saves its cursor, and the next sync continues there (briefing: "sync stops at maxItems and the next sync goes on where it stopped"). There is no coverage gap to refetch. |
| `test_prune_retention_and_deletions` | changed | `prune` takes `before` (a time) instead of `olderThan` and `deletedIds`; `delete` remembers ids. Local items are never pruned. items: "prune drops source items before the time it is given and never the owner's local items", "prune compares times with their zones". |
| `test_source_reported_deletions_are_honored_on_sync` | dropped; **owner** | A fetch response has no `deleted` or `removed` lists, so a source cannot report deletions. The stage 4 contracts' fetch does not name them. Deletions the owner makes are remembered (items: "a deleted id is remembered…"). |
| `test_budget_counts_reads_not_kept_items` | kept | The cost a page reports is recorded and charged whether or not the store keeps its items. briefing: "sync applies the selector…" asserts a cost of 8 items for 4 kept. |
| `test_deletion_checks_are_reserved_and_only_checked_ids_are_marked` | dropped; **owner** | `checkIds` and `checked` (re-reading stored ids to find deletions) are gone with source-reported deletions. |
| `test_connector_without_source_or_with_foreign_ids_is_rejected` | kept | items: "put refuses an item of another source or with an id of another source"; the fetch response schema requires `source`. |
| `test_store_writes_only_inside_env_write_path` | changed | The store writes only through the broker, into its partition files. sql: "the store writes only database files under .agentbay/data…". The kernel also creates an unused `store.db`, because it migrates a mode's unnamed database before each script. |
| `test_reads_never_write_the_store_or_state` | changed | A read opens the caller's partition and applies the migrations on first use, so the first read of a new caller creates its file. Reads never write items or bookkeeping: `get`, `query` and `status` use `db.query`, and `sql` uses the read-only agent query. No test compares the bytes before and after a read. |
| `test_status_counts_from_sqlite_and_reports_selectors_and_engine` | changed | `status` counts items and deletions and, per source, gives the kinds, cursor, last sync, selector and spend per month (items: "status reports…"). Counts per selector and the engine name are gone: there is one selector, and FTS5 is always there. |
| `test_a_state_json_from_before_the_items_rename_gets_an_actionable_error` | dropped | No agentbay 4 state is read (proposal summary). |
| `test_native_query_and_local_filter_with_matched_tags` | changed; **owner** for several selectors | The split is kept: the source applies its native fields and the store's matcher the rest (fake: "fetch applies authors, since, until and limit itself…"; briefing: "sync applies the selector…"). A mode now has one selector rather than a list of selectors with ids, so the `matched` tags and selectors sharing a fetch and a cursor are gone. |
| `test_selector_change_rematches_without_refetch_and_new_selector_backfills` | changed; **owner** | A changed selector makes the next sync re-read its window from the start, paying for the fetch again, instead of re-matching stored items without a refetch. See the scope invariant above. |
| `test_removed_selector_items_leave_the_store_at_once_without_refetch` | dropped; **owner** | The scope invariant. |
| `test_out_of_scope_rows_are_deleted_by_sync_and_prune` | dropped; **owner** | The scope invariant. That local items survive is kept (items: prune). |
| `test_unbinding_a_source_removes_its_items_and_cursors` | dropped; **owner** | The scope invariant: the items of a source no longer bound stay until they are pruned or deleted. |
| `test_get_thread_facets_search_describe` | changed | `get` is kept (items: "put then get…"). Search is part of `query` (query: "full-text search…"). `thread`, `facets` and the store's `describe` are not among the store actions the stage 4 contracts list. |
| `test_like_fallback_when_fts5_is_missing` | dropped | Node's SQLite always has FTS5 (plan, spike A: "ENABLE_FTS5 is compiled in"). |
| `test_every_stored_column_is_scrubbed_at_ingest` | kept | The broker redacts secret-looking text and handed-out secret values from every statement value before it is stored (kernel: "text that looks like a secret is redacted from statement values…"; items: "text that looks like a secret is not persisted, in the item or in the full-text index"). |
| `test_dict_keys_and_identity_fields_are_scrubbed_at_ingest` | changed | Ids, labels and `data` (keys included) are statement values, so they are redacted as text. An id that held a secret would be stored redacted, under a changed id. No test plants a secret in an id or a key. |
| `test_two_modes_on_one_env_keep_separate_stores` | kept | One partition per caller (sql: "one caller cannot see another caller's items through query, get or sql"; kernel: "two partitions do not see each other's tables or rows"). |
| `test_reads_refuse_a_stale_scope_until_sync_rescopes` | changed; **owner** | Replaced by `selectorChanged` in the digest (see the scope invariant). |
| `test_a_failing_source_still_rescopes_first` | dropped; **owner** | The scope invariant. |
| `test_swapping_offline_for_real_refuses_role_reads_until_a_rescope` | dropped; **owner** | The scope invariant. Binding X in place of the fake leaves the fake's items in the feed briefing's partition until they are pruned or deleted. |
| `test_concurrent_sync_and_prune_keep_every_billed_item` | kept by design, not tested | Spend is a row per page in the table `spend`, which `prune` never touches, so a prune that runs during a sync cannot lose spend. No test runs the two at once. |
| `test_a_crash_around_the_commit_never_loses_spend` | kept | items: "spend is recorded before the items, so a put that fails in between and is retried counts it once". The cost of a page is recorded under the page's hash before any item, and recorded once however often the same put is retried. |

## test_sqlsandbox.py

| old test | verdict | where, how or why |
|---|---|---|
| `test_approved_reads_work` | kept | sql: "sql runs one select over the caller's views and returns columns and rows" (`items_view`, `items_search` with a match). |
| `test_writes_and_ddl_are_refused` | kept | The kernel's wrapper admits one select only. sql: "sql refuses a second statement, a write and attach, and the items stay". |
| `test_attach_pragma_and_load_extension_are_refused` | kept | sql (attach, pragma); kernel: "an agent query on one partition cannot attach another partition…"; `load_extension` is refused by the kernel's agent query (`tests/broker-database.test.ts`). |
| `test_internal_state_is_not_in_the_store_and_unknown_tables_are_unreadable` | changed; **owner** | The bookkeeping (`deletions`, `sync_state`, `spend`) is in tables of the caller's partition, and agents' `sql` can read them, because the kernel's agent query reads every table of its file. In agentbay 4 that state lived in `state.json`, out of the sandbox's reach. It holds cursors and spend, not secrets. |
| `test_runaway_queries_hit_the_time_limit` | kept | sql: "sql refuses more rows than its limit and stops a runaway query" (2 seconds, killed by the kernel). |
| `test_row_and_byte_caps` | changed | A query that returns more than 200 rows is refused, not cut, and the caller cannot set a limit per call; results are capped at 1 MB and long cells are cut, by the kernel. |
| `test_planted_secrets_never_leave_any_read` | kept | Secrets are never stored (items), and the broker redacts every agent query result as well. |
| `test_comment_and_quoting_tricks` | kept | The kernel's one-statement wrapper (broker-database tests of K3); sql: a second statement is refused. |
| `test_fts_match_syntax_errors_say_how_to_quote` | changed | `query` turns any `search` into quoted words, so a syntax error cannot happen there, and a search with no words is refused with a sentence (query: "punctuation, quotes and search operators…", "a search with no letters or digits…"). An agent's own `match` in `sql` gets the SQLite message inside the kernel's refusal, with no hint on quoting. |
| `test_missing_store_is_explained` | changed | A caller's partition is created and migrated on first use, so `sql` on a new store returns no rows rather than an error. |
| `test_out_of_scope_rows_are_gone_so_no_oracle_form_finds_them` | dropped; **owner** | The scope invariant. |
| `test_full_text_on_the_store_table_and_the_view_agree` | changed | There is one full-text index, `items_search`, joined to `items` on `rowid`; there is no `v_fts` view (sql). |
| `test_every_view_accepts_narrow_projections` | changed; **owner** for kind views | `items_view` is the one item view. The per-kind views of agentbay 4's content types (`v_posts` with `lang`, `likes`, `reposts`) are gone: a kind's fields are JSON in `data`, read with `json_extract`. The proposal says a content type is "a schema and views inside the mode that owns the data", but a mode cannot add views to the store's partition today. |
| `test_big_sort_fails_cleanly` | changed | The kernel's time limit and result-size cap stop it; no test runs a big sort. |
| `test_pre_release_store_with_a_state_table_is_refused_by_readers_too` | dropped | No agentbay 4 store is read (proposal summary). |

## test_offline_golden.py

| old test | verdict | where, how or why |
|---|---|---|
| `test_feed_briefing_offline_golden` | changed | The golden file is replaced by exact assertions on the fake source's posts and on the sync output (fake: "every post is a valid item…"; briefing: "sync fills the store…"), and by the CLI run in a fresh project (session). |
| `test_mail_briefing_offline_golden` | not in this slice | The mail briefing is slice M2 of stage 5. |

## Behaviours the plan lists, and where they are now

| behaviour (plan, "What the inventory says to carry over") | in M1 |
|---|---|
| The store's scope rule | Partly; **owner** (see above) |
| Remembered deletions | Kept: `deletions`, refused by every later `put` (items) |
| Spend saved before items are committed | Kept: `spend` row per page before the items, once per page (items) |
| One shared selector matcher | Kept: `components/base/store/scripts/lib/selector.ts`, used by `put` and `query` (query, items) |
