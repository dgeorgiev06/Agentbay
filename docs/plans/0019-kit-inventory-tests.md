# Plan 0019: the kit tests allow user modes and envs

The proposal as committed in 92eed5b, on branch fix/kit-inventory-tests from origin/main d337cc6 (3.0.1). It is test-only, the same class as 0018: one builder part, then the release step (CHANGELOG entry, version 3.0.2, no `--write`, because no count moves).

## What I checked (on a scratch worktree of origin/main)

- **Baseline.** origin/main as it is: `539 passed, 0 failed`.
- **With the to-do mode copied in.** Only `components/todo` and `components/todoitem` from feat/todo-mode, no other file of that branch: `572 passed, 3 failed`. The three failures:
  1. `test_roles::test_lint_reports_an_unknown_env_in_a_roles_map_with_file_and_line` (tests/test_roles.py:294). `todo-local` is now in the `(have: ...)` list.
  2. `test_adapter::test_adapter_round_trip` (adapters/claude-code/tests/test_adapter.py:48). `analyst--todo` and `reviewer--todo` are built.
  3. `test_mail_briefing::test_sandbox_reads_the_mail_views_and_refuses_shadow_tables_and_writes` (components/mail-briefing/tests/test_mail_briefing.py:360). This one is **not in the proposal**. It asserts the exact list of sandbox views, and the `todoitem` type adds its own. This is the content-type inventory (0018's class), not env, agent or mode. The proposal's "573 passed, 2 failed" was measured with the whole feat/todo-mode branch, and that branch already edits this assertion itself (`[n for n in names if n in want] == want`). See "Before the gate".
- **The rest of test_adapter_round_trip.** I made the proposal's three edits on the scratch copy and ran test_roles and test_adapter, once with the to-do mode and once without it: `27 passed, 0 failed` both times. The line 90 mode set is the only further pin, as the proposal says. Line 96 (`catalog roles == agents`) and the skill, coordinator and clean checks hold with an extra mode.
- **A grep of every `test*.py`** for exact sets or lists of env, agent or mode names, and for `len(...)` of the kit's modes, envs or units. It found nothing else. `tests/test_protection.py:427` pins `kit.protected.names["mode"] == {"cos", "forge", "store"}`. That is the protected list from kernel.yaml, which a user mode never joins, so it is correct as it is.

## The part

**1. Two assertions become presence checks** (about 10 turns).
Files: tests/test_roles.py, adapters/claude-code/tests/test_adapter.py. Both are inside framework-dev's `fs.write` (`tests`, `adapters`).

- test_roles.py:294. Keep the exact text up to `(have: ` with the file and line. Find the matching message; `assert hit, ps`. Split the names between `(have: ` and the closing `)` on `", "`. Then `missing = {ten shipped envs} - have` and `assert not missing, f"shipped envs not listed: {sorted(missing)} in {hit[0]}"`.
- test_adapter.py:48. `missing = {eleven shipped agents} - agents`, then `assert not missing, f"agents not built: {sorted(missing)}"`. Keep the `# no framework-dev here` comment.
- test_adapter.py:90. `missing = {six shipped modes} - {m["name"] for m in cat["modes"]}`, then `assert not missing, f"modes not in the catalog: {sorted(missing)}"`. Keep the `# ^ store is abstract` comment.
- Nothing else changes. No `def test_` is added, removed or renamed.

**Proof the builder quotes** (each was run on the scratch copy for this plan):

1. The shipped kit: `python3 tests/run.py -q` is green, with the same total as the base (539).
2. An extra user mode and env: on a scratch worktree, `git checkout feat/todo-mode -- components/todo components/todoitem`, then `python3 tests/run.py test_roles test_adapter -q`. Expected: 27 passed. The full suite on that worktree still shows the mail-briefing failure until "Before the gate" item 1 is settled.
3. A missing shipped env, agent or mode fails and names it, on that scratch worktree:
   - Move `components/mail-briefing` out of the worktree. test_adapter fails with `agents not built: ['analyst--mail-briefing', 'reviewer--mail-briefing']`, and the rest of that file passes.
   - For the env message, hold back `components/tools/envs/research.yaml` too. test_roles fails with `shipped envs not listed: ['local-mail', 'research'] in ...: unknown env 'nowhere' (have: cos-local, ...)`. Removing a shipped env also breaks resolution, so the other tests in those files fail as well. That is expected; quote only this test's line.
   - For the mode message, every shipped mode with roles also yields agents, so the agents check fails first. Prove the mode message by adding an unshipped name (`"nosuch"`) to the expected set in the scratch copy: `modes not in the catalog: ['nosuch']`. Revert it.
   - Restore everything, run `git worktree remove --force`, and confirm `git worktree list` no longer shows the scratch tree.
4. `./bay.sh check` is clean and `./bay.sh check --limits --base origin/main --proposal docs/proposals/0019-kit-inventory-tests.md` shows "7 measures within their ceilings". Both pass today on the branch.

## Cost against each ceiling

All seven measures are exactly at their ceilings today (`limits.count` on the branch).

| Measure | Now (= ceiling) | After | Why |
|---|---|---|---|
| tests | 462 | 462 | No `def test_` is added or removed. |
| kit_python_lines | 5165 | 5165 | Files under a `tests` folder are not counted. |
| bay_lines | 9688 | 9688 | `bay/` is not touched. |
| cli_commands, schemas, framework_folders, top_level_folders | 16, 16, 2, 7 | unchanged | Nothing is added. |

No `exceptions:` are needed and the release runs no `--write`. The docs word budgets are untouched, because the proposal changes no doc. DOD-13 is met trivially: there is no behaviour to document.

## Risks

- **Weaker tests, on purpose.** An unplanned extra env, agent or mode in the shipped kit is no longer caught by these two tests. `bay check` still lints every env and mode, and line 96 still ties the catalog to the build. Accepted by the owner for this class (chat 2026-11-03).
- **A loose parse.** If the `(have: ...)` parse took any message, a different message could pass. Keeping the exact prefix with file, line, mode, role and `'nowhere'` prevents that, and `assert hit, ps` keeps the old failure output when the message is gone.
- **Order hides the mode message.** When a whole mode is missing, the agents check fails first and names its agents. That is enough to find the cause. The mode check still guards a mode with no subagents.
- **No security surface.** Test-only: no guard, boundary, connector, secret or contract change. It is in plan scope only because `adapters/` is a sensitive path.

## Before the gate (owner decision)

1. **The third pinned test.** `components/mail-briefing/tests/test_mail_briefing.py:360` fails with any user content type that has views. Choose one:
   - (a) **Recommended.** Add it to the proposal's `touches:` (R-12: a change of scope, so the call returns to the gate), with the same presence check feat/todo-mode already uses. Main then accepts a user type without the to-do branch carrying a test fix, and the to-do rebase drops its identical hunk. `components/mail-briefing` is not in framework-dev's `fs.write`, so the coordinator makes this one edit on the main thread, with your prompt. That component's tests are not counted in `tests`.
   - (b) Leave it with feat/todo-mode, which already fixes it. Then 0019 alone does not make main accept a user type with views, and the proposal's "only failures" claim should say it was measured with that branch's test edit.
2. Approve the proposal and this plan with `bay approve C-20261103-f27533` (from chat with `--sha <proposal prefix>+<plan prefix>`).
