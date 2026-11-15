# K3: kept, changed and dropped behaviours

Slice K3 of plan 0022: the broker, the policy, the secret store, the SDK and the confined script runner. There is one line for every test function of `tests/test_auth.py` and `tests/test_protection.py`. There is also one line for each secret, HTTP, path-confinement and SQL-sandbox test found in these files: `tests/test_ledger.py`, `tests/test_dispatch.py`, `tests/test_boundaries.py`, `components/base/store/connectors/corpus-store/tests/test_sqlsandbox.py`, `components/modes/feed-briefing/connectors/x-api/tests/test_x_api.py` and `components/modes/mail-briefing/connectors/gmail-api/tests/test_gmail_api.py`. All were read with `git show main:<file>`. The guard and hook tests of `test_boundaries.py`, which parse shell commands and agent tool calls, belong to the dropped guard and to K6. They are not listed one by one.

"Named" means the proposal names the drop. "Owner" means it does not, and the drop goes back to the owner (plan, R-5). "Later slice" means the behaviour is not lost, but another slice owns it, and that slice is named.

New tests: `tests/policy.test.ts` (P), `tests/secrets.test.ts` (S), `tests/broker-database.test.ts` (D), `tests/broker-files.test.ts` (F), `tests/broker-http.test.ts` (H), `tests/broker-helpers.test.ts` (B), `tests/script-runner.test.ts` (R), `tests/sdk.test.ts`, `tests/node-ports-broker.test.ts`.

## tests/test_auth.py

| Old test | Verdict | Where, how or why |
|---|---|---|
| `test_cli_names_no_connector_and_logins_are_declared` | later slice | `bay auth` is K5's CLI. The kernel naming no connector is now the plan's rule that only adapters name a runtime and that mode code imports only `bay/sdk.ts` (eslint). |
| `test_login_env_is_the_one_env_binding_the_connector` | dropped | Environments are removed (named, Concepts). A login runs as an action of the mode that holds the secret. |
| `test_login_context_gives_only_the_connectors_declared_secrets` | kept / owner | Kept: S "a secret the permissions do not list is refused, naming the manifest line to change", plus S's redaction tests. Dropped: `store_secret`, which wrote a rotated secret back. The secret store has no write path. A later slice that needs OAuth rotation (M2, M3) must add one; this goes back to the owner. |
| `test_login_secret_access_equals_sync_access` | changed | The login and the sync of a mode now get the same `Permissions`, so they cannot differ. S and H refuse undeclared names. The "evil connector in another env" case has no counterpart without environments (named). |

## tests/test_protection.py

| Old test | Verdict | Where, how or why |
|---|---|---|
| `test_the_shipped_map_declares_what_the_old_fixed_list_protected` | changed | The protected list is fixed in `bay/policy.ts`: `.agentbay/`, `.git/`, `bay/`, `schemas/`, `adapters/`, `framework/` and every other mode's folder. P "a declared path into a kernel, state or git folder is refused". The boundary map file is dropped with the guard (named, Safety). |
| `test_a_role_without_forge_extend_cannot_write_a_path_the_map_lists` | changed | P refuses such a declared path, and F refuses a write outside `files.write`. Roles are removed (named). Forge's `extend` exception is M6's. |
| `test_a_protected_folder_that_a_non_extender_env_names_is_a_resolver_gap` | changed | P "every problem names the manifest and the field to change, all at once". Environments are removed (named). |
| `test_lint_keeps_framework_dev_in_step_with_the_map_both_ways` | dropped | No framework-dev environment and no map (named, Concepts and Safety). |
| `test_closure_every_env_a_protected_mode_maps_and_connector_a_protected_env_binds_is_protected` | dropped | Environments and connectors are removed (named). |
| `test_a_stale_guard_policy_is_reported_by_check` | dropped / later slice | The guard policy file is dropped (named). K6 writes a per-step policy file, and its staleness check is K6's. |
| `test_a_missing_or_malformed_protected_block_fails_closed` | changed | There is no map to be malformed. The list is code. A malformed manifest fails the schema (K1). |
| `test_a_map_that_is_not_yaml_or_not_there_fails_closed_too` | dropped | No map (named). |
| `test_a_closed_set_leaves_no_adapter_path_open_either` | later slice | The adapter writing its policy from `Permissions` is K6's. |
| `test_a_name_is_protected_wherever_it_sits_and_is_defined_once` | changed | P "a declared path into another mode's folder is refused, and the mode's own folder is allowed". |
| `test_a_user_mode_may_place_roles_only_in_the_protected_envs_the_map_opens_to_it` | dropped | Roles and environments are removed (named). |
| `test_an_edit_to_a_protected_component_without_touches_fails_check_base` | later slice | `bay check --base` is K2's (proposal, "The kernel changes only through forge"). |
| `test_a_new_folder_of_a_protected_name_or_in_a_protected_folder_is_not_a_new_extension` | later slice | K2's `check --base`. |
| `test_a_malformed_protected_block_makes_check_base_refuse_and_the_judging_map_is_the_bases` | later slice / dropped | K2's `check --base`. No map (named). |
| `test_a_user_mode_named_cos_or_forge_in_another_case_is_stopped_everywhere` | changed | P "a protected folder is refused in any letter case": declared paths are compared case-folded, so `Bay/` or `Components/Base/Store` are refused. Case-folded comparison in a hook is dropped (named). Mode-name rules are K1's and K2's. |
| `test_approval_from_chat_and_from_the_terminal_both_pass_the_gate` | later slice | Approval is a workflow step (K4) and CLI (K5). |
| `test_improve_is_an_ordinary_mode_while_its_env_and_connectors_stay_protected` | changed | Every mode is ordinary to the policy. Its folder is protected from every other mode (P). |
| `test_improve_files_are_writable_like_any_user_mode_and_its_env_and_connectors_are_not` | changed | Same as above: a mode may name paths inside its own folder (P). |
| `test_bay_new_no_longer_calls_improve_a_protected_name` | later slice | `bay new` is K2's. |
| `test_check_base_treats_a_new_improve_folder_as_a_new_extension_but_not_its_connectors_or_cos` | later slice | K2's `check --base`. |
| `test_no_step_in_any_mode_may_call_improve_findings_decide` | later slice | Owner-only actions are an engine and interface rule (K4, M7), not the broker's. |
| `test_bay_approve_of_a_backlog_item_from_a_terminal_still_works_and_the_owner_path_is_open` | later slice | K5 and M7. |

## Secret tests elsewhere

| Old test | Verdict | Where, how or why |
|---|---|---|
| `test_ledger.py::test_ledger_scrubs_secret_shaped_text_and_stays_valid_json` | kept | H "an event a script emits is appended after redaction". S "text that looks like a secret is scrubbed by pattern". The marker is `[redacted:<kind>]`, not `[REDACTED:<kind>]`. |
| `test_ledger.py::test_secret_scan_catches_planted_secrets` | kept / changed | S checks every pattern kind. All seven patterns of `secretscan.py` are kept in `bay/secret-patterns.ts`. `clip` (scrub, then cut) is kept as the order of work: agent query cells are cut by the broker after redaction, so a secret that straddles the cut is still redacted (D "an agent query redacts what it returns before it cuts long cells"). |
| `test_ledger.py::test_secretscan_catches_bare_values_with_dots_and_digit_less_secrets` | kept | S, the same four inputs. |
| `test_ledger.py::test_audit_parses_source_that_contains_secret_shaped_code` | later slice | Improve's reader (M7). |
| `test_ledger.py::test_bay_plan_records_scrubbed_size_limited_append_only_events` | changed / later slice | Every event the broker appends is redacted (H). Event size limits and append-only storage are the engine's `events` table (K4). |
| `test_dispatch.py::test_connector_failure_is_reported_redacted` | kept | R "a script that returns or prints a secret value has it redacted": `fail` and crash reasons and events. H "a transport error is a failed answer with a redacted message". |
| `test_dispatch.py::test_secrets_never_in_ledger_output_or_store_on_success` | kept | R: a returned secret value becomes `[redacted:API_TOKEN]`. H: the URL and `Authorization` of a logged request are redacted. |
| `test_dispatch.py::test_redact_is_a_last_line_of_defence` | kept / changed | S "a value handed out is redacted raw, in base64, in URL-safe base64 and URL-encoded". The store is a class with its own state instead of a module global, and values under 8 characters are refused instead of skipped (old: 4). |
| `test_boundaries.py::test_secret_set_refuses_non_tty_stdin` | later slice | `bay secret set` is K5's. |
| `test_boundaries.py::test_keychain_set_never_puts_value_in_argv` | owner | The secret store only reads. Writing to the keychain (`security -i` on stdin) has no K3 caller. If K5's `bay secret` needs it, it goes back to the owner with the rotation case above. |
| `test_boundaries.py::test_chat_setting_does_not_open_secrets` | later slice | K5. |
| `test_x_api.py::test_secrets_only_names_allowed_by_env_and_connector` | changed | S. Names are exact and upper case. The old `X_*` wildcard (fnmatch) is dropped (owner), as is the environment's second allow-list (named). |
| `test_x_api.py::test_keychain_provider_command` | kept | S "on macOS a secret missing from the environment comes from the keychain": exact arguments, empty environment. Off macOS the keychain is not asked (S). |
| `test_x_api.py::test_token_refresh_on_401_and_rotation_is_persisted_not_leaked` | later slice / owner | Refresh is M3's. Persisting a rotated token needs a secret write path (owner, see above). |
| `test_x_api.py::test_refresh_failure_is_actionable_and_secret_free` | kept / later slice | Every failure message the broker and runner return is redacted (H, R). The X wording is M3's. |
| `test_gmail_api.py::test_tokens_never_leave_the_connector` | kept | R and H, as for `test_secrets_never_in_ledger_output_or_store_on_success`. |
| `test_gmail_api.py::test_env_allowlist_and_secret_allowlist_bind_the_connector` | changed | H "an undeclared host is refused before any request". S refuses an undeclared secret. There is one list per mode, not an environment's (named). |
| `test_gmail_api.py::test_a_broader_grant_is_refused` | later slice | The Gmail OAuth scope check is M2's. |

## HTTP tests elsewhere

| Old test | Verdict | Where, how or why |
|---|---|---|
| `test_x_api.py::test_allowlist_enforced_before_any_request` | kept / changed | H "an undeclared host is refused before any request", "http instead of https is refused". Changed: a host entry matches exactly or by a leading `*.`. The old `*` (any host) and other fnmatch patterns are refused by the policy (P), which is a narrowing (owner). New: redirects are followed by hand and checked at every hop, credentials are dropped on a host change, non-default ports and credentials in the URL are refused, and bodies are capped. |

## Path confinement tests elsewhere (test_boundaries.py)

| Old test | Verdict | Where, how or why |
|---|---|---|
| `test_store_is_not_reachable_with_file_tools` | kept | F and D: `.agentbay/data/*.db` is refused to `files.read` and `files.write`, and R shows a script cannot read it directly. Grep and Glob are K6's hook. |
| `test_path_normalization_and_symlinks` | kept | F "a read outside the read paths is refused" (`..`), "a read through a link inside a read path that points outside is refused", and "a granted path that is itself a link to another folder of the project is refused". R refuses a run whose folders hold such links, and refuses a link the script makes at run time. |
| `test_writes_limited_to_env_fs_write_and_kit_is_off_limits` | kept | F "a write outside the write paths is refused, even inside a read path". R shows the same for direct writes. The kit's files are unreadable to a script (R). |
| `test_b1_case_variants_on_case_insensitive_filesystem` | changed / dropped | The policy refuses protected folders in any letter case (P). Case-folded comparison in a hook is dropped (named). |
| `test_b1_identity_check_catches_aliases_by_inode` | changed / dropped | Links are resolved with `realpath` (F, R). Inode comparison is dropped (named). A hard link into a granted folder is not detected; a script cannot make one (`fs.link` is denied by the permission model, R), but something outside a run could. |

## components/base/store/connectors/corpus-store/tests/test_sqlsandbox.py

| Old test | Verdict | Where, how or why |
|---|---|---|
| `test_approved_reads_work` | kept | D "an agent query returns rows, columns and full-text matches". |
| `test_writes_and_ddl_are_refused` | kept | D "an agent query is refused": insert, with ... insert, create temp table. Other DDL ends in the same syntax error inside the `select * from (...)` wrapper. Script SQL: D "a write statement from an action with only read effects is refused". |
| `test_attach_pragma_and_load_extension_are_refused` | kept / changed | D: attach, pragma writes, `query_only = off` and `load_extension` are refused for agents, and attach, vacuum and pragma for scripts. Changed: `pragma_table_info(...)` and other table-valued pragmas, `randomblob` and `printf` are not refused. Node 22's SQLite has no authorizer, so there is no function allow-list (spike A). Memory bombs are only stopped by the time limit: `hard_heap_limit` has no effect in Node's SQLite build (tried: a 400 MB `randomblob` ran). Owner. |
| `test_internal_state_is_not_in_the_store_and_unknown_tables_are_unreadable` | changed / later slice | Without an authorizer, an agent query can read every table of the mode's own database. Isolation is one database file per mode, and keeping internal state out of a mode's file is the store's (M1). The CTE-shadowing rule existed only for the authorizer and is dropped (owner). |
| `test_runaway_queries_hit_the_time_limit` | kept | D "an agent query with an endless recursive CTE is killed at the time limit, and the next query works". R "a script whose database query never ends is still killed at the time limit". |
| `test_row_and_byte_caps` | changed | D "more than the limit" is a refusal, not a truncation (spike A). The result is capped at 1,000,000 bytes and refused above it. Cells are cut at 4,000 characters (D "an agent query cuts long cells"). |
| `test_planted_secrets_never_leave_any_read` | kept / later slice | D: agent query results are redacted by value and pattern. Scrubbing bodies before they are stored, which also covers `hex(text)`, is the store's (M1). |
| `test_comment_and_quoting_tricks` | kept | D: a second statement after a `;`, after closing the wrapper, and B "the leading keyword skips blanks and comments". |
| `test_fts_match_syntax_errors_say_how_to_quote` | changed | The refusal carries SQLite's own message and the rule. The FTS quoting advice is the store's (M1). |
| `test_missing_store_is_explained` | kept | D "an agent query against a mode with no database yet fails plainly". |
| `test_out_of_scope_rows_are_gone_so_no_oracle_form_finds_them` | later slice | Store scope (M1). |
| `test_full_text_on_the_store_table_and_the_view_agree` | later slice | Store views (M1). FTS5 works (D). |
| `test_every_view_accepts_narrow_projections` | later slice | Store views (M1). |
| `test_big_sort_fails_cleanly` | changed | Stopped by the time limit (D). There is no memory limit (see attach row). |
| `test_pre_release_store_with_a_state_table_is_refused_by_readers_too` | dropped | agentbay 4 data is not read (named, Summary and Upgrading). |
