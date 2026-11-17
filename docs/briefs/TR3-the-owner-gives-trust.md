# Brief TR3: trust, slice three: the owner gives trust: the card, `bay approve --trust`, and writing the record

Capability slice in the command line. For one builder. Words are used as `CONTEXT.md` defines them. Practices are cited by id from `framework/practices.md`.

## Input

- Branch `tr3/give-trust`, cut from `feat/0022-agentbay5`, in the worktree you are given.
- `docs/adr/0020` (item 1), `docs/adr/0021` (the decision; where it differs from design B as written, the ADR wins), `docs/designs/trust/0-frame.md`, `B-owner.md` (sections 1, 2, 5, 6 and 8, and slice 3 of section 9: every card is drawn there, column by column), `comparison.md`, `docs/briefs/TR1-trust-the-record-and-the-grant.md`.
- `framework/practices.md`, `components/base/typescript/practices.md`, `framework/features.yaml`, `CONTEXT.md`, `docs/adr/0009` (approvals and their channels).
- Slice TR1 is merged. `bay/trust.ts` has `readTrustRecord`, `listHashOf`, `recordWithTrust(record, list, { at, by })` and `recordWithoutTrust(record, mode)`, which return the file's text; nothing writes the file yet. `listOf(manifest)` is in `bay/policy.ts`. `ModeGrants.listTrust` says why a list is or is not in force. `knip.json` ignores unused exports of `bay/trust.ts` until this slice uses them.
- Two things in the design are no longer true and must not be built: the record has no `scripts` field yet (this slice adds it, see output 4), and the card's last line "Run bay build so its skill steps get the commands" is false, because an agent's own shell is never given a project mode's commands. The sentence after trust is given says what is true: the mode's scripts may run its commands from the next step.

## Output

1. `bay approve --trust <mode>` prints the card for that mode, drawn by the kernel from the mode's list as it stands: the mode and its folder, every command with its resolved words and effects, every throwaway folder, the four sentences on what the trust means, and a short form of the hash. At most 44 columns wide. A long command wraps and is never cut: the owner must be able to read every word he trusts.
2. At a terminal, the owner types `yes` and the record is written; anything else changes nothing and says so. The record's file is created for the owner only, as the kernel's database is.
3. Where the shell is not a terminal, the command prints the card, changes nothing, and says how trust is given: at a terminal, or, when the project's config lists chat under `approvals.from`, by running the command again with the full hash, the channel, and the owner's exact words quoted. The kernel accepts that only when the config lists chat, the hash is the full hash of the list the mode has at that moment, and the quote contains the mode's name. The quote is recorded with the trust. Every refusal has its own sentence.
4. The record gains a fingerprint of the mode's script files on the day of trust (design section 5 says what it covers), written here and read by slice TR4. It is not part of the list's hash, by the owner's decision: a changed script is reported and the trust stands.
5. When the mode's list has changed since it was trusted, the card shows what was added, what was removed, what changed with the words it had before, one line for what stayed, and how many script files changed. The card says when and how the trust was given.
6. `bay approve --trust <mode> --reject` withdraws trust after a `yes`, with the card the design draws.
7. Every other case has a sentence and exits non-zero without changing anything: no such mode; a mode that lists nothing; a mode of the kit's base (it needs no trust); a mode already trusted for this list (say so, with when and how); a record that cannot be read (the guard's sentences, and the fix).
8. The `knip.json` exception for `bay/trust.ts` is deleted. `--help` and the adapter-independent usage text name the new form. `CONTEXT.md` gains Card only if the word is not already defined in a way that covers this.
9. A report.

Out of scope: the broker's refusal sentences and reading the record before each command (TR2); `bay check`'s findings (TR4); the test toolbox's option (TR5); the coordinator's text in `adapters/` (TR6).

## Definition of done

- [DOD-TR3-1] (must) Output 1: the card for a made-up mode with three commands and one throwaway folder, pasted in the report exactly as printed, and pinned by a test as one literal string. Tests, first and seen failing: no line longer than 44 columns for a mode whose command has 200 characters of words, and every word of that command present in the card in order; the hash shown is a prefix of the hash recorded.
- [DOD-TR3-2] (must) Outputs 2 and 3, tests through the command line's entry with literal expected output and exit status: `yes` at a terminal writes the literal record text; `y`, `Yes ` with other words, an empty line and end of input each change nothing; not a terminal changes nothing and prints the literal sentence with the full hash; chat is refused when the config does not list it, when the hash is of another list, when the hash is the short form, when the quote lacks the mode's name; chat accepted records the literal quote. The file's mode bits are pinned.
- [DOD-TR3-3] (must) Output 5: the difference card for a list with one command added, one removed, one whose words changed, one whose effects changed, a throwaway folder added, and the rest unchanged, pasted and pinned as one literal string. After `yes`, the mode's list is in force through `loadSystem`.
- [DOD-TR3-4] (must) Outputs 4, 6 and 7, each with a test seen failing first and its literal sentence. The fingerprint changes when a script file's content changes, when one is added or removed, and does not change when a file outside the mode's scripts changes; the list's hash does not change with it.
- [DOD-TR3-5] (must) What the kernel's words claim. `grep` the new sentences for "secure", "safe", "cannot", "prevents", "guarantee" and paste the result with a line on each hit. No sentence says or implies that trust stops an agent that has the owner's shell or the owner's voice in chat.
- [DOD-TR3-6] (must) Nothing changes for the kit: the capture, start and final back to back with a copy of the script that has a scratch folder of your own, differs nowhere except usage text; every differing file named.
- [DOD-TR3-7] (must) Boundaries: manifests, runs and broker stay sealed; the card is a private file of the feature the report argues it belongs to; the record's path stays private to `bay/trust.ts`; neither debt list grows; the detector count does not rise.
- [DOD-TR3-8] (must) Bug injection (P-18, P-31): at least 14 bugs, one at a time, in a throwaway copy that is a git repository, with time limits and results saved as you go. Include: anything but `yes` gives trust; not a terminal gives trust; chat accepted when the config does not list it; chat accepted with a hash of an older list; chat accepted with the short hash; the quote is not checked; the quote is not recorded; the card omits a command; the card cuts a long command; the card shows the unresolved words (without the starting words); the difference card hides a changed word; the difference card hides a changed effect; `--reject` without `yes` withdraws; the record is written for everyone to read; trust for one mode writes another's entry. Each caught, or a test added.
- [DOD-TR3-9] (must) `npm run check` passes. Size before and after per file, never targeted (P-13).

## Instructions

1. Run `npm run check` before any edit and wait for it (nohup and poll). Record test count, time, kernel line count, debt counts by rule, detector count.
2. Read how `bay approve` decides a run's approval today: the channels, how it knows a terminal, how it records who decided. Trust is a second subject of the same command and reuses those, not copies of them. Write in the progress note where each new function goes before code (P-35).
3. The card as a pure function from a list (and, for the difference, the list trusted before) to lines, tests first. Then the terminal path. Then chat. Then the fingerprint. Then withdrawing and the other cases. A commit each.
4. Regenerate the debt lists. Inject the bugs. Capture and diff. `npm run check`. Commit. Report.

## Tools

As in `docs/briefs/K1-grants-in-one-place-and-a-split-file-port.md` under "Tools", with outputs under `/tmp/tr3-capture/`.

## Resources

`bay/commands/approve.ts`, `bay/cli.ts` or wherever commands are parsed and usage is printed, `bay/trust.ts`, `bay/policy.ts` (`listOf`), `bay/contracts.ts`, `bay/owner-only.ts`, `bay/manifests/manifests.ts` (`loadSystem`), `tests/trust.test.ts`, the tests of `bay approve`, `tests/system-fixture.ts` (`trustRecordFiles`), `schemas/config.schema.json` (`approvals.from`), `knip.json`, `framework/features.yaml`.

## Rules and constraints

- P-01 no comments. P-04 readable before short. P-05 model the domain in types: what the command decided is one of a closed set, each with its sentence. P-11 replace and delete. P-12 one place: the card's lines, and the rule for when chat may give trust. P-15, P-16 literal expected values. P-17 test first, seen failing. P-19: the card is proven on the real thing by the owner later; say in the report exactly what he should try at a terminal and in chat. P-25: if you must change course, stop and report. P-28: every sentence here is read by the owner; follow the design's words, and list at the top of the report each place you departed from them and why. P-29, P-30. P-35.
- TypeScript: `components/base/typescript/practices.md`.
- The card shows only what the kernel resolved from the manifest. Nothing from a script, a skill or a previous run reaches it. Characters that could redraw a terminal (escape sequences, carriage returns) in a command's words or a folder's name are shown harmlessly; test it.
- Fail closed: any doubt changes nothing and exits non-zero.
- The kernel's own words never claim more than trust gives (ADR 21, "What trust is and is not").
- Write scope: `bay/commands/approve.ts`, a new private file for the card, `bay/trust.ts`, the usage text, `knip.json`, tests, the feature map, `CONTEXT.md`. Nothing under `components/` or `adapters/`. Anything else is named at the top of the report with its reason.
- Other builders may be working in different worktrees on `bay/broker/`, `bay/check.ts`, `bay/check-imports.ts`, `schemas/mode.schema.json` and `tests/test-toolbox.ts`. Do not edit those.
- To stop a check of your own, kill it by its process id. Never use `pkill` or `killall` with a pattern: another builder's run matches it.
- The full check takes twelve to eighteen minutes: nohup and poll. Never run `node --test` with an empty file list. A check that ends "Terminated" or exit 143 was stopped from outside; run it again.
- Commit after every step that passes typecheck and its tests; keep `/tmp/tr3-progress.md` current. Never pipe a check whose exit status you rely on.
- Formatting uses the project's configuration; never run prettier without `--config components/base/typescript/prettier.json`, and never with `--write` on a folder.
- Never read or print real secrets. Never push. Never touch `main` or another worktree.
- Report (P-22), in plain English and short sentences: anything beyond the brief first, with every departure from the design's words; the cards as printed; each DOD item with pasted output; the bug-injection table; what the owner should try; what TR4 and TR6 need to know; what you did not do; what you did not verify.
