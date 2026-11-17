# Brief TR4: trust, slice four: `bay check` says which modes wait for trust, what a trusted mode may run, and which scripts changed

Capability slice in check, with one case added to the trust command. For one builder. Words are used as `CONTEXT.md` defines them. Practices are cited by id from `framework/practices.md`.

## Input

- Branch `tr4/check-trust`, cut from `feat/0022-agentbay5`, in the worktree you are given.
- `docs/adr/0020`, `docs/adr/0021` (the last decision: when a trusted mode's scripts change and its list does not, `bay check` reports which files changed and the trust stands), `docs/designs/trust/B-owner.md` (section 4 has the four findings as drawn; section 5 what the fingerprint covers; slice 4 of section 9), `docs/briefs/TR1-…` and `TR3-…`.
- `framework/practices.md`, `components/base/typescript/practices.md`, `framework/features.yaml`, `CONTEXT.md`.
- Slices TR1 and TR3 are merged. `ModeGrants.listTrust` holds the state and, with it, the list or the entry. `TrustGiven.scripts` maps each script file's path to the hash of its text on the day of trust; `scriptFilesOf(files, folder, paths)` and `changedScriptFiles(before, now)` in `bay/trust.ts` give the names. `bay check` today warns once per listed command for base modes only (`checkBaseCommands` in `bay/check.ts`) and prints nothing about a project mode's list. `bay approve --trust <mode>` on a mode already trusted for its list is refused with "already trusted"; so the design's fix "decide again: bay approve --trust" does not work when only scripts changed.
- Grants exist only when the project loaded without other problems; say what `bay check` prints about trust when it did not.

## Output

1. A project mode whose list waits for trust gets one warning that says how many commands and throwaway folders it lists, that none is granted, and the command the owner types. One for never trusted; one for changed since the day it was trusted, with what was added, removed and changed as counts.
2. A trusted project mode gets one warning per command, as base modes get today, that also says when and how the trust was given and how to withdraw it. Base modes keep today's warning unchanged. The tier filter that made the warning base-only is deleted; one function draws a command's warning for both.
3. A trusted project mode whose script files changed since the day of trust gets one warning that names the files (added, removed, changed), says the list did not change so the trust stands, and gives a fix that works.
4. The fix that works: `bay approve --trust <mode>` on a mode trusted for its list whose scripts changed prints a short card (the list is as trusted; these script files changed; when and how it was trusted) and, on the owner's answer by either channel under the same rules as giving trust, records the new fingerprint with the same list. With no script changed it stays refused as "already trusted". The card's lines are drawn in the card's file, at most 44 columns, file names wrapped and never cut.
5. A record that cannot be read is one error in `bay check`, with the guard's sentence and fix, whether or not a project mode lists anything (today it is silent when none does). Say in the report why it is an error and not a warning, or argue the other way and stop.
6. A report.

Out of scope: the broker (TR2, in flight); the test toolbox's option (TR5); the adapter (TR6).

## Definition of done

- [DOD-TR4-1] (must) Outputs 1 to 3 and 5, tests first and seen failing, through `bay check`'s entry in a made-up project, each finding pinned as a literal with its file, line, severity, message and fix: never trusted; changed; trusted with two commands; scripts changed (one added, one removed, one changed); unreadable record. The findings pasted at the top of the report with the design's beside them and a reason for each difference (P-28).
- [DOD-TR4-2] (must) Output 2: `bay check` on the kit prints the same 30 warnings as before, byte for byte. The one function pasted.
- [DOD-TR4-3] (must) Output 4, tests first and seen failing, through the command line: the card as one literal; `yes` at a terminal writes the literal record with the new fingerprint and the same list and hash; anything else changes nothing; chat follows every rule the trust tests already pin (reuse the rule, do not copy it); after it, `bay check` no longer reports the scripts; with no script changed, "already trusted" as before.
- [DOD-TR4-4] (must) JSON output of `bay check` carries the new findings in the shape findings already have; no new shape.
- [DOD-TR4-5] (must) Nothing else changes: the capture, start and final back to back with a copy of the script that has a scratch folder of your own (and its `here=` line pointing at /home/claude/m5-capture), differs only where a fixture's project mode lists a command; every differing file named and explained.
- [DOD-TR4-6] (must) Boundaries: manifests, runs and broker stay sealed; neither debt list grows; the detector count does not rise.
- [DOD-TR4-7] (must) Bug injection (P-18, P-31): at least 10 bugs, one at a time, in a throwaway copy that is a git repository, with time limits and results saved as you go. Include: a waiting mode gets no finding; a changed list is reported as never trusted; a trusted mode's command is not shown; a changed script is not reported; an added script is not reported; a changed script withdraws the trust; recording the scripts again changes the list or its hash; recording again without `yes`; the unreadable record is silent; a base mode's warning changes. Each caught, or a test added.
- [DOD-TR4-8] (must) `npm run check` passes. Size before and after per file, never targeted (P-13).

## Instructions

1. Run `npm run check` before any edit and wait for it (nohup and poll). Record test count, time, kernel line count, debt counts by rule, detector count.
2. Read `bay/check.ts` and how a finding gets its file and line; read `bay/commands/approve.ts`'s trust path and `bay/trust-card.ts`. Write in the progress note where each function goes before code (P-35).
3. Findings first, tests first, a commit per finding. Then the approve case. 
4. Regenerate the debt lists. Inject the bugs. Capture and diff. `npm run check`. Commit. Report.

## Tools

As in `docs/briefs/K1-grants-in-one-place-and-a-split-file-port.md` under "Tools", with outputs under `/tmp/tr4-capture/`.

## Resources

`bay/check.ts` and the files of the check feature, `bay/trust.ts`, `bay/trust-card.ts`, `bay/commands/approve.ts`, `bay/commands/check.ts`, `bay/contracts.ts`, `tests/check.test.ts`, `tests/check-fixture.ts`, `tests/kit-check.test.ts`, `tests/approve-trust.test.ts`, `tests/system-fixture.ts`.

## Rules and constraints

- P-01 no comments. P-04 readable before short. P-05: the states are a closed set, matched exhaustively. P-11 replace and delete. P-12 one place. P-15, P-16 literal expected values. P-17 test first, seen failing, before the code. P-25: if you must change course, stop and report. P-28: every sentence here is read by the owner; follow the design's words and list each departure. P-29, P-30. P-35.
- TypeScript: `components/base/typescript/practices.md`.
- All trust findings except the unreadable record are warnings: the project is sound.
- The kernel's own words never claim more than trust gives (ADR 21). A changed script is reported, never blocked; the sentence says the scripts choose the arguments of the mode's commands.
- File names from a mode's folder are shown harmlessly, as the card shows a command's words.
- Write scope: `bay/check.ts` and the check feature's private files, `bay/commands/approve.ts` and `bay/trust-card.ts` for output 4 only, `bay/trust.ts` only if a function is missing (named in the report), tests, the feature map. Nothing under `components/`, `adapters/` or `bay/broker/`. Anything else is named at the top of the report with its reason.
- Another builder is working in a different worktree on `bay/broker/` and may add one function to `bay/trust.ts`.
- To stop a check of your own, kill it by its process id. Never use `pkill` or `killall` with a pattern.
- The full check takes thirteen to eighteen minutes: nohup and poll. Never run `node --test` with an empty file list. A check that ends "Terminated" or exit 143 was stopped from outside; run it again.
- Commit after every step that passes typecheck and its tests; keep `/tmp/tr4-progress.md` current. Never pipe a check whose exit status you rely on. Remove any demo project you make under /tmp before you report.
- Formatting uses the project's configuration; never run prettier without `--config components/base/typescript/prettier.json`, and never with `--write` on a folder.
- Never read or print real secrets. Never push. Never touch `main` or another worktree.
- Report (P-22), in plain English and short sentences: anything beyond the brief first, with the findings and the card as printed; each DOD item with pasted output; the bug-injection table; what TR5 and TR6 need to know; what you did not do; what you did not verify.
