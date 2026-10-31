# Plan 0008: the rest of slice 9 (HANDOFF Part 3 and the owner's three items)

Branch feat/0008-slice9 (parts 1, 2a, 2b built; HANDOFF.md). Base origin/main e20e165. Three builder parts, in order; each ends with `python3 tests/run.py -q` green and `./bay.sh check` clean, runs only its own test files while working, batches Read and Edit calls (15-20 per turn), and commits. No test is added (each change extends an existing test), no tests/golden file is edited, and framework/limits.yaml is committed only in 3c.

## Part 3a: process fixes first (one builder, about 25 turns)

1. Ratchet against the base, written only at release. `bay/limits.py` check(): over-ceiling test uses `lim = max(ceil[m], old.get(m, ceil[m]))`, so a ceiling lowered earlier on the branch may climb back to the base value, never above it (the raise test is unchanged); any count other than the file's ceiling is a note and is written; `write` defaults to False. `bay/cli.py`: `check --write` (an option, not a command) passes `write=True`. `connectors/improve-detect/improve_detect.py`: drop `write=False` and fix its docstring (line 29). Wording: `modes/forge/features/extend/playbook.md` step 7 and DOD-15, `modes/forge/mode.yaml` implement and release tasks (release runs `--write`), `framework/interfaces/improve.detect.v1.yaml` line 81, README line 53. Test: extend `tests/test_limits.py` (write=True where it expects a write; a ceiling lowered below the base and a count back at the base value passes; no write without it).
2. Builder never hand-edits a golden. `framework/roles/builder.yaml` rules gains: "never edit a file in tests/golden/ by hand; a changed behaviour is a named delta in the test". No test pins the rules list.
3. `git mv` and `git rm` for framework-dev: `envs/framework-dev.yaml` workspace.write/v1 clis. `tests/test_guard_matrix.py` undo_move gets one named delta: assert the two prefixes in DEV's `clis` and in DEV's "may only run: ..." deny reasons, then strip them (as dev_now/dev_was does for fs.write). The coordinator runs `./bay.sh build` afterwards (it asks the owner) so the generated builder file lists them.
4. Payers (same behaviour): `bay/conformance.py` `_vague` as `return next((w for w in VAGUE if ...), None)` (-3); the final `return None` of `bay/contenttypes.py` mode_views (-1). Not in guard.py, secretscan.py or vault.py.

## Part 3b: apiVersion agentbay/v3, v2 refused (one builder, about 45 turns)

5. Order (the tree is red between the first and last edit, so the part is one commit): schemas/ (9 files, `$id` and `const`: config, connector, content-type, environment, event, interface, mode, role, rules), `bay/config.py` (MINIMAL and docstring), `bay/model.py` (merged-mode doc line 285, refusal); then framework/interfaces (13), framework/roles (5), framework/rules/conformance.yaml, envs (8), content-types (2), connectors (13 connector.yaml and connectors/gmail-api/tests/test_gmail_api.py), modes (35: mode.yaml, feature rules.yaml, forge templates, cos types), README line 86; then tests (11 files, 26 lines: grep `agentbay/v2` in tests/). CHANGELOG history and docs/proposals stay as written. Turns: about 6 turns of Reads and 6 of Edits for 101 files; if the builder reaches turn 50 it stops uncommitted and lists the files left, and the next builder finishes and commits.
6. Refusal in `schema_errors` (bay/model.py): an apiVersion const error reads "apiVersion: this kit reads agentbay/v3, not '<found>'; change the line to apiVersion: agentbay/v3 (the v2 shapes changed too, see CHANGELOG 1.0.0)". Budget +3 lines. No reader, no migration. Test: extend the config refusal loop in `tests/test_resolver.py` with a v2 mode, a v2 env and a v2 config, each refused with that message.

## Part 3c: docs and release (one builder, about 40 turns)

7. README, docs/DESIGN.md, docs/INTERFACES.md read fully against the code (HANDOFF item 14) plus: the plan step, `approvals.plan` (large | always | never), the two-prefix chat sha (`<proposal>+<plan>`), the ratchet's `--write`, v3 and its refusal, the review halting rule, schema moves. B-11: no mode, env or connector name outside fences.
8. CHANGELOG 1.0.0 (HANDOFF item 15, plus the plan gate, the scoped re-check and `check --write`); `bay/__init__.py` 1.0.0.
9. Evidence and ratchet: `./bay.sh check --limits --write --base origin/main --proposal docs/proposals/0008-simplify-without-losing-features.md --docs` once, commit framework/limits.yaml; full suite once; quote both. The scratch-repo `build` + `clean` round trip (config with `offline: true`, README quickstart to a first result) and the fake-source demo need `./bay.sh build|clean` and `bay call`, which the builder may not run: the coordinator runs them in the main thread and the builder quotes the output. Cut HANDOFF.md to the result.

## Paths and touches

Covered by 0008: bay/cli.py, model.py, config.py, conformance.py, contenttypes.py, __init__.py (own entries); schemas/, framework/interfaces/, framework/roles/, framework/rules/conformance.yaml, framework/limits.yaml, content-types/, envs/ (framework-dev.yaml), connectors/ (improve-detect, gmail-api, every connector.yaml), modes/ (forge/mode.yaml, forge/features/extend/), README.md, docs/DESIGN.md, docs/INTERFACES.md, CHANGELOG.md. Other, no entry: tests/ (test_limits, test_guard_matrix, test_resolver, the 11 v2 test files), HANDOFF.md, this plan. NOT covered: `bay/limits.py` (item 1). Amendment before the gate: { path: bay/limits.py, reason: "slice 9: the ratchet compares against the base ceilings and writes only with --write, at release", slice: 9 }.

## Risks (security first)

- `git mv` and `git rm` arguments are checked only against the control plane (bay/guard.py `_words`), not against fs.write, so a framework-dev builder could move or remove a tracked file outside its writable paths. Bounded: tracked files only, each command is prompted (never auto-allowed), git keeps the content, and review reads the diff. See decision 1.
- With the guard active, framework-dev's fs.write does not reach README.md, CHANGELOG.md, HANDOFF.md, content-types/ or the unprotected modes, envs and connectors (about 45 of the 3b files); earlier parts ran with the guard off. Widening fs.write to them is refused by lint (D9: framework-dev names protected paths only). See decision 2.
- The refusal echoes the found apiVersion value into lint output: file content, no secret path; keep it repr-quoted.
- A half-done 3b leaves every document unreadable; it is never committed red.
- bay_lines has no headroom after 3b (see below): a refusal longer than 3 lines needs another payer.
- The guard-matrix delta must be a named, asserted strip in test code; regenerating the golden would hide a guard change.

## Cost against each ceiling (framework/limits.yaml at base / now / after)

- bay_lines 9621 / 9620 / 9621: limits +1, cli +1, payers -4 (3a, 9618), refusal +3 (3b).
- kit_python_lines 6589 / 6588 / 6588: improve_detect edits one line; the gmail test is excluded.
- cli_commands 16 / 16 / 16 (`--write` is an option). framework_folders 3, top_level_folders 11: unchanged.
- schemas 19 / 15 / 15. tests 546 / 536 / 536 (extended only). Written once, in 3c item 9.

## Decisions for the owner

1. `git mv`/`git rm` outside fs.write: accept as bounded (recommended, 0 lines), or the guard checks their path arguments against fs.write (bay/guard.py about +6, needs payers or `exceptions: [{ measure: bay_lines, to: 9627, reason }]`).
2. Guard and fs.write for 3b and 3c: run as parts 1-2 did with the guard off and say so in each result (recommended for this slice), or split the user-space files into a local-authoring builder (still no root files or content-types/), with a follow-up proposal for root docs.
3. Apply the bay/limits.py amendment above before approving (the proposal sha changes; the gate binds both files).
4. If the refusal needs more than 3 lines: another same-behaviour payer (recommended) or a bay_lines exception.
