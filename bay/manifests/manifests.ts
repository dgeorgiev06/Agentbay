import { basename, dirname, join, relative } from "node:path/posix";
import { isDeepStrictEqual } from "node:util";
import type { Json, ModeGrants } from "../contracts.ts";
import type { Config } from "../generated/config.ts";
import type { Interface, Signature } from "../generated/interface.ts";
import type { Action, Effect, Mode, Step } from "../generated/mode.ts";
import type { SkillFrontMatter } from "../generated/skill.ts";
import type { Workflow, Step as WorkflowStep } from "../generated/workflow.ts";
import { homeFolder, isProjectTheKit, shownPath, shownProblems, type Home, type Layout } from "../layout.ts";
import type { FileSystem } from "../ports.ts";
import { grantsOf, type GrantProblem } from "../policy.ts";
import { resolveInput, resolveValue, workflowReferenceIssues } from "./references.ts";
import {
  checkValue,
  parseSkill,
  problemAt,
  readSkill,
  type Loaded,
  type PathSegments,
  type SkillText,
  type Wording,
} from "./spec.ts";
import { failedWith, succeededWith, unplacedProblem, type Outcome, type Problem } from "../outcome.ts";
import {
  type KitLayout,
  type ModeTier,
  type TierFolder,
  folderRules,
  modeTiers,
  ownModeTiers,
  ownInterfacesFolder,
  kitLayoutOf,
  manifestFileOf,
  findModeFolders,
  modeInInterfacesProblems,
} from "./folders.ts";
import { type ActionSchemas, type SchemaReader, schemaDirections, schemaReader, schemaOf } from "./schemas.ts";
import {
  type ModeRead,
  type ModeSource,
  type UnloadedMode,
  type Collected,
  type LoadedModes,
  type Context,
  type ActionPlace,
  type ModeWorkflow,
  shown,
  actionsOf,
  actionLabel,
  settingsOf,
  activeModesOf,
  loadModes,
  loadInterfaces,
  loadConfig,
  loadWorkflows,
} from "./loaded.ts";
import {
  interfaceName,
  interfaceReference,
  requiredReferences,
  implementersOf,
  unknownInterface,
  candidatesOf,
  requirersOf,
} from "./interfaces.ts";
import { defaultKey, servingMode, servedReferences, boundModeOf } from "./bindings.ts";
import { homesOf, activation } from "./activation.ts";
import { folderNameProblems, indexModes, indexInterfaces } from "./naming.ts";

export type ActiveMode = {
  readonly home: Home;
  readonly folder: string;
  readonly manifest: Mode;
  readonly lineOf: Loaded<Mode>["lineOf"];
  readonly workflows: ReadonlyMap<string, Workflow>;
  readonly settings: Readonly<Record<string, unknown>>;
  readonly actionSchemas: ReadonlyMap<string, ActionSchemas>;
  readonly grants: ModeGrants;
  readonly skill: (name: string) => Promise<Outcome<SkillUse>>;
};

export type SkillUse = {
  readonly name: string;
  readonly file: string;
  readonly frontMatter: SkillFrontMatter;
  readonly tools: readonly string[];
  readonly output: Schema | undefined;
};

export type Schema = {
  readonly file: string;
  readonly json: Json | undefined;
  readonly check: (value: Json) => Outcome<Json>;
};

type LoadedInterface = {
  readonly file: string;
  readonly definition: Interface;
};

export type ActionTarget = {
  readonly mode: ActiveMode;
  readonly name: string;
  readonly action: Action;
  readonly caller: string | undefined;
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

export type System = {
  readonly modes: ReadonlyMap<string, ActiveMode>;
  readonly inactive: ReadonlySet<string>;
  readonly interfaces: ReadonlyMap<string, LoadedInterface>;
  readonly config: Config;
  readonly action: (reference: string, caller?: string) => Outcome<ActionTarget>;
  readonly workflow: (mode: string, path: string) => Outcome<WorkflowTarget>;
  readonly listing: (question: ListingQuestion) => Outcome<ActionsListing>;
};

export type BindingUse = {
  readonly interfaceName: string;
  readonly requirers: readonly string[];
  readonly servedBy: string;
};

export type Inspection = {
  readonly problems: readonly Problem[];
  readonly notices: readonly Problem[];
  readonly folders: readonly InspectedFolder[];
  readonly interfaces: ReadonlyMap<string, Interface>;
  readonly kitLayout: KitLayout;
};

type FolderPlace = {
  readonly home: Home;
  readonly tier: ModeTier;
  readonly folder: string;
  readonly active: boolean;
};

export type InspectedFolder =
  | (FolderPlace & { readonly manifest: undefined })
  | (FolderPlace & {
      readonly manifest: Mode;
      readonly at: (path: PathSegments, wording: Wording) => Problem;
      readonly schemaProblems: (value: unknown, against: SchemaAgainst) => Promise<readonly Problem[]>;
      readonly skill: (folder: string) => Promise<InspectedSkill>;
    });

type SchemaAgainst = {
  readonly schema: string;
  readonly file: string;
  readonly under: string;
};

export type InspectedSkill = {
  readonly file: string;
  readonly text: SkillText | undefined;
};

export type NewPart =
  | { readonly mode: string; readonly tier: ModeTier }
  | { readonly inMode: string; readonly kind: "action" | "skill" | "workflow"; readonly name: string }
  | { readonly interface: string };

type Pass = {
  readonly inspection: Inspection;
  readonly build: (() => Promise<System>) | undefined;
};

export type ModeListed = {
  readonly name: string;
  readonly description: string;
};

export type ActionListed = {
  readonly name: string;
  readonly description: string;
  readonly effects: readonly Effect[];
  readonly input: Json;
};

export type ActionsListing =
  { readonly modes: readonly ModeListed[] } | { readonly mode: string; readonly actions: readonly ActionListed[] };

export type ListingQuestion = {
  readonly mode?: string;
  readonly find?: string;
};

type NewMode = Extract<NewPart, { readonly mode: string }>;

type NewModePart = Extract<NewPart, { readonly inMode: string }>;

type CallStep = {
  readonly call: string;
  readonly index: number;
};

type CallTarget = {
  readonly reference: string;
  readonly actionName: string;
  readonly known: readonly string[];
};

type ImplementedSignature = {
  readonly reference: string;
  readonly signature: Signature;
  readonly folder: string;
};

type FileReference = {
  readonly kind: "schema" | "file";
  readonly owner: Loaded<unknown>;
  readonly path: PathSegments;
  readonly file: string;
  readonly subject: string;
};

type WorkflowStepPlace = {
  readonly step: WorkflowStep;
  readonly path: PathSegments;
};

const namePattern = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;

export function bindingUses(system: System): readonly BindingUse[] {
  const uses = new Map<string, BindingUse>();
  for (const requirer of [...system.modes.keys()].sort()) {
    for (const [name, servedBy] of servedReferences(system, requirer)) {
      const key = `${name} ${servedBy}`;
      const requirers = uses.get(key)?.requirers ?? [];
      uses.set(key, { interfaceName: name, requirers: [...requirers, requirer], servedBy });
    }
  }
  return [...uses.values()].sort((first, second) => first.interfaceName.localeCompare(second.interfaceName));
}

function inactiveNotice(layout: Layout, mode: UnloadedMode): Problem {
  const count = mode.problems.length;
  const first = mode.problems[0]?.message ?? "";
  return {
    file: manifestFileOf(mode),
    path: "",
    message:
      `Mode ${mode.name} of the kit does not load (${String(count)} problem${count === 1 ? "" : "s"}; ` +
      `the first: ${first}) It is not active in this project, so the project does not use it.`,
    fix: `Correct ${shownPath(layout, manifestFileOf(mode))}; bay check run in the kit's own folder lists every problem.`,
  };
}

type Requirement = {
  readonly requirer: string;
  readonly reference: string;
};

function notBoundProblem(context: Context, config: Loaded<Config>, requirement: Requirement): Problem {
  const { requirer, reference } = requirement;
  const name = interfaceName(reference);
  const candidates = candidatesOf(context, reference);
  if (!Object.hasOwn(config.value.bindings, name)) {
    return problemAt(config, ["bindings"], {
      message: `Mode ${requirer} requires ${reference}, but bindings names no mode for ${name}.`,
      fix: `Add ${name}: <mode> under bindings; modes that implement ${reference}: ${candidates}.`,
    });
  }
  const missing = `bindings.${name} has no entry for ${requirer} and no default`;
  return problemAt(config, ["bindings", name], {
    message: `Mode ${requirer} requires ${reference}, but ${missing}.`,
    fix:
      `Add ${requirer}: <mode> or default: <mode> under bindings.${name}; ` +
      `modes that implement ${reference}: ${candidates}.`,
  });
}

function boundModeProblem(context: Context, requirer: string, reference: string): Problem | undefined {
  const config = context.config;
  if (config === undefined) {
    return undefined;
  }
  const bound = boundModeOf(context, requirer, reference);
  if (bound === undefined) {
    return notBoundProblem(context, config, { requirer, reference });
  }
  const candidates = candidatesOf(context, reference);
  const name = interfaceName(reference);
  if (context.unloadedModes.has(bound.mode)) {
    return problemAt(config, bound.path, {
      message: `bindings binds ${bound.label} to ${bound.mode}, which does not load; its own problems are listed.`,
      fix: `Correct the manifest of ${bound.mode}, or bind ${name} to another mode that implements ${reference}.`,
    });
  }
  if (!context.modes.has(bound.mode)) {
    return problemAt(config, bound.path, {
      message: `bindings binds ${bound.label} to ${bound.mode}, which is not a mode.`,
      fix: `Bind ${name} to a mode that implements ${reference}: ${candidates}.`,
    });
  }
  if (!implementersOf(context, reference).includes(bound.mode)) {
    return problemAt(config, bound.path, {
      message:
        `bindings binds ${bound.label} to ${bound.mode}, which does not implement ${reference}, ` +
        `as mode ${requirer} requires.`,
      fix:
        `Bind ${name} to a mode that implements ${reference} (${candidates}), ` +
        `or add ${reference} to the implements of ${bound.mode}.`,
    });
  }
  return undefined;
}

function mapEntryProblem(
  context: Context,
  at: { name: string; key: string },
  config: Loaded<Config>,
): readonly Problem[] {
  const { name, key } = at;
  if (key === defaultKey || context.unloadedModes.has(key)) {
    return [];
  }
  if (!context.modes.has(key)) {
    return [
      problemAt(config, ["bindings", name, key], {
        message: `bindings.${name} has an entry for ${key}, which is not a mode.`,
        fix: `Correct the name, or remove ${key} from bindings.${name}.`,
      }),
    ];
  }
  if (requirersOf(context, name).includes(key)) {
    return [];
  }
  return [
    problemAt(config, ["bindings", name, key], {
      message: `bindings.${name} has an entry for ${key}, but mode ${key} does not require ${name}.`,
      fix: `Remove ${key} from bindings.${name}, or add ${name}@<major> to requires.interfaces of ${key}.`,
    }),
  ];
}

function bindingMapProblems(context: Context): readonly Problem[] {
  const config = context.config;
  if (config === undefined) {
    return [];
  }
  return Object.entries(config.value.bindings).flatMap(([name, binding]) =>
    typeof binding === "string"
      ? []
      : Object.keys(binding).flatMap((key) => mapEntryProblem(context, { name, key }, config)),
  );
}

function requiresProblems(context: Context, mode: ModeSource): readonly Problem[] {
  return requiredReferences(mode.value).flatMap((reference, index) => {
    if (!context.interfaces.has(reference)) {
      const subject = `Mode ${mode.value.name} requires`;
      return [problemAt(mode, ["requires", "interfaces", index], unknownInterface(context, subject, reference))];
    }
    return boundModeProblem(context, mode.value.name, reference) ?? [];
  });
}

function extraEffectProblems(place: ActionPlace, implemented: ImplementedSignature): readonly Problem[] {
  const { reference, signature } = implemented;
  const allowed = signature.effects.length === 0 ? "none" : signature.effects.join(", ");
  return place.action.effects
    .filter((effect) => !signature.effects.includes(effect))
    .map((effect) =>
      problemAt(place.mode, ["actions", place.name, "effects"], {
        message: `${actionLabel(place)} has the effect ${effect}, which ${reference} does not allow for ${place.name}.`,
        fix: `Remove ${effect} from the effects of ${place.name}; ${reference} allows: ${allowed}.`,
      }),
    );
}

async function shapeProblems(
  readSchema: SchemaReader,
  place: ActionPlace,
  implemented: ImplementedSignature,
): Promise<readonly Problem[]> {
  const problems: Problem[] = [];
  for (const direction of schemaDirections) {
    const ownPath = place.action[direction];
    const declaredPath = implemented.signature[direction];
    const own = await readSchema(join(place.mode.folder, ownPath));
    const declared = await readSchema(join(implemented.folder, declaredPath));
    if (own.state !== "valid" || declared.state !== "valid" || isDeepStrictEqual(own.schema, declared.schema)) {
      continue;
    }
    problems.push(
      problemAt(place.mode, ["actions", place.name, direction], {
        message:
          `${actionLabel(place)} has the ${direction} schema ${ownPath}, ` +
          `which differs from ${declaredPath} that ${implemented.reference} declares.`,
        fix: "Make the two schemas the same; an implementation takes and returns exactly what its interface says.",
      }),
    );
  }
  return problems;
}

async function signatureProblems(
  readSchema: SchemaReader,
  mode: ModeSource,
  definition: Loaded<Interface>,
): Promise<readonly Problem[]> {
  const reference = interfaceReference(definition.value);
  const folder = dirname(definition.file);
  const problems: Problem[] = [];
  for (const [name, signature] of Object.entries(definition.value.actions)) {
    const action = mode.value.actions[name];
    if (action === undefined) {
      problems.push(
        problemAt(mode, ["actions"], {
          message: `Mode ${mode.value.name} implements ${reference} but has no action ${name}.`,
          fix: `Add the action ${name} with the input, output and effects that ${reference} declares.`,
        }),
      );
      continue;
    }
    const place = { mode, name, action };
    problems.push(...extraEffectProblems(place, { reference, signature, folder }));
    problems.push(...(await shapeProblems(readSchema, place, { reference, signature, folder })));
  }
  return problems;
}

async function implementsProblems(context: Context, mode: ModeSource): Promise<readonly Problem[]> {
  const problems: Problem[] = [];
  for (const [index, reference] of (mode.value.implements ?? []).entries()) {
    const definition = context.interfaces.get(reference);
    if (definition === undefined) {
      const subject = `Mode ${mode.value.name} implements`;
      problems.push(problemAt(mode, ["implements", index], unknownInterface(context, subject, reference)));
      continue;
    }
    problems.push(...(await signatureProblems(context.readSchema, mode, definition)));
  }
  return problems;
}

function notRequiredProblem(place: ActionPlace, path: PathSegments, step: CallStep): Problem {
  const name = step.call.slice(0, step.call.indexOf("."));
  return problemAt(place.mode, path, {
    message: `${actionLabel(place)} calls ${step.call}, but mode ${place.mode.value.name} does not require ${name}.`,
    fix: `Add ${name}@<major> to requires.interfaces of ${place.mode.value.name}.`,
  });
}

function noSuchActionProblem(place: ActionPlace, path: PathSegments, target: CallTarget): Problem {
  return problemAt(place.mode, path, {
    message: `${actionLabel(place)} calls ${target.actionName} of ${target.reference}, which has no such action.`,
    fix: `Call one of the actions of ${target.reference}: ${target.known.join(", ")}.`,
  });
}

function callProblems(context: Context, place: ActionPlace, step: CallStep): readonly Problem[] {
  const path = ["actions", place.name, "run", step.index, "call"];
  const name = step.call.slice(0, step.call.indexOf("."));
  const actionName = step.call.slice(step.call.indexOf(".") + 1);
  const reference = requiredReferences(place.mode.value).find((required) => interfaceName(required) === name);
  if (reference === undefined) {
    return [notRequiredProblem(place, path, step)];
  }
  const definition = context.interfaces.get(reference);
  if (definition === undefined) {
    return [];
  }
  const signature = definition.value.actions[actionName];
  if (signature === undefined) {
    const known = Object.keys(definition.value.actions);
    return [noSuchActionProblem(place, path, { reference, actionName, known })];
  }
  return signature.effects
    .filter((effect) => !place.action.effects.includes(effect))
    .map((effect) =>
      problemAt(place.mode, path, {
        message:
          `${actionLabel(place)} calls ${step.call}, which may have the effect ${effect}, ` +
          `but ${place.name} does not declare it.`,
        fix: `Add ${effect} to the effects of ${place.name}.`,
      }),
    );
}

function undoProblems(place: ActionPlace): readonly Problem[] {
  const undo = place.action.undo;
  if (undo === undefined) {
    return [];
  }
  const path = ["actions", place.name, "undo"];
  const modeName = place.mode.value.name;
  if (undo === place.name) {
    return [
      problemAt(place.mode, path, {
        message: `${actionLabel(place)} names itself as its undo.`,
        fix: `Name another action of ${modeName} that reverses ${place.name}, or remove undo.`,
      }),
    ];
  }
  const target = place.mode.value.actions[undo];
  if (target === undefined) {
    return [
      problemAt(place.mode, path, {
        message: `${actionLabel(place)} names undo: ${undo}, but mode ${modeName} has no action ${undo}.`,
        fix: `Name an action of ${modeName}, or add the action ${undo}.`,
      }),
    ];
  }
  if (target.undo === place.name && place.name < undo) {
    return [
      problemAt(place.mode, path, {
        message: `Actions ${place.name} and ${undo} of mode ${modeName} each name the other as undo.`,
        fix: `Remove undo from one of them; an undo action is not itself undone.`,
      }),
    ];
  }
  return [];
}

function actionProblems(context: Context, place: ActionPlace): readonly Problem[] {
  const calls = place.action.run.flatMap((step, index) =>
    "call" in step ? callProblems(context, place, { call: step.call, index }) : [],
  );
  return [...calls, ...undoProblems(place)];
}

function checkReferences(place: ActionPlace, checks: readonly string[], index: number): readonly FileReference[] {
  return checks.map((check, checkIndex) => ({
    kind: "file",
    owner: place.mode,
    path: ["actions", place.name, "run", index, "checks", checkIndex],
    file: join(place.mode.folder, check),
    subject: `${actionLabel(place)} checks its skill step with the script ${check}`,
  }));
}

function stepReferences(place: ActionPlace, step: Step, index: number): readonly FileReference[] {
  const folder = place.mode.folder;
  if ("script" in step) {
    return [
      {
        kind: "file",
        owner: place.mode,
        path: ["actions", place.name, "run", index, "script"],
        file: join(folder, step.script),
        subject: `${actionLabel(place)} runs the script ${step.script}`,
      },
    ];
  }
  if ("skill" in step) {
    const skill: FileReference = {
      kind: "file",
      owner: place.mode,
      path: ["actions", place.name, "run", index, "skill"],
      file: join(folder, step.skill, "SKILL.md"),
      subject: `${actionLabel(place)} runs the skill ${step.skill}`,
    };
    return [skill, ...checkReferences(place, step.checks ?? [], index)];
  }
  return [];
}

function actionReferences(place: ActionPlace): readonly FileReference[] {
  const schemas = schemaDirections.map((direction) => ({
    kind: "schema" as const,
    owner: place.mode,
    path: ["actions", place.name, direction],
    file: join(place.mode.folder, place.action[direction]),
    subject: `${actionLabel(place)} names the ${direction} schema ${place.action[direction]}`,
  }));
  const steps = place.action.run.flatMap((step, index) => stepReferences(place, step, index));
  return [...schemas, ...steps];
}

function modeReferences(mode: ModeSource): readonly FileReference[] {
  const workflows = (mode.value.workflows ?? []).map((workflow, index) => ({
    kind: "file" as const,
    owner: mode,
    path: ["workflows", index],
    file: join(mode.folder, workflow),
    subject: `Mode ${mode.value.name} lists the workflow ${workflow}`,
  }));
  const settings = mode.value.settings;
  const settingsReference: readonly FileReference[] =
    settings === undefined
      ? []
      : [
          {
            kind: "schema",
            owner: mode,
            path: ["settings"],
            file: join(mode.folder, settings),
            subject: `Mode ${mode.value.name} names the settings schema ${settings}`,
          },
        ];
  return [...actionsOf(mode).flatMap(actionReferences), ...workflows, ...settingsReference];
}

function interfaceReferences(loaded: Loaded<Interface>): readonly FileReference[] {
  const reference = interfaceReference(loaded.value);
  return Object.entries(loaded.value.actions).flatMap(([name, signature]) =>
    schemaDirections.map((direction) => ({
      kind: "schema" as const,
      owner: loaded,
      path: ["actions", name, direction],
      file: join(dirname(loaded.file), signature[direction]),
      subject: `Action ${name} of interface ${reference} names the ${direction} schema ${signature[direction]}`,
    })),
  );
}

async function fileReferenceProblem(context: Context, reference: FileReference): Promise<Problem | undefined> {
  const file = shown(context, reference.file);
  const missing = {
    message: `${reference.subject}, but ${file} does not exist.`,
    fix: `Create ${file}, or correct the path.`,
  };
  if (reference.kind === "file") {
    const exists = await context.files.exists(reference.file);
    return exists ? undefined : problemAt(reference.owner, reference.path, missing);
  }
  const schemaFile = await context.readSchema(reference.file);
  switch (schemaFile.state) {
    case "missing":
      return problemAt(reference.owner, reference.path, missing);
    case "invalid":
      return problemAt(reference.owner, reference.path, {
        message: `${reference.subject}, but ${file} is not valid JSON: ${schemaFile.reason}.`,
        fix: `Correct the JSON in ${file}.`,
      });
    case "valid":
      return undefined;
  }
}

async function referenceProblems(context: Context): Promise<readonly Problem[]> {
  const references = [
    ...activeModesOf(context).flatMap(modeReferences),
    ...[...context.interfaces.values()].flatMap(interfaceReferences),
  ];
  const problems: Problem[] = [];
  for (const reference of references) {
    const problem = await fileReferenceProblem(context, reference);
    if (problem !== undefined) {
      problems.push(problem);
    }
  }
  return problems;
}

function dependencyGraph(context: Context): ReadonlyMap<string, readonly string[]> {
  const graph = new Map<string, readonly string[]>();
  for (const mode of activeModesOf(context)) {
    const name = mode.value.name;
    const dependencies = requiredReferences(mode.value).flatMap((reference) => {
      const bound = boundModeOf(context, name, reference)?.mode;
      return bound !== undefined && context.modes.has(bound) ? [bound] : [];
    });
    graph.set(name, dependencies);
  }
  return graph;
}

function cyclesOf(graph: ReadonlyMap<string, readonly string[]>): readonly (readonly string[])[] {
  const cycles: (readonly string[])[] = [];
  const finished = new Set<string>();
  const visit = (node: string, path: readonly string[]): void => {
    const start = path.indexOf(node);
    if (start >= 0) {
      cycles.push([...path.slice(start), node]);
      return;
    }
    if (finished.has(node)) {
      return;
    }
    for (const next of graph.get(node) ?? []) {
      visit(next, [...path, node]);
    }
    finished.add(node);
  };
  for (const node of [...graph.keys()].sort()) {
    visit(node, []);
  }
  return cycles;
}

function cycleProblems(context: Context): readonly Problem[] {
  const config = context.config;
  if (config === undefined) {
    return [];
  }
  return cyclesOf(dependencyGraph(context)).map((cycle) =>
    problemAt(config, ["bindings"], {
      message: `Modes depend on each other in a cycle through bindings: ${cycle.join(" -> ")}.`,
      fix: "Change requires or bindings so that no mode depends, directly or through other modes, on itself.",
    }),
  );
}

function workflowStepPlaces(steps: readonly WorkflowStep[], prefix: PathSegments): readonly WorkflowStepPlace[] {
  return steps.flatMap((step, index) => {
    const path = [...prefix, "steps", index];
    const nested = "foreach" in step ? workflowStepPlaces(step.steps, path) : [];
    return [{ step, path }, ...nested];
  });
}

function stepLabel(entry: ModeWorkflow, step: WorkflowStep): string {
  return `Step ${step.id} of workflow ${entry.path} of mode ${entry.mode.value.name}`;
}

function duplicateStepIdProblems(entry: ModeWorkflow): readonly Problem[] {
  const seen = new Set<string>();
  const problems: Problem[] = [];
  for (const place of workflowStepPlaces(entry.loaded.value.steps, [])) {
    if (seen.has(place.step.id)) {
      problems.push(
        problemAt(entry.loaded, [...place.path, "id"], {
          message:
            `Workflow ${entry.path} of mode ${entry.mode.value.name} ` +
            `has more than one step with the id ${place.step.id}.`,
          fix: "Give every step its own id; ids are unique in the whole file, inside foreach steps too.",
        }),
      );
    }
    seen.add(place.step.id);
  }
  return problems;
}

function callableActions(context: Context, mode: ModeSource): readonly string[] {
  const own = Object.keys(mode.value.actions);
  const throughInterfaces = requiredReferences(mode.value).flatMap((reference) => {
    const definition = context.interfaces.get(reference);
    const actions = definition === undefined ? [] : Object.keys(definition.value.actions);
    return actions.map((action) => `${interfaceName(reference)}.${action}`);
  });
  return [...own, ...throughInterfaces];
}

function workflowActionProblem(context: Context, entry: ModeWorkflow, place: WorkflowStepPlace): Problem | undefined {
  const step = place.step;
  if (!("action" in step)) {
    return undefined;
  }
  const callable = callableActions(context, entry.mode);
  if (callable.includes(step.action)) {
    return undefined;
  }
  const path = [...place.path, "action"];
  const modeName = entry.mode.value.name;
  const separator = step.action.indexOf(".");
  const name = step.action.slice(0, separator);
  const required = requiredReferences(entry.mode.value).some((reference) => interfaceName(reference) === name);
  if (separator >= 0 && !required) {
    return problemAt(entry.loaded, path, {
      message: `${stepLabel(entry, step)} names ${step.action}, but mode ${modeName} does not require ${name}.`,
      fix: `Add ${name}@<major> to requires.interfaces of ${modeName}, or name one of: ${callable.join(", ")}.`,
    });
  }
  return problemAt(entry.loaded, path, {
    message:
      `${stepLabel(entry, step)} names the action ${step.action}, which is neither an action of mode ${modeName} ` +
      `nor an action of an interface it requires. Valid names: ${callable.join(", ")}.`,
    fix: "Name one of the valid actions.",
  });
}

function workflowReferenceProblems(entry: ModeWorkflow): readonly Problem[] {
  return workflowReferenceIssues(entry.loaded.value.steps).map((issue) =>
    problemAt(entry.loaded, issue.path, {
      message: `Workflow ${entry.path} of mode ${entry.mode.value.name} has a reference problem: ${issue.message}`,
      ...(issue.fix === undefined ? {} : { fix: issue.fix }),
    }),
  );
}

function workflowProblems(context: Context, workflows: readonly ModeWorkflow[]): readonly Problem[] {
  const active = workflows.filter((entry) => context.active.has(entry.mode.value.name));
  return active.flatMap((entry) => {
    const actionProblems = workflowStepPlaces(entry.loaded.value.steps, []).flatMap(
      (place) => workflowActionProblem(context, entry, place) ?? [],
    );
    return [...duplicateStepIdProblems(entry), ...actionProblems, ...workflowReferenceProblems(entry)];
  });
}

async function modeSettingsProblems(context: Context, mode: ModeSource): Promise<readonly Problem[]> {
  const config = context.config;
  const settingsPath = mode.value.settings;
  if (config === undefined || settingsPath === undefined) {
    return [];
  }
  const schemaFile = await context.readSchema(join(mode.folder, settingsPath));
  if (schemaFile.state !== "valid") {
    return [];
  }
  const given = settingsOf(config.value, mode.value.name);
  const check = checkValue(schemaFile.schema, given, { loaded: config, path: ["settings", mode.value.name] });
  if (check.kind === "checked") {
    return check.problems;
  }
  return [
    problemAt(mode, ["settings"], {
      message:
        `Mode ${mode.value.name} names the settings schema ${settingsPath}, ` +
        `which is not a usable JSON Schema: ${check.reason}.`,
      fix: `Correct ${shown(context, join(mode.folder, settingsPath))}.`,
    }),
  ];
}

function straySettingsProblems(context: Context): readonly Problem[] {
  const config = context.config;
  if (config === undefined) {
    return [];
  }
  return Object.keys(config.value.settings ?? {}).flatMap((modeName) => {
    const mode = context.modes.get(modeName);
    if (context.unloadedModes.has(modeName) || (mode !== undefined && !context.active.has(modeName))) {
      return [];
    }
    if (mode === undefined) {
      return [
        problemAt(config, ["settings", modeName], {
          message: `settings gives settings for ${modeName}, which is not a mode.`,
          fix: `Remove settings.${modeName}, or correct the mode name.`,
        }),
      ];
    }
    if (mode.value.settings === undefined) {
      return [
        problemAt(config, ["settings", modeName], {
          message: `settings gives settings for mode ${modeName}, which declares no settings schema.`,
          fix: `Remove settings.${modeName}, or add settings: <schema file> to the manifest of ${modeName}.`,
        }),
      ];
    }
    return [];
  });
}

async function consistencyProblems(context: Context): Promise<readonly Problem[]> {
  const problems: Problem[] = [];
  for (const mode of activeModesOf(context)) {
    problems.push(...requiresProblems(context, mode));
    problems.push(...(await implementsProblems(context, mode)));
    problems.push(...actionsOf(mode).flatMap((place) => actionProblems(context, place)));
    problems.push(...(await modeSettingsProblems(context, mode)));
  }
  problems.push(...straySettingsProblems(context));
  problems.push(...bindingMapProblems(context));
  problems.push(...(await referenceProblems(context)));
  problems.push(...cycleProblems(context));
  return problems;
}

async function actionSchemasOf(
  readSchema: SchemaReader,
  mode: ModeSource,
): Promise<ReadonlyMap<string, ActionSchemas>> {
  const actionSchemas = new Map<string, ActionSchemas>();
  for (const place of actionsOf(mode)) {
    const inputFile = join(mode.folder, place.action.input);
    const outputFile = join(mode.folder, place.action.output);
    actionSchemas.set(place.name, {
      input: schemaOf({ file: inputFile, schemaFile: await readSchema(inputFile), label: "input" }),
      output: schemaOf({ file: outputFile, schemaFile: await readSchema(outputFile), label: "output" }),
    });
  }
  return actionSchemas;
}

function placedGrantProblem(mode: ModeSource, problem: GrantProblem): Problem {
  return problemAt(mode, problem.at, { message: problem.message, fix: problem.fix });
}

function grantsOfActiveModes(context: Context): Outcome<ReadonlyMap<string, ModeGrants>> {
  const granted = new Map<string, ModeGrants>();
  const problems: Problem[] = [];
  for (const mode of [...context.active].flatMap((name) => context.modes.get(name) ?? [])) {
    const otherModes = [...context.modes.values()]
      .filter((other) => other !== mode)
      .map((other) => ({ name: other.value.name, folder: other.folder }));
    const ruling = grantsOf({
      manifest: mode.value,
      home: mode.home,
      folder: mode.folder,
      layout: context.layout,
      otherModes,
    });
    if (ruling.ok) {
      granted.set(mode.value.name, ruling.value);
    } else {
      problems.push(...ruling.problems.map((problem) => placedGrantProblem(mode, problem)));
    }
  }
  return problems.length > 0 ? failedWith(problems) : succeededWith(granted);
}

function splitReference(reference: string): readonly [string, string] | undefined {
  const separator = reference.indexOf(".");
  if (separator <= 0 || separator === reference.length - 1) {
    return undefined;
  }
  return [reference.slice(0, separator), reference.slice(separator + 1)];
}

function refused(message: string): Outcome<never> {
  return failedWith([unplacedProblem(message)]);
}

function notActiveRefusal(name: string): Outcome<never> {
  return failedWith([
    unplacedProblem(
      `Mode ${name} is not active in this project, so nothing of it runs here.`,
      `Add ${name} to modes: in agentbay.config.yaml, or bind an interface it implements.`,
    ),
  ]);
}

function activeModeNamed(system: System, name: string): Outcome<ActiveMode> {
  if (system.inactive.has(name)) {
    return notActiveRefusal(name);
  }
  const mode = system.modes.get(name);
  return mode === undefined ? refused(`There is no mode ${name}.`) : succeededWith(mode);
}

function ownAction(mode: ActiveMode, name: string): Outcome<ActionTarget> {
  const action = Object.hasOwn(mode.manifest.actions, name) ? mode.manifest.actions[name] : undefined;
  const schemas = mode.actionSchemas.get(name);
  if (action === undefined || schemas === undefined) {
    const known = Object.keys(mode.manifest.actions).join(", ");
    return refused(`Mode ${mode.manifest.name} has no action ${name}; it has: ${known}.`);
  }
  return succeededWith({ mode, name, action, caller: undefined, input: schemas.input, output: schemas.output });
}

function boundAction(system: System, caller: ActiveMode, call: string): Outcome<ActionTarget> {
  const parts = splitReference(call);
  if (parts === undefined) {
    return refused(`${call} does not name an action of an interface; write <interface>.<action>.`);
  }
  const [name, actionName] = parts;
  const callerName = caller.manifest.name;
  const required = requiredReferences(caller.manifest).find((reference) => interfaceName(reference) === name);
  if (required === undefined) {
    return refused(`Mode ${callerName} calls ${call}, but it does not require the interface ${name}.`);
  }
  const served = servingMode(system, callerName, required);
  const mode = served === undefined ? undefined : system.modes.get(served);
  if (mode === undefined) {
    return refused(`Mode ${callerName} calls ${call}, but no mode is bound to ${required} for it.`);
  }
  const target = ownAction(mode, actionName);
  return target.ok ? succeededWith({ ...target.value, caller: callerName }) : target;
}

function actionAnswer(system: System, reference: string, caller: string | undefined): Outcome<ActionTarget> {
  if (caller !== undefined) {
    const callerMode = activeModeNamed(system, caller);
    if (!callerMode.ok) {
      return callerMode;
    }
    return reference.includes(".")
      ? boundAction(system, callerMode.value, reference)
      : ownAction(callerMode.value, reference);
  }
  const parts = splitReference(reference);
  if (parts === undefined) {
    return refused(`${reference} does not name an action; write <mode>.<action>.`);
  }
  const mode = activeModeNamed(system, parts[0]);
  return mode.ok ? ownAction(mode.value, parts[1]) : mode;
}

function workflowAnswer(system: System, modeName: string, path: string): Outcome<WorkflowTarget> {
  if (system.inactive.has(modeName)) {
    return notActiveRefusal(modeName);
  }
  const mode = system.modes.get(modeName);
  const workflow = mode?.workflows.get(path);
  if (mode === undefined || workflow === undefined) {
    return refused(`Mode ${modeName} has no workflow ${path}.`);
  }
  const resolve: WorkflowTarget["resolve"] = (value, scope) => {
    const withSettings = { ...scope, settings: mode.settings };
    return typeof value === "string" ? resolveValue(value, withSettings) : resolveInput(value, withSettings);
  };
  return succeededWith({ mode, path, workflow, resolve });
}

function skillNamesOf(manifest: Mode): readonly string[] {
  const steps = Object.values(manifest.actions).flatMap((action) => action.run);
  return [...new Set(steps.flatMap((step) => ("skill" in step ? [step.skill] : [])))];
}

async function skillAnswer(context: Context, mode: ModeSource, name: string): Promise<Outcome<SkillUse>> {
  if (!skillNamesOf(mode.value).includes(name)) {
    return refused(`Mode ${mode.value.name} has no skill ${name}.`);
  }
  const file = join(mode.folder, name, "SKILL.md");
  const parsed = await parseSkill(context.files, file);
  if (!parsed.ok) {
    return parsed;
  }
  const { frontMatter, tools } = parsed.value;
  const outputPath = frontMatter.metadata?.output;
  const outputFile = outputPath === undefined ? undefined : join(mode.folder, outputPath);
  const output =
    outputFile === undefined
      ? undefined
      : schemaOf({ file: outputFile, schemaFile: await context.readSchema(outputFile), label: "output" });
  return succeededWith({ name, file, frontMatter, tools, output });
}

type SystemData = Pick<System, "modes" | "inactive" | "interfaces" | "config">;

function answering(data: SystemData): System {
  return {
    ...data,
    action(reference, caller) {
      return actionAnswer(this, reference, caller);
    },
    workflow(mode, path) {
      return workflowAnswer(this, mode, path);
    },
    listing(question) {
      return actionsListing(this, question);
    },
  };
}

type SystemParts = {
  readonly config: Config;
  readonly workflows: readonly ModeWorkflow[];
  readonly granted: ReadonlyMap<string, ModeGrants>;
};

async function buildSystem(context: Context, parts: SystemParts): Promise<System> {
  const modes = new Map<string, ActiveMode>();
  const inactive = new Set<string>();
  for (const [name, mode] of context.modes) {
    const grants = parts.granted.get(name);
    if (grants === undefined) {
      inactive.add(name);
      continue;
    }
    const own = parts.workflows
      .filter((entry) => entry.mode.value.name === name)
      .map((entry) => [entry.path, entry.loaded.value] as const);
    modes.set(name, {
      home: mode.home,
      folder: mode.folder,
      manifest: mode.value,
      lineOf: mode.lineOf,
      workflows: new Map(own),
      settings: settingsOf(parts.config, name),
      actionSchemas: await actionSchemasOf(context.readSchema, mode),
      grants,
      skill: (skillName) => skillAnswer(context, mode, skillName),
    });
  }
  const interfaces = new Map<string, LoadedInterface>();
  for (const [reference, loaded] of context.interfaces) {
    interfaces.set(reference, { file: loaded.file, definition: loaded.value });
  }
  return answering({ modes, inactive, interfaces, config: parts.config });
}

function loadProblems(context: Context, modes: LoadedModes): Collected<UnloadedMode> {
  const inactive = modes.unloaded.filter((mode) => !context.active.has(mode.name));
  const active = modes.unloaded.filter((mode) => context.active.has(mode.name));
  return { values: inactive, problems: active.flatMap((mode) => mode.problems) };
}

function inspectedSkill(context: Context, mode: ModeSource): (folder: string) => Promise<InspectedSkill> {
  return async (folder) => {
    const file = join(mode.folder, folder, "SKILL.md");
    return { file, text: await readSkill(context.files, file) };
  };
}

function schemaProblemsOf(
  context: Context,
  mode: ModeSource,
): (value: unknown, against: SchemaAgainst) => Promise<readonly Problem[]> {
  return async (value, against) => {
    const schemaFile = await context.readSchema(join(mode.folder, against.schema));
    if (schemaFile.state !== "valid") {
      return [];
    }
    const loaded = { file: against.file, value, lineOf: () => undefined };
    const check = checkValue(schemaFile.schema, value, { loaded, path: [against.under] });
    return check.kind === "checked" ? check.problems : [];
  };
}

function inspectedFolder(context: Context, read: ModeRead): InspectedFolder {
  const { found, outcome } = read;
  const name = outcome.ok ? outcome.value.value.name : basename(found.folder);
  const place = { home: found.home, tier: found.tier, folder: found.folder, active: context.active.has(name) };
  if (!outcome.ok) {
    return { ...place, manifest: undefined };
  }
  const mode = { ...outcome.value, home: found.home, folder: found.folder };
  return {
    ...place,
    manifest: mode.value,
    at: (path, wording) => problemAt(mode, path, wording),
    schemaProblems: schemaProblemsOf(context, mode),
    skill: inspectedSkill(context, mode),
  };
}

function interfaceDefinitions(context: Context): ReadonlyMap<string, Interface> {
  return new Map([...context.interfaces].map(([reference, loaded]) => [reference, loaded.value]));
}

async function inspect(files: FileSystem, layout: Layout): Promise<Pass> {
  const modes = await loadModes(files, layout);
  const interfaces = await loadInterfaces(files, layout);
  const config = await loadConfig(files, layout);
  const modeIndex = indexModes(modes, layout);
  const interfaceIndex = indexInterfaces(interfaces.values, layout);
  const loaded = {
    files,
    readSchema: schemaReader(files),
    layout,
    modes: modeIndex.index,
    interfaces: interfaceIndex.index,
    config: config.ok ? config.value : undefined,
    unloadedModes: new Set(modes.unloaded.map((mode) => mode.name)),
  };
  const activated = activation({ ...loaded, active: new Set() }, homesOf(modes));
  const context: Context = { ...loaded, active: activated.active };
  const unloaded = loadProblems(context, modes);
  const workflows = await loadWorkflows(context);
  const problems = [
    ...(await modeInInterfacesProblems(files, layout)),
    ...unloaded.problems,
    ...interfaces.problems,
    ...(config.ok ? [] : config.problems),
    ...activated.problems,
    ...folderNameProblems(context),
    ...modeIndex.problems,
    ...interfaceIndex.problems,
    ...(await consistencyProblems(context)),
    ...workflows.problems,
    ...workflowProblems(context, workflows.values),
  ];
  const found = {
    notices: shownProblems(
      layout,
      unloaded.values.map((mode) => inactiveNotice(layout, mode)),
    ),
    folders: modes.read.map((read) => inspectedFolder(context, read)),
    interfaces: interfaceDefinitions(context),
    kitLayout: kitLayoutOf(layout),
  };
  if (problems.length > 0 || !config.ok) {
    return { inspection: { ...found, problems: shownProblems(layout, problems) }, build: undefined };
  }
  const granted = grantsOfActiveModes(context);
  if (!granted.ok) {
    return { inspection: { ...found, problems: shownProblems(layout, granted.problems) }, build: undefined };
  }
  const parts = { config: config.value.value, workflows: workflows.values, granted: granted.value };
  return { inspection: { ...found, problems: [] }, build: () => buildSystem(context, parts) };
}

export async function inspectSystem(files: FileSystem, layout: Layout): Promise<Inspection> {
  return (await inspect(files, layout)).inspection;
}

export async function loadSystem(files: FileSystem, layout: Layout): Promise<Outcome<System>> {
  const { inspection, build } = await inspect(files, layout);
  return build === undefined ? failedWith(inspection.problems) : succeededWith(await build());
}

function partProblem(file: string, message: string, fix: string): Problem {
  return { file, path: "", message, fix };
}

function nameProblems(kind: string, name: string, file: string): readonly Problem[] {
  if (name === "constructor") {
    return [
      partProblem(
        file,
        `The ${kind} name constructor is reserved, because every JavaScript object has it.`,
        "Choose another name.",
      ),
    ];
  }
  if (namePattern.test(name)) {
    return [];
  }
  return [
    partProblem(
      file,
      `The ${kind} name ${JSON.stringify(name)} is not kebab-case.`,
      "Start with a lowercase letter and use only lowercase letters, digits and single dashes, such as daily-digest.",
    ),
  ];
}

function folderInHome(layout: Layout, tier: TierFolder, name: string): string {
  return relative(homeFolder(layout, tier.home), join(tier.folder, name));
}

function tierRefusals(layout: Layout, part: NewMode, folder: string): readonly Problem[] {
  if (part.tier === "modes" || isProjectTheKit(layout)) {
    return [];
  }
  return [
    partProblem(
      folder,
      "Tier base is for the base modes of the kit itself, and this project is not the kit; " +
        "bay new writes only into the project.",
      `Make the mode in this project with --tier modes, or run bay new in the kit's own folder.`,
    ),
  ];
}

async function takenModeProblems(files: FileSystem, layout: Layout, name: string): Promise<readonly Problem[]> {
  const problems: Problem[] = [];
  for (const tier of modeTiers(folderRules(layout))) {
    const folder = join(tier.folder, name);
    if (await files.exists(folder)) {
      const shown = shownPath(layout, folder);
      problems.push(
        partProblem(shown, `${shown} already exists; every mode needs its own name.`, "Choose another name."),
      );
    }
  }
  return problems;
}

async function placeMode(files: FileSystem, layout: Layout, part: NewMode): Promise<Outcome<string>> {
  const rules = folderRules(layout);
  const tier = part.tier === "base" ? rules.base : (rules.projectModes ?? rules.kitModes);
  const folder = folderInHome(layout, tier, part.mode);
  const refusals = [...tierRefusals(layout, part, folder), ...nameProblems("mode", part.mode, folder)];
  if (refusals.length > 0) {
    return failedWith(refusals);
  }
  const taken = await takenModeProblems(files, layout, part.mode);
  return taken.length > 0 ? failedWith(taken) : succeededWith(folder);
}

async function modeToWriteIn(files: FileSystem, layout: Layout, mode: string): Promise<Outcome<string>> {
  const found = (await findModeFolders(files, layout)).find((entry) => basename(entry.folder) === mode);
  if (found === undefined) {
    const where = ownModeTiers(folderRules(layout)).map((tier) => folderInHome(layout, tier, mode));
    return failedWith([
      partProblem(
        "components",
        `There is no mode ${mode}: neither ${where.join(" or ")} has a mode.yaml.`,
        "Name an existing mode, or create it with bay new mode.",
      ),
    ]);
  }
  if (found.home === "kit" && !isProjectTheKit(layout)) {
    const shown = shownPath(layout, found.folder);
    return failedWith([
      partProblem(
        shown,
        `Mode ${mode} lives in the kit (${shown}), and bay new writes only into the project, never into the kit.`,
        "Make a mode of your own with bay new mode, or change the kit's mode in the kit's own folder.",
      ),
    ]);
  }
  return succeededWith(relative(layout.project, found.folder));
}

async function placeModePart(files: FileSystem, layout: Layout, part: NewModePart): Promise<Outcome<string>> {
  const target = await modeToWriteIn(files, layout, part.inMode);
  const refusals = nameProblems(part.kind, part.name, target.ok ? target.value : part.inMode);
  if (!target.ok || refusals.length > 0) {
    return failedWith([...(target.ok ? [] : target.problems), ...refusals]);
  }
  return target;
}

function placeInterface(layout: Layout, name: string): Outcome<string> {
  const file = join(relative(layout.project, ownInterfacesFolder(layout)), `${name}.yaml`);
  const refusals = nameProblems("interface", name, file);
  return refusals.length > 0 ? failedWith(refusals) : succeededWith(file);
}

export async function placeToWrite(files: FileSystem, layout: Layout, part: NewPart): Promise<Outcome<string>> {
  if ("mode" in part) {
    return placeMode(files, layout, part);
  }
  if ("inMode" in part) {
    return placeModePart(files, layout, part);
  }
  return placeInterface(layout, part.interface);
}

function wordsOf(find: string | undefined): readonly string[] {
  return (find ?? "")
    .toLowerCase()
    .split(/\s+/)
    .filter((word) => word !== "");
}

function holdsEveryWord(words: readonly string[], entry: ModeListed | ActionListed): boolean {
  const text = `${entry.name} ${entry.description}`.toLowerCase();
  return words.every((word) => text.includes(word));
}

function activeModesByName(system: System): readonly ActiveMode[] {
  return [...system.modes.keys()].sort().flatMap((name) => system.modes.get(name) ?? []);
}

function listedModes(system: System, words: readonly string[]): ActionsListing {
  const modes = activeModesByName(system).map((mode) => ({
    name: mode.manifest.name,
    description: mode.manifest.description,
  }));
  return { modes: modes.filter((mode) => holdsEveryWord(words, mode)) };
}

function listedActions(mode: ActiveMode, words: readonly string[]): Outcome<ActionsListing> {
  const actions: ActionListed[] = [];
  const problems: Problem[] = [];
  for (const [name, action] of Object.entries(mode.manifest.actions)) {
    const reference = `${mode.manifest.name}.${name}`;
    const input = mode.actionSchemas.get(name)?.input.json;
    if (input === undefined) {
      problems.push(unplacedProblem(`The input schema of ${reference} could not be read.`, "Run bay check."));
      continue;
    }
    actions.push({ name: reference, description: action.description, effects: action.effects, input });
  }
  if (problems.length > 0) {
    return failedWith(problems);
  }
  return succeededWith({ mode: mode.manifest.name, actions: actions.filter((entry) => holdsEveryWord(words, entry)) });
}

function actionsListing(system: System, question: ListingQuestion): Outcome<ActionsListing> {
  const words = wordsOf(question.find);
  if (question.mode === undefined) {
    return succeededWith(listedModes(system, words));
  }
  const mode = system.modes.get(question.mode);
  if (mode === undefined) {
    const active = activeModesByName(system).map((entry) => entry.manifest.name);
    return failedWith([
      unplacedProblem(
        `There is no active mode ${question.mode}. The active modes are ${active.join(", ")}.`,
        "Name one of them, or leave the mode out to list them.",
      ),
    ]);
  }
  return listedActions(mode, words);
}
