# HANDOFF: 0008 slice 9 plan (docs and release, version 1.0.0)

Plan for three sequential builder parts. Branch feat/0008-slice9 from origin/main e20e165 (0.10.0). Nothing is built yet; no proposal is edited here. Rules in force (0009): one review round (a second only for a blocker or security finding), `framework/limits.yaml` ceilings (bay lines 9621 and kit Python lines 6589 are at their ceilings, tests 546), touches may name folders. Paths below that do not exist yet are written without backticks on purpose.

Common rules for every part: parts 1-3 are built in order, each ends with `python3 tests/run.py -q` green and `./bay.sh check` clean; run only the tests of what you changed while working; Edit calls are batched (many Edit calls in one turn); the test count never rises above 546 at the end of a part; commit `framework/limits.yaml` only in part 3 (the one ratchet; a lowered number may be raised back up to the base value in a later part, never above it). Part 3 needs the three amendments listed at the end applied to the proposal first (part 2 needs the first).

## Part 1: remove (no behaviour change except item 6)

1. Improve golden stops reading HANDOFF.md (do this first, any HANDOFF edit breaks it today). In `tests/test_improve_golden.py` golden_kit_audit drops candidates whose scope file is HANDOFF.md before counting; add the delta doc-stale 2 -> 1 (the one stale doc besides HANDOFF.md) beside the existing doc-size delta and say why. Acceptance: the test passes with any HANDOFF.md content.
2. Test audit, from the scratchpad file test-audit.md (its paths predate stage 5: framework/connectors/X is connectors/X now). Do: delete T1-T4, D1-D4 (D4 keeps its one assertion in `tests/test_ledger.py`; D3 first adds its `bad` entry to the guard-scope list), fold W6's isolation half into `tests/test_roles.py`; merge D5, D6 and A6; delete the assertion lines A1-A5, A7 (A1: add "use" to OLD), D7, W2 (dead loop), W3, W5. Skip the renames, moves and speed-ups. Every behaviour stays asserted elsewhere. Net -12 tests.
3. One ledger reader. `ledger.read(project, warnings=None)` becomes the body of util.read_events (events are dicts with string type, ts, runId; split on "\n"; bad lines skipped and named through `warn`) and no longer creates the ledger folder. Delete read_events from `bay/util.py`; `connectors/ledger/ledger_sources.py` and `connectors/improve-store/improve_store.py` import `bay.ledger.read`. The guard keeps its own stdlib reader. Check hand-written ledger lines in tests (test_boundaries, test_guard_matrix, improve_fixtures) carry type, ts and runId.
4. Move PROPOSAL_PATH from `bay/dispatch.py` into `bay/util.py`; dispatch and `connectors/improve-detect/improve_detect.py` (the limits one-liner, now `PROPOSAL_PATH.match(x)` instead of startswith) share it.
5. `Kit.covers` stops recomputing: `protected_paths` is computed once (cached_property or set at the end of __init__; callers `bay/lint.py` and protected_writes in `bay/model.py`).
6. `bay check --base` with a base map lacking `protected:` is an error. `ComponentMap.parse` in `bay/boundary.py` raises RuntimeError (name the file, say to add the block); the field is no longer optional; delete the None branch of protected_by and the `prot is None` check in load_protection (`bay/model.py`). `tests/test_boundary.py` MAP fixture gets the block; one test: a base without it fails with that message.

Net: bay -18 (ledger -15, block -4, covers +1), kit 0, tests -12 (+1 for item 6): 546 -> 535.

## Part 2: fix and move

Order inside the part (do the defects first): 9, 8, 7, 12, 11, 10.

9. Review round (design below). `bay/dispatch.py` +1, wording, one test.
8. `when: approved $in.f` crashes (IndexError) because skip lost that branch. Refuse the form: drop `!?approved\s+\$in\.{PATH}|` from FEATURE_WHEN_PATTERN in `bay/workflows.py` and from the `when` pattern of `schemas/mode.schema.json`. `tests/test_stage_syntax.py`: add the three rows (`approved $in.f`, `!approved $in.f` in the feature tables) to EXPECTED_DELTAS as accepted -> refused, and drop the dispatcher_skip row for it. 0 lines.
7. The dispatcher uses `workflows.advance`. advance gets `fresh=None` and passes it to skip (the closure takes the step); skip loses its `gate` parameter. In `bay/dispatch.py` the step loop calls advance, logs step.skipped for each id in Move.skipped (steps[id] = None), then handles the prior-approval gate skip, runs code steps and plans role/review/gate steps as today; Move kinds refused and missing raise CallError (fail closed, unreachable after resolve). Delete Dispatcher._skip. Tests: test_stage_syntax calls `workflows.skip` for its dispatcher table, asserts `wfmod.advance(` in dispatch, drops `gate=True` at its end. bay -6.
12. improve-store upsert validates like annotate: one helper in `connectors/improve-store/store.py` applies route (in ROUTES) and effort/impact (int 1..5) from a candidate or an annotation; upsert calls it for new findings (the candidate's invalid values are dropped), annotate calls it too. Kit +3, paid in this part: delete the unused code the kit audit reports in connectors/adapters/content-types (the golden counts 5 unused), else share the two candidate() builders of improve-detect (detect_sessions and detect_artifacts, about -8). Say which in the result. One test (route "x", effort 0, impact 9 are ignored).
11. One rules schema: `schemas/rules.schema.json` takes both shapes (an if on kind Conformance: C- ids, appliesTo list of kinds, terms, metadata; else the feature-rules shape); `schemas/conformance.schema.json` is deleted; `bay/conformance.py`, `bay/lint.py` and the header of `framework/rules/conformance.yaml` say schema("rules"). 0 bay lines.
10. Three data schemas leave core: improve.finding.v1 and session.episode.v1 move to modes/improve/data/, selector.v1 to modes/briefing/data/ (git mv). `data_schema` in `bay/model.py` also searches modes/*/data/; `_data_schemas` in `bay/graph.py` lists them (the artifact-graph test expects the schema:improve.finding/v1 node); delete the item_kinds loop over schemas/data (no schema there extends item/v1 any more: kinds are post and email). Core docs must not name a mode folder outside a fence (B-11), so docs/INTERFACES.md lines 31-32 say "a mode's data folder". bay -4. Schemas 19 -> 15 with item 11.

Net: bay -9 (advance -6, data -4, review +1), kit 0 after the payer, tests +2 (item 9 and 12): 535 -> 537.

## Part 3: v3 and release

13. apiVersion `agentbay/v3` everywhere (about 100 tracked files besides tests: modes/ 35, connectors/ 14, envs/ 8, framework/interfaces 13, framework/roles 5, framework/rules 1, content-types 2, schemas 10 incl. the $id strings, bay/config.py MINIMAL and docstring, bay/model.py merged-mode doc, README). Batch the Edits. A v2 document is refused with a message that names the fix: in `schema_errors` (bay/model.py), an error on `apiVersion` from a const check reads "apiVersion: this kit reads agentbay/v3, not '<found>'; change the line to apiVersion: agentbay/v3 (the v2 shapes changed too, see CHANGELOG 1.0.0)" (+5 bay, paid by parts 1-2). No reader, no migration. Update the 12 test files that write v2 (grep agentbay/v2 in tests). One test: a mode, an env and the config with v2 are each refused with the message.
14. Docs current: README (apiVersion line; "a job with endpoints" -> features; pre-approved list is `show|status|note|catalog`, the same stale list is in docs/DESIGN.md; one line for the weekly improve run as a cron line, decision 2), docs/DESIGN.md and docs/INTERFACES.md (read each fully against the code: feature shape, env offline block, adapter profile, plan events, schema moves, v3 and its refusal, review halting rule). B-11: no mode, env or connector name outside fences.
15. CHANGELOG 1.0.0: Changed (v3 and refusal, schemas moved and merged, one ledger reader), Fixed (review halting, approved form, upsert validation, base map without protected), and delete the two 0.10.0/0.9.0 known issues this slice fixes; keep "improve does not read review.overrun notes" (deferred, adds code) and the uses intersection. `bay/__init__.py` 1.0.0.
16. Ratchet and evidence: `./bay.sh check --limits --base origin/main --proposal docs/proposals/0008-simplify-without-losing-features.md --docs` (this also writes the lower ceilings: bay about 9599, schemas 15, tests about 538); quote it. Scratch-repo round trip: `./bay.sh build --project <scratch>` with a config containing `offline: true`, follow the README quickstart to a first result, then `./bay.sh clean --project <scratch>`; quote the output. Full suite once. Cut this HANDOFF to the result.

Net: bay +5 (final about -22 against the base), kit 0, tests +1.

## Path table (touches of 0008 as it stands)

| Paths | Covered by |
|---|---|
| tests/, HANDOFF.md | other, no entry needed |
| bay/ledger.py, bay/util.py, bay/dispatch.py, bay/model.py, bay/boundary.py, bay/lint.py, bay/workflows.py, bay/graph.py, bay/conformance.py, bay/config.py, bay/__init__.py | one entry each (slices 1, 3, 6, 7, 8, 9) |
| connectors/ledger, connectors/improve-store, connectors/improve-detect, every connector.yaml | `connectors/` (slice 7) |
| modes/ files: forge extend rules and playbook, improve and briefing data folders, every mode.yaml and rules.yaml | `modes/` (slice 7) |
| envs/*.yaml | `envs/` (slice 7) |
| content-types/ | `content-types/` (slice 5) |
| framework/roles/ | `framework/roles/` (slice 8) |
| framework/rules/conformance.yaml | its own entry (slice 1) |
| schemas/mode.schema.json, config, environment, connector, interface, content-type, event, conformance (deleted), components | one entry each |
| schemas/rules.schema.json, role.schema.json, schemas/data/improve.finding.v1, selector.v1 (moved) | NOT covered: amendment 1 |
| framework/interfaces/*.yaml (13 files, v3) | NOT covered: amendment 2 |
| framework/limits.yaml (ratchet) | NOT covered: amendment 3 |
| README.md, docs/DESIGN.md, docs/INTERFACES.md, CHANGELOG.md | slice 9 and 8 entries |

Amendments (design: apply before part 2; the new proposal sha asks the approval gate again):

- { path: schemas/, reason: "slice 9: apiVersion agentbay/v3 in every schema; rules and conformance schemas merge; improve.finding.v1, session.episode.v1 and selector.v1 leave schemas/data/ for the modes that own them", slice: 9 }
- { path: framework/interfaces/, reason: "slice 9: apiVersion agentbay/v3 in every interface", slice: 9 }
- { path: framework/limits.yaml, reason: "slice 9: the ratchet writes the lower ceilings after the removals", slice: 9 }

## Review-round fix (item 9)

Halt by the reviewer's rating, not by the rule level. `_accept_review` still marks the call `partial` for any failed must/must_not item or blocker, but sets `halt` only when a failed item is rated blocker or is a must/must_not item with no severity (a security finding is rated blocker; R-8 and the reviewer role say so). A failed must item rated should-fix or nit goes to `review.failed` and the Result's list, the call continues to release and ends `partial`, so no re-run and no second review exist for it. After a halt, the re-run is the one second round R-1 allows: the review step stays required and independent (mandatory review is not weakened) and the fix result is the implement result. Change: one line in the dispatcher, wording in R-1, R-8, R-10, the extend playbook's Failure handling and `framework/roles/reviewer.yaml`, and one test (a should-fix must failure reaches release and ends partial; a blocker or an unrated must failure still halts before release, as `test_failed_review_halts_before_release` asserts). Not chosen: a scoped re-check or a skipped review on re-run, which add lookup code for a case the rating already removes.

## Not in this slice

improve reading `review.overrun` notes (adds code, owner deferred); the `tests:` keys in framework/components.yaml that name missing contract test files (audit item 5); audit renames and moves of test files; the per-call `uses:` scope.

## Part 1 done

Commits on feat/0008-slice9: a15069d (items 1-6 and the test audit), add8ba6 (two import lines so kit Python lines stay at the ceiling). Items 1-6 built as written; deviations below.

Net lines against origin/main e20e165: bay 9621 -> 9603 (-18), kit Python 6589 -> 6589 (0), tests 546 -> 536 (-10, not -11). The plan assumed D5 was two tests; it is already one in this tree (test_check_takes_boundary_options_only_with_a_base...), so I only added `--proposal` to its loop. Removed: T1-T4, D1-D4, W6, A6 (test_config_schema_rejects_unknown_settings: `bindings` joined the offline test's refusal loop, the `lookback` limit assertion moved to test_caps_take_the_strictest..., `bogus` key is the costPerPostUsd case of test_the_old_price_key...), D6 (improve's shim test; the unit-wide `python3 -E` and no-import check is test_use_shim_does_not_import_project_files, over every unit; the improve `not granted` shim check moved to test_mode_and_env_containment). Added one test (item 6). Assertion lines dropped: A1-A5, A7, D7 (kept in test_settings_have_no_wildcards), W2, W3, W5. Where each behaviour lives now: D1 test_front_matter_marker_grants_nothing; D2 and D3 test_bay_plan_is_the_only_bay_command_a_subagent_may_run and the `bad` list of test_guard_scopes_bash_per_subagent (gained the builder `call ...prune` entry); D4 test_note_attaches_to_existing_run (state partial) and valid(); T1 test_offline_switch_rebinds...; T4 test_auth_refuses_without_a_terminal_and_names_the_connector; T3 the dead-code check on `change`; A1 `use` in OLD of test_cli_commands.

Details worth knowing: (a) deleting T2 left `proposal.load_touches` with no caller, a new unused finding (golden unused 5 -> 6); bay/proposal.py is not in 0008's touches, so test_front_matter_parser now covers load_touches (file read, error names the file) instead of deleting it. If a later slice amends touches for bay/proposal.py, it can be deleted with that test part. (b) `ledger.read` now skips and names lines without string type, ts and runId; test_guard_matrix's hand-written dispatch events gained a `ts`. (c) `Kit.protected_paths` is a cached_property (callers drop the parentheses: lint, the claude-code adapter, three tests). (d) the improve golden's HANDOFF.md exclusion makes the doc-size delta read 2 -> 1 as before and adds doc-stale 2 -> 1. (e) `./bay.sh check --limits` writes lowered ceilings into framework/limits.yaml (bay_lines 9603, tests 536); that file is NOT committed (part 3 owns the ratchet), the working tree carries the lowered numbers.

Last line of each check: `python3 tests/run.py -q`: "536 passed, 0 failed in 160.9s (2 workers)"; `./bay.sh check`: "✓ 6 modes, 21 features, 5 roles (17 role units), 8 envs, 13 connectors resolve (agent profile claude-code)"; `./bay.sh check --limits --base origin/main --proposal docs/proposals/0008-simplify-without-losing-features.md --docs`: "✓ limits: 7 measures within their ceilings" (boundary line: "31 changed paths (6 core, 5 extension, 20 other); 0 failing; B-11 docs: 0 hits").

## Part 2b done

Items 10 and 11 were finished after item 7 (see the end of this section). Commits: 06754cc (item 7), then the items 10 and 11 commit. Bay 9600 lines (-21 against part 1's 9621 base; item 7 +5, data -4 and the item_kinds loop). Schemas 16 until `schemas/conformance.schema.json` (no consumers left) is `git rm`ed, then 15. Tests 536. Last lines: `python3 tests/run.py -q`: "536 passed, 0 failed in 144.1s (2 workers)"; `./bay.sh check --limits ...`: "✓ limits: 7 measures within their ceilings" (boundary: "33 changed paths (7 core, 5 extension, 21 other); 0 failing; B-11 docs: 0 hits"). framework/limits.yaml was rewritten again by the check (bay_lines 9600, schemas 16, tests 536) and is not committed.

Earlier status, written after item 7 alone:

Commit 06754cc on feat/0008-slice9: item 7. `workflows.advance` takes `fresh(stage, age)` and passes it to `skip`; `skip` lost `gate`; the dispatcher step loop calls advance, logs step.skipped per Move.skipped, raises CallError on refused/missing; `Dispatcher._skip` is gone, its freshness closure is `Dispatcher._fresh(step, mode, age)`. test_stage_syntax calls `workflows.skip`/`_fresh`, asserts `wfmod.advance(` in dispatch and no `_skip`.

NOT done: item 11 (merge conformance into rules schema, delete schemas/conformance.schema.json) and item 10 (git mv improve.finding.v1, session.episode.v1 to modes/improve/data/, selector.v1 to modes/briefing/data/; data_schema, graph._data_schemas, INTERFACES.md lines 31-33). Reason: the builder's Allowed Bash list has no `git mv`, `git rm` or `git checkout`, so moves and the deletion could not be made. Schemas stay at 19.

Net lines against origin/main: bay 9608 (part 1: 9603, so +5 here, not the -6 planned; the loop with the skipped-id log is longer than assumed), kit Python unchanged, tests 536. framework/limits.yaml is modified in the working tree by `check --limits` (bay_lines 9608, tests 536) and NOT committed; restore it with `git checkout -- framework/limits.yaml`.

Last lines: `python3 tests/run.py -q`: "536 passed, 0 failed in 156.8s (2 workers)"; `./bay.sh check --limits ...`: "✓ limits: 7 measures within their ceilings" (boundary: "31 changed paths (6 core, 5 extension, 20 other); 0 failing; B-11 docs: 0 hits").
