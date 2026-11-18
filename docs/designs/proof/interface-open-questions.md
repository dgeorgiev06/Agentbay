# proof@1: what the designs left open, and what was chosen

Slice I1 wrote `proof@1` from ADR 22 and the designs in this folder. These are the choices the designs did not make. Each says what was chosen and what a second implementation of `proof@1` is held to. A case named here is a case of `components/base/interfaces/proof/tests/shared.ts`.

## The request

1. **The slice's fields are the ones the brief lists, and no more.** A slice has a name, a kind, a write scope, the slices it comes after with the reason, the interface it builds against if any, and its items. Design A also gave a title and a feature for a capability slice; neither is in the form. A card that needs a title (W1, F1) gets it from the plan. A second implementation is held to the schema: the kernel refuses any other field.
2. **The kinds `in-scope` and `as-declared` are not named by items.** Proof adds the items `scope` and `declared` to every slice, and no item of the slice may take those ids; the schema refuses them. The other six kinds are named by items. Held by the case on the two added items.
3. **The kind `checks` holds the checks and one run of every test**, as in design A. Design C split them in two. The brief lists eight kinds with "the checks pass" as one. Held by the three `checks` cases.
4. **The declaration is required.** Design B made it optional and the item `declared` inconclusive without it. A reviewer by hand passes what the builder's note declared. Held by the schema.
5. **Action names are written `name.action`**, such as `notes.write`, for an action of a `mode.yaml` or of an interface's `.yaml` file. An action is changed when any line of its block differs between the base and the head. Held by the two `as-declared` cases on names (the scenario where names are declared wrongly, and the project with no commands, where they are declared right).
6. **A move counts as two paths.** Its old path and its new path must both be in the scope and both be declared. For the scope this is held by the `in-scope` case that names `docs/old.txt`; for the declaration by the `as-declared` case on a move declared by its new path alone.
7. **Bugs are part of the request, not the slice.** Each has a name, a patch and the test files that cover it, and only those files run with it. With no bugs, or with a bug whose patch does not apply, an item of the kind `bugs-caught` is inconclusive: a patch that touched nothing proves nothing. Held by the case on a bug's run and the `bugs-caught` cases.

## The verdict

8. **An inconclusive part outweighs a failed part.** ADR 22 says any inconclusive part makes its item inconclusive, so a failed run beside a run that did not finish is inconclusive, and the item's reason says what is not known. A known failure is not shown then. Held by the `real-thing` inconclusive case.
9. **A detail is one sentence, and the shared test asserts only what the brief requires of it**: the paths outside the scope, the name of a bug that survived, the counts of what is not as declared, and never a declared path. The sentence for a project with no commands is literal: "This project declares no commands whose output must not change, so nothing is known." Other wording is the implementation's.
10. **A verdict does not carry the item's level.** The card's script has the slice and reads must or should there.
11. **A judgement item is returned in its own list, `judgement`, exactly as given.** It has no verdict, so the closed set of three stays closed. Held by the case on judgement items.
12. **Size is a list of changed paths with their lines at the base and the head.** A key is left out where the file does not exist; a move's base is its old path; the list is empty when what changed is not known. Lines are counted as `wc -l` counts them. Held by the size case, with TR2's literal numbers.

## What a project declares

13. **The shape of proof's settings is in the interface's folder, `proof/settings.json`.** A mode's settings schema must be inside the mode's folder, so each implementation copies the file; the made-up proof reads it from the interface. The shared test gives settings in this shape under the mode's own name. A second implementation that reads another shape fails the `same-output` and `count` cases.
14. **A command whose output must not change is the words given to the copy's own `./bay.sh`, run at the copy's root.** Design A also had a fixture folder to run in; the words can say `--project tests/fixtures/sound` instead. Output and exit code are compared; standard error is not. A project with no `bay.sh` in its copies gets an inconclusive item, since the command cannot start. The real thing runs the same way, in one fresh copy of the head, its runs in order.
15. **A count's text is matched as written**, not as a pattern, so `listTrust.state` does not count `listTrustXstate`. A path that does not exist makes the count inconclusive. Held by the `count` cases: TR2's head holds a line with `listTrustXstate`, which a count by pattern would add.

## How the shared test reaches code

16. **One made-up mode serves both `toolchain@1` and `worktrees@1`** and records what it is asked in `.recorder/asked.json`. It keeps commits as files the test writes, so a case controls every commit and runs no git. A shared test may import only the test toolbox, so the mode's files are text inside `shared.ts`, written into a project folder of the test's own and trusted there.
17. **The made-up toolchain's time limit is simulated.** A file that says `hang` makes its run return the toolchain's inconclusive verdict for a run stopped at its limit, at once. A file that says `break` makes its call fail. So the paths "a time limit" and "a failure" cost no waiting. Proof's own script limit (eight minutes, `bay/runs/action-steps.ts`) is not tested: a script stopped there cannot remove its copies, and nothing in `proof@1` can.
18. **The made-up worktrees mode makes no links, and a proof asks for the links its settings name.** A project names in proof's setting `links` the paths a copy needs and a commit does not hold, such as installed packages; left out, a copy gets none. The kit names `node_modules`. Held by the case on links: with the setting left out every copy is asked with no links, and with two links named every copy is asked with those two and no other.
19. **A `bay.sh` at the project's root writes a file when it runs.** A proof that runs `bay` outside a copy leaves that file, and the case "nothing is written in the project outside throwaway copies" fails.

## TR2 in the form

20. **TR2's write scope is `bay/broker/*.ts`, `bay/trust.ts`, `tests/**` and `framework/features.yaml`.** Its brief named three broker files, "a new private file in `bay/broker/`", tests, the feature map and `bay/trust.ts`. A pattern cannot say "one new file", so `bay/broker/*.ts` stands for it. That pattern also admits `bay/broker/step-broker.ts`, which TR2 changed and its brief did not name. With the three files named alone, proof would have failed TR2's item `scope` on that path.
21. **TR2's base is `c7f0d13`, the commit its branch was cut from (its brief), and its head is `c9bb216`.** Between them eleven paths differ, the eleven of `git show --stat 1b0cc2a`, and they are its declaration. The first parent of its merge, `33cd559`, is not its base: the branch it merged into moved on after the cut, and twenty-four paths differ from there, seven of them outside its scope. On the real commits, through the real `git-worktrees` mode, proof passes `scope` and `declared` from `c7f0d13` and fails both from `33cd559`. The shared test makes commits of those names whose files are made up, with those eleven paths changed.
