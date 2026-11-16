# Manifests as one deep module: design A, the smallest interface

Constraint: the fewest exported names and the fewest things a caller must know. A caller asks the system and
gets an answer. It never builds a path to a `SKILL.md`, reads a schema, places a problem or follows a binding.

## 1. The interface

One entry file, `bay/manifests/manifests.ts`. It exports eight names: three functions and five types.

```ts
export function loadSystem(files: FileSystem, layout: Layout): Promise<Outcome<System>>;

export function checkedModes(
  files: FileSystem,
  layout: Layout,
): Promise<{ readonly modes: readonly ModeFolder[]; readonly notices: readonly Problem[] }>;

export function placeFor(
  files: FileSystem,
  layout: Layout,
  thing: { readonly mode: string; readonly tier: "base" | "modes" } | { readonly in: string } | { readonly interface: string },
): Promise<Outcome<string>>;

export type System = {
  readonly config: Config;
  readonly modes: readonly ActiveMode[];
  readonly bindings: readonly { readonly interfaceName: string; readonly requirers: readonly string[]; readonly servedBy: string }[];
  readonly action: (name: string, caller?: string) => Outcome<ActionTarget>;
  readonly workflow: (mode: string, path: string) => Outcome<{ readonly mode: ActiveMode; readonly workflow: Workflow }>;
  readonly listing: (question: { readonly mode?: string; readonly find?: string }) => Outcome<Listing>;
};

export type ModeFolder = {
  readonly home: Home;
  readonly folder: string;
  readonly manifest:
    | {
        readonly file: string;
        readonly value: Mode;
        readonly problem: (path: readonly (string | number)[], wording: { readonly message: string; readonly fix?: string }) => Problem;
      }
    | undefined;
  readonly calls: (name: string) => boolean;
  readonly skill: (
    path: string,
  ) => Promise<Outcome<{ readonly file: string; readonly frontMatter: SkillFrontMatter; readonly headings: readonly string[] }>>;
  readonly valueProblems: (check: { readonly schema: string; readonly value: unknown; readonly label: string }) => Promise<readonly Problem[]>;
};

export type ActiveMode = ModeFolder & {
  readonly name: string;
  readonly manifest: NonNullable<ModeFolder["manifest"]>;
  readonly settings: Readonly<Record<string, unknown>>;
  readonly grants: ModeGrants;
  readonly resolve: (
    value: unknown,
    scope: { readonly trigger: Json; readonly outputs: ReadonlyMap<string, Json>; readonly item?: Json },
  ) => Outcome<Json>;
};

export type ActionTarget = { readonly mode: ActiveMode; readonly name: string; readonly action: Action };

export type Listing =
  | { readonly modes: readonly { readonly name: string; readonly description: string }[] }
  | {
      readonly mode: string;
      readonly actions: readonly { readonly name: string; readonly description: string; readonly effects: readonly Effect[]; readonly input: Json }[];
    };
```

Exported names: **8**. Today: 30 used by other features and 8 more by tests, from four files. Every other type
above is vocabulary: `Config`, `Mode`, `Action`, `Workflow`, `SkillFrontMatter`, `ModeGrants`, `Json`, `Effect`,
`Home`, `Layout`, `FileSystem`, `Outcome`, `Problem`.

What a caller must know, in full:
- `loadSystem` returns a system only when every manifest, binding and grant is sound. There is no unpoliced
  system and no report to pick apart. Problems are sentences with a fix, shown relative to the project.
- `system.modes` holds the active modes only, sorted by name. No answer reaches an inactive mode.
- `system.action("todo.add")` finds an action by `mode.action`. With a caller, `system.action("add", "todo")`
  finds the caller's own action and `system.action("items-store.put", "todo")` follows the caller's binding.
  Each refusal says why: no such mode, mode not active, no such action, interface not required, not bound.
- `mode.valueProblems` checks a value against a schema file of that mode, named as a manifest or skill names
  it. A missing, unreadable or unusable schema is a problem, not an exception.
- `mode.resolve` resolves `$trigger`, `$item`, `$settings.<key>` and `$steps.<id>.output...`. A string is one
  reference. A mapping resolves each top-level value; each problem is labelled `input.<key>`. Anything else passes
  through. The mode supplies its own settings.
- `mode.skill(path)` reads the `SKILL.md` of a skill step, given the path the step names.
- `mode.calls(name)` says whether the mode may call an action by that name: its own, or one of an interface it
  requires. An interface that is not found leaves all its names open.
- `manifest.problem(path, wording)` places a problem at the line of that path in `mode.yaml`.

## 2. Usage by each caller

Kernel wiring (`bay/kernel.ts`). `Kernel.policyOf` and `PolicyOf` go: grants are on the mode.

```ts
const loaded = await loadSystem(ports.files, layout);
if (!loaded.ok) {
  return loaded;
}
const system = loaded.value;
const secrets = await SecretStore.open({ ...storeOptions, declaredBy: system.modes.map((mode) => mode.grants) });
const runs = await openRuns({ project: layout.project, system, scrubber: secrets, ...ports });
```

Safety. Safety no longer imports manifests. Manifests calls safety's one grant rule while it loads, privately:

```ts
const grants = grantsOf({ name, home, folder, manifest: manifest.value, otherFolders, place: manifest.problem }, layout);
```

Check (`bay/check.ts`, `check-context.ts`, `check-skills.ts`, `check-layout.ts`):

```ts
const loaded = await loadSystem(ports.files, layout);
const { modes, notices } = await checkedModes(ports.files, layout);
const registryFindings = [...(loaded.ok ? [] : errors(loaded.problems)), ...warnings(notices)];
mode.manifest.problem(["resources", "commands", index], { message, fix });
const strayTools = listedTools.filter((tool) => !place.mode.calls(tool));
const exampleProblems = await mode.valueProblems({ schema: action.input, value: example.input, label: "input" });
```

Scaffold (`bay/new.ts`). It asks where to write and keeps only its templates and name rules.

```ts
const newModeFolder = await placeFor(workspace.files, workspace.layout, { mode: name, tier });
const ownModeFolder = await placeFor(workspace.files, workspace.layout, { in: modeName });
const interfacesFolder = await placeFor(workspace.files, workspace.layout, { interface: name });
```

Harness build (`bay/build.ts`). `BuildRequest.system` goes: the Claude Code adapter does not read it.

```ts
const skill = await mode.skill(step.skill);
const agent = { skillFile: skill.value.file, description: skill.value.frontMatter.description, grants: mode.grants };
```

Runs: starting an action, a call step, a workflow and an undo; resolving a reference; validating a value.

```ts
const target = system.action("todo.add");
const called = system.action(step.call, frame.mode.name);
const workflow = system.workflow("feed-briefing", "workflows/daily.yaml");
const undo = system.action(target.action.undo, target.mode.name);
const input = scope.mode.resolve(at.step.input ?? {}, { trigger, outputs, item });
const inputProblems = await target.mode.valueProblems({ schema: target.action.input, value: input, label: "input" });
const outputProblems = await mode.valueProblems({ schema: skillOutputSchema, value: submission.output, label: "output" });
```

The `actions` command and the tool (`bay/commands/actions.ts`, `bay/tools.ts`) ask live (ADR 12):

```ts
const loaded = await loadSystem(files, layout);
const listing = loaded.ok ? loaded.value.listing({ mode, find }) : loaded;
```

`bay config` reads `kernel.system.bindings`; `bay build` and `bay approve` read `kernel.system.config`.
## 3. What the implementation hides

Hidden: mode tiers and interface folders, YAML with lines, schema validation and its wording, the active set,
bindings, cycles, every consistency rule, the reference grammar, targets, schemas read and compiled once, the
`SKILL.md` file name, and when the grant rule runs. The folder `bay/manifests/`. All counts are estimates.

| File | Today | After | What happens |
|---|---|---|---|
| `manifests.ts` (entry) | 1,347 as `registry.ts` | 260 | Types, the three functions, the system's answers, the listing. |
| `documents.ts` | 423 as `spec.ts` | 380 | YAML, schemas, wording, `SKILL.md`, value checks. `Loaded`, `PathSegments`, `Wording`, `problemAt` become one private placed document. |
| `folders.ts` | in registry and `new.ts` | 160 | Mode and interface folders; where a new thing goes. |
| `bindings.ts` | in registry | 360 | Activation, bindings, binding problems, cycles, the callable rule, action targets. |
| `consistency.ts` | in registry | 460 | Implements, call steps, undo, file references, settings, workflows. |
| `references.ts` | 229 | 190 | Static check and resolution share one parser; `resolveInput` and `resolveValue` merge. |
| `targets.ts` | 68 | 0 | Deleted; it becomes `system.action` in `bindings.ts`. |
| `generate-types.ts` | 150 | 0 here | Moves to the command-line feature as a process entry point. It is a build tool. |
| **Total** | **2,217** | **1,810** | |

Outside, estimates: `policy.ts` 339 to 250, `new.ts` 365 to 275, `check-context.ts` 129 to 70, `build.ts` 143
to 120; `runs/walk.ts` loses about 30 and `check-skills.ts` about 20. Now in one place (ADR 11): the callable
rule (registry, `check-skills.ts`), the `SKILL.md` path (four files), reading a schema file (three files), the
tier folders (registry, `new.ts`), the kit interfaces folder (registry, `check-context.ts`; `check-layout.ts`
keeps one copy, see 7).

## 4. Dependency strategy

- Files: `FileSystem` is the one port and the only seam. Real adapter `nodeFileSystem`; test adapter
  `fakeFileSystem` in `tests/fakes.ts`. Both exist today. Layout is data. No clock, process or network.
- Safety: the real thing, not a port (one rule, one adapter). Manifests calls `grantsOf`. The edge flips in
  `framework/features.yaml`: manifests may import safety; safety imports vocabulary only and keeps
  `secretNamePattern` for secrets and the `secret` command.
- YAML and schema validation: libraries (`yaml`, `ajv`) inside `documents.ts`.

One deep module. Its private files are not seams: nothing outside can swap them.

## 5. Testing through the interface

A test writes YAML and JSON into `fakeFileSystem` with `tests/system-fixture.ts`, calls `loadSystem`,
`checkedModes` or `placeFor`, and asserts literal problems or answers. Schema wording (`spec.test.ts`): a broken
`mode.yaml`, then the exact problem and line. Bindings (`registry*.test.ts`, `bindings-per-requirer.test.ts`):
`system.bindings`, and the mode `system.action("items-store.put", "notes")` reaches. Targets: each refusal of
`system.action`. References: `mode.resolve` with literal scopes; static issues as load problems. Values and
skills: `mode.valueProblems` and `mode.skill`. Grants: `mode.grants` and grant problems; safety's own tests call
`grantsOf` with data. Listing: `system.listing`. Placement: each refusal and folder of `placeFor`.

Names only tests use today: `servingMode`, `isReferenceText`, `parseReference`, `resolveReference`,
`workflowReferenceIssues`, `loadSpec`, `Loaded`, and the generator's functions. None stays exported. The
first seven are asserted through the answers above. The generator's tests move to `tests/inside/command-line/`.
Of ADR 9's six exempted names, five go (`permissionsFor`, `policyFor` and the three reference functions).
`tests/inside/manifests/` is not needed.

`tests/broker-fixture.ts` and `tests/runs-fixture.ts` load a system from fake files instead of a literal.

## 6. The 16 debt entries

All 16 go. None remains.

- To `spec.ts` (8: build, check, check-context, check-layout, check-skills, policy, runs skill-steps and walk):
  `parseSkill` becomes `mode.skill`, `checkValue` `mode.valueProblems`, `problemAt` `manifest.problem`,
  `loadSpec` `checkedModes`; `Wording` is inline. `policy.ts` no longer imports manifests at all.
- To `targets.ts` (6: runs action-steps, engine, undo, waiting, walk, workflow-steps): the file is deleted;
  `ActionTarget` comes from the entry file. To `references.ts` (1: runs workflow-steps): `mode.resolve`.
- From `generate-types.ts` to `node-ports.ts` (1): it moves to command-line, which may import platform.

The four test entries into `spec.ts`, `references.ts`, `targets.ts` and `generate-types.ts` go too.

## 7. Trade-offs

What it makes harder: a system is no longer plain data, so fixtures load one from fake files. Safety's rule
runs inside manifests' loader; a reader looking for where grants are refused follows one call. `placeFor` puts
three questions in one union, and manifests owns refusals about writing, such as "a project never writes into
the kit". `mode.resolve` treats a mapping as step input. Check loads the manifests twice, once for problems
and once for folders. `check-layout.ts` still names the kit interfaces folder; a ninth export would remove it.

The strongest argument against: the name count understates what a caller must know. `ActiveMode.manifest` and
`ModeFolder.manifest` hand every caller the whole generated `Mode` type. Build walks `actions.*.run` for skill
steps; runs reads `action.input`, `action.output`, `action.undo` and budgets; check reads `resources`. Callers
still pick apart a data structure, and a change to `mode.schema.json` still reaches them. The design answers the
questions that need rules (bindings, activation, grants, references, schemas, files) and leaves plain fields as
data. Answering those too would add one question per field and widen the interface.

## 8. Migration

Each slice is one builder, leaves `npm run check` green, and deletes what it replaces in the same slice.

1. M1, command-line: `bay/generate-types.ts` becomes a command-line entry; its tests go to
   `tests/inside/command-line/`. One debt entry goes.
2. M2, manifests: move `registry.ts`, `spec.ts`, `references.ts`, `targets.ts` into `bay/manifests/`, with
   `manifests.ts` as the entry. Only imports change.
3. M3, safety: `grantsOf` takes plain mode data and a place function, and `policy.ts` stops importing
   manifests. `loadSystem` replaces `loadSystemReport` and `loadPolicedSystem` and applies the rule; every caller
   moves; the feature map edge flips; `inactiveModeWording` moves into manifests. One debt entry goes.
4. M4, manifests: `system.action` and `system.workflow`, with every inactive refusal in one place; `targets.ts`
   is deleted and runs moves. Six debt entries go.
5. M5, manifests: `ActiveMode` with `grants`, `skill`, `valueProblems` and `resolve`. Runs drops `policyOf`;
   build drops it; `PolicyOf` and `BuildRequest.system` are deleted; `walk.ts` stops reading schemas. Four debt
   entries go.
6. M6, manifests: `checkedModes` and `manifest.problem`; `check-context.ts` loses its loader; `check-skills.ts`
   uses `calls`. Four debt entries go.
7. M7, manifests: `placeFor`; `new.ts` loses its tier and folder rules.
8. M8, manifests: `system.listing` and `system.bindings` replace `actionsListing` and `bindingUses`; every test
   asserts through the entry file; test-only names stop being exported.
9. M9, manifests: split the old registry into the files of section 3; run the deletion test on each.
