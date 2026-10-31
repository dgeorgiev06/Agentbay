# Plan 0010: one folder per component (slices 0-3)

Branch feat/0010-component-layout from d8423e5. The proposal is the spec: its move table (decision 5), limits (decision 6) and slices (decision 9) are not repeated here. Nine builder parts, in order. Each part ends with `python3 tests/run.py -q` green and `./bay.sh check` clean, quotes `./bay.sh check --limits` (bay_lines and tests measured), and commits. The one exception is 1b, which leaves the tree uncommitted for 1c (see 1b). Builders run only their own test files while working and batch Read and Edit calls. No file in any `golden/` folder is edited by hand; a changed golden is a named delta in its test, because the golden reset belongs to 0012.

## Front matter, as bay/proposal.py reads it

`front_matter()` gives two keys, `touches` (25 entries, each with a string `path` and `reason`, so `touches()` accepts them) and `exceptions` (`schemas: 16`, `tests: 540`; `limits._exceptions` accepts both). The line-2 `#` comment is ignored. **0010 has no `id` and no `depends` key.** The quoted `id: "0011"` and `depends: "0010"` sit in 0011 and 0012. Quoting `id` is right: unquoted, YAML 1.1 reads `0011` as the octal number 9. `depends` is a comma string, not a list, and no code in bay/ reads `id` or `depends`, so the order 0010 -> 0011 -> 0012 is enforced by nobody. A plan is needed under `approvals.plan: large`: the proposal has 10 or more touches, has exceptions, and touches guard.py, boundary.py, cli.py, adapters/, framework/components.yaml and schemas/.

## Slice 0: every reference resolves, and the T2 rules

**0a. Reference check** (about 30 turns). `bay/lint.py`: one `lint_references` covering the four groups decision 9 names. (1) The adapter-run scripts that adapters/claude-code writes into settings (hook.py, guard.py, use_shim.py, graph.py). (2) Each mode's coordinator playbook, resolved through `md.dirs`, so feed-briefing passes once its own file is gone in 0c (inheritance). (3) Data schemas named by `$ref` (`model.data_schema`). (4) Feature `in`/`out` types. The existing declared-playbook check (lint.py:101-103) becomes part of this check, not a second one. `bay/model.py:1023`: a missing playbook stops being read as `""`. Test: +1 table-driven `test_lint` case that deletes one target per group in a scratch kit and expects the named refusal.

**0b. T2 rules** (about 25 turns). `bay/lint.py`: lint refuses (1) a `playbook.md` or `rules.yaml` on a feature with no role step, and (2) a rule with `refs:` and no `check:` that is not `appliesTo: reviewer`. Unread keys become a schema refusal, not lint code: `schemas/mode.schema.json` drops `policies` (it is already `additionalProperties: false`). Remove `policies:` from forge, delivery, improve and briefing mode.yaml and from the forge mode template. Test: +1 `test_lint` case, one fixture per rule. Rule (2) also catches extend's R-11 and R-12 (refs DOD-7, no check). 0b drops their `refs:`; it does not delete them.

**0c. The offenders** (about 20 turns, no bay/ code). `git rm` the files of rows a10, a12-a16, a19, a20, a24 and a25, and remove the `playbook`/`rules` lines that declare them. b17: trim `modes/forge/features/extend/playbook.md` to state each fact once, and delete R-2, R-4, R-7 and R-9. Test: edit `tests/test_inheritance.py:43` to expect briefing's heading. No test is removed.

## Slice 1: the move

**1a. apiVersion agentbay/v4** (about 40 turns, done like 0008 part 3b). Change every manifest and schema `const`/`$id` and the refusal in `model.schema_errors` (it names v4). The tree is red mid-part, so 1a is one commit. **`config.schema.json` and `event.schema.json` stay v3**: the proposal says config files and the ledger do not change, and the builder may not name agentbay.config.yaml in a command anyway. The refusal names the version of the kind it rejects. Test: extend the refusal loop in `tests/test_resolver.py` with a v3 mode and env. No new test.

**1b. Move and loader** (about 45 turns; ends uncommitted). Run one `git mv` per row of the decision 5 table, plus `git mv framework/components.yaml framework/kernel.yaml`. Then the code:
- `bay/model.py`: KINDS becomes one kind-to-manifest table plus the `Component` kind, globbed as `components/*/<manifest>`, with internal connectors at `components/*/connectors/*/connector.yaml`. Interfaces and envs come from the convention folders. `data_schema` globs `components/*/data/`.
- `bay/contenttypes.py`: FOLDER goes and the loader is used instead. `bay/conformance.py:298` reads `adapters/claude-code/commands`.
- `bay/scaffold.py`: targets under components/, templates at `bay/templates/`.
- `bay/graph.py` and `bay/cli.py`: skills as `<component>--<skill>`. `adapters/claude-code/`: commands path and skill namespace.
- `tests/run.py` `files()` and the `bay/limits.py` regex and kit filter both cover `components/**/tests` and `adapters/*/tests`.
- `bay/lint.py`: refuse leftover old folders ("move it to components/<name>/").
- `framework/kernel.yaml`: protected lists kept, paths rewritten. `framework-dev` `fs.write` takes the new instance paths.
- New: `schemas/component.schema.json` and `components/tools/component.yaml`. Raise `framework/limits.yaml` `schemas` to 16 (the exception) here, where the count first needs it.

If the builder reaches turn 50, it lists what is left and 1c finishes it.

**1c. Tests, goldens, doc paths, commit** (about 40 turns).
- `tests/layout.py` maps to the new paths. Envs need an owner table: `env:<name>` -> `components/<owner>/envs/<name>.yaml`. `PROTECTED_INSTANCES` lists the 17 paths at their new homes.
- The 9 moved test files are fixed for imports and golden paths. `golden_util` takes the golden's path from the test file.
- Golden deltas, each named and asserted in its test: improve.json in `test_improve_golden` (10 paths, old prefix -> new), stages.json in `test_stage_syntax` (23 paths, plus the line-264 scan), guard-matrix*.json in `test_guard_matrix` (186 paths). The feed-briefing and mail-briefing goldens only move.
- `test_limits` gets one assertion: the `tests` count equals the `def test_` total of the files `run.files()` finds.
- Update path strings in README, DESIGN and INTERFACES.
- Commit 1b and 1c together. After the commit, the coordinator runs `./bay.sh build` (it asks the owner).

## Slice 2: derived protection

**2a. Manifests carry protection** (about 35 turns).
- Schemas: add `protected` to mode, connector, environment and component.
- Set `protected: true` on cos, forge and the nine protected connectors. Each protected env gets `protected: {}` or `{ modes: [...] }`, matching today's block.
- `bay/model.py`: `load_protection` builds `Protection` from the loader. A manifest that cannot be read protects its whole component folder (fail closed).
- `bay/boundary.py`: delete `Protection.parse`, `_names`, `_folder` and the map's `protected:` parsing. `framework/kernel.yaml`: delete the `protected:` block.
- `bay/lint.py` `lint_protection`: drop the "does not exist" check, which cannot fail now. Keep the closure. `_protected_paths_in_sync` computes framework-dev's `fs.write` from the manifests. `bay/scaffold.py`: derive the sensitive-path list.
- `bay/guard.py` keeps reading `.agentbay/guard.json`. It is a stdlib-only hook that cannot parse manifests, and the build derives the policy. Only its messages change.
- Tests: rewrite `test_a_missing_or_malformed_protected_block_fails_closed` and `test_a_malformed_protected_block_makes_check_base_refuse…` in place for an unreadable manifest. Delete `test_boundary.py::test_a_base_map_without_protected_is_an_error`, which is obsolete. Extend `test_an_edit_to_a_protected_component_without_touches_fails_check_base` with a `protected:` field edit. Net -1.

**2b. layout.py goes** (about 20 turns). Remove `tests/layout.py`. `test_protection.py:47` keeps the pin, now as the 17 paths written in the test. That is the one place a change to the protected set shows. The other five importers read `kit.protected_paths`, and `physical()` becomes a loader lookup in `test_guard_matrix`. The coordinator runs `./bay.sh build` again.

## Slice 3: boundary, limits, docs

**3a. Boundary** (about 30 turns). `bay/boundary.py`: the `Contract` and `at:` matching gives way to the loader's component folders, so B-1 to B-3 work per `components/<name>/`. `framework/kernel.yaml` keeps only `owns:` (the `contracts:`, briefing entry and unread keys go), and `MAP` reads it. Test: extend `test_boundary.py`.

**3b. Limits and placement** (about 30 turns).
- `bay/limits.py`: add `component_spread`, using the measurement rule of the proposal's Problem section. A base file missing a measure is accepted. The `tests` and kit patterns are already done in 1b.
- `framework/limits.yaml`: add `component_spread: 1`, raise `tests` to 540 if the count needs it, and leave other counts to release.
- `bay/lint.py`: placement rule (decision 7): a connector with no network, no secrets and no `fs` path outside the project must sit in `components/<owner>/connectors/`.
- Tests: +1 `test_limits` case for `component_spread`. The placement rule goes into the 0a table.

**3c. Docs** (about 35 turns). README, DESIGN (one folder per component, connector meaning, the B-1..B-12 table in the safety model, link to proposals/ kept), INTERFACES (row b18), and the C-7 vocabulary in `framework/rules/conformance.yaml`. Changelog, version and the `--write` ratchet are left to the release step.

## Cost against each ceiling (now = base d8423e5 = ceiling, after)

| Measure | Now | After 0010 | How |
|---|---|---|---|
| bay_lines | 9618 | ≤ 9618 | Estimates, before payers. Adds: 0a +40, 0b +25, 1b +8, 3a -10, 3b +30. 2a about -45. Net about +50, with no headroom. Payers in files 0010 already touches, same behaviour: fold `lint._mode_envs` into `model.mode_envs` (about -7), one git ls-files helper across limits, lint and boundary (about -10), drop `lint._component_map` once 2a lands (about -6), and trim the 0a and 3b code. A part over budget trims, and the proposal is not amended. Each part quotes the measured number. |
| kit_python_lines | 6584 | 6584 | Moves only. derive.py stays counted under components/, and tests/ folders stay excluded. |
| cli_commands | 16 | 16 | No command. |
| framework_folders | 3 | 2 | interfaces/ goes. Written at release. |
| top_level_folders | 11 | 7 | Written at release. |
| schemas | 15 | 16 | component.schema.json (exception). Raised by hand in 1b. |
| tests | 536 | about 538 (≤ 540) | 0a +1, 0b +1, 2a -1, 3b +1. Everything else extends a test. |
| component_spread | (none) | 1 | New in 3b. 5 today (feed-briefing, mail-briefing). |

**Recount of the two placeholders.** `tests: 540` for 0010 alone holds: cross.md's 540 was 0010's ~20 new tests set against 0012's 14-18 removals. On its own, 0010 adds 3 net, because it extends existing tests rather than adding them. The 2 to 3 of headroom covers one unplanned case. `bay_lines` has no exception and the estimate is about +50 before payers, so 0010 meets its ceiling only through the payers above. If 3b still measures over 9618, the owner chooses between more payers and a `bay_lines` exception (decision 5 below).

## Risks (security first)

- **Interfaces lose protection.** Today all 13 interface files are protected under `framework/`. After the move, 11 of them sit in unprotected components (briefing, improve, tools), including `improve.findings.v1.yaml`, whose `ownerOnly` marks backlog approval as owner-only. The proposal's "same 17 instances" misses this. See decision 1.
- **Guard and protection change.** The protected path list is shorter even though the instances stay 17: protected_paths collapses an instance nested in a protected folder, and five are (cos-local and workflow-runner in cos; framework-dev, local-authoring and scaffold in forge). The policy goes from 21 entries to 16. The guard-matrix delta must assert the shorter list. Between the 1c commit and `bay build`, guard.json protects the old paths; lint's `stale_policy` reports this and the coordinator rebuilds right away. coordinator/ becomes protected under adapters/ (a tightening).
- **The builder cannot write most moved files.** `git mv` and `git rm` pass the guard, which checks only the control plane, but every one is prompted. framework-dev's `fs.write` does not reach components/ for unprotected components, README.md or the unprotected mode files that 0b, 0c and 1a edit. After 1b the policy also still names the old paths. See decision 2.
- **Deadcode will false-block.** Detector keys hold the file path (`fn:app/core.py:never_called`), so every finding that already existed in a moved file reads as new against origin/main. See decision 3.
- **`bay check --base` after the rename.** With `--no-renames`, kernel.yaml shows as added, so the change is judged by its own map with no new-extension pass. Every changed path must then be listed, and these are not: `bay/templates/`, `bay/contenttypes.py`, `bay/conformance.py`, `bay/config.py`, `bay/rules.py` (docstring), and at release `bay/__init__.py` and `CHANGELOG.md`. See decision 4.
- **Test discovery.** If run.py and the limits regex diverge, the count drops without anyone noticing; the 1c assertion guards against that. Moved tests import `helpers` and `golden_util` from tests/: run.py puts tests/ on sys.path, but pytest does not without tests/conftest.py. Keep conftest until 0012.
- **Goldens.** 219 path strings across improve, stages and guard-matrix change with the move. Each is a named rewrite in its test. Regenerating any golden would hide a guard change.
- **apiVersion v4.** Every user mode, env and connector is refused until it moves and bumps. Config stays v3, as above.
- **Self-reference.** 0b, 0c and 1b move and edit forge.extend's own playbook and rules during this call. Later steps read them at their new paths only after `bay build`.

## Decisions for the owner

1. **Interface protection.** One option: add `protected: true` to `tools` (its two envs then nest, and the set changes by one) and protect each component's `interfaces/` folder by a kernel rule. That is an amendment, recommended. The other: accept that improve's `ownerOnly` interface becomes writable outside extend.
2. **Guard for the builders.** One option: run 0b, 0c, 1a, 1b, 1c, 2a and 3c with the guard off, as 0008 did, and say so in each result (recommended). The other: the owner makes the unprotected-file edits and `git mv`s the move table rows themselves. Either way, the owner answers each `git mv`/`git rm` prompt or runs them, and the coordinator runs `./bay.sh build` after 1c and 2b.
3. **Deadcode across the move.** One option: accept a review of the listed pre-existing findings in place of the step (recommended). The other: make `change` rename-aware, which is improve-detect code outside 0010.
4. **Touches amendment before the gate** (the gate binds both files): `bay/templates/`, `bay/contenttypes.py`, `bay/conformance.py`, `bay/config.py`, `bay/rules.py`, `bay/__init__.py`, `CHANGELOG.md`. Optionally add `id: "0010"`.
5. **bay_lines.** If the payers fall short at 3b: more same-behaviour payers (recommended), or `exceptions: [{ measure: bay_lines, to: <n>, reason }]`.
6. **config.schema.json and event.schema.json stay v3.** Confirm. Otherwise the owner bumps agentbay.config.yaml themselves.
