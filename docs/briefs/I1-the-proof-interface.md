# Brief I1: `proof@1`: the interface, the form of a slice, a shared test, and made-up proofs that pass and fail it

An interface slice, merged before any implementation (P-35). For one builder. Words are used as `CONTEXT.md` defines them. Practices are cited by id from `framework/practices.md`.

## Input

- Branch `i1/proof-interface`, cut from `feat/0022-agentbay5`, in the worktree you are given.
- `docs/adr/0022` (the decision), `docs/plans/0022-forge-in-waves.md` (this is its slice I1; P1 to P5, W1 and F1 are built against what you write), `docs/designs/proof/0-frame.md` (the properties V1 to V7 and the cases K1 to K7), `A-smallest.md` sections 1 and 2 (the base: the entry, the kinds, the slice's form, written out for slice TR2), `C-seams.md` (the shared test, the wrong proofs, and the seam between gathering and deciding), `B-caller.md` (the kind for the real thing only), `comparison.md`.
- `docs/adr/0015`, `0017` (items 1, 8, 9), `0018`, `docs/designs/forge/calling-a-toolchain.md`.
- The four interfaces under `components/base/interfaces/` as examples of the form: an interface file, request and result schemas with a description on every field, and `tests/shared.ts` taking the mode under test and an optional test project. `tests/made-up-toolchains.ts` and its test as the example of a made-up mode that passes and wrong ones that each fail exactly one case. `tests/new-mode-isolation.test.ts`.
- `framework/practices.md`, `components/base/typescript/practices.md`, `framework/features.yaml`, `CONTEXT.md`.

## Output

1. `components/base/interfaces/proof/`: the interface `proof@1` with one action, `prove`. Its request holds a slice and what is to be judged; its result holds a verdict per item. Schemas with a sentence on every field, written for the author of a slice and the reader of a verdict.
   - **The slice's form**, as the decision records it: a name; a kind (interface, capability, mode); a write scope as path patterns; the slices it comes after, each with the reason; the interface it builds against, if any; its definition of done as items, each with an id, a sentence, must or should, and either a kind of proof with what that kind needs, or no kind, which makes it a judgement item that proof does not touch.
   - **What is judged**: the base and the head as commits; what the builder declared it would change before it edited (files, and names an entry gains, loses or changes); the bugs to inject, each a name, a patch and the test files that cover it.
   - **The closed set of kinds**, eight: the checks pass; a test fails first; changes are in scope; what changed is as declared; injected bugs are caught; output is the same; a count; the real thing. For each, what its part of the request holds and what "passed" means, in the schema's own sentences. Use the design's names for them unless a name in `CONTEXT.md` forbids it.
   - **A verdict**: the item, the kind, one of passed, failed, inconclusive; a detail when passed or failed; a reason when inconclusive that says what is not known and why. Two items proof adds to every slice (in scope; as declared). Size per changed file at base and head, reported and never a verdict (P-13). No field anywhere for a builder's words.
2. `components/base/interfaces/proof/tests/shared.ts`: the shared test any implementation of `proof@1` must pass, in the form of the other four. Its cases come from the frame's properties and cases, each against a small repository the test makes with commits it controls, through made-up toolchain and worktrees modes that record what they are asked. At least: each kind passed, failed and inconclusive; any inconclusive part makes the item inconclusive, never passed (V1); a toolchain is called only with a folder that came from the worktrees interface's `copy`, and every copy is removed on every path including a failure and a time limit (V4, copy, call, remove); the two added items are always present; a path changed outside the scope fails "in scope" and names it; a file declared and not changed, and one changed and not declared, each fail "as declared" and show a count, never the builder's text (V2); a surviving bug fails its item and is named; a bug's run names only its covering test files; a judgement item is returned untouched; a project that declares no commands makes "output is the same" inconclusive with the sentence; nothing is written outside throwaway copies.
3. `tests/made-up-proofs.ts` and its test: a made-up proof mode that passes the shared test, small and plainly written (it is the reference a builder of the real mode reads), and wrong ones that each fail exactly one named case: at least one that reports passed for an inconclusive part, one that gives the toolchain a worktree, one that leaves a copy behind, one that passes a surviving bug, one that puts a declared path's text into a detail, one that omits an added item.
4. `CONTEXT.md` gains the words this adds (at least Proof, Kind of proof, Slice, Write scope, Declaration, Judgement item), each with the synonyms not to use; and Card is widened from the trust card to any card the kernel shows the owner, without changing what the trust card is.
5. `docs/designs/proof/interface-open-questions.md`: what you had to decide that the designs left open, each with the choice made and what a second implementation would test it against.
6. A report.

Out of scope: the real proof mode (P1 to P5); the plan file and waves (W1); anything under `bay/` or `schemas/`.

## Definition of done

- [DOD-I1-1] (must) The interface and schemas load: `bay check` on the kit is clean of new errors, pasted. Slice TR2 written in the form, as a fixture the shared test uses, with its real scope, items and commits' file lists from `git show --stat` of the merge.
- [DOD-I1-2] (must) The shared test, cases listed with the property or case of the frame each one holds. The made-up proof passes all of them.
- [DOD-I1-3] (must) Each wrong made-up proof fails exactly its one case and passes the rest, pinned by name, as the made-up toolchains are.
- [DOD-I1-4] (must) A mode's folder and its interface are all this adds: `tests/new-mode-isolation.test.ts` passes unchanged; nothing under `bay/`, `schemas/` or `adapters/` changes; the limit on concepts still holds (`bay check`'s limits pasted).
- [DOD-I1-5] (must) Boundaries: neither debt list grows; the detector count does not rise; if the made-up proofs repeat the made-up toolchains' setup, one helper serves both and the report says which.
- [DOD-I1-6] (must) Bug injection (P-18, P-31) into the made-up proof, at least 10 bugs, one at a time, in a throwaway copy that is a git repository, with time limits and results saved as you go: each caught by a case of the shared test, or a case is added. Include: a copy not removed after a time limit; inconclusive counted as passed for one kind only; the base and head swapped in "fails first"; a scope pattern matched as a prefix where it should match whole path parts; "as declared" comparing counts and not paths; a bug's run without its test files.
- [DOD-I1-7] (must) `npm run check` passes. Size per file reported, never targeted (P-13). The time the shared test and the made-up proofs' test take, alone.

## Instructions

1. Run `npm run check` before any edit and wait for it (nohup and poll). Record test count, time, debt counts by rule, detector count.
2. Write the schemas and the TR2 fixture first, and in the progress note the list of shared cases with the property each holds, before any test code (P-35). Commit.
3. The shared test with the made-up proof, case by case, each seen failing against a made-up proof that lacks it. Then the wrong proofs. A commit per group.
4. Regenerate the debt lists. Inject the bugs. `npm run check`. Commit. Report.

## Tools

Shell, git, node's test runner, `bay check`.

## Resources

`components/base/interfaces/toolchain/` and `worktrees/` (files and `tests/shared.ts`), `tests/made-up-toolchains.ts`, `tests/made-up-worktrees.ts`, their tests, `tests/test-toolbox.ts`, `tests/kit-copy.ts`, `schemas/interface.schema.json` (what an interface file may hold; it takes no description field), `framework/features.yaml`.

## Rules and constraints

- P-01 no comments. P-04 readable before short. P-05: verdicts and kinds are closed sets in types. P-12 one place. P-15: the interface is the test surface. P-16 literal expected values. P-17 test first, seen failing. P-25: if the design cannot be built as written, stop and report. P-28: the schemas' sentences are read by a slice's author and the owner. P-29, P-30. P-34. P-35.
- TypeScript: `components/base/typescript/practices.md`.
- The made-up proof and the shared test never run a model and never run the kit's own suite inside a case: a case takes seconds, on a repository of a few files.
- No field of the request or result can carry a builder's free words into a verdict's detail. Paths and names a builder declared appear as counts or as paths the kernel's own commands printed.
- Write scope: `components/base/interfaces/proof/`, `tests/made-up-proofs*`, a shared helper under `tests/` if DOD-I1-5 needs one, `CONTEXT.md`, the one note under `docs/designs/proof/`, the feature map. Anything else is named at the top of the report with its reason.
- Other builders may be working in different worktrees on `bay/runs/`, the workflow schema, the typescript mode and the toolchain interface. Do not edit those.
- To stop a check of your own, kill it by its process id. Never use `pkill` or `killall` with a pattern.
- Start long runs with nohup and poll. Never run `node --test` with an empty file list. A check that ends "Terminated" or exit 143 was stopped from outside; run it again.
- Commit after every step that passes typecheck and its tests; keep `/tmp/i1-progress.md` current. Never pipe a check whose exit status you rely on. Remove anything you make under /tmp that is not named in the report.
- Formatting uses the project's configuration; never run prettier without `--config components/base/typescript/prettier.json`, and never with `--write` on a folder.
- Never read or print real secrets. Never push. Never touch `main` or another worktree.
- Report (P-22), in plain English and short sentences: anything beyond the brief first; the interface as a caller uses it, with one real request and result; each DOD item with pasted output; the bug-injection table; what P1 to P5, W1 and F1 need to know; what you did not do; what you did not verify.
