# Plan 0020: agents can check their own work

The proposal as committed in 8645c71 on branch fix/agent-checks (main 3.0.2). Items 1, 2, 3, 5 and 7; item 6 is dropped. This plan implements nothing. Two points stay open for the gate, as the proposal says: improve's reviewer shares env `workspace` (item 2), and the release number (3.1.0).

## What I checked (on a scratch worktree of 8645c71, since removed)

I applied the env and `READ_ONLY_CLIS` edits of items 1 and 2, sketched the code of items 3 and 7, and ran the suite. The numbers below come from that copy, not from estimates.

- **The gap item 7 closes is real.** With only the item 1 env edits (current guard), `git rm bay/guard.py`, `git mv components/a.py bay/b.py`, `git rm -r .`, `git rm ':/bay/guard.py'`, `git rm '*guard.py'`, `git rm CLAUDE.md`, `git rm Makefile` and `git rm .github/workflows/ci.yml` all **pass** for `builder--forge--local-authoring` and `builder--delivery`. Only `.agentbay/x` and `bay.sh` are denied, by the control-plane check in `_words`. With the item 7 sketch, every one of them is denied (see Item 7).
- **`bay check`** with the item 1 and 2 env edits: `✓ lint clean`, `✓ 6 modes, 31 features, 5 roles (18 role units), 10 envs, 13 connectors resolve`. `local-authoring` moves `./bay.sh check` from `workspace.write/v1` to `workspace.read/v1`; lint accepts that.
- **Generated clis** (`./bay.sh build` on the copy): delivery `[./bay.sh check, python3 tests/run.py, git status, git diff, git log, git add, git worktree, git commit, git mv, git rm, git show]`; local-authoring `[./bay.sh check, python3 tests/run.py, git add, git commit, git mv, git rm, git status, git diff, git log, git show]`; `reviewer--forge`, `reviewer--delivery` and `reviewer--improve` `[./bay.sh check, python3 tests/run.py, git status, git diff, git log, git show]`, with `write: []`.
- **Full suite with every sketch in:** `531 passed, 8 failed`. Five of the failures are in the proposal's list. Three are not (see "Before the gate"):
  1. `test_guard_matrix::test_guard_decision_matrix`. Expected; deltas below.
  2. `test_guard_matrix::test_guard_matrix_for_a_project_with_the_kit_outside`. **Not in the proposal**: four `builder--delivery` reasons in `guard-matrix-project.json` quote the clis.
  3. `test_cli_commands::test_note_task_mints_an_id_and_dispatch_and_review_take_the_task_first`. Expected.
  4. `test_cli_commands::test_a_write_verb_must_directly_follow_note_or_show_so_the_ask_rules_match` (the BYPASSES loop). Expected.
  5. `test_ledger::test_bay_plan_records_scrubbed_size_limited_append_only_events` and `test_ledger::test_a_dispatched_agent_is_listed_by_status_without_the_spawn_hook`. Both use the `_dispatch` helper at tests/test_ledger.py:185-186, which the proposal names.
  6. `test_roles::test_a_read_capability_never_gives_read_roles_write_tools_or_paths` (tests/test_roles.py:224). **Not in the proposal**: the lint message quotes `READ_ONLY_CLIS`.
  7. `test_improve_golden::test_improve_golden`. **Not in the proposal**: `complexity` went 8 to 9, because the status listing pushed `cmd_status` from 29 to 33 decisions (threshold 30). The `deadcode` step would block the call for this. The sketch below moves the guard lines out of `cmd_status`. With that, `cmd_status` is at 27 and the golden passes (`2 passed`).
- **This session has no `.agentbay/ledger/guard.seen`.** Hooks are not loaded here, so under item 3 this very plan dispatch would have needed `--unguarded`. That confirms the cloud-session cost the proposal states.

## Build order

Each part is one commit, and the full suite and `./bay.sh check` are green after each one. Item 7 comes before item 1, so `git mv` and `git rm` are never granted without the path check, at any commit.

1. **Item 5** (verdict ids, brief schema). It stands alone and is the smallest.
2. **Item 7** (guard: git mv/rm paths). The tests add `git mv` and `git rm` to a unit's clis, as test_n3 already does for `git worktree`.
3. **Items 1 and 2** (envs, `READ_ONLY_CLIS`, matrix deltas, test_roles text).
4. **Item 3** (dispatch refuses without the guard; cli, cos playbook, adapter line).
5. **Docs** (DESIGN, INTERFACES, with the cuts named below).
6. **Release** (version, CHANGELOG, `./bay.sh check --limits --write`).

## Item 5: verdicts accept C-n; the brief carries the schema

Files: `schemas/data/review.verdict.v1.schema.json:25` (`^(DOD|R|C)-[0-9]+$`), `bay/dispatch.py:706` (`"verdictSchema": model.data_schema(VERDICT)`). No line is added. Nothing reads the old string value: a repo-wide grep for `verdictSchema` finds only line 706.

Test: extend `tests/test_dispatch.py:105`. A verdict with an extra `C-3` item is accepted. The review plan's `verdictSchema` is a dict with `title == "review.verdict/v1"` and `additionalProperties is False`.

Risk to state, without changing it: `_accept_review` (dispatch.py:631-633) halts only on a `fail` whose level is must or must_not, or on severity `blocker`. A `C-n` id has no level in `levels`, so a failed conformance item halts the call only when the reviewer also marks it `blocker`. This is how conformance is judged today, and it stays so. The brief grows by the schema text (about 1.5 KB).

## Item 7: git mv and git rm respect the write paths

File: `bay/guard.py`, inside `_git_command` (after `:463`), plus one helper. `_worktree_add` (`:527-533`) reuses the helper. This is the payer named under bay_lines.

```python
        if words[1] in ("mv", "rm"):        # each path (flag-like ones after `--` too), judged as the file tools would
            cut = words.index("--") if "--" in words else len(words)
            args = [w for w in words[2:cut] if not w.startswith("-")] + words[cut + 1:]
            why = next(((a, w) for a in args if (w := self._git_path_denied(entry, a, cwd))), None)
            return ("deny", f"agentbay: git {words[1]} {why[0]}: {why[1]}") if why else None
        return None

    def _git_path_denied(self, entry, a, cwd) -> str | None:
        """Why the role may not write `a` or a never-written or protected path inside it (`git rm -r .`), or None."""
        if a.startswith(":") or any(c in a for c in "*?[\\"):
            return "git pathspec magic and globs are not allowed; name each path"
        p, held = norm(a, cwd), (*NEVER_DIRS, *NEVER_FILES, *map("/".join, NEVER_SEQS), *self.policy.get("protected", []))
        return next((w for x in [p, *(self.project / h for h in held)] if self.inside(x, p) and (
            w := self.never_write(x) or self._write_denied(entry, x))), None)
```

`_worktree_add` keeps its absolute and outside-the-project test, and replaces `p = norm...`, `why = self.never_write(p) or self._write_denied(entry, p)` and the two-line deny with `why = self._git_path_denied(entry, a, cwd)` and a one-line return. The worktree rows of the matrix do not move (checked on the copy).

The proposal's design checks each argument with `never_write` and `_write_denied`. On its own, that misses five edges, which the sketch closes:

- **A folder** (`git rm -r .`, `git rm -r components/..`, `git rm -r .github`). The folder itself is writable for delivery (`write: ["."]`), but it holds `.agentbay/`, `bay/`, `CLAUDE.md` or `.github/workflows/`. So the helper also judges every never-written or protected path that lies inside the argument.
- **Pathspec magic** (`:/bay/guard.py`, `:(top)...`, `:!x`). Git reads these from the repository root, while `norm` sees a relative `:` folder. Refused.
- **Globs** (`'*guard.py'`, `'bay/*.py'`). Git expands a quoted pathspec itself, and `*` crosses `/`. Refused. So is a backslash, git's glob escape.
- **`--`.** After it, a word that starts with `-` is a path (`git rm -- -x`). It is checked, not skipped as a flag.
- **`framework-dev` changes too.** The proposal says nothing changes for it. In fact, its `git mv` and `git rm` are now denied outside its write paths: `git rm -r components`, `git mv components/x .`, `git rm -r .`. That is correct, but it is a behaviour change for the CHANGELOG. No matrix row has `git mv` or `git rm`, so no matrix row moves.

Edge cases, each a case in the extended `test_n3_worktree_add_paths_and_no_writes_without_write_tools` (tests/test_boundaries.py:523). All were run against the sketch on the copy:

| Case | local-authoring | delivery | framework-dev |
|---|---|---|---|
| `git rm bay/guard.py`, `git rm --cached bay/guard.py` | deny | deny (protected) | pass |
| `git mv components/a.py bay/b.py` (destination) | deny | deny | deny (source outside) |
| `..`: `git rm components/../bay/guard.py` | deny | deny | pass |
| absolute: `git rm <project>/bay/guard.py` | deny | deny | pass |
| quoted: `git rm 'bay/guard.py'`, `git rm b"ay"/guard.py` | deny | deny | pass |
| `--`: `git rm -- bay/guard.py`; `git rm -- -x` | deny; deny | deny; pass | pass; deny |
| several paths: `git rm docs/a.md bay/guard.py` (bad one second) | deny | deny | pass |
| folder: `git rm -r bay`; `git rm -r .`; `git rm -r components/..` | deny | deny | pass; deny; deny |
| folder holding protected paths: `git rm -r components` | deny (`components/cos/`) | deny | deny |
| `git rm -r .github`, `git rm .github/workflows/ci.yml` | deny | deny | deny |
| never-written: `git rm CLAUDE.md`, `Makefile`, `bay.sh`, `.agentbay/x` | deny | deny | deny |
| pathspec magic: `git rm ':/bay/guard.py'`, `':(top)bay/guard.py'` | deny | deny | deny |
| glob: `git rm '*guard.py'`, `'bay/*.py'` | deny | deny | deny |
| symlink: `components/l -> ../bay`, `git rm components/l` | deny (fail closed) | - | - |
| case (`Guard(..., ci=True)`): `git rm BAY/guard.py`, `git rm -r Bay`, `claude.MD`, `.GitHub/Workflows` | deny | deny | - |
| `git -C bay rm guard.py` (not under the `git rm` prefix) | deny | deny | deny |
| allowed: `git rm components/briefing/mode.yaml`, `git rm -r components/briefing` | pass | - | - |
| allowed: `git rm tests/x.py`, `git mv docs/a.md docs/b.md`, `git rm -r docs` | deny | pass | pass |

Known strictness: a symlink is judged by its target, although git removes only the link. A move to `.` (`git mv docs/a.md .`) is denied, because `.` holds `.agentbay/`; name the file instead (`git mv docs/a.md a.md`). A `CLAUDE.md` nested deeper than the root inside a removed folder is not looked for; the file tools cannot write one anyway.

## Items 1 and 2: builders and reviewers can run checks

Files:
- `components/tools/envs/workspace.yaml:8,11`: `workspace.read/v1: { tools: [Read, Glob, Grep, Bash], clis: [./bay.sh check, python3 tests/run.py] }`, and `git commit, git mv, git rm` appended to `workspace.write/v1`.
- `components/forge/envs/local-authoring.yaml:15-19`: the same read binding, and `workspace.write/v1` clis `[git add, git commit, git mv, git rm]`. Line 18's comment goes; the stated risk replaces it in the CHANGELOG.
- `bay/model.py:61`: `READ_ONLY_CLIS` gains the two commands (the same line, so 0 lines).

Tests:
- **`tests/test_guard_matrix.py`, `test_guard_decision_matrix`.** Measured on the copy, the ten decision rows match the proposal exactly. Add them to `EXPECTED_DELTAS` as `CHECK_DELTAS`, deny to pass:
  - `builder--delivery`: `Bash ./bay.sh check`, `Bash git commit -m 'about bay approve'`, `Bash python3 tests/run.py -q`, `Bash python3 tests/run.py tests/test_improve.py`.
  - `builder--forge--local-authoring`: the last three. Its `./bay.sh check` row already passes.
  - `reviewer--forge`: `Bash ./bay.sh check`, `Bash python3 tests/run.py -q`, `Bash python3 tests/run.py tests/test_improve.py`.

  `undo_move` also needs a named, asserted-present reason delta for the three units, in the style of (4) for framework-dev (`cli_now` and `cli_was`). It covers their `policy.units.<u>.clis`, and the "may only run" text of every deny row that quotes them: 35, 38 and 39 rows in the golden, less the rows that turn to pass. No other decision may move. The assert `diff == NET_DELTAS` keeps that true.
- **`tests/test_guard_matrix.py`, `test_guard_matrix_for_a_project_with_the_kit_outside`.** The rows `builder--delivery shim`, `shim flag`, `kit cli` and `kit bay.sh` keep `deny`. Their reason text gains `./bay.sh check, python3 tests/run.py` and `git commit, git mv, git rm`. Put it back in `undo_kit_path`, asserted present: four occurrences. The golden files are not edited.
- **`tests/test_roles.py:224`**: the expected lint message lists the two new read-only CLIs. This file is not in `touches:`; see "Before the gate".

`reviewer--improve` and `reviewer--delivery` get the same two commands, because they share the env. They are not matrix units, so either answer to the open point costs no matrix delta. A second reviewer env would cost one env file, one `roles:` line in improve's `mode.yaml` and a lint pass. It would not touch `bay/`.

Stated risk, sharper than the proposal puts it. `tests/run.py` runs `tests/test_*.py`, `components/**/tests/test_*.py` and `adapters/*/tests/test_*.py` (tests/run.py:37-39). Local-authoring writes `components/`, so it can add a test there and run it. Delivery writes `.` outside the protected folders, so it can rewrite `tests/run.py` itself. In a user project, `tests/run.py` is the user's own file, so delivery can write it and then run it. That code can run any `bay` command, `--unguarded` included, and write anywhere. The guard cannot close this. The per-prefix prompt, `bay check --base`, review and git history remain.

## Item 3: a dispatch checks that the guard is on

**Where the heartbeat is read.** It is the mtime of `<args.project>/.agentbay/ledger/guard.seen`, by `os.stat` in a new `_guard_silent(project, secs)` in bay/cli.py. `cmd_status` (cli.py:572-573) and `_note_dispatch` (cli.py:498) both call it. `args.project` is the resolved `--project` or cwd. The hook writes the file at `CLAUDE_PROJECT_DIR or payload cwd` (guard.py:577-580). A `--project` that points elsewhere therefore reads another project's heartbeat, and refuses unless that project's session is hooked. That is a refusal, not a pass.

**How stale it may be: 900 seconds for dispatch, not 120.** The proposal says that in a hooked session the file is "always fresh at this point". It is not. The hook touches the file and returns `ask` for `note dispatch` (guard.py:91, 140-146). The user then answers the prompt, and the command runs only after that. A user who takes more than 2 minutes would get a false refusal in a hooked session. `bay status` keeps 120 seconds; dispatch passes 900 inline, with a comment saying why. A wider window has a cost: a hook-less session started within 15 minutes of a hooked session in the same checkout reads as guarded. So does a hook-less session that runs while a second, hooked session is active in the same project. Both are stated limits. 900 is a design number the owner may change; it costs no line.

**`--unguarded` cannot come from a subagent's Bash.** I checked this against the guard with the item 1 and 2 policy:
- `_bash_in_role` (guard.py:414-426) allows only the role's shim, the exact shapes of `bay plan` and the env's cli prefixes. `.agentbay/bay note dispatch ... --unguarded y`, `./bay.sh note dispatch ...` and `python3 -m bay.cli note dispatch ...` are denied for local-authoring and `reviewer--forge`.
- `_plan_command` (guard.py:478-480) takes exactly 4 words, or 5 with `--done`, and refuses a 4th word that starts with `-`.
- `./bay.sh check note dispatch T-1 --unguarded y` and `./bay.sh check --unguarded y` pass the guard, because they are under the `./bay.sh check` prefix. argparse then rejects them: `bay: error: unrecognized arguments: ...` (run on the copy). `--unguarded` is defined only on the `note` parser.
- The one route is code execution through the test runner (the item 1 risk above). The flag is a record of a coordinator decision, not a lock.

Sketch (bay/cli.py):
- `_guard_silent(project: Path, secs: int = 120) -> bool`: a docstring and one return line.
- `_note_dispatch`: `if not args.unguarded and _guard_silent(args.project, 900): _die(...)`. The message names both fixes: start Claude Code inside the project, or pass `--unguarded "<reason>"`. `("unguarded", args.unguarded)` joins the `data` tuple. An empty reason is falsy, so it refuses.
- `_print_guard(project, evs)`: the heartbeat line (moved from `cmd_status`) and one line per unguarded dispatch (`  unguarded dispatch <taskId>: <reason[:70]>`). It exists because the listing inline would make `cmd_status` a new complexity finding (above).
- `"unguarded"` is added to the `for f in (...)` argument loop (cli.py:824) and to `DISPATCH_FLAGS` (cli.py:593), whose error message names it. That adds no line. argparse abbreviations (`--ungu`) work, as they do for the other flags.

Other files:
- `components/cos/playbook.md:27`: when `note dispatch` refuses, tell the user that hooks are off and why. Pass `--unguarded "<reason>"` only when the user knows hooks cannot load.
- `adapters/claude-code/claude_code.py:552`: the same line gains `[--unguarded "<reason>"]`. No golden pins it (grep).

Tests (none added):
- `tests/test_cli_commands.py:52`: with no heartbeat the dispatch exits non-zero and writes no event. With `--unguarded "x"` it succeeds and `data.unguarded == "x"`. After `os.utime` of `guard.seen` it succeeds without the flag. With a 1000-second-old mtime it refuses again.
- The BYPASSES loop (`:77-90`) passes `--unguarded`.
- `tests/test_ledger.py:186`: the `_dispatch` helper passes `--unguarded` (two tests use it).
- The status test at `:284` expects the `unguarded dispatch <taskId>` line.

## Cost against the ceilings

| Measure | Ceiling | After (measured on the copy) | Note |
|---|---|---|---|
| `bay_lines` | 9688 | **9710** (+22) | exception allows 9709: **1 over**, see below |
| `kit_python_lines` | 5165 | 5165 | `claude_code.py:552` is reworded in place |
| `cli_commands` | 16 | 16 | `--unguarded` is an argument |
| `schemas` | 16 | 16 | |
| `framework_folders` | 2 | 2 | |
| `top_level_folders` | 7 | 7 | |
| `tests` | 462 | 462 | 7 tests extended, none added |

**bay_lines, line by line** (`git diff --numstat` on the copy):
- `cli.py` +12 (19 in, 7 out): `_guard_silent` +3 and 2 blank; the refusal +2; `_print_guard` +5 and 2 blank; the `cmd_status` call -2. The data tuple, the flag loop and `DISPATCH_FLAGS` are edited in place.
- `guard.py` +10 (16 in, 6 out): the mv/rm branch +5, the helper +6 and 1 blank, the `_worktree_add` reuse -3 (payer).
- `model.py` 0. `dispatch.py` 0.

The proposal's +16 counted `guard.py` +5 and `cli.py` +11. The difference is the five security edges above (+5 net, after the -3 payer) and `_print_guard` (+5, forced by the complexity threshold), less the `cmd_status` call and a one-line `_guard_silent`.

The payers in `bay/` are the `_worktree_add` reuse (-3) and the inline heartbeat test in `cmd_status` (-2). There is no other honest payer in `bay/`.

To land at or under 9709, take one of these:
- (a) Raise the exception to 9715 (+22 measured, plus a margin of 5) before the gate. The proposal is not yet approved, so this costs nothing.
- (b) Drop the `_guard_silent` docstring. That gives 9709 with zero margin.
- (c) The proposal's own fallback: drop the status listing. Then `_print_guard` goes too, and the count is 9705.

I recommend (a). Then the release writes the real count.

**Docs, by `len(text.split())`, budget 3000.** INTERFACES is 2994 by split, not 2983: the proposal used `wc -w`, which counts differently. Measured on the copy with exact text:

DESIGN 2997 -> 3000.
- Additions:
  - line 85: "and the two checks (`./bay.sh check`, `python3 tests/run.py`)" +8
  - line 109: "`bay note dispatch` then refuses unless given `--unguarded "<reason>"`, which the ledger keeps and `bay status` lists." +17
  - line 118: "a builder or reviewer runs" +2
  - line 143: "writes, `git mv` and `git rm` paths outside" +6
- Cuts that pay for them:
  - line 156: "(10 or more touches, any `exceptions:`, no readable `touches:`)" -9; the playbook holds the rule.
  - line 159: "(one prefix, or the wrong order, is refused)" -8.
  - line 164: "(code lines, CLI commands, folders, schemas, tests)" -7; limits.yaml names them.
  - line 165: "A lower count is a note." -6; "ceilings only fall" says it.
- Reserve, if wording grows: line 4, "This document describes the system as it is." -8.

INTERFACES 2994 -> 2998.
- Additions:
  - line 101: "(the brief's `verdictSchema` is the schema itself)" and "(`DOD-n`, `R-n`, `C-n`)" +10
  - line 128: ", `./bay.sh check` and `python3 tests/run.py`" +5
  - line 222: "--unguarded <reason>" and "With no guard hook call in 15 minutes it refuses unless `--unguarded` is given; `data.unguarded` keeps the reason and `bay status` lists it." +25
- Cuts that pay for them:
  - line 138: "`bay/model.py` resolves all of this and reports every gap at once (DESIGN, Compile)." -13; DESIGN Compile says it.
  - line 199: "`abandoned` means a person ended the call." -7; line 202 says it.
  - lines 181-182: "Lint finds it by folder and checks it, and reports a malformed entry without importing it." -16.

The docs are not in the deadcode block list. `improve.audit`'s `doc_size` flags only more than 3000, so 3000 passes.

## Risks

- **Test runner = code execution** (items 1 and 2). This is stated in the proposal, and is sharper for delivery (above). It is the main residual risk of the change.
- **False refusal at dispatch** (item 3). Without the 900-second window, it happens whenever the user takes more than 2 minutes on the prompt. With it, the false-guarded window is 15 minutes, plus any concurrent hooked session in the same checkout.
- **`git commit` and `git add` for local-authoring.** Neither writes a working-tree file. `git add -A` and `git commit -a` can stage and commit changes that someone else (or test-runner code) made outside its paths. `bay check --base` and review catch that. `core.hooksPath` is unset in this repo, and `.git/` is never writable, so a commit cannot be made to run a planted hook.
- **A guard regression in item 7.** The worktree reuse changes a shared check. Every matrix and boundary test was run on the copy with it in (`43 passed` for test_boundaries and the matrix's other rows; only the expected matrix deltas fail).
- **Complexity.** Any later growth of `cmd_status` crosses 30 again. Keep the guard lines in `_print_guard`.

## Before the gate (for the coordinator)

1. **bay_lines exception.** 9709 is 1 short of the measured 9710. Raise it to 9715, or choose (b) or (c) above.
2. **`touches:` misses `tests/test_roles.py`** (the lint text at :224). Also note that the project golden test is in `tests/test_guard_matrix.py`, which is already listed. The boundary passes either way (`tests/` is "other", boundary.py:39), but DOD-7 reads `touches:`.
3. **README.md is not in `touches:`.** README.md:124 lists `bay note dispatch` without the new flag, and DOD-13 asks for README in the same change. Either list README.md (one clause at :124, within its budget: 1609 words), or have the review accept README unchanged because nothing in it becomes false. A README edit without the listing fails `bay check --base` (B-1 core docs).
4. **The 900-second dispatch window** replaces the proposal's "always fresh" claim. It is a design detail the owner may want to see.
5. **Open, as the proposal says.** improve's reviewer shares env `workspace`: a second env costs one env file and one mode line, and no `bay/` or matrix change. The release number: 3.1.0. The dispatch refusal changes default behaviour; this session itself would have been refused.

## Release 3.1.0

- `bay/__init__.py` to 3.1.0.
- A CHANGELOG entry with an Upgrading section: run `./bay.sh build`; in a session without hooks, pass `--unguarded "<reason>"` to `bay note dispatch`; framework-dev's `git mv` and `git rm` are now path-checked too. It states the test-runner risk.
- `./bay.sh check --limits --write` writes `bay_lines` at the real count.
- The release Result prints the tag, push and `gh release create` commands for the owner.
