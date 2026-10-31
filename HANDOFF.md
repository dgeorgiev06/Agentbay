# HANDOFF part 30: T-20261031-3894 (recorded with `bay plan`) - stage 5 part H built (improve is an ordinary mode); slices 6 and 7 acceptance

Outcome: done. Commit 2dd116e on feat/0008-stage5 (not pushed) holds the previous builder's edits, finished: improve left `protected.mode` (now `[cos, forge]`), `PROTECTED_INSTANCES` and framework-dev `fs.write` together. `improve-local` and the nine connectors stay protected (D3). No proposal edited.

## Evidence (at 2dd116e plus this handoff)
- `python3 tests/run.py -q`: `544 passed, 0 failed`.
- `./bay.sh check`: `✓ lint clean` / `✓ 6 modes, 21 features, 5 roles (17 role units), 8 envs, 13 connectors resolve (agent profile claude-code)`. One warning is the stale `.agentbay/guard.json` (22 paths vs the map's 21); the checkout was not rebuilt.
- `./bay.sh check --base origin/main --proposal docs/proposals/0008-simplify-without-losing-features.md --docs`: `boundary origin/main...HEAD: 288 changed paths (32 core, 2 docs, 199 extension, 22 feature, 33 other); 0 failing; B-11 docs: 0 hits`.
- build/clean on s6h: `built 6 modes for claude-code`, clean printed `clean`, Glob afterwards: only `agentbay.config.yaml`.

## Deltas (the goldens are untouched: `git status --short -- tests/golden` empty)
- Guard matrix, `EXPECTED_DELTAS` in `tests/test_guard_matrix.py`, six improve rows (`Edit/MultiEdit/NotebookEdit/Write` of `mode:improve/...`): `builder--delivery` and `builder--forge--local-authoring` deny -> pass (improve's folder is a user extension, D3); `builder--forge--framework-dev` pass -> deny (it named `modes/improve` only because improve was protected, D9). One resolver gap: improve with a role in `framework-dev` now gets the user-mode message.
- Improve golden, `ROUTE_DELTAS` in `tests/test_improve_golden.py`, three route rows: `default`/`mode improve` forge.extend -> mode-fix; `shipped modes`/`mode improve` forge.extend -> mode-fix; `default`/`mode cos` mode-fix -> forge.extend (the store's default set is now `{cos, forge}`, the map's).
- Stage-syntax baseline unchanged.

## Tests added (D4 and part H)
- `test_protection.py`: improve is an ordinary mode (origin `user`, env and connectors still protected); improve files writable by authoring writers, env and connectors denied; `bay new` no longer calls improve protected; `check --base` treats a new improve folder as an extension. Already there from part F: `test_no_step_in_any_mode_may_call_improve_findings_decide` (resolver and lint refuse a step running `improve.findings/v1.decide` in a user mode and in `modes/improve/mode.yaml`) and `test_bay_approve_of_a_backlog_item_from_a_terminal_still_works...` (terminal ok, `--via chat` refused with "decided at a terminal").
- Case variants (`Cos`, `FORGE`, `LEDGER`, `Workspace`): `test_a_user_mode_named_cos_or_forge_in_another_case_is_stopped_everywhere` (bay new refuses, `check --base` fails the path, case-collision lint reports it).

## Acceptance
Slice 6:
- `bay/improve/` gone: `git ls-files bay/improve` empty. PASS
- scan and audit give the same findings: `test_improve_golden` passes with only the named route deltas. PASS
- backlog item not approvable without the user: `test_approving_a_backlog_item_needs_a_terminal`, the terminal-only test above. PASS
- deferred or open item cannot reach implement: `test_implement_only_for_approved_items_behind_a_gate_and_edits_nothing`. PASS
- improve golden unchanged, matrix changed only on named rows, part G a pure `git mv` (R100 proof in part 29). PASS
- dead-code: no new findings. Not run as a step (it runs inside forge.extend `deadcode`); `test_moving_files_have_no_deadcode_findings` passes.

Slice 7:
- one stage-syntax parser in `bay/`; workflow tests pass; `cos.run` starts a project workflow (part 27, in the 544). PASS
- D3, D4, D7 deltas as named above and in parts 27 and 28. PASS
- `framework/` holds only roles, interfaces, rules and the map: `git ls-files framework` lists `components.yaml`, 13 interfaces, 5 roles plus a skill, `rules/conformance.yaml`. PASS
- protected components declared in the map and read by guard and `bay boundary`; user extension with a protected name refused; protected write without forge.extend denied; chat and terminal approval both pass the gate: `test_protection.py` (544 green). PASS
- `bay catalog` unchanged except paths: compared in part 29. NOT re-diffed in this part; the one expected change is that improve's origin reads `user` (`test_improve_is_an_ordinary_mode...` asserts the root).

Leftover: empty folders `framework/{modes,envs,connectors}/` may remain on disk; the checkout's `.agentbay/guard.json` is stale until `./bay.sh build`.

# HANDOFF part 29: T-20261031-891e (recorded with `bay plan`) - stage 5 part G built (shipped modes, envs and connectors moved to the top-level folders)

Outcome: done. Seven commits on feat/0008-stage5 (not pushed): one pure `git mv`, then six that follow it. No proposal edited; every path is in 0008's touches (boundary below). The tree is NOT green between b002722 and f8af1b4 (the loader still reads the old folders there); from f8af1b4 on, only the tests and docs lagged, and 683a4e3 is green.

## To-do
| Item | Commit | What |
|---|---|---|
| name collisions | - | none: framework modes cos, forge, improve; envs cos-local, framework-dev, improve-local, local-authoring, research, workspace; connectors artifact-graph, claude-transcripts, corpus-store, git, improve-detect, improve-store, ledger, scaffold, workflow-runner. None is at the top level (user: briefing, delivery, feed-briefing, mail-briefing; local-feeds, local-mail; fake, fake-mail, gmail-api, x-api) |
| G1 the move | b002722 | `git mv framework/modes/{cos,forge,improve} modes/`, the six `framework/envs/*.yaml` to `envs/`, the nine `framework/connectors/*` to `connectors/`. 116 files, all R100 (proof below) |
| G3 loader and code | f8af1b4 | `model.Kit` reads modes/envs/connectors from the kit root only (`SOURCES`: roles and interfaces keep both roots); `Kit.roots`, `Kit.collisions` and the "defined by both" path are gone (a name defined twice is a `SpecError`; the "protected name" check in `_load` is gone: one folder per kind, the map protects by name); `Doc.root` is "framework" for a name in `protected:` and "user" otherwise (origin in `catalog`/`describe` unchanged); `scaffold.py` (`TEMPLATES` at `modes/forge/templates`, `_check_name` and `feature` refuse a protected name/mode, an unreadable map reserves every name); `claude_code.py` text; `lint.py` (collisions reader; the `reaches` warning lists the map's folders only, not instance paths: otherwise local-authoring's `modes` would warn forever); `improve_store.py` reads the protected mode names from the map, and `store.py` routes a file of a protected instance (`instance_paths`) to forge.extend like the `framework/` dirs |
| G2 map | 9c70c2a | `framework/components.yaml`: the `at:` lists drop `framework/...`; briefing owns `connectors/corpus-store/`; `protected:` unchanged (names resolve to the new folders; improve is still in `mode:`) |
| G2 fs.write | 7645bbd | `envs/framework-dev.yaml` fs.write: `framework, bay, schemas, adapters`, then 3 modes, 6 envs, 9 connectors in policy order, then `docs, tests` |
| G4 tests | 9cd430c | see below |
| docs | a4f7576 | DESIGN (where instances sit; the store connector described by its interface), INTERFACES line 304, conformance.yaml, improve config example |
| order | 683a4e3 | `Kit` lists protected docs first, then the rest (the order every listing had when framework/ loaded first): `bay check` warnings come out in the baseline's order |

## What part H (and later parts) must know
- `git ls-files framework` = components.yaml, interfaces/ (13), roles/ (5 + skills/research-brief), rules/conformance.yaml. Empty folders `framework/{modes,envs,connectors}/` are left on disk (the allowed commands cannot remove them): delete by hand.
- The guard policy now lists 22 paths (the four folders, then each protected instance where it sits). The checkout's own `.agentbay/guard.json` is the old 4-path one, so `./bay.sh check` prints ONE new warning (the part F stale-policy warning); `./bay.sh build` in the checkout clears it. I did not build the checkout (only scratch projects).
- `tests/layout.py` has `PROTECTED_INSTANCES` (the 18 paths, written out) and a plain `physical`. Tests that name the protected set import it; H removes `modes/improve` from it when improve leaves `protected.mode` (and from framework-dev's fs.write, which lint demands).
- improve-store: framework modes already come from the map (H item 2 first half is done); `store.py` `FRAMEWORK_DIRS` keeps `framework/ bay/ schemas/ docs/ tests/` and the map's instance paths are added by `instance_paths`.
- B-11: `corpus-store` is core-owned only in the NEW map; `check --base` judges by the base's map, where `connectors/corpus-store/` is an extension, so two doc lines (DESIGN 129, INTERFACES 304) that named it were reworded to "the store connector". After the merge the name may come back.
- `test_guard_matrix.py` keeps `guard-matrix.json` untouched and maps the new layout back with `undo_move` (below). H adds its own delta list for improve rows (deny -> pass) there; remove `modes/improve` from `PROTECTED_INSTANCES` and from `undo_move`'s expectation at the same time.
- `test_core_names`: core files = `bay framework schemas adapters coordinator` plus `PROTECTED_INSTANCES` (the files that were under framework/); connector names = connectors implementing `items.source/v1` (the same four: x-api, gmail-api, fake-mail, fake).
- Not done: a case-variant test (`modes/Cos`) of `lint_case_and_manifests` needs a git checkout of the kit copy (`test_boundary.py:99` covers the rule in general); the real dead-code step (`improve.detect/v1.change` through forge.extend) was not called; `test_moving_files_have_no_deadcode_findings` passes on the protected instances at their new paths.
- Tests changed beyond path text: `test_lint.py` (the collision test became `test_a_protected_name_is_reserved_and_defined_once`: bay new refuses cos, improve, scaffold, workspace and a feature in cos; a mode folder named cos2 holding cos's file is a name mismatch; a ghost protected mode fails lint), `test_protection.py` (the reserved-name test became `test_a_name_is_protected_wherever_it_sits_and_is_defined_once`: naming `fake` in the map protects it and the policy lists it; D9 lint then asks framework-dev to name it; a stale-instance and a missing-instance case), `test_forge.py` (message: "protected name"), `test_improve_store.py` (+1 routing test), `test_boundaries.py:296` (policy = the four, then exactly `PROTECTED_INSTANCES`: a superset of the old list), `test_boundary.py:239`. Security tests otherwise unchanged except path text.

## Evidence (run at 683a4e3)
- `python3 tests/run.py -q` last line: `539 passed, 0 failed` (538 + 1 routing test).
- `./bay.sh check` last two lines: `✓ lint clean` / `✓ 6 modes, 21 features, 5 roles (17 role units), 8 envs, 13 connectors resolve (agent profile claude-code)`.
- `./bay.sh check --base origin/main --proposal docs/proposals/0008-simplify-without-losing-features.md --docs` last line: `boundary origin/main...HEAD: 288 changed paths (32 core, 2 docs, 199 extension, 22 feature, 33 other); 0 failing; B-11 docs: 0 hits`.
- `./bay.sh build --project <scratch>/s6g`: `built 6 modes for claude-code`; `./bay.sh clean --project <scratch>/s6g`: last line `clean`; Glob `**/*` of s6g afterwards: only `agentbay.config.yaml` (the input I wrote).
- Rename proof. `git show --stat --summary -M100% b002722`: `116 files changed, 0 insertions(+), 0 deletions(-)`, then 116 lines of the form `rename {framework/modes => modes}/cos/mode.yaml (100%)` (also `{framework/envs => envs}/framework-dev.yaml (100%)`, `{framework/connectors => connectors}/ledger/ledger.py (100%)`); no line is anything but `rename ... (100%)`. `git log --follow --oneline -- modes/cos/mode.yaml`: `b002722 Move framework modes, envs and connectors to the top-level folders (pure git mv, stage 5 part G)`, `c9e6dcc 0008 slice 3: one feature shape ...`, `7626c2d feat(cos): the Chief of Staff is a mode, ...` (history continues past the move).

## Baselines
- `tests/golden/` is UNCHANGED (`git status --short -- tests/golden` empty; no commit of this part touches it): `improve.json` (the kitAudit counts did not move: the detectors scan the moved files the same way), `stages.json`, `guard-matrix.json`, `guard-matrix-project.json`. `test_improve_golden`, `test_stage_syntax_table`, `test_guard_decision_matrix` and `test_guard_matrix_for_a_project_with_the_kit_outside` pass in the full run. No `EXPECTED_DELTAS` row added.
- Guard matrix, proof: `test_guard_decision_matrix` first asserts every decision (index 0 of every row of every caller) equals the golden's, with nothing mapped, then compares the whole result to the untouched golden after `undo_move` puts back these named, path-only differences (each asserted present first): (1) `policy.protected` = the four + `PROTECTED_INSTANCES` -> the four; framework-dev's `write` and `protectedWrites.framework-dev` and the quoted list in its reasons and in the resolver gaps likewise (D9); (2) `<project>/<instance path>` -> `<project>/framework/<instance path>` in reasons, the `lintWarnings` text and the resolver gaps; (3) the deny reason `modes/cos/ of the agentbay checkout is writable only by forge.extend (env must name it)` -> `framework/ of the agentbay checkout ...` (the entry that denied); (4) for `builder--forge--local-authoring` only, that same clause -> `outside the role's writable paths ['modes', 'envs', 'connectors', 'agentbay.config.yaml']`: local-authoring writes modes/, envs/ and connectors/, so a protected instance in them is now denied by the protected entry instead of being outside its writable paths (a deny in both). Row keys are logical (`Write mode:cos/mode.yaml`), so no key changed.
- `test_boundaries.py:290-321` (changed only at the policy-list assertion, plus four new deny/pass rows) and `test_resolver.py:165-185` (only the path in `edit_yaml`) pass.

## CLI comparison with `s5-cli-baseline/` (read side by side; the tool could not diff, so this is a read, not a byte diff)
- `catalog`: equals `catalog.txt` line for line except the `registry built` timestamp (31 lines).
- `catalog --roles`: equals `catalog_--roles.txt` (17 units, same env/tier/model columns).
- `describe cos`: equals `describe_cos.txt` line for line; no path appears in it.
- `describe forge` and `describe improve`: same fields, endpoints, DoD ids and line numbers, rules and steps (checked at the anchors the baselines have: origin, roles, the 16 improve-detect/improve-store connector steps, the forge steps with env framework-dev, task texts at the lines the baseline greps give); none of the three outputs holds a file path, so there is no path delta to list.
- `check` vs `check.txt`: the warning lines are the same and in the same order, with the paths changed: `framework/modes/improve/mode.yaml:65` -> `modes/improve/mode.yaml:65`, `framework/modes/improve/README.md` -> `modes/improve/README.md`, `framework/envs/workspace.yaml` -> `envs/workspace.yaml`. One line is new: the stale `.agentbay/guard.json` warning (the checkout's policy was built before the move; see above).

# HANDOFF part 28: T-20261031-9243 (recorded with `bay plan`) - stage 5 part F built (protection declared in the component map)

Outcome: done. One code commit, 2d56a52, on feat/0008-stage5 (the pieces cannot be green apart: the loader, guard policy, lint and tests share one block). No proposal edited; every path is in 0008's touches (boundary below). Still the OLD folder layout.

## To-do
| Item | Commit | What |
|---|---|---|
| F1 map + schema | 2d56a52 | `framework/components.yaml` `protected:` (paths = the four dirs in the old order; mode cos, forge, improve; env cos-local, framework-dev, improve-local {modes: [improve]}, local-authoring, workspace {modes: ["*"]}, research {modes: ["*"]}; the nine connectors); `schemas/components.schema.json` `protected` (optional in the schema, required by the kit load) |
| F2 loader | 2d56a52 | `boundary.Protection` (parse, `reserved`, `covers`, `may_place`, `open_envs`, `closed_set`); `model.Kit.protected`, `Kit.protected_paths()`, `Kit.covers()`; `PROTECTED` and `USER_FRAMEWORK_ENVS` removed (no fallback); `protected_writes(kit, env)`; `_check_protected`; `_unit` env rule reads `may_place` |
| F3 fail closed | 2d56a52 | a missing/unreadable/malformed block puts an error in `kit.errors` (nothing resolves, `bay check` fails), makes `Kit.protected` closed (every name reserved, every path covered, nobody placed), and the claude-code adapter refuses to write a policy from a closed set |
| F4 guard policy | 2d56a52 | adapter writes `guard.json` `protected` = `kit.protected_paths()` (map paths, then each protected instance folder not already inside one; today = the four dirs). `bay/guard.py` untouched (its loop is unchanged). lint warns when `.agentbay/guard.json` differs from the map (stale policy) |
| F5 boundary | 2d56a52 | `boundary.classify` wraps the old rule: a path the base map protects (`protected.paths` folder, or a mode/env/connector of a protected name) that would pass only as a new extension fails with rule `protected` unless `touches:` lists it; existing-instance and B-3 rules are unchanged |
| F6 lint | 2d56a52 | `lint_protection` (names exist, closure: envs a protected mode maps and connectors a protected env binds are protected, D9 sync both ways), `lint_owner_only`, the `reaches` warning reads the map; `_component_map` makes the other lint readers survive a bad map |
| F7 D4 | 2d56a52 | `improve.findings/v1.decide` has `ownerOnly: true` (`schemas/interface.schema.json` key); `model._code_step` (resolver) and `lint_owner_only` refuse any step running an ownerOnly endpoint; `Dispatcher.run_capability` (`bay approve <F-id>`) untouched |
| F8 tests | 2d56a52 | `tests/test_protection.py` (17 tests); `tests/test_guard_matrix.py` call `model.protected_writes(kit, env)` (signature only); `docs/DESIGN.md`, `docs/INTERFACES.md` lose the two lines naming `USER_FRAMEWORK_ENVS` |
| HANDOFF | this commit | |

## What part G (and later parts) must know
- Instance paths: `Kit.protected_paths()` lists an instance folder only if it is not inside another protected path. Today every protected instance sits in `framework/`, so the policy is still the four dirs, and the matrix is identical. When G moves `framework/modes/cos` to `modes/cos` the policy gains that path; `lint_protection` then FAILS until `framework-dev` `fs.write` names it (D9: the guard lets an env write a protected path only if the env names it). So G must add each moved protected instance path to `framework/envs/framework-dev.yaml` (after `adapters`, before `docs`; keep the first four in order, `test_resolver.py:169` text). Only existing instances are listed, by where they sit, not by `at:` variant.
- `improve` is in `protected.mode` until H; H removes it (and `improve-local`'s `modes: [improve]` is then what lets it use that env). `Doc.root` and `Kit.collisions` still exist (G replaces them); the collision message for a user doc named like a framework one is unchanged. The new map rule (`... is a protected name`) fires for a protected name with no framework doc.
- `bay check --base`: a base map WITHOUT a `protected:` block protects nothing in the boundary check (origin/main's map has none, and this branch must pass against it); a base map with a malformed block makes the check error. Not "fail closed" for a missing block: owner decision needed. After this branch merges, the base always has the block; the exemption can then become an error (one line in `ComponentMap.protected_by`/`parse`).
- Message of `_unit`'s env gap now names `open_envs()` in the map's order; the map lists `workspace` before `research` so the golden text (`workspace and research`) is unchanged.
- `lint_extension_names` keeps its original conditional shape on purpose: the improve golden's `kitAudit.complexity` count (8) changed to 7 when I simplified it.
- ownerOnly: `uses:` of a role cannot reach `decide` (write effect, shim is read-only), so only code steps needed the refusal.
- Open: `bay new` still refuses reserved names through the collision/`is a framework name` path (G, `scaffold.py`).

## Evidence (run at 2d56a52)
- `python3 tests/run.py -q` last line: `538 passed, 0 failed` (521 + 17 new).
- `./bay.sh check` last line: `✓ 6 modes, 21 features, 5 roles (17 role units), 8 envs, 13 connectors resolve (agent profile claude-code)` (line before: `✓ lint clean`; the same four warnings as before).
- `./bay.sh check --base origin/main --proposal docs/proposals/0008-simplify-without-losing-features.md --docs` last line: `boundary origin/main...HEAD: 74 changed paths (27 core, 2 docs, 25 extension, 1 feature, 19 other); 0 failing; B-11 docs: 0 hits`.
- `./bay.sh build --project <scratch>/s6f`: `built 6 modes for claude-code`; `./bay.sh clean --project <scratch>/s6f`: last line `clean`; Glob `**/*` of s6f afterwards: only `agentbay.config.yaml` (the input I wrote).
- Baselines: `test_guard_decision_matrix` and `test_guard_matrix_for_a_project_with_the_kit_outside` pass with `tests/golden/guard-matrix*.json` UNCHANGED. EXPECTED_DELTAS rows: none (D3 adds no path to the policy in the old layout: every protected instance is inside `framework/`; D4 changes no guard decision; the D9 sync needs no new `fs.write` entry yet). `test_improve_golden` passes with `improve.json` unchanged; `test_stage_syntax_table` passes with `stages.json` unchanged. Security tests unchanged (`test_boundaries.py:296` still asserts the four dirs and passes); new cases are in `tests/test_protection.py`: role without forge.extend cannot write a map-listed path, user extension named like a protected one refused, edit and new folder of a protected component fail `check --base` without `touches:`, chat and terminal approvals both pass the gate, D4 (resolver and lint refuse, `bay approve <F-id>` works, chat refused), D9 lint both ways, closure, stale policy, 14 malformed/missing block variants fail closed.

# HANDOFF part 27: T-20261031-edd9 (recorded with `bay plan`) - stage 5 part E built (one workflow syntax, validator, skip and advance rule)

Outcome: done. One code commit, dffef42, on feat/0008-stage5. No proposal edited; every path is in 0008's touches (boundary below).

## To-do
| Item | Commit | What |
|---|---|---|
| E1 parser | dffef42 | `bay/workflows.py` is the one stage-syntax module: the reference grammar once (`FIELD`, `PATH`, `REFERENCE`, `WHEN_PATTERN`, `FEATURE_WHEN_PATTERN`, `APPROVES_PATTERN`), `Stage` (also `Stage.of_step` for a mode step), `check_stages` (the validator for both), `skip`, `substitute` (moved from `bay/dispatch.py`, gone there), `advance` + `Move` (the cursor rule) |
| E2 callers | dffef42 | `model._feature_steps` builds `Stage`s and calls `check_stages` (gate steps now carry `when` so the check sees it); `Dispatcher._skip` is `workflows.skip` plus a `fresh` callback for `stale > age`; `workflow_runner._advance` is `workflows.advance` plus the run file bookkeeping. Two executors kept (D6) |
| E3 D7 | dffef42 | a gate with `when` in a project workflow: `structure_problems` (so `bay check` / lint) says `... step g: a gate takes no when: it passes only by `bay approve <runId>` ... Remove `when:` from this gate (put `when:` on the call stages around it ...)`; `advance` returns `refused` for it and the run fails with that text; `skip(gate=True)` is always False. The config schema still allows the key, so the message is the structure one, not a schema pattern error |
| E4 D8 | dffef42 | one union grammar: a project `when` takes `!`; a feature `when` takes hyphens, nested paths, a step id in capitals and `$steps.<name>` without a field; `approves` takes the same paths. Schema patterns in `config.schema.json` / `mode.schema.json` equal the constants (test) |
| HANDOFF | this commit | |

## What part F (and later parts) must know
- `workflows.py` no longer imports `model` at module level (lazy imports in `effects`, `_check_call`); `model.py` imports `workflows as wfmod`.
- `stages.json` is UNCHANGED. `test_stage_syntax_table` undoes `EXPECTED_DELTAS` (rows checked against their new value, then put back to the golden's value; `OLD_PATTERNS` undoes the pattern text that schema messages quote; `EXPECTED_RUNNER_DELTAS` for the two `cos.next` rows) and then compares to the untouched golden. Deltas: project `when` `!$in.x`, `!$steps.a.x` accepted (D8); feature `when` `$in.x-y`, `$in.x.y`, `$steps.a.x-y`, `$steps.a.x.y`, `$steps.a`, `$steps.A.x` accepted (D8); project gate with `when` `$in.x`, `$steps.a.x`, `!$in.x`, `!$steps.a.x`, `$steps.nope.x` refused (D7). A gate with `when: stale > 2h` was and is a schema refusal. Nothing accepted before is refused except the D7 rows.
- New tests (`tests/test_stage_syntax.py`): grammar spelled once in code and schema patterns equal it; dispatcher and cursor share skip/substitute; D7 refused at `structure_problems` and `lint.run`; no output passed to `cos.next` skips a gate (cursor refuses and the run fails; `skip(gate=True)`), a gate without `when` still waits.
- Kept lenient on purpose so nothing accepted before is refused: a project `$steps.<name>` with no field or a capital id is not order-checked (as before); the `approved $in.f` feature form still crashes `Dispatcher._skip` with IndexError (recorded in the golden, not mine to fix here).
- The `_grammar_problems` check repeats the schema patterns in code so the validator is right for a stage built in code; it also keeps the three pattern constants read in code (the kit audit's unused-constant count stayed 0 new; the improve golden is untouched).
- Docs not touched (not in part E's touches): `docs/INTERFACES.md:164` still describes project stages; slice 9 can add that a project gate takes no `when`.
- `-k` is the test filter (`python3 tests/run.py -k name`); a bare file name runs everything.

## Evidence (run at dffef42)
- `python3 tests/run.py -q` last line: `521 passed, 0 failed` (515 + 6 new).
- `./bay.sh check` last line: `✓ 6 modes, 21 features, 5 roles (17 role units), 8 envs, 13 connectors resolve (agent profile claude-code)` (line before: `✓ lint clean`; the same four warnings as before).
- `./bay.sh check --base origin/main --proposal docs/proposals/0008-simplify-without-losing-features.md --docs` last line: `boundary origin/main...HEAD: 65 changed paths (22 core, 24 extension, 1 feature, 18 other); 0 failing; B-11 docs: 0 hits`.
- `./bay.sh build --project <scratch>/s6e`: `built 6 modes for claude-code`; `./bay.sh clean --project <scratch>/s6e`: last line `clean`; Glob `**/*` of s6e afterwards: only `agentbay.config.yaml` (the input I wrote).
- Baselines: `tests/golden/` has no change in dffef42 (`git show --stat dffef42` lists no golden); `test_improve_golden`, `test_guard_decision_matrix`, `test_guard_matrix_for_a_project_with_the_kit_outside` and `test_stage_syntax_table` pass in the full run. Security tests unchanged; `test_workflows.py` and `test_dispatch.py` not edited.

# HANDOFF part 26: T-20261031-653a (recorded with `bay plan`) - stage 5 part D built (sources and transcripts moved; bay/improve/ removed)

Outcome: done. One code commit, cd8ba96, on feat/0008-stage5 (D1 to D5 are one commit: the moves, the imports and the tests cannot be green separately). No proposal edited; every path is in 0008's touches (boundary below).

## To-do
| Item | Commit | What |
|---|---|---|
| D1 | cd8ba96 | `git mv bay/improve/transcripts.py framework/connectors/claude-transcripts/parser.py` (entry `transcripts.py` imports `from .parser import TranscriptSource`); test imports `connector_pkg("claude-transcripts", "parser")` |
| D2 | cd8ba96 | `sources.py` -> `ledger/ledger_sources.py` (ledger part, `git mv`) and `git/git_episodes.py` (git part: `REVERT_BODY`, `MAX_SUBJECT`, `git_episodes`); `ledger.py`, `git_history.py` import them; tests follow (`test_git_connector.py`, `test_review_record.py`) |
| D3 | cd8ba96 | `fingerprint` defined once, in `bay/util.py`; `store.py` and `pipeline.py` import it; the shared-vector test is kept in both connector tests (each asserts `62f5b3fa536c7238`) |
| D4 | cd8ba96 | `bay/improve/__init__.py` removed last; wording fixed in `framework/modes/improve/{config.example.yaml,config.schema.json,features/scan/playbook.md}`, connector docstrings, `test_improve_golden.py` (`MOVING` loses `bay/improve/`), `test_deadcode_check.py` (path of `ledger_verdicts`) |
| D5 | - | no golden change, so no new `EXPECTED_DELTAS` entry (the only one is still part C's `inefficient-store-read` 3 -> 5) |
| HANDOFF | this commit | |

## What part E (and later parts) must know
- improve-store's `read_events` use: `bay.ledger.read` is not equal (it accepts any dict and does not require `type`, `ts`, `runId` strings; it splits on `\n` and decodes strictly), so `improve_store.py` has a 12-line `_read_events` (the `read_events` behaviour without the warnings list, which the backlog never passed). `ledger_sources.read_events` stays in `ledger/` for the ledger connector. If part E wants one reader, make it a deliberate change to `bay/ledger.py` (not in touches).
- Left on purpose: `tests/test_guard_matrix.py:31` still lists the sample path `bay/improve/pipeline.py` and `tests/golden/guard-matrix.json` has its rows (a non-existent file in the protected `bay/` dir, used as a "new file under bay/" probe). Renaming it changes the baseline's row keys; part F/G may swap it for another `bay/` sample in the test and golden together. Not in touches (tests are `other`).
- `bay/improve/__pycache__/` is left on disk, untracked and ignored (the allowed commands cannot delete it); `git ls-files bay/improve` is empty. Delete it by hand.
- The kit-audit counts did not change (no new `EXPECTED_DELTAS`): `ledger_sources.py` and `git_episodes.py` add no unused function, long function or store re-read.
- `tests/helpers.connector_pkg("ledger", "ledger_sources")`, `("git", "git_episodes")`, `("claude-transcripts", "parser")` load the new siblings.

## Evidence (run at cd8ba96)
- `python3 tests/run.py -q` (run before the commit, same tree): `515 passed, 0 failed`. Includes `test_improve_golden`, the guard matrix pair, `test_stage_syntax_table`, `test_improve.py` (terminal-only approval, :225-245 unchanged), the improve-store tests (import lines only) and both `test_fingerprint_matches_the_shared_vector`.
- `./bay.sh check` last line: `✓ 6 modes, 21 features, 5 roles (17 role units), 8 envs, 13 connectors resolve (agent profile claude-code)` (line before: `✓ lint clean`; the same four warnings as before).
- Boundary: `boundary origin/main...HEAD: 59 changed paths (17 core, 23 extension, 1 feature, 18 other); 0 failing; B-11 docs: 0 hits`.
- `./bay.sh build --project <scratch>/s6d`: `built 6 modes for claude-code`; `./bay.sh clean --project <scratch>/s6d`: last line `clean`; Glob `**/*` of s6d afterwards: only `agentbay.config.yaml` (the input I wrote).
- Baselines: `test_improve_golden` passes with the golden file untouched (`git diff` of `tests/golden/` is empty in cd8ba96); `test_guard_decision_matrix`, `test_guard_matrix_for_a_project_with_the_kit_outside` and `test_stage_syntax_table` pass; no golden file is in the commit.
- `git grep -n -E "bay[./]improve"` outside HANDOFF, proposals and goldens: one hit, the guard-matrix sample path above. Nothing outside 0008's touches needed an edit (no blocker).
- CLI comparison: `catalog` equals `s5-cli-baseline/catalog.txt` line for line except the `registry built` timestamp. `describe improve` has 16 `"connector": improve-detect|improve-store` steps, as in `describe_improve.txt` (16). `check` output is the same four warnings as `check.txt`. cos, forge, `catalog.json`, `--roles` were not re-run (nothing in part D touches them).

# HANDOFF part 25: T-20261031-4d3f (recorded with `bay plan`) - stage 5 part C built (improve-detect and improve-store receive their code)

Outcome: done. One commit, a4bec9b, on feat/0008-stage5 (C1, C2, C3 are one commit: the moves, the fingerprint copy and the test imports cannot be green separately). `bay/improve/` keeps `__init__`, `sources`, `transcripts` for part D (it deletes the folder). No proposal edited; every path is in 0008's touches.

## To-do
| Item | Commit | What |
|---|---|---|
| C0 | - | CLI baselines read from s5-cli-baseline (comparison below) |
| C1, C2, C3 | a4bec9b | moves, fingerprint copy with shared vector, tests follow, yaml text |
| golden delta | a4bec9b | coordinator decision on C-20261031-953c87: `kitAudit` `inefficient-store-read` 3 -> 5, named in `EXPECTED_DELTAS` in `test_improve_golden.py` (asserts was/now/reason, then the whole file compares) |
| HANDOFF | this commit | |

## What part D must know
- The 3 -> 5 delta: the detector scans only `/connectors/` files, so `Store.query` and `Store.claim` count since store.py moved. Moving `sources.py` pieces into `ledger/` and `git/` (already under connectors/) may add more: check `kitAudit.countsPerKind` and name each change in `EXPECTED_DELTAS`.
- `tests/helpers.connector_pkg(name, module=None)` loads a connector as the runtime does and reuses the load while the folder is the same; use it for new sibling modules (`parser.py`, `ledger_sources.py`, `git_episodes.py`).
- `improve_store.py` still imports `from bay.improve import sources` (read_events); part D changes that.
- `MOVING` in test_improve_golden still lists `bay/improve/`; the moved files are under `framework/connectors/` there, so A4 still covers them.

## Done
- `git mv` of pipeline, detect_artifacts, detect_sessions to `framework/connectors/improve-detect/`; store, report to `framework/connectors/improve-store/`. Imports are `from bay import ...` and sibling `from . import ...`;
  `improve_detect.py` uses `from .pipeline import Pipeline`; `improve_store.py` uses `from . import store as st` (still `from bay.improve import sources` until part D). `bay/improve/` now holds `__init__`, `sources`, `transcripts`.
- `fingerprint` is in `store.py` and copied into `pipeline.py`; both connector tests assert one vector (`unused` + `fn:app/core.py:never_called` -> `62f5b3fa536c7238`, from `tests/golden/improve.json`).
- `tests/helpers.connector_pkg(name, module=None)` (one load per folder, so siblings stay one set); `test_deadcode_check.py`, `test_improve.py`, `test_improve_detectors.py`, `test_improve_golden.py:mods()`, `test_improve_store.py` use it. Connector yaml text updated.

## Evidence (run at a4bec9b)
- `python3 tests/run.py -q`: `515 passed, 0 failed` (513 + the two fingerprint-vector tests, one per connector). A first run before the delta decision gave `514 passed, 1 failed` (`test_improve_golden`, the one number).
- `./bay.sh check` last line: `✓ 6 modes, 21 features, 5 roles (17 role units), 8 envs, 13 connectors resolve (agent profile claude-code)` (line before: `✓ lint clean`; the same four warnings as `s5-cli-baseline/check.txt`, which it equals line for line).
- Boundary: `boundary origin/main...HEAD: 48 changed paths (17 core, 14 extension, 17 other); 0 failing; B-11 docs: 0 hits`.
- `./bay.sh build --project <scratch>/s6c`: `built 6 modes for claude-code`; `./bay.sh clean --project <scratch>/s6c`: last line `clean`; Glob `**/*` of s6c afterwards: only `agentbay.config.yaml`.
- Baselines: `test_improve_golden` passes (only the named delta; `git diff` of `improve.json` in a4bec9b is that one line); `test_guard_decision_matrix` and `test_guard_matrix_for_a_project_with_the_kit_outside` pass; `test_stage_syntax_table` passes; `guard-matrix*.json` and `stages.json` not in the commit.
- CLI baseline comparison: `catalog` equals `catalog.txt` line for line except the `registry built` timestamp. `describe improve` has 16 `"connector": improve-detect|improve-store` steps, as in `describe_improve.txt` (connector names, not paths, so nothing moves). `check` equals `check.txt`. cos, forge, `catalog.json`, `--roles` were not re-run (nothing in part C touches them).

# HANDOFF part 24: T-20261031-68cb (recorded with `bay plan`) - stage 5 parts A and B built (baselines, then core prep)

Outcome: status done for A1 to A4 and B1 to B3 (A5, the CLI baselines, was not taken: see open items). Branch feat/0008-stage5, 7 commits on top of
the part 23 plan commits (b17040c, 7778467). No proposal edited; every path is in 0008's touches (boundary below).

## To-do and shas
| Item | Commit | What |
|---|---|---|
| A1 | 4055b85 | `tests/test_improve_golden.py` + `tests/golden/improve.json` (+ `tests/golden_util.py`, the shared compare: missing file is written and the test fails once, as `test_offline_golden.py`) |
| A2 | 67dc3c7 | `tests/test_guard_matrix.py` + `tests/golden/guard-matrix.json`, `guard-matrix-project.json`, `tests/layout.py` (`physical(logical)`) |
| A3 | 440e014 | `tests/test_stage_syntax.py` + `tests/golden/stages.json` |
| A4 | c2423dc | `test_moving_files_have_no_deadcode_findings` (in `test_improve_golden.py`); it found `CorpusStore._sync_source` (complexity), fixed by extracting `_plan_source` and `_backfill` |
| B1 | bf9f255 | `bay/connect.py:_load_module`: `submodule_search_locations=[folder]`, stale `agentbay_connector_<name>*` modules dropped first; `tests/test_connector_packages.py` (3 tests) |
| B2 | 1f6442d | `bay/util.py`: `short_hash`, `in_window`, `warn` (+ `MAX_WARNINGS`); `tests/test_util.py` (3 tests); importers updated; `bay/improve/__init__.py` is a docstring only |
| B3 | 546ad51 | `git mv` of `graph.py` and `conformance.py` to `bay/`; importers, `lint.py:877,880`, artifact-graph code and yaml text, `schemas/conformance.schema.json:5`, three tests. `bay/improve/` now holds 8 modules |

## What part C (and later parts) must know
- Baseline files and where they take their imports. `tests/test_improve_golden.py` imports improve's modules only in `mods()` (returns detect_artifacts, graph, pipeline, report, store):
  part C/D change that one function (and `FakeGraph` uses `mods()[1]`). The golden has six sections (scan, audit, kitAudit, routes, reports, change); `git diff` of `tests/golden/improve.json` must stay empty.
- One edit to a baseline, made in A4 on purpose: `kitAudit.countsPerKind.complexity` 9 -> 8 (the corpus-store fix). The kit audit counts every kind (complexity 8, doc-size 2, doc-stale 2,
  inefficient-store-read 3, slop-duplicate-rule 15, unused 5): a part that adds or removes an unused function, a long function, a doc over 3,000 words or a stale doc reference changes it and must say so.
- The A4 test scans the paths in `MOVING` (`bay/improve/`, `bay/graph.py`, `bay/conformance.py`, `bay/util.py`, `framework/connectors|modes|envs/`). Part G must change that tuple to the moved paths
  (`connectors/`, `modes/`, `envs/` hold user extensions with findings of their own, for instance `connectors/gmail-api`: complexity x2 and unused x3, which never move, so restrict to the protected instances).
  Parts C and D: the moved files must still pass it (`improve-detect/`, `improve-store/` files are under `framework/connectors/`).
- Guard matrix: rows are keyed `<tool> <logical path or command>` per caller (`main thread`, `Explore` = unknown subagent, 5 units). `tests/layout.py:physical` maps `mode:cos/mode.yaml`, `env:cos-local`,
  `connector:ledger/ledger.py` to `framework/...` when that folder exists in the kit and to the top-level folder otherwise, so part G needs no edit to the test for those rows. The golden holds reasons too
  (they name physical paths, e.g. `framework/modes/improve/mode.yaml`): after G, reasons of moved rows change in path text only; compare decisions first (index 0 of each row), then reasons with paths mapped.
  Also in the golden: `policy` (protected list = the four dirs), `protectedWrites` per env (via `model.protected_writes`, which part F re-signatures: update `protected_view`), `resolverGaps` (the three
  test_resolver gaps, run on a kit copy), `lintWarnings` (the "reaches" text). `guard-matrix-project.json` is a normal project with the kit outside (autoAllowShim true, empty protected list).
- Stage-syntax table: `stages.json` holds, for 36 `when` forms, the project-workflow and feature-step verdicts (schema errors appear in the feature table as layer `resolve`, because `model.resolve` wraps SpecError; the message
  quotes the pattern, so part E changes those lines when it unifies the pattern), 6 gate-with-`when` forms, 21 `with` values, `Dispatcher._skip` rows and `workflow_runner._advance` rows (via `cos.run`/`cos.next`).
  Known today (for D6 to D8): feature `when` accepts `!`, `approved $in.f`, `stale > 2h`, no hyphens, no nested `$in.x.y`; project `when` accepts hyphens and nested paths, no `!`;
  a feature gate with `when` is refused by `_feature_steps`; a project gate with `when` is accepted and skipped by `_advance`.
- B1: a connector folder is now a package named `agentbay_connector_<name>`; siblings load as `agentbay_connector_<name>.<sibling>`. B-7 (`lint_extension_names`) scans every `.py` in the folder, and a
  sibling or import named like another connector's entry stem is flagged unless both are framework instances; `from . import x` (no dotted module) is not flagged. In part C, improve-detect's siblings
  (`pipeline`, `detect_artifacts`, `detect_sessions`) and improve-store's (`store`, `report`) do not collide with any entry stem today (entries: artifact_graph, transcripts, corpus_store, git_history, improve_detect, improve_store, ledger, scaffold, workflow_runner, ...);
  note `claude-transcripts` has an entry called `transcripts.py`, so part D must name the parser `parser.py` (as planned) and not `transcripts.py`.
- B2: `bay.util.warn` keeps the cap (20) the old `sources.warn` had. `sources.py` still has `read_events`, `ledger_*`, `git_episodes`, `REVERT_BODY`, `MAX_SUBJECT`, `LEDGER` for part D.
- `fingerprint` is still in `bay/improve/store.py` (part C copies it); A1's golden records every fingerprint, which is the shared test vector.
- Not run: the real dead-code step (`improve.detect/v1.change` through forge.extend needs a call); A4 is its precondition and passes, and nothing in B adds a function that is unused.

## Open items
- A5 (CLI baselines of `check`, `catalog`, `catalog --roles`, `describe cos|forge|improve|improve-local` saved in the scratchpad) was not taken: the one-command-at-a-time rule gives no way to save output without a redirect,
  and the outputs are long. Part G needs them: take them at the start of part C (before any yaml moves) with `Write`, or compare against `origin/main` by checking it out in a second worktree.
- Amendments listed in section 4 of part 23 still wait for the owner. The boundary check above reports 0 failing on the `touches:` as they are in 0008 now (the plan commit 7778467 added the stage-5 entries), so nothing was blocked in A or B.
- The "Known today" line in the stage-syntax note above is read from the schemas and validators; the exact accept/reject of each form is in `tests/golden/stages.json`, which is the reference.

## Evidence (run at 546ad51, before this file was committed)
- `python3 tests/run.py -q`: `513 passed, 0 failed` (part 23 baseline 502; +11 = improve golden, moving-files deadcode, guard matrix x2, stage syntax, connector packages x3, util x3).
- `./bay.sh check` last line: `✓ 6 modes, 21 features, 5 roles (17 role units), 8 envs, 13 connectors resolve (agent profile claude-code)` (line before: `✓ lint clean`; the same four warnings as at f635890).
- `./bay.sh check --base origin/main --proposal docs/proposals/0008-simplify-without-losing-features.md --docs` last line: `boundary origin/main...HEAD: 33 changed paths (15 core, 3 extension, 15 other); 0 failing; B-11 docs: 0 hits`.
- `./bay.sh build --project <scratch>/s6a` then `./bay.sh clean --project <scratch>/s6a`: built 6 modes (34 files listed), clean removed them (last line `clean`). Glob `**/*` of the scratch folder afterwards: only `agentbay.config.yaml` (the input I wrote).
- Baselines on the untouched code (A1 to A3, each commit run with `python3 tests/run.py -k ...`): `test_improve_golden` passed (also twice in a row); `test_guard_decision_matrix` and `test_guard_matrix_for_a_project_with_the_kit_outside` passed;
  `test_stage_syntax_table` passed (twice). After B1, B2, B3: the same tests passed unchanged (goldens identical, `git diff 440e014 -- tests/golden/guard-matrix.json tests/golden/stages.json` empty; `improve.json` differs from A1 only by the A4 complexity line).
- `git status` clean at the end except this file.

# HANDOFF part 23: T-20261030-67d2 (recorded with `bay plan`) - stage 5 of 0008 planned (slices 6 and 7: improve as a plain mode, one workflow syntax, top-level extension folders)

Outcome: stage 5 is split into eight sequential builder parts (A to H), each a green commit with its own acceptance, and every path
is listed with its `touches:` status. No code changed; no proposal edited. Branch feat/0008-stage5 (from origin/main f635890, 0.8.0).
All line numbers are at f635890. Baseline: `python3 tests/run.py -q` = 502 passed; `./bay.sh check` = `6 modes, 21 features, 5 roles
(17 role units), 8 envs, 13 connectors resolve`. Three places where 0008 and the code disagree need the owner (section 5, D3 to D7).

## 1. Current state

bay/improve/ (3,281 lines, 10 files) and who imports it
- `__init__.py` 22 (`short_hash`); `detect_artifacts.py` 766; `detect_sessions.py` 367; `pipeline.py` 396; `store.py` 291; `report.py` 78;
  `sources.py` 370; `transcripts.py` 490; `graph.py` 358; `conformance.py` 324.
- Core imports it once: `bay/lint.py:880` (`conformance.lint`, via `lint_rulesets`). `bay/cli.py:408` does not import it but names the mode
  and capability (`run_capability("improve", "improve.findings/v1.decide", ...)`, `_decide_finding` :390); `bay improve` itself went in stage 4.
- Connectors import it (all under `framework/connectors/`): `artifact-graph/artifact_graph.py:6` (graph), `claude-transcripts/transcripts.py:7-8`
  (sources.in_window, TranscriptSource), `git/git_history.py:2` (sources.git_episodes), `ledger/ledger.py:2` (sources.ledger_*),
  `improve-detect/improve_detect.py:3` (Pipeline), `improve-store/improve_store.py:8` (sources.read_events, store). Their tests too:
  `claude-transcripts/tests/test_claude_transcripts.py:11`, `git/tests/test_git_connector.py:9`, `improve-store/tests/test_improve_store.py:9`.
- Tests: `tests/test_deadcode_check.py:12,13,116,163,248,250`, `test_improve.py:314`, `test_improve_detectors.py:9`, `test_review_record.py:12`.
- Inside: `pipeline.py:20-21` uses conformance, detect_*, graph (`graph.build/files` for the base tree, :244,:248), `short_hash`, `store.fingerprint`;
  `detect_artifacts.py:22` uses `graph.SKIP_DIRS`; `store.py:23` uses `report`, `short_hash`; `transcripts.py` and `sources.py` use `short_hash`.
- Two couplings to the old layout: `improve_store.py:15` lists `framework/modes/` to build the set of "framework modes"; `store.py:30`
  `FRAMEWORK_DIRS = ("framework/", "bay/", "schemas/", "docs/", "tests/")` and :84-88 `route_for` send those findings to `forge.extend`.
- Connectors are loaded by `bay/connect.py:112-121` with `spec_from_file_location` and no sibling search path, so a connector today is one
  file (gmail-api runs its second file as a subprocess). That is why `sqlsandbox.py` lives in core. improve's 10 modules cannot move as they are.
- Findings are fingerprinted by `kind|detector key`, and the key holds the file path (`detect_artifacts.py:445,503,701`, node ids `fn:<path>:<name>`).
  A moved file's existing dead-code finding is therefore NEW at the new path and would block the dead-code step.

Workflows: two stage-syntax implementations, one shared substitution
- Mode features: `schemas/mode.schema.json:318-341` (with, when pattern, gate, approves); `bay/model.py:1111-1151` `_feature_steps` (ids,
  earlier-step refs :1142-1147, gate takes no `when` :1131); `Step` :446-460; run by `Dispatcher._skip` (`dispatch.py:385-399`) and the gate code (:401-430).
- Project workflows: `schemas/config.schema.json:55-124`; `bay/workflows.py` (`Stage`/`Workflow` :43-64, `load` :67, `structure_problems` :122,
  `_check_dollars` :143, `target_problems` :165, `_check_ref` :202); run by `framework/connectors/workflow-runner/workflow_runner.py` `_advance` :94-121.
- Shared already: `dispatch.substitute` :797-821 (imported by `workflow_runner.py:19`). The `$` reference grammar is spelled five times:
  `workflows.py:38-40`, `mode.schema.json:324`, `config.schema.json:112`, `model.py:1143`, `dispatch.py:390`.
- They disagree. Mode `when` allows `!` and `stale > 2h`, field names without hyphens; workflow `when` has no `!`, allows hyphens and nested paths.
  A mode gate may not have `when` (`model.py:1131`, 0006 slice 7a); a project gate may: `_advance` evaluates `when` before the gate (:105-114), so a
  falsy `when` skips the gate. The `when` value comes from the output the coordinator passes to `cos.next`.
- cos: `framework/modes/cos/mode.yaml` (features run, next, status; role lead in env cos-local; needs workflow.run/v1). It has no code of its own.

Protection is hard-coded in six places
- `bay/model.py:59` `PROTECTED = ("framework", "bay", "schemas", "adapters")`; :1331 `protected_writes` (first path part in PROTECTED); :1341 `_check_protected`
  (called :1177; skipped for `forge.extend`); `adapters/claude-code/claude_code.py:46,440` writes it to `.agentbay/guard.json` as `protected` when
  the project is the kit; `bay/guard.py:373-380` `_write_denied` denies a protected folder unless a path in the role's env `fs.write` is at or under it;
  `bay/lint.py:586-595` warns for env write paths that reach it. `bay/boundary.py` has no protection concept (B-1..B-4 by `owns:`/`at:`).
- Whole top-level folders are protected, so everything under `framework/` (incl. improve) is protected by location. Guard tests:
  `tests/test_boundaries.py:290-321` (asserts `pol["protected"] == ["framework", "bay", "schemas", "adapters"]`, :296).
- Two roots, "framework" and "user" (`model.py:172,201`; KINDS :44-50). Effects of the root: `Kit.collisions` (:204,:325-330; lint.py:680; model.py:947;
  tests `test_lint.py:239-246`), `USER_FRAMEWORK_ENVS = ("workspace","research")` and :791, `lint.py:557` (B-7: framework connectors may load each other),
  `lint.py:652` (README only for user modes/connectors), `registry.py:56` and `cli.py:232` (`origin`), `scaffold.py:50-56` ("is a framework name").

What the folders hold
- `framework/modes/`: cos, forge, improve (3; `delivery` is already `modes/delivery/`, not here). `framework/envs/`: cos-local, framework-dev, improve-local,
  local-authoring, research, workspace. `framework/connectors/`: artifact-graph, claude-transcripts, corpus-store (owned by briefing, `components.yaml:25`), git,
  improve-detect, improve-store, ledger, scaffold, workflow-runner. `framework/` also: roles/, rules/, interfaces/, components.yaml. The agent profile is already
  in `adapters/claude-code/adapter.yaml` (slice 2), so 0008's "framework/ keeps ... the agent profile" is already true.
- Top level today: `modes/` briefing, delivery, feed-briefing, mail-briefing; `envs/` local-feeds, local-mail; `connectors/` fake, fake-mail, gmail-api, x-api.
- forge needs envs local-authoring, framework-dev, workspace, which bind connectors scaffold, improve-detect (the dead-code step), ledger, artifact-graph.
  cos needs cos-local, which binds workflow-runner.

## 2. Target (0008 items 4, 5, 7)

Where improve's code lands (`bay/improve/` gone)
| Module | Lands in | Why |
|---|---|---|
| detect_artifacts, detect_sessions, pipeline | `improve-detect/` (entry improve_detect.py + 3 siblings, 1,529 lines) | only improve-detect uses them |
| store, report | `improve-store/` (357 lines) | only improve-store uses them |
| transcripts | `claude-transcripts/` as `parser.py` (490) | only that connector |
| sources, ledger part (read_events, ledger_episodes, ledger_verdicts, review items) | `ledger/` | ledger connector (improve-store's `read_events` use: `bay.ledger.read` if equal, else a 18-line copy) |
| sources, git part (git_episodes, REVERT_BODY, MAX_SUBJECT) | `git/` | git connector |
| graph (358) | `bay/graph.py` | used by artifact-graph AND improve-detect; B-7 forbids one connector loading the other |
| conformance (324) | `bay/conformance.py` | used by core lint AND improve-detect; core must not import an extension |
| short_hash, in_window, warn | `bay/util.py` | used by 4+ connectors |
| fingerprint (3 lines) | copied into improve-store and improve-detect, one shared test vector in both tests | the algorithm is the finding contract |
Net: 2,758 lines leave core; about 700 stay in core as ordinary modules (D1).

To make that possible, `bay/connect.py:_load_module` passes `submodule_search_locations=[c.dir]`, so a connector's siblings import as `from . import x` (D2).

Workflows: `bay/workflows.py` becomes the one stage-syntax module (no new file): the reference grammar (one regex), `Stage` parsed from either a mode step or a
project stage, `check_stages` (ids, earlier-step refs, `$in` declared, `$`-values, gate takes no `when`), `skip(when, inp, steps)`, `substitute`, and
`advance(stages, cursor, inp, results)` (skip, gate, or next call). `model._feature_steps`, `Dispatcher._skip`, `workflow_runner._advance` and the two
schema `when` patterns use it. `workflows.py` must not import `model` at module level (model imports it); its two model uses become lazy imports.
cos stays a mode on `workflow.run/v1`; the cursor keeps handing back `nextCall` (D6).

Top-level layout and the map
- After G: `modes/` (briefing, cos, delivery, feed-briefing, forge, improve, mail-briefing), `envs/` (8), `connectors/` (13), `content-types/`, `adapters/`, `bay/`, `schemas/`.
  `framework/` = `roles/`, `rules/`, `interfaces/`, `components.yaml`.
- `framework/components.yaml` gains a `protected:` block and loses the `framework/<kind>/` variants of the three `at:` lists and `framework/connectors/corpus-store/`
  (briefing now owns `connectors/corpus-store/`). Proposed shape (schema in `schemas/components.schema.json`):
```
protected:                                  # writable only through forge.extend; these names are reserved
  paths: [framework, bay, schemas, adapters]   # was PROTECTED, same spelling and order
  mode: [cos, forge]                           # improve is listed too until part H, so G is a pure move
  env:  { cos-local: {}, framework-dev: {}, improve-local: { modes: [improve] }, local-authoring: {},
          research: { modes: ["*"] }, workspace: { modes: ["*"] } }     # `modes:` = unprotected modes that may place roles here (was USER_FRAMEWORK_ENVS)
  connector: [artifact-graph, claude-transcripts, corpus-store, git, improve-detect, improve-store, ledger, scaffold, workflow-runner]
```
- Readers: the adapter builds `guard.json` `protected` from the map (the guard keeps reading its policy; the policy now has the four dirs first, then one path per
  protected instance); `model.Kit` loads the map once (`Kit.protected`), replacing `PROTECTED`, `USER_FRAMEWORK_ENVS`, `Doc.root` and `collisions`;
  `boundary.classify` makes a path of a protected instance pass only when listed, even if the folder is new; `lint` checks the map (every name exists, closure:
  each env a protected mode maps and each connector those envs bind is protected, `framework-dev` names every protected path in `fs.write`).
- Reserved names with one folder per kind: a name cannot be defined twice, so "taking" one means replacing it. It is stopped by the guard (role writes), by the boundary
  (edit needs `touches:`, no new-extension pass), by `bay new` (refuses a protected name) and by lint (a protected name must exist as that kind; a mode.yaml cannot mark itself protected).
- improve: mode folder ordinary (no map entry after H). Its env and all nine connectors stay protected (D3). `decide` becomes `ownerOnly` (D4).

## 3. Split (sequential; each part ends with `python3 tests/run.py -q` green, `./bay.sh check` clean, dead-code step with no new findings, one commit)

Common rules (lessons of parts 15-22): the baseline is its own first commit, taken from untouched code; `git mv` for every move (the boundary check splits renames, so both
sides are classified: see section 4 for the B-3 trap); delete replaced code completely; functions stay under complexity 30 and 150 lines (`_load_module`, `Kit.__init__`,
`Guard._write_denied`, `lint.run` and `_feature_steps` are close: extract before adding); reword the README/DESIGN/INTERFACES lines a part exposes (B-11); the builder lists any
missing amendment in its HANDOFF instead of editing the proposal.

Part A: baselines (about 30 calls). No behaviour change.
1. First commit: `tests/test_improve_golden.py` + `tests/golden/improve.json`, from untouched code. It records, on test-built fixture data (so the kit move cannot change it):
   (a) `improve.scan`: `previous.detect` candidates (kind, lens, title, severity, scope, evidence refs, detector key, fingerprint), `stats`, and the rows of `findings.jsonl` after the
   `store` step (ts dropped), from `improve_fixtures.make_transcripts/make_ledger`; (b) `improve.audit` on a fixture project tree written by the test (unused function and constant, compat
   alias, over-complex function, oversize and stale doc, broken link): candidates, `stats`, `manual`; (c) `improve.audit {root: "kit"}`: counts per kind only, and zero
   conformance findings; (d) `Store.route_for` for a table of scopes (framework file, bay file, mode cos, mode forge, mode improve, a user mode, docs, tests); (e) `report.backlog` and `report.handoff`
   text for a fixed findings file; (f) `change` on a two-commit temp repo (exists in `test_deadcode_check.py`; keep). The golden is the compare: a changed file means changed behaviour.
2. `tests/test_guard_matrix.py` + `tests/golden/guard-matrix.json`: build the kit as its own project (as `test_boundaries.py:290-296`), then for each unit
   (`builder--delivery`, `builder--forge--local-authoring`, `builder--forge--framework-dev`, `reviewer--forge`, `analyst--improve`) and tool `Write` the decision for about 45 LOGICAL paths:
   each protected dir file, one file per shipped mode/env/connector (`mode:cos/mode.yaml`, `env:improve-local`, `connector:improve-store/connector.yaml`, ...), user space, `bay.sh`, `docs/`, `.agentbay/`.
   A small `layout.physical(logical)` helper returns today's path (`framework/modes/cos/mode.yaml`) and, after G, the new one. Also record `protected_writes(env)` for the 8 envs, the gap text of
   `test_resolver.py:165-175`, the policy `protected` list, and `lint.warnings` text about protected reach.
3. `tests/golden/stages.json` + `tests/test_stage_syntax.py`: a table of broken and valid `when`/`with`/`gate` forms, each run through the project-workflow validator and the feature-step validator (current
   messages, current accept/reject, including the gate-with-`when` difference), and a table (when, input, steps) -> skipped, through `Dispatcher._skip` and `workflow_runner._advance`.
4. Dead-code precondition: add `test_moving_files_have_no_deadcode_findings` (detect_artifacts over the kit, kinds unused, unused-constant, compat-layer, complexity, restricted to improve's code, the shipped
   connectors and the shipped modes, by logical id). If it fails, fix those findings now: after a move they would be new.
5. Save CLI baselines in the scratchpad with Write: `check`, `catalog`, `catalog --roles`, `describe cos|forge|improve|improve-local`.
Acceptance: all new tests pass on the untouched code; goldens committed before any other change; nothing else touched.

Part B: core prep for the move (about 35 calls)
1. `bay/connect.py`: connector packages (D2) + test (a two-file connector loads; relative import works; a sibling named like another connector's entry is still caught by B-7).
2. `bay/util.py`: `short_hash`, `in_window`, `warn` (moved from `bay/improve/`); callers updated.
3. `git mv bay/improve/graph.py bay/graph.py`, `git mv bay/improve/conformance.py bay/conformance.py`; update `artifact_graph.py:6`, `pipeline.py`, `detect_artifacts.py:22`, `lint.py:880`, tests, docstrings, `schemas/conformance.schema.json:5`.
Acceptance: A's goldens unchanged; `bay/improve/` has 8 modules; B-7 test still fails a cross-connector import; deadcode: no new findings.

Part C: improve-detect and improve-store receive their code (about 40 calls)
1. `git mv bay/improve/{pipeline,detect_artifacts,detect_sessions}.py framework/connectors/improve-detect/`; relative imports; `bay.model` stays an import (core).
2. `git mv bay/improve/{store,report}.py framework/connectors/improve-store/`; `fingerprint` copied into improve-detect with the shared vector in both tests; `improve_store.py` unchanged logic (framework_modes still from `framework/modes`).
3. Tests follow: `test_improve_detectors.py` and `test_deadcode_check.py` load the connector package through a `tests/helpers.connector_pkg(name)` (uses `connect._load_module`, then `importlib.import_module(f"{mod.__name__}.detect_artifacts")`); connector yaml and README text (`bay/improve/` references).
Acceptance: A's improve golden identical (a) to (f); connector tests unchanged apart from import lines; `improve.detect/v1.change` result identical on the temp repo.

Part D: sessions and sources; `bay/improve/` removed; slice 6 acceptance (about 40 calls)
1. `transcripts.py` -> `claude-transcripts/parser.py`; sources split: ledger part -> `ledger/`, git part -> `git/` (names `ledger_sources.py`, `git_episodes.py`); `in_window` from util; improve-store's `read_events` use per section 2.
2. Delete `bay/improve/` (the `__init__.py` last); `git grep bay.improve` must be empty outside HANDOFF and proposals; fix wording in `framework/modes/improve/{README.md,config.example.yaml,config.schema.json,features/scan/playbook.md:29}`, connector yamls, `bay/lint.py:877`.
3. `decide` stays reached by `bay approve <F-id>` (`cli.py:390-412` unchanged; D5). `weekly` needs nothing (stage 4: cron recipe in `framework/modes/improve/README.md`).
Acceptance (0008 slice 6): `bay/improve/` gone; A's improve golden identical; `test_improve.py` (incl. :225-245: terminal-only approval, never from chat) and the improve-store tests pass with only import changes; a deferred or open item cannot reach `implement`; dead-code: no new findings.

Part E: one workflow syntax, validator and advance rule (about 40 calls)
1. `bay/workflows.py` per section 2; `model._feature_steps`, `Dispatcher._skip`, `dispatch.substitute` (moved), `workflow_runner._advance`, the `when` patterns in both schemas, `bay/cli.py` callers (`wfmod` uses :121-135, :347-358).
2. Behaviour set by D6 to D8 (recommended: union grammar; gate takes no `when` in both; a project workflow with one gets a lint error naming the fix).
3. Tests: `test_stage_syntax.py` now asserts ONE parser (`git grep` for the reference regex finds one definition) and the table from A3 with the documented changes only; `test_workflows.py` and `test_dispatch.py` pass with name changes only; `cos.run` starts a workflow (existing test).
Acceptance (0008 slice 7a): one stage-syntax parser in `bay/`; workflow tests pass; the reference grammar is spelled once in code (schemas keep a pattern generated from or equal to it, with a test comparing them); dead-code: no new findings.

Part F: protection read from the map, old layout (about 35 calls)
1. `schemas/components.schema.json` `protected:` (paths only, plus empty instance lists); `Kit.protected` in `model.py`; `PROTECTED` and `USER_FRAMEWORK_ENVS` removed; `protected_writes`, `_check_protected`, `lint.warnings` read it.
2. Adapter writes `guard.json` `protected` from the map; `bay check` warns when `guard.json` differs from the map (stale policy). `bay/guard.py` keeps its loop; only docstring/message text changes.
3. `boundary.py`: `protected` finding class (listed or fail).
4. `framework/components.yaml`: `protected.paths` = the four dirs in the old order and spelling; `mode:` lists improve until H (so G is a pure move).
Acceptance: A's guard matrix identical for every row; `test_boundaries.py:290-321` and `test_resolver.py:165-185` pass unchanged; new tests: a role without `forge.extend` cannot write a path the map lists (a test map with an extra path), an edit to a protected path without `touches:` fails and with it passes, stale policy is reported.

Part G: the move (about 40 calls; mechanical, behaviour identical)
1. `git mv framework/modes/* modes/`, `framework/envs/* envs/`, `framework/connectors/* connectors/` (one `git mv` per top folder; commit message says so); `framework/` keeps roles, rules, interfaces, components.yaml.
2. Map: `at:` lists drop `framework/...`; briefing owns `connectors/corpus-store/`; `protected:` lists the moved instances (improve still in `mode:`, so every row of the guard matrix is unchanged); `framework-dev` `fs.write` names each protected instance path after the four dirs (order keeps `test_resolver.py:169` text); `lint_components` globs.
3. Loader: modes, envs, connectors read from the kit root only; `Doc.root` becomes `protected`-derived label; `Kit.collisions` and its two readers and `test_lint.py:239-246` replaced by the reserved-name tests (section 6); `scaffold.py:14,50-56` point at `modes/forge/templates` and the protected-name message; `improve_store.py:15` and `FRAMEWORK_DIRS` read the map; `claude_code.py:483,508` text; `lint.py:557,652` use `protected`.
4. Path literals in tests (18 files, list in section 4) and `tests/run.py:20`, `tests/contracts/content_type.py:21`, `tests/test_core_names.py` (same files scanned as before, mapped through the move; discovered connector names = connectors implementing `items.source/v1`, the same four as today).
Acceptance: guard matrix identical for every logical row; `bay catalog` and `bay describe` identical to A's baselines except file paths; the golden improve file identical; `git ls-files framework` = roles, rules, interfaces, components.yaml only; boundary check over the whole branch: 0 failing with section 4's amendments.

Part H: improve becomes ordinary (about 30 calls)
1. `interface improve.findings/v1` `decide` gets `ownerOnly: true`; resolver and lint refuse a `run:` step of an ownerOnly endpoint; `run_capability` (CLI path) allows it (D4).
2. Remove improve from `protected.mode`; `improve_store` framework modes = protected modes from the map; origin rule; README rule; docs lines (README folder map :77, DESIGN :52,:153-154, INTERFACES :7).
3. Matrix deltas asserted exactly: `modes/improve/**` rows go deny -> pass for `local-authoring` and `workspace` writers; nothing else changes.
Acceptance (0008 slice 7): the slice 7 acceptance line, all of it, with output quoted; the changelog stays for slice 9.

## 4. Path table

Covered = an existing `touches:` entry matches the path (the check matches paths only, never the slice). New = amendment in the last column.

| Part | Path | Change | Status |
|---|---|---|---|
| B,C,D | `bay/improve/` (deleted over B-D) | moved out | Covered: slice 6 `bay/improve/` |
| B | `bay/graph.py` | NEW (moved) | New: amendment 2 |
| B | `bay/conformance.py` | NEW (moved) | New: amendment 1 |
| B | `bay/util.py` | helpers | New: amendment 3 |
| B | `bay/connect.py` | connector packages | Covered by path: slice 5 `bay/connect.py` (its reason is a rename; amendment 8, a record) |
| B | `schemas/conformance.schema.json` | description names `bay/improve/conformance.py` | New: amendment 4 |
| B,D | `bay/lint.py` | import, docstring | Covered: slice 1 / slice 7 `bay/lint.py` |
| C,D | `framework/connectors/{improve-detect,improve-store}/` | receive code | Covered: slice 6 `framework/connectors/improve-*/` |
| B,D | `framework/connectors/{artifact-graph,claude-transcripts,git,ledger}/` | import lines, receive code | Covered by path: slice 7 `framework/connectors/` (slice 6 entry names only `improve-*`; fine) |
| D | `framework/modes/improve/{README.md,config.*,mode.yaml}` | wording | Covered: slice 6 `framework/modes/improve/` |
| C,D | `framework/modes/improve/features/*` (scan/playbook.md:29, and G's move of all 12 files) | wording; moved | New: amendment 5 (the slice 6 entry's prefix stops at `improve/`, so B-3 fails; only 4 of 12 files are listed, slice 4) |
| A-H | `tests/**`, `tests/golden/`, `connectors/*/tests`, `framework/connectors/*/tests` | tests | no entry needed (`other`) / extension tests follow their connector |
| E | `bay/workflows.py`, `bay/model.py`, `bay/dispatch.py`, `bay/cli.py` | one syntax | Covered: slice 7, 3, 3, 4 |
| E | `schemas/mode.schema.json`, `schemas/config.schema.json` | `when` pattern | Covered: slice 3, slice 2 |
| E | `framework/connectors/workflow-runner/` | uses shared code | Covered: slice 7 |
| E,G | `framework/modes/cos/` mode-wide files | moved | Covered: slice 7 `framework/modes/cos/` |
| E,G | `framework/modes/cos/features/{run,next,status}/` (moved; 5 of 6 files unlisted) | moved | New: amendment 6 |
| F,G | `framework/components.yaml` | protected block, at:, owns | Covered: slice 7 |
| F | `schemas/components.schema.json` | `protected:` block | New: amendment 7 |
| F,G | `bay/guard.py`, `bay/boundary.py`, `bay/model.py`, `bay/lint.py` | read the map | Covered: slice 7 (each) |
| F | `adapters/claude-code/claude_code.py` | policy from the map; text :483,:508 | Covered: slice 7 |
| G | `bay/scaffold.py`, `bay/registry.py` | paths, reserved message; origin | Covered: slice 3, slice 4 |
| G | `framework/modes/forge/` (4 feature files + rest), `framework/modes/improve/` | moved | Covered: slice 4 and 8 list all four forge feature files; `framework/modes/` slice 7 |
| G | `framework/envs/*` -> `envs/*` | moved; `framework-dev` fs.write | Covered: slice 7 `framework/envs/`, `envs/` |
| G | `framework/connectors/*` -> `connectors/*` (incl. corpus-store, core for briefing) | moved | Covered: slice 7; slice 5 `framework/connectors/corpus-store/` |
| H | `framework/interfaces/improve.findings.v1.yaml` | `ownerOnly` | Covered: slice 4 |
| H | `schemas/interface.schema.json` | `ownerOnly` key | New: amendment 9 (only if D4 recommended option) |
| H | `README.md`, `docs/DESIGN.md`, `docs/INTERFACES.md` | folder map, protection | Covered: slice 9 (each) |
| D,H | `.agentbay/COORDINATOR.md` (generated), `HANDOFF.md` | | generated / other |

Files in G with literal `framework/(modes|envs|connectors)` outside the moved folders (all other or covered): `adapters/claude-code/claude_code.py`, `bay/scaffold.py`, `docs/DESIGN.md:153-154`,
`framework/components.yaml`, `framework/rules/conformance.yaml:3` (covered, slice 1), `CHANGELOG.md:76` (history, leave), tests: `conftest.py`, `test_boundary.py:239`, `test_contract_versions.py:76`,
`test_core_names.py:39-43`, `test_dispatch.py:467,484`, `test_improve_detectors.py:425,463`, `test_ledger.py:168`, `test_lint.py:225-245,315`, `test_mail_briefing.py:290`, `test_resolver.py:167,184`,
`test_review7a.py:141`, `improve-store/tests/test_improve_store.py:124-126`.

Amendment entries (9), to add to 0008's `touches:` by the owner (8 is a record; 9 only with D4):
```
  - { path: bay/conformance.py, reason: "NEW. moved from bay/improve/conformance.py: the conformance rules loader and checks, used by lint and by improve-detect", slice: 6 }
  - { path: bay/graph.py, reason: "NEW. moved from bay/improve/graph.py: the file and reference graph, used by artifact-graph and improve-detect", slice: 6 }
  - { path: bay/util.py, reason: "short_hash, in_window and warn move here from bay/improve/ (several connectors use them)", slice: 6 }
  - { path: schemas/conformance.schema.json, reason: "description names bay/improve/conformance.py; follows the move to bay/conformance.py", slice: 6 }
  - { path: "framework/modes/improve/features/", reason: "wording follows the moved code (slice 6); moved to modes/improve/features/ (slice 7); B-3 needs this prefix", slice: 6 }
  - { path: "framework/modes/cos/features/", reason: "moved to modes/cos/features/; B-3 needs this prefix", slice: 7 }
  - { path: schemas/components.schema.json, reason: "`protected:` block of the component map", slice: 7 }
  - { path: bay/connect.py, reason: "a connector may be several modules: sibling imports resolve inside its folder (improve-detect, improve-store)", slice: 6 }
  - { path: schemas/interface.schema.json, reason: "`ownerOnly` endpoints: only the owner's command may call them (improve decide)", slice: 7 }
```
The B-3 trap again (part 15): `bay check --base` splits renames, so each deleted `framework/modes/<m>/features/...` file is a feature path of an existing mode and needs an entry whose literal prefix reaches
`framework/modes/<m>/features/`. forge is already covered (all 4 files listed); cos and improve are not. The added side (`modes/<m>/`) is new at the merge-base, so it passes as a new extension.
Run the whole-branch check after F and after G, not only at the end.

## 5. Decisions for the owner (recommended option first)

D1. Shared improve code stays in core. `bay/graph.py` and `bay/conformance.py` (682 lines) cannot move into one connector (two users each, B-7). Recommended: core, as ordinary modules; "bay/improve/ gone" holds
    and 2,758 lines leave (a quarter of core, not a third). Alternatives: copy graph into two connectors (358 duplicated lines), or version `artifacts.read/v1` so improve-detect asks artifact-graph for a base-tree graph (interface bump, R-2).
D2. Multi-module connectors. Recommended: `_load_module` passes `submodule_search_locations` (about 3 lines, covered by path, amendment 8 as a record). Trade-off: a new, small contract (a connector folder is a package); the
    alternative is one 1,500-line `improve_detect.py` or leaving the code in core, which fails the proposal.
D3. What is protected. 0008: cos and forge, "with the control-plane envs and connectors they need". The strict closure is envs cos-local, local-authoring, framework-dev, workspace and connectors workflow-runner, scaffold,
    improve-detect, ledger, artifact-graph. Recommended wider list (section 2): all 6 envs and all 9 connectors, because the other four (claude-transcripts, git, improve-store, corpus-store) scrub secrets, redact transcripts or
    hold the approval state, and all of them were protected by location; leaving them writable would loosen a guard decision nobody asked to loosen. Trade-off: improve cannot ship its own connector fixes without `forge.extend`.
    `improve-local` is protected but names `modes: [improve]`, so the ordinary improve mode may use it.
D4. improve as an ordinary mode weakens user-only approval unless `decide` is closed. Today nothing stops a `modes/improve/mode.yaml` step `run: improve.findings/v1.decide` with `by: user@tty`; the file is safe only because
    `framework/` is protected (`improve.findings.v1.yaml:117` says "no workflow step calls it", enforced by location). Recommended: `ownerOnly: true` on that endpoint, refused by the resolver in any step, allowed only through
    `run_capability` from `bay approve <F-id>` (+ amendment 9). Alternatives: keep `modes/improve/mode.yaml` protected (improve not fully ordinary), or accept the risk. Also changes (documented, tested): findings about improve itself
    route to `mode-fix`, not `forge.extend`; `origin` in `bay catalog` for improve reads `user`, not `framework` (the one catalog change beyond paths).
D5. `decide` as a feature with a gate (0008 item 4, literal) vs keeping `bay approve <F-id>`. A gate can be approved from chat (`approvals.chat`), but COORDINATOR.md and `test_improve.py:234` say a backlog item is never decided from chat.
    Recommended: keep `bay approve <F-id>` terminal-only (`cli.py:390`), still calling improve's capability. Trade-off: core `cli.py` still names the improve mode and `F-` ids; 0008 says a missing contract is a follow-up, not a back door, so this is the follow-up
    (a generic "owner decision" hook declared by a mode).
D6. "One step runner" and "a project workflow is a feature whose steps are calls". Recommended: one parser, one validator, one `skip`/`substitute`/`advance` rule, with two executors kept (the dispatcher runs steps inside a call; the cursor hands back `nextCall`).
    Reason: nested calls would break the stated guarantee that each stage keeps its own grants, effects, budget, review and gates and that nothing recurses (`workflows.py:25-28`), and bring cycles and effect unions. Acceptance reads "one stage-syntax parser in bay/".
D7. A gate with `when:` in a project workflow is skipped today. The value comes from the output the coordinator passes to `cos.next`, so an agent can fabricate it. Recommended: refuse it in both (same rule as 0006 slice 7a), message naming the fix; no shipped workflow uses it (`test_workflows.py` has `when` only on a call stage).
    Trade-off: removes conditional gates from project workflows (a lost capability, though an unsafe one); alternative keep it and say so in the docs.
D8. Reference grammar. Recommended: the union (`!` negation, hyphens, nested paths) in both. It loosens the mode `when` pattern slightly; nothing that was accepted is rejected.
D9. Protected paths for `forge.extend`'s builder. Recommended: `framework-dev` names each protected instance path in `fs.write` (the guard rule is unchanged: a protected path is writable only if an env path is at or under it), kept in sync by a lint.
    Alternative: a `@protected` token in `fs.write` (a new env syntax and schema change).
Not decisions, notes: `delivery` is already `modes/delivery/` (0008's list is wrong on that name); the slice 7 acceptance should say "roles, rules, interfaces and the component map" since the agent profile already lives in `adapters/`.

## 6. Risks and how each part proves no guard decision changed

Security-relevant changes: (1) the guard policy now comes from the map and the protected set grows from 4 dirs to dirs plus instance paths; (2) `modes/`, `envs/`, `connectors/` become writable by `local-authoring` (it writes those three folders,
`framework/envs/local-authoring.yaml:25`) while holding protected instances, so protection must be per instance; (3) the root distinction that stopped user modes using framework envs and kept framework names reserved is replaced by the map;
(4) improve leaves protection (D4); (5) the project-workflow gate rule changes (D7); (6) connector loading gains a search path (D2); (7) moved findings change fingerprints.

Proof per part
- A: the baselines themselves. The guard matrix is generated by the real `Guard` over a built kit project, so it records decisions, not intentions.
- B, C, D: no guard code touched; improve golden identical; B-7 test shows a cross-connector import still fails, and a sibling module may not shadow another connector's entry name; `git grep bay.improve` empty at D.
  Fingerprints: the A4 test and the dead-code step show no moved file carries a finding.
- E: `test_stage_syntax.py` lists every accept/reject change; the gate rule has a test for each side; `test_dispatch.py` and `test_workflows.py` unchanged apart from names.
- F: the matrix is identical row by row; the only new decision source is the map, and tests show a role cannot write a map-listed path, an unlisted edit fails the boundary, and a stale `guard.json` is reported (the guard still fails open when the key is missing, as today; the warning is the new part).
- G: matrix identical for all logical rows (the compare maps old to new paths and fails on any difference); protected set == old four dirs plus exactly the moved instances (test asserts the list, replacing the `:296` equality, which must change because the list grows: the reviewer checks it is a superset of the old list);
  reserved names: `bay new mode cos`, `bay new connector scaffold`, `bay new env workspace` refused with the protected-name message; a lint run on a kit whose map names a missing instance fails; deleting and re-adding `modes/cos/` without `touches:` fails the boundary; case variants fail `lint_case_and_manifests`.
- H: matrix deltas asserted as an exact list (improve mode rows only); a mode step calling `decide` is a resolve gap; `bay approve <F-id>` still terminal-only; a user mode cannot place a role in `improve-local` (not listed) while improve can.
- Whole-branch boundary check (with the nine amendments applied) and `python3 tests/run.py -q` after every part; quote last lines in each part's HANDOFF as before.

Other risks
- `tests/test_boundaries.py:306` asserts a "reaches framework/" lint warning; after F the warning logic must stay limited to dirs and `.` (a write path of `modes` reaching `modes/cos` is by design, the guard denies it) or `bay check` gains permanent noise.
- `test_core_names.py` must not start scanning connector names such as `git` and `ledger` (they would hit everywhere in `bay/`): keep the discovered set to `items.source/v1` implementers.
- B-11: README/DESIGN/INTERFACES may not name any mode, connector or env outside a fence; the framework instances were already counted (they sit under the `framework/...` `at:`), so nothing new, but H adds the words "improve-local" and "cos" to docs only in fences or dotted forms.
- The dead-code base is `origin/main`; a moved file's pre-existing findings are new (section 1). A4 is the guard against it.
- Size: C and D are the largest; if C passes 35 calls without the goldens green, commit what is green (detect first, store second) and report the rest as C2.
- `improve.implement` hands a draft to forge; with improve unprotected, a mode-fix task path now applies to improve's own files: check `test_improve.py` routes after H.

# HANDOFF part 22: T-20261030-d695 (recorded with `bay plan`) - stage-4 re-review: DOD-3 should-fix, DOD-8 and DOD-9 nits

Outcome: done on feat/0008-stage4. Not pushed. No proposal edited. The intersection rule is kept (fail closed).

## To-do and commits
1. DOD-3 usability: 69ff77d. `Dispatcher._use_refusal` (`bay/dispatch.py`) names the open calls (callId and feature) that do not
   declare the endpoint, says what is allowed now, and the fix: finish or reclaim them (`bay show <callId>`, `bay show reclaim <runId>`).
   The missing space after `uses:` is fixed. `tests/test_feature_uses.py` pins the message with digest and ask open.
2. DOD-3 recipe: 48dae42. `framework/modes/improve/README.md`: cron starts only `improve.scan`; scan, audit and triage run one at a time,
   each driven to a terminal status before the next, so no two improve calls wait on the analyst unit. `playbook.md` says the same.
   The cos playbook already says "You run one stage at a time" and "drive that call to a terminal status" (framework/modes/cos/playbook.md:62,67): confirmed, not duplicated.
3. DOD-8 (b) and DOD-9: ac6d5e7. `FX = [` restored in test_corpus_store.py. B-11 (`bay/boundary.py`) forbids the name of any mode, connector,
   env or content-type folder outside a fenced block, and `email` is a content type, so inline text cannot name the field. Chosen: INTERFACES
   section 11 shows `author: {handle?: string, name?: string, email?: string}` in a fenced example, with a bullet pointing to it. The field is
   named and B-11 passes.
4. DOD-8 (c): HANDOFF part 21 corrected (INTERFACES history; the boundary line quoted). HANDOFF part 22 (this commit).

## Evidence (last lines)
- `python3 tests/run.py -q`: `502 passed, 0 failed`
- `./bay.sh check`: `✓ 6 modes, 21 features, 5 roles (17 role units), 8 envs, 13 connectors resolve (agent profile claude-code)`
- boundary: `boundary origin/main...HEAD: 78 changed paths (29 core, 3 docs, 26 extension, 2 feature, 18 other); 0 failing; B-11 docs: 0 hits`
- golden files and security tests unchanged.

# HANDOFF part 21: T-20261030-3a6a (recorded with `bay plan`) - stage-4 review findings fixed

Outcome: done on feat/0008-stage4. Not pushed. No proposal edited.

## To-do and commits
1. DOD-3: 49617d3. `Dispatcher._open_uses` (`bay/dispatch.py`) returns the INTERSECTION of the `uses:` of every open call
   waiting on the unit. The callId was not carried through the shim: the shim line is matched by the guard and the allow patterns
   (security tests, which must stay unchanged), so the fail-closed fallback was used. `tests/test_feature_uses.py` now expects
   refusal of the other call's endpoint (status, facets) with digest and ask open; new test with two open calls of different features.
   Followup: a per-call `--call <callId>` in the tool lines needs the guard patterns changed (a separate proposal).
2. DOD-13 / R-4: f2b2939. README folder map gains `content-types/`, commands table gains `bay show <mode> --resolved`.
3. DOD-8 nits: cf4f257.
   - (1) `_usage` in corpus-store raises StoreError "state.json budget uses the old key `posts`: move the folder aside and sync again"
     (test added in test_corpus_store.py).
   - (2) `derive_again` rolls back and raises StoreError on any exception from derive.py; `open_rw` closes the connection for it.
   - (3) `tests/test_core_names.py`: the allowlist key is now (file, name, place): the identifier, the Python expression holding the
     string (`au.get('email')`) or the key path in a data file. A new `kind == "email"` in an allowlisted file is a hit.
   - (4) textChars: it fails loudly, not `len(text)`. The email fields schema (0006 / the item schema) lists `textChars` as required (0 when
     metadata only), and the store validates every item against it, so text without `textChars` is refused. New test
     `test_an_attachment_without_textchars_is_refused_not_guessed`.
   - `docs/INTERFACES.md:227` first read `author {handle?, name?, email?}` (cf4f257); f8e1e5b then reworded it to point at
     `schemas/data/item.v1.schema.json`, to avoid a B-11 hit. Part 22 replaces that with a fenced example that names the field.
4. HANDOFF part 21 (this commit).

## Followups
- The proposal's front matter (line 2 "Not approved", line 157 "Status: draft") is stale; editing it voids the approval, so left alone.
- Per-call `uses:` scope through a callId in the shim line (see 1).

## Evidence (last lines)
- `python3 tests/run.py -q`: `502 passed, 0 failed`
- `./bay.sh check`: `✓ 6 modes, 21 features, 5 roles (17 role units), 8 envs, 13 connectors resolve (agent profile claude-code)`
- boundary: `boundary origin/main...HEAD: 78 changed paths (29 core, 3 docs, 26 extension, 2 feature, 18 other); 0 failing; B-11 docs: 0 hits` (quoted from the stage-4 re-review run)
- `./bay.sh build --project <scratch>`: `built 6 modes for claude-code`; `./bay.sh clean`: `clean`; Glob of the scratch folder: only `agentbay.config.yaml`
- golden: `git diff --stat 7486406 HEAD -- tests/golden` is empty

# HANDOFF part 20: T-20261030-68bd (recorded with `bay plan`) - the 3 complexity findings of the deadcode step cleared

Outcome: done on feat/0008-stage4. Not pushed. No proposal edited. No behaviour change; no threshold raised, no exclusion added.

## To-do and commits
1. Code: 738ea20. `bay/contenttypes.py`: `_one` now calls `_parse_views`, `_view_doc_problems`, `_table_problems`,
   `_view_link_problems`, `_derived_problems` (same problems, same order). `check_mode_views` now calls `_build_empty_store`,
   `_mode_view_authorizer`, `_view_column_problems`, `_threads_query_problems`. `bay/dispatch.py`: `Dispatcher._plan` now calls
   `_gate_plan`, `_plan_skills`, `_review_brief`, `_executor_brief` (plan keys keep their order).
2. Test: `tests/test_deadcode_check.py::test_the_functions_the_complexity_check_flagged_stay_under_its_threshold` also measures
   `_one`, `check_mode_views` and `Dispatcher._plan` with the detector's own `_branches` against `maxComplexity`.

## Evidence
- `python3 tests/run.py -q`: `499 passed, 0 failed`
- `./bay.sh check`: `✓ 6 modes, 21 features, 5 roles (17 role units), 8 envs, 13 connectors resolve (agent profile claude-code)`
- boundary: `boundary origin/main...HEAD: 76 changed paths (29 core, 2 docs, 26 extension, 2 feature, 17 other); 0 failing; B-11 docs: 0 hits`

# HANDOFF part 19: T-20261030-e403 (recorded with `bay plan`) - slice 5 part D built: decision (e), core-names test, 0006 Part E, whole-tree checks

Outcome: done (not partial: D2 was not needed) on feat/0008-stage4. Not pushed. No proposal edited.

## To-do and commits
1. Decision (e): 71ebc63. `ITEM_COLUMNS` descriptions are generic; budget/cost counter `posts` -> `items` (`bay/dispatch.py`, `bay/cli.py`
   `items=` in status, corpus-store budget); `costPerPostUsd`/`COST_PER_POST_USD`/`cost_per_post` -> `costPerItemUsd`/`COST_PER_ITEM_USD`/
   `cost_per_item` in `bay/config.py`, `bay/connect.py`, `bay/model.py`, `bay/dispatch.py`, corpus-store, `schemas/connector.schema.json`,
   `modes/briefing/config.schema.json`, the four connector.yaml, config.example.yaml, READMEs, INTERFACES.md. The old key has no alias:
   `test_the_old_price_key_is_refused_by_the_schemas_with_no_alias` (mode setting and connector.yaml both refused). `dispatch.use` counted
   `out["posts"]` for the ledger; it now counts `out["items"]`.
2. `tests/test_core_names.py`: bcef679. Rule (also in the file's docstring): names are discovered (content-types/ folders and kinds, the
   view names of types and of `modes/*/views.yaml`, `connectors/` folders). Scanned: .py/.json/.yaml under bay/, framework/, schemas/,
   adapters/, coordinator/ (folders tests, fixtures skipped; framework modes own no type so are scanned). A hit is an identifier (ast: names,
   attributes, args, defs, keywords) with a snake/camel segment equal to a type name, or equal to a connector name; a string without
   whitespace with a type name as a segment or a connector name as a token; in any string a `<type>/v<N>` ref, a view name, or a type or
   connector name in quotes/backticks. A sentence using the English word (`steps post interim results`) is not a hit. `ALLOWED` has 5
   entries with reasons, and a stale entry fails: the item/v1 author field `email` in `bay/selector.py`, `corpus_store.py` and
   `schemas/data/item.v1.schema.json` (a base-record field, not a type, so not renamed: that would change the public item schema), and the
   Claude Code hook event `PostToolUse` / phase `post` in `adapters/claude-code/claude_code.py`.
3. Part E: ae33236. `uses:`/`skills:` are keys of `features.<name>` (`schemas/mode.schema.json`, `Feature.uses/skills`). `bay check`
   (resolve) fails: a `uses` entry no role of the feature is granted (B-9), a feature whose roles are granted any endpoint and has no
   `uses` (`uses: []` is valid), a `skills` name that is not a skill of the mode (B-8); `bay lint` fails a playbook that names a skill
   its feature does not list. `Dispatcher.use` (via `_open_uses`) limits a unit to the `uses` of the features whose open call
   (`needs-agent`, cursor on a role/review step of that unit) waits on it; with no such call the role-level grant applies (decision (c)).
   `_plan` hands a role only the feature's mode skills (own role skills stay) and only its `uses` as `tools`. `merge_mode`: a child's
   feature replaces the parent's whole. `bay show <mode> --resolved` prints the features with their origin (options may not come before
   the verb: the verb-first guard stays, so it is `show mail-briefing --resolved`). Declared in `modes/briefing` (digest, ask, prune),
   `modes/mail-briefing` (digest, ask: written whole, since they replace briefing's), `framework/modes/improve` (scan, audit, triage,
   implement); forge templates carry `uses: []` (and a `skills` hint).
4. Whole tree: see Evidence. `bay/use_shim.py` was not touched (the check is in `Dispatcher.use`, which the shim calls).

## Changes to existing tests (not security assertions)
- `tests/test_dispatch.py`: the two `cost == {"posts": 7, ...}` assertions now say `items` (decision (e)). Nothing else in the file.
- `tests/test_resolver.py::test_effect_not_declared_by_endpoint`, `tests/test_inheritance.py` (3 tests): they overrode one key of a parent
  feature; with whole-feature override they pass the whole block (`helpers.whole_feature`). Assertions are unchanged; new test
  `test_a_child_feature_is_never_merged_key_by_key_with_its_parents`.
- corpus-store `test_corpus_store.py` and `tests/test_config.py`: renamed keys. `tests/test_offline_golden.py`: `generic_names` (below).
- Unchanged and passing in the full run: `tests/test_boundaries.py`, `tests/test_boundary.py`, `tests/test_lint.py`,
  `tests/test_guard_7a.py`, `tests/test_guard_mainthread.py`, `tests/test_review7a.py`, `tests/test_review_record.py`,
  `tests/test_submit_needs_plan.py`, `tests/test_auth.py`, `framework/connectors/corpus-store/tests/test_sqlsandbox.py`, the connector
  tests (gmail-api, x-api, fake, fake-mail).

## Golden
`git diff a6c035e HEAD -- tests/golden/` (both files) has exactly these hunks and no other: per file, (1) `source` description
`"x, fake, gmail, ..."` -> `"name of the source that produced it"`, (2) `kind` `"post, email, ..."` -> `"the content type of the item"`,
(3) `title` `"(null for posts)"` -> `"(null when the kind has none)"`, (4) `costPerPostUsd` -> `costPerItemUsd`, (5) `posts` -> `items`
(budget in `status` and in `sync`; (4) and (5) each appear twice per file). Every changed line is one of the five allowed changes; the three
decision (a) deltas stay in `mail_deltas` and the golden file for mail-briefing still has `v_posts` and `addr_key`. `generic_names` in
`tests/test_offline_golden.py` asserts the three descriptions and the `items`/`costPerItemUsd` keys (and the absence of the old ones) for both modes.

## Evidence (last lines)
- `python3 tests/run.py -q`: `499 passed, 0 failed`
- `python3 tests/run.py -k offline_golden`: `2 passed, 0 failed`
- `./bay.sh check`: `✓ lint clean` / `✓ 6 modes, 21 features, 5 roles (17 role units), 8 envs, 13 connectors resolve (agent profile claude-code)`
- boundary, whole branch (`./bay.sh check --base origin/main --proposal docs/proposals/0008-simplify-without-losing-features.md --docs`):
  `boundary origin/main...HEAD: 76 changed paths (29 core, 2 docs, 26 extension, 2 feature, 17 other); 0 failing; B-11 docs: 0 hits` (at ae33236)
- `./bay.sh build --project .../scratchpad/s5d`: `built 6 modes for claude-code`; `./bay.sh clean --project .../scratchpad/s5d`: `clean`
- Glob of scratch `s5d` after clean: `agentbay.config.yaml` only
- core names: `test_core_names::test_no_core_file_names_a_content_type_or_a_connector` passes with the 5 `ALLOWED` entries, each matched.
- Dead code: not run by me. Removed with what replaced it: `cost_per_post`, `COST_PER_POST_USD`, `costPerPostUsd`, the per-key feature merge
  (incl. the `roles` entry merge) in `merge_mode`. Nothing new is unused (`_open_uses`, `_check_uses_and_skills`, `cmd_show_resolved`,
  `whole_feature` are called).

## Open for the owner
- 0008's `touches:` already cover every changed path (boundary 0 failing); `bay/use_shim.py` untouched.
- State of an existing project: a store `state.json` written before this commit has `budget.<month>.posts`; it is not read as `items` (no
  compat), so the first sync of that month would fail on the missing key until that month's entry is deleted. The branch is unpushed and
  the offline tests start from empty projects; say if you want a one-time migration instead.
- `uses:` lists for improve were derived from playbooks/skills (shim reads named there); the first run that needs another read gets a
  refusal naming the feature's `uses:`.


Outcome: done and green on feat/0008-stage4, with open items for part D listed below. Not pushed. No proposal edited.

## To-do and commits (all in b618440 unless noted)
1. Mode views loader in `bay/contenttypes.py` (`ModeViews`, `mode_views(dirs)`, `mode_problems`, `check_mode_views`): the nearest mode folder (own, then `extends` chain) with `views.sql`/`views.yaml`; same statement rules as a type; a mode view may read only the base views, the views of the types the mode `reads:` and its own earlier views (authorizer arg 5 = responsible view; functions = sandbox allowlist). Lint runs it for every mode (`bay/lint.py`).
2. `v_threads` lifted out of `content-types/email/` (statement and `views.v_threads` entry deleted) into `modes/mail-briefing/views.sql` + `views.yaml`. It now reads only `v_email` (no `main.items`); columns and values are unchanged (golden).
3. `views.yaml` has `views:` (column docs) and `threads:` (view, window, selector, important, order, json, flags, details = per-row SQL with `:column` params). `CorpusStore.threads` reads that block; no view or type name in core. A mode with no `threads:` block gets "mode X defines no rows for `threads`: give the mode views.sql and views.yaml ...". Interface stays v1 (text only).
4. Store: `store_meta` key `mode-views` (JSON list of name/CREATE TEMP VIEW) is written at creation and re-written by the writer when views.sql changed; absent when the mode has none. `sqlsandbox.view_sql/views_of` take `mode`; order is `v_items`, type views, mode views, `v_fts`, full-text views. `Dispatcher._settings` passes `modeDirs` (mode.dirs).
5. Wording: `items.store.v1.yaml` (sql, threads), `items.source.v1.yaml`, `modes/briefing/skills/corpus-sql` + `digest` + `mode.yaml` description, mail-briefing skill/playbooks/README/config.schema.json, schemas (mode, connector, event, item.v1), `framework/rules/conformance.yaml`, `bay/lint.py` messages, `bay/config.py` example, `bay/scaffold.py` (scaffolds the first discovered kind, `<kind>/v1` when none), email README, INTERFACES/DESIGN lines.
6. Tests: new `test_threads_needs_a_view_from_the_mode_and_a_mode_view_reads_only_views_of_its_types`; `modeDirs` added to the store helpers of `tests/test_mail_briefing.py` and `connectors/gmail-api/tests/test_gmail_api.py`; view order and `store_meta` expectations updated. No security test changed. Golden: files untouched, `mail_deltas` unchanged and still exact.

## What part D must know
- A store built without `modeDirs` (tests that call `connect.instantiate` by hand) has no mode views, so `v_threads` and `threads` are missing there; pass `modeDirs` like the two helpers do.
- Core hits left in `bay/` that I could not remove without changing describe/status output (golden says byte for byte) or a public key; part D needs an owner decision (a documented golden delta, or an allowlist entry):
  - `bay/sqlsandbox.py:70-73` `ITEM_COLUMNS` descriptions ("x, fake, gmail", "post, email", "null for posts") are in describe output.
  - `posts` as the cost/budget counter key (`bay/cli.py:628`, `bay/dispatch.py:70,252,453-454`, corpus-store `budget.posts`) is in status output and state.json; `COST_PER_POST_USD`/`costPerPostUsd` is a public setting name.
  - `bay/selector.py:102`, `corpus_store.py:226-242` `email` is the item/v1 author field, not a content type. `bay/improve/detect_sessions.py:288` is the verb.
- Not built: `tests/test_core_names.py`, Part E (`uses:`/`skills:`).
- `modes/briefing/skills/digest/SKILL.md` and `modes/briefing/mode.yaml` wording changed; boundary passes (0 failing).

## Evidence (last lines)
- `python3 tests/run.py -q`: `488 passed, 0 failed`
- golden (inside the run above; earlier `-q -k offline_golden` also passed): `2 passed, 0 failed` in the part-B form
- `./bay.sh check`: `✓ lint clean` / `✓ 6 modes, 21 features, 5 roles (17 role units), 8 envs, 13 connectors resolve (agent profile claude-code)`
- `./bay.sh check --base origin/main --proposal docs/proposals/0008-simplify-without-losing-features.md --docs`: `boundary origin/main...HEAD: 56 changed paths (25 core, 2 docs, 17 extension, 2 feature, 10 other); 0 failing; B-11 docs: 0 hits` (at b618440)
- `./bay.sh build --project .../scratchpad/s5c`: `built 6 modes for claude-code`; `./bay.sh clean --project .../scratchpad/s5c`: `clean`
- Glob of scratch `s5c` after clean: `agentbay.config.yaml` only
- `git diff --stat a6c035e HEAD -- tests/golden/`: empty
- `git grep -nwi "post|posts|email|x-api|gmail-api|fake-mail" -- bay`: the hits listed above only (cli.py:628, config.py:31, dispatch.py:70/252/453/454, improve/detect_sessions.py:288, selector.py:102, sqlsandbox.py:71/73).

# HANDOFF part 17: T-20261030-f10d (recorded with `bay plan`) - slice 5 part B built: `email` moved into `content-types/email/`

Outcome: part B is done and green on feat/0008-stage4. `email` is a content type like `post`: its child table, FTS index, delete trigger,
attachment-text move-out and fromMe/toMe/bulk come from `content-type.yaml` + `derive.py`; the old email code in `bay/sqlsandbox.py`,
`bay/selector.py` and `corpus-store` is deleted (no second path). Not pushed. No proposal edited.

## To-do and commits
1. `tables` / `derived` / `deriveVersion` in `schemas/content-type.schema.json` and `bay/contenttypes.py`: d1c1551.
2. `content-types/email/` (content-type.yaml, fields.schema.json = git mv of `schemas/data/email.v1.schema.json`, views.sql, derive.py, README, fixtures): d1c1551.
3. Generic child tables, FTS, triggers, derive in `corpus_store.py` / `sqlsandbox.py`; `email_view_sql`, `MAIL_VIEWS`, `MAIL_FUNCTIONS`, `ATT_FTS*`,
   `attachments_ddl`, `attachment_rows`, the `addr_key` SQL function and `selector.addr_key`/`GMAIL_DOMAINS` removed: d1c1551.
4. `v_threads` kept working (see part C below): d1c1551.
5. `deriveVersion` recompute (`derive_again`, test `test_the_child_table_and_the_derived_fields_come_from_the_type`): d1c1551.
6. Tests: gmail uses `derive.addr_key` (via `ContentType.derive_module()`), `test_contract_versions` bumps `content-types/email` to v2, golden compares with the documented deltas: d1c1551.
7. Docs: INTERFACES.md :220-232, :276, :293-297, :305-317 and DESIGN.md :135-136 reworded (B-11: 0 hits after the files were committed): d1c1551.
8-10. Checks, build, clean: see Evidence. 11. This note.

## What part C must know
- `v_threads` (with `needsReply`) is the LAST statement but one of `content-types/email/views.sql` and the `views.v_threads` entry of
  `content-type.yaml`, both marked "temporary home". Lift out = cut that statement and that entry together, put them in the mode's
  `views.sql` / `views.yaml`. It reads only `temp.v_email` and the base tables. Its columns are now in the documented order
  (`needsReply` after `lastBulk`; the old `SELECT t.*, needsReply` put it last), so `SELECT *` differs from before; named reads and `threads` output are identical.
  `CorpusStore.threads` still names `v_threads`, `v_email`, `v_attachments` (core names to remove in C).
- Store content: `settings.reads` (new, from `ResolvedMode.reads` via `Dispatcher._settings`) names the types a store is made for (decision (d)).
  Absent `reads` = every type of the kit (tests that build a store without a mode). Hence mail-briefing has no `v_posts`, feed-briefing no mail view.
  `bay/model.py` gained `ResolvedMode.reads`; `bay/dispatch.py` one line in `_settings`.
- Order of views (`sqlsandbox.view_sql`): `v_items`, the types' non-full-text views (types by name), `v_fts`, the types' full-text views.
  A view with `fullText: {over, table, example}` in content-type.yaml is a full-text view (FTS5 only); `includes.view` may be a view of the same type.
- `items.derived` (JSON) is new; `store_meta` has `derive:<name>`. `SCHEMA_VERSION` stays 3 (the branch is unpushed; a v3 store made by part A has no
  `derived` column and must be moved aside). Readers (the sandbox) do not recompute: after a `deriveVersion` change, `fromMe/toMe/bulk` read stale
  until the next sync or prune.
- `textChars` is now stored as given (`int(textChars or 0)`); before it was `len(text)` when text was present and textChars missing. All connectors set both.
- `bay/improve/graph.py::_data_schemas` now also yields the content types' fields schemas (`schema:post/v1`, `schema:email/v1`), as before the move.
- Not built (not in this task): `tests/test_core_names.py`; `bay/scaffold.py:128` wording.
- Golden: `tests/golden/*.json` unchanged since a6c035e; `mail_deltas` in `tests/test_offline_golden.py` asserts the three decided deltas exactly
  (no `v_posts` view and its sql read is an error, no `addr_key` function, new view order) and all other values equal, including fromMe/toMe/bulk/needsReply.

## Evidence (last lines)
- `python3 tests/run.py -q`: `487 passed, 0 failed`
- `python3 tests/run.py -q -k offline_golden`: `2 passed, 0 failed`
- `./bay.sh check`: `✓ lint clean` / `✓ 6 modes, 21 features, 5 roles (17 role units), 8 envs, 13 connectors resolve (agent profile claude-code)` (same four `!` warnings)
- `./bay.sh check --base origin/main --proposal docs/proposals/0008-simplify-without-losing-features.md --docs`:
  `boundary origin/main...HEAD: 37 changed paths (13 core, 2 docs, 12 extension, 10 other); 0 failing; B-11 docs: 0 hits` (after d1c1551, before this note)
- `./bay.sh build --project .../scratchpad/s5b`: `built 6 modes for claude-code`; `./bay.sh clean --project .../scratchpad/s5b`: `clean`
- Glob of scratch `s5b` after clean: `agentbay.config.yaml` only
- `git diff --stat a6c035e HEAD -- tests/golden/`: empty

# HANDOFF part 16: T-20261030-83c8 (recorded with `bay plan`) - slice 5 part A built: golden baseline, content-type loader, `post` moved

Outcome: part A is done and green on feat/0008-stage4. The golden baseline was committed first, from the untouched code; the loader,
its schema and the contract suite are in; `post` lives in `content-types/post/` and the core reads it only through `bay/contenttypes.py`.
`email` is untouched (old location, old code path) until part B. Not pushed. No proposal edited.

## To-do and commits
1. Golden baseline, own commit, passing on the untouched code: a6c035e (`tests/test_offline_golden.py`, `tests/golden/{feed,mail}-briefing.json`).
2. Loader + schema + contract suite + `post` moved + docs lines reworded: 9bc2597.
   - `bay/contenttypes.py` (scan/load/check_views/problems, item_kinds, fields_schema), `schemas/content-type.schema.json`,
     `framework/components.yaml` (`bay/contenttypes.py` under briefing `owns`), `bay/lint.py` (runs `contenttypes.problems`), `bay/model.py`
     (`data_schema` and `item_kinds` read the types).
   - `tests/contracts/content_type.py` (the contract: loads, README, fixtures validate, views build under the read-only rules, documented
     columns equal real columns, item views return one row per fixture) and `tests/test_content_types.py`; `tests/run.py` also globs `content-types/*/tests`.
   - `content-types/post/` = `content-type.yaml`, `fields.schema.json` (git mv of `schemas/data/post.v1.schema.json`), `views.sql`, `README.md`,
     `fixtures/items.json`. `v_posts` and its column docs are gone from `bay/sqlsandbox.py`.
   - Store: `store_meta` table (key `type:<name>` = version), `SCHEMA_VERSION` 3; a store whose type is gone or has another version is refused
     with "move the folder aside and sync again" (writer and sandbox).
   - Docs: DESIGN.md:121, :135 and INTERFACES.md:224, :291, :303 reworded (B-11: 0 hits).

## What part B must know
- Deviations from the part 15 plan, on purpose:
  - No `ContentType` kind in `model.KINDS`. `bay/contenttypes.py` scans `content-types/*/content-type.yaml` itself (one discovery path, cached by
    file stat) and lint reports its problems; adding the Kit kind would be a second discovery.
  - `content-type.yaml` has only `version`, `kind` and `views` (documented columns, `item`, `includes`) for now. `tables`, `derived`, `deriveVersion`
    are not in `schemas/content-type.schema.json` yet: part B adds them together with the code that reads them (no unused schema keys).
  - The base DDL (`items`, `item_selectors`) and the `v_items` view moved into `bay/sqlsandbox.py` (`BASE_DDL`, `ITEMS_VIEW`), because the type
    validation needs them without the connector; `corpus_store.ddl` uses them. `store_types(con)` and `views_of(fts, types)` live there too.
  - `store_meta` records EVERY type the kit has at store creation (not "the types the mode reads", decision (d)): the golden test needs mail-briefing's
    describe to keep `v_posts` in part A. Narrowing to `reads:` is the documented describe delta (a); do it in B/C with the golden update.
  - `tests/test_core_names.py` (part 15 item 4, the ratchet) was not part of this task and is not built.
- Where email still hard-codes: `VIEWS`, `ITEM_VIEWS`, `MAIL_VIEWS`, `MAIL_FUNCTIONS`, `COLUMNS` (v_email, v_threads, v_attachments, v_fts,
  v_attachment_fts), `email_view_sql`, `attachments_ddl`, `attachment_rows`, `addr_key` registration, `describe` mail logic in `corpus_store.py`.
  View order in describe is now `v_items`, the types' views, then `VIEWS[1:]` (`views_of`), which keeps the old order.
- Type views are written as `CREATE VIEW v_x AS ...` over `temp.v_items` and `main.items`; the loader turns them into `CREATE TEMP VIEW`. `check_views`
  builds them over an empty store with only the base tables and `v_items`: a type with a child table needs its table in that scaffold (extend `check_views`).
- Existing tests I had to change (none is a security test; `test_sqlsandbox.py`, `test_boundaries.py`, `test_resolver.py`, `test_dispatch.py`, `test_lint.py` are untouched):
  `test_corpus_store.py` (user_version 3, "newer than this kit (v3)"), `test_mail_briefing.py` (newer-version case now uses v4, because v3 is current),
  `test_contract_versions.py` (the F-7 mixed-version case now uses email/v2 from `fake-mail`, because post has one version and lives in a content-type.yaml).
- `bay/improve/graph.py::_data_schemas` no longer lists `schema:post/v1` (it only scans `schemas/data`); slice 6 touches `bay/improve/`, not changed here.
- `bay/scaffold.py:128` still says `schemas/data/` in a TODO comment (part C wording).
- The dead-code step was not run (no command for it in this task); new public names are all used by code or tests.
- The 17 amendment entries are already in 0008's `touches:`.
- CLI baseline: `cli_before_check.txt` and a short `cli_before_catalog.txt` are in the scratch folder. `describe feed-briefing` / `describe mail-briefing`
  were run but not saved (very long JSON, and part A changes no mode file, so they cannot differ); save them with Write at the start of part B if wanted.

## Evidence (last lines)
- `python3 tests/run.py -q`: `485 passed, 0 failed`
- `python3 tests/run.py -q -k offline_golden`: `2 passed, 0 failed` (golden files unchanged since a6c035e: `git diff a6c035e --stat -- tests/golden` is empty)
- `./bay.sh check`: `✓ lint clean` / `✓ 6 modes, 21 features, 5 roles (17 role units), 8 envs, 13 connectors resolve (agent profile claude-code)` (same four `!` warnings as before)
- `./bay.sh check --base origin/main --proposal docs/proposals/0008-simplify-without-losing-features.md --docs`:
  `boundary origin/main...HEAD: 26 changed paths (9 core, 2 docs, 5 extension, 10 other); 0 failing; B-11 docs: 0 hits` (before this HANDOFF commit)
- `./bay.sh build --project .../scratchpad/s5a`: `built 6 modes for claude-code`; `./bay.sh clean --project .../scratchpad/s5a`: `clean`
- Glob of scratch `s5a` after clean: `cli_before_check.txt`, `cli_before_catalog.txt`, `agentbay.config.yaml`

# HANDOFF part 15: T-20261030-db86 (recorded with `bay plan`) - slice 5 of 0008 planned (item 3: finish 0006 step 2 and Part E)

Outcome: slice 5 is split into four sequential builder parts (A to D), each a green commit with its own acceptance, and every path it
needs is listed with its touches status. No code changed; no proposal edited. Branch feat/0008-stage4 (from origin/main 1e5eebe).
All line numbers are at 1e5eebe.

## 1. Current state

Base item record
- `schemas/data/item.v1.schema.json:7-18` (envelope: id, extId, source, kind, author, title, text, url, createdAt, fetchedAt, labels, threadId; description names posts and email at :5 and :18).
- Store tables `framework/connectors/corpus-store/corpus_store.py:93-121` (`ddl`: `items`, `item_selectors`, items_fts + triggers); `item_row` :202-218 (kind fields go to `items.ext` JSON, attachment text is stripped :208-210); `row_item` :233-244; `_stored` :247-255.
- `SCHEMA_VERSION = 2` at `bay/sqlsandbox.py:36` (and corpus_store.py:75). A store of another version is refused (`version_error` sqlsandbox.py:285).

Post (kind `post`)
- Fields `schemas/data/post.v1.schema.json:7-12` (lang, metrics). View `v_posts` `bay/sqlsandbox.py:235-240`; column docs :89-93.
- Producers: `connectors/x-api/connector.yaml:13`, `connectors/fake/connector.yaml:9` (`produces: [post/v1]`). Reader: `modes/feed-briefing/mode.yaml:11` (`reads: [post/v1]`).

Email (kind `email`)
- Fields `schemas/data/email.v1.schema.json:7-35` (from, to, cc, messageId, inReplyTo, account, hasAttachments, bulk, attachments[]).
- Producers: `connectors/gmail-api/connector.yaml:17`, `connectors/fake-mail/connector.yaml:12`. Reader: `modes/mail-briefing/mode.yaml:11`.
- Child table `attachments` (+ `attachments_fts`, triggers): `corpus_store.py:124-142`; rows written by `attachment_rows` :221-230 and `_upsert` :566-568.
- Views: `email_view_sql` `bay/sqlsandbox.py:178-227` = `v_email` :183-194 (fromMe/toMe use the SQL function `addr_key` :190-192), `v_threads` :195-213 (`needsReply` :196, lastFromMe/lastToMe/lastBulk :202), `v_attachments` :214-221, `v_attachment_fts` :224-226. Column docs :94-128, :135-139.
- `addr_key` is `bay/selector.py:71-87` (Gmail dot rules); registered as a SQL function `sqlsandbox.py:256`, in the allowlist :56, and `MAIL_FUNCTIONS` :45.
- Constants that name the types: `VIEWS`, `ITEM_VIEWS`, `MAIL_VIEWS`, `TABLES`, `FTS_VIEWS` `sqlsandbox.py:37-48`; `view_sql` :230-246; `connect_ro` creates all views for every store :269; the authorizer allowlist is `self.views`/`self.tables` :314-315, :347-349 (every store gets `v_posts` and the mail views, whatever the mode reads).

Needs-reply and important-sender logic
- `needsReply` = `lastFromMe = 0 AND lastToMe = 1 AND lastBulk = 0`, `sqlsandbox.py:196`.
- `important`: `CorpusStore.threads` `corpus_store.py:1126-1167` (:1163 `addr_matches(important, sender)` from `bay/selector.py:65-68`); also builds `ids` :1156, `lastText` :1158, `attachments` :1160 from the email views.
- Interface `framework/interfaces/items.store.v1.yaml:145-169` (`threads`, text says "Email threads"); `sql` text :88-93 names the views.
- Mode: `modes/mail-briefing/mode.yaml:23` (`gather` step `items.store/v1.threads`, `important: $config.important`); setting `modes/mail-briefing/config.schema.json:6-9` (already the only key; example `config.example.yaml:9`).
- Describe: `corpus_store.py:1075-1124` (mail views listed only when the store holds an `email` row :1093; `fts.attachments` :1117; functions :1197-1199).

How connectors write items
- A source (`items.source/v1`) returns `item/v1` dicts; `corpus-store.sync` validates each with `_validate` `corpus_store.py:527-539` (`model.data_schema("<kind>/v1")`, falling back to `item/v1`), scrubs (`scrub_item` :183), derives the selector tags, and `_upsert` :541-569 writes `items` + `item_selectors` + `attachments`.
- Kinds are found by `model.item_kinds` `bay/model.py:97-109` (any `schemas/data/<kind>.v<N>.schema.json` that extends `item/v1`) and `model.data_schema` :85-91; B-6 lint `bay/lint.py:399-480` checks `reads:`/`produces:` against them (messages :432, :449 use `post/v1` as the example); `bay/scaffold.py:128` scaffolds `produces: [post/v1]`.

How modes query
- Code steps call `items.store/v1.*` (`mode.yaml` `run:`). Agents go through the role unit's use shim: `bay/cli.py:372-386` -> `Dispatcher.use` `bay/dispatch.py:229-256`, allowed when `target in r.bay_uses` (:237), which `bay/model.py:820-824` fills with every read-only endpoint of every needed interface (per role unit, not per feature).
- Dispatcher settings for the store: `_settings` `dispatch.py:487-492` (`mode`, config), `_use_settings` :258-267 (+ bound `sources`). The store keys on `settings.mode` (`corpus_store.py:364`) and knows nothing else about the mode.
- Skills that name views: `modes/briefing/skills/corpus-sql/SKILL.md:9,13,22` (v_posts), `modes/mail-briefing/skills/{corpus-sql,digest}/SKILL.md`.
- Per-feature `uses:`/`skills:` do not exist yet: `Feature` has no such fields (`mode.schema.json:57-180` allows neither); `_plan` hands a role every mode skill (`dispatch.py:561-562`). Slice 3 folded features into `mode.yaml` (no `feature.yaml`), so Part E lands as two more keys of the `features.<name>` block.

Facts the plan depends on
- Boundary rules: `bay/boundary.py:298-336`. A feature folder of an EXISTING mode passes only if an entry's literal prefix reaches `<mode>/features/` (:326). 0008's slice-5 entry `modes/*/features/*/` has literal prefix `modes/`, so it does NOT cover `modes/mail-briefing/features/*` (it does cover `modes/briefing/features/*`, which is core, B-1). Mode-wide files of an existing mode need an entry that matches the path.
- `framework/components.yaml:31` already declares the `contentType` contract (`content-types/<name>/`, `schemas/content-type.schema.json`, `tests/contracts/content_type.py`); neither file exists yet.
- `tests/run.py:18-22` globs `tests/test_*.py` and `*/tests/test_*.py` of `connectors` and `framework/connectors` only.
- B-11 docs check (`boundary.py:339-359`) will report any line of README/DESIGN/INTERFACES outside a fence that has the bare word `post` or `email` once `content-types/post|email` exist. Today: `docs/DESIGN.md:121`, `docs/INTERFACES.md:220,224,225,274`. Each part rewords the lines it exposes.
- Tests that read describe/views today: `tests/test_mail_briefing.py:132,144-153,278,292-310`; `framework/connectors/corpus-store/tests/test_sqlsandbox.py` (Sandbox(path) built with no mode at :158,:343,:357,:375, reads `v_posts`); `test_corpus_store.py:426-429,482`; `connectors/gmail-api/tests/test_gmail_api.py:143,715-764`; `tests/test_contract_versions.py:24,47-48,106-107` (write `schemas/data/*.v2.schema.json`).

## 2. Target (0006 Part B and Part E, mapped to files)

Content type = a folder `content-types/<name>/` (top level, user space like connectors; ships `post` and `email`):
```
content-types/post/    content-type.yaml  fields.schema.json  views.sql  README.md  fixtures/
content-types/email/   content-type.yaml  fields.schema.json  views.sql  derive.py  README.md  fixtures/
```
- `content-type.yaml` (apiVersion/kind `ContentType`/metadata.name/spec): `version: 1`, `kind: <item kind>`, `deriveVersion` (email), `views: {v_email: {description, item: true, columns: [{name,type,description}]}, ...}` (the column docs that `sbx.COLUMNS` holds today, so `describe` reads them from here), `tables: {attachments: {from: attachments, moveOut: [text], columns: {...}, fullText: [name, text]}}` (0006 Part B syntax; table keeps the name `attachments`, the FTS table `attachments_fts`, so agent SQL does not change), `derived: [fromMe, toMe]`.
- `fields.schema.json` = the current `schemas/data/<name>.v1.schema.json` moved (same `$id`/`title` `post/v1`, `email/v1`).
- `views.sql`: only `CREATE VIEW v_<name> ...` statements. Post: `v_posts` (from sqlsandbox.py:235-240). Email: `v_email`, `v_attachments`, `v_attachment_fts` (:183-194, :214-226) with `fromMe`/`toMe` read from stored fields, not from `addr_key`.
- `derive.py`: `derive(item, version) -> dict` of added fields (`fromMe`, `toMe`), holds `addr_key` (moved from selector.py). Runs in the writer after scrubbing; stdlib imports only (lint scans it). Stored in a new column `items.derived` (JSON) with `items.derived_ver`, NOT in `ext`, so `get`/`query` output stays the same. The store records content types and versions in a `store_meta` table; on a `deriveVersion` change it recomputes `derived` locally (no fetch); another type version is refused ("move the folder aside and sync again"). `SCHEMA_VERSION` goes 2 -> 3.
- Loader: discovery is a new `ContentType` kind in `model.KINDS` (`bay/model.py:44-50`, folder `content-types`, glob `*/content-type.yaml`, schema `content-type`), so collisions and errors reuse `Kit`; `model.item_kinds` and `model.data_schema` read it (no `schemas/data/post|email`). Views, tables, derive and mode-view handling live in NEW `bay/contenttypes.py` (listed under `briefing` `owns:` in `framework/components.yaml`). `schemas/content-type.schema.json` is new. `tests/contracts/content_type.py` is the contract suite, run by `tests/test_content_types.py` against every discovered type (see Part A).
- `produces:`/`reads:` already exist and keep their names (`post/v1`, `email/v1`); B-6 lint stays, now fed by the loader. New lint: content-type.yaml shape, documented columns equal the real view columns (built in memory), view SQL passes the read-only authorizer and reads only base tables and the type's own tables/views (B-10), `derive.py` imports, table names unique across the types one mode reads.
- Generic store (`corpus_store.py`, `sqlsandbox.py`): child tables, their delete and FTS triggers, row writing, derive, and the view set come from the loader for the types the mode reads (`reads` equals what its sources produce, by B-6). `describe` lists a type's views for the types the mode reads, the base views, and the mode's own views; `functions` lists only the fixed allowlist. `Sandbox(path)` keeps its signature: the view set is rebuilt from `store_meta` (types, versions, mode view text), so the sandbox security tests stay unchanged.
- Mode-owned views: `modes/mail-briefing/views.sql` defines `v_threads` (with `needsReply`, built on the type's `v_email`) and `modes/mail-briefing/views.yaml` its column docs and the row metadata (`window: lastDate`, JSON and boolean columns, `ids`, `lastText`, `attachments` as SQL columns). Same validation as a type's views. `items.store/v1.threads` stays (no interface version bump) but becomes generic: rows of the view `v_threads` of the mode, window on its `lastDate`, selector on `matched`, `important` marks rows whose `senders` match the patterns (`addr_matches` stays in selector.py: it is the `from` rule, not mail-specific). A mode with no `v_threads` gets an error naming the fix. mail-briefing config keeps only `important` (unchanged file apart from its wording).
- Part E in the slice-3 shape: `features.<name>.uses: [<iface>/v<N>.<endpoint>, ...]` and `features.<name>.skills: [<short name>, ...]` in `mode.yaml`; `mode.schema.json` allows both; lint: every `uses` entry is granted to a role of that feature (B-9), every skill exists in the mode (B-8), a feature with a role step whose unit has `bayUses` must declare `uses`. Enforcement: `Dispatcher.use` allows `target` only if it is in the `uses` of a feature whose open call (`.agentbay/calls/*.json`, status `needs-agent`, cursor on a role step of this unit) waits for that unit; with no such open call the role-level grant applies as today (so existing security tests do not change). `_plan` hands only the feature's `skills`. Whole-feature override: a child's feature of the same name replaces the parent's whole block (`merge_mode`), and `bay show <mode> --resolved` prints the resolved features with their origin. `bay/use_shim.py` itself stays an entry point (listed by 0008, probably untouched).

## 3. Split (sequential; each part ends with `python3 tests/run.py -q` green and `./bay.sh check` clean)

Common to every part: delete replaced code completely (the `deadcode` step fails on new unused code or compat layers); update README/DESIGN/INTERFACES lines for what changed (DOD-13); reword the B-11 doc lines the part exposes; run `python3 -m bay.cli boundary --base origin/main --proposal docs/proposals/0008-simplify-without-losing-features.md --docs` with the amendment entries below applied by the owner (a builder may not edit a proposal: if the entries are missing the check fails by design; list that in the HANDOFF).

Part A: baseline, loader, `post` moved (about 35 calls)
1. First commit, before any other change: `tests/test_offline_golden.py` + `tests/golden/*.json` (see section 5), generated from the untouched code.
2. `schemas/content-type.schema.json`; `ContentType` kind in `model.py`; `item_kinds`/`data_schema` read content types; `bay/contenttypes.py` (load, view/table SQL, validation); `tests/contracts/content_type.py` + `tests/test_content_types.py` (+ `tests/run.py` also globs `content-types/*/tests`); components.yaml `owns` line.
3. `content-types/post/` (4 files + fixtures); delete `schemas/data/post.v1.schema.json` and the `v_posts` code/docs in sqlsandbox.py; the store builds the `post` views from the loader; `store_meta` + `SCHEMA_VERSION` 3 (the table is generic; email still on the old code path until B).
4. `tests/test_core_names.py` with a ratchet: scans core files (`bay/**`, `framework/**` except extension folders, `schemas/**`, `adapters/**`, `coordinator/**`) for the discovered names (quoted kind strings, `<name>/v<N>` refs, `v_<view>` names of discovered types, hyphenated connector names `x-api`, `gmail-api`, `fake-mail`); `ALLOWED` lists today's hits per file and shrinks in B and C.
Acceptance: golden test identical for feed-briefing and mail-briefing; `v_posts` read by the unchanged sandbox security tests; contract suite passes for `post`; a content-type with a view reading another table is refused; kinds still `{post, email}` (email from the old location until B); no `schemas/data/post.*`; docs lines DESIGN.md:121 and INTERFACES.md:224 reworded.

Part B: `email` moved (about 40 calls)
1. `content-types/email/` (content-type.yaml with `attachments` table and `derived`, fields.schema.json, views.sql with `v_email`/`v_attachments`/`v_attachment_fts`, derive.py with `addr_key`, fixtures); delete `schemas/data/email.v1.schema.json`.
2. Generic child tables and derive in `corpus_store.py` (`attachments_ddl`, `attachment_rows`, `_upsert` :566-568, `item_row` :208-210, `describe` mail logic :1093-1120, `_functions` :1197) and `sqlsandbox.py` (delete `email_view_sql`, `MAIL_*`, `addr_key` registration and allowlist entry); `bay/selector.py` loses `addr_key`/`GMAIL_DOMAINS`.
3. `threads()` still reads `v_threads`; until C the view stays in the email type as a documented, temporary home (its SQL moves out in C). Recompute of `derived` on `deriveVersion` change; store version refusal tests.
Acceptance: golden identical except the documented describe deltas (section 5); fromMe/toMe/bulk/needsReply values identical on the mail fixture; attachment text, FTS and delete-with-item tests unchanged; `derive.py` import scan; test_contract_versions rewritten to write `content-types/*/content-type.yaml` versions; gmail tests use `derive.addr_key` for the unit assertions; INTERFACES lines 220-229, 274, 293-315 reworded.

Part C: mode-owned views, generic `threads`, last core names (about 35 calls)
1. Move `v_threads` SQL (with `needsReply`, `ids`, `lastText`, `attachments`) to `modes/mail-briefing/views.sql` + `views.yaml`; contenttypes.py loads mode views (lookup through the `extends` chain), validates them with the same authorizer, records them in `store_meta`.
2. `CorpusStore.threads` becomes the generic reader over `v_threads` (no email names, `important` marking by `addr_matches`); interface text `framework/interfaces/items.store.v1.yaml` (threads, sql, describe) loses every type name.
3. Skills and playbooks: `modes/briefing/skills/corpus-sql/SKILL.md` (generic text, no `v_posts`), `modes/mail-briefing/skills/*`, `features/digest|ask` wording; `config.schema.json` description ("the store marks threads" -> "rows are marked").
4. Remove the remaining core names: `bay/lint.py:381,432,449`, `bay/scaffold.py:128`, `bay/model.py:86`, `bay/config.py:14`, `schemas/{mode,connector,event}.schema.json` examples, `schemas/data/item.v1.schema.json:5,18`, `framework/rules/conformance.yaml:29,44`, `framework/interfaces/items.source.v1.yaml:6`; `ALLOWED` in `tests/test_core_names.py` becomes empty and the test asserts it.
Acceptance: mail-briefing golden (threads output, `v_threads` reads, offline digest plan) identical; feed-briefing describe has no mail view and no mail function, mail-briefing describe has no `v_posts`; a mode without `v_threads` calling `threads` gets the named error; `tests/test_core_names.py` passes with `ALLOWED == {}`; `boundary --docs` reports 0 B-11 hits.

Part D: Part E and the whole-tree checks (about 40 calls; if `uses:` alone has used 30 calls, stop after it, commit, and report the rest as D2)
1. `uses:`/`skills:` in `schemas/mode.schema.json`, `Feature` in `model.py`, lint (B-8, B-9), `Dispatcher.use` scoping and `_plan` skills in `dispatch.py`, whole-feature override in `merge_mode`, `bay show --resolved` in `cli.py`, `bay/scaffold.py` + `framework/modes/forge/templates/feature/feature.yaml` scaffold the keys.
2. Declare them in `modes/briefing/mode.yaml`, `modes/mail-briefing/mode.yaml` (digest: derive the list from its playbook and skill, which also read `thread` and `sql` for attachment text, so not only `get` as 0006's example says), and the framework modes whose units have `bayUses` (`./bay.sh describe improve` and the others show `bayUses`).
3. Tests: a role step calling an endpoint outside its feature's `uses:` is refused with an open call; allowed inside; skills outside `skills:` are not in the plan; a child's feature replaces the parent's whole; `--resolved` shows origins.
4. Whole tree: `tests/test_core_names.py` still green; the unchanged security files pass (tests/test_boundaries.py, test_resolver.py, test_dispatch.py, test_lint.py, the connector tests, the corpus-store sandbox tests); golden compare final; CLI baseline diff (section 5); boundary `--docs` 0 failing; deadcode step.
Acceptance (0006 step 2 plus the 0008 line): offline sync, describe and status of feed-briefing and mail-briefing identical to the baseline except the three documented deltas; no core file names a content type or connector (test); every security test unchanged and passing; boundary check over the whole tree finds no leak; the dead-code check reports no new findings.

## 4. Path table

Covered = an existing 0008 `touches:` entry matches the path (cited by slice and path). New = needs the amendment entry in the last column (all are `slice: 5`).

| Part | Path | Change | Status |
|---|---|---|---|
| A,B | `content-types/post/*`, `content-types/email/*` | new extensions | Covered: slice 5 `content-types/` |
| A | `tests/test_offline_golden.py`, `tests/golden/`, `tests/test_content_types.py`, `tests/contracts/content_type.py`, `tests/test_core_names.py`, `tests/run.py` | tests | no entry needed (boundary class `other`, `tests/`) |
| A,B,C,D | `HANDOFF.md` | notes | no entry needed (`other`) |
| A | `bay/contenttypes.py` | NEW loader | New: amendment 1 |
| A | `schemas/content-type.schema.json` | NEW | New: amendment 2 |
| A | `schemas/data/post.v1.schema.json` | moved out | New: amendment 3 |
| B | `schemas/data/email.v1.schema.json` | moved out | New: amendment 4 |
| C | `schemas/data/item.v1.schema.json` | wording | New: amendment 5 |
| A,B,C | `bay/sqlsandbox.py` | generic views, store_meta | New: amendment 6 |
| B | `bay/selector.py` | `addr_key` leaves | New: amendment 7 |
| A,B,C | `framework/connectors/corpus-store/` (`corpus_store.py`, `tests/test_corpus_store.py`, `tests/test_sqlsandbox.py`) | generic store | New: amendment 8 |
| C | `framework/interfaces/items.store.v1.yaml` | threads/sql/describe text | New: amendment 9 |
| C | `framework/interfaces/items.source.v1.yaml` | wording at :6 | New: amendment 10 |
| C | `modes/briefing/skills/corpus-sql/SKILL.md` | generic text | New: amendment 11 |
| C | `modes/mail-briefing/views.sql` | NEW mode view | New: amendment 12 |
| C | `modes/mail-briefing/views.yaml` | NEW view docs | New: amendment 13 |
| C | `modes/mail-briefing/skills/` | wording | New: amendment 14 |
| C | `modes/mail-briefing/config.schema.json` | wording | New: amendment 15 |
| C | `modes/mail-briefing/features/digest/` (`playbook.md`, `rules.yaml`) | wording | New: amendment 16 (the slice 5 glob `modes/*/features/*/` has literal prefix `modes/` and fails B-3) |
| C | `modes/mail-briefing/features/ask/` (`playbook.md`, `rules.yaml`) | wording | New: amendment 17 (same reason) |
| A,B,C | `bay/model.py` | KINDS, item_kinds, data_schema | Covered: slice 3 `bay/model.py` |
| A,C | `bay/lint.py` | content-type lint, messages | Covered: slice 1 `bay/lint.py` |
| A | `framework/components.yaml` | add `bay/contenttypes.py` to briefing `owns` | Covered: slice 1 `framework/components.yaml` |
| A,B,C | `bay/dispatch.py` (`_settings` :487), `bay/scaffold.py:128`, `bay/config.py:14` | settings, wording | Covered: slice 3 `bay/dispatch.py`, slice 3 `bay/scaffold.py`, slice 2 `bay/config.py` |
| C | `schemas/mode.schema.json`, `schemas/connector.schema.json`, `schemas/event.schema.json`, `framework/rules/conformance.yaml` | example wording | Covered: slice 3, slice 4, slice 8 (`schemas/event.schema.json`), slice 1 |
| B | `bay/improve/graph.py` (`_data_schemas` :150) | schema nodes follow the move | Covered: slice 6 `bay/improve/` |
| B | `connectors/gmail-api/tests/test_gmail_api.py` | addr_key / views assertions | Covered: slice 7 `connectors/gmail-api/tests/test_gmail_api.py` |
| A,B,C | `README.md`, `docs/DESIGN.md`, `docs/INTERFACES.md` | contracts only, B-11 | Covered: slice 9 (each of the three) |
| C | `modes/mail-briefing/mode.yaml`, `modes/briefing/mode.yaml`, `modes/briefing/features/*/` | gather step, wording | Covered: slice 3 `modes/*/mode.yaml`; slice 5 `modes/*/features/*/` (core, B-1) |
| C | `modes/mail-briefing/README.md`, `modes/feed-briefing/README.md` | wording | Covered: slice 2 (each) |
| C | `modes/mail-briefing/config.example.yaml` | only if wording | Covered: slice 7 |
| D | `bay/model.py`, `bay/dispatch.py`, `bay/lint.py`, `schemas/mode.schema.json` | Part E | Covered: slices 3, 3, 1, 3 |
| D | `bay/cli.py` | `show --resolved` | Covered: slice 4 `bay/cli.py` |
| D | `bay/use_shim.py` | probably untouched | Covered: slice 5 `bay/use_shim.py` |
| D | `modes/*/mode.yaml`, `framework/modes/*/mode.yaml`, `framework/modes/forge/templates/` | `uses`/`skills` | Covered: slice 3 (each) |
| D | `bay/scaffold.py` | scaffold the keys | Covered: slice 3 |

Amendment entries (17), to add to 0008's `touches:` by the owner:
```
  - { path: bay/contenttypes.py, reason: "NEW. content-type loader: views, child tables, derive.py, mode views (0006 Part B)", slice: 5 }
  - { path: schemas/content-type.schema.json, reason: "NEW. shape of content-type.yaml; declared in framework/components.yaml", slice: 5 }
  - { path: schemas/data/post.v1.schema.json, reason: "moved to content-types/post/fields.schema.json", slice: 5 }
  - { path: schemas/data/email.v1.schema.json, reason: "moved to content-types/email/fields.schema.json", slice: 5 }
  - { path: schemas/data/item.v1.schema.json, reason: "wording: no content type named in the envelope description", slice: 5 }
  - { path: bay/sqlsandbox.py, reason: "views, tables and functions come from the content-type loader; no type named; store_meta", slice: 5 }
  - { path: bay/selector.py, reason: "addr_key moves to content-types/email/derive.py", slice: 5 }
  - { path: "framework/connectors/corpus-store/", reason: "generic child tables, derive and views for the types a mode reads; tests follow", slice: 5 }
  - { path: framework/interfaces/items.store.v1.yaml, reason: "threads, sql and describe text name no content type; threads reads the mode's v_threads", slice: 5 }
  - { path: framework/interfaces/items.source.v1.yaml, reason: "wording: no content type named", slice: 5 }
  - { path: modes/briefing/skills/corpus-sql/SKILL.md, reason: "generic text: views come from the content types a mode reads", slice: 5 }
  - { path: modes/mail-briefing/views.sql, reason: "NEW. mode-owned v_threads with needsReply (0006 Part B)", slice: 5 }
  - { path: modes/mail-briefing/views.yaml, reason: "NEW. column docs and row metadata of the mode's views", slice: 5 }
  - { path: "modes/mail-briefing/skills/", reason: "skills follow the views the mode owns", slice: 5 }
  - { path: modes/mail-briefing/config.schema.json, reason: "wording: rows are marked important, not the store", slice: 5 }
  - { path: "modes/mail-briefing/features/digest/", reason: "feature playbook and rules follow the generic threads endpoint (B-3 needs the mode named)", slice: 5 }
  - { path: "modes/mail-briefing/features/ask/", reason: "feature playbook and rules follow the mode's views (B-3 needs the mode named)", slice: 5 }
```

## 5. Baseline for "identical offline sync, describe and status output"

Before part A touches anything (first commit of part A):
1. `./bay.sh check` (note the summary line), `./bay.sh catalog`, `./bay.sh describe feed-briefing`, `./bay.sh describe mail-briefing`. Save each output to the scratchpad with Write (as slice 3 did): `cli_before_check.txt`, `cli_before_catalog.txt`, `cli_before_describe_feed.txt`, `cli_before_describe_mail.txt`.
2. Write `tests/test_offline_golden.py` and generate `tests/golden/feed-briefing.json` and `tests/golden/mail-briefing.json` from the UNCHANGED code. The test builds a project with `offline: true` (as `tests/test_mail_briefing.py:17-22`), the fixed `helpers.clock`, and for each mode records: `Dispatcher.call("<mode>.sync", {})["output"]` (no callId), `Dispatcher.use(unit, "items.store/v1.describe", {})`, `...status`, and for mail also `threads {since: "30d", important: ["*@partner.example"]}`, and `sql` reads of `v_email` (id, fromMe, toMe, bulk), `v_threads` (needsReply, lastBulk), `v_attachments` and `fts` examples; for feed `v_posts` (likes, reposts, lang). The test regenerates the structure and compares it with the stored JSON (`GOLDEN_UPDATE` is not offered: a changed file means a changed behavior).
3. The golden file is the reference; a failing golden test is the compare. No new random or wall-clock values are in it.

After part D, same four CLI commands to `cli_after_*.txt`, then `git diff --no-index --stat` per pair. Expected CLI differences: none in `check` beyond counts of content types if printed, none in `catalog`, `describe` only the new `uses`/`skills` lines if it prints features.

Deliberate describe deltas the golden test must assert exactly (0006's design, not regressions; the acceptance text says "identical", so the owner should confirm these three):
- mail-briefing no longer lists `v_posts` (the allowlist is the base views, the views of the types the mode reads, and the mode's own views; 0006 Part B "What the briefing core does"). It had 0 rows there.
- mail-briefing `functions` no longer lists `addr_key` (computed fields are stored, 0006 "Decided"); the `fromMe`/`toMe` column descriptions keep their wording.
- mail-briefing view order is `v_items, v_email, v_attachments, v_threads, v_fts, v_attachment_fts` (type views, then the mode's views, then full-text views) instead of `v_threads` before `v_attachments`; compare views as a name-keyed map and assert the new order separately.
Everything else (columns, descriptions, row counts, samples, fts, limits, coverage, sync counts and cost, status) must match byte for byte. feed-briefing has no delta.

Decisions to confirm (assumed above): (1) the three describe deltas; (2) `v_threads` is mode-owned (0006 line 224 lists it under email, line 278 makes needs-reply the mode's), and `items.store/v1.threads` stays at v1 as a generic reader instead of a new `rows` endpoint (a removed endpoint would need an interface version bump, R-2); (3) with no open call, a use-shim read falls back to the role-level grant (keeps the security tests unchanged); (4) the store creates tables for the types a mode `reads:` (equal to what its sources produce by B-6), not for those its sources produce.

Not in this slice: catalog listing of content types, `forge.connect`, DOD-4 wording (0006 Part C), the apiVersion bump (slice 9).

# HANDOFF part 14: T-20261030-c870 (recorded with `bay plan`) - stage 3: last DOD-2 finding of the re-review (verdict-s3b)

Outcome: in the main thread the guard hook asks for `note dispatch`, `note review` and `show reclaim` in any quoting,
escaping, option or launcher spelling; the three nits are fixed. Stage 3 of 0008 is complete.

To-do (all ticked with `bay plan --done`):
1. Guard: `main_thread_decision` / `asked_bay_write` in bay/guard.py split the Bash command with the guard's own
   `shlex.split` (+ `dequote` fallback, operators split off for unsafe text) and find a launcher (`.agentbay/bay`,
   `./bay.sh`, `bay.sh`, `python3 -m bay.cli`, `python3 bay/cli.py`) anywhere in the words, so env assignments and
   `x; ...` do not hide it. Commit b900ae3.
2. Hook config: the PreToolUse guard entry (adapters/claude-code/claude_code.py:141-146) has matcher Bash|Read|... with no
   subagent filter, so it already ran for the main thread; but `main()` returned 0 before deciding for non-subagents.
   Now `main()` emits `ask` for the main thread. No adapter change needed. Test:
   test_generated_hook_runs_the_guard_for_the_main_threads_bash_calls. Commit b900ae3.
3. Tests: tests/test_guard_mainthread.py (new). Commit b900ae3.
4. Nits: `ap = argparse` spacing; `note -h/--help` and `show -h/--help` print help (test in tests/test_cli_commands.py).
   Commit 5f38a76.
5. Nit: the cron advisory points at the README only when it has a fenced cron recipe (`^```cron`), bay/lint.py. Commit 5f38a76.
6. Tests, check, boundary run (below).

`approve` is not in the hook on purpose: no allow rule covers it, so any spelling already gets the default prompt, and
tests/test_boundaries.py asserts the main thread's plain `approve` is "pass" from the guard (unchanged).

Spellings tested (main thread -> ask; a role subagent -> deny for each):
`note dispatch|'dispatch'|"dispatch"|disp\atch`, `note 'review'|"review"|re\view`, `show re\claim|'reclaim'|"re""claim"`,
`--project .` / `--project=.` / `--proj .` / `--` before the verb, `FOO=1 ` and `A=1 B='2 3' ` env prefixes, launchers
`.agentbay/bay`, `./bay.sh`, `bay.sh`, `python3 -m bay.cli`, `PYTHONPATH=. python3 -m bay.cli`, `python3 bay/cli.py`,
and `echo hi; ...` / `true && ...` prefixes.
No decision (pass) in the main thread: `note <ref> "text about dispatch"`, `note <ref> dispatch`, `note task`, `status`,
`status --log -n 20`, `show <callId>`, `show '<callId>'`, `catalog`, `catalog forge.extend`, `approve`, `'approve'`,
`./bay.sh check`, a git commit message mentioning the words, `ls`.

Evidence:
- `python3 tests/run.py -q`: `476 passed, 0 failed`
- `./bay.sh check`: `✓ 6 modes, 21 features, 5 roles (17 role units), 8 envs, 13 connectors resolve (agent profile claude-code)` (after `✓ lint clean`)
- boundary: `boundary origin/main...HEAD: 104 changed paths (36 core, 3 docs, 31 extension, 9 feature, 25 other); 0 failing; B-11 docs: 0 hits`

# HANDOFF part 13: T-20261030-9a71 (recorded with `bay plan`) - stage 3 review fixes (verdict-s3-fixed)

Outcome: all four should-fix/nit findings of the stage-3 review fixed; nothing pushed, the proposal not edited, no path outside 0008's touches.
To-do (one commit each, tests green before each):
1 DOD-2 (1ed46df): `bay note` / `bay show` refuse any option directly after the command (`_verb_first` in bay/cli.py, run on the raw argv before `--project` is hoisted), so `note dispatch`, `note review` and `show reclaim` always match their ask prefix. The error names the right spelling. Checked every pre-approved prefix (show, status, note, catalog): the only ledger writers in bay/cli.py are `approve` (asked), `note dispatch`, `note review`, `note <ref> text` (a plain note, read-only in effect, stays allowed) and `show reclaim`; status and catalog write nothing. New tests: tests/test_cli_commands.py `test_a_write_verb_must_directly_follow_note_or_show_so_the_ask_rules_match`, tests/test_guard_7a.py (the canonical write forms each start with an ask prefix; the allow list is exactly show, status, note, catalog).
 Refused spellings (each exits non-zero with "no option may come before the verb", ledger unchanged):
 - `note --agent x dispatch T-20261030-abcd`
 - `note --kind note review T-20261030-abcd {}`
 - `note --project . dispatch T-20261030-abcd --agent x`
 - `note --project=. dispatch T-20261030-abcd --agent x`
 - `note --instruction dispatch T-20261030-abcd`
 - `show --reason r reclaim R-1`
 - `show --project . reclaim R-1`
 `--project` before the command (`bay --project . note dispatch ...`) does not match the allow prefix either, so it prompts.
2 DOD-8 (852d97e): `check --json` needs `--base` (refused like --proposal/--docs); the lint and resolve lines go to stderr, stdout is the boundary JSON only. Test: `test_check_json_prints_only_the_boundary_json_on_stdout` (json.loads of stdout).
3 DOD-13/R-4 (d75b5b5): docs/INTERFACES.md lines 7, 24, 339 and docs/DESIGN.md:12 corrected (no framework/agents/, no schemas/agent.schema.json; profile is `profile:` in adapters/<name>/adapter.yaml; a mode lists features, not workflows).
4 DOD-9 (e179ac4, cc521cf): check summary says `21 features`, the COORDINATOR heading is "Mode features (generated)", the catalog help says features. The JSON keys `endpoints` in catalog.json and the `<mode>.<endpoint>` call targets are data formats and stay. The schedule advisory points at the mode's README cron recipe when that README has one (improve: `see the cron recipe in framework/modes/improve/README.md`), else keeps `run ... from cron`; test in tests/test_lint.py. cc521cf also fixes a missing space in the summary I introduced in e179ac4.
Evidence, last line of each command:
- `python3 tests/run.py -q`: `471 passed, 0 failed`
- `./bay.sh check`: `✓ 6 modes, 21 features, 5 roles (17 role units), 8 envs, 13 connectors resolve (agent profile claude-code)`, after `✓ lint clean` (same four `!` advisories, the improve one now points at the README)
- `./bay.sh check --base origin/main --proposal docs/proposals/0008-simplify-without-losing-features.md --docs`: `boundary origin/main...HEAD: 103 changed paths (36 core, 3 docs, 31 extension, 9 feature, 24 other); 0 failing; B-11 docs: 0 hits` (run before this HANDOFF commit)
- `./bay.sh build --project <scratch>/s3e` (folder was empty): last line `  ! Per-role Bash scope is enforced by the agentbay guard hook; restart Claude Code and accept the workspace trust prompt so hooks run.`
- `./bay.sh clean --project <scratch>/s3e`: `clean`
- Glob `**/*` of <scratch>/s3e afterwards: `<scratch>/s3e/agentbay.config.yaml` only.
Open items: none. Deviations: none.

# HANDOFF part 12: T-20261030-1ca6 (recorded with `bay plan`) - stage 3 of 0008: rename leftovers

Outcome: every "rename leftover" entry of 0008's touches is fixed, plus the four extra hits; the forge coordinator playbook has the `git fetch origin` line. Wording only; no behaviour change, no alias. Branch feat/0008-stage3, nothing pushed, the proposal not edited.
To-do (all done; one commit, 77806d3, because the 26 files are one wording sweep and the tests cover them together):
1 Touches entries "rename leftover" (77806d3): the six offline-env files (connectors/x-api, fake, fake-mail README + connector.yaml, modes/feed-briefing and mail-briefing README) now say `offline: true` in agentbay.config.yaml and the env's `offline:` block instead of `local-*-offline`/`envs:`; bay/playbook.py `features.<feature>.review`; coordinator/commands/bay-status.md `status --log -n 10`; bay/checks.py detail `bay check: lint clean`; bay/registry.py comment; improve.findings.v1.yaml `bay approve <F-id>`; schemas/connector.schema.json (`bay check` twice); scaffold connector.yaml, forge README, create playbook (`bay new <kind>`, `./bay.sh check`), create/extend rules (`bay check`), cos run, improve audit, backlog (playbook DOD-2 and rules R-3 name `bay approve`), implement playbook.
2 Extra hits (77806d3): bay/cli.py:405 note summary is now `approve <F-id> <decision>`; bay/scaffold.py docstring `bay new <kind>`; framework/interfaces/forge.scaffold.v1.yaml `bay new <kind>`. bay/improve/sources.py:314 `"target": "review-record"` is NOT changed: it is not display text. It is the verdict `target` key that `_number_rounds` groups on and that detectors and findings read; tests/test_review_record.py:39 asserts it. The ledger event type is `review.recorded` (unchanged), but a finding's evidence can carry the target string, so renaming would alter data. It stays as a stored value; that is not a command name.
3 Playbook line (77806d3): framework/modes/forge/playbook.md, bullet "Before every `forge.extend` call, run `git fetch origin` yourself, so the deadcode base (origin/main) is current." It is a bullet on purpose: the adapter drops bullets naming an uninstalled endpoint, so projects outside the checkout do not see `forge.extend` (a first try as plain prose failed test_b2; fixed before commit).
4 `git grep -n` of the old spellings (bay lint|validate|boundary|log|dispatched|task new|ls|reclaim, review-record, improve decide|weekly, bay mode|feature|connector|env new, bay <kind> new, local-feeds-offline, local-mail-offline, ./bay.sh lint|validate|boundary), excluding HANDOFF.md, CHANGELOG.md, docs/proposals: remaining hits are exactly
 - bay/improve/sources.py:314 (stored `target` value, above)
 - tests/test_cli_commands.py:11 (OLD tuple: the old names must be unknown commands)
 - tests/test_config.py:15 (asserts the two old env files no longer exist)
 - tests/test_review_record.py:39 (stored target) and :45 (old command refused)
 In history files (hit counts): CHANGELOG.md 4, HANDOFF.md 37 (parts 1-11), docs/proposals 0001 3, 0001a 9, 0003 2, 0004 3, 0005 1, 0006 9, 0008 30 (its own text).
5 Scratch build `s3d`: Grep (case-insensitive) of the whole folder for old command names, `<kind> new`, `local-*-offline`, `endpoints.<feature>`: No matches found. A wider Grep of .agentbay/COORDINATOR.md for lint|validate|boundary|dispatched|reclaim|review-record|improve decide|task new found only the current `show reclaim` and `note dispatch` forms (lines 280, 292); of .claude/ only `status --log -n 10` (bay-status.md) and the English noun "lint" in a skill (improve--pattern-analysis SKILL.md:14). The earlier open item (bay-status.md) is closed.
Evidence, last line of each command:
- `python3 tests/run.py -q`: `469 passed, 0 failed`
- `./bay.sh check`: `✓ 6 modes, 21 endpoints, 5 roles (17 role units), 8 envs, 13 connectors resolve (agent profile claude-code)`, after `✓ lint clean` (same four `!` advisories)
- `python3 -m bay.cli check --base origin/main --proposal docs/proposals/0008-simplify-without-losing-features.md --docs`: `boundary origin/main...HEAD: 81 changed paths (29 core, 3 docs, 24 extension, 1 feature, 24 other); 0 failing; B-11 docs: 0 hits` (run before this HANDOFF commit)
- `./bay.sh build --project <scratch>/s3d` (folder had only its agentbay.config.yaml): last line `  ! Per-role Bash scope is enforced by the agentbay guard hook; restart Claude Code and accept the workspace trust prompt so hooks run.`
- `./bay.sh clean --project <scratch>/s3d`: `clean`
- Glob `**/*` of <scratch>/s3d afterwards: `<scratch>/s3d/agentbay.config.yaml` only.
Open items: none. Deviations: none from the command list.

# HANDOFF part 11: T-20261030-f8ef (recorded with `bay plan`) - slice 4 of 0008: the CLI

Outcome: `bay --help` lists 16 commands (25 before; the proposal's 15 plus `plan` from item 6). An old name is an unknown command (argparse `invalid choice`, exit 2); no alias, no compatibility branch. Branch feat/0008-stage3, nothing pushed, the proposal not edited. Guard decisions keep their meaning (below). One needed fix is outside 0008's touches (open items).
Old -> new:
| old | new |
|---|---|
| `validate`, `lint` | `check` (lint, then resolve, then workflows) |
| `boundary --base ...` | `check --base <ref> [--head --proposal --docs --json]` (options without `--base` are refused) |
| `ls` | `catalog --roles` (role units, resolved from sources, no build needed; the mode/endpoint half of `ls` was `catalog`) |
| `reclaim <run>` | `show reclaim <runId> [--reason]` |
| `log -n` | `status --log -n` |
| `task new` | `note task` |
| `dispatched <taskId> --agent ...` | `note dispatch <taskId> --agent ...` |
| `review-record <taskId> <json>` | `note review <taskId> <json>` |
| `mode\|feature\|connector\|env new <name>` | `new <kind> <name>` (`--mode` for a feature, `--implements` for a connector, checked) |
| `improve decide <id> approve\|defer\|wontfix` | `approve <F-id> [--defer\|--wontfix] [--reason]` (the F- prefix selects it; terminal only, `--via chat`, `--reject`, `--quote`, `--sha` are refused for it) |
| `improve weekly` | removed (proposal: "removed"; item 4 makes the weekly run a cron line or workflow). The improve playbook and README now list the four calls in order, with a cron line. |
Kept as they were: `build clean catalog describe call submit show approve secret auth config status note plan`.
Where the proposal was silent I chose: `note` takes the verb first (`note task|dispatch|review`) and `show` takes `reclaim` first, so a permission rule can match them by prefix; `review-record` goes into `note` (like dispatch) rather than staying a 17th command; `ls` goes into `catalog --roles`.
Guard and permissions (same decisions):
- bay/guard.py needed no rule change: a role subagent may run only `.agentbay/bay plan <own taskId> ...`; every other spelling (including all new ones) is denied by the same checks; `approve` is denied to anyone by `runs_approve`, so `approve <F-id>` is covered. Only the docstring names changed. `secret`, `auth`, config writes: unchanged paths (non-TTY refusal, `names_config`).
- The main thread pre-approves `show|status|note|catalog` (was `show|status|log|note|task|catalog`). Three writes now share a prefix with a pre-approved command, so adapters/claude-code/claude_code.py adds `ask` rules (checked before `allow`) for `show reclaim`, `note dispatch`, `note review` in every spelling that `approve` already had; before, `reclaim`, `dispatched` and `review-record` were not pre-approved and so asked. `approve` keeps its ask rules.
- `bay secret set` and `bay auth` unchanged (interactive terminal only). The Chief of Staff playbook now also says never to relay a backlog decision (`bay approve <F-id>`) from chat.
- The env `clis` for the forge builders (framework/envs/framework-dev.yaml, local-authoring.yaml) list `./bay.sh check` instead of `lint` and `validate`.
Generated text: the cos playbook (so `.agentbay/COORDINATOR.md`), the adapter's control-plane section, improve and forge playbooks, scaffold hints, error messages, README, DESIGN, INTERFACES, conformance.yaml, two schema descriptions. A scratch build's COORDINATOR.md has no old command name (grep of the scratch folder found only `.claude/commands/bay-status.md`, see open items). The checkout's own `.agentbay/COORDINATOR.md` is untracked and generated: it still shows the old names until the coordinator runs `./bay.sh build`.
To-do (all done; the work is in three commits, 4b8da69 the CLI, guard texts, adapter, playbooks and tests together because the names and their tests change together, 46750c0 README/DESIGN/INTERFACES, dd0faaa reverts of edits that the boundary check refused plus a README wording fix):
1 Read proposal, guard, model, adapter, CLI (no commit).
2 Merge commands and remove the old code: `cmd_ls`, `cmd_log`, `cmd_task`, `cmd_reclaim` as a command, `cmd_review_record`, `cmd_dispatched`, `cmd_improve_decide`, `cmd_improve_weekly`, `WEEKLY`, `SCHEDULED_BY` (lint) are gone (4b8da69).
3 Names in guard, adapter, generated text, playbooks, env clis, tests (4b8da69, 46750c0, dd0faaa). Tests: only command names changed in existing tests (test_boundaries, test_review_record, test_ledger, test_selector, test_lint, test_forge, test_adapter, test_improve) plus extra denials in `test_bay_plan_is_the_only_bay_command_a_subagent_may_run` (note review/dispatch/task, show reclaim, approve, approve F-id, secret, auth, check, catalog) and ask-rule asserts in test_guard_7a. `test_weekly_writes_the_backlog_only_after_the_analysis_steps` is deleted with the command it tested. New tests/test_cli_commands.py (16 commands, old names unknown, note/show/new/catalog forms).
4 Checks and this note.
Open items (outside 0008's touches, so editing them fails the boundary check; add to the next amendment):
- BLOCKER-ish: `coordinator/commands/bay-status.md` (kernel-owned, not in touches) still runs `bay log -n 10`; the generated slash command `/bay-status` now calls an unknown command. Change it to `{{BAY}} status --log -n 10` (or drop the log call).
- Feature folders of existing framework modes (B-3, not in touches): `framework/modes/cos/features/run/playbook.md:27` (`bay lint`), `framework/modes/forge/features/create/playbook.md` (lines 11, 13, 17: `bay <kind> new`, `./bay.sh lint` and `./bay.sh validate`; the builder's cli list no longer has them, so create's builder is told to run unknown commands), `framework/modes/forge/features/create/rules.yaml` and `.../extend/rules.yaml` (`bay lint` in a statement), `framework/modes/improve/features/{audit,backlog,implement}/...` (`bay lint`, `bay improve decide` in playbook/rules text, and DOD-2 of backlog, which the report no longer matches: it prints `bay approve`). I made these edits and reverted them when the boundary check refused them.
- Core files not in touches: `bay/checks.py:87` (detail text `bay lint clean`), `bay/registry.py:10` (comment `bay lint`), `framework/interfaces/improve.findings.v1.yaml:117` (`bay improve decide`), `schemas/connector.schema.json:68,152` (`bay lint`, `bay validate` in two descriptions). `docs/proposals/*` and this file's older parts keep the old names as history.
- `lint` still warns that `improve.backlog` (schedule weekly) should be run by `bay call improve.backlog` from cron; that alone writes the report without the scan, audit and triage calls. Slice 6 turns the weekly run into a feature or workflow; until then the improve README has the four-call cron recipe.
Deviations from the task's command list, to be honest about: the checks were run as `./bay.sh check` and `python3 -m bay.cli check --base ...` (the renamed lint, validate and boundary); `./bay.sh lint` and `validate` no longer exist. Two helper edits were done with `python3` (a heredoc for the parser block in bay/cli.py, and a `python3 -c` to delete one test function from tests/test_improve.py); the results are in the commits and the tests pass.
Dead-code check: not run here (it runs when cos re-runs forge.extend). Replaced code was removed completely; grep for `cmd_ls`, `cmd_log`, `cmd_task`, `cmd_improve`, `WEEKLY`, `SCHEDULED_BY`, `cmd_review_record`, `cmd_dispatched` in bay/, tests/, framework/, docs/ finds nothing.
Evidence, last line of each command:
- `python3 tests/run.py -q`: `469 passed, 0 failed` (run on dd0faaa)
- `./bay.sh check` (was lint, then validate): `✓ 6 modes, 21 endpoints, 5 roles (17 role units), 8 envs, 13 connectors resolve (agent profile claude-code)`, after `✓ lint clean` (four `!` advisories as before)
- `python3 -m bay.cli check --base origin/main --proposal docs/proposals/0008-simplify-without-losing-features.md --docs` (was boundary): `boundary origin/main...HEAD: 80 changed paths (29 core, 3 docs, 24 extension, 1 feature, 23 other); 0 failing; B-11 docs: 0 hits` (run on dd0faaa, before this HANDOFF commit)
- `./bay.sh build --project <scratch>/s3c` (folder did not exist): last line `  ! Per-role Bash scope is enforced by the agentbay guard hook; restart Claude Code and accept the workspace trust prompt so hooks run.`
- `./bay.sh clean --project <scratch>/s3c`: `clean`
- Glob `**/*` of <scratch>/s3c afterwards: `<scratch>/s3c/agentbay.config.yaml` only (the user's file, left by clean).
- `./bay.sh lint` now: `bay: error: argument <command>: invalid choice: 'lint' (choose from 'check', 'build', 'clean', 'catalog', 'describe', 'call', 'submit', 'show', 'approve', 'new', 'secret', 'auth', 'config', 'status', 'plan', 'note')`
- `./bay.sh --help` command list (the positional section):
```
check            lint and resolve everything; with --base, also check a change's boundary
build            compile modes and roles into a runtime
clean            remove what build wrote
catalog          the registry: modes, endpoints, schemas, project workflows (--roles: role units)
describe         a mode's or role's resolved definition
call             run <mode>.<endpoint> with a JSON input ('-' reads stdin)
submit           hand back an agentic step's output
show             the state of a call; `show reclaim <runId>` marks a stuck run as reclaimed
approve          pass (or --reject) an approval gate; interactive terminal, or chat when approvals.chat is on; an F-id decides an improve backlog item
new              scaffold a mode, feature, connector or env
secret           store a secret in the keychain (interactive terminal only)
auth             sign in to a source in your browser (interactive terminal only)
config           print every agentbay.config.yaml setting, from the schemas
status           calls, steps and agent runs from the ledger (--agents, --log)
plan             a dispatched agent's outcome and to-do list (append-only; the one command subagents may run)
note             record a note on a run, task or call; `note task` mints a taskId; `note dispatch` and `note review` are the coordinator's records
```

# HANDOFF part 10: T-20261030-72ef (recorded with `bay plan`) - slice 3 of 0008: one feature shape

Outcome: slice 3 is implemented on feat/0008-stage3, nothing pushed, the proposal not edited. Every mode builds from `features:`; a code-only feature has no playbook, no rules and no folder and passes lint; `bay catalog` is unchanged except for ordering. No old-shape reader, alias or compatibility branch was added; no `feature.yaml` (0006 slice 4 lands inside the feature block).
To-do (all done, one commit because schema, loader, lint, modes and tests change together; c9e6dcc):
1 Catalog baseline saved before any change: <scratch>/catalog_before.txt (scratchpad root).
2 Shape: `spec.features.<name>` = `{description, in, out, effects, steps, playbook?, rules?, review?, schedule?, roles?, tier?, effort?}`. schemas/mode.schema.json: `endpoints` and `workflows` are replaced by `features` with `steps`; the step definition moved to `$defs/step`. bay/model.py: `Feature.workflow` field, the workflow lookup and the unknown-workflow gap are gone; `merge_mode` merges features key by key and a child's `steps` replace the parent feature's whole (the `workflows` branch is removed); `role_env_problems`, `mode_envs`, `resolve_mode`, `_feature` read `features`. bay/dispatch.py needed no code change (it runs `Feature.steps`); docstrings follow.
3 Lint (bay/lint.py): a feature with a role or review step and no `playbook` is refused ("runs an agent but has no `playbook`"); rules and playbook are otherwise optional; the "workflow is not used", "unknown workflow" and "feature folder is missing playbook.md/rules.yaml" checks are removed (no workflow, and the files are optional); an orphan feature folder is still refused. Line lookup (`_ep_key_where`, `_step_where`) reads `features:` and matches a feature's own keys (6-space indent), so a step's `roles:` is not mistaken for the feature's.
4 Migrated: modes/{briefing,delivery,mail-briefing}/mode.yaml, framework/modes/{cos,forge,improve}/mode.yaml (steps inline, text of every step unchanged). bay/improve/{conformance,graph,sources}.py read `features`/`steps`. bay/scaffold.py scaffolds the single block: framework/modes/forge/templates/feature/feature.yaml replaces endpoint.yaml and workflow.yaml (deleted); the mode template is one `features:` block. Docs: docs/INTERFACES.md, docs/DESIGN.md, bay/workflows.py docstring, schemas/config.schema.json and framework/rules/conformance.yaml wording.
5 Tests (tests/ is "other" to the boundary): the 22 tests that wrote `endpoints`/`workflows` now write `features`/`steps` (test_dispatch, test_review7a, test_roles, test_resolver, test_inheritance, test_lint); new `test_a_feature_that_runs_an_agent_needs_a_playbook_and_a_code_only_one_needs_no_files` (briefing.sync without playbook, rules or folder: lint empty, resolves with no DoD and code steps only); `test_lint_lines_of_inherited_parts...` now checks a child's own steps are reported at the child's step line; test_forge asserts a scaffolded feature is one `features:` block with no `endpoints`/`workflows`.
Open, outside this slice's touches: bay/playbook.py:62 still says "configure review only in mode.yaml endpoints.<feature>.review" (bay/playbook.py is not in 0008's touches, so editing it would fail the boundary check); add it to the next amendment and change the wording to `features.<feature>.review`. Existing extension READMEs were grepped for `endpoints:`/`workflows:`/`workflow:`: none name the old shape. The apiVersion bump stays in slice 9 (mode documents are still `agentbay/v2`).
Dead-code check: not run here (it runs when cos re-runs forge.extend). Replaced code was removed completely. Grep (`\.workflow\b`, `["workflow"]`, `spec["workflows"]`, `spec["endpoints"]` on modes, `endpoint.yaml`, `workflow.yaml`, `_lineage_where(... 'workflows'`) finds nothing in bay/, framework/, modes/, schemas/ or docs/ outside the proposals and this file. `spec["endpoints"]` that remains is the interface (connector capability) endpoints, which are a different concept.
Evidence, last line of each command:
- `python3 tests/run.py -q`: `464 passed, 0 failed`
- `./bay.sh lint`: `✓ lint clean` (four `!` advisories as before)
- `./bay.sh validate`: `✓ 6 modes, 21 endpoints, 5 roles (17 role units), 8 envs, 13 connectors resolve (agent profile claude-code)`
- `python3 -m bay.cli boundary --base origin/main --proposal docs/proposals/0008-simplify-without-losing-features.md --docs`: `boundary origin/main...HEAD: 57 changed paths (22 core, 3 docs, 16 extension, 16 other); 0 failing; B-11 docs: 0 hits` (run on c9e6dcc, before this HANDOFF commit)
- `./bay.sh build --project <scratch>/s3b`: last line `  ! Per-role Bash scope is enforced by the agentbay guard hook; restart Claude Code and accept the workspace trust prompt so hooks run.` (it reported `built 6 modes for claude-code`)
- `./bay.sh clean --project <scratch>/s3b`: `clean`
- Glob `**/*` of <scratch>/s3b afterwards: `<scratch>/s3b/agentbay.config.yaml` (written by build, left by clean because it is the user's file) and `<scratch>/s3b/proj/.git/**` (a git-init folder that was already in the scratch folder before this task; not created by the build or by me). No generated adapter file is left.
- Catalog before/after: before = `./bay.sh catalog` in the checkout before any change (registry built 14:34:42, includes forge.extend, 21 endpoints); after = `./bay.sh catalog --project <scratch>/s3b` after `build` (registry built 15:15:36). The checkout's own `.agentbay/catalog.json` is only rewritten by a build of the checkout, which was not in the allowed commands, so the after-catalog comes from a scratch project; a scratch project does not install forge.extend (`System.for_project`), which is the only line that differs: all 20 other endpoint lines (names, in -> out types, effects, review roles), all mode headers and the `project workflows: none` line are identical, in the same order. forge.extend is covered by `validate`: still 21 endpoints, and by tests (`test_dispatch` extend flows, `test_deadcode_check` step order, `test_lint` mandatory review).

# HANDOFF part 9: T-20261030-79af (recorded with `bay plan`) - slice 2 of 0008: envs, agent profile, config

Outcome: slice 2 is implemented on feat/0008-stage3 (cut from origin/main 1da7f88), nothing pushed, the proposal not edited. Both offline env files and the committed example config are gone; the fake-source demo runs (`offline: true`); lint refuses an offline block with a network host or a secret, and a config that raises an env limit. No v2 readers, aliases or compat branches were added.
To-do (all done, one commit because the items share schemas and tests; 8742b4e, then 8cf495d for a README wording fix that the B-11 docs check needed):
1 Offline switch in the env: `envs/local-feeds.yaml` and `envs/local-mail.yaml` carry `offline: { bind: { items.source/v1: [fake | fake-mail] } }`; `envs/local-*-offline.yaml` deleted; `substitutes:` removed from schemas/environment.schema.json (now `offline {bind, network, secrets}`), the `envs:` map removed from schemas/config.schema.json (now `offline: boolean`). `Kit._go_offline` (bay/model.py) rebinds the listed capabilities and forces `network: {allow: []}` and `secrets.allow: []`; `Kit.env_name`, `_select_envs`, `env_swap` and `lint_substitutes` are removed, and a role's env name is now the env itself (units are `analyst--feed-briefing`, env `local-feeds`). New `lint.lint_offline`: refuses an `offline:` block that lists a network host or a secret, or rebinds a capability the env does not bind; `lint_contract_versions` checks the offline connectors too (label `env local-mail (offline)`).
2 Agent profile in the adapter: `framework/agents/claude-code.yaml` and schemas/agent.schema.json deleted; the profile is `profile:` in `adapters/claude-code/adapter.yaml` (schemas/adapter.schema.json, optional, same fields). `Kit.profiles()` and `Kit.profile()` return the profile dict; the `Agent` kind, `FRAMEWORK_ONLY["Agent"]` and the `agents/` ownership line in framework/components.yaml are removed; claude_code.py, improve/graph.py and improve/conformance.py follow.
3 Config: `agentbay.config.example.yaml` deleted; `bay build` writes a minimal `agentbay.config.yaml` when the project has none (`config.write_minimal`); `bay config` (no argument) prints every setting from the schemas (`config.describe`); `config.example()`, `fragment()`, the kernel text blocks and the stale-example lint are removed (each extension's `config.example.yaml` stays and lint still checks it against its schema). Limits in one place: `config.caps` refuses a setting above the env `limits` (ConfigError; the step fails with the message), `config.raised` + `lint.lint_config_limits` refuse it in lint; settings no longer enter the `min` in `caps` (they already reach it through `effective_constraints`).
4 Tests: tests/test_config_example.py -> tests/test_config.py (no example, `bay config`, minimal config on build, caps, raised cap fails a call); tests/test_lint.py (offline refusals, raised limits); test_resolver (offline switch, adapter profile); helpers (`project()` sets `offline: true`); test_mail_briefing, test_roles, test_inheritance, test_dispatch, test_selector, test_boundaries, test_contract_versions and the corpus-store tests follow the env rename (`local-feeds-offline` -> `local-feeds`; the corpus-store tests get an `online=True` store built from the same project without `offline`).
5 Docs: README, docs/DESIGN.md, docs/INTERFACES.md (all in touches) and connectors/gmail-api/README.md (in touches) follow.
Open, outside this slice's touches (stale wording, not code): connectors/x-api/README.md:11, connectors/fake/README.md:4, connectors/fake-mail/README.md:4 and connector.yaml:7, modes/feed-briefing/README.md:7 and modes/mail-briefing/README.md:11 still name `local-feeds-offline` / `local-mail-offline` or the `envs:` line. They are existing extensions not listed in 0008's touches, so the boundary check would fail an edit; add them to the next amendment (slice 2 or 9) and fix the wording. The apiVersion bump stays in slice 9 (configs and envs are still `agentbay/v2`).
Dead-code check: not run here (it runs when cos re-runs forge.extend). Replaced code was removed completely; grep for `env_name`, `env_swap`, `substitutes`, `docs["Agent"]`, `config.EXAMPLE`, `framework/agents`, `agentbay.config.example` finds only the stale extension READMEs above and the new tests that assert absence.
Evidence, last line of each command:
- `python3 tests/run.py -q`: `463 passed, 0 failed`
- `./bay.sh lint`: `✓ lint clean` (four `!` advisories as before)
- `./bay.sh validate`: `✓ 6 modes, 21 endpoints, 5 roles (17 role units), 8 envs, 13 connectors resolve (agent profile claude-code)`
- `python3 -m bay.cli boundary --base origin/main --proposal docs/proposals/0008-simplify-without-losing-features.md --docs`: `boundary origin/main...HEAD: 39 changed paths (16 core, 3 docs, 7 extension, 13 other); 0 failing; B-11 docs: 0 hits` (run on 8cf495d, before this HANDOFF commit)
- `./bay.sh build --project <scratch>/s3a` (folder did not exist): last line `  ! Per-role Bash scope is enforced by the agentbay guard hook; restart Claude Code and accept the workspace trust prompt so hooks run.`; the output starts `+ agentbay.config.yaml` (the minimal config)
- `./bay.sh clean --project <scratch>/s3a`: `clean`
- Glob `**/*` of <scratch>/s3a afterwards: `<scratch>/s3a/agentbay.config.yaml` only. `clean` leaves the config because it is the user's file, not generated by an adapter.
- Fake-source demo: `tests/test_mail_briefing.py::test_offline_sync_digest_and_ask` and the feed flows in test_dispatch run on `offline: true` and pass in the 463 above; I did not run `bay call` by hand (not in the allowed commands).

# HANDOFF part 8: T-20261030-f82e (recorded with `bay plan`) - fix round for the stage-2 review of 0008 (C-20261030-79f3e5)

Outcome: every should-fix finding of the review (DOD-5, DOD-7, DOD-8, DOD-13, R-4, R-7, R-9) is fixed; the proposal was not edited; no Guard decision changed. Branch feat/0008-stage2, nothing pushed.
Declared (DOD-7/R-9): cc55bd8 is an out-of-slice refactor of `Guard._bash`, `ClaudeCodeAdapter._settings` and `ledger_verdicts`. It was forced by the stale local `origin/main` (1fc4803, PR #10) that the first deadcode run used as base, and it is behaviour-equivalent per the review. The owner decided to keep it. Add it to the next 0008 amendment's touches (slice 1, reason "complexity refactor surfaced by the first deadcode run"). The owner also accepted the four flagged scope items (test_dispatch stubs, README and INTERFACES edited in slice 1, improve-detect 0.1.0 -> 0.2.0, fixed base `origin/main`); ledger note on C-20261030-79f3e5.
Fixes:
1 (5d7959a) DOD-8 base drift: `Pipeline.change` resolves `git merge-base <base> HEAD` and exports that commit; a base that does not resolve is refused with "fetch <remote> (git fetch <remote>)"; the resolved sha is named in `warnings`. The extend playbook says the coordinator runs `git fetch origin` first. Tests `test_the_base_is_the_merge_base_not_the_moved_ref`, `test_a_base_that_does_not_resolve_says_to_fetch`.
2 (5d7959a) DOD-8 graph asymmetry: when the project is the kit the base graph is built with `graph.build(old, old)`, so it has concept nodes like the current one. Test `test_an_unused_concept_that_existed_at_base_is_not_new_when_the_project_is_the_kit` (project == kit, an unused interface present at base is reported unused now and not new).
3 (5d7959a, 0843c27, d455025) DOD-8 smaller items: findings are compared uncapped (maxFindingsPerDetector raised for both sides, test `test_a_second_finding_with_the_same_fingerprint_is_new` checks the value passed); fingerprints compared as a multiset (same test: a second identical fingerprint is new); tar errors become `ValueError("cannot extract <base>: ...")` (`test_a_broken_archive_is_a_clear_error`); the base reader refuses .env* and files over 1 MB like artifact-graph and names them under `unreadable at base` (`test_the_base_side_refuses_env_files_and_large_files`); the endpoint description names the temporary export (removed on return) and the fingerprint granularity (compat-layer per file, complexity per function) instead of changing `effects`; the B-7 fixtures `lib/tests/helper.py` and `shared/x_entry.py` now contain `import gmail_api` and the test asserts both hits again (0843c27); `ask = perms` spacing (d455025).
4 (afe15c6) DOD-13/R-4: docs/DESIGN.md (Safety model) describes the `deadcode` step in contract terms; DESIGN.md is allowed by touches.
Evidence, last line of each command:
- `python3 tests/run.py -q`: `460 passed, 0 failed`
- `./bay.sh lint`: `✓ lint clean` (four `!` advisories as before)
- `./bay.sh validate`: `✓ 6 modes, 21 endpoints, 5 roles (17 role units), 10 envs, 13 connectors resolve (agent profile claude-code)`
- `python3 -m bay.cli boundary --base origin/main --proposal docs/proposals/0008-simplify-without-losing-features.md --docs`: `boundary origin/main...HEAD: 27 changed paths (10 core, 3 docs, 6 extension, 1 feature, 7 other); 0 failing; B-11 docs: 0 hits`
- `./bay.sh build --project <scratch>/s2fix` (empty folder): last line `  ! Per-role Bash scope is enforced by the agentbay guard hook; restart Claude Code and accept the workspace trust prompt so hooks run.` (it reported `built 6 modes for claude-code`)
- `./bay.sh clean --project <scratch>/s2fix`: `clean`
- Glob `**/*` of <scratch>/s2fix afterwards: `No files found`
- The scratch folder is an empty non-git folder, so there is no `git status` to quote; the Glob shows nothing left behind.
- Fake-source demo (offline switch, no network): `tests/test_mail_briefing.py::test_offline_sync_digest_and_ask` (sync, digest and ask over the fake source) passed (`1 passed, 0 failed` with `-k offline_sync_digest`); `tests/test_adapter.py::test_cli_build_and_clean_on_tmp_repo` and its sibling (the round trip on a tmp repo) passed (`2 passed, 0 failed` with `-k cli_build_and_clean`). I did not run `bay call feed-briefing.sync` by hand (not in the allowed commands).

# HANDOFF part 7: T-20261030-b84c (recorded with `bay plan`) - stage 2 of 0008, the dead-code check (item 5 of part 6)

Outcome: `improve.detect/v1.change` and the `deadcode` step in forge.extend exist, are tested, documented and committed on feat/0008-stage2. Done.
To-do (all done):
1 (019645d) `change {base}` in framework/interfaces/improve.detect.v1.yaml, framework/connectors/improve-detect (connector.yaml 0.2.0, improve_detect.py, README.md) and `Pipeline.change` (bay/improve/pipeline.py): audits the working tree and the base tree (`git archive` into a temp dir, never run), keeps unused, unused-constant, compat-layer and complexity candidates whose fingerprint is absent at base; returns `{new, existing, warnings}` plus `stopped` when `new` is not empty (the dispatcher ends a code step with `stopped` as blocked).
2 (9f07820) forge mode.yaml: step `deadcode` (`run: improve.detect/v1.change`, `base: origin/main`) between implement and review; `improve.detect/v1` in needs; local-authoring binds improve-detect, ledger (session.events, review.verdicts) and artifact-graph.
3 (9f07820) extend playbook: Steps list has `deadcode`; DOD-14.
4 (9f07820) tests/test_deadcode_check.py: unused function plus compat alias give two new findings (the existing unused function counts as `existing`); a base finding does not count; any revision works and a bad one is refused; a new finding blocks the extend call before review; the step plan has deadcode between implement and review. tests/test_dispatch.py: two extend tests that run past implement stub the step (their kit copy is not a git repo); tests/ is "other" to the boundary, not in touches.
5 (640d3da, 168a089) README and docs/INTERFACES.md describe the endpoint and the step.
Note: the base is the literal `origin/main` in mode.yaml; ExtendReq (types, not in touches) has no base field.
Evidence:
- `python3 tests/run.py -q`: 453 passed, 0 failed
- `./bay.sh lint`: ✓ lint clean
- `./bay.sh validate`: ✓ 6 modes, 21 endpoints, 5 roles (17 role units), 10 envs, 13 connectors resolve (agent profile claude-code)
- boundary: boundary origin/main...HEAD: 73 changed paths (28 core, 3 docs, 20 extension, 1 feature, 21 other); 0 failing; B-11 docs: 0 hits

# HANDOFF part 6: T-20261030-882f (recorded with `bay plan`) - stage 2 of 0008, step `implement` of C-20261030-0cbe82

Outcome: slice 1 minus the dead-code check, plus carry-overs (a)-(d). PARTIAL: stopped at the tool-call budget. Branch feat/0008-stage2.
To-do (done: 1, 2, 3, 4, 6, 7; open: 5 = the dead-code check, then the evidence block).
1 (4d673db) (a) `ledger.dispatched_agent` returns the coordinator's latest `agent.dispatch` of a taskId and uses a `spawned` record only when no dispatch exists, so a later spawn cannot launder another call's taskId. Test `test_a_later_spawn_record_does_not_override_the_coordinators_dispatch`.
2 (4d673db) (b) `Dispatcher._close_runs`: a role step's submit appends `completed` for every still-running run dispatched to that call and step (and the run the result names). Test `test_a_steps_submit_closes_every_run_dispatched_to_that_call_and_step`.
3 (bb00394) `CHANGELOG.md` is in the kernel's `owns:` (framework/components.yaml). It was a real B-4 lint failure on this branch before.
4 (bb00394) Misfires: a repo-root file no component owns passes (`boundary.classify`, `boundary.stray`); owned root files (bay.sh, CHANGELOG.md) still need `touches:`. B-7 (`lint.lint_extension_names`) now scans connector code only, for imports (also `import_module("x")`) and the kernel's `agentbay_connector_*`/`agentbay_adapter_*` keys; prose, comments and mode playbooks are not scanned; `mode.yaml` naming a connector is still refused by the mode lint (lint.py ~306). Tests updated to the new spec (`test_no_extension_names_another_b7`, `test_b7_catches_...`, `test_ownership_lint_...`) and added (`test_repo_root_files_pass_...`); an import of another connector and a core edit without touches still fail. INTERFACES and conformance.yaml wording follow. Not done: renaming rules to plain reasons everywhere (messages keep their ids in brackets).
5 OPEN the dead-code check. Design, not built: a new `improve.detect/v1` endpoint `change {base}` -> `{new: [candidates], existing: n}` (framework/interfaces/improve.detect.v1.yaml, connector framework/connectors/improve-detect, `Pipeline.change` in bay/improve/pipeline.py): audit the working tree and the tree at `base` (export with `git archive` into a temp dir, never run its code), keep candidates of kinds unused, unused-constant, compat-layer, complexity whose `fingerprint` (bay/improve/store.py) is absent at base. forge `extend` gets a code step `deadcode` between `implement` and `review` (`run: improve.detect/v1.change`, stopped -> blocked on any new finding); forge needs `improve.detect/v1` in `needs:` and an env that binds improve-detect with its sources (see framework/envs/improve-local.yaml: artifact-graph, ledger). Add DOD-14 to features/extend/playbook.md ("no new unused code or compatibility layers"). Fixture test: add an unused function and a compat alias, expect two new findings; an existing finding does not count. Touches the owner must add to 0008 (editing it voids the approval): framework/interfaces/improve.detect.v1.yaml, framework/connectors/improve-detect/, framework/envs/local-authoring.yaml (or framework-dev) and framework/modes/forge/mode.yaml is covered by `framework/modes/*/mode.yaml`.
6 (this commit) (c) README mentions schedules (cron); suite has no README size test, count is about 900.
7 (d) the probe gate_repro_sha.py in the review-s1 scratchpad (not in the repo) catches `model.ResolveError` for R5: last line `R5 resolve refuses the edit (fixed): ...`.
Tests: 448 pass.

# HANDOFF part 5: T-20261030-ba74 (recorded with `bay plan`) - stage 1 fix round for the review of C-20261030-bc7db5

Outcome: DOD-8, DOD-9, R-7 and the usage double count fixed; the proposal was not edited. To-do: 1-5 done.
1 (92e3019) `Dispatcher._require_plan` takes the result's taskId only when that run's dispatch names this call and step (or no call). Test `test_a_plan_of_another_step_or_call_does_not_count` now expects refusal.
2 (92e3019) Chose to REMOVE the `agent` parameter of `ledger.record_plan`/`record_done` and the AGENTBAY_AGENT claim: nothing sets that variable and the CLI has no caller identity, so making it real would need new adapter plumbing. Plan ownership is per agent type: the guard lets a role subagent run only its own `bay plan`; the dispatch record ties the plan to its call and step. Documented in `ledger._dispatched_check` and `cli.cmd_plan`; pinned by `test_plan_ownership_is_per_agent_type_not_per_run`. Sibling builders of one type can still tick each other's plans (a known limit, not a regression).
3 (610f494) README: code fence on its own line, guard caveat and budget-caps sentence restored; three phrases trimmed to stay near 900 words.
4 (9a2fd62) `ledger.agent_groups` splits a step's submitted usage evenly among the agents dispatched to that call and step (documented in INTERFACES). Test `test_a_steps_usage_is_split_among_the_agents_dispatched_to_it_not_counted_per_agent`.
5 Evidence, last lines of each command:
- `python3 tests/run.py -q`: `445 passed, 0 failed`
- `./bay.sh lint`: `✓ lint clean` (four `!` warnings as before: schedules and the workspace env)
- `./bay.sh validate`: `✓ 6 modes, 21 endpoints, 5 roles (17 role units), 10 envs, 13 connectors resolve (agent profile claude-code)`
- `./bay.sh build --project <scratchpad>/s1fix` (empty folder): `! Per-role Bash scope is enforced by the agentbay guard hook; restart Claude Code and accept the workspace trust prompt so hooks run.`; `./bay.sh clean`: last line `clean`; a glob of the folder afterwards: `No files found`
- `python3 -m bay.cli boundary --base origin/main --proposal docs/proposals/0008-simplify-without-losing-features.md --docs`: `boundary origin/main...HEAD: 59 changed paths (21 core, 3 docs, 16 extension, 1 feature, 18 other); 0 failing; B-11 docs: 0 hits`
- `python3 -I plan_probe.py <kit> <built project>`: every `bay plan` case with a foreign taskId, extra args, `--project`, `dispatched`, `review-record` or `approve` for role subagents is `deny`; non-role subagents: `deny  None  .agentbay/bay plan T-20261030-2908 --done 1`. Last line `pass  None      ./bay.sh  plan T-20261030-2908 '{}'` (no opinion from the guard for `./bay.sh` spellings, as before; Claude Code prompts). The probe needs two arguments (kit, built project).
- `python3 -I gate_repro_sha.py <kit>`: `R1 forged line -> awaiting-approval approve | the gate runs: no recorded approval ...`, `R3 revert to superseded content -> approve`, `R4 no crash`, `R5 gaps: ["forge.create step fill: `when: stale > 1h` is for code steps ..."]`; then the probe's own R5 step raises `ResolveError` at line 66 because resolve now rejects that edit (the probe expects a runtime crash, so it ends with a traceback; the defect it probes is fixed).
- Fake-source demo: no command for it is in this task's allowed list; the fake-source flows run inside the test suite (test_dispatch, test_mail_briefing), counted in the 445 above.

# HANDOFF part 4: T-20261030-b07b (recorded with `bay plan`) - stage 1 of 0008 COMPLETE

Outcome: items 7 and 8 done. To-do (done: 1-4): 1 docs (README 895 words, INTERFACES, DESIGN, cos playbook, four role prompts; COORDINATOR.md rebuilt); 2 cleanup (dead `when: approved` branch in `Dispatcher._skip` and its schema text removed, no test existed for it; `approved` output of forge.scaffold `proposal` removed from connector and interface); 3 evidence; 4 this file.
Tests: 442 pass. lint clean, validate ok, scratch build + clean round trip leaves the folder empty, `bay boundary --docs`: 0 B-11 hits.
Open for the owner: `bay boundary --base origin/main --proposal 0008 --docs` still fails 17 paths (B-1 5, B-2 9, B-3 3) because stage 1 touched paths that 0008's `touches:` does not list (adapters/claude-code, git/gmail-api/claude-transcripts/scaffold connectors, framework/interfaces forge.scaffold + workflow.run, forge extend playbook + Result type, mail-briefing config.example, schemas event/review.verdict/session.episode). Editing the proposal changes its approved sha256, so it was not touched.

# HANDOFF part 3: T-20261030-5110 (recorded with `bay plan`)

Outcome: stage 1 of 0008 complete (all 8 items below). One commit per green item. Tests: 442 pass. Stopped at the tool-call budget after item 6.
To-do (done: 1-6; open: 7, 8):
1 done (1e6a513) `Dispatcher._agents` takes inputs from the dispatch event's data.inputs. 2 done (55e6ba3) `cites` {taskId, outcome, todo[]} in review.verdict/v1 items;
review brief has `review.recordedPlans` (taskId -> step, outcome, todo). 3 done (652b66a) `ledger.agent_groups` (moved from cli), `plans` passed to Store.backlog, "### Agent runs" section in report.py.
4 done (213a915) cause: `TranscriptSource.sessions` only scanned <root>/<folder>/*.jsonl; with root = the project folder nothing matched. Now also <root>/*.jsonl. Test in claude-transcripts tests.
5 done (0916492) commit["subject"] scrubbed, 200 chars, in session.episode/v1; git connector docs and test updated.
6 done (3bb7364) `bay review-record <taskId> '<review.verdict/v1>'` -> event `review.recorded` (ledger.REVIEW_TYPES, schemas/event.schema.json); improve's `ledger_verdicts` reads it (target "review-record");
cannot target a callId, nothing in dispatch reads it; tests/test_review_record.py (incl. subagent guard denial).
7 OPEN docs: README, docs/INTERFACES.md (event type, cites, review brief recordedPlans, commit subject, review-record, dispatched --input), docs/DESIGN.md, framework/modes/cos/playbook.md
(cos runs `bay dispatched ... --input` before every agent dispatch; chat approvals carry `--sha`; out-of-framework review -> `bay review-record`), role brief template (subagents run `bay plan` first; reviewer may cite with `cites`).
Also .agentbay/COORDINATOR.md is generated from the cos playbook/role files: edit the sources, then build. Grep `bay plan|bay dispatched|--sha` for where each already appears.
8 OPEN cleanup: dead `when: approved` branch in Dispatcher._skip and its test; unused `approved` output of the forge.scaffold proposal endpoint.

# HANDOFF part 2: T-20261030-4424 (recorded with `bay plan`)

Outcome: slice 8 finished, slice-7a findings F-1..F-7 fixed with tests, improve blind spots closed.
To-do, as recorded with `bay plan` (done: 1, 2, 6, 7, 8, 9; open: 3, 4, 5, 10, 11, 12). Tests: 436 pass.
1 done F-4/F-5/F-6. 2 done submit refused without plan (`Dispatcher._require_plan`; tests/helpers.py wraps `submit` to
record dispatch+plan, `submit_strict` is the real one; tests/test_submit_needs_plan.py). 3 open: optional outcome/todo citation in
review.verdict/v1 (VERDICT in bay/dispatch.py, `_accept_review`) and the recorded plan (ledger.plans) in the review brief (`_plan`, kind review).
4 open: improve backlog reads ledger.plans and `_agent_groups` (bay/cli.py) figures. 5 PARTIAL: forge.extend skip is done and tested
(mode.yaml `propose` has `when: "!$in.proposal"`; playbook.md updated); docs still open: README, docs/INTERFACES.md, docs/DESIGN.md,
framework/modes/cos/playbook.md (cos runs `bay dispatched` before every Agent dispatch; chat approvals carry `--sha <prefix>`), role brief
template (subagents run `bay plan` first). 6 done F-1 (`--sha`). 7 done F-2 (guard `dequote`). 8 done F-3 (`_state_holds`). 9 done F-7 (adapter ask/deny).
10 open claude-transcripts connector (0 episodes with `root` set; fixture = top-level session .jsonl + subagents/). 11 open git episode subjects (scrubbed).
12 open `bay review-record <taskId> '<verdict json>'` -> review.verdict/v1 event (event type must be added to schemas/event.schema.json and ledger.TYPES).
Note: the dead `when: approved <f>` branch in Dispatcher._skip is no longer used by forge; remove it with its test when convenient.

# HANDOFF: 0008 stage 1 (slice 8, agent run records, plus dogfood bug fixes)

Task T-20261030-c91d, call C-20261030-bc7db5, step `implement`. Stands in for `bay plan` until it exists.

## Outcome (what done looks like)

Slice 8 acceptance line of docs/proposals/0008-simplify-without-losing-features.md:

- A subagent can run `bay plan` and no other `bay` command.
- Plan events are scrubbed, size-limited, append-only and refused for another taskId.
- `step.started` carries the step's inputs.
- `bay status` lists a dispatched agent even with the spawn hook off (cos logs the dispatch).
- A role-step submit without a recorded outcome is refused.
- `bay show` prints outcome, to-do progress and inputs.
- `bay status --agents` groups runs by role, mode, model and tier from the ledger alone.
- A reviewer verdict cites outcome and to-do items.
- improve's weekly backlog reads the same figures.

Dogfood bugs, each with a test:

- (a) result block `protocol:` and the step `Result` type agree.
- (b) with `approvals.chat` on, gate plan and `bay show` name the chat path.
- (c) approval binds to proposal path and sha256 even when written by the same call's propose step.
- (d) one skip rule: ledger approval of the proposal's current content skips propose and approve; front-matter marker grants nothing.
- (e) ledger approval binding for 0008's current content, if (c) makes it derivable.

Constraints: security only stricter (except `bay plan`, which only appends its own events); guard tests only added to; no new dependencies; no compat code; commit per green item; stop near 50 tool calls with this file updated.

## To-do (status: open / done / dropped(reason) / blocked(reason))

1. done. Bug (a): align `protocol:` in the subagent result block and the `Result` type. Serves bug (a).
2. done. Bug (b): gate plan and `bay show` name the chat path when `approvals.chat` is on. Serves bug (b).
3. done. Bug (c): approval binding uses propose-step output artifacts or the call input. Serves bug (c).
4. done. Bug (d): single skip rule by ledger approval; remove front-matter reliance. Serves bug (d).
5. done. `ledger`: `agent.plan` / `agent.plan.done` events, scrubbed, size-limited, taskId-checked, fold. Serves "plan events scrubbed, size-limited, refused for another taskId".
6. done. `bay plan` CLI command, append-only; guard allows it as the only `bay` command for subagents. Serves "subagent can run bay plan and no other".
7. done. `step.started` carries inputs (value, or sha256 plus preview). Serves "step.started carries inputs".
8. done. `agent.dispatch` event via cos (`bay dispatched` or equivalent) and `bay status` lists it. Serves "status lists dispatched agent with hook off".
9. open (blocked on test churn: 48 existing role-step submits in tests lack a taskId/plan; needs its own pass). Refuse role-step submit with no recorded outcome. Serves "submit refused without outcome".
10. done. `bay show` prints outcome, to-do progress, inputs. Serves "bay show prints ...".
11. done. `bay status --agents` grouping by role, mode, model, tier. Serves "status --agents".
12. open (not started; review.verdict/v1 needs optional outcome/todo citations and the review brief needs the plan). Reviewer brief and verdict cite outcome and to-do items. Serves "reviewer verdict cites ...".
13. open (not started). improve weekly backlog reads the same figures. Serves "improve's backlog reads same figures".
14. open (bug (e) already answered: NOT derivable. The 0008 gate event of this call recorded `approves: none`, because the gate then named no file; recording a binding by hand would forge the owner's approval, so it is left to followups). Docs (README, INTERFACES, DESIGN, COORDINATOR/playbooks) and bug (e) binding. Serves R-4 and bug (e).

---

# HANDOFF - proposal 0006, step 1

Branch `feat/source-kinds` (slices 1-3, PR #10); slice 7a on `feat/extend-v2`, based on PR #10's branch. The spec is `docs/proposals/0006-component-contracts-and-content-types.md`
(approved). Step 1 is built in slices. Each slice is done by a fresh builder, ends with tests green, a
commit and a push, and updates this file. This file is removed in the last slice.

## Slices

| # | Slice | Proposal parts | Boundaries | Status |
|---|---|---|---|---|
| 1 | Quiet checks + component map + `bay boundary` (+ proposal `touches:` parsing) | A, F | B-1, B-2, B-3, B-11 | done |
| 2 | Ownership by folder: `adapters/`, `framework/interfaces/`, discovery, `bay auth <connector>`, per-extension README + `config.example.yaml`, `bay config example`, config schemas that extend, docs describe contracts only | A, D | B-4, B-11 | done |
| 3 | Versioned `reads:`/`produces:`/`needs:`/`implements:`, no extension names another, per-mode skill namespaces, C-7 vocabulary | D | B-6, B-7, B-8 | done |
| 4 | `feature.yaml` (workflow, skills, `uses:`), whole-feature override, `bay show <mode> --resolved` | E | B-3, B-8 | todo |
| 5 | Per-feature `uses:` enforced in the use shim (security) | E | B-9 | todo |
| 6 | Contract tests: connector, source (incl. change-feed), mode; run against every instance | A | B-5 | todo |
| 7a | Approvals from chat (Part G, behind `approvals.chat`); forge.extend skips `propose` for a proposal marked approved, the gate only for a recorded approval of its exact content; the kit ignores its own build output | G, C | - | done |
| 7b | The new forge.extend: propose, approve, `foreach:` implement, code `check`, review, release; observable DoD/rules; generated briefs; `HANDOFF.md` protocol | C, F | all existing | todo (plan below) |
| 7c | Shared forge protocol for create/connect; improve `boundary-crossing` detector | C, F | B-1..B-3 | todo (plan below) |

PRs: slices 1-3, 4-5 and 6-7 each make one PR, with an independent review per PR.

## Done
Slice 1 (7970db8, a1493ce, a2e8fa8, 048577a):
- `tests/run.py -q`: only failures (with tracebacks) and the summary line.
- `framework/components.yaml` (kernel, briefing; paths as today) + `schemas/components.schema.json`; `bay lint`
  validates it and checks every `owns:` glob matches a real path (`lint.lint_components`).
- `bay/proposal.py`: front-matter `touches:` parser. 0006 now starts with front matter listing step 1's
  crossings (slice 1 entries, and slices 2-7 marked `planned: true`).
- `bay boundary --base <ref> [--head <ref>] [--proposal <file>] [--docs] [--json]` (`bay/boundary.py`).
- `tests/test_boundary.py` (11 tests, tmp git repos).

Acceptance, PR #9 range with no proposal (`bay boundary --base b8e7512 --head 07aae9e`), exit 1:
```
README.md: core docs - core docs change only when the proposal lists them
agentbay.config.example.yaml, bay/cli.py, bay/connect.py, bay/dispatch.py, bay/lint.py,
schemas/connector.schema.json, schemas/data/email.v1.schema.json: kernel - core path (B-1)
bay/selector.py, bay/sqlsandbox.py, framework/connectors/corpus-store/{corpus_store.py,tests/test_corpus_store.py},
interfaces/items.source.v1.yaml, interfaces/items.store.v1.yaml, modes/briefing/features/sync/playbook.md: briefing - core path (B-1)
connectors/fake/{connector.yaml,fake.py}: connector fake - existing connector folder (B-2)
docs/DESIGN.md, docs/INTERFACES.md: core docs
boundary b8e7512...07aae9e: 47 changed paths (14 core, 3 docs, 22 extension, 8 other); 19 failing (B-1: 14, B-2: 2, docs: 3)
```
(new folders `modes/mail-briefing/`, `connectors/gmail-api/`, `connectors/fake-mail/`, `envs/local-mail*.yaml` pass.)
This branch against 0006: `bay boundary --base 07aae9e --proposal docs/proposals/0006-...md` → 0 failing.

Slice 2, items 1-4 (e769955, 902b7bf, 7419371, 3ae26b7, 463e662):
1. Adapters: `adapters/claude-code/` (`claude_code.py` + `adapter.yaml`: name, module, class). Protocol,
   `BuildReport` and discovery in `bay/adapter.py` (`discover`, `module`, `get`); REGISTRY dict gone;
   `bay/adapters/` removed. Map's adapter contract: `at: ["adapters/<name>/"], protocol: bay/adapter.py`.
2. `items.source.v1.yaml`, `items.store.v1.yaml` moved to `framework/interfaces/` (briefing owns
   `framework/interfaces/items.*`); `interfaces/` is now empty (user interfaces only). `workflow.run` was
   already there.
3. `bay auth <connector> [--env E]`: runs the connector's declared `spec.login` (a function in its entry;
   schema field added). Kernel passes `cli.LoginContext`: `secret`/`store_secret` limited to the connector's
   `needs.secrets` (read values are `vault.remember`ed), `http` limited to its `needs.network` that the env
   allows, `open_browser`, `say`. Env = `--env` or the one env that binds the connector. TTY only, as before.
   Gmail flow is `connectors/gmail-api/gmail_api.py cli_login`. Hints now say `bay auth gmail-api`;
   mail-briefing's playbooks say "the `bay auth <connector>` command the reason names".
4. Config schemas extend: `Doc.config_files` (schema chain along `extends`, root first),
   `model.config_schema(kit, md, gaps)` merges them; redefining an inherited key is a gap and a
   `bay lint` error (`lint.lint_config_schemas`). mail-briefing's `config.schema.json` holds only `important`.
   improve's graph reads config keys from the chain.
Tests added: tests/test_auth.py (4), test_adapter discovery, gmail cli_login, two in test_inheritance.

Slice 2, item 0 and item 5, and item 6 README part (5b15c98, 4a595a0, fca12db, 4127fdb):
0. `adapters` is in `model.PROTECTED` again (owner decision); the claude-code adapter uses `model.PROTECTED`
   (its own copy is gone). Pinned list in tests/test_boundaries.py is `["framework", "bay", "schemas",
   "adapters"]`; new test `test_adapter_code_is_protected_when_the_project_is_the_kit`. framework-dev's
   `fs.write` gains `adapters` (it could write `bay/adapters/` before the move; without it forge.extend could
   not edit adapter code at all).
5. Every settings-taker has `config.example.yaml` (its settings body, no `<name>:` key): feed-briefing,
   mail-briefing, x-api, gmail-api, fake, fake-mail, framework improve and claude-transcripts. READMEs for
   modes briefing, feed-briefing, mail-briefing, delivery; connectors x-api, gmail-api (Gmail setup moved here),
   fake, fake-mail; framework improve, claude-transcripts. `bay/config.py`: `KERNEL_HEADER`,
   `KERNEL_WORKFLOWS`, `OFFLINE_SWITCH`, `takes_settings`, `fragment`, `example(kit)`. `bay config example
   [--stdout]` writes/prints agentbay.config.example.yaml (user extensions first, then framework, by name; envs
   offline switch from `substitutes:`). `lint.lint_self_description`: user modes/connectors need README.md;
   settings-takers need a config.example.yaml their schema accepts (`features` ignored); the example file must
   equal `config.example(kit)` ("agentbay.config.example.yaml is stale; run bay config example").
   Scaffolds write README.md (templates `framework/modes/forge/templates/{mode,connector}/README.md`).
   tests/test_config_example.py (4); helper `helpers.self_describe` for hand-written test modes.
6. (README part) README.md rewritten to contracts only (911 words): instance names only inside fenced
   examples; Settings section; `bay auth <connector>`, `bay config example`, `bay boundary` in the table;
   framework-mode commands (`bay improve ...`) are listed in that mode's README. B-11 now skips instances
   under a core `owns:` path (briefing base mode, corpus-store): they are core, not extensions.

Slice 2, item 6 (rest) and item 7 (9bd9f51, d7e728c):
6. DESIGN.md (1603 words) and INTERFACES.md describe contracts only. Instance text moved to READMEs:
   framework/modes/cos/ and forge/ (new), improve (detectors, interface/connector table, cron);
   framework/connectors/{workflow-runner,ledger,git,artifact-graph,improve-detect,improve-store}/README.md (new);
   connectors/gmail-api/README.md "How it reads" (the DESIGN mail paragraph). Word collisions reworded
   ("run log", "version control", `bay/model.py` `USER_FRAMEWORK_ENVS` for the shareable framework envs,
   `<env>: <offline env>`). B-11 now counts: the `DOCS_COUNTS` switch is removed (always on, no dead
   toggle); hit lines say the fix. `--docs` 0 hits. README.md trimmed to 858 words, setup steps kept.
7. B-4: `lint.lint_ownership` runs `git ls-files` in the kit (skipped when not a checkout) and fails every
   tracked file that is not core docs, other, under a core `owns:` or in an extension `at:` folder
   (`boundary.stray`), naming the file and the fix. The shipped kit has no stray file. Test:
   `test_ownership_lint_names_stray_tracked_files_b4`.

Slice 3, B-6, B-7 and C-7 (commits on feat/source-kinds after 313120a; see `git log`):
- B-6: modes declare `reads: [<kind>/v<N>]`, items.source connectors `produces: [<kind>/v<N>]` (schema fields
  added). `lint.lint_contract_versions` refuses an unversioned `needs:`/`implements:`/`reads:`/`produces:`, an
  unknown kind, an items.source connector without `produces:`, a non-abstract mode needing items.source/v1
  without `reads:`, a version mismatch, and a read no bound connector produces (message names forge.connect).
  Envs checked: every env the mode's `roles:` map (mode-wide and per endpoint) plus every env that
  `substitutes:` one of them. Known kinds = `schemas/data/*.schema.json` whose `allOf` refs item/v1
  (`model.item_kinds`; today post/v1, email/v1). Filled in: feed-briefing reads post/v1, mail-briefing
  email/v1; x-api, fake produce post/v1; gmail-api, fake-mail email/v1. briefing declares none. The connector
  scaffold writes a `produces:` TODO line.
- B-7: `lint.lint_extension_names`: mode files (mode.yaml, playbook.md, config.example.yaml,
  config.schema.json, features/, skills/, types/) never name a connector or another mode (extends ancestors
  excepted); connector .py/.yaml never name a mode or another connector; connector code imports no other
  connector's entry module. Word-bounded like B-11. Fixed hits: mail-briefing config example `in: Work`
  (Gmail notation table now only in connectors/gmail-api/README.md "Selectors in Gmail notation"),
  mail-briefing description "your email", mail-sql skill id example `<source>:...`, fake-mail description
  no longer names gmail-api, forge create playbook "stubbed HTTP layer".
- C-7: "content type" and "item" in the fixed vocabulary; C-4 and C-8 statements name B-7.
- `SLICES_BUILT = 3`; touches: conformance.yaml `planned` off, forge create playbook added.
- tests/test_contract_versions.py (4 tests); briefing-child fixtures in test_inheritance/test_roles now
  declare `reads: [post/v1]` (required by B-6).

Slice 3, B-8 (bc7634a):
- Build writes a mode's skills (own and inherited) to `.claude/skills/<mode>--<skill>/` and a role's own skills
  to `<role>--<skill>/`; the copied SKILL.md `name:` is rewritten to the folder name (`_rename_skill`). A child's
  same-named skill overrides its parent's for that child only (`model.mode_skills`, nearest first).
- `model.skill_id`, `model.role_skill_names`, `SKILL_NAME_MAX = 64`. `ResolvedMode.skills` and
  `ResolvedRole.skills` are keyed by the namespaced name; `ResolvedRole.skill_names` maps short -> namespaced
  (a role's own skill replaces the mode's same-named one for that role).
- References: subagent "## Skills" lists `` `<mode>--<skill>` (<short>) ``; step plans carry
  `skills: {short: namespaced}`; COORDINATOR.md gets a "Skills (generated)" table (skill, from, playbooks call
  it). catalog.json / `bay show` list namespaced names. Playbooks and prompts keep short names.
- mail-briefing's skills renamed back to `corpus-sql` and `digest` (they override briefing's again).
- `lint.lint_skill_names` rewritten for B-8: short name must be `[a-z0-9]+(-[a-z0-9]+)*`; namespaced name at most
  64 (message names the overshoot and the fix); no two sources build the same name; every skill a mode's
  playbooks (mode playbook + each endpoint's resolved playbook) name ("the X skill", "(X skill)") is in the
  mode chain or the skills of a role the mode maps; a role prompt's reference is the role's own or in every
  mode that maps it. `bay clean` removes the folders (manifest), build is idempotent.
- Tests: test_adapter round trip (no clobbering, override child-only, name: rewritten, idempotent rebuild,
  clean removes `.claude/skills/`), test_dispatch plan `skills`, test_lint `*_b8` (3), test_inheritance.
- Touches: `modes/*/skills/` `planned` off; bay/dispatch.py's slice-5 planned entry merged into a slice-3 one.

Slice 7a (32b4eab, 838fbb9, 8dcb8ff, 74cdeb9, 515dbfb; correction de3d779):
- 0006 Part G "Approvals from chat" (owner decision 2026-10-29); 0006 front matter `status: approved`,
  `approvedBy: user`, `date: 2026-10-29`; Part C notes the approved-proposal skip; slice-7a `touches:`.
- `bay approve <id> --via chat --quote "<msg>"` (bay/cli.py `_approval_channel`): refused unless
  `approvals: { chat: true }` (schemas/config.schema.json, `config.chat_approvals`, exactly `true`); the quote is
  mandatory; `--quote` without `--via chat` is refused; the terminal path is unchanged (TTY + "yes").
- Ledger: call gates (`Dispatcher.approve(..., quote=)`) and workflow gates (new `Dispatcher.approve_run`, which
  also writes a `step.completed` event, none existed before) record `data: {approved, by, quote}`;
  `by` is `user@chat-via-cos` or `user@tty`. workflow.run/v1.approve takes `quote`.
- Guard (bay/guard.py): every subagent (agentbay role or not) is denied `bay approve` in any spelling
  (`runs_approve`: bay, bay.sh, .agentbay/bay, bay/cli.py, `-m bay.cli`; parsed words, raw text when the command
  does not parse) and any Bash command naming `agentbay.config.yaml` or a root-level glob matching it
  (`names_config`). File-tool writes to it were already denied (NEVER_FILES). (74cdeb9 also denied a subagent
  write that turned a proposal to `status: approved`; de3d779 removed it, see Decisions.)
- forge.extend: first step `proposal` (code, `forge.scaffold/v1.proposal`, `when: $in.proposal`) reads the
  front matter; `propose` carries `when: "!$steps.proposal.approved"` (approved = status approved +
  approvedBy + date). `approve` carries `approves: $in.proposal` and no `when:` (de3d779): the dispatcher hashes
  the file itself, `bay approve` records `data.approves: {path, sha256}`, and the gate is skipped only when the
  ledger's latest dispatcher decision by `user@tty`/`user@chat-via-cos` on that path and hash is an approval
  (`Dispatcher._gate_check`). An edit while the gate waits makes `bay approve` refuse and re-plan. The plan's
  `why`/`approves` and `bay show`'s `gates` say why the gate ran or was skipped; `bay approve` prints path + sha256.
  Lint: a gate takes no `when:`; `approves:` only on a gate. The path must match `docs/proposals/<name>.md` (interface pattern; the connector also
  resolves it under docs/proposals/).
- `when:` grammar: `[!]$in.<f>`, `[!]$steps.<id>.<f>`, `stale > <age>`; role steps now take `when:`; resolve
  fails when `$steps.<id>` is not an earlier step.
- `.gitignore`: `/.claude/`, `/CLAUDE.md`.
- Docs: cos playbook "Gates from chat"; extend playbook; README, DESIGN, INTERFACES; generated CLAUDE.md.
- Tests: test_boundaries `*chat*` (4), `test_guard_denies_bay_approve_*`, `test_no_subagent_writes_agentbay_config_yaml`,
  `test_no_subagent_writes_the_ledger`, `test_chat_approval_of_a_proposal_*`; test_dispatch
  `test_extend_marker_skips_propose_but_never_the_gate`, `test_a_recorded_approval_*`, `test_an_edit_after_*`,
  `test_only_bay_approve_events_*`, `test_a_gate_takes_no_when_*`, `test_when_names_only_an_earlier_step`; test_adapter `test_building_the_kit_into_itself_*`.
  test_boundary `SLICES_BUILT` is now the set {1, 2, 3, 7}.

### Review round 1 (PR #10, independent review)
Fixed (one commit each, pushed):
- F-2 `bay auth`: LoginContext reads and stores through vault.SecretAccessor (env `secrets.allow` x connector
  `needs.secrets`), `--env` must bind the connector, lint refuses a `login:` whose needs.secrets no binding env
  allows; docstring says it limits the API, not the in-process entry. Test: the reviewer's evil connector.
- F-3 test_roles creates `interfaces/` in the kit copy; stray empty `interfaces/` removed.
- F-1 `bay boundary` diffs with `--name-status --no-renames --no-relative -z` (deletions and both sides of a move;
  independent of git config). 0006 already listed `interfaces/items.*` and `framework/interfaces/`.
- F-4 new-extension detection is casefolded against `git ls-tree` at base; lint rejects case-colliding tracked
  paths and mode/connector/adapter folders without their manifest.
- F-5 B-11 fences follow CommonMark (opening char and length); names match with re.I.
- F-6 B-7: re.I, module form, `agentbay_connector_*`/`agentbay_adapter_*` keys, only top-level `tests/` exempt,
  manifest-referenced files (entry, mode config) scanned unless core; INTERFACES states the scan is incomplete.
- F-7 B-6 flags a bound connector producing a read kind at another version (mixed versions).
- F-8 skill references: re.I and "the skill X" (prose words after "the skill" skipped unless backticked).
- F-9 docs: `adapters/` in the protected lists; skill namespaces and SKILL.md `name:` rewrite; connector `login:`
  and the `bay auth` contract (INTERFACES section 4).
- F-10 `bay boundary` ignores `planned: true`; bay/improve/graph.py listed (slice 2), schemas/ and connectors/*/
  narrowed to this PR's files; later-slice globs stay planned.
- F-11 lint fails when two envs declare `substitutes:` of the same env, naming both (`lint.lint_substitutes`).
- F-12 `schemas/adapter.schema.json` (named in the component map; touches entry added to 0006); lint checks the
  schema, `name` = folder and `module` a file inside the folder (`lint.lint_adapters`, imports nothing).
  `adapter.discover()` leaves bad entries out and reports them (build/clean print them as warnings), so a broken
  runtime cannot stop another; only the selected runtime's code is imported. sys.modules key = folder with every
  non-alphanumeric character escaped (`adapter.module_key`): claude-code and claude_code differ.
- F-13 a child config schema's `$defs` colliding with the parent's, or any top-level keyword outside
  `model.CHILD_CONFIG_KEYS`, is a resolve gap and a lint error naming it.
- F-14 `bay boundary` reads framework/components.yaml at `--base` and the proposal's touches at `--head` (git
  show); an uncommitted proposal is an error. `.github/` dropped from OTHER (unowned: fails unless listed).
- F-15 `model.skill_front_matter` (yaml, CRLF normalised); lint reports an unclosed/non-YAML/non-mapping SKILL.md
  front matter; `_rename_skill` writes `name` first, keeps other keys, and on a bad block removes the copy and
  stops the build.
All round-1 findings (F-1 to F-15) fixed.

### Review round 2 (PR #10, confirmation review)
- N-1 `bay boundary` uses head's component map only when the diff adds it (status A in base...head); then no
  new-extension pass: every changed path outside other must be in touches:. A base without a map that the change
  does not add is an error. The reviewer's backdoor (a map making `bay/<name>` an adapter folder) fails. This PR
  still passes: all 93 paths are listed.
- N-2 the map and the "is this extension new" tree are read at `git merge-base base head` (what base...head diffs
  against); the stale-fork scenario (main deletes a mode after the fork, the PR edits it) fails B-3.
- N-3 `ComponentMap.parse` raises RuntimeError on bad YAML, a non-mapping document or a non-mapping
  `components:`; the CLI prints one line.
- N-4 a skill reference ("the X skill", "the skill X", "(X skill)") counts only when X is backticked or is a skill
  the kit builds (any mode chain or role); "the right skill", "the same skill" are prose.
- N-5 a child config schema may set top-level `type`/`additionalProperties` only to the parent's value; anything
  else is a resolve gap and a lint error naming the keyword.
All round-2 findings (N-1 to N-5) fixed.

## Decisions
- Classification order: other (tests/, HANDOFF.md, docs/proposals/, docs/research/, repo meta, the
  proposal) → core docs → core `owns:` (most specific glob wins, so bay/selector.py is briefing) →
  extension `at:` → unowned (fails unless listed). Core wins over a contract's `at:` (corpus-store,
  modes/briefing/, bay/adapters/ are core today).
- Extension `at:` is a list, so framework instances (framework/modes/, framework/connectors/,
  framework/envs/) are extensions of the same contracts. `framework/interfaces/` is kernel-owned (core
  interfaces); `interfaces/<name>.yaml` is the extension interface contract.
- Kernel also owns coordinator/, bay.sh, requirements.txt,
  framework/components.yaml.
- B-3: a feature path of an existing mode passes only if a `touches:` glob matches it AND the glob's
  literal prefix reaches `<mode>/features/` (so `modes/x/` covers mode-wide files but not features;
  `modes/x/features/*/` covers all features explicitly).
- Globs: `*`/`?` within a segment, `**` across, trailing `/` = folder and everything under it.
- `touches:` entries may carry `slice:` and `planned:`; both informational, every entry counts.
- Diff is of commits only (`git diff base...head`): commit before running the check.
- B-11 (`--docs`) scans the core docs at `--head` for discovered mode, connector, env and content-type
  names (word-bounded; `git.read` is not `git`), skipping ``` and ~~~ fenced blocks. Framework instances
  count (they are extensions), so words like improve, ledger, git, forge, cos hit.
- Contract `schema:`/`tests:` paths are named in the map but not checked for existence yet
  (content-type schema and tests/contracts/ arrive in later slices); lint checks only shape and `owns:`.

- (slice 2) Tests that imported `bay.adapters` now import `bay.adapter`; `COORDINATOR_CMDS` comes from
  `module("claude-code")`. Test bodies, including the guard/security tests, are unchanged.
- (slice 2) `model.PROTECTED` stays `("framework", "bay", "schemas")` (security tests pin it), so the adapter
  code at `adapters/` is no longer inside a protected kit dir when the project is the kit (like `connectors/`
  and `modes/` already). See Open problems.
- (slice 2) `bay auth` takes the connector name (`gmail-api`), not the source id; no alias for `gmail`.
- (slice 2) Touches added to 0006 for crossings the build needed: `bay/adapter.py`, `modes/*/README.md`,
  `modes/*/config.example.yaml`, `modes/mail-briefing/` and `modes/mail-briefing/features/*/playbook.md`.
  `tests/test_boundary.py` `SLICES_BUILT = 2`: entries of later slices must stay `planned`.
- (slice 2) Envs are single files (`envs/<name>.yaml`), not folders, so "per-env README" has no place; the
  offline switch in the generated example should be derived from envs' `substitutes:` (planned, item 5).

- (slice 2) The config example is keyed by installable mode: an abstract mode (briefing) has a README but no
  config.example.yaml; each child ships its own (feed-briefing does, though its schema is briefing's).
- (slice 2) agentbay.config.example.yaml is generated, so `bay boundary` classifies it as other (not kernel):
  adding a settings-taking extension regenerates it and must stay `touches: []` (DOD-4). Lint guarantees it
  holds no hand edits. Removed from kernel `owns:` in framework/components.yaml.
- (slice 2) README.md is required for user modes/connectors only; framework instances get one when touched
  (improve, claude-transcripts so far). Envs are files, so no README.
- (slice 2) Touches added: framework/envs/framework-dev.yaml, framework/modes/improve/,
  framework/connectors/claude-transcripts/, framework/modes/forge/templates/, bay/scaffold.py (now slice 2;
  its slice-3 planned entry merged into it). `planned` flipped off: bay/config.py,
  agentbay.config.example.yaml, README.md.

- (slice 2) B-4 checks tracked files only (an untracked scratch file is not the kit's). It reuses the boundary
  classification, so a file is "owned" exactly when `bay boundary` would classify it.
- (slice 2) Touches added: `framework/modes/*/README.md`, `framework/connectors/*/README.md`. Removed, as slice 2
  did not need them: bay/registry.py (the catalog already lists discovered extensions), `envs/*.yaml` (bindings
  name interfaces, not paths), framework/connectors/corpus-store/. `planned` off: docs/DESIGN.md,
  docs/INTERFACES.md, `modes/*/mode.yaml`.
- (slice 2) B-11 is word-bounded on dotted names, so `forge.extend`, `cos.run` in the docs do not hit; the docs
  still avoid instance endpoints where a contract sentence does the job.

- (slice 3) `reads:`/`produces:` cover item kinds only; framework modes and connectors read/produce no item
  kind and declare none. Presence is required only around items.source/v1.
- (slice 3) B-7 exemptions: README.md (documents the extension's own setup and may name what its env binds) and
  `tests/` inside an extension folder (fixtures pick concrete stand-ins, e.g. the fake connector). Core
  instances (under a core `owns:` path: briefing base mode, corpus-store) are not extensions and are not
  scanned. Framework instances may name each other (they ship and change together, only via forge.extend) but
  never a user extension. A mode may name every `extends:` ancestor, not only its direct parent.
- (slice 3) The kernel's selector matcher still accepts `label:`/`in:` spelling (tests use it); only the mode's
  own files moved to the neutral vocabulary.
- (slice 3) Claude Code skill names (folder under .claude/skills/ and SKILL.md `name:`) allow lowercase
  letters, digits and hyphens only (max 64); Claude Code adds `plugin:` itself for plugins. So B-8 must write
  `<mode>--<skill>` (same separator as role units `<role>--<mode>`), not `<mode>:<skill>`.

- (slice 3, B-8) Separator `--`, not `:` (see above). Note the open Agent Skills spec (agentskills.io) also
  forbids consecutive hyphens; Claude Code's own docs only state the character set and 64. Owner chose `--`.
- (slice 3, B-8) Role skills get the role's namespace (`researcher--research-brief`), not the mode's: written
  under the mode's they would clash with a same-named mode skill for the mode's other roles. A mode named like a
  role could still clash on a name; lint catches it ("also built from").
- (slice 3, B-8) mail-briefing skills: back to `corpus-sql`/`digest` rather than keep `mail-sql`/`mail-digest`
  (the task said `sql`/`digest`, but the pre-workaround names were `corpus-sql`/`digest`). Same churn either way
  (2 renames, 2 playbook words), but keeping the mail- names would leave mail-briefing's analyst with briefing's
  post-oriented `corpus-sql` and `digest` inherited next to its own; overriding is what B-8 is for.
- (slice 3, B-8) Abstract modes are not built, so their skills get no folder of their own; their playbooks are
  still lint-checked against their own chain.
- (slice 3, B-8) The proposal text (D.1, row B-8) still says `<mode>:<skill>`; left as approved, code follows
  the Decision above.

- (review 1) B-7 skips a manifest-referenced file that lies under a core `owns:` path (feed-briefing's config is
  briefing's schema); core is not scanned. Content types get no manifest check yet (manifest name not fixed).
- (review 1, F-14; narrowed in review 2, N-1/N-2) Bootstrap: origin/main has no framework/components.yaml (this
  PR introduces it). The boundary reads the map at the merge-base; only when the diff adds the map (status A) it
  uses the map at `--head`, gives no new-extension pass (every path outside other must be listed) and says so.
  Any other base without a map is an error. Once merged, every later change is judged by the merge-base map.
- (review 1, F-12) The adapter manifest schema lives in schemas/ like the other contracts' (components.yaml
  `adapter` now has `schema:`), rather than inline in bay/adapter.py.
- (review 2, N-5, replaces F-13's note) A child's `type`/`additionalProperties` must equal the parent's value.
- (review 1) Login secrets: the old "does not declare" check stays first (security test pins its message), then
  the SecretAccessor intersection applies.
- (7a) Chat approvals skip the "Type yes" prompt: the quoted message is the confirmation, and Claude Code's
  permission prompt for the command (never pre-approved) is the second check.
- (7a, corrected by de3d779; owner policy: a gate passes only by a recorded approval) The front-matter marker
  skips `propose` only. The `approve` gate is skipped only for a ledger approval by `bay approve` (terminal or
  chat) of this proposal path at the sha256 of its current content; any edit re-runs the gate. The latest
  decision on that exact content wins (a rejection after an approval re-runs it). The 74cdeb9 guard rule that
  denied writing `status: approved` is removed: the marker grants nothing, and no other reason to keep it was
  found (it never covered the main thread or Bash, which was the hole). The ledger is the trust root: subagents
  cannot write `.agentbay/` (guard, tested for `.agentbay/ledger/`); a main-thread Bash write to the ledger is the
  same trust as the main thread typing `bay approve --via chat` (Open problems). Gates take no `when:` at all.
  The hash is computed by the dispatcher from the project file, never taken from connector output.
- (7a) The approval lookup is a forge.scaffold/v1 endpoint (code step, dispatcherOnly interface, forge already
  needs it) plus a generic `when:` negation, rather than a forge-specific dispatcher rule.
- (7a) `names_config` denies even reads of agentbay.config.yaml by Bash (subagents can use Read); a glob counts
  only in the project root, so `ls framework/*.yaml` passes.
- (7a) local-authoring's `fs.write` still lists agentbay.config.yaml; the guard's NEVER_FILES wins for every
  subagent, so it is dead. Left as is (removing it is 7b/7c cleanup with the forge.create protocol).

## Next
- PR #10 ready to merge; then slice 4 (or 7b, if the owner keeps 7 ahead of 4-6).

### Plan: slice 7b, the new forge.extend (Part C), not built
1. Workflow (framework/modes/forge/mode.yaml `extend`):
   `proposal` (code, as 7a) → `propose` (builder; writes problem, change, `touches:`, `slices:`; skipped when
   approved) → `approve` (gate, `approves: $in.proposal`; skipped only for a recorded approval of the unchanged proposal) → `implement` (builder, `foreach: $steps.propose.slices`)
   → `check` (code) → `review` (reviewer, deep, high) → `release` (builder).
   - Slices come from the proposal: for an approved proposal, `forge.scaffold/v1.proposal` also returns its
     `slices:` front matter, so `foreach:` reads `$steps.proposal.slices` there; `propose`'s Result carries them
     otherwise (one `$a|$b` fallback).
2. Dispatcher `foreach:` (bay/dispatch.py, bay/model.py, schemas/mode.schema.json): a role step runs once per
   entry of a list from an earlier step; state keeps `{index, outputs[]}`; each run is a fresh plan (new
   taskId, no shared conversation) whose envelope names the slice and `HANDOFF.md`; the step completes when
   every entry has; `bay show` reports `slice i/n`; lint: the list ref names an earlier step.
3. `check` code step (new dispatcherOnly capability, e.g. forge.check/v1.run, bound in framework-dev's code
   env): runs, quiet, `bay boundary --base <merge-base> --proposal <p> --docs` (B-1, B-2, B-3, B-11),
   `bay lint` (B-4, B-6, B-7, B-8), `bay validate`, `tests/run.py -q`, build + clean in a scratch project.
   Output per check `{id, ok, summary}`; B-5, B-9, B-10, B-12 listed as `pending` (slices 5, 6; no compat
   detector yet) and never reported as pass. A failing check blocks review (`partial`).
4. DoD and rules (features/extend/playbook.md, rules.yaml): DOD-1..DOD-9 and R-1..R-5 exactly as Part C;
   remove the quality-word DoD and "compatibility impact" from the propose task; DOD-1/DOD-3 cite the
   `check` output.
5. Generated builder briefs: the implement plan's envelope is built from the playbook, the DoD, the
   proposal's slice section and `HANDOFF.md` (framework/roles/ or bay/playbook.py); a test renders one for a
   sample proposal (Part "Steps" acceptance: dry run of `bay call forge.extend` gives per-slice plans + brief).
6. `HANDOFF.md` protocol: implement checks the file exists after each slice (done, decisions, next, test status,
   open problems) and writes one ledger note per slice; the last slice removes it.
7. Touches: framework/modes/forge/mode.yaml, features/extend/, bay/dispatch.py, bay/model.py,
   schemas/mode.schema.json, framework/interfaces/ (check capability), framework/connectors/ (its connector),
   framework/envs/framework-dev.yaml, framework/roles/; flip their `planned`.

### Plan: slice 7c, not built
1. Shared forge protocol: the slice-and-handoff protocol and quiet checks move into
   framework/modes/forge/playbook.md; forge.create (and forge.connect once it exists) run the same `check`
   step after `fill`; create's DoD names the boundary checks.
2. improve `boundary-crossing` detector (bay/improve/, framework/modes/improve/features/audit/): runs B-1..B-3
   over git history (each merge commit against its first parent, with the proposal it names), reports a
   crossing no `touches:` covered; fixtures with a seeded crossing; never runs code from history.
3. Touches: bay/improve/, framework/modes/improve/features/audit/, framework/modes/forge/playbook.md,
   framework/modes/forge/features/create/.

## Test status
`python3 tests/run.py -q`: 416 passed, 0 failed on a clean detached checkout of de3d779 (~4 min; use a long
timeout). `bay lint` clean, `bay validate` ok. `bay boundary --base origin/main --proposal docs/proposals/0006-...md
--docs`: 103 changed paths, 0 failing, 0 B-11 hits.

## Open problems
- (7a) The chat path trusts the main thread to relay the owner's words (Part G threat note). A main-thread
  prompt injection could still type `bay approve --via chat`; Claude Code's prompt for the command is the only
  stop then. That is the documented trade-off, off by default.
- (7a) The main thread (not a subagent) can append to `.agentbay/ledger/events.jsonl` by Bash, so it could forge
  a `bay approve` event; that is no more than it can already do by running `bay approve --via chat`. Hashing or
  signing ledger events is out of scope (the ledger is append-only JSON).
- DESIGN.md is 1603 words (target ~1.5k); further trimming would cut contract text (safety, store invariants).
- The `boundary-crossing` improve detector (B-1..B-3 over history) is slice 7.
- B-8 skill-reference lint matches two prose phrasings only; a feature.yaml `skills:` list (slice 4) should
  replace the regex as the declared reference.
- Proposal 0006 D.1 / row B-8 say `<mode>:<skill>`; the owner may want the text amended to `<mode>--<skill>`.
