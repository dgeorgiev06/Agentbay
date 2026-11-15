# K1: kept, changed and dropped behaviours

Slice K1 of plan 0022 (schemas, generated types, `bay/spec.ts`, `bay/ports.ts`, `bay/registry.ts`). One line per test function of the old files named for the slice, read with `git show main:tests/<file>`. "Named" means the proposal names the drop. "Owner" means it does not, and the drop goes back to the owner (plan, R-5). "Later slice" means the behaviour is not lost but is not K1's, and the slice that owns it is named. "Reviewer decision" means the drop was decided by the owner's reviewer on 2026-11-14: budgets cover spend, and the other items have no counterpart in the new design.

New tests: `tests/registry.test.ts` (R), `tests/spec.test.ts` (S), `tests/generate-types.test.ts`, `tests/node-ports.test.ts`, `tests/fakes.test.ts`.

## tests/test_resolver.py

| Old test | Verdict | Where, how or why |
|---|---|---|
| `test_shipped_kit_resolves` | changed | R "a valid three-mode system resolves with every required interface bound", on a fixture in the fake file system instead of the shipped kit, whose manifests the mode slices rewrite. Step kinds code/role/review become script/skill/call. Units, `bay_uses` and the agent profile are dropped: roles and agent profiles are removed (named, Concepts). |
| `test_tier_resolution_step_over_feature_over_role_mapped_by_the_profile` | changed / dropped | The tier is set on each skill step and is required there (`schemas/mode.schema.json`; S "a step is checked against the kind its first field names"). Feature- and role-level tiers and their precedence are dropped with roles (named, Concepts). Tier to model is the adapter's table (named; K6). The reload of a changed YAML file by mtime is dropped: K1 has no cache, every load reads the file (owner: not named, but nothing is cached to go stale). |
| `test_env_tier_cap_names_mode_feature_step_role_env_and_tier` | dropped | Environments are removed (named, Concepts). Per-environment tier caps are dropped by reviewer decision of 2026-11-14. |
| `test_unbound_capability` | kept / dropped | Kept: R "a required interface that is not bound is reported with the modes that could serve it", with the fix `Add notes: <mode> under bindings`. Dropped: optional capabilities (`needs.optional`); `requires.interfaces` has no optional form (reviewer decision of 2026-11-14). |
| `test_effect_not_allowed_by_env` | dropped | Environment effect allow-lists go with environments (named, Concepts). Effects are now declared per action and checked against calls and interfaces (R effect tests). |
| `test_effect_not_declared_by_endpoint` | kept | R "a call whose target has an effect the calling action does not declare is reported" (proposal: "a `call` may not have an effect its caller lacks"). |
| `test_unknown_role_env_and_agent_profile` | dropped | Roles, environments and agent profiles are removed (named, Concepts). An unknown `adapter:` name in the config is not checked in K1, because no adapter registry exists before K6 (later slice: K5 or K6). |
| `test_connector_needs_exceed_env` | dropped / later slice | Connectors become small modes with their own `resources:` (named, Concepts), so there is no environment to exceed. Hosts, secrets and paths are enforced by the broker and policy (K3). |
| `test_unknown_connector_and_wrong_interface` | changed | R "a binding to a mode that does not exist is reported" and R "a binding to a mode that does not implement the interface and major version is reported". |
| `test_coordinator_must_run_in_main_thread` | dropped / later slice | Coordinators and runtimes are not kernel concepts: only adapters name a runtime (plan, weaknesses table). Whether the root mode's steps run in the main session is K6's (owner: not named as a drop). |
| `test_all_gaps_reported_at_once` | kept | R "every problem is reported at once, not only the first"; S "every schema problem in a file is reported at once"; R "a manifest that fails its schema is reported with its line, and checking goes on". |
| `test_wrong_kind_is_rejected` | changed | There is no `apiVersion`/`kind`: a file of the wrong shape fails the mode schema (R "a manifest that fails its schema"). The `agentbay/v4` kinds are dropped (named, Safety). |
| `test_forge_create_cannot_be_placed_in_framework_writing_env` | later slice | Becomes "the kernel changes only through forge": `bay check --base` (K2) and the broker's file permissions (K3), with forge's `extend` (M6). Not K1. |
| `test_user_mode_cannot_write_framework` | later slice | Same as above: a mode's `resources.files.write` into a kernel folder is refused by check and broker (K2, K3). Not K1. |
| `test_feature_review_block_resolves_to_existing_placeable_reviewer` | dropped | Review is a skill like any other (named, Concepts: Role row). There is no review block to resolve. |
| `test_offline_switch_rebinds_the_source_and_closes_network_and_secrets` | changed / dropped | The offline switch is replaced by binding an interface to a fake mode in `bindings:` (named: "each ships a fake for tests"). The old config keys are refused by the closed config schema (S "a config key of agentbay 4, such as offline, is refused by name"). The `apiVersion` migration message is dropped: agentbay 4 files are not read (named, Summary and Upgrading). `approve.plans` becomes the workflow `approval` step (named, Concepts). |

## tests/test_config.py

| Old test | Verdict | Where, how or why |
|---|---|---|
| `test_config_prints_every_setting_from_the_schemas` | changed / later slice | Per-mode settings are kept in a smaller form: a mode declares `settings: <JSON Schema file>`, the project config gives `settings: { <mode>: {...} }`, and the registry validates each mode's entry (an absent entry as `{}`) and exposes it as `LoadedMode.settings` (R settings tests). Settings for an unknown mode or a mode with no settings schema are reported. Per-connector settings go with connectors (named, Concepts). Listing every setting is `bay config` (K5). |
| `test_build_writes_a_minimal_config_and_keeps_an_existing_one` | changed / later slice | Writing the config is `bay build` or `bay new` (K2/K5). K1 reports a missing config as a problem that says what to put in it (R "a missing project config is reported with what to put in it"). |
| `test_caps_take_the_strictest_and_refuse_a_setting_above_the_env_limit` | changed / later slice | Caps become budgets (`items`, `usd`, `tokens`, `minutes`) on actions, workflows and the config default; the schemas are K1's, enforcement is K4. Owner: whether a project budget may raise a mode's budget, which the old rule refused, is not stated. |
| `test_the_old_price_key_is_refused_by_the_schemas_with_no_alias` | changed | Unknown keys are refused by every closed schema (S "a config key of agentbay 4 ... is refused by name"; R manifest schema test). `costPerItemUsd` itself is dropped by reviewer decision of 2026-11-14: budgets cover spend. |
| `test_a_call_with_a_raised_cap_fails_the_step_and_does_not_run_the_connector` | later slice | The engine enforces budgets for every run (K4). |
| `test_lint_reports_a_missing_readme_and_a_bad_fragment` | dropped | Connectors and `config.example.yaml` fragments are gone (named, Concepts). The README check is dropped by reviewer decision of 2026-11-14. |

## tests/test_inheritance.py

`extends:` inheritance is removed (named, Concepts: "Removed. The briefings and todo compose the store through its interface").

| Old test | Verdict | Where, how or why |
|---|---|---|
| `test_a_store_mode_with_no_source_resolves_adds_and_reads` | changed | Composition through an interface resolves: R "a valid three-mode system" has `notes` composing `store` through `items-store@1`. Adding and reading items at run time is the store's own tests (M1). |
| `test_child_overrides_review_steps_roles_and_inherits_the_rest` | dropped | `extends:` (named). |
| `test_a_child_feature_is_never_merged_key_by_key_with_its_parents` | dropped | `extends:` (named). Every action is complete in its own manifest: `input`, `output`, `effects` and `run` are required (R manifest schema test). |
| `test_child_can_add_its_own_feature_and_type` | dropped | `extends:` (named). A mode's own actions and schemas are the normal case (R valid system). |
| `test_missing_parent_and_cycles_are_errors_naming_the_fix` | changed | An `extends` cycle becomes a dependency cycle through bindings (R "a dependency cycle between modes through bindings is reported and named"); a missing parent becomes a required interface that does not exist (R "a required interface that no file defines"). |
| `test_raw_child_may_be_partial_but_the_merged_mode_must_be_complete` | dropped | `extends:` (named); there are no partial manifests. |
| `test_abstract_base_is_linted_not_installed` | dropped | No abstract modes (named with `extends:`). Playbook checks become the skill's seven sections (K2); `parseSkill` gives K2 the headings (S SKILL.md tests). |
| `test_lint_lines_of_inherited_parts_point_at_the_parent_mode_yaml` | changed | Problems carry the line of the field in the file that holds it (S "a valid manifest ... knows the line of each field", S YAML and front matter line tests, R line assertions). Mapping lines of inherited parts goes with `extends:` (named). |
| `test_child_sets_config_defaults_instead_of_copying_the_config_schema` | changed | `extends:` is removed (named). A mode now owns its whole settings schema (`settings:` in its manifest, R settings tests); defaults come from that schema, not from a parent. |
| `test_child_config_schema_extends_its_parents` | dropped | `extends:` (named): a settings schema has no parent to extend, redefine or collide with; each mode's schema is complete (R settings tests). |
| `test_redefining_a_parent_config_key_is_a_lint_error` | dropped | `extends:` (named): a settings schema has no parent to extend, redefine or collide with; each mode's schema is complete (R settings tests). |
| `test_child_config_schema_defs_collision_and_other_keywords_are_errors_f13` | dropped | `extends:` (named): a settings schema has no parent to extend, redefine or collide with; each mode's schema is complete (R settings tests). |
| `test_child_config_schema_type_and_additional_properties_must_equal_the_parents_n5` | dropped | `extends:` (named): a settings schema has no parent to extend, redefine or collide with; each mode's schema is complete (R settings tests). |

## tests/test_contract_versions.py

| Old test | Verdict | Where, how or why |
|---|---|---|
| `test_shipped_modes_and_connectors_declare_versioned_kinds` | changed / dropped | Interfaces are referenced as `name@major` (schema pattern; S "an interface reference without its major version is refused"). `reads`/`produces` of item kinds are dropped: a content type is a schema and views inside the mode that owns the data (named, Concepts). The shipped manifests are the mode slices'. |
| `test_unversioned_and_unknown_names_are_refused` | kept / dropped | Kept: an unversioned interface reference is refused (S, as above), and an unknown one too (R "a required interface that no file defines ..."; R "a mode that implements an interface that does not exist"). Dropped: unknown item kinds, with `reads`/`produces` (named, Concepts). |
| `test_version_mismatch_and_missing_producer_are_refused` | changed | A binding to a mode that does not implement the required major is refused (R "a binding to a mode that does not implement the interface and major version"); a required major that does not exist names the versions that do (R "... (found: notes@1)"). Producers of item kinds are dropped (named, Concepts). |
| `test_no_extension_names_another_b7` | changed | One mode importing another mode's files is refused by eslint `no-restricted-imports` (added in K1, `components/base/typescript/eslint.config.js`; shown on samples in the K1 report). The old check also flagged a connector naming another connector in prose or comments; that text check is dropped by reviewer decision of 2026-11-14. |
| `test_b7_catches_case_module_forms_nested_tests_and_referenced_files` | changed | Relative imports into another mode are refused at any folder level up to six (eslint); dynamic `import()` is already refused in mode code (S0's rule); a manifest path cannot leave the mode folder because `..` and absolute paths fail the schema's path pattern. Python module-key forms do not exist in TypeScript. Case-folded name mentions in prose are dropped by reviewer decision of 2026-11-14. |
| `test_mixed_versions_of_a_read_kind_are_refused_f7` | dropped | Item kinds and their producers are gone (named, Concepts); one binding names one mode per interface, so two sources cannot be bound to one interface at once. |
