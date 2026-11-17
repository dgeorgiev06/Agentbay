# Brief TR2: trust, slice two: the broker says why a list is not in force, and reads the record again before each command

Capability slice in the broker. For one builder. Words are used as `CONTEXT.md` defines them. Practices are cited by id from `framework/practices.md`.

## Input

- Branch `tr2/broker-trust`, cut from `feat/0022-agentbay5`, in the worktree you are given.
- `docs/adr/0019` (the broker's design: every operation is a table entry with a rule that gives a ruling), `docs/adr/0021`, `docs/designs/trust/0-frame.md`, `B-owner.md` (section 4, "A refused run", and slice 2 of section 9), `C-defence.md` and `comparison.md` (the comparison at use, in its cheap form), `docs/briefs/TR1-trust-the-record-and-the-grant.md`.
- `framework/practices.md`, `components/base/typescript/practices.md`, `framework/features.yaml`, `CONTEXT.md`.
- Slice TR1 is merged. `ModeGrants.listTrust` is one of: not needed; trusted (with the entry); never trusted; changed (with the entry trusted before); unreadable record (with the guard's problems). When it is one of the last three, `grants.commands` and `grants.throwawayPaths` are empty, and the broker today answers as for an unknown command name ("its mode lists the commands: none") or a folder the mode does not keep ("keeps throwaway folders only in: nothing"). Both are true and neither tells the owner what to do. `readTrustRecord(files, layout)` and `listHashOf` are in `bay/trust.ts`.
- Grants are loaded once when the kernel starts a command. A step of a long run, or a session that stays open, keeps using a list that was trusted when it loaded, after the owner has withdrawn the trust.

## Output

1. A request to run a listed command, from a mode whose list is not in force, is refused with a sentence in the broker's usual three parts that says which of the three reasons applies and what the owner does: never trusted; changed since the owner trusted it, with the day; the record cannot be read, with the guard's first sentence. The last part names the command the owner types. The same for each operation on a throwaway folder (`makeFolder`, `link`, `remove`). The design's sentences are the starting point.
2. The reason is asked in one place: one function from the grants to "in force" or the refusal's middle and last parts, used by the command rule and the throwaway rules. A command name the mode does not list at all keeps today's sentence when the list is in force, and gets the trust sentence when it is not (the owner's next step is the same either way; say in the report which you chose for a name that is in neither the manifest nor the record, and why).
3. Before a listed command of a trusted project mode runs, and before each throwaway operation of one, the broker reads the trust record again and compares the entry's hash for that mode with the hash the grants were loaded with. No entry, another hash, or a record that cannot be read: the request is refused with the matching sentence of output 1, plus the fact that the trust changed after this run loaded it. A base mode's commands never read the record. The read goes through the file port the broker already has; the report states its cost per command as measured.
4. What an agent's shell is given (`reachOf`) is unchanged.
5. A report.

Out of scope: giving trust (TR3, in flight); `bay check`'s findings (TR4); the test toolbox's option (TR5).

## Definition of done

- [DOD-TR2-1] (must) Output 1, tests first and seen failing, through the broker's entry, with the literal sentence for: a command and each of the three throwaway operations, in each of the three states. The sentences pasted at the top of the report with the design's beside them and a reason for each difference (P-28).
- [DOD-TR2-2] (must) Output 2: the one function pasted; `grep` shows no second place that reads `listTrust.state` in the broker except `reachOf`'s.
- [DOD-TR2-3] (must) Output 3, tests first and seen failing: a run loaded with trust, then the record's entry removed before the command, is refused with its literal sentence and the command's program is never started (prove with a command that would leave a file); the same with the entry replaced by one for another list; the same with the record made unreadable; with the record unchanged the command runs; a base mode's command runs with the record unreadable and the test shows the record was not read for it.
- [DOD-TR2-4] (must) An end-to-end test through the command line in a made-up project: a trusted project mode's script runs its command; trust is withdrawn by rewriting the record with `recordWithoutTrust`; the next call is refused with the sentence. No test writes the record by a path of its own: use `tests/system-fixture.ts`'s helper or `bay/trust.ts`'s functions.
- [DOD-TR2-5] (must) Nothing changes for the kit: the capture, start and final back to back with a copy of the script that has a scratch folder of your own (and its `here=` line pointing at /home/claude/m5-capture), differs only where a fixture's project mode lists a command; every differing file named.
- [DOD-TR2-6] (must) Boundaries: manifests, runs and broker stay sealed; neither debt list grows; the detector count does not rise.
- [DOD-TR2-7] (must) Bug injection (P-18, P-31): at least 10 bugs, one at a time, in a throwaway copy that is a git repository, with time limits and results saved as you go. Include: the record is not read again; the record is read again and the result ignored; a removed entry still runs; an entry for another list still runs; an unreadable record at use still runs; a base mode's command is refused when the record is unreadable; the never-trusted sentence is shown for a changed list; a throwaway operation skips the check; the command starts before the check. Each caught, or a test added.
- [DOD-TR2-8] (must) `npm run check` passes. Size before and after per file, never targeted (P-13).

## Instructions

1. Run `npm run check` before any edit and wait for it (nohup and poll). Record test count, time, kernel line count, debt counts by rule, detector count.
2. Read `bay/broker/rule.ts` and how a `Definition`'s rule gives a ruling before its handler runs. The check at use belongs in the rule, not the handler, so that nothing starts before it (ADR 19). Write in the progress note where each function goes before code (P-35).
3. Sentences first, tests first. Then the one function. Then the read at use. A commit each.
4. Regenerate the debt lists. Inject the bugs. Capture and diff. `npm run check`. Commit. Report.

## Tools

As in `docs/briefs/K1-grants-in-one-place-and-a-split-file-port.md` under "Tools", with outputs under `/tmp/tr2-capture/`.

## Resources

`bay/broker/rule.ts`, `command-operations.ts`, `file-operations.ts`, `step-broker.ts`, `broker.ts`, `bay/trust.ts`, `bay/contracts.ts` (`ListTrust`), `bay/answers.ts` (the three parts of a refusal), `tests/inside/broker/`, `tests/script-commands.test.ts`, `tests/system-fixture.ts` (`trustRecordFiles`), `tests/manifests-grants.test.ts`.

## Rules and constraints

- P-01 no comments. P-04 readable before short. P-05: the reason is a closed set, matched exhaustively. P-11 replace and delete. P-12 one place. P-15, P-16 literal expected values. P-17 test first, seen failing. P-25: if you must change course, stop and report. P-28: these sentences are read by the owner. P-29, P-30. P-35.
- TypeScript: `components/base/typescript/practices.md`.
- Fail closed: any doubt about the record at use refuses a project mode's command. A base mode never depends on the record.
- The kernel's own words never claim more than trust gives (ADR 21). Reading the record again makes a withdrawal reach an open run; it does not stop an agent that has the owner's shell from rewriting the record, and no sentence may suggest it does.
- A refusal never echoes the arguments' values beyond what today's command refusals already show; say in the report what they show.
- Write scope: `bay/broker/command-operations.ts`, `file-operations.ts`, `rule.ts` if the rule needs a port it lacks, a new private file in `bay/broker/` if the one function needs a home, tests, the feature map. `bay/trust.ts` only to add a reader of one mode's entry if none fits, named in the report. Nothing under `components/` or `adapters/`. Anything else is named at the top of the report with its reason.
- Another builder is working in a different worktree on `bay/commands/approve.ts`, `bay/trust.ts` (adding a fingerprint field and a writer) and `knip.json`. Keep any change to `bay/trust.ts` to one added function, so the two merge cleanly.
- To stop a check of your own, kill it by its process id. Never use `pkill` or `killall` with a pattern.
- The full check takes twelve to eighteen minutes: nohup and poll. Never run `node --test` with an empty file list. A check that ends "Terminated" or exit 143 was stopped from outside; run it again.
- Commit after every step that passes typecheck and its tests; keep `/tmp/tr2-progress.md` current. Never pipe a check whose exit status you rely on.
- Formatting uses the project's configuration; never run prettier without `--config components/base/typescript/prettier.json`, and never with `--write` on a folder.
- Never read or print real secrets. Never push. Never touch `main` or another worktree.
- Report (P-22), in plain English and short sentences: anything beyond the brief first, with the sentences; each DOD item with pasted output; the bug-injection table; what TR4 and TR5 need to know; what you did not do; what you did not verify.
