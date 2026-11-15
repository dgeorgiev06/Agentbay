# K5 behaviours: the agentbay 4 command line, kept, changed or dropped

Slice K5 of plan 0022 rebuilds the command line (`bay/cli.ts`) and adds the MCP server (`bay/mcp.ts`). This list covers every test function of `git show main:tests/test_cli_commands.py`, the command-line parts of `git show main:tests/test_config.py`, and the approval and secret behaviour of `git show main:bay/cli.py` that no old test named.

## tests/test_cli_commands.py

| Old test | Verdict | Where, how or why |
|---|---|---|
| `test_the_cli_has_about_fifteen_commands_and_no_old_names` | changed | Twelve commands instead of sixteen, from one command table; an old or unknown name exits 2 ("There is no command x."). `tests/command-line.test.ts`: "the command table holds the twelve commands", "an old or unknown command name is a wrong command line". `describe`, `catalog`, `note`, `plan`, `show` and `status` are dropped: `runs`, `config` and the engine's events replace them; `build` and `clean` merge into `build [--clean]`. The plan's Stage 3 contracts name the twelve and the proposal's Limits set `cli_commands` to 12. |
| `test_check_takes_boundary_options_only_with_a_base_and_json_prints_only_the_boundary_json` | changed | `check --json` prints exactly one JSON object (`tests/cli-project.test.ts`, "check prints the summary"; `tests/end-to-end.test.ts`). The boundary options `--base`, `--docs` and `--proposal` are not in `check`: K2's `checkSystem` has no boundary check, and the plan gives the boundary checks to forge (M6) as script steps. The proposal's Safety section still says `bay check --base`; that wording waits for M6. |
| `test_note_task_mints_an_id_and_dispatch_and_review_take_the_task_first` | dropped | Task ids, `note dispatch`, `--unguarded` and the `guard.seen` freshness rule belonged to the ledger and the shell guard. A waiting skill step now carries a task token, and every step, tool call and approval is an event in `kernel.db` (`tests/task-tokens.test.ts`, `tests/tools.test.ts`). The proposal replaces the ledger with the `runs` and `events` tables and drops the guard and per-role units. |
| `test_a_write_verb_must_directly_follow_note_or_show_so_the_ask_rules_match` | dropped | The rule existed because `note` and `show` were pre-approved by command prefix in the guard. Agents get no shell in agentbay 5 and reach the kernel only through the kernel tools with a token, so options may come anywhere on the line (`tests/command-line.test.ts`, "the parser reads options before and after the command"). The proposal drops shell-command parsing. |
| `test_help_after_note_and_show_prints_help_instead_of_being_refused` | changed | Every command prints its usage for `--help` and exits 0; `bay --help` lists the commands (`tests/command-line.test.ts`, "every command prints its usage with --help"). |
| `test_catalog_roles_lists_the_role_units` | dropped | Roles are gone: a role becomes a skill step with a tier. `build` plans one agent per mode and skill instead (`tests/build.test.ts`). The proposal removes `framework/roles/` and per-role units. |
| `test_new_checks_the_options_its_kind_needs` | changed | The kinds are `mode`, `action`, `skill`, `workflow` and `interface`, the K2 generators. `action`, `skill` and `workflow` need `--mode`; `mode` takes `--tier base\|modes`; a missing option, an unknown kind or tier exits 2 (`tests/cli-project.test.ts`, "new writes from the K2 templates"). `feature`, `connector` and `content-type` are gone with those concepts (proposal, Concepts). |

## Command-line parts of tests/test_config.py

| Old test | Verdict | Where, how or why |
|---|---|---|
| `test_config_prints_every_setting_from_the_schemas` | changed | `config` prints every setting of `schemas/config.schema.json` and of each mode's settings schema, with its type, description and current value (`tests/cli-project.test.ts`, "config prints every setting"). Environments and connectors are gone, so their sections are too. |
| `test_build_writes_a_minimal_config_and_keeps_an_existing_one` | dropped | `build` writes no project config. A missing config is a registry problem that names the fix (bindings and adapter). The proposal's Upgrading section says the config is written by hand. |

## Behaviour of bay/cli.py that no old test named

| Behaviour | Verdict | Where, how or why |
|---|---|---|
| `approve` from a terminal needs an interactive stdin and a typed `yes` | kept | `tests/cli-owner.test.ts`, "approve from a terminal needs an interactive stdin and a typed yes"; the stdin check is the `Terminal` port. |
| `approve --via chat --quote` only when `approve.from` lists chat; `--quote` only with chat; the quote is recorded | kept, renamed | The setting is `approvals.from` (Stage 3 contracts). The channel and quote go into the approval's `by` and so into the `approval.recorded` event. A terminal approval is refused when `approvals.from` leaves terminal out, as before. `tests/cli-owner.test.ts`, `tests/end-to-end.test.ts`. |
| `approve --sha` with an 8-digit prefix | changed | `approve` always needs `--hash`, the full SHA-256 the waiting approval shows; a wrong hash is refused by the engine. |
| `secret set` reads only from an interactive stdin | changed | `bay` reads no secret at all now: on macOS `secret set` prints the one `security add-generic-password -U -s agentbay -a <NAME> -w` command for the owner to run, which prompts for the value itself; elsewhere it says how to set `AGENTBAY_SECRET_<NAME>` and exits 1. `secret check` is new. `tests/cli-owner.test.ts`. |
| `auth <connector>` runs a connector's browser login | not built yet | Registered; prints "not built yet (comes with the M2 slice)" and exits 1. |
| `status` shows stale runs and the guard's state | dropped | `runs` lists every run newest first with what it waits for; the guard is gone. |
