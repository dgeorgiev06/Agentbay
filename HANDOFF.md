# HANDOFF: 0008 slice 9 (version 1.0.0)

Branch feat/0008-slice9 from origin/main e20e165 (0.10.0). Parts 1, 2a, 2b, 3a, 3b and 3c are committed; nothing is pushed. Plan: docs/plans/0008-simplify-without-losing-features.md. This file holds the current work only; the earlier parts are in git log and CHANGELOG 1.0.0.

## State after 3c

- Version 1.0.0 (`bay/__init__.py`), CHANGELOG 1.0.0 (Added, Changed, Removed, Security, Known issues; the 0.10.0 known issue about review rounds and the 0.9.0 one about the `protected:` block are fixed and said so).
- README, docs/DESIGN.md and docs/INTERFACES.md read against the code: plan step and `approvals.plan`, the two-prefix chat sha (`<proposal>+<plan>`), the scoped re-check, the review halting rule, `check --limits --write` and the base-ceiling rule, v3 and its refusal, schema moves, the pre-approved list `show|status|note|catalog`, a weekly improve cron line in the README. B-11 docs: 0 hits.
- Ratchet written once (`check --limits --write`) and committed in framework/limits.yaml: bay_lines 9620 (was 9621), kit_python_lines 6588 (was 6589), schemas 15 (was 19), tests 536 (was 546); cli_commands 16, framework_folders 3, top_level_folders 11 unchanged.
- Correction to the 3b note: its commit changed 103 files, not 96.
- Guard: 3b and 3c ran with the guard off, as parts 1 to 3a did (owner decision 2).

## Coordinator evidence (run by the coordinator in the main thread, 2026-10-31, after 3b at 9936946)

- Scratch project with only agentbay.config.yaml (`offline: true`): `./bay.sh build --project <scratch>` wrote .agentbay/, .claude/, CLAUDE.md; last line "! Per-role Bash scope is enforced by the agentbay guard hook; restart Claude Code and accept the workspace trust prompt so hooks run."
- `./bay.sh clean --project <scratch>`: last line "clean"; left only agentbay.config.yaml.
- Fake-source demo after a fresh build: `bay call feed-briefing.sync '{}'` -> done, fetched 7, added 7, spentUsd 0.0 (source fake); `bay call mail-briefing.sync '{}'` -> done, fetched 6, added 6, spentUsd 0.0 (source fake-mail).
- Clean after the demo leaves agentbay.config.yaml and .agentbay/data (the synced corpus; clean keeps user data).
- `python3 tests/run.py tests/test_offline_golden.py tests/test_mail_briefing.py` -> 16 passed, 0 failed.

## Review fixes (part 3d)

The slice 9 review failed DOD-5, DOD-8, DOD-9, DOD-13, R-4 and R-7 (all should-fix or nit). Fixed: the docs and CHANGELOG say any failed must item or blocker halts before release, and the halting test fails a must item rated should-fix; `recheck.commits` is a `<sha>..HEAD` range or null; `scaffold.proposal` uses `PROPOSAL_PATH` and a named `plan_reason`; `boundary.git` is public (dispatch no longer calls a private helper); fake.py's condition is parenthesised. To pay for `plan_reason`, `selector.vals` replaces the same function copied in selector, gmail-api, x-api and fake (corpus-store no longer calls the private `_vals`), and a trailing blank line in ledger_sources.py went. The removed `return None` lines stay removed (no line budget for them).

## Last lines of the checks (3d builder, after the code commit; the docs-only commit after it changed no code)

- `python3 tests/run.py -q`: "536 passed, 0 failed in 152.8s (2 workers)".
- `./bay.sh check --limits --base origin/main --proposal docs/proposals/0008-simplify-without-losing-features.md --docs` (no `--write`; exit 0). Boundary line: "boundary origin/main...HEAD: 160 changed paths (59 core, 3 docs, 53 extension, 16 feature, 29 other); 0 failing; B-11 docs: 0 hits". Last line: "✓ limits: 7 measures within their ceilings". It also prints that bay_lines is 9618 against 9620 and kit_python_lines 6584 against 6588 ("the ceiling is now ..."); nothing was written, so the release step's `--write` records those two lower ceilings.

## Needs the owner before release

- The B-3 failures are fixed (5984063 added the feature folders to touches); the check above reports 0 failing.
- `framework/limits.yaml` still says bay_lines 9620 and kit_python_lines 6588; the release step's `check --limits --write` lowers them to 9618 and 6584.
- Run `./bay.sh build` once so the generated builder file lists `git mv`, `git rm` and `bay plan` (3a item 3).

## Not in this slice

improve reading `review.overrun` notes (adds code, owner deferred); the `tests:` keys in framework/components.yaml that name missing contract test files; audit renames and moves of test files; the per-call `uses:` scope; deleting `proposal.load_touches` (kept for its test, bay/proposal.py is not in 0008's touches).
