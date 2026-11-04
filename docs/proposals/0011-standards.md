---
# Approval is recorded in the ledger by `bay approve`; this file grants nothing. Design only: nothing is changed before the gate. Scope chosen by the owner in chat on 2026-11-04 ("Core only"): slices 1, 3, 5 and 6 of the old draft; slice 2 (improve-detect split) and slice 4 (unslop) are dropped. Every line cited was read on feat/standards at 3.1.0 (main 8c395b0). The ruff and mypy finding counts were measured by the coordinator (see Measured and not measured).
id: "0011"
status: draft
touches:
  - { path: bay/, reason: "slice 0: every # comment removed and every docstring cut to one line (owner decision 2026-11-04)" }
  - { path: adapters/, reason: "slice 0: the same" }
  - { path: components/, reason: "slice 0: the same, in every component and its tests; items 2 to 4 add components/python and components/comments" }
  - { path: tests/, reason: "slice 0: the same" }
  - { path: conftest.py, reason: "slice 0: tests/conftest.py moves to the root (git mv) so test files need no sys.path lines (the E402 fix); owned in framework/kernel.yaml (plan step)" }
  - { path: tests/conftest.py, reason: "slice 0: moved to the root" }
  - { path: requirements-dev.txt, reason: "item 2: pinned ruff and mypy, dev only" }
  - { path: components/tools/interfaces/standards.check.v1.yaml, reason: "NEW item 1: the interface, one endpoint `change { base }` returning new, existing, stopped, warnings (the shape of improve.detect/v1.change)" }
  - { path: bay/model.py, reason: "item 1: a code step may bind several connectors (line 1337 demands exactly one) and Step.connector becomes a list; item 2: READ_ONLY_CLIS (line 62) gains `ruff check` and `mypy`" }
  - { path: bay/dispatch.py, reason: "item 1: _run_code (line 524) runs every bound connector and merges the results; the status read (line 438) takes the first" }
  - { path: bay/guard.py, reason: "item 2: a fixed flag list for `ruff check` and `mypy`, in the style of GIT_PATH_FLAGS (line 68), so neither can fix, write reports or run an interpreter" }
  - { path: bay/limits.py, reason: "item 3: the measure comment_lines (MEASURES line 19; count line 46), counted by a function the comments connector also imports" }
  - { path: components/python/component.yaml, reason: "NEW item 2: the component manifest" }
  - { path: components/python/ruff.toml, reason: "NEW item 2: line length 120, the rule selection; passed with --config, so the repo root gets no tool config" }
  - { path: components/python/mypy.ini, reason: "NEW item 2: mypy --strict settings; passed with --config-file" }
  - { path: components/python/README.md, reason: "NEW item 2: what the component checks, how to run it by hand, the pinned versions" }
  - { path: components/python/connectors/python-check/connector.yaml, reason: "NEW item 2: implements standards.check/v1" }
  - { path: components/python/connectors/python-check/python_check.py, reason: "NEW item 2: runs ruff and mypy on the working tree and on the merge-base export; reports only what is new" }
  - { path: components/python/tests/test_python_check.py, reason: "NEW item 2: the test that fails on main (new tests: 1)" }
  - { path: components/comments/component.yaml, reason: "NEW item 3: the component manifest" }
  - { path: components/comments/README.md, reason: "NEW item 3: the comments rule in full; the one place the text lives" }
  - { path: components/comments/connectors/comments-check/connector.yaml, reason: "NEW item 3: implements standards.check/v1" }
  - { path: components/comments/connectors/comments-check/comments_check.py, reason: "NEW item 3: reports each file whose comment and docstring lines rose above the merge-base" }
  - { path: components/comments/tests/test_comments_check.py, reason: "NEW item 3: the test that fails on main (new tests: 1)" }
  - { path: requirements-dev.txt, reason: "NEW item 2: ruff, mypy and two stub packages, pinned; dev only, runtime requirements.txt is unchanged" }
  - { path: components/tools/envs/workspace.yaml, reason: "item 4: binds standards.check/v1 to [python-check, comments-check]; the read clis gain `ruff check` and `mypy` (line 10)" }
  - { path: components/forge/envs/local-authoring.yaml, reason: "item 4: the same two bindings (lines 17 and 10-14); the coordinator env that runs forge.extend's code steps" }
  - { path: components/forge/envs/framework-dev.yaml, reason: "item 4: the builder's clis gain `ruff check` and `mypy` (line 15); the write list (lines 24-33) gains components/python and components/comments, which lint keeps in step with kernel.yaml" }
  - { path: components/forge/mode.yaml, reason: "item 4: needs gains standards.check/v1 (line 47); a `standards` step after `limits` (line 42), before review; deadcode and limits stay as they are" }
  - { path: components/forge/features/extend/playbook.md, reason: "item 4: the step list and two DoD items, DOD-17 (no new standards finding) and DOD-18 (comments follow the rule); the old draft's numbers 16 and 17 are taken (lines 38-39)" }
  - { path: components/delivery/mode.yaml, reason: "item 4: needs gains standards.check/v1 (line 31); a `standards` step after `implement` (line 29)" }
  - { path: components/delivery/features/build/playbook.md, reason: "item 4: the step list (lines 9-12) and two DoD items, DOD-5 and DOD-6" }
  - { path: framework/roles/builder.yaml, reason: "item 4: the prompt (lines 12-24) states the comments rule in one sentence and names ruff check and mypy among the checks; the reviewer role is not edited, it checks the DoD items" }
  - { path: framework/kernel.yaml, reason: "item 4: components/python and components/comments are protected paths (line 5), python-check and comments-check protected connectors (line 24), requirements-dev.txt is owned (line 38); without this a local-authoring agent could edit the rules it is judged by" }
  - { path: framework/limits.yaml, reason: "release step: the new measure comment_lines and the ceilings written down to the real counts" }
  - { path: tests/test_dispatch.py, reason: "item 1: the new mechanism test; no_deadcode (line 208) also stubs standards.check/v1 for the two forge.extend tests (lines 219, 246)" }
  - { path: tests/test_resolver.py, reason: "item 1: line 220 asserts `.connector == corpus-store`; it asserts the one-element list" }
  - { path: components/improve/connectors/improve-detect/tests/test_deadcode_check.py, reason: "item 4: test_forge_extend_runs_deadcode_between_implement_and_review (line 247) expects limits directly before review (line 253); it expects standards between them" }
  - { path: tests/test_limits.py, reason: "item 3: test_limits_count_the_ceiling_the_ratchet_and_the_exception also counts comment_lines" }
  - { path: tests/test_guard_matrix.py, reason: "item 2: named deltas for the clis of the units that gain ruff check and mypy; the golden files are not edited" }
  - { path: tests/test_boundaries.py, reason: "item 2: test_n3_worktree_add_paths_and_no_writes_without_write_tools (line 523) also asserts the ruff and mypy flag refusals" }
  - { path: tests/test_roles.py, reason: "item 2: the lint message at line 224 spells READ_ONLY_CLIS and names the two new clis" }
  - { path: README.md, reason: "DOD-13: the checks a change passes" }
  - { path: docs/DESIGN.md, reason: "DOD-13: the standards step and the comments rule; paid for in the same file" }
  - { path: docs/INTERFACES.md, reason: "DOD-13: standards.check/v1 and a code step with several connectors; paid for in the same file" }
  - { path: bay/__init__.py, reason: "release step: version 3.2.0" }
  - { path: CHANGELOG.md, reason: "release step: entry, with an Upgrading note (pip install -r requirements-dev.txt; run ./bay.sh build)" }
exceptions:
  - { measure: tests, to: 463, reason: "462 is the ceiling and the count. Two tests are added (the python checker, the comments checker) and the several-connectors test is merged into an existing forge.extend test (plan step), so +1. bay_lines and kit_python_lines need no exception: slice 0 removes more lines than items 1 to 4 add (owner decisions after the plan step)." }
---

# 0011: Standards as components (core)

## Summary

Today nothing checks the style of the Python an agent writes. `forge.extend` runs two code checks after the builder, `deadcode` and `limits` (`components/forge/mode.yaml:41-42`), and the only style rule is the size measure `long_lines` (`bay/limits.py:54`). This proposal adds one more code check, `standards`, that runs the Python style tools and a comments counter on the change and blocks only on findings that are new against the merge-base of `origin/main`, so the findings already in the tree block nothing and no repository-wide reformat is needed.

It does four things, the owner's "Core only" scope of 2026-11-04. (1) A new interface `standards.check/v1` and a code step that may bind several providers and merges their results. (2) The `python` component: `ruff check` and `mypy --strict`, pinned in a new dev-only `requirements-dev.txt`, line length 120, run as subprocesses with list arguments and a timeout; builders get `ruff check` and `mypy` as commands so they can check before the step does, and reviewers can re-run them. (3) The `comments` component: the owner's comments rule, a checker that blocks a file whose comment and docstring lines rise above the merge-base, and a new size measure `comment_lines`. (4) The wiring: `standards` in `forge.extend` and `delivery.build`, the builder prompt states the comments rule, and the reviewer checks it through two new DoD items.

Out: the improve-detect split (old slice 2) and `unslop` (old slice 4). `deadcode` and `limits` stay exactly as they are; `standards` is added next to them and replaces nothing. I also left out the old draft's skill group `standards:*`: the comments rule is one sentence in the builder prompt and the full text sits in the comments README, which needs no loader change (decision 5 below).

The release is 3.2.0: a new step that can block a call is new default behaviour. No contract breaks (`agentbay/v4` stays). The proposal touches 40 files, has one exception (`tests` to 463; slice 0 lowers `bay_lines` and `kit_python_lines`, see the owner decisions after the plan step) and touches sensitive paths (`bay/dispatch.py`, `bay/guard.py`, `framework/kernel.yaml`), so forge.extend's plan step runs. Costs and open questions are in the last three sections; the owner decisions to read first are 1 to 3 under Open decisions.

## Measured and not measured

Re-measured on 3.1.0 with the commands I am allowed (`./bay.sh check --limits`, which passes with all 8 measures within their ceilings; reads of the files). The ceilings in `framework/limits.yaml:1-8` are also the counts, as 0020 left them.

| Measure | Value now | Source |
|---|---|---|
| `bay_lines` | 9760 | ceiling = count (`framework/limits.yaml:1`, 0020) |
| `kit_python_lines` | 5165 | same (`:2`) |
| `tests` | 462 | same (`:7`) |
| `long_lines` | 182 | same (`:8`), counted at `bay/limits.py:54` |
| full-line `#` comments | at least 96 in `bay/`, 25 in `adapters/` | search, per file; docstring lines not counted |
| `noqa` markers | 44 in 29 `.py` files | search |

**Measured by the coordinator on 2026-11-04 (feat/standards at 3.1.0), with the installed ruff 0.17.3 and mypy 2.4.1.** The old draft's figures (2279 ruff findings, 638 mypy errors, 63 unformatted files; ruff 0.16.9, mypy 2.3.1, older tree) are withdrawn.

- ruff, selection `E,F,W,B`, line length 120, `--isolated --no-cache`: 173 findings in `bay/` and `adapters/` (E501 140, E702 18, B007 4, E731 3, B904 3, B905 3, E701 1, F401 1); 369 with `components/` added. About 2 seconds.
- mypy `--strict --ignore-missing-imports`: 635 errors in 27 of 30 files of `bay/` (about 5 seconds); `adapters/claude-code` alone reports 646, because it follows its imports into `bay/`.
- Not settled by this run: the modules in folders with a hyphen (`components/mail-briefing`, `components/improve/connectors/improve-detect`), which are not valid package names; the plan step decides the mypy scope (open decision 8). The timeouts below (120 s ruff, 300 s mypy) are far above the measured times and may be lowered.

All these findings exist today, so under item 1 they are `existing` and block nothing.

## Item 1: a `standards` step, new findings only (slice 1)

**Today.** A code step runs one endpoint of one interface through exactly one connector: `model.py:1337-1340` ends in a gap, "code steps need exactly one connector", and keeps `conns[0]` in `Step.connector` (`:492`); `dispatch.py:524-541` runs that one connector. The only check of the kind "new against the base" is the dead-code check, `improve.detect/v1.change` (`components/improve/interfaces/improve.detect.v1.yaml:51-75`, `components/improve/connectors/improve-detect/pipeline.py:226-276`): it audits the tree and the merge-base export, compares findings as a multiset of fingerprints, returns `new`, `existing`, `stopped`, and a non-empty `stopped` ends the code step blocked (`dispatch.py:549-553`). It knows dead code and nothing else.

**Change.** A new interface `standards.check/v1` (in `components/tools/interfaces/`, protected already) with one endpoint, `change { base }`, effects `[read]`, and the same output as `improve.detect/v1.change`: `new` (array of findings `{file, line, rule, message}`), `existing` (integer), `stopped`, `warnings`. A finding never carries source text. A provider is a connector that implements it; an env binds a list: `standards.check/v1: [python-check, comments-check]`. `_code_step` accepts one or more connectors and stores them all; `_run_code` calls each in order and merges: `new` lists concatenate, `existing` adds, `warnings` concatenate, `stopped` messages join with "; ". One provider failing (an exception) fails the step with its name, as today; it is never read as "no findings". With one connector the merge is the identity, so no other step changes.

Findings are compared as a multiset keyed by file, rule and message, never by line number, so adding a line above an old finding makes nothing new; a renamed file keeps its findings (`git diff -M`, as `_renames` does at `pipeline.py:221`). Rejected: a reformat of the whole tree (a diff of dozens of files that breaks every open branch); a file of tolerated findings (it rots).

**Test that fails on main.** New `test_a_code_step_runs_every_bound_provider_and_merges` in `tests/test_dispatch.py`: two fixture connectors implement `standards.check/v1`, one returns one new finding, the other none; the step result has the finding, `stopped` is set, the call ends `blocked`; with both clean the call goes on. On main the resolver reports "code steps need exactly one connector". `tests/test_resolver.py:220` is edited for the list, and `no_deadcode` (`tests/test_dispatch.py:208`) also stubs `standards.check/v1`, because the checkout copy those tests use is not a git repo.

## Item 2: the `python` component and the guard (slice 3)

**Today.** `requirements.txt:1-2` holds the two runtime dependencies. There is no ruff or mypy configuration, no dev requirements and no gate; `# noqa` appears 44 times. The commands builders and reviewers may run are fixed per env: `./bay.sh check` and `python3 tests/run.py` under `workspace.read/v1` (`components/tools/envs/workspace.yaml:10`, `components/forge/envs/local-authoring.yaml:17`), the same two among the builder's write clis in `framework-dev` (`:15`). A read-only role keeps only `READ_ONLY_CLIS` (`bay/model.py:62`); the guard checks the arguments of an approved command only for the control plane and, for git, with the flag list `GIT_PATH_FLAGS` (`bay/guard.py:68`, `_git_mv_rm` at `:485-499`).

**Change.** `components/python/` holds the connector `python-check`, `ruff.toml` (line length 120; starting rule selection `E`, `F`, `W`, `B`, confirmed with `ruff rule` on 0.17.3 before anything is enabled) and `mypy.ini` (`strict = True`). Both files are passed with `--config` and `--config-file`, so the repo root gets no tool config. `requirements-dev.txt` pins `ruff==0.17.3`, `mypy==2.4.1`, `types-PyYAML` and `types-jsonschema` (the stub versions are chosen when the file is written; runtime dependencies are unchanged). The connector, for `change { base }`:

1. exports the merge-base tree to a temporary folder (`git archive`, never run), as `pipeline.py` does;
2. runs both tools on the export and on the working tree: `[sys.executable, "-m", "ruff", "check", "--no-cache", "--ignore-noqa", "--output-format", "json", "--config", ...]` and `[sys.executable, "-m", "mypy", "--cache-dir", <temp>, "--config-file", ..., "--output", "json"]`. Every call is a list of arguments, never a shell, with a timeout (constants: 120 s for ruff, 300 s for mypy; unmeasured, see above), and nothing is written in the project. `--ignore-noqa` means a new `# noqa` cannot hide a finding; the 44 existing ones count on both sides and are `existing`. The JSON output flags are to be confirmed on the pinned versions in the plan step;
3. keys findings by file, rule and message, counts the multiset difference and returns `new`, `existing` and `stopped`.

A missing tool ends the step blocked and names `pip install -r requirements-dev.txt`. A timeout, a crash or an unexpected exit code (ruff exits 1 for findings and 2 for an error; mypy 1 for errors and 2 for a crash) is `stopped` with the tool and the reason, never a pass. The tools are not run on a base tree that fails to export.

**How it fits the guard.** There are two separate paths. The check itself runs as a code step in the dispatcher, a subprocess of the connector, and needs no guard rule. The agents are different: a builder that cannot run the tools learns a finding only after the whole implement step, and 0020 closed that kind of gap for tests and `bay check`. So: builders (`framework-dev`, `local-authoring`, `workspace`) get `ruff check` and `mypy` as clis, and reviewers get them through `READ_ONLY_CLIS` so they can re-run the evidence (as 0020 item 2 did for the tests). Both tools can write, fix and run code through flags (`ruff check --fix`, `--add-noqa`, `--output-file`; `mypy --junit-xml`, `--html-report`, `--python-executable`, `--install-types`, and config `plugins` that execute code). The guard therefore takes a fixed list, exactly as `GIT_PATH_FLAGS` does for `git mv` and `git rm`: any word starting with `-` that is not on the list is denied. The list is `--config`, `--config-file`, `--no-cache`, `--ignore-noqa`, `--statistics`, `--output-format`, `--strict`, `--show-error-codes`, compared exactly, so an abbreviation of a long option (argparse accepts them for mypy) never passes. Paths go through the existing control-plane check. A reviewer who runs them writes only `.ruff_cache` and `.mypy_cache`, which the tools ignore in git themselves. Stated risk, the same as 0020's test runner: mypy executes the plugins of the config it is given, so a role that can write a config and run `mypy` runs code outside the guard; the allowed `--config-file` is therefore checked against the one in `components/python/`, which is protected (item 4) and outside `local-authoring`'s write paths.

**Test that fails on main.** New `test_python_check_reports_only_findings_new_against_the_base` in `components/python/tests/test_python_check.py`, with the tool runner injected (the way `pipeline.py:193` takes `self.run`) so the test needs no installed tool and no network: a base with one ruff and one mypy finding and a working tree that keeps both and adds one of each returns `new` of exactly two, `existing` of two and a `stopped`; an unchanged tree returns no `stopped`; a finding that only moved lines is not new; exit code 2 and a timeout return `stopped`; every call it records is a list with a timeout and without `shell`. On main the connector does not exist. The guard half extends two existing tests: the matrix test (named deltas for the clis of the units, deny to pass for `ruff check --config components/python/ruff.toml bay`; deny stays for `ruff check --fix` and `mypy --junit-xml x`) and `test_n3_worktree_add_paths_and_no_writes_without_write_tools`. On main the first rows are deny and the second pass.

## Item 3: the comments rule, its checker and `comment_lines` (slice 5)

**Today.** The builder prompt says nothing about comments (`framework/roles/builder.yaml:12-24`). There are 8 measures (`bay/limits.py:19-20`) and none of them looks at comments; there are at least 96 full-line `#` comments in `bay/` and 25 in `adapters/`, plus docstrings that no search here counted.

**Change.** `components/comments/` carries the owner's rule and the measurement. The rule (owner decision 2026-11-04): no `#` comment at all, and a docstring is at most one line; design text goes in the component README. The text lives in `components/comments/README.md`; the builder prompt carries it as one sentence.

`comment_lines` is a new size measure in `bay/limits.py`: the comment lines (a `#` comment token) plus the docstring lines (the first string statement of a module, class or function) in the Python the other code measures count (`bay/`, `adapters/` and the protected components). The counter is one function in `bay/limits.py`; `comments_check.py` imports it (connectors already import `bay`, `improve_detect.py:2`), so there is one copy. The connector `comments-check` returns one finding per file whose count is above its count at the merge-base (a new file counts from zero; a renamed file from its old name); its message names both counts. The total is held by the ceiling, which starts at the real count when the release step writes it and can only fall. A base without the measure sets its own number (`limits.py:60-61` allows a base with fewer measures), so adding it needs no exception.

The language-neutral `comments:` block in `component.yaml` of the old draft would need a schema change (`schemas/component.schema.json`) for one language. I do not propose it: the counter has a table of comment syntax with one entry, Python, and a second language adds a row (decision 4).

The cleanup of existing comments is in this proposal, as slice 0 (owner decision 2026-11-04); after it the ceiling is 0.

**Test that fails on main.** New `test_comments_check_blocks_a_file_whose_comment_lines_rise` in `components/comments/tests/test_comments_check.py`, on a temporary git repo: a file with 2 comment lines and one docstring line at the base and the same plus one `#` line now is one finding; a file with the same count after a rename is none; a docstring line counts like a comment line; a new file with one docstring line is one finding. `test_limits_count_the_ceiling_the_ratchet_and_the_exception` (`tests/test_limits.py`) also expects `comment_lines`. On main neither the connector nor the measure exists.

## Item 4: wiring (slice 6)

**Today.** `forge.extend` is propose, proposal, plan, approve, implement, deadcode, limits, review, release (`components/forge/mode.yaml:36-44`); its DoD ends with DOD-14 (deadcode), DOD-15 (limits) and DOD-16 (release) (`components/forge/features/extend/playbook.md:37-39`). `delivery.build` has one step, `implement`, and four DoD items (`components/delivery/mode.yaml:28-29`, `components/delivery/features/build/playbook.md:9-18`). A code step runs in the coordinator's env, or without a coordinator in the first role env that binds the interface (`bay/model.py:966-978`): `local-authoring` for forge, `workspace` for delivery.

**Change.**
- `forge.extend`: `- { id: standards, run: standards.check/v1.change, with: { base: "origin/main" } }` between `limits` and `review`; `needs` gains `standards.check/v1`. Two DoD items: DOD-17 (must) "The `standards` step reports no new finding" and DOD-18 (must) "No `#` comment and no docstring longer than one line in what the change adds." The reviewer already gives one verdict per DoD id, so the reviewer role is not edited; the second is the judgement the counter cannot make. A failed `standards` step ends the call blocked, like `deadcode`, and the fix is a new `implement` round with `proposal` set.
- `delivery.build`: `- { id: standards, run: standards.check/v1.change, with: { base: "HEAD" } }` after `implement`, `needs` gains the interface, and DOD-5 and DOD-6 say the same two things. The base is `HEAD`, not `origin/main`: a delivery project need not have a remote, and the builder is told not to commit (`builder.yaml:29`). Stated gap: if a task tells the builder to commit, the check sees only what is still uncommitted.
- Bindings: `workspace` and `local-authoring` bind `standards.check/v1: [python-check, comments-check]` and add `ruff check` and `mypy` to their read clis; `framework-dev` adds them to the builder's clis. `framework/kernel.yaml` protects `components/python`, `components/comments`, the two connector names, and owns `requirements-dev.txt`, so the rules agents are judged by are changed only through forge.extend; the two folders are also counted by the code measures, as they should be.
- `framework/roles/builder.yaml`: one sentence for the comments rule, and the checks line names `ruff check` and `mypy` next to the tests.

**Test that fails on main.** `test_forge_extend_runs_deadcode_between_implement_and_review` (`components/improve/connectors/improve-detect/tests/test_deadcode_check.py:247`) is extended: `limits` is followed by `standards`, which is followed by `review`, and the step runs `standards.check/v1.change` through both providers. On main the line `ids.index("limits") + 1 == ids.index("review")` holds and the step is absent. A delivery assertion goes into an existing delivery mode test, so no test is added.

## Does `long_lines` stay?

`long_lines` counts lines over 120 characters in `bay/` and the protected kit code (`bay/limits.py:54`, ceiling 182). Once `ruff` has the same limit (`E501`, line length 120), both would stop a new long line. **Recommendation: keep `long_lines`.** The ruff check blocks only a new finding keyed by file, rule and message; the message of `E501` carries the length, so an old long line that is edited and keeps a new length reads as new while one that is only moved reads as old. It runs only where the step runs and only when the tools are installed, and `--ignore-noqa` aside it depends on a third-party tool's definition of a line. `long_lines` is a ceiling in the kernel, counted the same way on every run of `bay check --limits`, and unlike the base comparison it ratchets: it can only fall from 182 toward zero, which the base comparison never asks for. It costs one line in `limits.py`. Retire it when its count is zero, when the two say the same thing and the second adds nothing.

## Cost against the ceilings

All measures are covered. Estimates are mine until the code is written.

- **`bay_lines` (9760): no exception.** Slice 0 removes about 635 lines (plan step: 9760 to about 9125 after the hand pass); items 1 to 4 add about +57, ending near 9182. Items 1 to 4 alone: (dispatch +16, guard +14, limits +14, model +4). No payer in `bay/` can be named from today's code. Every new line is at most 120 characters and reads as ordinary code (the owner's rule, 0020 rounds 2 and 3).
- **`kit_python_lines` (5165): no exception.** Slice 0 removes about 285 lines (to about 4880); items 1 to 4 add about (`python_check.py` about 130, `comments_check.py` about 45). The component tests do not count here.
- **`tests` (462): over by 3, so the exception.** Three tests are added, six existing ones are extended (the resolver line, the deadcode step order, the limits count, the matrix, the n3 guard test, the roles message). Payers: none; the plan step tries to merge before the build and the exception is an upper bound (decision 7).
- **`long_lines` (182): unchanged**, every new line is at most 120 characters.
- **`comment_lines`: new.** Starts at the real count written by the release step; the base has no such measure, so no exception.
- **`cli_commands` (16), `schemas` (16), `framework_folders` (2), `top_level_folders` (7): unchanged.** No `add_parser`, no schema file, no folder under `framework/` or at the top; `requirements-dev.txt` is a file.
- **Docs.** DESIGN and INTERFACES are at their word budget (3000 each) after 0020. This change adds about 40 words to DESIGN (the step, the rule) and 70 to INTERFACES (`standards.check/v1`, the several-connector code step). I could not count words with the commands I may use, so the cuts that pay for them are named by the plan step, in the same files.

## Compatibility and safety impact

- **Contracts.** A new interface and one more step; no existing shape changes. The change in `_code_step` is a relaxation (several connectors allowed) that no existing mode uses, so no manifest, schema or `agentbay/v4` change. 3.2.0 because the new step can block a `forge.extend` or `delivery.build` call that passed before. DOD-11 holds.
- **After the upgrade** run `pip install -r requirements-dev.txt` and `./bay.sh build` (the generated agent files list `ruff check` and `mypy`). A machine without the tools gets a blocked step that names the command, not a silent pass. A user's own modes are not affected unless they bind the interface.
- **Safety.** No secret is read or shown; a finding holds file, line, rule and message, never source text. The tools run as subprocesses of the connector with list arguments, no shell, a timeout, no network and no write in the project (`--no-cache`, a temporary mypy cache). They run on the user's own files and on a temporary export of the base, whose code is never imported or run; ruff does not execute project code. mypy executes the plugins named in the config it is given, and the config is the protected one. Agents get the commands only behind the flag list; the risk that a role able to write and run any Python can escape the guard is the one 0020 already states for the test runner and does not grow here.
- **Extensibility (DOD-4).** Another language is one folder with one connector and its name in the two binding lists; no mode, role or playbook is edited. The dead-code check keeps its own interface until a later proposal moves it.
- **Out of scope.** The improve-detect split, `unslop`, a skill group `standards:*`, the cleanup of existing findings and comments, a repository-wide reformat.

## Owner decisions

1. **Scope, 2026-11-04, chat: "Core only".** Slices 1 (the `standards.check/v1` step), 3 (the python component), 5 (the comments rule, checker and `comment_lines`) and 6 (the wiring in `forge.extend` and `delivery.build`). Slice 2 (improve-detect split) and slice 4 (unslop) are dropped. Taken from the step plan's goal; the old draft's other recommendations are not decided and are listed below.

## Owner decisions after the plan step (2026-11-04; these replace anything above that disagrees)

The plan step replayed PRs #20 to #27 and found the per-file comment counter would have blocked 6 of 8. The owner then decided, in chat:

1. **No comments.** No `#` comment in Python anywhere the checker looks (a shebang line is not a comment). A docstring is at most one line. This holds in `bay/`, `adapters/`, `components/` and every `tests/` folder alike.
2. **The existing comments go in this proposal**, as a new first slice, **slice 0 (cleanup)**: delete every `#` comment and shorten every multi-line docstring to one line, in all four places. Measured on 3.1.0: 505 `#` comments and 257 multi-line docstrings (about 900 extra lines) outside tests, 872 comments and 84 multi-line docstrings in all tests (`tests/` and the component and adapter tests; corrected by the plan step). 43 of the comments are `# noqa` markers: each is removed by fixing what it hides (or, where ruff's rule does not apply, by leaving that rule out of the selection), never by keeping the marker. Where a comment held a security or crash-safety reason, the reason moves into a name, an error message or the component README. The slice is mechanical and goes in batches, with the full suite run after each.
3. **The checker is absolute after slice 0.** `comment_lines` (`#` comments plus docstring lines after the first) has ceiling 0, and any new comment or multi-line docstring is a finding. The rule a reviewer judged ("a reason the code cannot express") no longer exists; the builder role states the rule in one sentence and the reviewer's DoD item checks it.
4. **mypy stays `--strict`** (the plan step measured a median of 5.5 new errors per change; the owner accepts the cost).
5. **The plan step's amendments are taken:** `requirements-dev.txt` in framework-dev's write list; `components/python` and `components/comments` under `owns:` in `framework/kernel.yaml`; the plan's security fixes (configs read from the merge-base export, `python3 -I -m` for every tool call, the guard requiring the protected config paths, `# mypy:` and `type: ignore` reported as findings, `standards.check/v1` dispatcherOnly).
6. **Exceptions:** slice 0 removes roughly 870 lines from `bay/` and several hundred from the kit, more than items 1 to 4 add, so the `bay_lines` and `kit_python_lines` exceptions are no longer needed; the release writes the lower ceilings. `tests` takes the plan's merge: 463.

## Open decisions, with my recommendation

1. **Builders and reviewers get `ruff check` and `mypy` as commands (item 2).** Cost: the flag list in `guard.py`, +14 `bay_lines`. The alternative is the code step only, where a builder learns a finding after the whole implement step. Recommended: give the commands; it is what 0020 did for tests, and the cost is in the exception.
2. **The delivery base is `HEAD`, not `origin/main` (item 4).** Recommended: `HEAD`, so a project without a remote works. The alternative blocks `delivery.build` there with the fetch message.
3. **Release number: 3.2.0.** Recommended. A patch release would understate a step that can block a call.
4. **No `comments:` block in `component.yaml`.** One language does not justify a schema change. Recommended: the table of syntax inside the counter. The old draft's block is the alternative.
5. **No skill group `standards:*`.** Recommended: the rule is one sentence in the builder prompt, two DoD items and the comments README. Skills for the python rules can come with a later proposal.
6. **Starting rule selection `E`, `F`, `W`, `B`, line length 120, `mypy --strict`.** Unvalidated: the old draft's brief is not in the repo; the counts are now measured (173 ruff findings in bay/ and adapters/, mostly E501). Recommended: the plan step fixes the selection with those counts and every code is checked with `ruff rule` on 0.17.3; a rule that produces more than a few new findings per ordinary change is left out.
7. **Tests: exception to 465, or merge.** Recommended: the exception stands as the upper bound and the plan step tries to merge three tests the change makes redundant before it is used; otherwise the three behaviours go untested, which I would not accept.
8. **mypy scope.** Hyphenated folders may not be nameable as modules. Recommended: whole project if the first real run is clean; otherwise `bay/` (a valid package) and the Python the run can name, with the rest listed in the README. This cannot be decided without the measurement above.
9. **`long_lines` stays** (previous section). Recommended: keep.

## Prevention

A check, never prose: the style of Python and the growth of comments are blocked by the `standards` step (DOD-17), the growth of the total by `comment_lines` in `bay check --limits` (DOD-15), and the reviewer confirms there is none (DOD-18).

| Root cause | Check that blocks it | Item |
|---|---|---|
| Python style and typing drift | `python-check` provider in `standards` | 1, 2, 4 |
| Comments that restate code | `comments-check` provider and `comment_lines` | 3, 4 |

## Release 3.2.0

`bay/__init__.py` to 3.2.0; a CHANGELOG entry with an Upgrading note; `./bay.sh check --limits --write --base origin/main --proposal docs/proposals/0011-standards.md` once, to write the real counts including the first `comment_lines`; the release step prints the tag, push and `gh release create` commands for the owner.
