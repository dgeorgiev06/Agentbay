# Plan 0010: one folder per component (slices 0-3)

Proposal as amended in ce20436. The move table, limits and slices are the proposal's and are not repeated here. Branch feat/0010-component-layout from ce20436. There are thirteen builder parts, in order.

Every part ends with `python3 tests/run.py -q` green and `./bay.sh check` clean, quotes `./bay.sh check --limits` (bay_lines, kit_python_lines and tests measured), and commits. The one exception is 1b, which hands its uncommitted tree to 1c. Until 0a lands, the suite has one known failure: `test_improve_golden`, where doc-stale is 2 against the delta's 1. No file in a `golden/` folder is edited by hand; a changed golden is a named delta in its test.

## Front matter, as bay/proposal.py reads it

`front_matter()` yields `id: "0010"` (a string because it is quoted; unquoted, YAML 1.1 reads it as octal 8), 35 `touches` and 2 `exceptions`. Every touch has a string `path` and `reason`, and `limits._exceptions` accepts `schemas: 16` and `tests: 540`. There is no `depends`. No code reads `id` or `depends`, here or in 0011 and 0012, so nothing enforces the order 0010 -> 0011 -> 0012. A plan is needed: the proposal has 10 or more touches, has exceptions, and touches guard.py, boundary.py, cli.py, adapters/ and schemas/.

## Slice 0

**0a. doc-stale skips plans** (5 turns). Add `"docs/plans/"` to `HISTORY_DOCS` in `connectors/improve-detect/detect_artifacts.py:26`. That makes `test_improve_golden` green again. If the one stale doc the delta still counts is plan 0008, that count drops too, and the delta's `now` and `why` say so. 0 lines.

**0b. framework-dev write list** (10 turns, a protected-path write). Add `modes`, `connectors`, `envs`, `content-types`, `coordinator`, `components` and `README.md` to `fs.write` in `envs/framework-dev.yaml`. They are added as whole folders, because lint refuses an unprotected instance name in fs.write (lint.py:910-915). Test: none; lint stays clean. Then the coordinator asks the owner to run `./bay.sh build`, so that the guard policy carries the new list before any builder edits through it.

**0c. Rename-aware deadcode** (25 turns).
- In `pipeline.change`, a helper reads `git diff -M --name-status -z <sha>` (the working tree against the base, staged renames included). Before fingerprinting each base finding, it rewrites the renamed path inside the finding's `detector.key` (for example `fn:<path>:<name>`).
- Budget: at most 8 lines.
- Payers: drop the `iso()` copies in `pipeline.py:34` and `improve-store/store.py:50` and import `bay.util.iso` (about -8). The builder first checks that every caller passes an aware UTC datetime, because `util.iso` calls `astimezone` and would shift a naive value.
- Test: +1, `tests/test_deadcode_check.py::test_a_finding_in_a_renamed_file_is_not_new`.

**0d. bay_lines payers** (25 turns).
- Connector login moves from `bay/cli.py` into `bay/connect.py`, dropping cli's copy of connect's limits.
- `lint._mode_envs` folds into `model.mode_envs`. Lint's version also collects step-level roles, so `model.mode_envs` gains them, and every caller is checked to accept the extra envs.
- Tests: the existing `test_auth`, `test_cli_commands`, `test_protection` and `test_lint`. Count unchanged.

**0e. Reference check** (30 turns). `bay/lint.py` gets one `lint_references` covering:
- the adapter-run scripts;
- each mode's coordinator playbook, resolved through `md.dirs` (feed-briefing inherits once 0g removes its own);
- data schemas named by `$ref`;
- feature in and out types.

The declared-playbook check at lint.py:101-103 becomes part of it. `model.py:1023` stops reading a missing playbook as `""`. Test: +1, a table-driven `test_lint` case that deletes one target per group. Budget +30.

**0f. Two T2 rules and their offenders** (owner-approved plan T-20261101-8f30; rule 2 moved to 0012, 0g merged in). Commit A removes the 12 unreachable files (briefing sync playbook and rules, the three cos playbooks and rules, improve backlog and verify playbooks and rules) and their `mode.yaml` lines, drops `policies` from `schemas/mode.schema.json`, the four mode.yaml files and the mode template, and does b17 (extend's playbook states each fact once; R-2, R-4, R-7 and R-9 go; R-11 and R-12 keep `refs:`). Commit B adds rule 1 (playbook or rules on a feature with no role or review step) and the schema refusal for unread keys, one table-driven `test_lint` case, and same-behaviour payers in `bay/lint.py` (net -2 bay lines). Tests 538 to 539. Also rows a10, a12-a16, a19.

## Slice 1

**1a. agentbay/v4** (40 turns, done like 0008 part 3b). Change every manifest and extension schema `const`/`$id`, plus the refusal message in `model.schema_errors`. `config.schema.json` and `event.schema.json` stay at v3. The tree is red mid-part, so the part is one commit. Test: extend the refusal loop in `test_resolver.py` with a v3 mode and env.

**1b. Move and loader** (45 turns, ends uncommitted). Run one `git mv` per table row, plus `framework/components.yaml` -> `kernel.yaml`; the owner answers each prompt. Then the code:
- `model.py`: one kind-to-manifest table, the `Component` kind, internal connectors at `components/*/connectors/*/`, and `data_schema` under `components/*/data/`.
- `contenttypes.py`: FOLDER goes and the loader is used instead.
- `conformance.py:298`: reads `adapters/claude-code/commands`.
- `config.py` and `rules.py`: path strings.
- `scaffold.py`: targets under components/, templates at `bay/templates/`.
- `graph.py`, `cli.py` and the adapter: skills as `<component>--<skill>`.
- `tests/run.py` and the `limits.py` regex and kit filter: `components/**/tests` and `adapters/*/tests`.
- Lint: refuse leftover old folders.
- `kernel.yaml`: old lists, paths rewritten.
- New: `schemas/component.schema.json` and `components/tools/component.yaml`. `limits.yaml` `schemas` goes to 16 by hand (the exception).

If the builder reaches turn 50, it lists what is left.

**1c. Tests, goldens, commit** (40 turns).
- `tests/layout.py`: new paths, with an owner table for envs.
- The 9 moved tests: imports and golden paths.
- Named path deltas: improve.json in `test_improve_golden` (10 paths), stages.json in `test_stage_syntax` (23), guard-matrix*.json in `test_guard_matrix` (186).
- `test_limits` asserts that the `tests` count equals the `def test_` total of `run.files()`.
- Doc path strings; `fs.write` drops the five old folders.
- Commit 1b and 1c together. Then the coordinator asks for `./bay.sh build`.

## Slice 2

**2a. Protection from manifests** (35 turns).
- `protected` goes into the four schemas and onto cos, forge, the nine connectors and the six envs.
- `model.load_protection` builds `Protection` from the loader, plus every component's `interfaces/` folder by convention. An unreadable manifest protects its whole folder.
- `boundary.py`: `Protection.parse`, `_names`, `_folder` and the map's protected parsing go. The `Protection` class stays, because `improve-store/store.py:23` imports it.
- `kernel.yaml` loses `protected:`.
- `lint_protection`: the existence check goes, the closure stays, and the fs.write sync is computed. Scaffold's sensitive-path list is derived.
- `guard.py` keeps reading guard.json (a stdlib hook); only its messages change.
- Tests: rewrite the two malformed-block tests in place for an unreadable manifest, and delete `test_boundary::test_a_base_map_without_protected_is_an_error`. A `protected:` field edit joins `test_an_edit_to_a_protected_component_without_touches_fails_check_base`. Net -1.

**2b. layout.py goes** (20 turns). `test_protection.py:47` pins the expected protected paths written out in the test. The five other importers read `kit.protected_paths`, and `physical()` becomes a loader lookup in `test_guard_matrix`. Then `./bay.sh build`.

## Slice 3

**3a. Boundary** (30 turns). The `Contract`/`at:` matching gives way to the loader's component folders, and `kernel.yaml` keeps only `owns:`. Test: extend `test_boundary.py`.

**3b. Limits and placement** (30 turns).
- `component_spread` in `limits.py`, and a base file may lack a measure.
- `limits.yaml` gains `component_spread: 1`, and `tests` goes to 540 if the count needs it.
- The placement lint (decision 7).
- Test: +1 `test_limits` case; the placement rule joins the 0e table. Budget +20.

**3c. Docs** (35 turns). README, DESIGN (with the B-1..B-12 table in the safety model), INTERFACES (row b18) and the C-7 vocabulary. Changelog, version and `--write` belong to release.

## Cost against each ceiling

| Measure | Now (= ceiling) | After | How |
|---|---|---|---|
| bay_lines | 9618 | about 9611 | 0e +30, 0f +15, 1b +8, 3b +20, 2a -45, 3a -10, 0d payers about -25 (login -17, mode_envs -7). A part over its budget trims in that part. |
| kit_python_lines | 6584 | ≤ 6584 | 0c rename-aware ≤ +8 against iso payers -8. The move adds none. |
| cli_commands | 16 | 16 | No command. |
| framework_folders | 3 | 2 | At release. |
| top_level_folders | 11 | 7 | At release. |
| schemas | 15 | 16 | Exception; raised in 1b. |
| tests | 536 | 539 (≤ 540) | 0c +1, 0e +1, 0f +1, 2a -1, 3b +1. Every other change extends a test. |
| component_spread | none | 1 | 5 today; added in 3b. |

**Recount.** `tests: 540` holds for 0010 alone with 1 to spare, because only the rename test was added since the first count. `bay_lines` closes only with the part budgets above. The estimate is about +73 gross against about -80 of cuts and payers, so a 0e or 0f overrun has to be paid inside its own part.

**kit Python payers.** Of the three candidates, only iso() fits; the other two are rejected:
- iso(): same behaviour, about -8 lines.
- The corpus-store pre-release branch (corpus_store.py:187-191) is not same-behaviour. It is a fail-closed refusal marked "kept on purpose", and its tests would go with it. It stays in 0012.
- The dead `fixed` status saves no lines (it is a tuple member in five places) and changes the finding-status enum.

If 0c needs more than 8 lines, the next same-behaviour candidate is row a17 (merge git_episodes.py into git_history.py, about -8). It is a 0012 row, so taking it means moving it into 0010, as b12 and b13 were. Without it, the remaining option is a `kit_python_lines` exception.

## Risks (security first)

- **The write list widens itself.** In 0b, framework-dev widens its own `fs.write`. The owner reads that diff before the build that activates it, and 1c removes the old folders again.
- **The protected list changes shape.** The policy goes from 21 paths to 19. Instances nested in cos and forge collapse into their folders, and the `interfaces/` folders of briefing, improve and tools are added. The guard-matrix delta asserts that list. Between a move commit and its build, guard.json still names the old paths, and `stale_policy` reports it.
- **Rename-aware matching.** It must rewrite the path only where a key contains one. A wrong rewrite hides a new finding, so the 0c test also needs a new finding in a renamed file to stay new.
- **Test discovery.** If run.py and the limits regex diverge, the count drops without anyone noticing; 1c's assertion guards against that. Moved tests import from tests/. That works under run.py; under pytest it needs `tests/conftest.py`, which stays until 0012.
- **Goldens.** 219 path strings change. They change only as named rewrites, never by regenerating a golden.
- **apiVersion v4.** It refuses every unmoved user extension. Config and the ledger are unaffected.
- **`mode_envs` fold.** The fold widens `model.mode_envs` to step-level roles, and its resolver callers see more envs.
- **Self-reference.** 0f, 0g and 1b edit and move forge.extend's own playbook and rules during this call. Later steps read them at their new paths only after a build.

## Where the builder needs the owner

- **Builds.** `./bay.sh build` after 0b, 1c and 2b; the coordinator asks.
- **Prompted git commands.** Every `git mv` and `git rm` (0g, 1b, 2b).
- **Protected paths.** Writes to `envs/framework-dev.yaml`, `framework/`, `schemas/` and `bay/` are allowed to framework-dev but sit on protected paths. The owner sees them through the gate and review.
- **Open choice.** If 0c's measured `kit_python_lines` exceeds 6584: move row a17 into 0010, or grant an exception. This is the one open choice.
