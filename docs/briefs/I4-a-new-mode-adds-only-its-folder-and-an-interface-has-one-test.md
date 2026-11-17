# Brief I4: a test that a new mode adds only its folder, and one shared test per interface

Slice for one builder. Words are used as `CONTEXT.md` defines them. Practices are cited by id from `framework/practices.md`.

## Input

- Branch `i4/isolation-held`, cut from `feat/0022-agentbay5`, in the worktree you are given.
- `docs/adr/0017` (this is its slice I4; also "from the study of swamp": one shared test file per interface that every implementing mode passes), `docs/adr/0018`, `docs/research/2026-11-16-boundary-audit.md`.
- `framework/practices.md`, `components/base/typescript/practices.md`, `framework/features.yaml`, `tests/feature-map.test.ts`, `CONTEXT.md`.
- Slices I1 to I3 (merged): the feature map covers modes by a rule; no kit test lists the kit's modes; an action that an interface names takes its schemas from the interface; a mode's tests import only the test toolbox (`tests/test-toolbox.ts`), the toolbox and their own mode's files. Three builders each proved by hand, in a throwaway copy, that a made-up mode can be added with no other file changed. Nothing in the suite holds that.
- An interface today is a file of signatures and a folder of schemas. Whether a mode that claims to implement it behaves as the interface means is tested only by that mode's own tests, each written separately. A second implementation would have nothing to pass.

## Output

Part one: isolation is held by a test.

1. A test in the kit's suite that does what the builders did by hand: it makes a copy of the kit in a temporary folder, adds a small made-up mode with one script action and a test of its own (written by the test, not kept as a fixture mode in the kit), changes nothing else, and shows that the kit's own checks accept it: `bay check` has no new finding, the feature-map rules pass, and the made-up mode's test passes. It is as fast as it can honestly be; the report gives its time. If the whole `npm run check` cannot reasonably run inside a test, the report says which parts the test runs and which are left to the hand proof.
2. The same test with a second made-up mode that implements an existing interface, to show that implementing an interface also adds only the mode's folder.

Part two: an interface has one shared test.

3. An interface may have a shared test: one file, beside the interface, that states what any mode implementing it must do, in terms of the interface's actions only. It is written once and run against each implementing mode from that mode's own tests. You choose the file's place and form and argue it in the report; it must be obvious to someone writing a second implementation, and it must use only the test toolbox.
4. The rules allow exactly this and no more: a mode's tests may import the shared test of an interface the mode implements. The feature map says so and `tests/feature-map.test.ts` enforces it; `bay check` reports a mode that implements an interface with a shared test and does not run it, with a fix.
5. One interface is done in full as the worked example: `items-store@1`, implemented by the store mode. Its shared test states the behaviour the interface means (what was put can be got; what the interface says about absent items, ordering, limits and whatever else its schemas and the store's README promise), with literal expected values. Tests of the store mode that state the interface's meaning move into the shared test; tests of how this store does it stay in the mode.
6. A second, made-up implementation proves the shared test is about the interface and not about the store mode: in the test of Output 2 or beside it, a small in-memory implementation of `items-store@1` written by the test passes the shared test, and a deliberately wrong one (it loses an item) fails it.
7. A report, which also lists for each other interface (`items-source@1`, `toolchain@1`, `worktrees@1`) what its shared test would state, in a few lines each, so that those can be built side by side afterwards.

Out of scope: the shared tests of the other three interfaces; questions that check a model picks the right action; anything under `bay/broker/`.

## Definition of done

- [DOD-I4-1] (must) Output 1 and 2: the test, written first and seen failing for a reason that proves it bites: with a hand-edited list restored in a copy (for example a kit test that names kit modes again, or a per-mode entry required in the feature map), the test fails. Pasted.
- [DOD-I4-2] (must) Output 3 and 4: the rule's test, written first and seen failing, with these reported: a mode test importing the shared test of an interface its mode does not implement; a mode implementing an interface with a shared test and not running it. Both pasted. The kit passes with no debt entry.
- [DOD-I4-3] (must) Output 5: the shared test's cases listed, each with the place in the interface (schema, description or README) that it rests on. A table of the store mode's tests: moved to the shared test, or stays and why. The store mode's test count before and after, with nothing lost.
- [DOD-I4-4] (must) Output 6: the in-memory implementation passes; the wrong one fails with the case that caught it, pasted.
- [DOD-I4-5] (must) Bug injection (P-18, P-31): at least 10 bugs, one at a time, in a throwaway copy with time limits and results saved as you go. Include, in the store mode: `get` returns a different item; `put` overwrites silently where the interface says otherwise or the reverse; a query ignores its limit; an absent item is reported as present. Include, in the rules: the isolation test accepts a mode that edits a kit file; a mode test may import any interface's shared test. Each is caught, or a test is added, or the report proves no test can catch it. The working tree is clean at the end.
- [DOD-I4-6] (must) Boundaries: neither debt list grows; the copy-paste detector count does not rise above your starting measure; no file under `bay/` changes except `bay/check-imports.ts` or the check that reports Output 4's finding, each named with its reason.
- [DOD-I4-7] (must) `npm run check` passes. The capture, taken on the starting and final commits back to back with a copy of the script that has a scratch folder of your own, differs only in the kit's own changed files; every differing file is named and explained. Size and the suite's time before and after are reported and never targeted (P-13).

## Instructions

1. Run `npm run check` before any edit, in the foreground, and wait for it. Record test count, time, kernel line count, both debt counts by rule, and the detector count.
2. Part one, test first. Commit.
3. Read `components/base/interfaces/items-store.yaml`, its schemas, the store mode and its tests. Write in the progress note what the interface means, as a list of statements, and which existing test holds each. Decide the shared test's place and form (P-35) and write that down before code.
4. The rule, test first. The shared test and the store mode's use of it. The made-up implementations. A commit each.
5. Regenerate the debt lists and read the diff. Inject the bugs in a copy. Capture and diff. `npm run check`. Commit. Report.

## Tools

As in `docs/briefs/K1-grants-in-one-place-and-a-split-file-port.md` under "Tools", with outputs under `/tmp/i4-capture/`.

## Resources

`tests/test-toolbox.ts` and its test, `tests/feature-map.test.ts`, `framework/features.yaml`, `bay/check-imports.ts`, `tests/kit-check.test.ts` (how a requirement on a mode's own tests is checked today, for listed commands), `components/base/interfaces/`, `components/base/store/`, `tests/project-fixture.ts`.

## Rules and constraints

- P-01 no comments. P-04 readable before short. P-05 model the domain in types. P-11 replace and delete: a statement about the interface is tested in one place. P-12 one place. P-15 the interface is the test surface. P-16 literal expected values. P-17 test first, seen failing. P-25: if you must change course, stop and report. P-29 one meaning per word; if the shared test needs a word in the glossary, propose the line in the report. P-30 plain prose. P-35 interfaces first.
- TypeScript: `components/base/typescript/practices.md`.
- Write scope: tests, the feature map, `components/base/interfaces/items-store*` and the store mode's `tests/`, and the two `bay/` files named in DOD-I4-6 if needed. The store mode's scripts do not change; if the shared test shows the store mode does not do what its interface says, stop on that point and report it.
- Another builder is working in a different worktree on `bay/broker/` and its tests. Do not edit those.
- The machine is shared, so runs are slower. A test that fails on a time limit is run again alone before it is believed. A check that ends with "Terminated" or exit 143 was stopped from outside; run it again.
- The session has been stopped without warning several times. Commit after every step that passes typecheck and its tests, and keep `/tmp/i4-progress.md` current. Run long commands in the foreground. Never pipe a check whose exit status you rely on.
- Small commits, each passing typecheck, lint, format and both dead-code runs.
- Formatting uses the project's configuration; never run prettier without `--config components/base/typescript/prettier.json`, and never with `--write` on a folder.
- Never read or print real secrets. Never push. Never touch `main` or another worktree.
- Report (P-22), in plain English and short sentences: anything beyond the brief first; items that could not both be met; where the shared test lives and why; each DOD item with pasted command output as evidence; the bug-injection table; the other three interfaces' statements; what you did not do; what you did not verify.
