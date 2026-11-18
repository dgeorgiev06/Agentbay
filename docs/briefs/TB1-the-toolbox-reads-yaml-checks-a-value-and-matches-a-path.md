# Brief TB1: the toolbox gains three things a mode needs to read a plan: YAML to a value, a value checked against a schema, and a path matched against a pattern

A capability slice (P-34). It changes the toolbox's surface, which is pinned. For one builder. Words are used as `CONTEXT.md` defines them. Practices are cited by id from `framework/practices.md`.

## Input

- Branch `tb1/toolbox-for-plans`, cut from `feat/0022-agentbay5`, in the worktree you are given.
- Why: slice W1 stopped, correctly (P-25, `0017` item 2). `docs/adr/0022` decided that a plan is a YAML file a script checks. A mode's script gets file text from the toolbox and nothing else: it cannot read YAML (mode code may import no package, and `bay check` refuses one), it cannot check a value against a schema (the kernel checks an action's input, output, settings and manifests, never a file a script read), and a schema file cannot refer to another (each is compiled alone), so a plan's slice cannot be held to `proof@1`'s slice. And two modes need the same matching of a path against a pattern: proof's `in-scope` kind and forge's waves; modes may not import each other, and the only matching today is text inside a made-up mode in `tests/made-up-proofs.ts`.
- `docs/adr/0003`, `0005`, `0006`, `0017` (item 3: the toolbox's surface is pinned, and a change to it is one line the owner reads: what every mode could do afterwards that it could not before), `0019`, `docs/designs/operations/0-frame.md` (the properties; none may weaken), `docs/designs/proof/interface-open-questions.md`.
- `bay/sdk.ts` (the toolbox: what a script may call that is not an operation is a pure function there, like `canonicalJson`), `tests/toolbox-surface.test.ts`, `bay/manifests/spec.ts` (`checkValue` and its sentences) and `schemas.ts` (how schema files are compiled), the kernel's own YAML reader and the limits it puts on a manifest.
- `components/base/interfaces/proof/prove-request.json`: the sentence that defines a pattern ("A * stands for any characters inside one folder or file name; a ** that is a whole part stands for any number of folders. bay/broker/** holds every file under bay/broker/, and not bay/brokers.ts.") and the form of a slice.
- `framework/practices.md`, `components/base/typescript/practices.md`, `framework/features.yaml`, `CONTEXT.md`.

## Output

1. **YAML to a value.** A script can turn YAML text it read into a value, or get the problem as a sentence with the line. The same reader the kernel uses for manifests, with the same limits (size, depth, no custom tags, no anchors that expand without bound; state each limit and test it). A pure function: it reads no file, so what a script may read is unchanged.
2. **A value checked against a schema.** A script can check a value against a schema file of its own mode, or of an interface its mode implements or requires, and get back either the value or the kernel's own sentences, problem for problem, as `checkValue` gives them for an action's input. Decide from the code whether this is a pure function given the schema's text (which the script reads through its granted read) or an operation of the broker that names a schema file; say why, and what each costs against the properties of the frame. A schema outside those the mode may name is refused.
3. **One schema may hold part of another.** A mode's schema can say "this part is that part of an interface's schema" for an interface the mode implements or requires, so that a plan's slice is `proof@1`'s slice by reference and cannot drift. Decide how (a reference the kernel follows when it compiles a mode's schemas, limited to files the mode may name; or a function that picks a part out of a compiled schema) and what `bay check` says of a reference that names nothing or names a file the mode may not. If this cannot be done without reaching across features, stop after outputs 1, 2 and 4 and report: a test that holds two copies equal is then the fallback, and it is W1's to write.
4. **A path matched against a pattern**, in the dialect `proof@1`'s sentence defines, as one pure function of the toolbox with a table of cases that pins every part of the sentence and its edges: `*` inside one name; `**` only as a whole part; a `**` that is not a whole part (decide: refused as not a pattern, or `*`-like; the interface's schema and the made-up proof disagree today, so fix the one that is wrong and say which); a trailing slash; a leading `./`; a file against a folder pattern; `bay/broker/**` against `bay/brokers.ts`; case; an empty pattern. The made-up proof in `tests/made-up-proofs.ts` uses it and its own copy is deleted (P-11).
5. **The surface.** `tests/toolbox-surface.test.ts` pins the three additions. The one line for the owner, at the top of the report: what every mode can do after this that it could not before, and what it still cannot.
6. `CONTEXT.md` if a word is added. A short note for W1 and P2 in `docs/designs/proof/`: the three functions as a caller uses them, with one example each.
7. A report.

Out of scope: forge; proof's real mode; any operation that reads or writes a file in a new place.

## Definition of done

- [DOD-TB1-1] (must) Output 1, tests first and seen failing: literal values for a small plan-like text; each limit with its literal sentence; text that is not YAML with the line in the sentence; a document with a custom tag; one with an alias chain that would expand to more than the limit. The kernel's own manifests load exactly as before (its reader is shared, not copied; every manifests test passes unchanged).
- [DOD-TB1-2] (must) Output 2, tests first and seen failing, through a real script in a made-up mode: a good value; a value with three problems (all three returned, in the kernel's words); a schema of an interface the mode requires; a schema of a mode it has nothing to do with (refused, with the sentence); a schema file that is not JSON or not a schema.
- [DOD-TB1-3] (must) Output 3, or the stop described there: a made-up mode whose schema holds a part of an interface's schema by reference accepts and refuses the same values as the interface's own schema for that part, shown by a table; a reference to nothing, and one to a file the mode may not name, each a `bay check` error with its sentence; when the interface's schema changes in the test, the mode's check follows.
- [DOD-TB1-4] (must) Output 4: the table, at least thirty cases, pasted; the made-up proofs' test passes with the shared function and its own matching gone; the interface's sentence and its pattern (the regular expression in the schema) agree with the function, shown by running every case through both.
- [DOD-TB1-5] (must) Output 5: the surface test's diff; the owner's line.
- [DOD-TB1-6] (must) No property of `docs/designs/operations/0-frame.md` is weakened: list them and say how each holds. In particular a script gains no new way to read a file, reach the network, or run code: checking a value runs no code from the schema (no custom keywords, no formats that call out, no remote references), and a hostile schema or YAML text cannot hang or exhaust the script host beyond its existing limits (test one of each with a time limit).
- [DOD-TB1-7] (must) Nothing changes for the kit: the capture, start and final back to back with a copy of the script under your scratch folder (its `here=` line pointing at /home/claude/m5-capture), shows no difference, or each differing file is named.
- [DOD-TB1-8] (must) Boundaries: manifests, runs and broker stay sealed; what the toolbox calls in the kernel it reaches through entries the feature map allows; neither debt list grows; the detector count (your own before and after with one command, pasted) does not rise.
- [DOD-TB1-9] (must) Bug injection (P-18, P-31): at least 12 bugs, one at a time, in a throwaway copy that is a git repository: a custom tag is accepted; the size limit is ignored; only the first schema problem is returned; a schema of an unrelated mode is accepted; a reference to a file the mode may not name is followed; `*` crosses a folder; `**` inside a part crosses folders; `bay/broker/**` admits `bay/brokers.ts`; matching ignores case; a trailing slash changes the answer where the table says it must not; the kernel's manifests are read by a second reader. Each caught, or a test added.
- [DOD-TB1-10] (must) `npm run check` passes. Size before and after per file, never targeted (P-13). No test waits real minutes.

## Instructions

1. Run `npm run check` before any edit and wait for it (nohup and poll). Record test count, time, kernel line count, debt counts by rule, detector count with its command.
2. Read how a script's toolbox functions reach it (what is a pure function in `bay/sdk.ts`, what is an operation through the broker, and what the script host may import), how the kernel reads YAML and compiles schemas. Write in the progress note each of the three as a signature with its errors as a closed set, and for output 2 and 3 the choice with its reason, before code (P-35). If slice KS1 (the kernel compiles each schema once) has merged, build on its cache; if not, do not add one.
3. The matching, tests first (it is pure and the others do not need it). Then YAML. Then the check. Then the reference. A commit each.
4. Regenerate the debt lists. Inject the bugs. Capture and diff. `npm run check`. Commit. Report.

## Tools

As in `docs/briefs/K1-grants-in-one-place-and-a-split-file-port.md` under "Tools".

## Resources

`bay/sdk.ts`, `tests/toolbox-surface.test.ts`, `bay/broker/operations.ts` and the script host's files, `bay/manifests/spec.ts`, `schemas.ts`, the kernel's YAML reader, `bay/check-imports.ts` (what mode code may import), `components/base/interfaces/proof/prove-request.json`, `tests/made-up-proofs.ts` and its test, `tests/made-up-toolchains.ts` (a made-up mode with scripts, for the tests).

## Rules and constraints

- P-01 no comments. P-04 readable before short. P-05: each function's failure is a closed set with a sentence. P-06: values from outside are checked at the edge, by one guard. P-11 replace and delete. P-12 one place: one YAML reader, one schema checker, one matching. P-15, P-16 literal expected values. P-17 test first, seen failing, before the code. P-25. P-28: the sentences are read by a mode's author and, for a plan, the owner. P-29, P-30. P-35.
- TypeScript: `components/base/typescript/practices.md`.
- The toolbox stays the only kernel file mode code may import, and it stays small: three additions, no more. If a fourth seems needed, stop and report.
- Fail closed: text that cannot be read is a problem, never an empty value; a schema that cannot be compiled refuses the value.
- Write scope: `bay/sdk.ts`, the kernel files behind the three functions (name each in the progress note before editing), `tests/toolbox-surface.test.ts`, tests, `tests/made-up-proofs.ts` for the matching only, `components/base/interfaces/proof/prove-request.json` only if its pattern or sentence is the one that is wrong, the feature map, `CONTEXT.md`, the one note. Anything else is named at the top of the report with its reason.
- Other builders are working in different worktrees on `components/base/proof/`, `components/base/git-worktrees/`, `bay/runs/` and tests of their own. Do not edit those.
- Keep every scratch file of yours under one new folder, `/tmp/tb1/`. Do not create, overwrite, move or delete anything else under `/tmp`. If a command is refused or asks for permission, choose another way and note it. Inject bugs only in a throwaway copy, never in the worktree.
- To stop a check of your own, kill it by its process id. Never use `pkill` or `killall` with a pattern.
- Start long runs with nohup and poll. Never run `node --test` with an empty file list.
- Commit after every step that passes typecheck and its tests; keep `/tmp/tb1/progress.md` current. Never pipe a check whose exit status you rely on.
- Formatting uses the project's configuration; never run prettier without `--config components/base/typescript/prettier.json`, and never with `--write` on a folder.
- Never read or print real secrets. Never push. Never touch `main` or another worktree.
- Report (P-22), in plain English and short sentences: the owner's line first; anything beyond the brief; each DOD item with pasted output; the bug-injection table; what W1 and P2 need to know; what you did not do; what you did not verify.
