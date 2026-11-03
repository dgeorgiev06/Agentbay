---
# Approval is recorded in the ledger by `bay approve`; this file grants nothing. Design only: nothing is changed before the gate. Scope approved by the owner on 2026-11-03: this tiny change and nothing else.
id: "0018"
status: draft
touches:
  - { path: tests/test_content_types.py, reason: "test_the_loader_is_the_only_source_of_the_post_kind (line 34): the kinds assertion checks that post and email are present at version 1, not that nothing else exists" }
  - { path: tests/test_contract_versions.py, reason: "test_shipped_modes_and_connectors_declare_versioned_kinds (line 24): the same change to the same assertion" }
  - { path: CHANGELOG.md, reason: "release step: entry for 3.0.1" }
  - { path: bay/__init__.py, reason: "release step: version 3.0.1" }
---

# 0018: The kit tests allow user content types

## Problem

Two tests assert the exact set of content types: `model.item_kinds(KIT) == {"post": {1}, "email": {1}}` at `tests/test_content_types.py:34` (`test_the_loader_is_the_only_source_of_the_post_kind`) and `tests/test_contract_versions.py:24` (`test_shipped_modes_and_connectors_declare_versioned_kinds`). `KIT` is the checkout, so a user content type added under `components/` makes both fail, although no framework rule is broken. The to-do mode's type, `todo/v1` (branch `feat/todo-mode`), is the first. The tests mean to prove that the shipped kinds are declared and versioned, not that no other kind may exist.

## Change

In each test, the one equality becomes a presence check of the two shipped kinds at version 1, for example `assert {"post": {1}, "email": {1}}.items() <= model.item_kinds(KIT).items()`. Nothing else in either test changes: the loader refs (`post/v1`, `email/v1`), the check that no `schemas/data/post.*` or `email.*` file exists, the data-schema title, `contenttypes.problems`, the `reads` and `produces` checks and `lint_contract_versions` all stay. No test is added, removed or merged, so the test count (a limits measure) stays as it is. No code, schema, CLI or doc changes; no ceiling in `framework/limits.yaml` moves, and no `exceptions:` are needed.

## Compatibility and safety impact

- Test-only: no contract, schema, `apiVersion`, CLI, data or behaviour changes, and nothing for a user to migrate.
- The tests become weaker in one way, on purpose: an unplanned extra kind in the kit is no longer caught here. `bay check` still lints every kind (versioned names, producers, `reads`), and `test_every_content_type_meets_the_contract` still runs the contract on each one found.
- No secret, connector or boundary is touched; the boundary and DOD-4 (a new source is one connector and one binding line) are unaffected.

## Release 3.0.1

A patch release: `bay/__init__.py` to 3.0.1 and a CHANGELOG entry ("the kit tests no longer assert that the shipped content types are the only ones"). The release step runs the tag, push and `gh release create` commands for the owner as usual.
