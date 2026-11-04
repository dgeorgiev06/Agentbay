# Plan 0011: standards as components (core)

## Summary

The proposal as amended in 161a0ac on feat/standards (main 8c395b0, 3.1.0): a new **slice 0** that removes every
`#` comment and cuts every docstring to one line, then items 1 to 4. This plan implements nothing.

- **Slice 0 is measured.** I ran a tokenize/ast removal script (appendix) on a scratch export of 161a0ac. It
  changed 105 of the 110 Python files and removed 1578 lines. The suite passed before and after (575 tests). Every
  file's syntax tree was identical apart from its docstrings. No golden or snapshot test pins comment or docstring
  text. The only behaviour that changes is `bay --help`, which prints the `bay/cli.py` docstring; it moves to a
  `USAGE` constant.
- **The counts after slice 0.** `bay_lines` 9760 → 9074, `kit_python_lines` 5165 → 4880, `long_lines` 182 → 156
  (script alone). After the hand pass, expect about 9125, 4880 and at most 145. Items 1 to 4 then add about +57 and
  +172. Both measures end well under today's ceilings, so the only exception is `tests` 463. The release writes the
  lower ceilings, and `comment_lines` starts at 0.
- **The coordinator's counts cover only the top-level `tests/` folder.** The component and adapter tests hold 440
  more comments, 35 more multi-line docstrings and 18 more `noqa` markers: 43 markers in all, not 25.
- **Hand work.** 272 of the 341 cut docstrings need a new first line, because the old one stops mid-sentence or is
  over 120 characters. About 40 comments and docstrings in the five security files carry a reason. Each one goes
  to a name, an error message, a README line, or a doc that already states it (list in slice 0). Each `noqa` has a
  named fix.
- **The biggest risk is merge conflicts.** Slice 0 touches nearly every Python file, so every open branch
  conflicts. It lands first, in seven commits, right after the gate.

Amendments the proposal still needs are under "Before the gate".

## What I checked

All runs used `git archive` exports in the scratchpad. For slice 0 that was an export of 161a0ac, turned into a
scratch git repo so `bay check --limits` could count it. For the replay, scratch worktrees of f3cb194 (since
removed). The tools were `python3 -I -m ruff` 0.17.3 and `python3 -I -m mypy` 2.4.1, with a scratch config
standing in for `components/python/`: ruff `line-length = 120`, `select = ["E", "F", "W", "B"]`; mypy
`strict = True`, `exclude = (^|/)tests/`.

- **Slice 0 on a scratch copy.** The script ran over every Python file git lists under `bay/`, `adapters/`,
  `components/` and `tests/`.
  - Before, per place:

| Place | Files | `#` comments | multi-line docstrings | `noqa` | lines removed |
|---|---|---|---|---|---|
| `bay/` | 30 | 303 | 176 | 9 | 686 |
| `adapters/` (not tests) | 1 | 30 | 4 | 0 | 56 |
| `components/` (not tests) | 24 | 172 | 77 | 3 | 389 |
| `tests/` | 32 | 432 | 49 | 13 | 268 |
| component and adapter `tests/` | 23 | 440 | 35 | 18 | 179 |
| **all** | 110 | 1377 | 341 | 43 | 1578 |

  - Outside the tests this matches the coordinator's 505 comments and 257 docstrings. The coordinator's test
    figures (432 and 49) are `tests/` alone.
  - After: 0 comment tokens (shebangs kept) and 0 docstring lines past the first. The suite gave 575 passed,
    0 failed, before and after. `bay check --limits` gave the counts in the summary.
  - ruff on the four folders went from 643 findings to 561. E501 fell by 109 (long comments gone). The removed
    markers surfaced 13 E402, 11 E731 and 3 F401, which slice 0 fixes (list below).
  - 23 cut docstring lines are over 120 characters (11 of them in `bay/` and the kit), and 272 docstrings end
    mid-sentence. The script lists both, per file, for the hand pass.
- **The counts in the proposal reproduce.** ruff on `bay adapters`: 173 (180 with `--ignore-noqa`). With
  `components`: 369 (387 with `--ignore-noqa`), and 670 for the whole tree, tests included. mypy on `bay`: 635 errors,
  all `error`, none `note` (type-arg 243, no-untyped-def 201, no-untyped-call 100).
- **The `ruff` and `mypy` on PATH are not the pinned ones.** `ruff --version` prints 0.16.9 and `mypy --version`
  prints 2.3.1 (uv tool installs in `/root/.local/bin`). `python3 -m ruff` is 0.17.3 and `python3 -m mypy` is 2.4.1.
  The old draft's figures came from the PATH tools. This decides how agents call them (decision A).
- **Planted config and plugins (the security question).** I planted `ruff.toml` and `pyproject.toml` (with
  `select = ["ALL"]`) at the root and in a changed folder, and a `mypy.ini` whose `plugins =` names a file that
  writes a marker when imported.
  - ruff with `--config <file>` ignored every planted file. Without `--config` it picked them up (26 findings
    instead of the expected set).
  - mypy with `--config-file <file>` ignored both planted configs, and the plugin did not run. **Without
    `--config-file`, mypy loaded the planted `mypy.ini` and ran the plugin** (the marker file appeared).
  - `--ignore-noqa` also overrides a file-level `# ruff: noqa` and the range suppressions `# ruff: disable[...]` /
    `# ruff: enable[...]`. The suppressed findings were reported.
  - **An inline `# mypy: ignore-errors` in a new file hid its error** (`def f(a): return a` gave no
    `no-untyped-def`). mypy has no flag that turns inline config off.
  - `python3 -m ruff` run from a folder holding a planted `ruff.py` printed the planted module's output: `-m` puts
    the current folder first on `sys.path`. `python3 -I -m ruff` ran the real ruff.
  - ruff's `--config` also takes an inline TOML pair. `--config "cache-dir='<any path>'"` made ruff 0.17.3 create
    a cache folder at that path. `output-file` is refused as an inline key.
- **Nothing is written in the project** by `ruff check --no-cache` or by mypy with `--cache-dir` outside the
  project.
- **Run times** (wall time on this container, one tree): `git archive` and extraction 0.06 to 0.32 s (1.2 s cold);
  ruff 0.07 to 0.12 s; mypy over `-p bay -p adapters -p components` 2.7 to 3.7 s cold, 1.9 s for the second tree on
  a shared temporary cache. A whole `standards` step, two trees and both tools, takes about 7 s.
- **New findings per recent change.** I replayed the last eight merged PRs (#20 to #27) with a scratch checker: it
  exports both trees, runs both tools, keys findings by (file, rule, message), takes the multiset difference and
  follows renames with `git diff -M`.

| PR | ruff new (no tests) | ruff new (with tests) | mypy --strict new | files whose comment lines rose |
|---|---|---|---|---|
| #27 agent checks (0020) | 0 | 1 (B905) | 5 | 3 (cli.py +4, guard.py +7, limits.py +1) |
| #26 todo mode | 28 (E501 22) | 28 | 39 | 1 (new todo_rules.py, 0 to 27) |
| #25 kit inventory tests | 1 | 1 | 0 | 0 |
| #24 kit content types | 0 | 0 | 0 | 0 |
| #23 store base | 41 (E501 37) | 78 | 30 | 6 |
| #22 plan approval | 23 (E501 23) | 44 | 8 | 3 |
| #21 test defects | 4 | 7 | 0 | 1 |
| #20 ledger truth | 14 | 17 | 6 | 1 |

  E501 is nearly all of ruff's new findings; without it, the most any PR added was 6. mypy's new findings are
  mostly `no-untyped-def`, then `type-arg` and `no-untyped-call`. The last column led to the owner's decisions of
  2026-11-04: under the absolute rule, each of the six PRs whose comment lines rose needs a fix round.

## Slice 0: remove the comments and cut the docstrings

**Rule applied.** No `#` comment in any Python file git lists under `bay/`, `adapters/`, `components/` or any
`tests/` folder; a shebang on line 1 is not a comment. A docstring is one line. Strings that hold Python as test data
(for example `"# evil\n"` in `tests/test_boundary.py`) are data, not comments: tokenize does not see them, and they
stay.

**Tooling.** The script in the appendix, run from the scratchpad and never committed, because the kit has no use
for it after slice 0. It uses `tokenize` and `ast`, never a regular expression.
- It deletes every COMMENT token. A comment alone on its line takes the line with it. An inline one is cut with the
  spaces before it.
- It replaces every multi-line docstring with its first source line, in the same quotes and prefix, at the same
  indent.
- A gap of blank and removed lines keeps its longest run of blank lines, so no gap grows.
- It refuses to write a file whose syntax tree changed beyond docstrings (`ast.dump` with docstrings blanked).
- Per file it reports the removed comments, the `noqa` markers it found, and the docstrings to reword (a first line
  that does not end a sentence, or a line over 120 characters).

Run per batch: `python3 -I <scratchpad>/strip_comments.py <files of the batch>`.

**Then the hand pass, in the same commit.**
1. Reword every docstring the report lists into one complete line of at most 120 characters. Do not join two lines
   with a semicolon to keep both: one line says one thing.
2. Apply the reasons list below for the security files.
3. Fix what each removed `noqa` hid (list below).
4. Read the whole diff once. Look for a blank line left between a decorator and its function, or a `pass` that now
   sits alone where a comment explained an empty branch.

**Batches.** One commit each, by folder, each removing about 300 lines or fewer. After each:
`python3 tests/run.py` and `./bay.sh check` (with `--limits`).

| Batch | Files | Lines removed by the script |
|---|---|---|
| 0.1 | `bay/` security files: guard, vault, secretscan, ledger, dispatch, use_shim, hook | 174 |
| 0.2 | `bay/model.py`, `bay/cli.py` (with `USAGE`), `bay/workflows.py`, `bay/boundary.py` | 226 |
| 0.3 | the other 19 files in `bay/`, and `bay/templates/connector/module.py.tmpl` | 286 |
| 0.4 | `adapters/` and the protected components, not their tests | 285 |
| 0.5 | the other components, not their tests (gmail-api, x-api, todo, email, post) | 160 |
| 0.6 | `tests/`, the path setup moved into `tests/run.py` and `conftest.py`, `test_module.py.tmpl` | 268 |
| 0.7 | the component and adapter tests | 179 |

Batch 0.1 goes first and alone, because its hand pass carries the reasons that must not be lost.

**Help text: the one behaviour change.** `bay/cli.py:767` passes `description=__doc__` to argparse. Its 38-line
docstring is the command summary `bay --help` prints. `test_the_cli_has_about_fifteen_commands_and_no_old_names`
reads only the positional list, so no test would notice the summary going. Recommended: the text becomes a module
constant `USAGE`, passed as `description=USAGE`, and the docstring becomes one line. A string constant is code, not
a comment or a docstring. It costs the 38 lines back (counted in the estimate).

**Templates.** `bay/templates/connector/module.py.tmpl` writes a four-line docstring, and `test_module.py.tmpl`
writes a `sys.path` insert and a `# noqa: E402` into every scaffolded connector. A builder who scaffolds would get
comments-check findings on files they never wrote. Batch 0.3 cuts the docstring to one line. Its two sentences on
`ctx.http` and secrets move to `bay/templates/connector/README.md`. Batch 0.6 removes the path lines from the test
template, in the same commit as the runner change that makes them unnecessary.

### Reasons in the security files, and where each goes

The five files in the task, plus `bay/use_shim.py` and `bay/hook.py`, whose docstrings carry security reasons too.
"Already stated" means DESIGN.md's Safety model (:112-149) or INTERFACES.md §8-9 says it today, so the comment
goes and nothing is added. DESIGN.md is at its word budget, so nothing new goes there. Each entry is
line: reason → where it goes.

**bay/guard.py**
- 2-39, module docstring: per-role scope, who is calling, fail closed → one line, "PreToolUse guard: per-role scope
  for agentbay subagents; stdlib only, runs as a hook." The rest is already stated.
- 2-39: a Claude Code version without agent fields looks like the main thread → README.md requirements (:42):
  "a Claude Code version that sends `agent_type`".
- 54: `CONTROL` is never searched by pattern → name `NEVER_SEARCHED`.
- 55-56: what the `NEVER_*` constants cover → already in their names and in the deny messages.
- 61-62: an `O` in a short-option cluster reads a file; `-S` and `-G` end a cluster → name `GIT_O_CLUSTER`, and the
  deny message says "a short-option cluster with O reads a file like -O".
- 67: the only flags `git mv` and `git rm` take → name `GIT_MV_RM_FLAGS` (`GIT_PATH_FLAGS` today).
- 84-85: no Bash command may name agentbay.config.yaml, because it sets `approve.from` → the deny message says so.
- 87: the kit CLI in any spelling → name `_KIT_CLI_RE`.
- 103: `approve` needs no ask rule, because no allow rule covers it → already stated.
- 105, 134: a shell expansion may hide an asked verb, so fail toward ask → name `ASK_VERB_EXPANSIONS`; the reason
  the code returns already says `<word with an expansion>`.
- 129: shell operators glue to words → a helper `split_on_operators(raw)`.
- 259, 313, 338: probe and path details → deleted; the deny messages and the tests cover them.
- 449-451, 472: an old policy prompts; the only auto-allow is the role's own shim → already stated.
- 528: stdlib only, because it runs as a standalone hook → the module's one line.
- 597: scrub, then cut → a helper `_ledger_reason(reason)` that does both, in that order.
- 601: the decision must not depend on the ledger → `record_denial`'s one line, "Ledger a denial; never raises, so
  no decision depends on the ledger."
- 622, 624: a failed heartbeat write never denies, and never goes through a symlink → a helper
  `_touch_seen(project)`, "Mark the hook as seen; never raises, never follows a symlink."
- 637, 640: `ask` for a `--agent` session; fail closed for subagents → the error message already says "denied for
  subagent".

**bay/vault.py**
- 1-8: values never leave the process; `redact` is the last line of defence → already stated (DESIGN :102,
  INTERFACES :208).
- 48: the env provider cannot persist → deleted; `return False` says it.
- 72-73: `security -i` reads stdin because argv is visible through ps → `set`'s one line, "Store via
  `security -i` on stdin, never argv: argv is visible to every local user."

**bay/secretscan.py**
- 1-6: stdlib only, because hooks import it → one line, "Scrub secret-shaped text agentbay never resolved; stdlib
  only, so hooks can import it."
- 11: the patterns go from specific to generic → name `PATTERNS_MOST_SPECIFIC_FIRST`.
- 20-21: the password rule is strict on purpose; source detectors read unscrubbed text and scrub what they emit →
  one line in `components/improve/README.md`, under artifact-graph.

**bay/ledger.py**
- 1-4: append-only; stdlib only for hooks → one line, "Append-only event ledger; stdlib only, so hooks can import
  it."
- 18-25: what each event type is; `review.recorded` passes no gate → already stated (INTERFACES §9);
  `record_review`'s one line keeps "no gate reads it".
- 51-52: scrub, then redact, before any write → already stated (INTERFACES :208).
- 54: one `O_APPEND` write of one short line is atomic enough for parallel hooks → a helper
  `_append_line(path, line)` with that sentence as its docstring.
- 215: split on `\n` only, because `splitlines` also splits on U+2028 inside a summary → a helper
  `_jsonl_lines(text)` with that sentence as its docstring.
- 233, 302: the run and call statuses → names `RUN_STATUSES` and `CALL_STATUSES`.

**bay/dispatch.py**
- 1-18, module docstring: how a call walks its steps → already stated (INTERFACES §3 and §7).
- 32-33: only these two approvers pass a gate → name `GATE_APPROVERS`.
- 172: an edit after approval needs a fresh look → already stated ("A gate binds content").
- 181-182: a chat approval must carry the sha → already in the error message.
- 367, 527: fail closed; the resolver already refuses, and the run re-checks → the error messages end
  "(re-checked at run time)".
- 488: defence in depth, the path carries the callId → deleted; the condition stays.
- 490-491: only the latest decision on a path counts, so reverting a file does not revive an approval →
  `_gate_check`'s one line, "Skip a gate only when the latest owner decision on this path approved this content."
- 513-514, docstring: a ledger line alone passes nothing → `_state_holds`'s one line keeps it.
- 284-288, docstring: B-9 takes the intersection of `uses:`, fail closed → `_open_uses`'s one line, "What every
  open call waiting on `unit` declares in `uses:`: the intersection (B-9)."
- 536, 646: report, never leak; gates are never submitted → `vault.redact(str(e))` shows the first; the second is
  already stated.

**bay/use_shim.py and bay/hook.py**
- use_shim 1-9: run as a script with `-E`, never `-c`, so only kit code is importable → one line, "Use shim entry:
  a script run with -E, never -c, so no project file is importable."
- hook 1-8: never blocks the session; errors are logged and it exits 0 → one line, "Claude Code hook to ledger
  events; never blocks: errors are logged and it exits 0."

Outside these files the hand pass applies the same test. A comment that names a security or crash-safety reason
goes to a name, a message or the component's README. Any other comment is deleted.

### The `noqa` markers and their fixes

43 markers: 12 outside the tests, 13 in `tests/`, 18 in component tests.

- **E731, a lambda assigned to a name** (11, two of them bare `# noqa`). `bay/connect.py:186`,
  `bay/dispatch.py:685`, `bay/graph.py:140`, `bay/limits.py:38` and `:44`; `tests/improve_fixtures.py:67`,
  `tests/test_core_names.py:183`, `components/todo/tests/test_todo.py:68`, `test_improve_store.py:42`,
  `test_improve_detect.py:58`, `test_improve_detectors.py:77`. Fix: a nested `def`, which adds one line each.
- **E402 in the three entry scripts**: `bay/cli.py:53`, `bay/hook.py:19`, `bay/use_shim.py:16`. No code fix
  exists: an entry script must set `sys.path` before it imports `bay`, and in use_shim that order is the security
  measure. `components/python/ruff.toml` gets `per-file-ignores` for E402 on these three files. The glob anchoring
  under `--config` is to be checked on 0.17.3; `**/bay/cli.py` works either way.
- **E402 in tests** (`tests/helpers.py:17-18`, and the `sys.path` inserts in 10 test files: content_types,
  corpus_store, sqlsandbox, todo_rules, x_api, gmail_api). Fix: delete the `sys.path` lines.
  - `tests/run.py` already puts `tests/` and the kit on the path. It also puts each test file's own folder there
    while that file runs (for `gmail_fake`).
  - For pytest, `tests/conftest.py` moves to the kit root as `conftest.py` (`git mv`), so it covers the component
    tests too.
- **E402, mid-file imports** in `tests/test_boundaries.py:363` and `:721-724` → moved to the top of the file.
- **E402 in `tests/test_dispatch.py:185`**, which imports `test_x_api` from another folder → a five-line
  `load_module(path)` in `tests/helpers.py` (importlib), with no `sys.path` change.
- **F811 at `tests/test_boundaries.py:32`**: the marker is stale. ruff reports nothing there once it goes (the first
  `cleanup` is used as `_cleanup`), so it is only deleted.
- **F401**: `tests/test_util.py:6` imports `KIT` only for its `sys.path` effect, so the import goes.
  `components/improve/tests/test_improve.py:8` imports only the names it uses.
- **Bare `noqa` on `assert json`** (`test_improve_store.py:300`) → the line goes; `json` is used elsewhere.
- **Rules not in the selection**: BLE001 (`bay/model.py:201`), A002 (`corpus_store.py:1009`, `todo_rules.py:301`,
  the parameter `set`), N802 (`gmail_api.py:781`, `do_GET`). The marker goes and nothing else changes. The
  fail-closed reason at `model.py:201` is already in the error message it returns. `set` is the endpoint's input
  field, and `BaseHTTPRequestHandler` requires `do_GET`.

The ruff run after the script agrees: the findings the markers hid are E402, E731 and F401 at these places. The
E402 per-file ignore for the three entry scripts is the only rule left out anywhere.

### Golden and snapshot tests

None pins comment or docstring text. The suite passed unchanged on the stripped copy, goldens included:
`tests/golden/guard-matrix*.json` and `stages.json`, `components/improve/tests/golden/improve.json`, and
`components/store/tests/test_offline_golden.py`. The improve detectors that read comments (`slop_comments`,
`compat_layers` in `detect_artifacts.py:183` and `:674`) run on fixtures the tests build. On the kit itself they
find fewer things after slice 0, and `test_audit_on_the_kit_itself` passed on the stripped copy. The one
docstring-to-output path is `bay --help`, handled by `USAGE` above.

## Open decisions, settled with evidence

**6. Rule selection.** On 0.17.3, `E`, `F`, `W` and `B` select 153 rules: 107 stable and 46 preview (E1xx, E2xx,
E3xx, E502, W391, B043, B901, B903, B909). A rule in preview runs only with `preview = true`, so `ruff.toml` must not
set it. `ruff rule` on 0.17.3 confirms every code that fires today:
- stable, no fix available: E501, E702, E701, E741, B904, B023;
- stable, fix sometimes available: E731, B007, F401, E402;
- stable, fix always available: B905.

**Recommendation:** keep `E,F,W,B` at line length 120. E501 at 120 is the owner's own line rule, so it stays even
though it fires most. Leave no code out, except the E402 `per-file-ignores` for the three entry scripts (slice 0).
Run ruff on everything git lists, tests included.

**8. mypy scope.** Passing the folders as paths fails: `mypy components` stops with exit 2, "No parent module --
cannot perform relative import", in `improve-detect/pipeline.py`. Passing them as packages works:
`-p bay -p adapters -p components` with `exclude = (^|/)tests/` checks all 155 non-test files and gives 1292 errors
(bay 635, components 634, adapters 23) in 3.2 s. **Recommendation:** one `-p` per top-level folder that holds Python
git lists, plus top-level `.py` files as paths, tests excluded in `mypy.ini`. A folder name with a dot cannot be a
`-p` name; it is skipped with a warning. mypy stays `--strict` (owner decision 4).

**JSON output on the pinned versions.**
- ruff 0.17.3: `--output-format json` gives one JSON array. Each item has `code`, `message`, `filename` (an
  **absolute** path, so the checker makes it relative to the tree it ran in) and `location.row`. A syntax error is
  an item with code `invalid-syntax`.
- mypy 2.4.1: `--output json` gives JSON lines with `file` (relative to the working folder), `line`, `code` (null
  for some blocking errors), `message` and `severity`. Keep only `severity == "error"`.
- Exit codes: ruff 0 clean, 1 findings, 2 error; mypy 0 clean, 1 errors, 2 blocking error.
  `python3 -I -m <missing module>` also exits 1, so the checker runs `<tool> --version` first (decision D).

**Timeouts.** `RUFF_TIMEOUT = 60`, `MYPY_TIMEOUT = 120`, `--version` probes 30 s each, and the export keeps the
120 s of `pipeline.py:181`. That is over 30 times the measured time.

**7. Tests: merge instead of +3** (taken by the owner: 463). Both merges are in
`components/improve/connectors/improve-detect/tests/test_deadcode_check.py`:
- The several-providers mechanism test goes into `test_a_new_finding_blocks_the_extend_call_before_review`
  (`:231`). It stubs `Dispatcher._invoke` by connector name: `comments-check` returns one new finding and
  `python-check` none. It asserts that both were called, that the call is `blocked` before review, and that the
  reason names the finding.
- `test_forge_extend_runs_deadcode_between_implement_and_review` (`:247`) is folded into the same test, renamed
  `test_forge_extend_code_checks_sit_before_review_and_any_new_finding_blocks`.

So: tests 462 + 2 new (python-check, comments-check) - 1 merged = 463. Slice 0 adds no test.

## Decisions the plan adds (each with a recommendation)

**A. Who may run the tools, and with what (guard).** Taken by the owner (decision 5).
- The agent clis are `python3 -I -m ruff check` and `python3 -I -m mypy`: the same interpreter, version and module
  the step runs, and `-I` stops a planted `ruff.py` or `mypy.py`.
- The guard requires `--config <kit>/components/python/ruff.toml` and
  `--config-file <kit>/components/python/mypy.ini`, compared after `norm`. The kit path comes from `self.kit`.
- The other flags are an exact list: `--no-cache`, `--ignore-noqa`, `--statistics`, `--strict`,
  `--show-error-codes`. No `--output-format`, no `-O`, no `--cache-dir`. Paths go through `_words` as today.
- Without the required config the command is denied. That stops the planted-plugin run and the inline `cache-dir`
  write shown above.

**B. Which config the step uses.** Taken. The step reads both config files **from the merge-base export** when the
export has them, and from the kit otherwise. An edited config takes effect once it has landed, after its own gate.
Stated limit: the checker, the dispatcher and `bay/limits.py` are themselves in the tree under review in
forge.extend; the boundary check, the gate and the review catch an edit of those.

**C. The comments count (replaced by owner decision 3).** The count is `#` comment tokens (a shebang excepted) plus
the docstring lines after the first. It is one function, `limits.comment_lines`, used by the measure and by
comments-check, so the two never disagree.
- comments-check keeps the per-file comparison with the merge-base: one finding per changed file whose count rose.
  In the kit every base count is 0 after slice 0, so any comment or second docstring line is a finding: the
  absolute rule. A delivery project with comments of its own is not made to clean files it only touched.
- The `comment_lines` measure counts **every** Python file the rule covers: `bay/`, `adapters/`, all of
  `components/` and every `tests/` folder, not only the files the other code measures count. Its ceiling 0 then
  holds the whole rule in `bay check --limits`, tests included. The cost: an extension a user adds to their own
  kit checkout fails `bay check --limits` while it has a comment. The alternative counts only what the other code
  measures count (plus all tests) and leaves the other components to comments-check. I recommend the full scope,
  because the owner's rule names all of `components/`.

**D. Tool presence and version.** Taken.
- The checker first runs `python3 -I -m ruff --version` and `python3 -I -m mypy --version`.
- A missing module (exit 1 with "No module named" on stderr) stops the step with
  `pip install -r requirements-dev.txt`.
- A version other than the pin is a warning, not a stop: both trees run on the same version.

**E. mypy inline config and `# type: ignore`.** Taken. python-check reports each `# mypy:` line and each
`type: ignore` comment as a finding of its own (rules `mypy-inline` and `type-ignore`). In the kit, comments-check
already blocks them. In a delivery project, where comments-check compares counts per file, E still blocks a new one
when the same change drops another comment.

**F. `standards.check/v1` is `dispatcherOnly: true`,** like `improve.detect/v1`. Taken.

**G. Share the git helpers (optional, recommended).** python-check needs the same merge-base, rename and export
code as improve-detect: `_merge_base` (pipeline.py:197-209), `_renames` (:220-223) and `_export` (:175-189), about
40 lines. B-7 forbids importing another connector's code. Either:
- (a) copy them, which leaves the duplication DOD-8 names; or
- (b) move them to `bay/boundary.py` (which already has `show`) and have all three connectors import them: about
  +32 `bay_lines`, about −40 kit lines in improve-detect and −52 from the two new connectors. It adds one touch,
  `components/improve/connectors/improve-detect/pipeline.py`.

I recommend (b): fewer lines overall, and one copy of security-relevant code (the tar `filter="data"` extraction).
With slice 0 there is room under both ceilings for either.

## Before the gate (amendments to the proposal, R-12)

1. **Counts in owner decision 2.** "432 comments and 49 multi-line docstrings in tests" and "25 `noqa`" cover only
   the top-level `tests/` folder. With the component and adapter tests: 872 comments, 84 docstrings, and 43 `noqa`
   markers (12 outside tests).
2. **Touches.** Add `conftest.py` at the kit root (the `git mv` of `tests/conftest.py`; slice 0's E402 fix). It is
   owned in `framework/kernel.yaml`, next to `requirements-dev.txt`. Everything else slice 0 edits sits under the
   four folders already listed, and README.md is already touched. The alternative to the move is `per-file-ignores`
   for E402 on every test file, which keeps about 30 `sys.path` lines the runner makes unneeded.
3. **Stale text above the owner decisions.** The Summary still names three exceptions, item 3 still says "a one-line
   comment only for a reason the code cannot express" and that the cleanup is not in this proposal, and the Cost
   section still asks for `bay_lines` and `kit_python_lines` exceptions. The decisions section says it replaces
   them, but a reader meets the old text first. I recommend editing those lines to match.
4. **DOD-18 and DOD-6 wording.** Under the absolute rule these read: "No `#` comment and no docstring longer than
   one line; a reason goes in a name, an error message or the README." The builder prompt carries the same
   sentence. This is in touched files; listed so the owner sees the text.

Done in the build without an amendment (all inside touched files):
- `python3 -I` and `cwd=<tree>` for every tool call, and the guard rules of A;
- the config read from the base export (B), the version probe (D), the inline-config findings (E),
  `dispatcherOnly` (F);
- `requirements-dev.txt` in framework-dev's write list, and `components/python` and `components/comments` under
  `owns:` (owner decision 5);
- `comment_lines: 0` written into `framework/limits.yaml` in the commit that adds the measure. `limits._ceilings`
  requires every name in `MEASURES` to be in the file, and the base has no such entry, so no exception is needed.

## Build order

Each step is one commit. `python3 tests/run.py` and `./bay.sh check --limits` stay green after each.

1. **Slice 0, batches 0.1 to 0.7** (table in slice 0). They land first, right after the gate, so open branches
   rebase once onto a tree without comments.
2. **Item 1, the mechanism.** `Step.connectors`, the resolver, `_run_code` and the merge. The test is the merged
   forge.extend test, with stub providers.
3. **G (if chosen).** Move the three git helpers to `bay/boundary.py`; improve-detect imports them.
4. **Item 3's counter.** `limits.comment_lines`, the measure over all four places, `comment_lines: 0` in
   `framework/limits.yaml`, and `test_limits` extended. It comes before the connectors because comments-check
   imports it, and after slice 0 because the count must already be 0.
5. **Item 2, the python component**, without the agent clis: `components/python/` (with the E402
   `per-file-ignores`), `requirements-dev.txt`, python-check and its test.
6. **Item 3's connector:** `components/comments/` and its test.
7. **The guard, then the clis.** First the `guard.py` rule and its test rows (deny for every case), then
   `READ_ONLY_CLIS` and the env clis, with the matrix deltas. The clis are never granted without the flag check, at
   any commit.
8. **Item 4, the wiring:** bindings, `standards` steps, DoD items, the builder prompt, kernel.yaml (protected,
   `owns:`, owned files) and the framework-dev write list.
9. **Docs:** README, DESIGN and INTERFACES, with the cuts below.
10. **Release:** 3.2.0, the CHANGELOG with the Upgrading note, and `./bay.sh check --limits --write ...` once, which
    writes the lower `bay_lines`, `kit_python_lines` and `long_lines`.

From step 2 on, the code these steps add has no comments and only one-line docstrings: from step 4 the limits step
would block it anyway.

## Item 1: a code step with several connectors

Files:
- `bay/model.py`:
  - `Step.connector: str | None` (`:492`) becomes `connectors: list[str]` (default empty list).
  - `:1336-1341`: an empty list is the gap "binds no connector for {iface}". Otherwise `step.connectors = conns`, and
    `check_connector` runs for each name.
  - `when: stale` with more than one connector is a gap, because `_fresh` reads one status.
- `bay/dispatch.py`:
  - `_fresh` (`:438`) uses `step.connectors[0]`.
  - `_run_code` (`:535`) calls a new `_invoke_all`, which runs each connector in order. When there are several, it
    merges the outputs with `_merge`.
  - The loop goes into a helper so `_run_code` keeps its decision count under the deadcode `complexity` limit.
  - A connector that raises fails the step, and the message names the connector.

```python
def _merge(outs: list[dict]) -> dict:
    """One result from several connectors of a code step: lists join, counts add, texts join with "; "."""
    merged: dict = {}
    for out in outs:
        for key, value in out.items():
            if key not in merged:
                merged[key] = value
            elif isinstance(value, list):
                merged[key] = merged[key] + value
            elif isinstance(value, str):
                merged[key] = f"{merged[key]}; {value}"
            elif isinstance(value, int) and not isinstance(value, bool):
                merged[key] = merged[key] + value
            else:
                raise CallError(f"cannot merge {key!r} from several connectors")
    return merged
```

The merge is generic: the dispatcher does not learn the shape of `standards.check/v1`, and each output has already
been validated against the endpoint's `out` schema in `_invoke` (`:572`). `run_capability` (`:345-347`) keeps
"exactly one connector": no CLI path runs standards.

Tests:
- The merged test in `test_deadcode_check.py` (decision 7).
- `tests/test_resolver.py:220` asserts `.connectors == ["corpus-store"]`.
- `no_deadcode` (`tests/test_dispatch.py:208`) also returns `{"new": [], "existing": 0}` for `standards.check/v1`.

## Item 2: the python component and the guard

Files:
- `components/python/component.yaml`, `README.md`, `ruff.toml` and `mypy.ini`:
  - `ruff.toml`: `line-length = 120`, `[lint] select = ["E", "F", "W", "B"]`, no `preview`, and
    `per-file-ignores` E402 for `bay/cli.py`, `bay/hook.py` and `bay/use_shim.py`.
  - `mypy.ini`: `strict = True`, `exclude = (^|/)tests/`.
- `connectors/python-check/connector.yaml` and `python_check.py`.
- `requirements-dev.txt`: `ruff==0.17.3`, `mypy==2.4.1`, and `types-PyYAML` and `types-jsonschema` pinned when the
  file is written.

**Unmeasured: the stubs.** Every mypy count here was measured without the stubs, with `ignore_missing_imports`.
With the stubs installed the base count changes but the comparison does not. `mypy.ini` should not set
`ignore_missing_imports`; a machine without the stubs gets `import-untyped` on both trees, so it shows as existing.

`python_check.change(base)`:
1. Resolves the merge-base, refusing a base that starts with `-`.
2. Probes both tools (D).
3. Exports the merge-base into a `TemporaryDirectory`, and reads the configs from it (B).
4. Runs ruff, then mypy, on the export and then on the project. Each run gets `cwd=<that tree>` and
   `[sys.executable, "-I", "-m", ...]`. mypy gets a `--cache-dir` inside the same temporary folder, shared by both
   runs.
5. Adds the `mypy-inline` and `type-ignore` findings (E).
6. Maps base paths through the renames, and returns `new`, `existing`, `warnings` and `stopped`.

The temporary folder is removed when the `with` block ends, on errors too. `subprocess.run` kills a tool that times
out. A finding is `{file, line, rule, message}`, never source text.

```python
    def _ruff(self, tree: Path, config: Path) -> Counter[tuple[str, str, str]]:
        argv = [sys.executable, "-I", "-m", "ruff", "check", "--no-cache", "--ignore-noqa",
                "--output-format", "json", "--config", str(config), *self._python_files(tree)]
        done = self._tool("ruff", argv, tree, RUFF_TIMEOUT)
        found: Counter[tuple[str, str, str]] = Counter()
        for item in json.loads(done.stdout or "[]"):
            path = Path(item["filename"]).relative_to(tree).as_posix()
            found[(path, item["code"] or "invalid-syntax", item["message"])] += 1
        return found
```

Two points in this sketch matter:
- **The key keeps the E501 message, which carries the line length** ("Line too long (133 > 120)"). A long line that
  is moved stays existing; a long line that is edited and is still long counts as new.
- A mypy exit 2 is `stopped`, with the first error's file and message.

Guard (`bay/guard.py`, decision A):
- `LINT_FLAGS`, plus a map from each tool to its required config flag and file.
- `_lint_command`, called from `_prefixed_command` when the prefix is `python3 -I -m ruff check` or
  `python3 -I -m mypy`.
- It denies a word starting with `-` that is not on the list or the required flag. It denies a missing or different
  config path. It denies `--config=...` (the `=` form is not on the list).

Tests:
- New `test_python_check_reports_only_findings_new_against_the_base` (`components/python/tests/`), with the runner
  injected as `pipeline.py:193` does. It covers the proposal's cases, a missing module (stops with the pip command),
  a version mismatch (a warning), a new `# mypy: ignore-errors` (one finding), each recorded call (`-I`, `cwd`, a
  timeout, no `shell`), and the config path (the export's).
- `tests/test_guard_matrix.py`: named deltas for every unit that gains the clis, including the project matrix
  (`test_guard_matrix_for_a_project_with_the_kit_outside`).
  - Rows that become pass: `python3 -I -m ruff check --config <kit>/components/python/ruff.toml bay`, and the same
    for mypy with `--config-file`.
  - Rows that stay deny: `--fix`, `--add-noqa`, `-o x`, `--config "cache-dir='x'"`, mypy without `--config-file`,
    `--config-file mypy.ini`, `--junit-xml x`, `--python-executable x`, and the abbreviation `--conf ...`.
- `tests/test_boundaries.py:523` asserts the same refusals for a write-less unit.
- `tests/test_roles.py:224` gets the new `READ_ONLY_CLIS` text.

## Item 3: the comments rule, the counter, the checker

Files:
- `bay/limits.py`: `comment_lines(text) -> int` (decision C's count), `"comment_lines"` in `MEASURES`, and its entry
  in `count()` over the four places.
  - A file that does not parse raises `RuntimeError` naming the file, never a silent 0.
  - Imports: `ast`, `io`, `tokenize`.
- `components/comments/component.yaml`, `README.md` (the rule, the one place it lives),
  `connectors/comments-check/connector.yaml` and `comments_check.py`.
  - The checker covers the changed files from `git diff -M --name-status -z <sha>`, plus new files from
    `git ls-files -o --exclude-standard`.
  - It reads the base text with `boundary.show` (no export) and counts both sides with `limits.comment_lines`.
  - It returns one finding per file that rose: rule `comment-lines`, message `comment lines <a> -> <b>`.
- `framework/limits.yaml`: `comment_lines: 0` in the commit that adds the measure.

The README states the rule: no `#` comments; a docstring is one line; a reason the code must keep goes in a name,
an error message or the README. A shebang is not a comment; Python held in a string as test data is not code.

Tests:
- New `test_comments_check_blocks_a_file_whose_comment_lines_rise`: a new `#` line is one finding; a second
  docstring line is one finding; a one-line docstring is free; a renamed file with the same count is none; a new
  file with one comment is one finding.
- `tests/test_limits.py:27`: `NOW` gains `comment_lines`. `FILES` holds `#`-only lines (`bay/util.py`,
  `components/c/c.py`, and the test file), so the count is non-zero there; a file that does not parse is asserted to
  stop the count.

## Item 4: wiring

Files: as in the proposal's touches, plus the following.
- `components/tools/interfaces/standards.check.v1.yaml` carries `dispatcherOnly: true` (F).
- `framework/kernel.yaml`: `components/python` and `components/comments` are under `protected.paths` **and**
  `owns:`. The connectors python-check and comments-check are protected. `requirements-dev.txt` and the root
  `conftest.py` are owned.
- `components/forge/envs/framework-dev.yaml`: the write list gains `components/python`, `components/comments` and
  `requirements-dev.txt`, and the clis gain the two `python3 -I -m` prefixes.
- `workspace` and `local-authoring` bind `standards.check/v1: [python-check, comments-check]` and gain the two
  prefixes as read clis.
- `framework/roles/builder.yaml`: one sentence for the rule (amendment 4), and the check line names
  `python3 -I -m ruff check` and `python3 -I -m mypy` with their config flags.
- The forge and delivery steps, DOD-17 and DOD-18 (forge), DOD-5 and DOD-6 (delivery), and the base `HEAD` for
  delivery are as the proposal says, with the wording of amendment 4.

Test: the merged forge.extend test (decision 7). The delivery order (`implement`, `standards`, `review`) is asserted
inside an existing delivery mode test, so no test is added.

## Risks

- **Slice 0 conflicts with every open branch.** It touches 105 of 110 Python files. Mitigation: land it first, in
  its seven commits, right after the gate. Ask the owner to merge or park open branches before. A branch that
  rebases afterwards can run the same script on its own files.
- **A reason lost in the cleanup.** The list in slice 0 covers the five security files and the two entry scripts. Other
  files get the same test in the hand pass. The reviewer of batch 0.1 checks the list line by line against the
  diff.
- **272 docstrings to reword.** This is the bulk of the human work, and a bad one-liner is worse than none. A
  docstring that adds nothing to its function's name may go entirely; that is allowed and also removes a line.
- **Builder friction (the expected cost).** By the replay, about half of the changes would have needed a fix round
  for mypy --strict (median 5.5 new errors), and every change that adds a comment needs one. The owner accepted
  both. If mypy proves too strong, dropping `disallow_untyped_calls` removes about 20% of its new findings.
- **No room for an outside API quirk.** With ceiling 0, a quirk must be explained in a name, a message or the README.
  The owner decided this.
- **Findings caused by another file.** A changed signature in `bay/model.py` can add mypy errors in an untouched
  `bay/dispatch.py`. They are new, correctly; the `stopped` text names the file of each.
- **`test_improve_golden`.** New files and longer `_run_code` or guard functions can move the audit golden of the
  kit. Run it after each build step, and keep each new function under 30 decisions.
- **The guard is not a sandbox.** mypy runs the plugins of the config it is given. The guard pins that config to
  the protected file, but a builder that can run `python3 tests/run.py` already runs arbitrary code (the risk 0020
  states). This change adds no new way out.
- **Delivery base `HEAD`.** A builder told to commit leaves nothing for the check to see, as the proposal states.
- **Two tool versions on one machine** (as here). The version probe makes the difference visible, and agents and
  the step both go through `python3 -I -m`.

## Cost against the ceilings

Measured after the script on a scratch copy; "after hand pass" adds what the hand pass is expected to add back.
Every added line is at most 120 characters and is not packed.

| Measure | Ceiling now | After slice 0 (script) | After hand pass | Items 1-4 | End | Exception |
|---|---|---|---|---|---|---|
| `bay_lines` | 9760 | 9074 | about 9125 | +57 (+89 with G) | about 9182 (9214) | none |
| `kit_python_lines` | 5165 | 4880 | about 4880 | +172 (+80 with G) | about 5052 (4960) | none |
| `long_lines` | 182 | 156 | at most 145 | 0 | at most 145 | none |
| `tests` | 462 | 462 | 462 | +1 | 463 | **463** |
| `comment_lines` | new | 0 | 0 | 0 | 0 | none (base lacks it) |
| `cli_commands`, `schemas`, `framework_folders`, `top_level_folders` | 16, 16, 2, 7 | same | same | 0 | same | none |

- **`bay_lines`.** The hand pass adds back `USAGE` in `bay/cli.py` (+38) and the five lambdas that become a `def`
  (+5). Names and messages that take over a reason add a few lines in guard and ledger (four small helpers, about
  +8) and remove others.
  - Items 1 to 4 are +57: dispatch +16 (`_invoke_all`, `_merge`, the connector name in the error, `_run_code` −6),
    guard +19 (two constants, `_lint_command` 13, the call site), limits +19 (imports, `comment_lines`, the parse
    error, `MEASURES` and the count entry), model +3. G adds +32.
  - The end is some 580 lines under today's ceiling.
- **`kit_python_lines`.** python_check.py about 125 and comments_check.py about 47; with G about 90 and 30, while
  improve-detect's pipeline.py loses about 40. The component tests do not count here (limits.py:41).
- **`long_lines`.** The 156 includes 11 cut docstring lines over 120 in `bay/` and the kit; the hand pass shortens
  them.
- **The release** runs `./bay.sh check --limits --write` once. It writes the real, lower counts, and the ratchet
  keeps them.

## Docs: the word cuts (budget 3000, `len(text.split())`)

Measured today: DESIGN.md 2997 and INTERFACES.md 2998. Each cut was checked to occur exactly once. Slice 0 adds no
words to either: every security reason it removes is already stated there, or goes to a name, a message or a
README.

**DESIGN.md**, which adds about 40 words (the `standards` step next to `deadcode` and `limits` at :153-166, and the
rule in one sentence). Cut 50:
- the use-shim sentence in Dispatcher (:101-102, 21 words; B-9 and INTERFACES §7 state it);
- "`bay status` lists unfinished work ... it closes nothing." in Run log (:108, 16 words; INTERFACES §8 states it);
- ", named like the proposal," (5) and "It is skipped when the plan file exists." (8) in the Plan bullet (:155-157; the
  playbook states both).

**INTERFACES.md**, which adds about 70 words (`standards.check/v1` in §10, several connectors for a code step in §3).
Cut 76:
- the `bay show reclaim` / `bay show close` parenthetical in §7 (:198-199, 27 words; the README command table
  has both);
- "The loader in `bay/model.py` maps kind to manifest file name ..." in Components (:54-56, 16 words);
- "and a leftover top-level `modes/` ... folder" (:63-64, 12 net; a 0010 migration remnant);
- the `bay show <mode> --resolved` bullet in §1 (:82, 15 words; README :118 has it);
- in §3 (:128), "beyond read-only version control, `./bay.sh check` and `python3 tests/run.py`" becomes "beyond
  `READ_ONLY_CLIS` (`bay/model.py`)", which saves 6 words.

**README.md** gains the requirements clause from guard.py (about 10 words) and the checks a change passes (DOD-13).
It has no word budget.

## Release 3.2.0

As in the proposal:
- `bay/__init__.py` goes to 3.2.0.
- The CHANGELOG entry has an Upgrading note: `pip install -r requirements-dev.txt`, then `./bay.sh build`, because
  the agent files list the new clis. It also says that 3.2.0 removed every comment in the kit, so open branches
  should rebase.
- `./bay.sh check --limits --write --base origin/main --proposal docs/proposals/0011-standards.md` runs once. The
  `comment_lines: 0` line already exists by then; `--write` lowers `bay_lines`, `kit_python_lines` and `long_lines`.
- The tag, push and `gh release create` commands are printed for the owner.

## Appendix: the slice 0 script

As run for the measurement. It is kept out of the repository; the builder copies it into the scratchpad. It has
comments of its own nowhere, so it follows the rule it applies.

```python
"""Slice 0: remove every comment token and cut every docstring to its first line, in place."""
from __future__ import annotations

import ast
import io
import json
import sys
import tokenize
from pathlib import Path

DOC_OWNERS = (ast.Module, ast.ClassDef, ast.FunctionDef, ast.AsyncFunctionDef)


def comment_tokens(text: str) -> list[tokenize.TokenInfo]:
    tokens = tokenize.generate_tokens(io.StringIO(text).readline)
    found = [tok for tok in tokens if tok.type == tokenize.COMMENT]
    return [tok for tok in found if not (tok.start == (1, 0) and tok.string.startswith("#!"))]


def docstrings(tree: ast.Module) -> list[ast.Constant]:
    found = []
    for node in ast.walk(tree):
        if not isinstance(node, DOC_OWNERS) or not node.body:
            continue
        first = node.body[0]
        if isinstance(first, ast.Expr) and isinstance(first.value, ast.Constant):
            if isinstance(first.value.value, str):
                found.append(first.value)
    return found


def one_line(doc: ast.Constant, lines: list[str]) -> tuple[str, bool]:
    source = lines[doc.lineno - 1]
    opening = source[doc.col_offset:]
    prefix = opening[: len(opening) - len(opening.lstrip("rRbBuU"))]
    quote = opening[len(prefix): len(prefix) + 3]
    body = [opening[len(prefix) + 3:]] + lines[doc.lineno: doc.end_lineno]
    text = [line.strip() for line in body if line.strip() and line.strip() != quote]
    first = text[0].removesuffix(quote).rstrip() if text else ""
    complete = first.endswith((".", ":", "?", "!", ")")) or len(text) == 1
    indent = source[: doc.col_offset]
    return f"{indent}{prefix}{quote}{first}{quote}", complete


def strip(text: str) -> tuple[str, dict]:
    lines = io.StringIO(text).readlines()
    drop: set[int] = set()
    report = {"comments": 0, "full_line": 0, "inline": 0, "noqa": [], "type_ignore": [],
              "docstrings_cut": 0, "docstring_lines_removed": 0, "docstrings_to_reword": []}
    for tok in reversed(comment_tokens(text)):
        row, col = tok.start
        report["comments"] += 1
        if "noqa" in tok.string:
            report["noqa"].append((row, tok.string))
        if "type: ignore" in tok.string:
            report["type_ignore"].append((row, tok.string))
        line = lines[row - 1]
        if line[:col].strip():
            report["inline"] += 1
            ending = line[len(line.rstrip("\r\n")):]
            lines[row - 1] = line[:col].rstrip() + ending
        else:
            report["full_line"] += 1
            drop.add(row - 1)
    for doc in docstrings(ast.parse(text)):
        if doc.end_lineno == doc.lineno:
            continue
        if lines[doc.lineno - 1][doc.col_offset:].lstrip("rRbBuU")[:3] not in ('"""', "'''"):
            report["docstrings_to_reword"].append(doc.lineno)
            continue
        replacement, complete = one_line(doc, lines)
        ending = lines[doc.end_lineno - 1][len(lines[doc.end_lineno - 1].rstrip("\r\n")):]
        tail = lines[doc.end_lineno - 1].rstrip("\r\n")
        tail = tail[tail.rfind(replacement[-3:]) + 3:]
        lines[doc.lineno - 1] = replacement + tail + ending
        drop.update(range(doc.lineno, doc.end_lineno))
        report["docstrings_cut"] += 1
        report["docstring_lines_removed"] += doc.end_lineno - doc.lineno
        if not complete or len(replacement) > 120:
            report["docstrings_to_reword"].append(doc.lineno)
    return keep_blank_runs(lines, drop), report


def keep_blank_runs(lines: list[str], drop: set[int]) -> str:
    """A gap of blank and dropped lines keeps its longest stretch of blanks, so no gap grows."""
    out: list[str] = []
    gap: list[int] = []
    for index, line in enumerate(lines + ["end\n"]):
        if index in drop or not line.strip():
            gap.append(index)
            continue
        if gap and out:
            out.extend(lines[i] for i in longest_blank_stretch(gap, drop))
        gap = []
        out.append(line)
    return "".join(out[:-1])


def longest_blank_stretch(gap: list[int], drop: set[int]) -> list[int]:
    stretches: list[list[int]] = [[]]
    for index in gap:
        if index in drop:
            stretches.append([])
        else:
            stretches[-1].append(index)
    return max(stretches, key=len)


def without_docstrings(text: str) -> str:
    tree = ast.parse(text)
    for doc in docstrings(tree):
        doc.value = ""
    return ast.dump(tree)


def main(paths: list[str]) -> None:
    totals: dict[str, dict] = {}
    for name in paths:
        path = Path(name)
        before = path.read_text(encoding="utf-8")
        after, report = strip(before)
        if without_docstrings(before) != without_docstrings(after):
            raise SystemExit(f"{name}: the code changed, not only comments and docstrings")
        path.write_text(after, encoding="utf-8")
        report["lines_removed"] = before.count("\n") - after.count("\n")
        totals[name] = report
    json.dump(totals, sys.stdout, indent=1)


if __name__ == "__main__":
    main(sys.argv[1:])
```
