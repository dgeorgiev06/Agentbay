# Manifests feature, design C: designed around seams

## 0. The seams, decided first

The feature should hold one idea: what the owner wrote in manifests, read once and answered. Four things sit in it today by accident:

| Today in manifests | Belongs to | Why |
|---|---|---|
| `generate-types.ts` | a development tool, `scripts/generate-types.ts` | It writes `bay/generated/` for `npm run generate`. No kernel code calls it. It is why manifests imports `node-ports.ts`. |
| Mode folder rules copied into `new.ts`, `check-context.ts`, `policy.ts` | manifests, once | Where modes and interfaces live is a manifests rule. Three features restate it. |
| A second loader in `check-context.ts` | manifests | It finds folders and parses every `mode.yaml` again. |
| Schema files read again at run time (`runs/walk.ts`) and skills parsed in three features | manifests | Same parse, four places. |

Candidate modules, and my decision on each:

| Candidate | Decision | Reason |
|---|---|---|
| Reading one file against its schema, wording errors with lines (`spec.ts`) | **Private seam inside manifests.** | It is deep (420 lines behind three functions) and changes for its own reasons. But once callers ask a mode to check a value, nothing outside manifests needs it. A feature with one caller is a file. |
| Assembling files into a system: interfaces, bindings, active set | **The core.** | Indexing, activation, binding checks and cycles share one context and every problem wording. Splitting them exports that context across a seam, as runs' record and engine would have. |
| Resolving `mode.action` and `interface.action` (`targets.ts`) | **Questions to the system.** | It is "which mode serves this interface for this requirer". `servingMode` is exported only so `targets.ts` can ask. |
| References `$trigger`, `$item`, `$settings.k`, `$steps.x.output` | **Manifests, private, two functions exported.** | Static checks at load and evaluation at run time are one language. Runs supplies the scope; manifests says what the text means. |
| Listing actions (ADR 12) | **A question to the system.** | 60 lines, reads only manifest contents. |
| Policy (`policy.ts`, safety) | **Stays a feature. The dependency flips.** | See below. |

**Loading and policy.** No caller should hold an unpoliced system, so loading applies policy. I considered merging policy into manifests and rejected it: the grant rules change for security reasons, and `effect-rule.ts` serves the broker, scripts and harness, which must not import manifests. Instead safety stops importing manifests. It takes one mode's manifest, folder and the other modes' folders, and returns grants or placed wordings. Manifests calls it inside `loadSystem`. Every caller gets one call and a policed system. `loadPolicedSystem`, `PolicedSystem` and `PolicyOf` are deleted.

**Ports.** Only one is real.

| Need from outside | Decision | Adapters |
|---|---|---|
| Files (read, list, exists) | **Port.** `FileSystem`, kept. | real: `nodeFileSystem`; test: `fakeFileSystem` |
| YAML parser, Ajv | **Not ports.** One adapter each; hidden in `documents.ts`. | real only |
| Grant rules | **Not a seam.** A function of safety, called for real in tests. | real only |
| Layout | **A value.** | |
| A "manifest source" other than files | **Hypothetical.** Not built. | one |

## 1. The interface

Entry file: `bay/manifests/manifests.ts`. **15 exported names** (today: 44 across five files).

```ts
export function loadSystem(files: FileSystem, layout: Layout): Promise<Outcome<System>>;
export function surveySystem(files: FileSystem, layout: Layout): Promise<Survey>;
export function resolveValue(value: unknown, scope: ReferenceScope): Outcome<Json>;
export function resolveInput(input: Readonly<Record<string, unknown>>, scope: ReferenceScope): Outcome<Json>;

export type System = {
  readonly config: Config;
  readonly active: readonly ActiveMode[];
  readonly action: (mode: string, name: string) => Outcome<ActionTarget>;
  readonly target: (reference: string) => Outcome<ActionTarget>;
  readonly step: (caller: ActiveMode, name: string) => Outcome<ActionTarget>;
  readonly bindings: () => readonly BindingUse[];
  readonly listing: (question: ListingQuestion) => Outcome<ActionsListing>;
};

type ReadMode = {
  readonly home: Home;
  readonly base: boolean;
  readonly folder: string;
  readonly manifest: Mode;
  readonly callable: readonly string[];
  readonly fits: (schema: string, value: unknown, place: ValuePlace) => Promise<readonly Problem[]>;
  readonly skill: (path: string) => Promise<Outcome<SkillFrontMatter>>;
};

type ValuePlace = { readonly path: PathSegments; readonly file?: string };

export type ActiveMode = ReadMode & {
  readonly name: string;
  readonly settings: Readonly<Record<string, unknown>>;
  readonly workflows: ReadonlyMap<string, Workflow>;
  readonly grants: ModeGrants;
};

export type ActionTarget = { readonly mode: ActiveMode; readonly name: string; readonly action: Action };

export type Survey = {
  readonly outcome: Outcome<System>;
  readonly notices: readonly Problem[];
  readonly modes: readonly FoundMode[];
  readonly interfaces: ReadonlyMap<string, Interface>;
  readonly folders: {
    readonly modes: readonly { readonly home: Home; readonly base: boolean; readonly folder: string }[];
    readonly interfaces: readonly string[];
    readonly ownInterfaces: string;
  };
};

export type FoundMode =
  | { readonly state: "unreadable"; readonly home: Home; readonly base: boolean; readonly folder: string;
      readonly active: boolean }
  | (ReadMode & { readonly state: "read"; readonly active: boolean });

export type BindingUse = { readonly interfaceName: string; readonly requirers: readonly string[]; readonly servedBy: string };
export type ListingQuestion = { readonly mode?: string; readonly find?: string };
export type ModeListed = { readonly name: string; readonly description: string };
export type ActionListed = ModeListed & { readonly effects: readonly Effect[]; readonly input: Json };
export type ActionsListing = { readonly modes: readonly ModeListed[] } | { readonly mode: string; readonly actions: readonly ActionListed[] };
export type ReferenceScope = { readonly trigger: Json; readonly outputs: ReadonlyMap<string, Json>; readonly item?: Json; readonly settings: Readonly<Record<string, unknown>> };
```

Rules a caller must know:
- `System` holds active modes only. `action` refuses an unknown mode, an unknown action, and an inactive mode (with today's "not active in this project" wording, which moves here from safety).
- `step` takes what a mode names: `put` (its own action) or `items-store.put` (through its binding).
- `fits` checks a value against a schema the mode names, by path. Input schemas are read at load, others when asked, as today. `skill` reads front matter when asked. What loads does not change.
- `surveySystem` never fails. It is for `bay check` and `bay new`, which must work on a broken project.
- `PathSegments` and `Wording` move into `bay/outcome.ts`: they are the shape of a problem, used by check, safety and manifests.
- `base` replaces "tier" for `components/base`, because the glossary gives **Tier** to `fast`, `balanced`, `deep`. "Base mode" goes into `CONTEXT.md` first.

## 2. Usage by each caller

Kernel wiring (`bay/kernel.ts`). `Kernel` loses `policyOf`.
```ts
const loaded = await loadSystem(ports.files, layout);
if (!loaded.ok) { return loaded; }
const system = loaded.value;
const secrets = await SecretStore.open({ ...storeOptionsOf(options), declaredBy: system.active.map((mode) => mode.grants) });
const runs = await openRuns({ project: layout.project, folders: ports.folders, files: ports.files, clock: ports.clock,
  system, scrubber: secrets, toolCallsPerRound: limits.toolCallsPerRound, runner });
```

Safety, called inside `loadSystem` for each active mode. Safety no longer imports manifests.
```ts
const check = grantsOf({ manifest: mode.value, folder: mode.folder, base: mode.base, others, layout });
const problems = "problems" in check ? check.problems.map((placed) => problemAt(mode, placed.path, placed)) : [];
```
The warning "a base mode lists a command" moves from `check.ts` into `grantsOf` as a notice, beside the refusal for other modes. One rule, two outcomes, one place.

Check (`bay/check.ts`, `bay/check-context.ts`).
```ts
const survey = await surveySystem(ports.files, layout);
const context = await checkContextOf(survey, ports.listing, layout);
const loading = survey.outcome.ok ? [] : errors(survey.outcome.problems);
const findings = [...loading, ...warnings(survey.notices), ...(await checkSkills(context)), ...];
```
Examples (`check-layout.ts`): `await mode.fits(action.input, example.input, { file: place.file, path: ["input"] })`.
Skills (`check-skills.ts`): `mode.callable` replaces `allowedTools`' own copy of the callable-names rule; `await mode.skill(folder)` gives the front matter name.

Scaffold (`bay/new.ts`). `tierFolders` and `foundMode` are deleted.
```ts
const survey = await surveySystem(workspace.files, workspace.layout);
const found = survey.modes.find((mode) => basename(mode.folder) === name);
const interfacesFolder = relative(workspace.layout.project, survey.folders.ownInterfaces);
```

Harness build (`bay/build.ts`): skill uses come from `system.active`; `const front = await mode.skill(use.skill)` gives `front.value.description`; `grants: mode.grants`. `BuildRequest.system` in `bay/adapter.ts` is deleted: the only harness adapter never reads it.

Runs, starting an action and validating its input.
```ts
const target = system.target(reference);
if (!target.ok) { return refusal("new", target.problems); }
const problems = await target.value.mode.fits(target.value.action.input, input, { path: ["input"] });
```
Runs, elsewhere: a call step asks `system.step(frame.mode, call.call)`; an undo asks `system.action(mode.name, action.undo)`; a reference is `resolveValue(step.foreach, { trigger, outputs, settings: scope.mode.settings, item })`; a skill's output is `mode.fits(schema, output, { path: ["output"] })`; grants are `target.mode.grants`, not `policyOf(name)`.

The `actions` command and tool, both live (ADR 12): `const loaded = await loadSystem(files, layout);` then `loaded.ok ? loaded.value.listing(question) : loaded`. `bay config`: `kernel.system.bindings()`.

## 3. What the implementation hides, and the line counts

Hidden: folder rules, YAML and line numbers, Ajv and error wording, `Loaded<T>`, indexing and duplicates, activation, binding lookup, the forge rule, cycle search, the reference grammar, the schema cache, the call to safety. All counts after are estimates.

| File today | Lines | After | Lines (est.) |
|---|---|---|---|
| registry.ts | 1,347 | `manifests/manifests.ts` (entry: load, survey, the questions) | 240 |
| | | `manifests/folders.ts` (where modes and interfaces live, `base`) | 100 |
| | | `manifests/assembly.ts` (read, index, activate) | 330 |
| | | `manifests/consistency.ts` (requires, implements, calls, undo, files, cycles, workflows, settings) | 540 |
| | | `manifests/listing.ts` | 65 |
| targets.ts | 68 | merged into the entry | (in 240) |
| spec.ts | 423 | `manifests/documents.ts`; gains the one `readSchemaFile` and the schema cache; loses `headings` | 430 |
| references.ts | 229 | `manifests/references.ts`; parse and scope checks private | 215 |
| generate-types.ts | 150 | `scripts/generate-types.ts`, outside the kernel | (150, not counted) |
| **Feature** | **2,217** | | **~1,920** |

Callers, estimated: policy.ts 339 to 290, check-context.ts 129 to 55, check.ts 119 to 100, check-skills.ts 464 to 450, check-layout.ts 289 to 285, new.ts 365 to 345, build.ts 143 to 135, adapter.ts 52 to 49, kernel.ts 125 to 118, tools.ts 275 to 265, commands/actions.ts 69 to 62; the runs files lose about 60 (the second schema reader in `walk.ts`, `policyOf` plumbing). Callers: about 2,370 to 2,100.
Tests: registry, spec, references, targets and listing tests, 1,611 to about 1,350. All three: about 6,200 to 5,370.

## 4. Dependency strategy

- **Files** sit at the `files` argument of `loadSystem` and `surveySystem`. Real adapter: `nodeFileSystem`. Test adapter: `fakeFileSystem`. A loaded mode keeps the same `FileSystem` for `fits` and `skill`.
- **Safety** is imported, not passed. manifests may import vocabulary and safety; safety may import vocabulary only. `features.yaml` changes both lines.
- **Vocabulary** gives `Outcome`, `Problem`, `Wording`, `PathSegments`, `Layout`, `Home`, the generated types, `ModeGrants`.
- **YAML and Ajv** are libraries behind `documents.ts`. They are not ports: there is one of each, and no test swaps them.

## 5. Testing through the interface only

Tests import `bay/manifests/manifests.ts`, `tests/fakes.ts` and `tests/system-fixture.ts`. Safety is real.
- Load problems: `(await surveySystem(fakeFileSystem(rooted(files)), layout)).outcome` with literal messages, files and lines. This covers today's registry tests unchanged in substance.
- Schema wording (today's `spec.test.ts`): a broken `mode.yaml` or workflow on the fake file system, asserted through load problems; arbitrary values through `mode.fits`.
- References: static issues through load problems of a workflow; evaluation through `resolveValue` and `resolveInput` with a literal scope.
- Targets: `system.target`, `system.step`, `system.action`, including the inactive wording.
- Grants: `grants` equals literal `ModeGrants`; a protected path refuses the load. Survey: a broken kit mode is `"unreadable"` with its folder.
- Fixtures that build a `System` by hand (`broker-fixture.ts`, `runs-fixture.ts`, `inside/runs/engine-harness.ts`) load it through `loadSystem` from `system-fixture.ts` files instead. A hand-built `System` cannot be written, because its questions are closures.

Names only tests use today:
- `servingMode`: no longer exported; asked through `system.step`.
- `isReferenceText`, `parseReference`, `resolveReference`: file-private. They leave the ADR 9 exemption list.
- `permissionsFor`, `policyFor` (safety): replaced by `grantsOf`, which is safety's interface. They leave the exemption list. Only `scriptCommand` remains on it.
- `typeDeclarations`, `generatedTypeFiles`, `staleTypeFiles`: move with the tool. A development tool is not a feature; its test may import it.
- `Skill.headings`: deleted. Only a test read it; check-skills splits sections itself.

## 6. The 16 debt entries

All 16 go.

| Entries | Why they go |
|---|---|
| `build.ts`, `runs/skill-steps.ts` to `spec.ts` (`parseSkill`) | `mode.skill` |
| `runs/walk.ts` to `spec.ts` (`checkValue`) | `mode.fits` |
| `check-layout.ts` to `spec.ts` | `mode.fits`; `Wording` is vocabulary |
| `check-skills.ts` to `spec.ts` | `mode.skill`; `Wording` is vocabulary |
| `check-context.ts` to `spec.ts` | `surveySystem` replaces the second loader |
| `check.ts` to `spec.ts` (`problemAt`) | the base-command warning moves to safety |
| `policy.ts` to `spec.ts` | safety returns paths and wordings; manifests places them |
| `runs/action-steps`, `engine`, `undo`, `waiting`, `walk`, `workflow-steps` to `targets.ts` (6) | `system.action`, `target`, `step`; `ActionTarget` from the entry |
| `runs/workflow-steps.ts` to `references.ts` | `resolveValue`, `resolveInput` from the entry |
| `generate-types.ts` to `node-ports.ts` | the tool leaves `bay/` |

No new entry is made. `manifests` gains `safety` in `may_import`; `safety` loses `manifests`.

## 7. Trade-offs

What gets harder:
- `bay new` now loads the whole system, grants and schemas included, to find a folder. It is slower and reads files it does not need.
- A loaded mode keeps a `FileSystem`, so `fits` and `skill` are async and can meet a file that changed since load. Today's code has the same window; the design makes it visible, not smaller.
- Tests can no longer hand-build a `System`; they write manifests into the fake file system. A grant rule that needs a new fact about other modes needs a new field in `grantsOf`'s question.
- The feature stays large, about 1,900 lines, and `documents.ts` is a seam I sealed inside rather than a feature of its own. A reviewer may say `fits` is `checkValue` with a mode in front.

**Strongest argument against this design.** The narrow `System` is bought with a second, wide shape. `Survey` hands check and scaffold every found mode, readable or not, the interface definitions, the folder rules, `callable`, `fits` and `skill`. That is most of what the five files export today, gathered under one name. Check will want a new fact every few slices, and each one lands in `Survey`, so the wide interface comes back through the side door. A design with two features, a loader that check imports directly and a system that everyone else imports, would at least say so honestly.

## 8. Migration

Each slice is one feature and one concern, leaves `npm run check` green, and deletes what it replaces (ADR 9). Line counts are reported, not targeted.

1. **Tool out.** Move `generate-types.ts` and its test to `scripts/`. Point `npm run generate` at it. Remove its debt entry.
2. **Vocabulary.** Move `Wording` and `PathSegments` into `bay/outcome.ts` with a script the reviewer can rerun (P-24). Add "Base mode" to `CONTEXT.md`.
3. **Safety stands alone.** Replace `permissionsFor` and `policyFor` with `grantsOf(question)`, which returns grants or placed wordings and the base-command notice. `loadPolicedSystem` uses it for now. Delete `check.ts`'s `commandProblems`. Rewrite `policy.test.ts` at `grantsOf`. Removes two debt entries (`policy.ts` and `check.ts` to `spec.ts`).
4. **Move.** Put the feature in `bay/manifests/`: `registry.ts` becomes `manifests.ts`, split into the private files above. Update imports and `features.yaml`. No behaviour change.
5. **Targets.** Add `action`, `target` and `step` to `System`. Move runs. Delete `targets.ts`, `targets.test.ts` and the `servingMode` export. Removes six debt entries.
6. **Policed load.** `loadSystem` calls `grantsOf` and returns active modes with `grants`. Move the kernel, the `actions` command, the tool, build and runs. Delete `loadPolicedSystem`, `PolicedSystem`, `PolicedReport`, `PolicyOf`, `Kernel.policyOf` and `BuildRequest.system`. Flip `may_import`.
7. **Schemas and skills.** Add `fits` and `skill`. Move `walk.ts`, `skill-steps.ts` and `build.ts`. Delete the run-time schema reader and the `parseSkill` export. Removes three debt entries.
8. **References.** Export `resolveValue`, `resolveInput` and `ReferenceScope` from the entry; make the rest private. Rewrite `references.test.ts` at the entry. Removes one debt entry and three exemptions.
9. **Survey.** Add `surveySystem`. Move check and scaffold. Delete check-context's loader, `kitInterfacesFolder`, `new.ts`'s `tierFolders` and `foundMode`, check-skills' callable copy. Removes three debt entries.
10. **Tests at the interface.** Every manifests test imports only the entry. Fixtures load systems. Delete `Skill.headings`. Run the deletion test on each private file.

## Open choices for the owner

Each is one choice. My recommendation is ticked.
References:
- [x] Grammar and evaluation stay in manifests; runs passes a scope (3 exported names).
- [ ] Parsed at load, evaluated in runs (parse once, but a parallel workflow step type: 4 names, about 90 lines move to runs).
Skill front matter:
- [x] Read when asked, as today. No change to what loads.
- [ ] Read at load. A bad `SKILL.md` refuses the whole system, earlier and for every command.
Where check gets its facts:
- [x] One feature, with `surveySystem` beside `loadSystem`.
- [ ] Two features: a loader that check and scaffold import, and the system on top of it.
