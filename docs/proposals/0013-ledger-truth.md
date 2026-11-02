---
# Approval is recorded in the ledger by `bay approve`; this file grants nothing. Design only: nothing is changed before the gate. Scope approved by the owner on 2026-11-02: four ledger items and one history-doc line.
id: "0013"
touches:
  - { path: bay/ledger.py, reason: "fold lets a reclaimed or finished run win over its dispatch record; fold_calls knows `abandoned`" }
  - { path: bay/cli.py, reason: "`show reclaim` finds dispatch-only runs; new `show close` and `note done`; `status` marks stale work and an absent hook" }
  - { path: bay/dispatch.py, reason: "a `close` method that ends a call as abandoned; `call` closes the call named in `replaces`" }
  - { path: bay/guard.py, reason: "`show close` asks, like `show reclaim`" }
  - { path: adapters/claude-code/claude_code.py, reason: "`show close` joins the asked prefixes; the generated coordinator text names `show close` and `note done`" }
  - { path: components/forge/types/ExtendReq.schema.json, reason: "optional `replaces`: the call this one supersedes" }
  - { path: components/forge/playbook.md, reason: "the coordinator records `note done` when an agent reports back and names `replaces` when it restarts an extend" }
  - { path: components/improve/connectors/improve-detect/detect_artifacts.py, reason: "CHANGELOG.md joins HISTORY_DOCS" }
  - { path: components/improve/config.example.yaml, reason: "the historyDocs comment shows the new default" }
  - { path: components/improve/connectors/improve-detect/tests/, reason: "the history-doc test covers CHANGELOG.md" }
  - { path: components/improve/tests/test_improve_golden.py, reason: "only if the golden doc counts move once CHANGELOG.md is skipped, as a named delta" }
  - { path: tests/, reason: "ledger, status and close tests; each added test replaces one the change made obsolete" }
  - { path: README.md, reason: "the commands table names `show close` and `note done`" }
  - { path: docs/INTERFACES.md, reason: "the CLI paragraph, the ledger event notes and the call states" }
  - { path: docs/DESIGN.md, reason: "the status paragraph says what stale means and what the hook adds" }
  - { path: bay/__init__.py, reason: "release step: version" }
  - { path: CHANGELOG.md, reason: "release step: entry" }
  - { path: framework/limits.yaml, reason: "release step: the lowered ceilings" }
  - { path: components/improve/config.schema.json, reason: "the historyDocs default gains CHANGELOG.md" }
  - { path: components/forge/features/extend/playbook.md, reason: "Inputs names the optional `replaces`" }
exceptions:
  - { measure: bay_lines, to: 9595, reason: "about 37 lines added in ledger.py, cli.py and dispatch.py, about 20 paid by same-behaviour cuts in those files (the plan names each); net about +17 plus a 6-line margin; the release lowers the ceiling to the real count" }
---

# 0013: Ledger truth

## Problem

The ledger is what `bay status` and improve read, and today it says things that are not true. An agent stays listed as running long after it ended, and a call that someone abandoned or replaced stays `waiting` forever. The causes are specific. `bay show reclaim <runId>` appends a `reclaimed` event, but an agent the coordinator only logged with `bay note dispatch` has no such run: `ledger.fold` builds it from the dispatch event, keyed by taskId, and the reclaimed event, which carries no taskId, never matches it, so the run goes back to running. An agent's finish is also recorded mainly by the Claude Code hook, so when the hook is off or misses a run, nothing closes it. Nothing at all can end a call. And `bay status` shows every old entry as if it were live work, so a person cannot tell a running agent from a forgotten one. Improve then reads these false records as evidence.

## The changes

**1. Reclaim closes any run it names.** `fold` will apply a `reclaimed` or `completed` event to a dispatch-only run instead of rebuilding that run as running afterwards, and `show reclaim` will accept the taskId of such a run. The reason: the command already promises this and silently fails. Rejected: make `show reclaim` append the taskId to its event. That repairs one writer and leaves the fold wrong for the next.

**2. A finish does not depend on the hook.** A step's `bay submit` already closes the agents dispatched for that call and step (`Dispatcher._close_runs`); that stays the rule. For a dispatch outside a step, the coordinator records `bay note done <taskId>` when the agent reports back; it appends a `completed` event, so no new event type exists. A dispatch with no finish after a day is flagged by `bay status` (change 4), not by lint. The reason: the hook is an optional adapter feature and the ledger must be true without it. Rejected: flag it in lint, because lint checks the kit and not the ledger, and a second place to read the ledger would cost more lines.

**3. A call can be ended.** `bay show close <callId> --reason <text>` ends an open call as `abandoned`: the dispatcher records `call.completed` with that status and saves the call file the same way, so later submits are refused as for any finished call. `forge.extend` takes an optional `replaces: <callId>`, and starting the new call closes the named one with the reason "replaced by <new callId>"; naming a call that is not open, or one of another endpoint, is an error. The reason: today a restarted extend leaves its predecessor waiting for good. Rejected: close superseded calls automatically by endpoint, which guesses what the owner meant and could close work that is still wanted.

**4. Status separates live from stale.** `bay status` marks any run or call whose last event is more than 24 hours old and not finished as `stale?`, in its own list apart from live work, and prints one plain line when the ledger holds dispatches but no event from the hook, saying the hook is not loaded and that finishes then come from submit, `note done` and reclaim. The reason: age is the only signal the ledger has, and saying "stale?" asks the owner to look instead of closing anything. Rejected: close stale entries on their own after 24 hours, because the ledger would then claim an end that no one saw.

**5. CHANGELOG.md is a history doc.** It joins `HISTORY_DOCS` beside `docs/proposals/` and `docs/plans/`, so doc-size and doc-stale skip it and release entries cannot trip the doc budget. The reason: it is a record of past decisions and grows by design.

## Compatibility and safety impact

No backward-compatibility code is added. Existing ledgers keep their events and fold more truthfully: old dispatch-only runs that were reclaimed now show as reclaimed, and `abandoned` is a new value of the existing `call.completed` status, which improve reads as an opaque string. No schema changes and no apiVersion bump: `ExtendReq` gains an optional field and the event schema gains no type. `cli_commands` stays 16, since `close` and `done` are verbs of `show` and `note`. `show close` writes, so the guard asks for it like `show reclaim`; `note done` only appends a record, as `note` does today, and subagents still cannot run either. Neither command touches an approval, a gate or a secret, and a closed call cannot be approved afterward. The only limit raised is `bay_lines` (exception above). The test count does not grow: each added test replaces one the change made obsolete.
