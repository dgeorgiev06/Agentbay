---
# Approval is recorded in the ledger by `bay approve`; this file grants nothing. Design only: nothing is changed before the gate. Scope: the owner said go ahead in chat on 2026-11-03 for items 1, 2, 3 and 5 of the call (item 6, the scaffold change, was dropped by the owner on 2026-11-03; item 4, writes scoped to approved touches, is out and will be its own proposal), and on 2026-11-03 added item 7, the git path check. Every line cited was read on main at 3.0.2.
id: "0020"
status: draft
touches:
  - { path: components/tools/envs/workspace.yaml, reason: "items 1 and 2: workspace.read/v1 gains the two check commands (builders and reviewers both get them); workspace.write/v1 gains git commit, git mv, git rm" }
  - { path: components/forge/envs/local-authoring.yaml, reason: "item 1: the same bindings plus git add; the comment 'no test runner' (line 18) is replaced by the reason it now has one" }
  - { path: bay/model.py, reason: "item 2: READ_ONLY_CLIS (line 61) lists `./bay.sh check` and `python3 tests/run.py`, so a read-only role keeps them (no new line)" }
  - { path: bay/cli.py, reason: "item 3: note dispatch refuses on a silent guard unless --unguarded; the reason goes into the ledger event; status lists unguarded dispatches; the status heartbeat test becomes a helper both use" }
  - { path: bay/dispatch.py, reason: "item 5: the review brief's verdictSchema is the schema itself, not its name (line 706; no new line)" }
  - { path: bay/guard.py, reason: "item 7: git mv and git rm arguments are checked against never-write files and the role's fs.write paths" }
  - { path: schemas/data/review.verdict.v1.schema.json, reason: "item 5: the id pattern accepts C-n (line 25); a widening, review.verdict stays v1" }
  - { path: adapters/claude-code/claude_code.py, reason: "item 3: the control-plane list in the generated COORDINATOR.md names --unguarded (line 552; no new line)" }
  - { path: components/cos/playbook.md, reason: "item 3: the dispatch step says what to do when the guard check refuses" }
  - { path: tests/test_guard_matrix.py, reason: "items 1 and 2: named deltas for the clis of three units and ten decision rows; the golden files are not edited" }
  - { path: tests/test_roles.py, reason: "items 1 and 2: the lint message at line 224 names the new clis (from the plan step)" }
  - { path: README.md, reason: "item 3: the control-plane list names note dispatch --unguarded (DOD-13; from the plan step)" }
  - { path: tests/test_boundaries.py, reason: "item 7: test_n3_worktree_add_paths_and_no_writes_without_write_tools (line 523) also asserts git mv and git rm refusals and passes" }
  - { path: tests/test_cli_commands.py, reason: "item 3: test_note_task_mints_an_id_and_dispatch_and_review_take_the_task_first is extended; the BYPASSES loop (line 90) passes --unguarded" }
  - { path: tests/test_ledger.py, reason: "item 3: the dispatch call at line 186 passes --unguarded; the status guard-line test (line 284) also checks the unguarded listing" }
  - { path: tests/test_dispatch.py, reason: "item 5: the verdict test at line 105 also accepts a C-n id and checks the brief's schema" }
  - { path: docs/DESIGN.md, reason: "DOD-13: line 85 (read-only CLIs), lines 108-109 (the hooks sentence), the guard bullet at line 141 (git mv and rm paths); paid for in the same file" }
  - { path: docs/INTERFACES.md, reason: "DOD-13: line 102 (the brief carries the schema, C-n ids), line 128 (read-only CLIs), line 222 (--unguarded); paid for in the same file" }
  - { path: framework/limits.yaml, reason: "release step: bay_lines is written down to the real count; review round 2: the new measure long_lines" }
  - { path: bay/limits.py, reason: "review round 2: count long_lines (lines over 120 characters in the code the kernel measures count)" }
  - { path: bay/__init__.py, reason: "release step: version 3.1.0" }
  - { path: CHANGELOG.md, reason: "release step: entry, with an Upgrading note for the dispatch check" }
exceptions:
  - { measure: bay_lines, to: 9760, reason: "Raised to 9760 in review round 3 (owner decision, chat 2026-11-04: the measured count of the readable rewrite; no packed lines). Earlier: 9750, by review round 3 (every line 0020 adds is readable, at most 120 characters). Earlier: 9730, by review round 2 (owner decision: readable code, no packed lines; the long_lines measure is added). Earlier: 9715. Raised from 9709 by the plan step, which measured 9710 against the real code (a status-listing helper the deadcode complexity check forces, and the item 7 edges: folders holding protected paths, pathspec magic, globs, words after --); payers: _worktree_add reuses the new check (-3), the inline heartbeat test in cmd_status (-2). The first estimate follows. 9688 is the ceiling and the exact count today (python lines of bay/*.py). Estimate +16: cli.py +11 (guard helper 4 lines plus 2 blank, status uses it -1, the refusal +2, the reason in the event +1, the status listing +3), guard.py +5 (the mv/rm branch of _git_command: the if, the loop over non-flag arguments, the denial test, the return), model.py and dispatch.py 0. The only payer that can be named in bay/ is the inline heartbeat test in cmd_status (-1, already counted); the rest is not paid for. 9709 is the estimate plus a margin of 5. If it must shrink, the status listing (+3) goes first and the reason stays in the ledger. The release lowers the ceiling to the real count." }
---

# 0020: Agents can check their own work

## Summary

Building the to-do mode showed gaps where an agent is made to do a job without the means to check it, or where the framework cannot tell that its own safeguard is off. This proposal closes them, and nothing else. (1) The two builders that cannot run tests or commit now can, with no push, no network and no shell `rm`. (2) Reviewers can re-run the evidence they judge, still without write tools. (3) `bay note dispatch` refuses to start a role when no guard hook has run lately, unless the coordinator says why with `--unguarded "<reason>"`; the reason is recorded and `bay status` shows it. (5) A verdict may use `C-n` ids and the review brief carries the verdict schema, so a reviewer stops inventing top-level keys. (7) The guard checks the path arguments of `git mv` and `git rm` against the role's write paths, which closes the gap that item 1 would otherwise open. The release is 3.1.0, because the dispatch check changes default behaviour. The proposal touches 19 files, has an exception and touches sensitive paths (`bay/cli.py`, `bay/dispatch.py`, `bay/guard.py`, `schemas/`), so forge.extend's plan step runs.

## Item 1: builders can run checks

**Today.** The delivery builder runs in env `workspace` with `clis: [git status, git diff, git log, git add, git worktree]` (`components/tools/envs/workspace.yaml:11`). The forge `local-authoring` builder has only `./bay.sh check` (`components/forge/envs/local-authoring.yaml:19`), and a comment says why: "an agent that can write code and run it escapes any hook" (line 18). Neither can run `python3 tests/run.py`, `git commit`, `git mv` or `git rm`, although the builder role tells it to run the tests and the full suite before the commit (`framework/roles/builder.yaml`). `local-authoring` also has no `git add`, so a commit could stage nothing the builder wrote. The generated `.claude/agents/builder--delivery.md:36` and `builder--forge--local-authoring.md:36` list exactly these commands under "Allowed Bash". `framework-dev` already has all of them (`components/forge/envs/framework-dev.yaml:15`).

**Change.** Both envs bind `./bay.sh check` and `python3 tests/run.py` under `workspace.read/v1` (item 2 needs them there) and `git commit`, `git mv`, `git rm` under `workspace.write/v1`; `local-authoring` also gets `git add` there (decision 3). There is no `git push`, no `rm`, no network. The role rule "never commit or push unless the task says so" stays; it is a prompt rule, and every command stays under Claude Code's per-prefix prompt (the guard answers `pass`, never `allow`). The generated agent files change on `./bay.sh build` and are not tracked.

**Test that fails on main.** `test_guard_decision_matrix` (`tests/test_guard_matrix.py:350`): the clis of `builder--delivery` and `builder--forge--local-authoring` and the decisions for `python3 tests/run.py -q`, `python3 tests/run.py tests/test_improve.py`, `git commit -m ...` (and `./bay.sh check` for delivery) are named deltas, deny to pass. On main the asserted deltas are absent and the test fails.

## Item 2: reviewers can re-run evidence

**Today.** The forge, delivery and improve reviewers all work in env `workspace` (`components/forge/mode.yaml:46`, `components/delivery/mode.yaml:30`, `components/improve/mode.yaml:93`). A role without `access: write` keeps only the CLIs in `READ_ONLY_CLIS` (`bay/model.py:61`, applied at `:853-857`), and `lint_env_bindings` rejects any other CLI under a capability without the write effect (`bay/lint.py:185-199`). So a reviewer's Bash is `git status`, `git diff`, `git log`, `git show` (`.claude/agents/reviewer--forge.md:46`) and it cannot repeat the check a builder quotes as evidence.

**Change.** `READ_ONLY_CLIS` gains `./bay.sh check` and `python3 tests/run.py`, and `workspace.yaml` binds them under `workspace.read/v1`. Reviewers still get no Edit, Write or other file-writing tool and no `git commit`, `git mv` or `git rm`. One consequence to state: `improve`'s reviewer shares the env, so it gets the same two commands. Splitting a reviewer env would add a file and a binding for no gain.

**Test that fails on main.** The same matrix test: `reviewer--forge` gains the two clis and three rows go deny to pass. Independently, `bay check` itself fails on main with the new env, because lint rejects the two CLIs under `workspace.read/v1`.

## Item 3: a dispatch checks that the guard is on

**Today.** Every hook call touches `.agentbay/ledger/guard.seen` before it decides anything (`bay/guard.py:578-580`). `bay status` prints "no tool call was checked in the last 2 minutes ... its hooks are not loaded" when the file is missing or older than 120 seconds (`bay/cli.py:572-574`). `bay note dispatch` records a dispatch and checks nothing (`bay/cli.py:498-509`). So a coordinator in a session whose hooks are off dispatches builders that run with no guard at all, and nothing is recorded. Note that the `note dispatch` Bash call itself fires the hook first, but the hook touches it before Claude Code's permission prompt, so a slow answer could make it look stale; the dispatch check therefore allows 900 seconds (the status line keeps 120).

**Change.** One helper, `_guard_silent(project)`, holds the test now written inline in `cmd_status`, and both use it. `_note_dispatch` calls it and stops with an error that names the fix (start Claude Code inside the project, or pass `--unguarded "<reason>"`). With the flag the dispatch is recorded with `data.unguarded = <reason>`. `bay status` lists the unguarded dispatches (task id and reason) under its guard line. `--unguarded` is accepted only with `note dispatch`, like the other dispatch flags. The cos playbook and the generated control-plane list tell the coordinator to use it only when the user knows hooks cannot load, and to say so.

**Test that fails on main.** `test_note_task_mints_an_id_and_dispatch_and_review_take_the_task_first` (`tests/test_cli_commands.py:52`) is extended: with no heartbeat the dispatch exits non-zero and writes no event; with `--unguarded "x"` it succeeds and the event carries `x`; after one hook call it succeeds without the flag. The status test (`tests/test_ledger.py:284`) also expects the unguarded task id in the output. On main the first call exits 0.

## Item 5: verdicts accept C-n ids; the brief carries the schema

**Today.** The verdict item id must match `^(DOD|R)-[0-9]+$` (`schemas/data/review.verdict.v1.schema.json:25`), but forge's reviewers also judge the conformance rules `C-1` and onward (`framework/rules/conformance.yaml:12`, `rulesets: [conformance]` in `components/forge/mode.yaml:17,29`), and the brief tells them to cite those ids. The top level is `additionalProperties: false`, so a verdict with an extra key is refused, yet the brief gives only the schema's name: `"verdictSchema": VERDICT` (`bay/dispatch.py:706`, `VERDICT` is the string at `:31`).

**Change.** The pattern becomes `^(DOD|R|C)-[0-9]+$`. The brief's `verdictSchema` becomes `model.data_schema(VERDICT)`, the schema document, whose `title` is still `review.verdict/v1`. Nothing else in `_accept_review` changes: the ids that must be present are still the DoD and reviewer rules (`bay/dispatch.py:622`); a `C-n` item is accepted extra.

**Test that fails on main.** The verdict test at `tests/test_dispatch.py:105` is extended: a verdict item `C-3` is accepted (on main: "does not match review.verdict/v1"), and the review plan's `verdictSchema` is an object with `additionalProperties: false` (on main: a string).

## Item 7: git mv and git rm respect the write paths

**Today.** For a command under an approved CLI prefix the guard checks the arguments only for `.agentbay/`, `.claude/` and the kit CLI (`_words`, `bay/guard.py:496-517`); for git it adds a ban on file-writing flags and a path check for `git worktree add` only (`_git_command`, `:458-465`, `_worktree_add`, `:519-534`). Once item 1 lets the `local-authoring` and delivery builders run `git mv` and `git rm`, `git rm bay/guard.py` or `git mv a.py bay/b.py` would pass the guard although the env does not write `bay/`. `framework-dev` writes `bay/` anyway, so nothing changes for it.

**Change.** In `_git_command`, for `git mv` and `git rm`, every argument that is not a flag is checked with `never_write` and `_write_denied`, the two checks `_worktree_add` already uses (`:530`), against the role's `fs.write` paths and the protected folders. The first refused path denies the command, with the reason `agentbay: git mv <path>: <why>`. `git add`, `git commit` and the read-only git commands are unchanged: they write no working-tree file. Roles with no write path (reviewers) never get `git mv` or `git rm`.

**Test that fails on main.** `test_n3_worktree_add_paths_and_no_writes_without_write_tools` (`tests/test_boundaries.py:523`) is extended, with no new test function: for a unit with `git mv` and `git rm` appended to its clis, as the test does for `git worktree`, `git rm bay/guard.py`, `git mv a.py bay/b.py` and `git rm .agentbay/x` are denied for a role that does not write `bay/`, and `git rm tests/x.py` and `git mv docs/a.md docs/b.md` pass for `builder--forge--framework-dev`. On main the first three pass.

## Guard-matrix goldens

`tests/golden/guard-matrix.json` and `guard-matrix-project.json` are not edited. `tests/test_guard_matrix.py` gets named deltas in the style of `undo_move` and `EXPECTED_DELTAS`, each asserted present first: (a) the clis of `builder--delivery`, `builder--forge--local-authoring` and `reviewer--forge` (policy and every "may only run" reason that quotes them); (b) ten rows, deny to pass: `./bay.sh check`, `git commit -m ...`, `python3 tests/run.py -q` and `... tests/test_improve.py` for delivery; the last three for local-authoring; `./bay.sh check` and the two `tests/run.py` rows for the reviewer. The expected list is measured by the plan step; the test fails if a row outside it moves. Item 7 adds no matrix row: the matrix has no `git mv` or `git rm` command, and its decisions do not move.

## Cost against the ceilings

- **`bay_lines` (9688, count 9688): over, so the exception above.** The count is exact (python lines of `bay/*.py`); the change is an estimate of +16 until the code is written (`cli.py` +11, `guard.py` +5). Payer named: the inline test in `cmd_status` (-1). The rest has no payer in `bay/`.
- **`kit_python_lines` (5165):** no change; the `claude_code.py` edit rewords a line.
- **`tests` (462):** does not grow. No test is added; five existing tests are extended (the matrix, the dispatch note, the status guard line, the verdict test, the worktree guard test) and two calls in others get the flag.
- **`cli_commands` (16), `schemas` (16), `framework_folders` (2), `top_level_folders` (7):** unchanged. `--unguarded` is an argument, not a command; no schema file is added.
- **Docs.** By `wc -w`, DESIGN is 2997 and INTERFACES 2983 words. The edits add about 30 words to DESIGN and 24 to INTERFACES. DESIGN has 3 free and INTERFACES 17, so the build removes at least 27 and 7 words in the same files; the plan step names them.

## Compatibility and safety impact

- **Contracts.** `review.verdict/v1` only accepts more, so no apiVersion bump (DOD-11). The brief's `verdictSchema` changes from a name to the document that carries it; nothing reads the old value (no code or test does). The default behaviour of `bay note dispatch` changes (it can now refuse), hence 3.1.0.
- **Stated risk: the test runner.** The guard confines the file tools to an env's write paths; it does not confine what a command does. A builder that may run `python3 tests/run.py` can write a test file under `components/` and run it, and that code can write anywhere, so `local-authoring` "writes components/ only" is no longer a hard limit for a determined or mistaken agent. The same holds for the delivery builder. A reviewer who re-runs tests also runs the code under review, and `./bay.sh check --limits --write` rewrites `framework/limits.yaml`. The guard cannot close this. What still holds: every command stays under Claude Code's per-prefix prompt; `bay check --base` finds a change to a protected path and a raised ceiling, whatever tool made it; the whole-diff review and git history remain. The `framework-dev` builder already works this way.
- **Item 7 closes the git half.** After it, `git mv` and `git rm` cannot reach a path the file tools could not. It checks the arguments the guard can see: a path produced by a shell expansion is already refused by the existing command parser, and a glob is not expanded by the check.
- **Stated risk: cloud sessions (item 3).** No secret is read or shown; the reason is scrubbed like every ledger value. In a session where hooks cannot load (a cloud session), `guard.seen` never appears, so every dispatch needs `--unguarded "<reason>"`. The flag does not turn the guard on: those sessions have no Bash allow-list, no write-path check and no denial record, and the subagents run on the prompt rules alone. The change makes that visible (once per dispatch, in the ledger and in `bay status`) and costs a prompt, since `note dispatch` already asks the user each time. The reason is typed by the coordinator and is not verified.
- **Extensibility (DOD-4).** A new source is still one connector and one env binding line.
- **After the upgrade** run `./bay.sh build` so the generated agent files list the new commands.

## Owner decisions

Taken by the owner in chat on 2026-11-03:

1. **Cloud sessions and the guard check.** Refuse unless `--unguarded "<reason>"`, as the call asked; a warning only was the alternative. The cloud-session risk above stands as stated.
2. **Close the git gap in this proposal.** `git mv` and `git rm` arguments are checked against the env's write paths (item 7). This widens the scope of the call by one item, with its `bay/guard.py` lines counted in the exception.
3. **`git add` for `local-authoring`**, alongside `git commit`, so a commit can stage what the builder wrote (item 1).
4. **Item 6 is dropped.** `bay new mode` and `forge.create` for a mode keep their sample feature and types. Nothing about the scaffold, the mode schema or their tests changes.

Not yet decided, and stated as written above: `improve`'s reviewer gets the two check commands because it shares env `workspace` (item 2; the alternative is a second reviewer env), and the release number is 3.1.0 because the guard check changes default behaviour (3.0.3 would understate it).

## Review round 1 fixes

The first review (call C-20261104-328613) found one security blocker and four should-fix items. This fix round does these and nothing else, within the bay_lines exception of 9715 (the builder stops and says by how much if not):

1. **Blocker: shortened long options.** git accepts unambiguous prefixes of long options, so `git rm --pathspec-from=paths.txt` passes the guard and removes `bay/guard.py`. For `git mv` and `git rm`, the guard allows only a fixed list of flags (`-r`, `-f`, `-n`, `-q`, `-k`, `-v`, `--cached`, `--dry-run`, `--force`, `--quiet`, `--`) and denies any other word starting with `-` before `--`; `GIT_BAD_FLAGS` also catches any prefix of a banned long option. Both forms go into the test_n3 table.
2. **Reviewers cannot write through the check command.** `./bay.sh check --limits --write` rewrites `framework/limits.yaml`; the guard denies `--write` on `./bay.sh check` for a role whose env does not write `framework/`.
3. **A failed must-level C-n halts the call.** The review halt logic reads the level of a conformance rule from its ruleset, as it does for DoD and rules.
4. **The heartbeat read is strict.** The dispatch check reads `guard.seen` without following symlinks, requires a regular file, treats a modified time in the future as stale, and refuses a reason of only spaces.
5. **Docs.** DESIGN says plainly that a role that may run the test runner can run code it wrote; the comment in `local-authoring.yaml` is restored; `bay status` puts the unguarded dispatches under one heading; the two joins in INTERFACES get their spaces back.

## Review round 2 fixes

The second review found no blocker and no security finding. It found that bay_lines was held at 9715 by writing the new security checks as the three longest lines in `bay/` (347, 222 and 204 characters; the longest before was 174), which games a measure that counts lines. The owner decided in chat on 2026-11-03 that code must be human readable and that long lines count as cheating. This round does these and nothing else:

1. **Readable code.** `bay/guard.py:458`, `bay/guard.py:65` (with its `# noqa: E731`) and `bay/dispatch.py:628` are written as ordinary code, every line 120 characters or fewer. The bay_lines exception rises to the real count, at most 9730.
2. **A hard limit on long lines.** `framework/limits.yaml` gains a measure `long_lines`: lines longer than 120 characters in the code the other kernel measures count (`bay/`, `adapters/` and the protected component paths). Its ceiling starts at today's count; like every measure it may not rise without an `exceptions:` entry, so packing code onto long lines fails `bay check --limits`.
3. **Named trims.** The three DESIGN phrases cut in round 1 to stay within the word budget are named here: "The kit resolves it at load.", ", in project workflows too" and ", whose name says its kind".
4. **Bundled -O.** `git diff -pO<file>`, `-RO<file>` and `git log -pO<file>` get past the `-O` ban (already on main; read-only). A short-option cluster that contains `O` is refused like `-O`.

## Review round 3 fixes

The third review found that the 120-character rule was applied only to the lines round 2 touched: 11 lines over 120 characters that earlier rounds of this change wrote are still in `bay/` (seven in `bay/cli.py`, `bay/guard.py:65`, `:481` and `:490`, `bay/model.py:61`), including the packed `git rm`/`git mv` check, and the `long_lines` ceiling of 193 includes them (main has 185). The owner's rule covers every line this change writes. This round does these and nothing else:

1. **Every line 0020 adds is 120 characters or fewer and reads as ordinary code**, in `bay/`, the tests and the env comments. The `git rm`/`git mv` check is written as plain statements (no nested `next(...)`, no backslash continuation, no reused walrus name).
2. **`long_lines` starts at main's count or lower**: its ceiling is the real count after item 1, at most 185.
3. **`long_lines` splits on `\n` only**, as `bay_lines` does, so a control character cannot hide a long line.
4. **`-S` and `-G` values are not read as option clusters**, so `git log -SOrder` is not refused (git reads no file there).
5. The bay_lines exception rises to the real count after item 1: 9760, measured (the owner raised it from 9750 on 2026-11-04 rather than trim comments in the security code).

## Release 3.1.0

`bay/__init__.py` to 3.1.0; a CHANGELOG entry with an Upgrading note (run `./bay.sh build`; in a session without hooks pass `--unguarded "<reason>"` to `bay note dispatch`); `./bay.sh check --limits --write` lowers `bay_lines` to the real count. The release step prints the tag, push and `gh release create` commands for the owner.
