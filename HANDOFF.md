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

## Last lines of the checks (3c builder)

- `python3 tests/run.py -q`: "536 passed, 0 failed in 151.3s (2 workers)".
- `./bay.sh check --limits --write --base origin/main --proposal docs/proposals/0008-simplify-without-losing-features.md --docs`: last line "✓ limits: 7 measures within their ceilings"; lint clean; "✓ 6 modes, 21 features, 5 roles (18 role units), 8 envs, 13 connectors resolve (agent profile claude-code)". Boundary line: "153 changed paths (54 core, 2 docs, 52 extension, 16 feature, 29 other); 12 failing (B-3: 12); B-11 docs: 0 hits". The command exits 1 because of the B-3 failures below.

## Needs the owner before release

- 12 B-3 failures: the feature rules.yaml files that 3b changed (apiVersion v3) in modes/cos/features/{next,run,status}, modes/delivery/features/{build,research}, modes/forge/features/create and modes/improve/features/{audit,backlog,implement,scan,triage,verify}. 0008's touches name only modes/forge/features/extend/, not these folders. Earlier parts' checks did not see them because 3b's edits were uncommitted at that time. Fix: add `modes/` (or the six feature folders) to the touches of docs/proposals/0008-simplify-without-losing-features.md (an amendment; the proposal sha changes and the gate asks again), then re-run the check; limits.yaml needs no second write.
- Run `./bay.sh build` once so the generated builder file lists `git mv`, `git rm` and `bay plan` (3a item 3).

## Not in this slice

improve reading `review.overrun` notes (adds code, owner deferred); the `tests:` keys in framework/components.yaml that name missing contract test files; audit renames and moves of test files; the per-call `uses:` scope; deleting `proposal.load_touches` (kept for its test, bay/proposal.py is not in 0008's touches).
