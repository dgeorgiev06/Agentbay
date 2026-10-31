# HANDOFF: T-20261031-264f (recorded with `bay plan`) - 0009 sections 1-4 built, partly blocked

Outcome: partial. Branch docs/0009-simplicity-constraints, not pushed. Section 5 (test speed-ups) is not part of this task. No proposal edited.

## Commits
- ea534b8: `bay/limits.py`, `bay check --limits` (bay/cli.py), `framework/limits.yaml`, `tests/test_limits.py`; the two check-option CLI tests in `tests/test_cli_commands.py` merged into one (546 tests before and after).
- 545174b: forge.extend DOD-15, R-1 and R-9 reworded, R-10 to R-12, review and handoff rules in the playbook, implement task text in `modes/forge/mode.yaml`.
- 0a9217a: `framework/limits.yaml` is a boundary `other` path in `bay/boundary.py` (lint B-4 refused it as unowned once tracked; the ratchet edits it in every change, so it must not need a touches entry).

## Blocked (needs the owner or an amendment)
1. 0009's touches name `framework/modes/forge/...`. Those files have sat at `modes/forge/` since 0008 part G. `check --base` therefore fails exactly three paths (B-3): `modes/forge/mode.yaml`, `modes/forge/features/extend/playbook.md`, `modes/forge/features/extend/rules.yaml`. Commit 545174b holds only these three and can be dropped or kept.
2. The `limits` code step in forge.extend is not built. A step runs `<interface>.<endpoint>` in a connector; the only fit is a new op next to `improve.detect/v1.change`, which needs `framework/interfaces/improve.detect.v1.yaml`, `connectors/improve-detect/` and its tests, none of them in touches. DOD-15 asks the builder to run `./bay.sh check --limits` and the reviewer to re-run it instead.
3. README, docs/INTERFACES.md and docs/DESIGN.md (R-4) are not updated: not in touches. `bay check --limits` and limits.yaml are undocumented there.

## Numbers
- `bay_lines` ceiling is 9621, not the proposal's 9508: limits.py (97 lines) and cli.py (+16) land in the same change, and the base has no limits.yaml, so the change sets its own numbers. Other ceilings are the table's; `tests` is 546.
- `boundary.py` needed no change for folder entries: a trailing `/` already covers the folder (`test_glob_matching`).

## Evidence
- `python3 tests/run.py -q`: `546 passed, 0 failed`
- `./bay.sh check`: `✓ 6 modes, 21 features, 5 roles (17 role units), 8 envs, 13 connectors resolve (agent profile claude-code)`, after `✓ lint clean`
- `./bay.sh check --limits --base origin/main --proposal docs/proposals/0009-simplicity-constraints.md --docs`: `✓ limits: 7 measures within their ceilings`; boundary line, before this file was committed: `boundary origin/main...HEAD: 9 changed paths (2 core, 1 extension, 2 feature, 4 other); 3 failing (B-3: 3); B-11 docs: 0 hits`
- Not run: scratch-repo build and clean round trip, the `deadcode` step (needs the forge.extend call).
