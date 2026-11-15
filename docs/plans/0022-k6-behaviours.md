# K6: kept, changed and dropped behaviours

Every test function in the old adapter and guard test files (`git show main:<path>`), with what K6 did with it. Test names on the right are in `adapters/claude-code/tests/`.

## adapters/claude-code/tests/test_adapter.py

| Old test | Verdict |
|---|---|
| `test_adapter_round_trip` | **Changed.** Kept: build and clean preserve the user's settings, servers and CLAUDE.md, and building twice changes nothing (`build.test.ts` "a build keeps the user's settings...", "building twice changes nothing..."). Changed: one agent per skill step instead of per role (proposal: a role becomes a skill step). Changed: the coordinator protocol sits in the CLAUDE.md block instead of `.agentbay/COORDINATOR.md`. Dropped: copied skills in `.claude/skills` (the agent reads `skillFile` in place) and the catalog (K5's commands show runs). Dropped: the settings allow list of coordinator commands, and the deny rules, because settings rules apply to the whole session (spike B; stage 3 contract); the hook's main-thread rule replaces the deny rules. Changed: the guard matcher is `*` instead of a tool list. Dropped: the `Task\|Agent` dispatch hook (proposal: the ledger becomes the `runs` and `events` tables) |
| `test_clean_removes_files_agentbay_created_and_keeps_formatting` | **Kept**: "a build into an empty project...", "a build keeps the user's settings... exact bytes" |
| `test_build_removes_stale_files_from_previous_build` | **Kept**, with an addition: a stale file the user edited is left in place ("a step that is no longer built...") |
| `test_cli_build_and_clean_on_tmp_repo` | **Changed**: the command line is K5's. `end-to-end.test.ts` builds into a real temporary folder and runs the registered hook command |
| `test_hook_never_fails` | **Changed**: the recording hook (`hook.py`) is gone. The only hook now fails closed ("the hook process denies invalid, empty and oversized input") |
| `test_hook_records_spawn_and_result` | **Dropped**: spawns are no longer recorded by a hook. Runs, steps and task tokens live in `kernel.db` (proposal, Concepts: ledger becomes the `runs` and `events` tables) |
| `test_project_flag_accepted_before_or_after_subcommand` | **Not K6**: command-line parsing belongs to K5 |
| `test_build_twice_then_clean_leaves_an_empty_project_empty` | **Changed**: no files are left ("a build into an empty project..."), but empty folders such as `.claude/agents/` remain, because the file port cannot delete folders. Comes back to the reviewer with the port gap |
| `test_gitignore_is_stable_across_builds_and_kept_while_runtime_data_exists` | **Dropped**: the adapter writes no `.gitignore`, and runtime data under `.agentbay/` is the kernel's. The proposal does not name this drop, so it comes back to the owner (R-5) |
| `test_adapters_are_discovered_by_folder_with_no_registry` | **Dropped here**: an adapter is a TypeScript module exporting `adapter`, and the command line chooses it from `config.adapter` (K5). The proposal replaces `adapter.yaml` and `bay/adapter.py` with the `bay/adapter.ts` contract |
| `test_lint_checks_adapter_manifests_f12` | **Dropped**: there is no `adapter.yaml` (deleted in this slice). `tsc` and eslint check the module against `Adapter` |
| `test_a_bad_adapter_entry_is_reported_and_never_imported_f12` | **Dropped**: no manifests, and adapters use static imports only (lint rule) |
| `test_adapter_modules_are_keyed_by_folder_f12` | **Dropped**: no dynamic module loading |
| `test_cli_build_and_clean_report_a_broken_other_runtime_f12` | **Dropped here**: one adapter per project config (K5) |
| `test_rename_skill_parses_front_matter_as_yaml_and_normalises_crlf_f15` | **Dropped**: skills are no longer copied and renamed into `.claude/skills/`. Skill front matter is parsed by K1's `parseSkill` |
| `test_lint_reports_a_skill_md_whose_front_matter_never_closes_f15` | **Not K6**: skill checks are `bay check` (K1, K2) |
| `test_building_the_kit_into_itself_leaves_git_status_clean` | **Changed, not tested here**: it needs git and the command line. The kit's `.gitignore` ignores `.agentbay/`, `/.claude/` and `/CLAUDE.md` but not `/.mcp.json`, so a build into the kit leaves `.mcp.json` untracked. The fix is outside this slice |

## tests/test_guard_matrix.py

| Old test | Verdict |
|---|---|
| `test_guard_decision_matrix` | **Dropped**: the golden matrix. The proposal names its loss ("the golden guard matrix cannot be reused"), and shell parsing and per-role units go with it. Its decision classes are now allow and deny pairs in `guard-decide.test.ts`: kernel and kit files, `..`, absolute paths, symlinks, case variants, `.env`, `.git`, the config, searches, and generic subagents |
| `test_guard_matrix_for_a_project_with_the_kit_outside` | **Changed**: a kit outside the project stays closed. The tests use kit `/k` outside project `/p` ("agentbay's own files and secrets are closed..."). The use shims and `autoAllowShim` are dropped (proposal), and kernel tools replace them |

## tests/test_guard_7a.py

| Old test | Verdict |
|---|---|
| `test_f2_unparseable_or_quoted_commands_naming_the_config_are_denied_for_a_generic_subagent` | **Changed**: there is no de-quoting. A subagent outside the policy is denied everything ("a subagent that is not in the policy..."). A step can run only listed prefixes, and any quote, backslash, `>` or other character outside the plain set is denied ("every character outside the plain set..."). The main thread's `ls src` still passes |
| `test_f2_a_non_dict_ledger_line_does_not_break_the_plan_check` | **Dropped**: the plan check and the ledger are gone. Approvals are engine steps bound to a hash (proposal, Workflows) |
| `test_f7_adapter_asks_before_bay_approve_variants_and_denies_edits_of_the_owners_config` | **Changed**: no `ask` rules. An approval needs `--hash`, and from chat it also needs `--quote` and `approvals.from` listing `chat` (K5, stage 3 contract). The CLAUDE.md block tells the coordinator to approve only after the owner answers. `agentbay.config.yaml` is closed to every step, but the main thread may now edit it, because the spec's main-thread list omits it. Comes back to the owner |

## tests/test_guard_mainthread.py

| Old test | Verdict |
|---|---|
| `test_main_thread_asks_for_any_spelling_of_the_asked_writes` | **Dropped**: shell parsing and the main thread's asked or pre-approved command list (proposal drops shell parsing; the K6 spec drops the list) |
| `test_main_thread_gives_no_decision_for_reads_and_plain_notes` | **Changed**: the main thread gets no decision for everything except writes into agentbay's own folders ("the main thread may use any tool...") |
| `test_guard_decide_routes_the_main_thread_and_leaves_subagents_denied` | **Kept**: "a subagent that is not in the policy...", "the main thread may use any tool...", "with an unusable policy a subagent is denied..." |
| `test_expansions_later_in_the_line_do_not_ask` | **Dropped**: shell parsing (proposal) |
| `test_main_prints_the_ask_decision_for_the_main_thread_and_for_agent_sessions` | **Changed**: there is no `ask` output. The process prints the documented deny JSON and exits 2, or prints nothing and exits 0 (`step-guard.test.ts`). A session started with `--agent` naming an unlisted agent counts as the main thread; one naming a step agent is confined as that step |
| `test_generated_hook_runs_the_guard_for_the_main_threads_bash_calls` | **Changed**: one entry with matcher `*` and no agent filter runs the guard for every tool of every caller ("the hook entry runs the guard for every tool..."; `end-to-end.test.ts`) |
