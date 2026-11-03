---
# Approval is recorded in the ledger by `bay approve`; this file grants nothing. Design only: nothing is changed before the gate. Scope approved by the owner on 2026-11-03: this tiny change and nothing else.
id: "0019"
status: draft
touches:
  - { path: tests/test_roles.py, reason: "test_lint_reports_an_unknown_env_in_a_roles_map_with_file_and_line (line 294): the lint message is checked for the unknown env and the shipped envs in its `(have: ...)` list, not for the exact list" }
  - { path: adapters/claude-code/tests/test_adapter.py, reason: "test_adapter_round_trip (line 48): the shipped agents must all be built, not be the only ones; the same change to the shipped-modes equality at line 90 of the same test" }
  - { path: CHANGELOG.md, reason: "release step: entry for 3.0.2" }
  - { path: bay/__init__.py, reason: "release step: version 3.0.2" }
---

# 0019: The kit tests allow user modes and envs

## Problem

Two tests assert the whole kit inventory, the same class of fault as 0018. `tests/test_roles.py:294` (`test_lint_reports_an_unknown_env_in_a_roles_map_with_file_and_line`) asserts the exact `(have: cos-local, framework-dev, ..., workspace)` env list in a lint message, and `adapters/claude-code/tests/test_adapter.py:48` (`test_adapter_round_trip`) asserts that the built agents are exactly the eleven shipped ones. `KIT` is the checkout, so a user mode with its own env and units breaks both, although no framework rule is broken. The to-do mode (branch `feat/todo-mode`, env `todo-local`, units `analyst--todo` and `reviewer--todo`) is the first; with it applied these are the only framework tests that fail (a third, a mail-briefing test that pins the sandbox view list, is not framework code and is fixed on feat/todo-mode). The tests mean to prove that the lint names the unknown env and offers the real ones, and that the shipped units are built, not that nothing else exists.

## Change

In `test_lint_reports_an_unknown_env_in_a_roles_map_with_file_and_line`, the one string comparison is split: the message must start with the same `file:line: mode feed-briefing: `roles:` puts role reviewer in unknown env 'nowhere' (have: ` text, and the comma-separated names after `have:` must include the ten shipped envs (`cos-local`, `framework-dev`, `improve-local`, `local-authoring`, `local-feeds`, `local-mail`, `plan-writer`, `research`, `store-local`, `workspace`). The file and line check stays exact.

In `test_adapter_round_trip`, `assert agents == {...}` becomes a check of the eleven shipped agent names against `agents`, written as `missing = shipped - agents` then `assert not missing, f"agents not built: {sorted(missing)}"`. The same test also pins the catalog's mode set (`{m["name"] for m in cat["modes"]} == {"cos", "delivery", ...}`, line 90), which a user mode would fail next; it gets the same treatment with the six shipped modes. The line 96 check (`{r["subagent"] for r in cat["roles"]} == agents`) compares the catalog with the build, so it stays.

In both, a failing assertion prints what is missing (the env names or agent names), not just the two sides. Everything else in the two tests stays. No test is added, removed or merged, so the test count (a limits measure) stays as it is. No code, schema, CLI or doc changes; no ceiling in `framework/limits.yaml` moves, and no `exceptions:` are needed.

## Compatibility and safety impact

- Test-only: no contract, schema, `apiVersion`, CLI, data or behaviour changes, and nothing for a user to migrate.
- The tests become weaker in one way, on purpose: an unplanned extra env, agent or mode in the kit is no longer caught here. `bay check` still lints every env and mode, and the unit and catalog checks that follow in `test_adapter_round_trip` still run on everything built.
- No secret, connector or boundary is touched; the boundary and DOD-4 (a new source is one connector and one binding line) are unaffected.

## Release 3.0.2

A patch release: `bay/__init__.py` to 3.0.2 and a CHANGELOG entry ("the kit tests no longer assert that the shipped envs, agents and modes are the only ones"). The release step runs the tag, push and `gh release create` commands for the owner as usual.
