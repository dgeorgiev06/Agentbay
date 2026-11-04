# Plan 0011: standards as components (core)

## Summary

This revision follows the proposal's "Owner decisions on reuse (2026-11-04)" (9aa7e8f on feat/standards, main
8c395b0, 3.1.0). Slice 0 and its measurements are unchanged. Items 1 to 4 are re-planned. This plan implements
nothing.

- **The base is the call's start commit.** Today a call records no commit when it starts. The state dict is built
  at `bay/dispatch.py:70`, and the only commit it records is `head`, at the review step (`:393`). Steps substitute
  `with:` values through `workflows.substitute` (`bay/workflows.py:292`, called at `bay/dispatch.py:529`), which
  knows `$in`, `$steps` and `$config`. The plan adds `state["base"]` at `:70` and a `$call` namespace to
  `substitute`. A call that `replaces` another keeps the other's base (decision M).
- **The dispatcher owns the comparison.** A new module `bay/standards.py` holds the export, the copy of the
  working tree, the rename map, the multiset comparison, the tool runner (`python3 -I -m`, list arguments, no
  shell, a timeout) and the version probe. The git helpers move there from improve-detect through
  `bay/boundary.py` (old decision G, now required). A checker only runs its tools on one folder and parses them.
- **The interface needs one more field.** `findings { root }` alone cannot keep the change's own config out: the
  run on the working tree must read the base's config, and a mypy `.py` plugin resolves next to its config file.
  So the endpoint is `findings { root, configRoot }`, and the dispatcher always passes the base export as
  `configRoot`. This is an amendment (decision I).
- **The `comments:` block comes back**, inside a new optional `spec.language` block of
  `schemas/component.schema.json`. Its `spec` has `additionalProperties: false` (`:24`), so the schema must change.
  The change is additive; the number of schema files stays 16.
- **The lint rule** is `lint_standards_steps` in `bay/lint.py`, next to `lint_owner_only` (`:913`), called from
  `run()` after it (`:727`). With the checkers bound and no steps yet, it flags `forge.create`, `forge.extend` and
  `delivery.build`. The proposal's wiring alone still leaves two: `forge.create` has no standards step, and
  `forge.extend`'s builder writes `bay/__init__.py` in `release`, after review. The wiring adds a step after
  `fill` and a second one after `release` (decision H, an amendment).
- **Project config** comes from the base export (`configRoot`), read by the checker. The security fixes hold
  because the dispatcher, not the checker, decides where `configRoot` points.
- **Costs.** From slice 0's counts (`bay_lines` about 9125, `kit_python_lines` about 4880, `tests` 463), items 1 to
  4 add about +206 to `bay_lines` and +65 to `kit_python_lines`. That is about 9331 and 4945, both under today's
  9760 and 5165. The proposal's "+45" understates `bay/` and overstates the kit (amendment 4). `tests` stays 463.

Amendments the proposal still needs are under "Before the gate".

## What I checked

This revision is a reading of feat/standards at 9aa7e8f, with the line numbers cited. I ran no tool for it. The
measurements below are from the earlier plan run and still hold, because 9aa7e8f changes only the proposal. All
runs used `git archive` exports in the scratchpad. For slice 0 that was an export of 161a0ac, turned into a scratch
git repo so `bay check --limits` could count it. For the replay, scratch worktrees of f3cb194 (since removed). The
tools were `python3 -I -m ruff` 0.17.3 and `python3 -I -m mypy` 2.4.1, with a scratch config standing in for
`components/python/`: ruff `line-length = 120`, `select = ["E", "F", "W", "B"]`; mypy `strict = True`,
`exclude = (^|/)tests/`.

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

  - Outside the tests this matches the coordinator's 505 comments and 257 docstrings.
  - After: 0 comment tokens (shebangs kept) and 0 docstring lines past the first. The suite gave 575 passed,
    0 failed, before and after. `bay check --limits` gave `bay_lines` 9074, `kit_python_lines` 4880 and
    `long_lines` 156 (script alone).
  - ruff on the four folders went from 643 findings to 561. E501 fell by 109 (long comments gone). The removed
    markers surfaced 13 E402, 11 E731 and 3 F401, which slice 0 fixes (list below).
  - 23 cut docstring lines are over 120 characters (11 of them in `bay/` and the kit), and 272 docstrings end
    mid-sentence. The script lists both, per file, for the hand pass.
- **The counts in the proposal reproduce.** ruff on `bay adapters`: 173 (180 with `--ignore-noqa`). With
  `components`: 369 (387 with `--ignore-noqa`), and 670 for the whole tree, tests included. mypy on `bay`: 635 errors,
  all `error`, none `note` (type-arg 243, no-untyped-def 201, no-untyped-call 100).
- **The `ruff` and `mypy` on PATH are not the pinned ones.** `ruff --version` prints 0.16.9 and `mypy --version`
  prints 2.3.1 (uv tool installs in `/root/.local/bin`). `python3 -m ruff` is 0.17.3 and `python3 -m mypy` is 2.4.1.
  This decides how agents call them (decision A).
- **Planted config and plugins (the security question).** I planted `ruff.toml` and `pyproject.toml` (with
  `select = ["ALL"]`) at the root and in a changed folder, and a `mypy.ini` whose `plugins =` names a file that
  writes a marker when imported.
  - ruff with `--config <file>` ignored every planted file. Without `--config` it picked them up.
  - mypy with `--config-file <file>` ignored both planted configs, and the plugin did not run. **Without
    `--config-file`, mypy loaded the planted `mypy.ini` and ran the plugin** (the marker file appeared).
  - `--ignore-noqa` also overrides a file-level `# ruff: noqa` and the range suppressions `# ruff: disable[...]` /
    `# ruff: enable[...]`.
  - **An inline `# mypy: ignore-errors` in a new file hid its error.** mypy has no flag that turns inline config off.
  - `python3 -m ruff` run from a folder holding a planted `ruff.py` printed the planted module's output: `-m` puts
    the current folder first on `sys.path`. `python3 -I -m ruff` ran the real ruff.
  - ruff's `--config` also takes an inline TOML pair. `--config "cache-dir='<any path>'"` made ruff 0.17.3 create
    a cache folder at that path. `output-file` is refused as an inline key.
- **Nothing is written in the project** by `ruff check --no-cache` or by mypy with `--cache-dir` outside the
  project.
- **Run times** (wall time on this container, one tree): `git archive` and extraction 0.06 to 0.32 s (1.2 s cold);
  ruff 0.07 to 0.12 s; mypy over `-p bay -p adapters -p components` 2.7 to 3.7 s cold, 1.9 s for the second tree on
  a shared temporary cache. A whole `standards` step, two trees and both tools, takes about 7 s. The copy of the
  working tree that this revision adds is not measured; it copies what `git ls-files -co` lists, about the size of
  the export.
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
  mostly `no-untyped-def`, then `type-arg` and `no-untyped-call`.

**Read for this revision (9aa7e8f):**
- Call start: `Dispatcher.call` (`bay/dispatch.py:56-72`) builds the state with `callId`, `target`, `input`,
  `steps`, `cursor`, `status`, `checks`, `cost` and `t0`. No commit. `replaces` closes only an open call
  (`close`, `:74-80`, refuses any other status).
- Substitution: `_run_code` passes `step.with_`, `state["input"]`, `state["steps"]` and `mode.config` to
  `workflows.substitute`, whose `val` maps the heads `in`, `steps` and `config` (`bay/workflows.py:313`). An unknown
  head is dropped. `_check_dollars` (`:200`) runs only for project workflow stages, so a feature step may carry a
  new head without a lint change.
- Code step: `_code_step` (`bay/model.py:1309-1347`) demands exactly one connector (`:1337`) and stores it in
  `Step.connector` (`:492`). `model.SOURCE_IFACE` (`:1275`) is the precedent for an interface name the code knows.
- Component manifest: `schemas/component.schema.json` allows only `version` and `needs` under `spec`.
- Lint: per-step checks over YAML live in `lint_owner_only` (`bay/lint.py:913-923`); `run()` calls the checks in
  order (`:691-734`). Role access is `write` only for `builder` and `lead` (`framework/roles/*.yaml:10`).
- Tests that pass a builder step and so reach the new step: `tests/test_dispatch.py:233`, `:251`, `:265`, `:471`;
  `components/improve/tests/test_improve.py:229` (`forge.create`);
  `components/improve/connectors/improve-detect/tests/test_deadcode_check.py:241`.

## Slice 0: remove the comments and cut the docstrings

Unchanged by the reuse decisions.

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
  measure. `components/python/ruff.toml` gets `per-file-ignores` for E402 on these three files, spelled
  `**/bay/cli.py` and so on, because ruff anchors the globs at the config file's folder.
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
Run ruff on everything in the tree, tests included.

**8. mypy scope.** Passing the folders as paths fails: `mypy components` stops with exit 2, "No parent module --
cannot perform relative import", in `improve-detect/pipeline.py`. Passing them as packages works:
`-p bay -p adapters -p components` with `exclude = (^|/)tests/` checks all 155 non-test files and gives 1292 errors
(bay 635, components 634, adapters 23) in 3.2 s. **Recommendation:** one `-p` per top-level folder of the tree that
holds Python, plus top-level `.py` files as paths, tests excluded in `mypy.ini`. A folder name that is not a valid
module name cannot be a `-p` name; it is skipped with a warning. A project config that sets `files` or `packages`
gets no targets on the command line, so its own choice holds. mypy stays `--strict` (owner decision 4).

**JSON output on the pinned versions.**
- ruff 0.17.3: `--output-format json` gives one JSON array. Each item has `code`, `message`, `filename` (an
  **absolute** path, so the checker makes it relative to `root`) and `location.row`. A syntax error is an item with
  code `invalid-syntax`.
- mypy 2.4.1: `--output json` gives JSON lines with `file` (relative to the working folder), `line`, `code` (null
  for some blocking errors), `message` and `severity`. Keep only `severity == "error"`.
- Exit codes: ruff 0 clean, 1 findings, 2 error; mypy 0 clean, 1 errors, 2 blocking error.
  `python3 -I -m <missing module>` also exits 1, so the probe runs `<tool> --version` first.

**Timeouts.** `RUFF_TIMEOUT = 60`, `MYPY_TIMEOUT = 120`, `PROBE_TIMEOUT = 30`, and the export keeps the 120 s of
`pipeline.py:181`. That is over 30 times the measured time.

**7. Tests: merge instead of +3** (taken by the owner: 463). The reuse decisions move the comparison out of
python-check, so the tests move with it:
- The python-check test drives `bay.standards.check` with the real python-check connector and an injected tool
  runner. It carries the comparison cases that were python-check's before.
- The several-checkers test with stub checkers goes into the forge.extend test in `test_deadcode_check.py`, and
  `test_forge_extend_runs_deadcode_between_implement_and_review` (`:247`) is folded into it.
- The lint rule's cases extend `test_forge_extend_review_cannot_be_disabled_or_weakened` (`tests/test_lint.py:270`).

So: tests 462 + 2 new (python-check, comments-check) - 1 merged = 463. Slice 0 adds no test.

## Decisions the plan adds (each with a recommendation)

**A. Who may run the tools, and with what (guard).** Taken by the owner (decision 5). Unchanged by reuse.
- The agent clis are `python3 -I -m ruff check` and `python3 -I -m mypy`: the same interpreter, version and module
  the step runs, and `-I` stops a planted `ruff.py` or `mypy.py`.
- The guard requires `--config <kit>/components/python/ruff.toml` and
  `--config-file <kit>/components/python/mypy.ini`, compared after `norm`. The kit path comes from `self.kit`.
- The other flags are an exact list: `--no-cache`, `--ignore-noqa`, `--statistics`, `--strict`,
  `--show-error-codes`. No `--output-format`, no `-O`, no `--cache-dir`. Paths go through `_words` as today.
- Without the required config the command is denied. That stops the planted-plugin run and the inline `cache-dir`
  write shown above.
- Stated limit, new with project config: in a project that has its own config, an agent's own run uses the kit
  default, so it can see findings the step does not. The step is the one that counts. Allowing the project's
  config to agents would hand a writer its own mypy plugin, so I do not recommend it.

**B. Which config the step uses.** Replaced by owner decisions 2 and 5; see item 2. The base export is always the
config source, for both runs.

**C. The comments count.** Updated for decision 3.
- The count is one function per kind of syntax. Python's is `limits.comment_lines(text)`: `#` comment tokens (a
  shebang excepted) plus the docstring lines after the first, with `tokenize` and `ast`. The measure and
  comments-check both call it, so they never disagree on Python.
- comments-check returns **one finding per comment line**: rule `comment`, message `a # comment` or `a docstring
  line after the first` (never the text). The dispatcher's multiset comparison then gives exactly "this file has
  more comment lines than at the base". In the kit every base count is 0 after slice 0, so any comment or second
  docstring line is new: the absolute rule. A delivery project with comments of its own is not made to clean files
  it only touched.
- The `comment_lines` measure counts **every** Python file the rule covers: `bay/`, `adapters/`, all of
  `components/` and every `tests/` folder. Its ceiling 0 then holds the whole rule in `bay check --limits`, tests
  included. The cost: an extension a user adds to their own kit checkout fails `bay check --limits` while it has a
  comment. I recommend the full scope, because the owner's rule names all of `components/`.

**D. Tool presence and version.** Moved into the dispatcher's step (decision 2).
- A language component declares `tools: [{module, version}]` and `install` in its `language` block.
- Before the two runs, `bay/standards.py` runs `[sys.executable, "-I", "-m", <module>, "--version"]` for each tool
  of each bound checker's component.
- A missing module (exit 1 with "No module named" on stderr) ends the step blocked with the component's `install`
  text (`pip install -r requirements-dev.txt`).
- A version other than the pin is a warning, not a stop: both trees run on the same version.
- Stated limit: the probe knows only Python modules. A language whose tool is not a Python module adds a key to the
  block in its own proposal.

**E. mypy inline config and `# type: ignore`.** Taken. python-check reports each `# mypy:` line and each
`type: ignore` comment as a finding of its own (rules `mypy-inline` and `type-ignore`). In the kit, comments-check
already blocks them. In a delivery project, where comments-check compares counts per file, E still blocks a new one
when the same change drops another comment.

**F. `standards.check/v1` is `dispatcherOnly: true`,** like `improve.detect/v1`. Taken.

**G. Share the git helpers.** Now required, no longer optional. The dispatcher needs `_export`
(`pipeline.py:175-189`), `_merge_base` (`:197-209`) and `_renames` (`:221-224`). They move to `bay/boundary.py`
(which already has `git` and `show`), as `export(repo, rev, dest)`, `merge_base(repo, base)` and
`renames(repo, sha)`. improve-detect's `pipeline.py` imports them. One copy of the `filter="data"` extraction.

**H. Two more standards steps (consequence of decision 4).** The lint rule asks for a standards step after the last
step of every writing role. Two shipped features need more than the proposal's wiring:
- `forge.create`: the builder's `fill` (env `local-authoring`, writes `components`) has no step after it. Add
  `- { id: standards, run: standards.check/v1.findings, with: { base: "$call.base" } }` after `fill`, `needs`
  is shared by the mode, and a DoD item in `components/forge/features/create/playbook.md`.
- `forge.extend`: the builder's last step is `release`, after review, and it writes `bay/__init__.py`. Add a second
  step `release-standards` after `release`. It costs about 7 s per call and blocks only a release that adds a
  finding. The first `standards` step stays between `limits` and `review`, so the reviewer sees its result.

The alternative is a rule that ignores steps after review. That is weaker than the owner's words, so I do not
recommend it.

**I. `findings { root, configRoot }` (an amendment to decision 2).** `root` is the folder to check. `configRoot`
is the folder the checker reads every config from. The dispatcher passes the base export as `configRoot` on both
runs. With `{ root }` alone the working-tree run would read the change's config, or the dispatcher would have to
copy the base's config into the tree copy. The second still lets the change supply the plugin: mypy resolves a
`.py` plugin next to the config file. A checker that has no config (comments-check) ignores `configRoot`.

**J. How the dispatcher recognises the step.** `model.STANDARDS_IFACE = "standards.check/v1"`, next to
`SOURCE_IFACE` (`bay/model.py:1275`). A code step that runs it may bind several connectors; any other code step
keeps "exactly one connector". `_run_code` hands such a step to `standards.check` instead of `_invoke`. The
alternative, an interface flag such as `comparesBase: true`, costs a schema key and docs words for one user; I do
not recommend it now.

**K. The no-comments setting.** In a project other than the kit, `connectors: { comments-check: { rule: off } }`
in `agentbay.config.yaml` turns the rule off. comments-check reads it from `<configRoot>/agentbay.config.yaml`, so
the base decides and the change cannot. The connector's own config schema declares `rule: on | off` (default on), so
`bay check` validates the working-tree value through the existing `connectors.<name>` rule. In the kit the setting
is ignored. No change to `schemas/config.schema.json`.

**L. Where the comment syntax is read.** comments-check reads `spec.language` from every
`<kit>/components/*/component.yaml` with `yaml.safe_load`. A language component that a project defines in its own
`components/` is not read; a new language ships in the kit. In the kit, `components/python/component.yaml` is a
protected path, so an edit of it is gated and reviewed like the checker itself.

**M. A replacing call keeps the base.** `forge.extend` is restarted with `replaces`. Today `replaces` closes only an
open call, and the new call would take the later HEAD as its base, so the first round's findings would look
existing. Change: a call that `replaces` another takes that call's `base`, and `replaces` may also name a call that
ended `blocked`, `failed` or `partial`; that call is left as it is, not closed. This is about +3 lines in
`Dispatcher.call` and one assertion in the merged test. Without it the base protects only a single call.

## Before the gate (amendments to the proposal, R-12)

1. **The interface shape.** Owner decision 2 says `findings { root }`. This plan needs
   `findings { root, configRoot }` (decision I). The owner should confirm.
2. **Touches.**
   - Add: `bay/standards.py` (new: the step), `bay/workflows.py` (the `$call` namespace), `bay/lint.py` (the rule),
     `bay/boundary.py` (the git helpers), `components/improve/connectors/improve-detect/pipeline.py` (imports them),
     `schemas/component.schema.json` (the `language` block), `schemas/mode.schema.json` (the `with` description
     names `$call.base`), `components/forge/features/create/playbook.md` (decision H),
     `components/improve/tests/test_improve.py` (the stub for `forge.create`), `tests/test_lint.py` and
     `tests/helpers.py` (the shared stub).
   - Reword: `standards.check.v1.yaml` (`findings`, not `change { base }`), `python_check.py` ("runs ruff and mypy
     on one folder"), `comments_check.py` ("one finding per comment line"), `bay/model.py` (several connectors only
     for the standards interface), `bay/dispatch.py` (the start commit, the hand-off to `bay/standards.py`).
3. **Wiring (decision H).** `forge.create` gets a standards step after `fill`, and `forge.extend` a second one after
   `release`. Without them the lint rule fails the shipped kit.
4. **Cost.** The reuse paragraph says "+45 `bay_lines`" and that the python checker loses about the same. The plan
   counts +206 in `bay/` and +65 in the kit for items 1 to 4 (the old plan: +57 and +172). Both end under today's
   ceilings, so no exception changes.
5. **Stale text above the reuse decisions.** Item 1 still describes `change { base }` and a merge in `_run_code`.
   Item 3 and open decision 4 say there is no `comments:` block; decision 3 brings it back. Open decision 2 (delivery
   base `HEAD`) is replaced by `$call.base`. "Out of scope" still lists "the cleanup of existing findings and
   comments", which slice 0 now does. The decisions section says it replaces them, but a reader meets the old text
   first.
6. **Upgrading note.** After 3.2.0, a user's own mode with a writing role fails `bay check` until its feature has a
   standards step, `needs: standards.check/v1`, and a code env that binds the checkers. The CHANGELOG must say so.
7. **Project config limits.** mypy reads only `mypy.ini` from the project root; `.mypy.ini`, `setup.cfg` and
   `[tool.mypy]` are not read. ruff reads `ruff.toml`, then `pyproject.toml` with a `[tool.ruff]` table. Both as the
   owner's decision 5 names them; the README says so.

Done in the build without an amendment (all inside touched files):
- the guard rules of A, the inline-config findings (E), `dispatcherOnly` (F);
- `requirements-dev.txt` in framework-dev's write list, and `components/python` and `components/comments` under
  `owns:` (owner decision 5 of the earlier round);
- `comment_lines: 0` written into `framework/limits.yaml` in the commit that adds the measure. `limits._ceilings`
  requires every name in `MEASURES` to be in the file, and the base has no such entry, so no exception is needed.

## Build order

Each step is one commit. `python3 tests/run.py` and `./bay.sh check --limits` stay green after each.

1. **Slice 0, batches 0.1 to 0.7** (table in slice 0). They land first, right after the gate, so open branches
   rebase once onto a tree without comments.
2. **The start commit.** `state["base"]` in `Dispatcher.call`, the `$call` namespace in `workflows.substitute`, and
   `replaces` keeping the base (M). Nothing reads `$call.base` yet.
3. **The git helpers (G).** `export`, `merge_base` and `renames` move to `bay/boundary.py`; improve-detect imports
   them. The deadcode tests stay green unchanged.
4. **The step (item 1).** `standards.check.v1.yaml` with `findings`, `model.STANDARDS_IFACE`, `Step.connectors`,
   the resolver, `bay/standards.py`, and the hand-off in `_run_code`. The test is the merged forge.extend test with
   stub checkers; no mode runs the step yet.
5. **The counter (item 3, part one).** `limits.comment_lines`, the measure over all four places,
   `comment_lines: 0` in `framework/limits.yaml`, and `test_limits` extended. After slice 0, because the count must
   already be 0; before the connectors, because comments-check imports it.
6. **The `language` block and the python component (item 2).** `schemas/component.schema.json`,
   `components/python/` (with the E402 `per-file-ignores`), `requirements-dev.txt`, python-check and its test. The
   schema and the first `language` block go in the same commit, so lint never sees one without the other.
7. **comments-check (item 3, part two):** `components/comments/` and its test.
8. **The guard, then the clis.** First the `guard.py` rule and its test rows (deny for every case), then
   `READ_ONLY_CLIS` and the env clis, with the matrix deltas. The clis are never granted without the flag check, at
   any commit.
9. **The wiring and the lint rule (item 4), one commit.** Bindings, the four standards steps, `needs`, DoD items,
   the builder prompt, kernel.yaml (protected, `owns:`, owned files), the framework-dev write list,
   `lint_standards_steps` and its test, and the stub in the tests that pass a builder step. The rule and the steps
   land together: the rule alone fails the kit, and the steps alone are unguarded.
10. **Docs:** README, DESIGN and INTERFACES, with the cuts below.
11. **Release:** 3.2.0, the CHANGELOG with the Upgrading note, and `./bay.sh check --limits --write ...` once, which
    writes the lower `bay_lines`, `kit_python_lines` and `long_lines`.

From step 2 on, the code these steps add has no comments and only one-line docstrings: from step 5 the limits step
would block it anyway.

## Item 1: the call's start commit and the dispatcher's standards step

**The start commit (decision 1).**
- `bay/dispatch.py:70`: the state gains `"base"`, the output of `boundary.git(self.project, "rev-parse", "HEAD")`,
  or `None` when the project is not a git repository or has no commit (the `suppress(RuntimeError, OSError)` that
  `:392` uses for `head`). `head` stays as it is: it is the review-time commit, a different thing.
- `:66-69` (`replaces`): the new call takes the replaced call's `base` (decision M).
- `bay/workflows.py:292`: `substitute(template, inp, steps, settings, call=None)`; `val` maps the head `call` to
  `call or {}`. `bay/dispatch.py:529` passes `call={"base": state.get("base")}`. The other callers are unchanged.
- A step that names `$call.base` in a call whose base is `None` gets no `base`. The standards step then ends
  blocked: "no base commit: the project was not a git repository with a commit when call <id> started". A call
  saved before 3.2.0 has no `base` and gets the same message.

**The step (decision 2).**
- `bay/model.py`: `STANDARDS_IFACE`; `Step.connector` (`:492`) becomes `connectors: list[str]`. In `_code_step`
  (`:1336-1341`) an empty list is the gap "binds no connector for {iface}"; more than one is a gap unless the
  interface is `STANDARDS_IFACE`; `check_connector` runs for each name. A standards step's `with` may hold only
  `base` (a gap otherwise).
- `bay/dispatch.py`: `_fresh` (`:438`) uses `step.connectors[0]`. `_run_code` (`:535`) calls
  `standards.check(...)` when `iface == model.STANDARDS_IFACE`, with an `invoke(name, args)` that wraps
  `self._invoke`, so each checker's input and output are still validated (`:563`, `:572`). The returned
  `{new, existing, stopped, warnings}` goes through the existing `stopped` handling (`:549-553`), so a new finding
  ends the call blocked. `run_capability` keeps "exactly one connector".
- `bay/standards.py` (new):
  1. `check(project, base, checkers, invoke)`. It resolves `base` with `boundary.merge_base` (which refuses a value
     that starts with `-`) and takes the renames with `boundary.renames`.
  2. It probes the tools of each checker's component (D).
  3. In one `tempfile.TemporaryDirectory(prefix="agentbay-standards-")`, removed on exit and on errors, it exports
     the base with `boundary.export` (`git archive`, `filter="data"`) and copies the working tree.
  4. It calls every checker twice: `{root: <base>, configRoot: <base>}` and `{root: <tree>, configRoot: <base>}`.
  5. It compares the two lists as a multiset keyed by `(file, rule, message)`, base paths mapped through the
     renames. A checker's own `stopped` (a timeout, a crash) is joined into the step's `stopped`, never read as a
     pass.
  - `copy_tree(project, dest)` copies the regular files `git ls-files -co --exclude-standard -z` lists; symlinks
    and other special files are skipped and counted in a warning. Both trees then hold the same kind of content,
    and no tool ever runs inside the project.
  - `run_module(module, args, cwd, timeout)` is the one runner: `[sys.executable, "-I", "-m", module, *args]`, a
    list, no shell, `capture_output`, the timeout. Checkers import it, so `-I` lives in one place.

```python
def compare(before: list[dict], now: list[dict], renames: dict[str, str]) -> tuple[list[dict], int]:
    """The findings in `now` that `before` lacks, counted as a multiset by (file, rule, message)."""
    seen = Counter((renames.get(row["file"], row["file"]), row["rule"], row["message"]) for row in before)
    new = []
    for row in now:
        key = (row["file"], row["rule"], row["message"])
        if seen[key] > 0:
            seen[key] -= 1
        else:
            new.append(row)
    return new, len(now) - len(new)
```

The key keeps E501's message, which carries the line length ("Line too long (133 > 120)"). A long line that is
moved stays existing; a long line that is edited and is still long counts as new. A finding never carries source
text.

Tests:
- The merged forge.extend test in `test_deadcode_check.py` (decision 7): two stub checkers, one returns a finding
  only on the tree, the other none. Both are called twice, with the base export as `configRoot` both times; the
  call is `blocked` before review and the reason names the finding; `$call.base` equals the HEAD at call start; a
  call that `replaces` it keeps that base.
- `tests/test_resolver.py:220` asserts `.connectors == ["corpus-store"]`.
- `no_deadcode` (`tests/test_dispatch.py:208`) becomes a shared `no_code_checks(d)` in `tests/helpers.py`. It stubs
  `improve.detect/v1` as today and `standards.check` with no finding. The checkout copies in those tests are not git
  repositories, so without it the standards step ends blocked. `test_improve.py:229` (`forge.create`) uses it too.

## Item 2: the python component, project config and the guard

Files:
- `schemas/component.schema.json`: `spec.language`, optional:
  - `files`: globs of the form `*.<ext>`, the files the language's checkers cover;
  - `comments`: either `python` (the `tokenize` count) or `{ line: [...], block: [[open, close], ...] }`;
  - `tools`: `[{ module, version }]`, and `install`: the text a missing tool names (D).
- `components/python/component.yaml`: `files: ["*.py"]`, `comments: python`, the two tools at their pins, and
  `install: pip install -r requirements-dev.txt`.
- `components/python/README.md`, `ruff.toml` and `mypy.ini`:
  - `ruff.toml`: `line-length = 120`, `[lint] select = ["E", "F", "W", "B"]`, no `preview`, and
    `per-file-ignores` E402 for `**/bay/cli.py`, `**/bay/hook.py` and `**/bay/use_shim.py`.
  - `mypy.ini`: `strict = True`, `exclude = (^|/)tests/`.
- `connectors/python-check/connector.yaml` and `python_check.py`, about 45 lines: pick the configs, build two
  argument lists, call `standards.run_module`, parse the JSON, add the E findings.
- `requirements-dev.txt`: `ruff==0.17.3`, `mypy==2.4.1`, and `types-PyYAML` and `types-jsonschema` pinned when the
  file is written.

**Unmeasured: the stubs.** Every mypy count here was measured without the stubs, with `ignore_missing_imports`.
With the stubs installed the base count changes but the comparison does not. `mypy.ini` should not set
`ignore_missing_imports`; a machine without the stubs gets `import-untyped` on both trees, so it shows as existing.

`python_check.findings(root, configRoot)`:
1. Picks the configs (decision 5), only from `configRoot`:
   - when the project is not the kit: `<configRoot>/ruff.toml`, else `<configRoot>/pyproject.toml` if it has a
     `[tool.ruff]` table (read with `tomllib`); and `<configRoot>/mypy.ini`;
   - otherwise, and for each tool without a project file: `<configRoot>/components/python/<file>` when the project
     is the kit, else `<kit>/components/python/<file>`.
2. Runs ruff, then mypy, with `cwd=root`, through `standards.run_module`. ruff gets `check --no-cache
   --ignore-noqa --output-format json --config <file> .`, so a project's `exclude` holds. mypy gets
   `--config-file <file> --cache-dir <a temp folder> --output json` and the targets of decision 8.
3. Adds the `mypy-inline` and `type-ignore` findings (E).
4. Returns `{findings, warnings}`, and `stopped` for a timeout, exit 2, or output that is not JSON.

**How the security fixes hold for a project's config.**
- **Configs from the base.** Every config comes from `configRoot`, and only the dispatcher sets it, to the base
  export. A config the change adds or edits is not read until it has landed. The checker never looks in `root` for
  a config.
- **A plugin is the base's or none.** The config is passed by absolute path inside the base export. mypy resolves
  a `.py` plugin next to that file, so it loads the base's plugin file, never the change's. A plugin named as a
  module is imported through `sys.path`, which under `-I` holds the standard library and site-packages only, never
  a project folder. A planted plugin in the base is the project's own choice (owner decision 5). To verify on
  2.4.1 in build step 6: a module plugin that exists only in the project is not importable (expect exit 2, which is
  `stopped`).
- **`python3 -I -m`** for every tool call, through the one runner. A planted `ruff.py` or `mypy.py` in either tree
  is not imported.
- **Nothing written in the project.** Both runs happen in the temporary folder, not in the project. `--no-cache`
  overrides a project's `cache-dir`, and `--cache-dir` on the command line overrides mypy's `cache_dir`. A project
  config that sets ruff's `output-file` would send the JSON to a file; the checker then reads no JSON array on
  stdout and returns `stopped`, never an empty pass. mypy report options in a project's `mypy.ini` write under the
  temporary tree and go with it.
- **`filter="data"` and the temporary folder** belong to `bay/standards.py` and `boundary.export`, for every
  checker and every project.
- **What a project config can still do.** It can choose its rules, excludes and plugins at the base. It cannot
  change them in the change under review, and it cannot point a plugin at a file the change supplies.

Guard (`bay/guard.py`, decision A), unchanged by reuse:
- `LINT_FLAGS`, plus a map from each tool to its required config flag and file.
- `_lint_command`, called from `_prefixed_command` when the prefix is `python3 -I -m ruff check` or
  `python3 -I -m mypy`.
- It denies a word starting with `-` that is not on the list or the required flag. It denies a missing or different
  config path. It denies `--config=...` (the `=` form is not on the list).

Tests:
- New `test_python_findings_are_blocked_only_when_new_against_the_call_start`
  (`components/python/tests/test_python_check.py`). It runs `bay.standards.check` on a temporary git repository
  with the real python-check and `run_module` replaced by a recorder that returns canned ruff and mypy JSON.
  - A tree that keeps the base's two findings and adds one of each gives `new` of two and `existing` of two.
  - A finding that only moved lines is not new; a renamed file keeps its findings.
  - A project `mypy.ini` in the base is used for both runs; one that only the working tree has is not.
  - A missing module stops the step with the pip command; a version mismatch is a warning.
  - Exit 2, a timeout, and empty stdout from ruff each give `stopped`.
  - A new `# mypy: ignore-errors` is one finding.
  - Every recorded call has `-I`, a timeout, no `shell` and a `cwd` inside the temporary folder, and the temporary
    folder is gone afterwards.
- `tests/test_guard_matrix.py`: named deltas for every unit that gains the clis, including the project matrix
  (`test_guard_matrix_for_a_project_with_the_kit_outside`).
  - Rows that become pass: `python3 -I -m ruff check --config <kit>/components/python/ruff.toml bay`, and the same
    for mypy with `--config-file`.
  - Rows that stay deny: `--fix`, `--add-noqa`, `-o x`, `--config "cache-dir='x'"`, mypy without `--config-file`,
    `--config-file mypy.ini`, `--junit-xml x`, `--python-executable x`, and the abbreviation `--conf ...`.
- `tests/test_boundaries.py:523` asserts the same refusals for a write-less unit.
- `tests/test_roles.py:224` gets the new `READ_ONLY_CLIS` text.

## Item 3: one comments checker for every language

Files:
- `bay/limits.py`: `comment_rows(text) -> list[tuple[int, str]]` and `comment_lines(text) -> int`, its length
  (decision C's Python count), `"comment_lines"` in `MEASURES`, and its entry in `count()` over the four places.
  - A file that does not parse raises `RuntimeError` naming the file, never a silent 0.
  - Imports: `ast`, `io`, `tokenize`.
- `components/comments/component.yaml` (no `language` block: it covers every language), `README.md` (the rule, the
  one place it lives), `connectors/comments-check/connector.yaml` (with the config schema `rule: on | off`) and
  `comments_check.py`, about 60 lines:
  - It reads the syntaxes as decision L says and covers every file under `root` that one of their `files` globs
    matches.
  - For `comments: python` it calls `limits.comment_rows(text)`, the `(line, kind)` list that
    `limits.comment_lines` counts, and returns one finding per row.
  - For `{ line, block }` it uses a small lexer: it skips `"`, `'` and backtick strings, takes a `line` token to the
    end of the line, and takes a `block` pair as one finding per line it spans. No shipped language uses it yet; the
    test covers it with a made-up language.
  - In a project other than the kit, `rule: off` in `<configRoot>/agentbay.config.yaml` returns no findings and a
    warning (decision K).
- `framework/limits.yaml`: `comment_lines: 0` in the commit that adds the measure.

The README states the rule: no `#` comments; a docstring is one line; a reason the code must keep goes in a name,
an error message or the README. A shebang is not a comment; Python held in a string as test data is not code.

Tests:
- New `test_comments_check_blocks_a_file_whose_comment_lines_rise`, through `bay.standards.check` on a temporary git
  repository with only comments-check bound: a new `#` line is one finding; a second docstring line is one finding;
  a one-line docstring is free; a renamed file with the same count is none; a new file with one comment is one
  finding; a made-up `*.c` language with `//` and `/* */` counts its comments and not a `//` inside a string;
  `rule: off` in the base config of a non-kit project gives none, and in the working tree only gives the finding.
- `tests/test_limits.py:27`: `NOW` gains `comment_lines`. `FILES` holds `#`-only lines (`bay/util.py`,
  `components/c/c.py`, and the test file), so the count is non-zero there; a file that does not parse is asserted to
  stop the count.

## Item 4: wiring and the lint rule

Files: as in the proposal's touches, plus the following.
- `components/tools/interfaces/standards.check.v1.yaml`: `dispatcherOnly: true` (F), one endpoint `findings`,
  `in { root, configRoot }` (both strings, required), `out { findings: [{file, line, rule, message}], stopped?,
  warnings? }`, effects `[read]`.
- Steps, each `- { id: <id>, run: standards.check/v1.findings, with: { base: "$call.base" } }`:
  - `forge.create`: `standards` after `fill`;
  - `forge.extend`: `standards` between `limits` and `review`, and `release-standards` after `release`;
  - `delivery.build`: `standards` after `implement`.
  - `needs` of `forge` and `delivery` gains `standards.check/v1`.
- DoD: DOD-17 and DOD-18 (forge.extend), DOD-5 and DOD-6 (delivery.build), and the next free pair in
  `components/forge/features/create/playbook.md`. The wording: "The `standards` step reports no new finding" and
  "No `#` comment and no docstring longer than one line; a reason goes in a name, an error message or the README."
- `framework/kernel.yaml`: `components/python` and `components/comments` are under `protected.paths` **and**
  `owns:`. The connectors python-check and comments-check are protected. `requirements-dev.txt` and the root
  `conftest.py` are owned.
- `components/forge/envs/framework-dev.yaml`: the write list gains `components/python`, `components/comments` and
  `requirements-dev.txt`, and the clis gain the two `python3 -I -m` prefixes.
- `workspace` and `local-authoring` bind `standards.check/v1: [python-check, comments-check]` and gain the two
  prefixes as read clis.
- `framework/roles/builder.yaml`: one sentence for the rule, and the check line names `python3 -I -m ruff check`
  and `python3 -I -m mypy` with their config flags.

**The lint rule (decision 4).** `lint_standards_steps(kit)` in `bay/lint.py`, after `lint_owner_only`
(`:913-923`), called from `run()` right after it (`:727`). About 22 lines.
- Covered files: the union of `language.files` of every component, when some env binds `standards.check/v1`;
  otherwise nothing is covered and the rule is silent.
- A role step writes covered files when its role's `access` is `write` (`kit.docs["Role"]`), and its env
  (`model.role_env`, the same lookup as `lint_role_envs`) has an `fs.write` entry that is a folder (`.` included)
  or a file whose name a covered glob matches.
- For each such role, the feature needs a step that runs `standards.check/v1.findings` after that role's last
  step. The message names the file and line of that step, the feature, the role, and the step line to add.
- Steps that `approve.plans` adds are not in the YAML; each sits before the step it plans, so a standards step
  after that step also follows the planner.

What it flags:

| When | Flagged |
|---|---|
| today (no env binds the interface) | nothing |
| bindings, no step | `forge.create` (`fill`); `forge.extend` (`release`; lead `plan`); `delivery.build` (`implement`) |
| after the proposal's wiring only | `forge.create`; `forge.extend` (builder, `release`) |
| after this plan's wiring (H) | nothing |

The other shipped features have no writing role: improve's analysts, the briefing analysts, delivery's researcher
and every reviewer have `access: read`, and cos, store, todo, sync and prune have no role step.

Tests:
- The merged forge.extend test (decision 7) asserts the order `limits`, `standards`, `review`, `release`,
  `release-standards`.
- `test_forge_extend_review_cannot_be_disabled_or_weakened` (`tests/test_lint.py:270`) is extended and renamed
  `test_forge_extend_review_and_standards_cannot_be_disabled_or_weakened`: removing `release-standards` from
  forge.extend, removing `standards` from `delivery.build`, and moving `forge.create`'s step before `fill` each give
  one problem that names the feature and the role.
- `test_shipped_kit_is_lint_clean` (`:30`) holds the last row of the table.
- The delivery order (`implement`, `standards`, `review`) is asserted inside an existing delivery mode test, so no
  test is added.

## Risks

- **Slice 0 conflicts with every open branch.** It touches 105 of 110 Python files. Mitigation: land it first, in
  its seven commits, right after the gate. Ask the owner to merge or park open branches before. A branch that
  rebases afterwards can run the same script on its own files.
- **A reason lost in the cleanup.** The list in slice 0 covers the five security files and the two entry scripts.
  Other files get the same test in the hand pass. The reviewer of batch 0.1 checks the list line by line against
  the diff.
- **272 docstrings to reword.** This is the bulk of the human work, and a bad one-liner is worse than none. A
  docstring that adds nothing to its function's name may go entirely; that is allowed and also removes a line.
- **The base moves when a call is restarted.** Without decision M, a second `forge.extend` call after a blocked one
  starts at the later HEAD, and the first round's findings look existing. M closes it for `replaces`; a fresh call
  without `replaces` still starts from its own HEAD, which the playbook states.
- **A builder that rebases.** If the branch is rebased onto a newer main during the call, the start commit is no
  longer an ancestor of HEAD. `merge_base` still finds their common ancestor, so findings that landed on main
  between the two count as new. The `stopped` text names the merge-base, so the cause is visible.
- **A user's own writing mode fails `bay check` after the upgrade** (amendment 6). Intended by the owner; the
  CHANGELOG names the three edits.
- **Builder friction (the expected cost).** By the replay, about half of the changes would have needed a fix round
  for mypy --strict (median 5.5 new errors), and every change that adds a comment needs one. The owner accepted
  both. If mypy proves too strong, dropping `disallow_untyped_calls` removes about 20% of its new findings.
- **A second step after release.** `release-standards` can block a call after review passed. The only Python a
  release writes is the version line, so this should never fire; if it does, the release added code it should not.
- **Many comment findings in a project.** One finding per comment line can be thousands of rows in a project that
  has comments. The step's output holds only the new ones; the comparison works on lists in memory, which is fine at
  that size.
- **No room for an outside API quirk.** With ceiling 0, a quirk must be explained in a name, a message or the README.
  The owner decided this.
- **Findings caused by another file.** A changed signature in `bay/model.py` can add mypy errors in an untouched
  `bay/dispatch.py`. They are new, correctly; the `stopped` text names the file of each.
- **`test_improve_golden`.** New files and longer `_run_code`, `lint` or guard functions can move the audit golden
  of the kit. Run it after each build step, and keep each new function under 30 decisions.
- **The guard is not a sandbox.** mypy runs the plugins of the config it is given. The guard pins agents to the
  protected config, and the step reads only the base's, but a builder that can run `python3 tests/run.py` already
  runs arbitrary code (the risk 0020 states). This change adds no new way out.
- **Agents and the step can disagree in a project with its own config** (A, stated limit).
- **Two tool versions on one machine** (as here). The probe makes the difference visible, and agents and the step
  both go through `python3 -I -m`.

## Cost against the ceilings

From slice 0's counts; "Items 1-4" are estimates until the code is written. Every added line is at most 120
characters and is not packed.

| Measure | Ceiling now | After slice 0 (script) | After hand pass | Items 1-4 | End | Exception |
|---|---|---|---|---|---|---|
| `bay_lines` | 9760 | 9074 | about 9125 | about +206 | about 9331 | none |
| `kit_python_lines` | 5165 | 4880 | about 4880 | about +65 | about 4945 | none |
| `long_lines` | 182 | 156 | at most 145 | 0 | at most 145 | none |
| `tests` | 462 | 462 | 462 | +1 | 463 | **463** |
| `comment_lines` | new | 0 | 0 | 0 | 0 | none (base lacks it) |
| `cli_commands`, `schemas`, `framework_folders`, `top_level_folders` | 16, 16, 2, 7 | same | same | 0 | same | none |

- **`bay_lines`.** The hand pass adds back `USAGE` in `bay/cli.py` (+38) and the five lambdas that become a `def`
  (+5). Names and messages that take over a reason add a few lines in guard and ledger (four small helpers, about
  +8) and remove others.
  - Items 1 to 4, about +206: `standards.py` +95 (runner 12, probe 12, copy 14, compare 12, check 30, header and
    constants 15); `boundary.py` +34 (the three git helpers, moved); `guard.py` +19 (two constants, `_lint_command`
    13, the call site); `limits.py` +19 (imports, `comment_lines`, the parse error, `MEASURES` and the count entry);
    `lint.py` +22; `dispatch.py` +9 (start commit 3, `replaces` keeping the base 3, the hand-off 3); `model.py` +6
    (the constant, the list, the `with` check); `workflows.py` +2.
  - The old plan's `_merge` (+18) is gone: the dispatcher no longer merges outputs of several connectors.
  - The end is some 430 lines under today's ceiling.
- **`kit_python_lines`.** python_check.py about 45 (was 125) and comments_check.py about 60 (was 47, now with the
  lexer and the setting); improve-detect's pipeline.py loses about 40 to `bay/boundary.py`. The component tests do
  not count here (limits.py:41).
- **`tests`.** +2 new (python-check, comments-check), −1 merged (the deadcode step-order test). Every other test
  this plan names is an existing one, extended.
- **`long_lines`.** The 156 includes 11 cut docstring lines over 120 in `bay/` and the kit; the hand pass shortens
  them.
- **`schemas`.** The `language` block is a key in an existing file; the count stays 16.
- **The release** runs `./bay.sh check --limits --write` once. It writes the real, lower counts, and the ratchet
  keeps them.

## Docs: the word cuts (budget 3000, `len(text.split())`)

Measured on 161a0ac: DESIGN.md 2997 and INTERFACES.md 2998. Each cut below occurs exactly once at 9aa7e8f. Slice 0
adds no words to either. The counts of the cuts are by hand; the builder re-counts both files with
`len(text.split())` before the docs commit.

**DESIGN.md** adds about 65 words: the step list of `forge.extend` gains `standards` and `release-standards`, and a
**Standards.** bullet next to Dead code and Size (the step compares with the commit the call started from; kit
Python has no `#` comment and one-line docstrings, a project setting elsewhere; a feature whose role writes checked
files needs the step). Cut about 75:
- the use-shim sentence in Dispatcher (:101-102, 21 words; B-9 and INTERFACES §7 state it);
- "Secret values are scanned for and redacted from everything returned or logged." in Dispatcher (:101-102, 12
  words; INTERFACES §9 and the Safety model state it);
- "`bay status` lists unfinished work ... it closes nothing." in Run log (:108, 16 words; INTERFACES §8 states it);
- ", named like the proposal," (5) and "It is skipped when the plan file exists." (8) in the Plan bullet (:155-157; the
  playbook states both);
- "`bay auth` needs the browser on the machine running bay, not a terminal." in Secrets and logins (:135-136, 13
  words; INTERFACES §4 gives the login its `open_browser(url)`, and the mail-briefing playbook says where the
  browser opens).

**INTERFACES.md** adds about 120 words: `$call.base` in §1 (the step sentence), `standards.check/v1` and the
`language` block in §4, and the standards step and the lint rule in §7. Cut about 127:
- the `bay show reclaim` / `bay show close` parenthetical in §7 (:198-199, 27 words; the README command table
  has both);
- "The loader in `bay/model.py` maps kind to manifest file name ..." in Components (:54-56, 16 words);
- "and a leftover top-level `modes/` ... folder" (:63-64, 12 net; a 0010 migration remnant);
- the `bay show <mode> --resolved` bullet in §1 (:82, 15 words; README :118 has it);
- in §3 (:128), "beyond read-only version control, `./bay.sh check` and `python3 tests/run.py`" becomes "beyond
  `READ_ONLY_CLIS` (`bay/model.py`)", which saves 6 words;
- "`bay status --agents` groups runs ... to-do progress and inputs." in §9 (:227-228, 24 words; the README command
  table has both commands);
- "(usage goes to the step's event)" in §7 (:198, 5 words; §9 says any event may carry it);
- "Read the endpoints and fields there." in §10 (:233, 6 words);
- "`items.store/v2` has `add`, `update`, `delete` and `rows`." in §11 (:238, 8 words; the interface file lists
  them);
- "(lowercase letters, digits and hyphens, at most 64)" in §5 (:182, 8 words; lint states it).

**README.md** gains the requirements clause from guard.py (about 10 words), the checks a change passes (DOD-13) and
the project config files the step reads. It has no word budget.

## Release 3.2.0

As in the proposal:
- `bay/__init__.py` goes to 3.2.0.
- The CHANGELOG entry has an Upgrading note: `pip install -r requirements-dev.txt`, then `./bay.sh build`, because
  the agent files list the new clis. It says that 3.2.0 removed every comment in the kit, so open branches should
  rebase, and that a user mode with a writing role needs a standards step, `needs: standards.check/v1` and a code
  env that binds the checkers (amendment 6).
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
