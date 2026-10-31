# HANDOFF: T-20261031-7328 - 0009 section 5, faster tests

Outcome: done. Branch docs/0009-simplicity-constraints, not pushed. 546 tests kept, every assertion kept; the proposal is not edited.

## Commits
- 06d5097: `tests/run.py` prints per-test time, a "slowest 15" line and the wall time.
- 39b130c: `bay/model.py` `load_yaml` keeps parsed YAML by file identity (device, inode), mtime and size, and never keeps a file touched in the last 2 s; callers get a deep copy. `tests/helpers.py` `kit_copy` hard-links files in the kit's folders (top-level and dot files are copied) and `Path.write_text`/`write_bytes` break a link before writing, so the kit is never changed. `tests/test_resolver.py` rewrites a cached file in place (same size) inside an existing test to prove nothing stale is served.
- f80e9f7, 8963f0a: `tests/run.py` runs files in parallel (`-j N`, default one worker per CPU; `python3 tests/run.py <file>` runs one file; a file's tests stay in order); `tests/test_boundaries.py` decides in-process through `Guard.decide`, keeps three subprocess tests for the hook contract (exit code 2 and JSON shape, fail closed, main thread gives no decision), and shares one built project across 12 read-only tests; `framework/roles/builder.yaml`: targeted tests while working, the full suite once before the commit. `bay/lint.py` was touched and put back (not in touches).

## Numbers (runner's own timing, full suite)
- Before: 556.6s, one worker.
- After, `-j 1`: 285.5s. After, default, 2 workers: 150.7s (about 3.7x faster than before).
- Deviation from the proposal wording: the cache key uses (device, inode) instead of the path, so the hard-linked copies of a kit share one parse; a changed file has a new mtime or size, and a file changed in the last 2 s is never kept.
- Slowest now: deadcode unused-concept test 24.6s, improve golden 13.3s, stage syntax table 12.9s, audit on the kit 10.0s, moving-files deadcode 9.0s, protection fail-closed 8.7s, artifact graph 5.7s, unused role 5.1s. These are one-off kit scans; the rest are under 4s.

## Evidence
- `python3 tests/run.py -q`: `546 passed, 0 failed in 150.7s (2 workers)`
- `./bay.sh check`: `✓ 6 modes, 21 features, 5 roles (17 role units), 8 envs, 13 connectors resolve (agent profile claude-code)`
- `./bay.sh check --limits --base origin/main --proposal docs/proposals/0009-simplicity-constraints.md --docs`: `boundary origin/main...HEAD: 24 changed paths (6 core, 3 docs, 2 extension, 2 feature, 10 other, 1 unowned); 0 failing; B-11 docs: 0 hits`, then `✓ limits: 7 measures within their ceilings`

## Followups
- The guard decisions moved in-process no longer write `permission.denied` ledger events; only the subprocess tests do.
- `framework/components.yaml` `tests:` keys name `tests/contracts/mode.py` and its siblings, which do not exist (test audit).
- `test_improve_golden` counts one stale doc reference in the kit's docs besides HANDOFF.md's own; it follows this file.
