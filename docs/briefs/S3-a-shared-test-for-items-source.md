# Brief S3: a shared test for `items-source@1`

Mode slice for one builder. Words are used as `CONTEXT.md` defines them. Practices are cited by id from `framework/practices.md`.

## Input

- Branch `s3/items-source-shared-test`, cut from `feat/0022-agentbay5`, in the worktree you are given.
- `docs/briefs/S1-a-shared-test-for-toolchain.md`: this slice is the same work for another interface. Its Rules and constraints, its Tools and the form of its report apply here unchanged, with `s3` in place of `s1` in file names under `/tmp`, and "fake-source mode" in place of "typescript mode".
- The three shared tests that exist, as models: `components/base/interfaces/items-store/tests/shared.ts`, `toolchain/tests/shared.ts` and `worktrees/tests/shared.ts`, with how each mode runs its own; `tests/kit-copy.ts`, `tests/made-up-modes.ts` and `tests/new-mode-isolation.test.ts` for how a made-up mode is written by a test.
- `components/base/interfaces/items-source.yaml` and its schemas; the fake-source mode (`components/modes/fake-source/`), its README and its tests; the feed-briefing mode's use of a source through the interface. A source for a real service (mail, a social network) will be a second mode behind this interface, written later; it will reach the network and cost money, so the interface's promises about cursors, cost and selectors are what protect a budget.
- What an earlier builder proposed the shared test would state: `describe` and `fetch` agree on `source` and `kinds`; every item's id starts with `<source>:`, and items come oldest first; passing `cursor` back continues without repeats, and `more` is false at the end; `cost` is never negative and never more than `pageCostUsd` when that is given; a field named in `nativeFields` never drops an item the selector matches. Treat this as a starting list, not the answer.

## Output

1. `components/base/interfaces/items-source/tests/shared.ts`: what any mode that implements `items-source@1` must do, through the interface's actions only, using only the test toolbox. It names no service. What it cannot know is given to it by the mode's test: at least the mode's name, the settings that make the source answer the same on every run, and enough about what the source holds for the shared test to state literal expectations (for example how many items it holds, their kinds, and one selector that matches some and not others). You choose the form of that argument and argue it in the report; a second implementer must be able to supply it without reading the fake-source mode. A source that reaches the network must be able to run the shared test against a recorded or made-up service of its own; say how the form allows that.
2. The statements it holds, each with literal expected values and each resting on a named place in the interface (a schema, a description). At least: every statement in the starting list; that fetching every page with the cursor gives every item exactly once and ends; that a cursor the source did not make is refused or starts again in the way the interface says, and which; what `fetch` does with a selector field the source does not apply itself; that what `describe` says a page costs is what `fetch` reports spending; that the spending is reported through the run, so a budget can stop it.
3. The fake-source mode runs the shared test from its own tests. Its tests that state the interface's meaning move into the shared test; tests of how this mode makes its posts stay in the mode. Nothing the mode's tests held is lost.
4. A made-up second implementation, written by a test, passes the shared test: a small source with different kinds, a different page size and a cost per page. A deliberately wrong one, which repeats the last item of a page at the start of the next, fails it.
5. A report, which also states plainly anything the interface leaves undefined that a real source would trip on, as questions for the owner. Do not change the interface.

## Definition of done

- [DOD-S3-1] (must) The shared test's cases listed, each with the place in the interface it rests on.
- [DOD-S3-2] (must) A table of the fake-source mode's tests: moved to the shared test, or stays and why. The mode's test count before and after, with nothing lost.
- [DOD-S3-3] (must) `bay check` on the kit passes: the mode's test imports and runs its interface's shared test. In a throwaway copy with that test removed, the finding is pasted.
- [DOD-S3-4] (must) Output 4: the made-up source passes; the wrong one fails with the case that caught it, pasted.
- [DOD-S3-5] (must) Bug injection (P-18, P-31) in the fake-source mode's scripts, at least 10 bugs, one at a time, in a throwaway copy with time limits and results saved as you go, run against the test that runs the shared test, alone. Include: a page repeats an item; a page skips an item; `more` is true on the last page; items come newest first; an id lacks the source's prefix; `fetch` reports no cost; `fetch` reports more than `describe` says a page costs; a selector's `since` is ignored; a kind `describe` does not list is returned. Each is caught by the shared test, or a case is added, or the report says why it belongs to the mode's own tests.
- [DOD-S3-6] (must) Write scope held: `git diff --stat` shows only `components/base/interfaces/items-source/tests/`, `components/modes/fake-source/tests/`, and the tests that prove Output 4. No file under `bay/`. The interface's signatures and schemas and the mode's scripts are unchanged.
- [DOD-S3-7] (must) Neither debt list grows; the copy-paste detector count does not rise above your starting measure. `npm run check` passes. The suite's time before and after is reported.

## Instructions

1. Run `npm run check` before any edit and wait for it. Record test count, time, both debt counts by rule, the detector count, and the fake-source mode's test count.
2. Read the interface, its schemas, the mode's README and tests, and how feed-briefing uses a source. Write in the progress note what the interface means, as a list of statements, and which existing test holds each. Decide the form of what a mode's test gives the shared test, and write it down before code (P-35).
3. The shared test, with the fake-source mode running it. Move the tests. A commit.
4. The made-up implementations. A commit.
5. Inject the bugs in a copy. `npm run check`. Commit. Report.

## Resources

`components/base/interfaces/items-source.yaml` and `items-source/`, `components/modes/fake-source/` (read its scripts; change only its tests), `components/modes/feed-briefing/scripts/` (read only), the three existing shared tests, `tests/test-toolbox.ts`, `tests/kit-copy.ts`, `tests/made-up-modes.ts`.

## Rules and constraints

- Everything under "Rules and constraints" in `docs/briefs/S1-a-shared-test-for-toolchain.md`, read for this interface and this mode.
- A type-only import of a shared test counts, to `bay check`, as running it. Only the test file that calls the shared test may import it, types included.
- Helpers that copy the kit into a temporary folder live in `tests/kit-copy.ts`; use them, and add nothing like them elsewhere.
- The full check can take longer than ten minutes while another builder runs: if your tools have a foreground limit, start it with nohup writing to a log and poll. Never run `node --test` with an empty file list.
- Another builder is working in a different worktree on `bay/broker/`, its callers' import lines and the broker's tests. Do not edit those.
