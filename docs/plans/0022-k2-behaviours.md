# K2: kept, changed and dropped behaviours

Slice K2 of plan 0022 (`bay/check.ts` and its parts, `bay/new.ts`, `bay/templates/`). One line per test function of the old files named for the slice, read with `git show main:tests/<file>`; the old code read is `bay/lint.py`, `bay/limits.py`, `bay/scaffold.py` and `bay/playbook.py`. "Named" means the proposal names the drop. "Owner" means it does not, and the drop goes back to the owner (plan, R-5). "Later slice" means the behaviour is not lost but is not K2's, and the slice that owns it is named.

New tests: `tests/check.test.ts` (C), `tests/check-skills.test.ts` (SK), `tests/check-layout.test.ts` (L), `tests/check-imports.test.ts` (I), `tests/check-limits.test.ts` (LI), `tests/new.test.ts` (N).

## tests/test_lint.py

| Old test | Verdict | Where, how or why |
|---|---|---|
| `test_shipped_kit_is_lint_clean` | changed | C "a valid system with complete skills, examples and limits passes with no findings", on a fixture instead of the shipped kit. The shipped modes are agentbay 4 files until the mode slices rewrite them; each mode slice must leave `bay check` clean (plan, DOD-10). |
| `test_missing_section` | kept | SK "a missing section is reported by name with the full order". The six playbook sections become the seven skill sections (named, Concepts: Playbook row; The skill contract). |
| `test_sections_out_of_order` | kept | SK "a section out of order is reported with the section it follows", with its line. |
| `test_steps_must_be_numbered` | dropped (owner) | The proposal checks Instructions only with "a length cap" (SK "Instructions over 150 lines are reported with the cap"). Numbered steps are not required; the proposal does not name the drop. |
| `test_dod_item_format_and_unique_ids` | kept | SK "a Definition of done item in the wrong form is reported with its line" and "a Definition of done id used twice is reported with the line of its first use". The old "no checklist items" rule is kept too: SK "a Definition of done with no items is reported". |
| `test_rules_schema_and_unique_ids_and_refs` | dropped / later slice | `rules.yaml` files are gone: rules are the skill's "Rules and constraints" section (named, Concepts: Playbook and rules file row), checked present and not empty (SK "an empty Rules and constraints section is reported"). Named checks become script paths under a skill step's `checks:` (K4). |
| `test_a_file_a_feature_names_must_exist` | kept (K1) | The registry reports every file a manifest names that does not exist; `bay check` passes those problems through (C "registry problems, skill problems and layout problems are all reported at once"). |
| `test_a_reference_to_a_deleted_file_is_refused_in_every_group` | changed | Schema, script, skill and workflow references: registry (K1). Imports of kernel or adapter files: `bay check` checks where an import resolves (I), and `tsc` that the file exists. Coordinator playbooks and `$ref` content-type schemas are gone with coordinators and content types (named, Concepts). |
| `test_a_feature_that_runs_an_agent_needs_a_playbook_and_a_code_only_one_needs_no_files` | changed | A skill step names its skill folder; SKILL.md must exist (K1) and pass the skill contract (SK). An action of script and call steps needs no skill file. |
| `test_agent_text_nothing_reads_and_unread_manifest_keys_are_refused` | changed / dropped | Unread manifest keys: refused by the closed mode schema (K1). Agent text nothing reads: a skill folder no step names is still checked against the contract (SK "a skill folder that no step names is checked too") but is not refused (owner: not named). Composition across modes through envs, connectors and `composes:` is dropped (named, Concepts: composition through interfaces); mode code that reaches another mode's files is refused (I "mode code importing another mode's file"). |
| `test_review_settings_only_in_mode_yaml` | dropped | Review is a skill like any other; there are no review settings (named, Concepts: Role row). |
| `test_review_role_must_exist_and_be_in_the_mode` | dropped | Roles are removed (named, Concepts). |
| `test_role_env_errors_name_mode_feature_and_step` | dropped | Roles and environments are removed (named, Concepts). |
| `test_a_user_space_role_is_an_error` | dropped | Roles are removed, and `framework/roles/` with them (named, Concepts and front matter). |
| `test_an_offline_env_with_a_network_host_or_a_secret_is_refused` | dropped | Environments are removed (named, Concepts); offline becomes binding a fake mode (K1 list). |
| `test_a_config_that_raises_an_env_limit_is_refused_and_one_that_lowers_it_passes` | dropped / later slice | Environment limits go with environments (named). Budgets are enforced by the engine (K4); whether a project budget may raise a mode's is the open owner question in the K1 list. |
| `test_forge_extend_review_and_standards_cannot_be_disabled_or_weakened` | later slice | Forge's `extend` becomes a workflow with review and checks as steps (M6). `bay check --base`, which rejects a kernel change no approved proposal lists (proposal, Safety), is not in K2's brief and is not built here (owner: which slice builds it). |
| `test_kind_scoped_rules_are_linted` | dropped | Rules files and `when.kind` go with rules files and content-type kinds (named, Concepts). |
| `test_a_protected_name_is_reserved_and_defined_once` | changed / owner | Defined once: K1 refuses two modes of one name; N "newMode refuses a name that exists in either tier, a folder that exists and a bad name" refuses a new mode whose name is taken in either tier, including `interfaces`. The `protected:` map in `framework/kernel.yaml` is dropped: the kernel changes only through forge, enforced by broker paths and `bay check --base` (named, Safety). Owner: the old scaffold refused to add a feature to a base mode; `bay new action` adds to any mode, since `bay new` is run by the owner, not by an agent. |
| `test_modes_must_not_name_connectors_or_tools` | changed | Connectors are gone (named, Concepts). What a skill may call is checked against the manifest instead: SK "a tool that is neither an action, a required interface action nor a declared resource is reported". |
| `test_orphan_feature_folder` | changed | A `features/` folder is refused by the mode-folder layout (L "an entry the mode-folder layout does not name is reported once per entry"); a skill folder without SKILL.md is refused (L). |
| `test_check_cli_runs_lint` | later slice | `bay check` on the command line is K5. Its text is `summarizeCheck` (C "the summary groups findings by file, errors first, each with its fix, and ends with the counts"). |
| `test_extra_rules_stack_strictest_wins` | dropped (owner) | Per-feature `extraRules` in the config are gone; the closed config schema refuses the key (K1). Not named in the proposal. |
| `test_feed_source_connectors_must_declare_source_and_window` | dropped / later slice | Connectors become modes that implement `items-source` (named, Concepts); what a source declares is the interface's design (M1, M2, M3). |
| `test_schedule_is_a_warning_not_an_error` | changed / owner | Warnings exist again as a severity (commands, limits; C, LI). A workflow `trigger: { schedule }` is valid in the schema and nothing runs it in 5.0.0 (background daemon out of scope, named), but `bay check` does not warn about it; owner: whether it should. |
| `test_run_steps_use_versioned_capability_spelling` | kept (K1) | The mode schema's `call` pattern (`interface.action`) refuses other spellings. |
| `test_same_skill_name_in_two_modes_is_fine_b8` | kept | SK "two modes may each have a skill of the same name". |
| `test_unknown_skill_reference_fails_lint_b8` | changed | Prose is not scanned for skill names: a skill is named only by a skill step, whose folder must exist (K1). What a skill may call is listed under Tools and checked (SK). |
| `test_skill_name_over_64_characters_fails_lint_b8` | dropped / later slice | The 64-character cap came from the runtime's namespaced skill names; any such cap belongs to the adapter (K6). The skill schema sets no length (owner: not named). |
| `test_skill_references_match_any_case_and_the_skill_x_f8` | dropped | Goes with prose scanning (see `test_unknown_skill_reference_fails_lint_b8`). |
| `test_skill_references_count_only_backticked_or_known_names_n4` | changed | Goes with prose scanning; a Tools or Resources entry may be written in backticks, which are taken off (SK tool tests use `` `items-store.put` ``). |

## tests/test_limits.py

| Old test | Verdict | Where, how or why |
|---|---|---|
| `test_limits_count_the_ceiling_the_ratchet_and_the_exception` | changed / dropped / later slice | Counting is kept for the new measures of the proposal's Limits table (LI "each measure over its ceiling is a warning that gives the count and the ceiling"). Over a ceiling is now a warning, not an error, by owner decision of 2026-11-14; `comment_lines` over 0 stays an error (LI "comment lines in kit code are an error naming each file and line"). Comment lines are counted on `.ts` as today: a trailing comment counts, a `//` in a string or regular expression does not (LI comment tests). A file that does not parse no longer stops the count: the lexer never fails. The `framework/kernel.yaml` dependency is dropped (the measures no longer read it). The ratchet (a raised ceiling needs a proposal exception), the exception and `--write` lowering are not built: ceilings only fall after cutover (proposal, Limits), so they come back with C1 (owner: which slice). `sdk_exports` and `long_lines` are left out until cutover; `cli_commands` has a ceiling but is not measured until `bay/cli.ts` exists (K5). |

## tests/test_core_names.py

| Old test | Verdict | Where, how or why |
|---|---|---|
| `test_names_are_found_not_listed` | dropped | Content types and connectors are gone (named, Concepts). |
| `test_no_core_file_names_a_content_type_or_a_connector` | changed / owner | The new rule is that no kernel file names a runtime (plan, weaknesses table; DOD-9). It is kept by review, not by `bay check`: K2's brief does not ask for a scan, and none is built (owner: whether `bay check` should scan `bay/` for runtime names). |
| `test_the_rule_counts_identifiers_and_literals_but_not_prose` | dropped | Goes with the names scan above. |
