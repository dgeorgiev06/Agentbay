# Design frame: the manifests feature as one deep module

Read-only design task. Do NOT change any file in /home/claude/agentbay and run no git command that writes. Write one file only, the path you are given.

## Read
- /home/claude/agentbay/CONTEXT.md (use these words exactly)
- /home/claude/agentbay/framework/practices.md and /home/claude/agentbay/components/base/typescript/practices.md
- /home/claude/agentbay/docs/adr/0006, 0009, 0010 (the runs feature, the worked example of this process), 0011, 0012
- /home/claude/agentbay/docs/designs/runs/ (how three designs were compared last time)
- /home/claude/agentbay/framework/features.yaml (the `manifests`, `safety`, `check`, `scaffold` and `harness` features) and framework/feature-map-debt.yaml (entries whose `from` or `to` is a manifests file)
- The manifests feature's files: bay/registry.ts (1,347 lines), bay/spec.ts (423), bay/references.ts (229), bay/generate-types.ts (150), bay/targets.ts (68); the generated types in bay/generated/ (vocabulary)
- Its callers: bay/policy.ts (safety), bay/check*.ts (check), bay/new.ts (scaffold), bay/build.ts and bay/adapter.ts (harness), bay/runs/*.ts (runs), bay/tools.ts (agent-tools), bay/commands/*.ts (command-line), bay/kernel.ts
- Its tests: tests/registry*.test.ts, tests/spec.test.ts, tests/references.test.ts, tests/targets.test.ts, tests/actions-listing.test.ts, tests/system-fixture.ts

## Facts measured today
- 2,217 lines in 5 files. One file is 1,347 lines and exports 17 names.
- Other kernel features import 30 names from 4 of the files:
  - references.ts: ReferenceScope, resolveInput, resolveValue (runs)
  - registry.ts: System (5 features), LoadedMode (3), SystemReport, loadSystemReport (safety), ModeFolder, findModeFolders, findInterfaceFiles, ownInterfacesFolder (check, scaffold), BindingUse, bindingUses, ActionsListing, ActionListed, ModeListed, ListingQuestion, actionsListing (command-line, agent-tools)
  - spec.ts: Loaded, PathSegments, Wording, checkValue, loadSpec, parseSkill, problemAt (check, safety, runs, harness)
  - targets.ts: ActionTarget, resolveActionReference, resolveCall, resolveNamedAction, resolveOwnAction (runs)
- Tests import 8 further names nothing else uses.
- 15 entries of the boundary debt are imports that reach into a private manifests file; 1 is manifests reaching out.
- `loadPolicedSystem` in bay/policy.ts (safety) is how the kernel, `bay check`, `bay actions` and the tool server all load a system. Safety wraps manifests.
- The registry reads every action's input schema at load, for `bay actions`.

## The problem
The feature's interface is whatever its five files export. A caller that wants "the system" also learns about folders, spec loading, problem wording, path segments and reference resolution. One file does finding folders, reading YAML, validating against schemas, resolving interfaces and bindings, working out the active set, and listing actions. The goal is one entry file with a small interface, tests that assert through it, and the same code or rule in one place.

## Questions every design must answer
1. What is "the system" a caller receives, and what can it ask of it? Should callers hold a data structure they pick apart, or ask questions (which mode serves this interface for this requirer; what are this mode's grants; what does this action take)?
2. Where do loading and policy meet? Today safety wraps manifests. Should a caller ever see an unpoliced system?
3. Where do reference resolution (`$trigger`, `$steps.x.output`, `$settings.k`) and target resolution (`mode.action`, `interface.action`) belong: manifests, runs, or their own feature?
4. Where does schema validation of arbitrary values (`checkValue`, used by runs for action input and output) belong?
5. What does `bay check` need that `bay call` does not, and how does it get it without the interface widening for everyone?
6. How does `bay new` find where to write without learning the registry's folder rules twice?
7. Is this one deep module or more than one? Say where each seam goes and which two adapters exist at each.

## Your output (one Markdown file, at most 260 lines, plain English, short sentences)
1. The interface: each entry file's exports as TypeScript signatures. Count the exported names.
2. A usage example for each caller: kernel wiring, safety, check, scaffold, harness build, runs (starting an action, resolving a reference, validating input), the `actions` command and tool.
3. What the implementation hides. Which of today's files split, merge, move to another feature or are deleted. Lines before and after, per file, as estimates labelled as estimates.
4. Dependency strategy: what the feature needs from outside and at which seams; for each seam, the two adapters that exist.
5. How it is tested through the interface only, and what happens to the names only tests use.
6. Which of the 16 debt entries disappear and which remain, and why.
7. Trade-offs: what this design makes harder, and the strongest argument against it.
8. Migration: an ordered list of slices, each small enough for one builder (one feature, one concern), each leaving `npm run check` green.

The practices bind the design. In particular: no comments in code; no class inheritance; no `any` or assertion; at most three parameters; problems as values (`Outcome<T>`); a port only with two adapters; replace and delete, never layer.
