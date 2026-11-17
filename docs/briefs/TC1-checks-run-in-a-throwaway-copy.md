# Brief TC1: a toolchain's check and test are given a throwaway copy, and write nowhere else

Slice for one builder, in one interface and the mode that implements it. Words are used as `CONTEXT.md` defines them. Practices are cited by id from `framework/practices.md`.

## Input

- Branch `tc1/throwaway-checks`, cut from `feat/0022-agentbay5`, in the worktree you are given.
- `docs/adr/0020` item 2 (the decision), `docs/designs/forge/toolchain-open-questions.md` (question 2 is decided by it; the others are not), `docs/adr/0018`.
- `components/base/interfaces/toolchain.yaml` and its schemas; its shared test `components/base/interfaces/toolchain/tests/shared.ts` (15 cases; the last holds that check and test write nothing into the checkout, which only a brief asked for); the typescript mode and its tests; the made-up toolchain in `tests/made-up-toolchains.ts`.
- The decision: check and test are given a throwaway copy of the code, never a slice's worktree. They may write inside the folder they are given and nowhere else. Whoever calls a toolchain makes the copy first (the worktrees interface's `copy`) and removes it afterwards. Proof will judge a builder's work in the worktree, which no tool touches.

## Output

1. The interface says it in its own words, where a second implementer reads: the descriptions in `toolchain.yaml` and in the request schemas' `folder` field say that the folder is a throwaway copy the caller made and will remove, that the toolchain's tools may write inside it, and that nothing outside it is written. No signature changes; the interface stays `toolchain@1`. If you judge that the change in meaning needs a new major version, stop and say why before changing anything.
2. The shared test holds the new statement and no longer the old one: after check and after test, nothing outside the folder given has changed, compared over the whole project the mode runs in, the folder aside; and a toolchain whose tools write inside the folder passes. The made-up toolchain gains a check that writes a file inside the folder (a build output), to prove the second half; a deliberately wrong one that writes beside the folder fails the case.
3. Each verdict is still about the code as it was given: a second call to check or test on the same folder, after the first wrote its build output there, gives the same verdicts. A case holds it.
4. The typescript mode passes the shared test unchanged in its scripts. Its README says what the folder is.
5. A note for the callers that do not exist yet, in `docs/designs/forge/`: what proof and forge must do around every toolchain call (copy, call, remove; never a worktree), in a few lines, so that G4 builds it that way. Question 2 in `toolchain-open-questions.md` is marked decided, with the pointer.
6. A report.

## Definition of done

- [DOD-TC1-1] (must) Output 1: the changed descriptions pasted, before and after. `git diff` of the interface's signatures (action names, schema shapes) is empty apart from descriptions.
- [DOD-TC1-2] (must) Output 2 and 3: the cases, written first and seen failing where the behaviour asserted is new (the wrong toolchain that writes beside the folder; the made-up toolchain that writes inside it failing the old case and passing the new). The shared test's case list after, with the place in the interface each new case rests on.
- [DOD-TC1-3] (must) The typescript mode: every one of its tests passes; its count of shared cases before and after; no script changed.
- [DOD-TC1-4] (must) Bug injection (P-18, P-31), at least 6 bugs, one at a time, in a throwaway copy with time limits and results saved, against the mode's shared-test runner and the made-up toolchains test: the typescript mode's test action writes a report file beside the folder; into the project root; into `.agentbay/`; the shared test compares only the folder's parent and misses a file elsewhere in the project; the second-call case accepts a changed verdict; the made-up wrong toolchain is accepted. Each caught, or a case added.
- [DOD-TC1-5] (must) Write scope held: `components/base/interfaces/toolchain.yaml`, `toolchain/` (schema descriptions and `tests/shared.ts`), `components/base/typescript/README.md` and `tests/`, `tests/made-up-toolchains.ts` and its test, and the two documents under `docs/designs/forge/`. No file under `bay/`.
- [DOD-TC1-6] (must) `bay check` on the kit passes. Neither debt list grows; the copy-paste detector count does not rise. `npm run check` passes; the suite's time before and after is reported.

## Instructions

1. Run `npm run check` before any edit and wait for it (nohup and poll). Record test count, time, both debt counts, the detector count.
2. The shared test's new cases first, with the made-up toolchains, seen failing. Then the interface's words. Then the typescript mode's README. A commit each.
3. Inject the bugs. `npm run check`. Commit. Report.

## Tools

As in `docs/briefs/K1-grants-in-one-place-and-a-split-file-port.md` under "Tools". No capture is needed.

## Resources

`components/base/interfaces/toolchain.yaml` and `toolchain/`, `components/base/typescript/` (read its scripts; change only its README and tests), `tests/made-up-toolchains.ts` and its test, `tests/test-toolbox.ts`, `docs/designs/forge/`.

## Rules and constraints

- P-01 no comments. P-04 readable before short. P-11 replace and delete: the old statement is gone, not kept beside the new. P-15, P-16, P-17. P-25: if you must change course, stop and report. P-29, P-30. P-34: a mode slice; if it seems to need a change under `bay/`, stop and say what is missing.
- TypeScript: `components/base/typescript/practices.md`.
- A type-only import of a shared test counts, to `bay check`, as running it; only the test file that calls the shared test may import it.
- Another builder is working in a different worktree on `bay/`, the schema of a mode's manifest, and the git-worktrees mode. Do not edit those. `tests/made-up-toolchains.ts` lists commands in the manifest form of today; leave that form as it is.
- The full check can take more than ten minutes: nohup and poll. Never run `node --test` with an empty file list. A check that ends "Terminated" or exit 143 was stopped from outside; run it again.
- Commit after every step that passes its tests; keep `/tmp/tc1-progress.md` current. Never pipe a check whose exit status you rely on.
- Formatting uses the project's configuration; never run prettier without `--config components/base/typescript/prettier.json`, and never with `--write` on a folder.
- Never read or print real secrets. Never push. Never touch `main` or another worktree.
- Report (P-22), in plain English and short sentences: anything beyond the brief first; each DOD item with pasted output; the bug-injection table; what you did not do; what you did not verify.
