# HANDOFF: T-20261031-6bfb - 0009 sections 1-4 finished

Outcome: done. Branch docs/0009-simplicity-constraints, not pushed. Section 5 (test speed-ups) is not part of this task. The proposal is not edited by this work.

## Commits
- 7be9e4b: `improve.detect/v1.limits` (interface + `connectors/improve-detect/improve_detect.py`, read-only, calls `bay/limits.py` with `write=False`); `limits` code step after `deadcode` in `modes/forge/mode.yaml` and the playbook; `framework/limits.yaml` owned by the kernel and the `boundary.py` special case removed; README, docs/INTERFACES.md, docs/DESIGN.md; `kit_python_lines` ceiling 6589 (the op's 13 lines; the base has no limits.yaml).
- Earlier on the branch: ea534b8 (limits.py, `check --limits`), 545174b (process rules), c6677d9 (touches paths, ceilings).
- No new test: the limits op is asserted in the step-order test and the `write=False` case in `test_limits`. Tests stay at 546.
- `tests/test_improve_golden.py`: new EXPECTED_DELTAS entry kitAudit doc-size 2 -> 1 (HANDOFF.md was cut in 28556fd, so it is no longer over 3000 words); the delta loop now puts back the golden's value, the golden file is not edited.

## Evidence
- `python3 tests/run.py -q`: `546 passed, 0 failed`
- `./bay.sh check`: `✓ 6 modes, 21 features, 5 roles (17 role units), 8 envs, 13 connectors resolve (agent profile claude-code)`
- `./bay.sh check --limits --base origin/main --proposal docs/proposals/0009-simplicity-constraints.md --docs`: `boundary origin/main...HEAD: 18 changed paths (4 core, 3 docs, 2 extension, 2 feature, 6 other, 1 unowned); 0 failing; B-11 docs: 0 hits`, then `✓ limits: 7 measures within their ceilings`
- Not run: the `limits` op end to end through a forge.extend call (the connector method has no direct test).
