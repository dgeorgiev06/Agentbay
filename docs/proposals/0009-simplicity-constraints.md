---
# Approval is recorded in the ledger by `bay approve`; this file grants nothing. Owner request 2026-10-30: "We need constraints against complicating this framework."
touches:
  - { path: bay/limits.py, reason: "NEW. counts the size budget, compares with the ceilings, reads exceptions from the proposal (about 80 lines)" }
  - { path: bay/cli.py, reason: "`bay check --limits` (a flag, not a new command)" }
  - { path: framework/limits.yaml, reason: "NEW. the ceilings, one number per line" }
  - { path: modes/forge/mode.yaml, reason: "`limits` code step in forge.extend after `deadcode`; one review round; fix result is the implement result" }
  - { path: modes/forge/features/extend/playbook.md, reason: "DOD-15 limits; leaner review and amendment rules" }
  - { path: modes/forge/features/extend/rules.yaml, reason: "R-1 and R-9 reworded; new rules for nits, touches by folder, amendments" }
  - { path: framework/components.yaml, reason: "the kernel owns framework/limits.yaml" }
  - { path: framework/interfaces/improve.detect.v1.yaml, reason: "a `limits` operation, so forge.extend runs the check as a code step like `deadcode`" }
  - { path: connectors/improve-detect/, reason: "implements the `limits` operation by calling bay/limits.py" }
  - { path: README.md, reason: "documents `bay check --limits` and framework/limits.yaml" }
  - { path: docs/INTERFACES.md, reason: "the `limits` operation and limits.yaml as contracts" }
  - { path: docs/DESIGN.md, reason: "the ceilings and the ratchet, one paragraph" }
  - { path: bay/model.py, reason: "cache parsed YAML in Kit by (path, mtime, size)" }
  - { path: tests/run.py, reason: "per-test timing; slowest 15; wall-time check against the ceiling" }
  - { path: tests/helpers.py, reason: "kit_copy hard-links files and copies only the file a test edits; built() shared per file" }
  - { path: tests/test_limits.py, reason: "NEW. fixture test for the check (ratchet, exception, count rule)" }
  - { path: tests/test_boundaries.py, reason: "guard decisions run in-process; 3 subprocess tests stay for the hook contract" }
  - { path: HANDOFF.md, reason: "cut to the current work" }
---

# 0009: Constraints against complicating the framework

## Problem

The owner: "We have not done great so far." Proposal 0008 asked for less and still grew.

- 0008 has taken 5 stages, each with 2 to 3 Opus review rounds, mostly for nits.
- It has 4 amendments, mostly to list files a rename touched.
- Every fix round was followed by a confirmation builder pass.
- HANDOFF.md grew to 30 parts.
- The test suite takes over 2 minutes and each builder runs it 2 to 3 times.
- Checks and tests were added faster than old ones were removed: tests went from 442 to 539.

Advice did not stop this. A limit that fails a change will.

## Change

One rule: a change may not make the framework bigger than its ceiling. A deterministic check fails the change. Anything else is a recorded, owner-approved exception.

### 1. Size ceilings

`framework/limits.yaml` holds one number per measure. The ceilings are measured when 0009 lands, including its own code (the base has no limits.yaml, so 0009 sets its own numbers). Values on main before 0009:

| Measure | Today |
|---|---|
| lines in `bay/` | 9508 |
| lines of Python in kit connectors, adapters and content types (tests excluded) | 6576 |
| CLI commands | 16 |
| folders directly under `framework/` | 3 |
| schemas in `schemas/` (with `schemas/data/`) | 19 |
| top-level folders in the repo | 11 |

`bay check --limits` counts each measure. A count above its ceiling fails. A count below its ceiling is written to `limits.yaml` by the same change; that is the new ceiling (a ratchet). Lowering is free.

Raising a ceiling needs an exception in the proposal front matter: `exceptions: [{ measure, to, reason }]`. The owner's approval of the proposal is the owner's approval of the exception. No front matter entry, no raise. The new check module counts against itself, so 0009 lands with its own numbers.

### 2. Test ceilings

- Test count: no net growth. A change that adds a test removes or merges at least one the change made obsolete. The ceiling is the count when 0009 lands.
- Suite wall time: measured and reported by `tests/run.py` from the first run. Once section 5 has landed, the owner sets the ceiling from the measured time. It is then checked like the others.

### 3. Per-function limits

Complexity 30 and 150 lines per function, enforced by the `deadcode` step, stay as they are.

### 4. Leaner process (forge.extend rules)

- One independent Opus review per change.
- A second round only for a blocker or a security finding. Nits and should-fix items go to a list in the result; they are not a fix round.
- The fix round's result is the implement result. No confirmation pass.
- `touches:` may name a folder (`path/`). A rename inside it needs no amendment.
- An amendment is for a change of scope or design only. A file a rename reached is not one.
- HANDOFF.md keeps only the current work. History is in git.
- A review that runs out of budget is resumed, never re-run from the start. The resume logs a `review.overrun` warning in the ledger: the items left, the budget used, and the time sinks in a few words (e.g. "test suite 2 runs, 6 min; read 40 files of a 288-path diff"). improve reads these to find what to make faster. The reviewer's Result lists its time sinks so the warning can say them.
- A review gets the generated role file verbatim and the step plan; cos adds scope, not opinions.

### 5. Faster tests, every assertion kept

From the test audit. Together they are estimated to save 40 to 70 seconds of the 2 minutes.

- Cache parsed YAML in `model.Kit`; `kit_copy` hard-links and copies only the edited file.
- Guard decisions run in-process; three subprocess tests keep the hook contract (exit code, JSON shape, fail closed).
- One built project per test file where tests only read it.
- Per-test timing and a "slowest 15" line in `tests/run.py`.

## Not included

- No line limit per file, no new lint rules, no new CLI command.
- No deleting of tests or features here. Removing the audit's 11 obsolete and duplicate tests is a normal change under the test rule.
- No change to review depth for security findings, the approval gate, or any guard rule.
- No ceiling on docs, proposals or connectors.
- No cap on test time until the speed-ups are measured.

## Open questions

1. Should the check run for every change or only for `forge.extend`? Recommendation: `forge.extend` and `bay check --limits` by hand. Other modes do not change the framework.
2. Is `framework/limits.yaml` better as a block in `components.yaml`? Recommendation: the separate file. It is one number per line, and the ratchet edits it every time.
3. Should the test ceiling be a count or a time? Recommendation: both. Count stops growth now; time can be set after section 5.

## Safety impact

None. The check and the rules only refuse. No guard, approval or secret rule changes. Review is still mandatory on every change; only the rounds after a clean first one go.

## Effort

About 1 builder stage. `bay/limits.py` and its test are small. The test speed-ups are the larger part. One Opus review.
