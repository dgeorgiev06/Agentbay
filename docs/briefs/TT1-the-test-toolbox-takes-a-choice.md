# Brief TT1: the test toolbox takes a choice, shows an approval's choices and card, and can stop and resume a run

A capability slice in the test toolbox. For one builder. Words are used as `CONTEXT.md` defines them. Practices are cited by id from `framework/practices.md`.

## Input

- Branch `tt1/toolbox-choices`, cut from `feat/0022-agentbay5`, in the worktree you are given.
- Why: `docs/designs/forge/one-slice.md` (section 3, TT1; section 4, the tests of forge's first slice). A mode's tests may import only the test toolbox, the toolbox and its interface's shared test. Slices C1r and C1p gave runs approvals with named choices and a checked card, and the runs entry takes a decision that names a choice; but through the test toolbox a test's decision is approve or reject only, a waiting approval shows neither its choices nor its card, and a test cannot stop a run and open it again. So no mode can test a workflow that uses choices, and forge's first slice cannot be tested.
- `docs/adr/0017` (the test toolbox's surface is pinned like the toolbox's), `0022`, `docs/designs/proof/C1r-what-an-approval-shows.md` (what the runs entry returns for a waiting approval and what a decision takes; note it does not yet mention the sentence `does` that C1p added to every choice: bring the note up to date as part of this slice).
- `tests/test-toolbox.ts` and its test (the surface is pinned there), `bay/runs/runs.ts` (the entry: read only), `tests/runs-choices.test.ts`, `tests/runs-cards.test.ts`, `tests/approval-card-kit.test.ts`.
- `framework/practices.md`, `components/base/typescript/practices.md`, `framework/features.yaml`, `CONTEXT.md`.

## Output

1. Through the test toolbox, a test can see what a run waits for at an approval exactly as the owner would be shown it: the question, the hash, the choices each with its name, what it does, and offered or withheld with its reason, and the card when there is one (title, lines with mark, words and source, the kernel's added skill and tier on a judged line, the counts). The shape is the runs entry's, not a second one.
2. A test can decide an approval by naming a choice, as well as approve or reject where there are no choices, and gets back the run as it then stands, or the kernel's refusal with its sentence (a withheld choice, an unknown one, a verdict where a choice is needed and the reverse, a stale hash).
3. A test can end the kernel under a run and open the same project again, then show or resume the run, to hold that what a run waits for survives a restart. One call each way, named for what it does; the temporary project is kept between the two and removed at the end as today.
4. The surface pin in the toolbox's own test lists what was added, and nothing else changes for the modes that use the toolbox today: every mode's tests pass unchanged.
5. The C1r note is brought up to date with `does`.
6. A report: the one line of what a mode's test can do after this that it could not before.

## Definition of done

- [DOD-TT1-1] (must) Tests first and seen failing, in the toolbox's own test, with a made-up mode whose workflow has an approval with four choices, two of them with rules, and a card: the waiting approval as a literal; each choice taken and read by a later step; a withheld choice refused with its literal reason; an unknown choice; a verdict where a choice is needed and the reverse; a stale hash.
- [DOD-TT1-2] (must) Stop and resume: the same waiting approval, as a literal, before and after; a choice taken after the restart completes the run.
- [DOD-TT1-3] (must) The surface test's diff pasted; every kit mode's tests pass unchanged; `tests/new-mode-isolation.test.ts` passes unchanged.
- [DOD-TT1-4] (must) Boundaries: the test toolbox reaches the kernel through entries the feature map allows; neither debt list grows; the detector count does not rise; nothing under `bay/` changes (if the runs entry lacks something this needs, stop and report, P-25).
- [DOD-TT1-5] (must) Bug injection (P-18, P-31), at least 8, in a throwaway copy that is a git repository: a withheld choice is shown as offered; the reason is dropped; the card is dropped; a choice is sent as approve; a refusal is swallowed and the run returned as if decided; resume opens a fresh project; a judged line's skill and tier are dropped; the hash shown is not the one the kernel bound. Each caught, or a test added.
- [DOD-TT1-6] (must) `npm run check` passes, once, at the end. Size per file, never targeted (P-13). No test waits real minutes.

## Rules and constraints

- P-01 no comments. P-04 readable before short. P-12 one place: the shapes are the runs entry's. P-15, P-16, P-17. P-25. P-29.
- TypeScript: `components/base/typescript/practices.md`.
- The test toolbox stays small: only what the three outputs need.
- Write scope: `tests/test-toolbox.ts`, its test, a made-up mode for that test if one is needed, `docs/designs/proof/C1r-what-an-approval-shows.md`, the feature map if a rule names the toolbox. Anything else is named at the top of the report with its reason.
- Other builders are working in different worktrees on `components/base/proof/` and `components/base/forge/`. Do not edit those.
- Keep every scratch file under the one folder you are given under `/tmp`. Touch nothing else there. Inject bugs only in a throwaway copy. Never run prettier with `--write` on a folder. Stop a process of your own only by its process id.
- Commit after every step; keep your progress note current. Never push. Never touch `main` or another worktree.
- Report (P-22), in plain English and short sentences: the one line first; anything beyond the brief; each DOD item with pasted output; the bug table; what forge's first slice needs to know; what you did not do or verify.
