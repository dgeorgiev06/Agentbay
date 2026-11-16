# Manifests as one deep module: design B, optimised for the common caller

Constraint: each thing a real caller does today is one short call that is hard to misuse. Ordering and error modes are made impossible, not documented. Rare needs may be awkward.

What callers can get wrong today:
- A loader must call `loadPolicedSystem`, not `loadSystemReport`. The second gives a system with no grants checked. Both are exported.
- Runs must pick one of four resolvers, and each returns `ActionTarget | string`, not `Outcome`.
- Runs reads a schema file, parses it, builds a fake `Loaded`, calls `checkValue` and branches on `unusable-schema`. `bay check` repeats this for examples.
- Runs must pass the right mode's `settings` in a `ReferenceScope`. Safety rebuilds a `Loaded<Mode>` to call `problemAt`.
- `bay check` finds and parses every manifest and interface a second time; `bay new` repeats the tier folders; `bay build` and the skill step each parse `SKILL.md`.

## 1. The interface

One entry file, `bay/manifests/manifests.ts`. **16 exported names** (today 30, plus 8 used only by tests). `Wording` and `Placer` are declared in the entry file but not exported.

```ts
export function loadSystem(files: FileSystem, layout: Layout): Promise<Outcome<System>>;
export function inspectSystem(files: FileSystem, layout: Layout): Promise<Inspection>;
export function placeToWrite(files: FileSystem, layout: Layout, part: NewPart): Promise<Outcome<string>>;

export type System = {
  readonly config: Config;
  readonly activeModes: readonly ActiveMode[];
  readonly bindings: readonly BindingUse[];
  readonly skills: readonly SkillUse[];
  readonly mode: (name: string) => Outcome<ActiveMode>;
  readonly action: (reference: string) => Outcome<ActionTarget>;
  readonly workflow: (mode: string, path: string) => Outcome<WorkflowTarget>;
  readonly listing: (question: ListingQuestion) => Outcome<ActionsListing>;
};
export type ActiveMode = {
  readonly name: string;
  readonly home: Home;
  readonly folder: string;
  readonly manifest: Mode;
  readonly grants: ModeGrants;
  readonly settings: Readonly<Record<string, Json>>;
  readonly settingsSchema: Schema | undefined;
  readonly skills: ReadonlyMap<string, SkillUse>;
  readonly action: (name: string) => Outcome<ActionTarget>;
};
export type ActionTarget = {
  readonly mode: ActiveMode;
  readonly name: string;
  readonly reference: string;
  readonly action: Action;
  readonly input: Schema;
  readonly output: Schema;
};
export type WorkflowTarget = {
  readonly mode: ActiveMode;
  readonly path: string;
  readonly workflow: Workflow;
  readonly resolve: (value: Readonly<Record<string, unknown>> | string, scope: ReferenceScope) => Outcome<Json>;
};
export type ReferenceScope = {
  readonly trigger: Json;
  readonly outputs: ReadonlyMap<string, Json>;
  readonly item?: Json;
};
export type Schema = {
  readonly file: string;
  readonly json: Json;
  readonly check: (value: unknown, reportIn?: string) => Outcome<Json>;
};
export type SkillUse = {
  readonly mode: string;
  readonly name: string;
  readonly file: string;
  readonly description: string;
  readonly tier: Tier;
  readonly effects: readonly Effect[];
  readonly grants: ModeGrants;
  readonly output: Schema | undefined;
};
export type BindingUse = {
  readonly interfaceName: string;
  readonly requirers: readonly string[];
  readonly servedBy: string;
};
export type ListingQuestion = { readonly mode?: string; readonly find?: string };
export type ActionsListing =
  | { readonly modes: readonly { readonly name: string; readonly description: string }[] }
  | { readonly mode: string; readonly actions: readonly ActionListed[] };
export type NewPart =
  | { readonly mode: string; readonly tier: "base" | "modes" }
  | { readonly inMode: string }
  | { readonly interface: string };
export type Inspection = {
  readonly problems: readonly Problem[];
  readonly notices: readonly Problem[];
  readonly folders: readonly InspectedFolder[];
  readonly interfaces: ReadonlyMap<string, Interface>;
};
export type InspectedFolder = {
  readonly home: Home;
  readonly folder: string;
  readonly label: string;
  readonly manifest: { readonly mode: Mode; readonly at: Placer } | undefined;
  readonly actions: ReadonlyMap<string, { readonly input: Schema; readonly output: Schema }>;
  readonly skills: readonly { readonly file: string; readonly frontMatter: Outcome<SkillFrontMatter> }[];
};

type Wording = { readonly message: string; readonly fix?: string };
type Placer = (path: readonly (string | number)[], wording: Wording) => Problem;
type ActionListed = {
  readonly name: string;
  readonly description: string;
  readonly effects: readonly Effect[];
  readonly input: Json;
};
```

Rules the feature enforces, so no caller has to:
- **Only a policed system exists.** `loadSystem` succeeds only when every manifest loads, every rule holds and every active mode's grants are valid. There is no other way to get a `System`. It holds active modes only.
- **Check equals load.** `loadSystem` fails exactly when `inspectSystem(...).problems` is not empty, with the same problems. Both run one private pass.
- **One resolver.** `system.action("notes.add")` takes what an owner or a run record writes. `mode.action(name)` takes a name as that mode writes it: `add`, or `items-store.put` through its binding. An inactive mode is refused in one wording, kept here.
- **Settings cannot be mixed up.** `WorkflowTarget.resolve` takes settings from its own mode; a record resolves each top-level field, a string one reference.
- **A schema checks itself.** `Schema.check` compiles on first use and returns the value as `Json` or every problem, at `/input/...` or `/output/...`. An unusable schema is a problem, not a second kind of result. `reportIn` names the file to report in; the default is the schema file.
- **Problems are placed.** Each has file, pointer and line, with paths shown from the project. Callers never see `Loaded`, `lineOf` or path segments, except through `manifest.at`. Folder rules live once: `placeToWrite` says where `bay new` may write, and refuses the kit, a taken name or a missing mode.

## 2. Usage by each caller

Kernel wiring (`bay/kernel.ts`). `Kernel` keeps `system` and loses `policyOf`; `openRuns` takes `system.value` and no `policyOf`.
```ts
const system = await loadSystem(ports.files, layout);
if (!system.ok) {
  return system;
}
const declaredBy = system.value.activeModes.map((mode) => mode.grants);
const secrets = await SecretStore.open({ ...storeOptionsOf(options), declaredBy });
```

Safety. The direction flips: manifests calls safety once per active mode, inside the load. Safety's entry gains one pure function on plain data. It loses `loadPolicedSystem`, `policyFor`, `permissionsFor`, `PolicedSystem`, `PolicedReport` and `inactiveModeWording`.
```ts
export function grantsOf(request: GrantRequest): Outcome<ModeGrants>;
export type GrantRequest = {
  readonly manifest: Mode;
  readonly folder: string;
  readonly home: Home;
  readonly layout: Layout;
  readonly otherModeFolders: readonly { readonly name: string; readonly folder: string }[];
  readonly at: (path: readonly (string | number)[], wording: { readonly message: string; readonly fix?: string }) =>
    Problem;
};
```

`bay check`. Its `context` is `inspection.folders` and `inspection.interfaces` plus the kit listing; skill name checks read `folder.skills[i].frontMatter`.
```ts
const inspection = await inspectSystem(ports.files, layout);
const findings = [...errors(inspection.problems), ...warnings(inspection.notices), ...(await checkSkills(context))];
const warning = folder.manifest.at(["resources", "commands", index], { message, fix });
const example = folder.actions.get(name)?.input.check(given.input, exampleFile);
```

`bay new` (`bay/new.ts`):
```ts
const folder = await placeToWrite(workspace.files, workspace.layout, { mode: name, tier });
const target = await placeToWrite(workspace.files, workspace.layout, { inMode: mode });
const file = await placeToWrite(workspace.files, workspace.layout, { interface: name });
```

Harness build (`bay/build.ts`). `planAgents` no longer parses skills or merges tiers; `agentOf` copies the fields of `SkillUse` and adds `kernelTools` from `skillToolsOf`. `BuildRequest.system` goes: the Claude Code adapter reads nothing from it.
```ts
const agents = await Promise.all(system.skills.map((skill) => agentOf(files, skill)));
```

Runs, starting an action, calling through an interface, finding a workflow. A stored run re-finds its target with ``system.action(`${mode}.${action}`)``. `RunsNeeds.policyOf` goes.
```ts
const target = system.action(reference);
const called = frame.mode.action(call.call);
const workflow = system.workflow(run.target.mode, run.target.name);
const grants = frame.mode.grants;
```
Runs, resolving a reference, then validating input and output:
```ts
const stepInput = scope.workflow.resolve(at.step.input, { trigger: scope.trigger, outputs: scope.outputs });
const input = target.input.check(given);
const output = target.output.check(result);
const skillOutput = target.mode.skills.get(step.skill)?.output?.check(submission.output);
```

The `actions` command and tool (live, as ADR 0012 asks):
```ts
const system = await loadSystem(files, layout);
const listing = system.ok ? system.value.listing(question) : system;
```
`bay config` reads `kernel.system.bindings`. The settings listing reads `mode.settings` and `mode.settingsSchema`, with no file read. `bay approve` and `bay build` keep `kernel.system.config`.

## 3. What the implementation hides, and the files

Hidden: `Loaded<T>`, `lineOf`, path segments and pointers, Ajv, the YAML parser, the five manifest schemas, where modes and interfaces live, the forge rule, activation through bindings, `servingMode`, `name@major`, the call and reference grammars, static reference checks, inactive notices, file reference checks, cycles, schema reading, skill front matter, and `SystemReport`.

| File today | Lines | After | Lines (estimate) |
|---|---|---|---|
| registry.ts | 1,347 | `manifests.ts`: entry, one private pass, `System` and its questions, resolution, listing | 300 |
| | | `folders.ts`: tiers, finding folders and files, `placeToWrite` with the rules from `new.ts` | 200 |
| | | `consistency.ts`: activation, indexes, bindings, implements, calls, undo, file references, cycles, settings | 700 |
| spec.ts | 423 | `read.ts`: YAML, schema wording, front matter, `Schema`; schema reading from registry and `walk.ts` merged | 400 |
| references.ts | 229 | `workflows.ts`: reference grammar, static checks, `resolve`, and registry's workflow checks | 300 |
| targets.ts | 68 | deleted; about 35 lines in `manifests.ts` | 0 |
| generate-types.ts | 150 | the feature `generator`: no kernel code calls it; may import vocabulary and platform | 145 |
| **Total** | **2,217** | | **2,045** |

Callers, estimates: policy.ts 339 to 255, new.ts 365 to 285, check-context.ts 129 to 45, check-skills.ts 464 to 425, check-layout.ts 289 to 275, build.ts 143 to 90, walk.ts 221 to 190, skill-steps.ts 104 to 85, workflow-steps.ts 277 to 265, engine.ts 553 to 540, settings-listing.ts 121 to 108, and small falls in tools, kernel, undo, waiting, action-steps and the actions command. Callers about 4,350 to 3,870. Production total about 6,560 to 5,915.

## 4. Dependency strategy

| Need | Seam | Real adapter | Test adapter |
|---|---|---|---|
| Files: manifests, schemas, `SKILL.md`, folder lists | `FileSystem` port, the first argument of every function | `nodeFileSystem` | `fakeFileSystem` |
| Where the kit and project are | none: `Layout` is data | `layoutOf` | `layoutOf` on `/kit` |
| Grant rules | none: manifests calls safety's `grantsOf` | safety | the same safety |
| YAML parser, Ajv | none: libraries, private to `read.ts` | | |

One port, two adapters; nothing else is swapped. `features.yaml` changes: manifests may import vocabulary and safety; safety may import vocabulary only. Safety no longer knows what a system is. One deep module or more? One. Load checks the reference grammar and runs resolves with it, so the grammar has one home. Targets follow bindings, which only manifests reads. Schema checks need the wording of load problems. Splitting any of these out gives a feature that imports manifests' private shapes back. The one seam that leaves is the generator. Inside, `read.ts` (text to typed values) and `consistency.ts` (rules over typed values) are private files, not ports.

## 5. Testing through the interface only

Setup: `fakeFileSystem` with `validFiles()` from `tests/system-fixture.ts` plus the changes a test needs, and `layoutOf` for a kit or for a project beside it. Calls: `loadSystem`, `inspectSystem`, `placeToWrite`. Assertions are literal: a `Problem` with file, pointer, line, message and fix, or an answer of `System`.
- YAML and schema wording (today `spec.test.ts`): a broken `mode.yaml` gives a problem with its line; `Schema.check` gives the input wording.
- Activation, bindings, forge, duplicates, targets: `system.activeModes`, `system.bindings`, problems, and refusal texts of `system.action` and `mode.action`. `servingMode` is asserted as `system.mode("briefing")` then `.action("items-store.get")` naming the store.
- Grants: one test that a bad write path stops `loadSystem` at the manifest's line. The rule's cases stay in safety's tests, on `grantsOf` with plain data. `broker-fixture.ts` loses `systemOf`.
- Check equals load: for every broken fixture, `loadSystem` fails with exactly `inspectSystem().problems`. A bug injected in either path fails it.
- References as load problems and through `system.workflow(...).resolve`; listing through `system.listing`; placement through `placeToWrite` for each part, in a kit and a project.

Names only tests use: `servingMode`, `isReferenceText`, `parseReference`, `resolveReference` and `workflowReferenceIssues` stop being exported, and the middle three leave the ADR 0009 exemption list. `typeDeclarations` stops being exported; `generatedTypeFiles` and `staleTypeFiles` are the generator's entry, which its own command line uses. `spec.test.ts`, `references.test.ts` and `targets.test.ts` are deleted once rewritten. Tests: about 1,780 lines to about 1,500 (estimate).

## 6. The 16 debt entries

All 16 go. None is added. Not manifests debt, so left alone: `kernel.ts` to `check-context.ts`, `build.ts` to `skill-tools.ts`, `new.ts` to `script-protocol.ts`.
- `build.ts`, `check.ts`, `check-context.ts`, `check-layout.ts`, `check-skills.ts` to `spec.ts` (5): skills come from `System.skills` or `InspectedFolder.skills`, schema checks from `Schema.check`, placing from `manifest.at`. Check keeps its own `Wording` type.
- `policy.ts` to `spec.ts` (1): safety is handed `at` and imports nothing of manifests.
- runs to `targets.ts`, `spec.ts` and `references.ts` (9): runs uses `System`, `ActionTarget`, `WorkflowTarget`, `Schema` and `SkillUse` from the entry.
- `generate-types.ts` to `node-ports.ts` (1): the generator is its own feature and may import platform.

## 7. Trade-offs

What this makes harder:
- **No literal systems in tests.** `System` holds functions, so a test writes files and loads. Broker, listing and runs fixtures get slower and longer.
- **Load does more.** Every bay command reads each active skill's front matter and each action's schemas. A broken front matter now stops every command, not only the run or build that uses it.
- **Safety loses its view.** `grantsOf` sees one mode and a list of other folders. A rule that needs bindings must widen `GrantRequest`.
- **`Inspection` serves one caller.** It mirrors what `bay check` needs today; each new check rule that needs a new fact widens it. Scaffold refusal wording moves into manifests. In `mode.action` a dot means a call through an interface; a reader of runs must know that.

**Strongest argument against:** it answers today's questions by pulling three neighbours' rules into one place. Grant placement, skill front matter, scaffold folders and runs' four resolvers all become manifests code. `System` gives answers, not data, so the next caller with a new question has nothing to pick apart and must add a method: the Chief of Staff browsing inactive modes, a second harness wanting raw manifests, a check rule needing one more fact. The feature becomes where every manifest-adjacent change lands, which is the 1,347-line problem again, in a folder. An interface that hands out typed, read-only data would change less as callers change.

## 8. Migration

Each slice is one feature and one concern, leaves `npm run check` green, and deletes what it replaces.
1. **G1 generator.** `bay/generate-types.ts` becomes the `generator` feature; `typeDeclarations` stops being exported. One debt entry goes.
2. **M1 move.** A script moves the four files into `bay/manifests/` and rewrites import paths. Nothing else changes.
3. **S1 grants on plain data.** Safety exports `grantsOf`. `policyFor` and `permissionsFor` go; `loadPolicedSystem` is rebuilt on `grantsOf` for now. Policy tests move to `grantsOf`. The `policy.ts` entry goes.
4. **M2 entry and questions.** `manifests.ts` with `loadSystem` (calling `grantsOf`) and the questions for modes, actions, workflows, bindings, listing and config. Kernel, tools, the `actions`, `config`, `approve` and `build` commands, the settings listing, runs' resolvers and `policyOf`, and the fixtures move. `targets.ts`, `loadPolicedSystem`, `loadSystemReport`, `bindingUses`, `actionsListing` and `servingMode` go. `may_import` flips for safety and manifests. Six runs entries go.
5. **M3 schemas and references for runs.** `Schema.check` and `WorkflowTarget.resolve`; `walk.ts` and `workflow-steps.ts` stop importing `spec.ts` and `references.ts`. Two entries go.
6. **M4 skills.** `System.skills` and `ActiveMode.skills`; `build.ts` and `skill-steps.ts` stop parsing `SKILL.md`; `BuildRequest.system` goes. Two entries go.
7. **M5 inspection.** `inspectSystem`; `check-context.ts` stops finding and parsing; check uses `Schema.check`, `manifest.at` and `folder.skills`. The check-equals-load test is added. Four entries go.
8. **M6 placement.** `placeToWrite`; `new.ts` loses its tier folders and folder refusals; `findModeFolders` and `ownInterfacesFolder` stop being exported.
9. **M7 tests at the entry.** `spec.test.ts`, `references.test.ts`, `targets.test.ts`, `registry*.test.ts` and `actions-listing.test.ts` are rewritten through the entry, and the old ones deleted. Three names leave the exemption list.
10. **M8 fold.** `registry.ts` splits into `folders.ts`, `consistency.ts` and `workflows.ts`; `spec.ts` becomes `read.ts`; `features.yaml` follows. The dead-code tool and the copy-paste detector find nothing in the folder. Size is reported, not targeted.
