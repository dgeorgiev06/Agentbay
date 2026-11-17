# Brief B5: the remaining operations become entries, and the class and the old rule file are deleted

Capability slice in the kernel, the fifth of the chain in `docs/adr/0019`. For one builder. Words are used as `CONTEXT.md` defines them. Practices are cited by id from `framework/practices.md`.

## Input

- Branch `b5/all-entries`, cut from `feat/0022-agentbay5`, in the worktree you are given.
- `docs/adr/0019`, `docs/designs/operations/A-smallest.md` (sections 1, 2, 5, 7, 9, 10, 11 and 12; this is slice 5 of section 11), `docs/designs/operations/trial.md` (the web request written with a ruling: its ruling carries a rule for redirects that the handler asks at each hop), `docs/designs/operations/0-frame.md` (what must stay true).
- `docs/briefs/B4-files-and-database-become-entries-with-rulings.md` and the code it produced: `bay/broker/rule.ts` (the definition, the ruling, the one answering function), `bay/broker/file-operations.ts`, `bay/broker/database-operations.ts`, `tests/broker-proofs.test.ts`. This slice does for the rest what B4 did for files and the database, in the same form.
- `framework/practices.md`, `components/base/typescript/practices.md`, `framework/features.yaml`, `CONTEXT.md`, `docs/adr/0003`, `0005`, `0006`, `0009`, `0011`.
- What remains on the `Broker` class (`bay/broker/broker.ts`): web requests, secrets, events, commands, spend and call, and whatever else the class still holds. `bay/broker/effect-rule.ts` still has their kinds, its table and its switches, and `skill.submit`. The runner falls back to the class at one place, `answeringFor` in `bay/broker/script-runner.ts`.

## Output

1. `http.request`, `secrets.get`, `events.emit`, `commands.run`, `spend` and `call` are entries with a rule and a handler that receives only what the rule allowed, in files by resource as the design lays out. The grant check of a secret is in the secret's rule, so that every grant is checked in this feature; `bay/secrets.ts` keeps the store and the lookup.
2. The web request's ruling carries the rule for redirects, and the handler asks it before following each hop, as the trial showed. A test holds that a redirect to a host that is not granted is refused at that hop and nothing is sent to it.
3. The `Broker` class is deleted. `bay/broker/effect-rule.ts` is deleted as a file: what it held is in `rule.ts` and the entries, and the check a skill step's submission needs (`skill.submit`) is one function on the same rule, as the design says. The runner's fallback and the table of class methods are deleted. Every caller asks through the entries.
4. Every refusal sentence, every event and every count is the same as before, character for character: the capture is identical and no expected value in a test changes. Tests that called the class or the old rule file are changed only in how they ask.
5. The proofs of `tests/broker-proofs.test.ts` cover all 16 operations, from two examples each.
6. A report, which also says what the feature's entry would have to export for slice B6 to seal it: every import of a private file of `bay/broker/` from outside the feature, listed, with what the importer needs.

Out of scope: sealing the feature and moving its callers to one entry file (slice B6); commands by name and effects per command (slice B7); the toolbox; any mode.

## Definition of done

- [DOD-B5-1] (must) Output 1: one entry of each resource pasted in full. `git ls-files bay/broker/effect-rule.ts` prints nothing. `grep -rn "class Broker\|effectRefusal\|BrokerOperation" bay adapters tests` is pasted, with each remaining hit explained or none.
- [DOD-B5-2] (must) Output 2: the test, written first and seen failing against a handler that follows a redirect without asking.
- [DOD-B5-3] (must) Output 4: the capture, start and final back to back with a copy of the script that has a scratch folder of your own, shows no difference; `diff -r` pasted, empty. The report lists every test file edited and what changed in it; no expected sentence, event or count changed.
- [DOD-B5-4] (must) Output 5: the proofs' new rows, each recorded from the code before the move and seen failing against a rule that allows everything and a handler that records nothing.
- [DOD-B5-5] (must) Every caller of the class and of the old rule file, before and after, as a table. No caller keeps a second way in.
- [DOD-B5-6] (must) `tests/toolbox-surface.test.ts` passes unchanged. `git diff --stat` for `components/` and `bay/sdk.ts` is empty.
- [DOD-B5-7] (must) Boundaries: the feature map's `broker` entry is true after the slice; neither debt list grows, and the report says what shrank; the copy-paste detector count does not rise above your starting measure.
- [DOD-B5-8] (must) Bug injection (P-18, P-31): at least 14 bugs, one at a time, in a throwaway copy with time limits and results saved as you go. Include: a web request to a host that is not granted is sent; a redirect is followed without asking; a secret that the mode does not declare is given; a secret's value is not scrubbed from an event; a script emits an event of a kind only the broker may write; a command runs that the mode does not list; a command runs in a folder outside the project; a command's output is not scrubbed; spending is not counted, or counted twice; a call to an action the caller's binding does not allow goes through; a skill step's submission is accepted without the effect its spend needs. Each is caught, or a test is added, or the report proves no test can catch it. The working tree is clean at the end.
- [DOD-B5-9] (must) Proven on the real thing (P-19): in the worktree, through `./bay.sh call` and compared with a `git archive` copy of the starting commit running the same script: an action that runs a command (the git-worktrees `cut`, `status`, `remove` of names starting `b5-walk`), the typescript mode's `check` for `typecheck` on a throwaway copy the worktrees mode makes, and the feed-briefing demo workflow as far as it goes without a harness (it calls other modes' actions and reports spending). The same apart from run ids, times and paths. Nothing the walk made is left behind; `git worktree list` and `git branch --list 'forge/*'` pasted.
- [DOD-B5-10] (must) `npm run check` passes. Size before and after is reported per file and never targeted (P-13); the report says what the class, the old rule file and the runner lost.

## Instructions

1. Run `npm run check` before any edit, in the foreground, and wait for it. Record test count, time, kernel line count, both debt counts by rule, and the detector count.
2. Read each remaining method of the class and the old rule file end to end. In the progress note, write for each operation: what it checks and in what order, what it does, what it records, and each refusal sentence with the condition that gives it. That list is what must not change.
3. The proofs' new rows first, recorded from today's code. Then one resource at a time, a commit each, with the capture after each: secrets, events, spend, call, web requests, commands.
4. Delete the class, the old rule file and the fallback. Move the callers. Regenerate the debt lists and read the diff.
5. Inject the bugs in a copy. Capture and diff. Walk the real thing. `npm run check`. Commit. Report.

## Tools

As in `docs/briefs/K1-grants-in-one-place-and-a-split-file-port.md` under "Tools", with outputs under `/tmp/b5-capture/`.

## Resources

`bay/broker/` (all of it), `bay/tools.ts`, `bay/runs/skill-steps.ts`, `bay/adapter.ts`, `bay/kernel.ts` (callers), `bay/policy.ts`, `bay/secrets.ts`, `tests/broker-*.test.ts`, `tests/broker-fixture.ts`, `tests/inside/broker/`, `tests/script-*.test.ts`, `tests/test-toolbox.ts`, `framework/features.yaml`.

## Rules and constraints

- P-01 no comments. P-04 readable before short: an entry reads top to bottom as rule, then handler. P-05 model the domain in types. P-11 replace and delete: at the end there is one way to ask and no class. P-12 one place. P-15 the interface is the test surface. P-16 literal expected values. P-17 test first, seen failing. P-19 proven on the real thing. P-25: if you must change course, stop and report. P-28: nothing a mode's author or the owner reads changes. P-29 one meaning per word. P-30 plain prose.
- TypeScript: `components/base/typescript/practices.md`.
- Write scope: `bay/broker/`, `bay/secrets.ts` where the grant check moves, the import and call lines of the feature's callers, tests, and the feature map's `broker` entry. Nothing under `components/`, not `bay/sdk.ts`. Anything else is named at the top of the report with its reason.
- No security property in `0-frame.md` is weakened. Where today's order of checks matters to what a refusal says or to what is recorded, the order is kept.
- If an operation does not fit "rule, then handler" without a handler needing something the ruling does not carry, stop on that operation, leave it as it is, and say so at the top of the report: ADR 19 makes that the owner's decision.
- Another builder may be working in a different worktree on an interface's shared test and one mode's tests. Do not edit files under `components/`.
- The machine is shared, so runs are slower. A test that fails on a time limit is run again alone before it is believed. A check that ends with "Terminated" or exit 143 was stopped from outside; run it again.
- The session has been stopped without warning several times. Commit after every step that passes typecheck and its tests, and keep `/tmp/b5-progress.md` current. Run long commands in the foreground. Never pipe a check whose exit status you rely on.
- Small commits, each passing typecheck, lint, format and both dead-code runs.
- Formatting uses the project's configuration; never run prettier without `--config components/base/typescript/prettier.json`, and never with `--write` on a folder.
- Never read or print real secrets. Never push. Never touch `main` or another worktree.
- Report (P-22), in plain English and short sentences: anything beyond the brief first; items that could not both be met; each DOD item with pasted command output as evidence; the bug-injection table; what the entry must export to be sealed; what you did not do; what you did not verify.
