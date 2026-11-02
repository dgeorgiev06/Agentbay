# Plan 0013: ledger truth

Proposal as committed in 0b4dfe1. Branch feat/ledger-truth from 0b4dfe1. There are six builder parts, in order; the release step does the changelog, version and `--write`.

Every part ends with `python3 tests/run.py -q` green and `./bay.sh check` clean, quotes `./bay.sh check --limits` (bay_lines, kit_python_lines and tests measured), and commits. Line counts below are `bay/` lines as `limits.count` measures them (every line of every `.py` file, comments and docstrings included). bay_lines is 9572 today, exactly its ceiling, and kit_python_lines is 6580, also exactly its ceiling.

## What the code does today (verified)

- **Submit closes agents.** `Dispatcher._close_runs` exists (bay/dispatch.py:103-117). It appends `completed` for every running run dispatched to the submitted call and step, and for a taskId named in the result. It is tested by `test_a_steps_submit_closes_every_run_dispatched_to_that_call_and_step`. It has one gap: `submit` calls it only in the non-review branch (dispatch.py:96), so a review step's submit never closes the reviewer's run. The proposal's sentence "a step's `bay submit` already closes the agents dispatched for that call and step" is therefore true for role steps only. Part 2 closes the gap by moving that one call below the `if/else` (0 lines). The owner should confirm at the gate that this counts as in scope; if not, the proposal sentence must say "role step".
- **Why reclaim fails.** `bay note dispatch` writes `agent.dispatch` with `runId` = taskId. `show reclaim <taskId>` already finds that run: `_find_run` matches `task_id == key`, and it falls back to the key itself. So `cli.py` needs no change for "`show reclaim` finds dispatch-only runs". The bug is only in `ledger.fold`: the `reclaimed` event carries no taskId, so the run it creates has `task_id == ""`. The second loop (ledger.py:267-272) then does not see that taskId and overwrites `runs[taskId]` with a fresh running run. A `completed` event with a taskId (from `_close_runs`) already works, but the run loses its agent and start time.
- **Hook events.** bay/hook.py writes `spawned` and `completed` with `source="hook"`, which is how part 4 tells whether the hook is loaded.
- **No schema change.** The event schema leaves `data.status` free, and `completed` and `call.completed` exist. `ExtendReq` is a component type (`components/forge/types/`), not a file in `schemas/`, so the `schemas` count is unchanged.

## Parts

**1. Fold truth** (15 turns). In `ledger.fold`, replace the dispatch loop (ledger.py:267-272) so that a dispatch fills in a run with the same runId instead of replacing it. Skip a dispatch only when another run (a hook run with a different runId) already holds that taskId. Then set `agent`, `task_id` and `started` (when empty) from the dispatch, and keep the run's state. A reclaimed or completed run stays reclaimed or completed, whatever order its events came in. Update the `Call.state` comment to list `abandoned`. `fold_calls` needs no code: it already copies `call.completed`'s status. Budget: -1 line (6 lines become 5).
- Test: extend `tests/test_ledger.py::test_a_dispatched_agent_is_listed_by_status_without_the_spawn_hook`. After the dispatch, run `cli(p, "show", "reclaim", TID, "--reason", "stuck")` and assert that the run is `reclaimed`, still has agent `builder--forge--framework-dev`, and is no longer under RUNNING AGENTS. Also assert that `status --log -n 1` prints `"reclaimed"` and that `show reclaim` with no ref fails. That absorbs `tests/test_cli_commands.py::test_show_reclaim_marks_a_run_and_status_log_prints_events`, which this part deletes (tests -1).

**2. Finishes without the hook** (20 turns).
- In `cmd_note`, add the verb `done`: `bay note done <taskId>`. It checks the taskId shape and that `ledger.dispatched_agent` finds a dispatch or spawn of it. Without that check, a mistyped id would create a finished run that never existed. It appends `completed` on `_find_run(project, taskId)` with `source="coordinator"`, `taskId` and `data={"status": "done"}`, and prints `done recorded`. It takes no flags, so the dispatch-flag refusal stays as it is. The module docstring gets one line. About +7.
- Move `self._close_runs(call_id, step, output)` in `Dispatcher.submit` below the `if/else`, so a review submit closes the reviewer's run too (0 lines).
- Payers in cli.py (same behaviour). Inline `cmd_reclaim` into the `reclaim` branch of `cmd_show` and drop the `argparse.Namespace` round trip (-4). In `cmd_check`, use one `with (contextlib.redirect_stdout(sys.stderr) if args.json else contextlib.nullcontext()):` around `_validate`, with `import contextlib` at the top (-3).
- Tests: in `test_ledger.py`'s dispatched-agent test, a second taskId is closed with `note done` (state `done`, agent kept), and `note done` on an unknown taskId exits non-zero with no event written. In `tests/test_dispatch.py::test_digest_done_when_review_passes`, append an `agent.dispatch` to the call's `review` step before the review submit, and assert that its run is `done` afterward. Count unchanged.
- Budget: net 0.

**3. End a call** (30 turns).
- `Dispatcher.close(call_id, reason)`. It loads the state and refuses unless the status is `running`, `needs-agent` or `awaiting-approval` ("call X is done; only an open call can be closed"). It sets `status="abandoned"` and `result={"reason": reason}`, then calls `_finish`, which writes `call.completed` with that status and saves the call file. After that, `submit` and `approve` refuse the call through their existing status checks. About +9.
- `Dispatcher.call`: if `inp.get("replaces")`, load that call and refuse if its `target` differs from this call's ("replaces names a call of <target>, not <this>"). After the new callId is minted and before `_advance`, call `self.close(old, f"replaced by {call_id}")`. A call that is not open is refused there, before the new call writes anything. About +6.
- `ExtendReq.schema.json`: `"replaces": {"type": "string", "pattern": "^C-[0-9]{8}-[0-9a-f]{6}$", "description": "an open forge.extend call this one supersedes; starting this call closes it as abandoned"}`.
- cli.py: `show close <callId> --reason <text>` shares the reclaim branch's usage check. `--reason` is required for close. It runs `_run(lambda: d.close(...))`. The `--reason` help, the `_verb_first` message and the docstring's `show reclaim` line name close too, with no new lines. About +5.
- guard.py: `ASK_VERBS["show"] = ("reclaim", "close")`. Rewrite the main-thread paragraph of the module docstring (guard.py:17-22) to name the asked writes once (-2). Payer: `under()` becomes `return p.is_relative_to(root)` (-4; is_relative_to is already used in cli.py and dispatch.py).
- adapters/claude-code/claude_code.py: add `"show close"` to `ASKED_UNDER_COORDINATOR_CMDS`. In the control-plane text, the `show reclaim` bullet becomes "`show reclaim <runId>` / `show close <callId> --reason ...` -> mark a stuck run reclaimed; end an open call as abandoned (asks)". The `note <ref>` bullet gains "`note done <taskId>` when an agent dispatched outside a step reports back". The "except ..." sentence names `show close`. All of this is reflowed into the existing lines: **0 kit_python_lines**, because that measure is also at its ceiling and has no exception.
- Payers in dispatch.py (same behaviour). In `approve`, build the step record once and store `dict(data)` instead of a second literal (-2). `_state_holds` returns its condition directly (-2). `_recorded_plans` derives from `self._agents(call_id)`, keeping the agents that have an outcome (-2).
- Tests: one new test, `tests/test_submit_needs_plan.py::test_a_closed_call_is_abandoned_and_refuses_submit_and_approve` (tests +1). It covers: close at `propose` gives `abandoned` in the state, the ledger and `fold_calls`; a submit is refused; a second close is refused; `forge.extend` with `replaces` closes an open call with "replaced by C-..."; `replaces` naming a closed call, or a call of another endpoint, is refused, and no new call file is written. Extend `tests/test_guard_mainthread.py` ASKED with `".agentbay/bay show 'close' C-1 --reason r"` and NOT_ASKED with `".agentbay/bay note done T-20261030-abcd"`. Extend the verb loop and the canonical forms in `tests/test_guard_7a.py:58-64` with `show close`. Do not add `tests/golden/guard-matrix.json` rows.
- Then the coordinator asks the owner for `./bay.sh build`, so that settings.json carries the new ask rule.
- Budget: +20 added, -12 payers, net about +8.

**4. Status separates live from stale** (20 turns). In cli.py, split `_ago` into `_secs(ts)` and `_ago`, and add `STALE_S = 86400`.
- A running run whose `started` is older than a day, and a call in `running` or `waiting` whose last event is older than a day, go into a `STALE? (n)` section, out of RUNNING AGENTS and CALLS. The section header says "no event for 24h and not finished: look, then `show reclaim` or `show close`". A run's age is taken from its start, because the fold keeps no later event time for a running run. `abandoned` counts as finished.
- When the ledger holds an `agent.dispatch` and no event with `source == "hook"`, print one line: "the spawn hook is not loaded: agents finish in the ledger only by `bay submit`, `bay note done` or `bay show reclaim`".
- `--json` gains a `stale` list.
- Test: in the dispatched-agent test, write one `agent.dispatch` line with a two-day-old `ts` straight into `ledger.ledger_path(p)`, and assert that it is under STALE? and not under RUNNING AGENTS. Assert the hook line, and assert that it disappears after a `spawned` event with `source="hook"`. Count unchanged.
- Budget: about +10.

**5. CHANGELOG.md is a history doc** (10 turns). Add `"CHANGELOG.md"` to `HISTORY_DOCS` (detect_artifacts.py:26; a prefix match, so it matches only the root file), the default in `components/improve/config.schema.json:35` and the comment in `components/improve/config.example.yaml:6`. Test: in `test_improve_detectors.py::test_doc_size_and_stale_references`, add a `CHANGELOG.md` of 200 words. It is skipped by default and appears with `historyDocs: []`. Then run `test_improve_golden`. If `kitAudit.countsPerKind.doc-stale` moves (it is 1 now, and CHANGELOG.md may be that one), change that delta's `now` and `why` to name 0013. Never regenerate the golden. 0 kit lines.

**6. Docs** (20 turns).
- README's commands table: `show close`, `note done`.
- docs/INTERFACES.md: the CLI paragraph (lines 208-209), the agent-run event notes (line 223: `completed` from `note done`, and a reclaim of a dispatch-only run holds), and the call states with `abandoned` and `replaces`.
- docs/DESIGN.md: the status paragraph says what stale means and what the hook line adds; line 129 names `show close` among the asked writes.
- components/forge/playbook.md: the coordinator records `note done` when an agent dispatched outside a step reports back, and names `replaces` when it restarts an extend.
- If the owner adds the touch, components/forge/features/extend/playbook.md "Inputs" also lists `replaces`.
- No code.

## Cost against each ceiling

| Measure | Now (= ceiling) | After | How |
|---|---|---|---|
| bay_lines | 9572 | about 9589 | 1: -1; 2: +7 -7; 3: +20 -12; 4: +10. Gross about +37, payers about -20 (the fold rewrite included), net about +17. |
| kit_python_lines | 6580 | 6580 | The adapter text is reflowed into existing lines, and HISTORY_DOCS gains a tuple member. Neither may add a line: there is no exception. |
| cli_commands | 16 | 16 | `close` and `done` are verbs of `show` and `note`. |
| framework_folders | 2 | 2 | None. |
| schemas | 16 | 16 | ExtendReq lives under components/. |
| top_level_folders | 7 | 7 | None. |
| tests | 539 | 539 | Part 3 adds 1; part 1 removes `test_show_reclaim_marks_a_run_and_status_log_prints_events`, which the reclaim assertions absorb. |

**The bay_lines exception.** It cannot go on the cuts found. The same-behaviour payers in the four touched kernel files come to about -20 lines:
- `cmd_reclaim` inlined: -4.
- `cmd_check` with one context manager: -3.
- `guard.under` as `is_relative_to`: -4.
- guard docstring: -2.
- three dispatch.py simplifications: -6.
- the fold rewrite, which is the fix itself: -1.

Against about +37 added, that leaves about +17. The smallest exception is `to: 9595`: 17 lines net, plus 6 lines for estimate error, which is about half of the status part. The proposal's 9650 comes from a gross "about 70 lines" that overcounts: `show reclaim` already finds dispatch-only runs, so it needs no CLI change, and the fold fix shrinks the fold. The proposal's `exceptions:` line should be changed to 9595, with that reason, before the gate. A part that runs over its budget trims inside its own part first. The exception could go entirely only by cutting about 17 more lines from cli.py, dispatch.py, ledger.py or guard.py. I found no further cut there that keeps behaviour and is not just line-packing. The release lowers the ceiling to the real count with `--write`.

## Touches

Every path the plan edits is in `touches:` except these, which must be added before the gate:
- `framework/limits.yaml`: the release writes the lowered bay_lines ceiling. It is not under boundary.py's free list, and 0009-0012 each listed it.
- `components/improve/config.schema.json`: the `historyDocs` default lists the history prefixes and must gain CHANGELOG.md, or the schema default and the code disagree.
- `components/forge/features/extend/playbook.md`: optional. Its "Inputs" names every ExtendReq field, so `replaces` belongs there.

`tests/` and `docs/plans/` are free (boundary.OTHER). The touch for `components/improve/tests/test_improve_golden.py` is needed only if doc-stale moves.

## Risks (security first)

- **A new asked write.** `show close` must ask in every spelling, as `show reclaim` does. `ASK_VERBS` covers the guard. The adapter's ask rule covers plain text, and it takes effect only after `./bay.sh build`. Until that build, the old settings.json pre-approves `show close` under `show`, but the guard hook still asks. Subagents stay refused by the guard, which lets them run only `bay plan`.
- **`note done` is not asked.** It sits under the pre-approved `note`, as the proposal intends, so the coordinator can mark a run finished without a prompt. Requiring a logged dispatch keeps it from inventing runs.
- **Closing is not rejecting.** An abandoned call keeps any gate approval it recorded. `_state_holds` still finds it, so a `replaces` call with the same unchanged proposal skips the gate. That matches "only the owner's approval of this content counts", but the owner should know that `show close` does not revoke an approval.
- **Scope widens when a call closes.** `_open_calls` reads only `needs-agent` calls, so closing one drops its `uses:` narrowing (B-9) for that role unit. That is correct for an ended call.
- **Workflows.** cos `NextReq.status` allows only done, partial, blocked and failed. A workflow stage whose call was closed cannot be reported as `abandoned`. This is out of scope; it is listed as a follow-up.
- **Agents of a closed call** stay running until submit, `note done` or reclaim, and turn `stale?` after a day. The proposal does not ask `close` to end them.
- **Python version.** `is_relative_to` needs Python 3.9. The guard runs under the system `python3` from the hook, so the builder confirms that the kit already requires 3.9; cli.py and dispatch.py use it today. If the guard must run on 3.8, drop that payer, and the exception needs 4 more lines (9599).

## Where the builder needs the owner

- **The proposal.** The exception becomes `to: 9595`, and the two missing touches are added, before `bay approve`.
- **Build.** `./bay.sh build` after part 3; the coordinator asks.
- **Prompted git commands.** None. No file moves.
- **Open choice.** Whether the review-step `_close_runs` move is in scope (part 2). If not, the proposal says "role step".
