---
# Approval is recorded in the ledger by `bay approve`; this file grants nothing. Design only: nothing is changed before the gate. Scope: the owner said go ahead in chat on 2026-11-03 for items 1, 2, 3, 5 and 6 of the call; item 4 (writes scoped to approved touches) is out and will be its own proposal. Every line cited was read on main at 3.0.2.
id: "0020"
status: draft
touches:
  - { path: components/tools/envs/workspace.yaml, reason: "items 1 and 2: workspace.read/v1 gains the two check commands (builders and reviewers both get them); workspace.write/v1 gains git commit, git mv, git rm" }
  - { path: components/forge/envs/local-authoring.yaml, reason: "item 1: the same bindings; the comment 'no test runner' (line 18) is replaced by the reason it now has one" }
  - { path: bay/model.py, reason: "item 2: READ_ONLY_CLIS (line 61) lists `./bay.sh check` and `python3 tests/run.py`, so a read-only role keeps them (no new line)" }
  - { path: bay/cli.py, reason: "item 3: note dispatch refuses on a silent guard unless --unguarded; the reason goes into the ledger event; status lists unguarded dispatches; the status heartbeat test becomes a helper both use" }
  - { path: bay/dispatch.py, reason: "item 5: the review brief's verdictSchema is the schema itself, not its name (line 706; no new line)" }
  - { path: bay/scaffold.py, reason: "item 6: kind mode writes no features/run files and no types; _insert_under can fill an empty `features: {}`" }
  - { path: bay/templates/mode/mode.yaml, reason: "item 6: `features: {}`, no run feature" }
  - { path: bay/templates/mode/README.md, reason: "item 6: no `run` row in the feature table" }
  - { path: bay/templates/mode/RunReq.schema.json, reason: "item 6: removed (git rm); nothing uses it" }
  - { path: bay/templates/mode/RunOut.schema.json, reason: "item 6: removed (git rm); nothing uses it" }
  - { path: schemas/mode.schema.json, reason: "item 6: `features` loses `minProperties: 1` (line 59); a widening, apiVersion stays v4" }
  - { path: schemas/data/review.verdict.v1.schema.json, reason: "item 5: the id pattern accepts C-n (line 25); a widening, review.verdict stays v1" }
  - { path: adapters/claude-code/claude_code.py, reason: "item 3: the control-plane list in the generated COORDINATOR.md names --unguarded (line 552; no new line)" }
  - { path: components/cos/playbook.md, reason: "item 3: the dispatch step says what to do when the guard check refuses" }
  - { path: tests/test_guard_matrix.py, reason: "items 1 and 2: named deltas for the clis of three units and ten decision rows; the golden files are not edited" }
  - { path: tests/test_cli_commands.py, reason: "item 3: test_note_task_mints_an_id_and_dispatch_and_review_take_the_task_first is extended; the BYPASSES loop (line 90) passes --unguarded" }
  - { path: tests/test_ledger.py, reason: "item 3: the dispatch call at line 186 passes --unguarded; the status guard-line test (line 284) also checks the unguarded listing" }
  - { path: tests/test_dispatch.py, reason: "item 5: the verdict test at line 105 also accepts a C-n id and checks the brief's schema" }
  - { path: components/forge/tests/test_forge.py, reason: "item 6: test_bay_new_mode_is_lint_clean_and_resolves expects an empty mode that takes a feature (line 19)" }
  - { path: docs/DESIGN.md, reason: "DOD-13: line 85 (read-only CLIs), line 108-109 (the hooks sentence); paid for in the same file" }
  - { path: docs/INTERFACES.md, reason: "DOD-13: line 102 (the brief carries the schema, C-n ids), line 128 (read-only CLIs), line 222 (--unguarded); paid for in the same file" }
  - { path: README.md, reason: "DOD-13: the `bay new mode` row (line 125) says the mode starts with no feature" }
  - { path: framework/limits.yaml, reason: "release step: bay_lines is written down to the real count" }
  - { path: bay/__init__.py, reason: "release step: version 3.1.0" }
  - { path: CHANGELOG.md, reason: "release step: entry, with an Upgrading note for the dispatch check" }
exceptions:
  - { measure: bay_lines, to: 9701, reason: "9688 is the ceiling and the exact count today (python lines of bay/*.py). Estimate +8: cli.py +11 (guard helper 4 lines plus 2 blank, status uses it -1, the refusal +2, the reason in the event +1, the status listing +3), scaffold.py -3 (two type writes and three run-feature lines go, _insert_under +2), model.py, dispatch.py 0. Item 6 pays 5 of the 11 and the status condition 1; nothing else in bay/ can be named to pay for the rest. 9701 is the estimate plus a margin of 5; if it must shrink, the status listing (+3) goes first and the reason stays in the ledger. The release lowers the ceiling to the real count." }
---

# 0020: Agents can check their own work

## Summary

Building the to-do mode showed five gaps where an agent is made to do a job without the means to check it, or where the framework cannot tell that its own safeguard is off. This proposal closes them, and nothing else. (1) The two builders that cannot run tests or commit now can, with no push, no network and no shell `rm`. (2) Reviewers can re-run the evidence they judge, still without write tools. (3) `bay note dispatch` refuses to start a role when no guard hook has run lately, unless the coordinator says why with `--unguarded "<reason>"`; the reason is recorded and `bay status` shows it. (5) A verdict may use `C-n` ids and the review brief carries the verdict schema, so a reviewer stops inventing top-level keys. (6) `bay new mode` and `forge.create` for a mode no longer scaffold a sample feature and types that every author deletes. The release is 3.1.0, because the dispatch check changes default behaviour. The proposal touches 25 files, has an exception and touches sensitive paths (`bay/cli.py`, `bay/dispatch.py`, `schemas/`), so forge.extend's plan step runs.

## Item 1: builders can run checks

**Today.** The delivery builder runs in env `workspace` with `clis: [git status, git diff, git log, git add, git worktree]` (`components/tools/envs/workspace.yaml:11`). The forge `local-authoring` builder has only `./bay.sh check` (`components/forge/envs/local-authoring.yaml:19`), and a comment says why: "an agent that can write code and run it escapes any hook" (line 18). Neither can run `python3 tests/run.py`, `git commit`, `git mv` or `git rm`, although the builder role tells it to run the tests and the full suite before the commit (`framework/roles/builder.yaml`). The generated `.claude/agents/builder--delivery.md:36` and `builder--forge--local-authoring.md:36` list exactly these commands under "Allowed Bash". `framework-dev` already has all five (`components/forge/envs/framework-dev.yaml:15`).

**Change.** Both envs bind `./bay.sh check` and `python3 tests/run.py` under `workspace.read/v1` (item 2 needs them there) and `git commit`, `git mv`, `git rm` under `workspace.write/v1`. There is no `git push`, no `rm`, no network. The role rule "never commit or push unless the task says so" stays; it is a prompt rule, and every command stays under Claude Code's per-prefix prompt (the guard answers `pass`, never `allow`). The generated agent files change on `./bay.sh build` and are not tracked.

**Test that fails on main.** `test_guard_decision_matrix` (`tests/test_guard_matrix.py:350`): the clis of `builder--delivery` and `builder--forge--local-authoring` and the decisions for `python3 tests/run.py -q`, `python3 tests/run.py tests/test_improve.py`, `git commit -m ...` (and `./bay.sh check` for delivery) are named deltas, deny to pass. On main the asserted deltas are absent and the test fails.

## Item 2: reviewers can re-run evidence

**Today.** The forge, delivery and improve reviewers all work in env `workspace` (`components/forge/mode.yaml:46`, `components/delivery/mode.yaml:30`, `components/improve/mode.yaml:93`). A role without `access: write` keeps only the CLIs in `READ_ONLY_CLIS` (`bay/model.py:61`, applied at `:853-857`), and `lint_env_bindings` rejects any other CLI under a capability without the write effect (`bay/lint.py:185-199`). So a reviewer's Bash is `git status`, `git diff`, `git log`, `git show` (`.claude/agents/reviewer--forge.md:46`) and it cannot repeat the check a builder quotes as evidence.

**Change.** `READ_ONLY_CLIS` gains `./bay.sh check` and `python3 tests/run.py`, and `workspace.yaml` binds them under `workspace.read/v1`. Reviewers still get no Edit, Write or other file-writing tool and no `git commit`. One consequence to state: `improve`'s reviewer shares the env, so it gets the same two commands. Splitting a reviewer env would add a file and a binding for no gain; see decision 3.

**Test that fails on main.** The same matrix test: `reviewer--forge` gains the two clis and three rows go deny to pass. Independently, `bay check` itself fails on main with the new env, because lint rejects the two CLIs under `workspace.read/v1`.

## Item 3: a dispatch checks that the guard is on

**Today.** Every hook call touches `.agentbay/ledger/guard.seen` before it decides anything (`bay/guard.py:578-580`). `bay status` prints "no tool call was checked in the last 2 minutes ... its hooks are not loaded" when the file is missing or older than 120 seconds (`bay/cli.py:572-574`). `bay note dispatch` records a dispatch and checks nothing (`bay/cli.py:498-509`). So a coordinator in a session whose hooks are off dispatches builders that run with no guard at all, and nothing is recorded. Note that the `note dispatch` Bash call itself fires the hook first, so in a session with hooks the file is always fresh at this point: the check cannot refuse by mistake there.

**Change.** One helper, `_guard_silent(project)`, holds the test now written inline in `cmd_status`, and both use it. `_note_dispatch` calls it and stops with an error that names the fix (start Claude Code inside the project, or pass `--unguarded "<reason>"`). With the flag the dispatch is recorded with `data.unguarded = <reason>`. `bay status` lists the unguarded dispatches (task id and reason) under its guard line. `--unguarded` is accepted only with `note dispatch`, like the other dispatch flags. The cos playbook and the generated control-plane list tell the coordinator to use it only when the user knows hooks cannot load, and to say so.

**Test that fails on main.** `test_note_task_mints_an_id_and_dispatch_and_review_take_the_task_first` (`tests/test_cli_commands.py:52`) is extended: with no heartbeat the dispatch exits non-zero and writes no event; with `--unguarded "x"` it succeeds and the event carries `x`; after one hook call it succeeds without the flag. The status test (`tests/test_ledger.py:284`) also expects the unguarded task id in the output. On main the first call exits 0.

## Item 5: verdicts accept C-n ids; the brief carries the schema

**Today.** The verdict item id must match `^(DOD|R)-[0-9]+$` (`schemas/data/review.verdict.v1.schema.json:25`), but forge's reviewers also judge the conformance rules `C-1` and onward (`framework/rules/conformance.yaml:12`, `rulesets: [conformance]` in `components/forge/mode.yaml:17,29`), and the brief tells them to cite those ids. The top level is `additionalProperties: false`, so a verdict with an extra key is refused, yet the brief gives only the schema's name: `"verdictSchema": VERDICT` (`bay/dispatch.py:706`, `VERDICT` is the string at `:31`).

**Change.** The pattern becomes `^(DOD|R|C)-[0-9]+$`. The brief's `verdictSchema` becomes `model.data_schema(VERDICT)`, the schema document, whose `title` is still `review.verdict/v1`. Nothing else in `_accept_review` changes: the ids that must be present are still the DoD and reviewer rules (`bay/dispatch.py:622`); a `C-n` item is accepted extra.

**Test that fails on main.** The verdict test at `tests/test_dispatch.py:105` is extended: a verdict item `C-3` is accepted (on main: "does not match review.verdict/v1"), and the review plan's `verdictSchema` is an object with `additionalProperties: false` (on main: a string).

## Item 6: a new mode starts with no sample feature

**Today.** `scaffold.create(kind="mode")` writes `features/run/playbook.md` and `rules.yaml` and the types `RunReq` and `RunOut` (`bay/scaffold.py:84-88`), and the template declares the `run` feature (`bay/templates/mode/mode.yaml:9-19`) and a `run` row in the README. Every author, and forge.create's builder, deletes or renames them. The mode schema requires at least one feature (`schemas/mode.schema.json:59`), which is why the template cannot simply omit it.

**Change.** The mode template says `features: {}`; the two files, the two types and the README row are gone (the two `.schema.json` templates are removed). `_insert_under` (`bay/scaffold.py:177`) treats `  features: {}` as the header and rewrites it before inserting, so `bay new feature` works on a fresh mode. The schema drops `minProperties: 1` from `features`. The `todo` list of the scaffold says to add a feature with `bay new feature <name> --mode <mode>`. forge.create's playbook already tells the builder to fill "features with in/out/effects", so it needs no edit. Not verified here (the builder role cannot run a scratch copy): that a mode with no feature resolves and lints clean everywhere else. The plan step must show it on a scratch copy; if something refuses an empty mode, the fix goes in that place and is added to `touches:`.

**Test that fails on main.** `test_bay_new_mode_is_lint_clean_and_resolves` (`components/forge/tests/test_forge.py:19`) is rewritten: no `features/run`, no `types/RunReq...`, `features == {}`, lint clean, resolves, then `scaffold.create(kind="feature")` adds one and it resolves. On main `features/run/playbook.md` exists.

## Guard-matrix goldens

`tests/golden/guard-matrix.json` and `guard-matrix-project.json` are not edited. `tests/test_guard_matrix.py` gets named deltas in the style of `undo_move` and `EXPECTED_DELTAS`, each asserted present first: (a) the clis of `builder--delivery`, `builder--forge--local-authoring` and `reviewer--forge` (policy and every "may only run" reason that quotes them); (b) ten rows, deny to pass: `./bay.sh check`, `git commit -m ...`, `python3 tests/run.py -q` and `... tests/test_improve.py` for delivery; the last three for local-authoring; `./bay.sh check` and the two `tests/run.py` rows for the reviewer. The expected list is measured by the plan step; the test fails if a row outside it moves.

## Cost against the ceilings

- **`bay_lines` (9688, count 9688): over, so the exception above.** The count is exact (python lines of `bay/*.py`); the change is an estimate of +8 until the code is written. Payers named: item 6's removals in `scaffold.py` and the inline test in `cmd_status`. The rest has no payer in `bay/`.
- **`kit_python_lines` (5165):** no change; the `claude_code.py` edit rewords a line.
- **`tests` (462):** does not grow. No test is added; five existing tests are extended and two calls in others get the flag.
- **`cli_commands` (16), `schemas` (16), `framework_folders` (2), `top_level_folders` (7):** unchanged. `--unguarded` is an argument, not a command; no schema file is added.
- **Docs.** By `wc -w`, DESIGN is 2997 and INTERFACES 2983 words. The edits add about 24 words to each. DESIGN has 3 free and INTERFACES 17, so the build removes at least 21 and 7 words in the same files; the plan step names them.

## Compatibility and safety impact

- **Contracts.** `review.verdict/v1` and `mode.schema.json` only accept more, so no apiVersion bump (DOD-11). The brief's `verdictSchema` changes from a name to the document that carries it; nothing reads the old value (no code or test does). The default behaviour of `bay note dispatch` changes (it can now refuse), hence 3.1.0.
- **Item 1 and 2 weaken the file scope, and this should be read plainly.** The guard confines the file tools to an env's write paths; it does not confine what a command does. A builder that may run `python3 tests/run.py` can write a test file under `components/` and run it, and that code can write anywhere, so `local-authoring` "writes components/ only" is no longer a hard limit for a determined or mistaken agent. The same holds for the delivery builder. `git mv` and `git rm` are worse in a simple way: the guard checks their arguments only for `.agentbay/` and `.claude/` (`bay/guard.py:496-517`, `:458-465`), not against the env's write paths, so `git rm bay/guard.py` or `git mv a.py bay/b.py` is allowed. A reviewer who re-runs tests also runs the code under review, and `./bay.sh check --limits --write` rewrites `framework/limits.yaml`. What still holds: every command stays under Claude Code's per-prefix prompt; `bay check --base` finds a change to a protected path and a raised ceiling, whatever tool made it; the whole-diff review and git history remain. See decision 2.
- **Item 3.** No secret is read or shown; the reason is scrubbed like every ledger value. In a session where hooks cannot load (a cloud session), `guard.seen` never appears, so every dispatch needs `--unguarded "<reason>"`. The flag does not turn the guard on: those sessions have no Bash allow-list, no write-path check and no denial record, and the subagents run on the prompt rules alone. The change makes that visible (once per dispatch, in the ledger and in `bay status`) and costs a prompt, since `note dispatch` already asks the user each time. The reason is typed by the coordinator and is not verified.
- **Item 6.** A mode with no feature has no callable endpoint until one is added; `bay check` is the judge, and the scaffold prints the next step.
- **Extensibility (DOD-4).** A new source is still one connector and one env binding line.
- **After the upgrade** run `./bay.sh build` so the generated agent files list the new commands.

## Owner decisions

1. **Cloud sessions and the guard check.** The call asks for refuse unless `--unguarded`. In a cloud session that is a flag and a reason on every dispatch; the alternative is a warning only. Recommended: refuse, as the owner chose, because a warning is what the status line already is.
2. **Paths of `git mv` and `git rm`, and the test runner.** Item 1 as approved lets a builder move or delete files outside its write paths through git. Recommended: also make the guard check the path arguments of `git mv` and `git rm` against the env's write paths, as it already does for `git worktree add` (about +6 lines in `bay/guard.py`, a sensitive path). That is a change of scope, so I did not include it: if you want it, the proposal is amended (R-12), the exception rises by that count, and it returns to the gate. The test runner's reach cannot be closed by the guard; accept it, as the `framework-dev` builder already does.
3. **`improve`'s reviewer also gets the two check commands**, because it shares env `workspace`. Recommended: accept. The alternative is a second reviewer env, one more file and binding.
4. **`git add` for `local-authoring`.** Item 1 lists `git commit` but its builder has no `git add`, so a commit stages nothing new. Recommended: add `git add` to its list (one word, same file). Not done unless you say so.
5. **Release number.** 3.1.0, because the guard check changes default behaviour. 3.0.3 would understate it.

## Release 3.1.0

`bay/__init__.py` to 3.1.0; a CHANGELOG entry with an Upgrading note (run `./bay.sh build`; in a session without hooks pass `--unguarded "<reason>"` to `bay note dispatch`); `./bay.sh check --limits --write` lowers `bay_lines` to the real count. The release step prints the tag, push and `gh release create` commands for the owner.
