import { basename, join } from "node:path/posix";
import { isDeepStrictEqual } from "node:util";
import type { Config } from "./generated/config.ts";
import type { Interface, Signature } from "./generated/interface.ts";
import type { Action, Mode, Step } from "./generated/mode.ts";
import type { Workflow, Step as WorkflowStep } from "./generated/workflow.ts";
import type { FileSystem } from "./ports.ts";
import { workflowReferenceIssues } from "./references.ts";
import {
  checkValue,
  loadSpec,
  problemAt,
  type Loaded,
  type Outcome,
  type PathSegments,
  type Problem,
  type Wording,
} from "./spec.ts";

export type LoadedMode = {
  readonly folder: string;
  readonly manifest: Mode;
  readonly workflows: ReadonlyMap<string, Workflow>;
  readonly settings: Readonly<Record<string, unknown>>;
};

export type LoadedInterface = {
  readonly file: string;
  readonly definition: Interface;
};

export type System = {
  readonly modes: ReadonlyMap<string, LoadedMode>;
  readonly interfaces: ReadonlyMap<string, LoadedInterface>;
  readonly bindings: ReadonlyMap<string, string>;
  readonly config: Config;
};

export type SystemLayout = {
  readonly root: string;
  readonly configFile: string;
};

type ModeSource = Loaded<Mode> & { readonly folder: string };

type Collected<T> = {
  readonly values: readonly T[];
  readonly problems: readonly Problem[];
};

type LoadedModes = Collected<ModeSource> & {
  readonly unloaded: ReadonlySet<string>;
};

type Indexed<T> = {
  readonly index: ReadonlyMap<string, T>;
  readonly problems: readonly Problem[];
};

type Context = {
  readonly files: FileSystem;
  readonly modes: ReadonlyMap<string, ModeSource>;
  readonly interfaces: ReadonlyMap<string, Loaded<Interface>>;
  readonly config: Loaded<Config> | undefined;
  readonly unloadedModes: ReadonlySet<string>;
};

type ActionPlace = {
  readonly mode: ModeSource;
  readonly name: string;
  readonly action: Action;
};

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
};

type FileReference = {
  readonly kind: "schema" | "file";
  readonly owner: Loaded<unknown>;
  readonly path: PathSegments;
  readonly file: string;
  readonly subject: string;
};

type SchemaFile =
  | { readonly state: "missing" }
  | { readonly state: "invalid"; readonly reason: string }
  | { readonly state: "valid"; readonly schema: unknown };

type ModeWorkflow = {
  readonly mode: ModeSource;
  readonly path: string;
  readonly loaded: Loaded<Workflow>;
};

type WorkflowStepPlace = {
  readonly step: WorkflowStep;
  readonly path: PathSegments;
};

const modeTiers = ["components/base", "components/modes"] as const;

const interfacesFolder = "components/base/interfaces";

const schemaDirections = ["input", "output"] as const;

function rootedFileSystem(files: FileSystem, root: string): FileSystem {
  return {
    readText: (path) => files.readText(join(root, path)),
    list: (directory) => files.list(join(root, directory)),
    exists: (path) => files.exists(join(root, path)),
    writeAtomic: (path, text) => files.writeAtomic(join(root, path), text),
  };
}

function interfaceName(reference: string): string {
  return reference.slice(0, reference.indexOf("@"));
}

function interfaceReference(definition: Interface): string {
  return `${definition.name}@${String(definition.version)}`;
}

function requiredReferences(mode: Mode): readonly string[] {
  return mode.requires?.interfaces ?? [];
}

function actionsOf(mode: ModeSource): readonly ActionPlace[] {
  return Object.entries(mode.value.actions).map(([name, action]) => ({ mode, name, action }));
}

function actionLabel(place: ActionPlace): string {
  return `Action ${place.name} of mode ${place.mode.value.name}`;
}

function implementersOf(context: Context, reference: string): readonly string[] {
  return [...context.modes.values()]
    .filter((mode) => mode.value.implements?.includes(reference) === true)
    .map((mode) => mode.value.name);
}

function settingsOf(config: Config, modeName: string): Readonly<Record<string, unknown>> {
  return config.settings?.[modeName] ?? {};
}

function boundModeOf(context: Context, reference: string): string | undefined {
  const boundMode = context.config?.value.bindings[interfaceName(reference)];
  return boundMode !== undefined && context.modes.has(boundMode) ? boundMode : undefined;
}

async function loadEach<T>(
  paths: readonly string[],
  load: (path: string) => Promise<Outcome<T>>,
): Promise<Collected<T>> {
  const values: T[] = [];
  const problems: Problem[] = [];
  for (const path of paths) {
    const outcome = await load(path);
    if (outcome.ok) {
      values.push(outcome.value);
    } else {
      problems.push(...outcome.problems);
    }
  }
  return { values, problems };
}

async function modeFolders(files: FileSystem): Promise<readonly string[]> {
  const folders: string[] = [];
  for (const tier of modeTiers) {
    for (const name of await files.list(tier)) {
      const folder = join(tier, name);
      if (folder !== interfacesFolder && (await files.exists(join(folder, "mode.yaml")))) {
        folders.push(folder);
      }
    }
  }
  return folders;
}

async function interfaceFiles(files: FileSystem): Promise<readonly string[]> {
  const names = await files.list(interfacesFolder);
  return names
    .filter((name) => name.endsWith(".yaml") && name !== "mode.yaml")
    .map((name) => join(interfacesFolder, name));
}

async function modeInInterfacesProblems(files: FileSystem): Promise<readonly Problem[]> {
  const file = join(interfacesFolder, "mode.yaml");
  if (!(await files.exists(file))) {
    return [];
  }
  const problem = {
    file,
    path: "",
    message: `${interfacesFolder} holds interface files only, but it has a mode.yaml.`,
    fix: "Move the mode to a folder of its own, such as components/base/<mode>/mode.yaml.",
  };
  return [problem];
}

async function loadModes(files: FileSystem): Promise<LoadedModes> {
  const folders = await modeFolders(files);
  const collected = await loadEach(folders, async (folder) => {
    const outcome = await loadSpec(files, join(folder, "mode.yaml"), "mode");
    return outcome.ok ? { ok: true, value: { ...outcome.value, folder } } : outcome;
  });
  const loadedFolders = new Set(collected.values.map((mode) => mode.folder));
  const unloaded = folders.filter((folder) => !loadedFolders.has(folder)).map((folder) => basename(folder));
  return { ...collected, unloaded: new Set(unloaded) };
}

async function loadInterfaces(files: FileSystem): Promise<Collected<Loaded<Interface>>> {
  return loadEach(await interfaceFiles(files), (file) => loadSpec(files, file, "interface"));
}

async function loadConfig(files: FileSystem, configFile: string): Promise<Outcome<Loaded<Config>>> {
  if (await files.exists(configFile)) {
    return loadSpec(files, configFile, "config");
  }
  const problem = {
    file: configFile,
    path: "",
    message: `The project config ${configFile} does not exist.`,
    fix: "Create it with bindings: (interface name: mode name) and adapter:.",
  };
  return { ok: false, problems: [problem] };
}

async function loadWorkflows(context: Context): Promise<Collected<ModeWorkflow>> {
  const values: ModeWorkflow[] = [];
  const problems: Problem[] = [];
  for (const mode of context.modes.values()) {
    for (const path of mode.value.workflows ?? []) {
      const file = join(mode.folder, path);
      if (!(await context.files.exists(file))) {
        continue;
      }
      const outcome = await loadSpec(context.files, file, "workflow");
      if (outcome.ok) {
        values.push({ mode, path, loaded: outcome.value });
      } else {
        problems.push(...outcome.problems);
      }
    }
  }
  return { values, problems };
}

function folderNameProblems(modes: readonly ModeSource[]): readonly Problem[] {
  return modes.flatMap((mode) => {
    const folderName = basename(mode.folder);
    if (folderName === mode.value.name) {
      return [];
    }
    return [
      problemAt(mode, ["name"], {
        message: `The mode is named ${mode.value.name}, but its folder is ${mode.folder}.`,
        fix: `Rename the folder to ${mode.value.name}, or set name: ${folderName}.`,
      }),
    ];
  });
}

function indexModes(modes: readonly ModeSource[]): Indexed<ModeSource> {
  const index = new Map<string, ModeSource>();
  const problems: Problem[] = [];
  for (const mode of modes) {
    const first = index.get(mode.value.name);
    if (first === undefined) {
      index.set(mode.value.name, mode);
      continue;
    }
    problems.push(
      problemAt(mode, ["name"], {
        message: `Two modes are named ${mode.value.name}: ${first.folder} and ${mode.folder}.`,
        fix: "Rename one of them; every mode needs its own name.",
      }),
    );
  }
  return { index, problems };
}

function indexInterfaces(interfaces: readonly Loaded<Interface>[]): Indexed<Loaded<Interface>> {
  const index = new Map<string, Loaded<Interface>>();
  const problems: Problem[] = [];
  for (const loaded of interfaces) {
    const reference = interfaceReference(loaded.value);
    const first = index.get(reference);
    if (first === undefined) {
      index.set(reference, loaded);
      continue;
    }
    problems.push(
      problemAt(loaded, ["name"], {
        message: `Two interface files define ${reference}: ${first.file} and ${loaded.file}.`,
        fix: "Remove one of them, or give one a different name or version.",
      }),
    );
  }
  return { index, problems };
}

function unknownInterface(context: Context, subject: string, reference: string): Wording {
  const otherVersions = [...context.interfaces.keys()].filter((key) => interfaceName(key) === interfaceName(reference));
  const found = otherVersions.length === 0 ? "" : ` (found: ${otherVersions.join(", ")})`;
  return {
    message: `${subject} ${reference}, but no interface file in ${interfacesFolder} defines it${found}.`,
    fix: `Correct the name or major version, or add the interface to ${interfacesFolder}.`,
  };
}

function bindingProblem(context: Context, mode: ModeSource, reference: string): Problem | undefined {
  if (context.config === undefined) {
    return undefined;
  }
  const name = interfaceName(reference);
  const boundMode = context.config.value.bindings[name];
  const implementers = implementersOf(context, reference);
  const candidates = implementers.length === 0 ? "none yet" : implementers.join(", ");
  if (boundMode === undefined) {
    return problemAt(context.config, ["bindings"], {
      message: `Mode ${mode.value.name} requires ${reference}, but bindings names no mode for ${name}.`,
      fix: `Add ${name}: <mode> under bindings; modes that implement ${reference}: ${candidates}.`,
    });
  }
  if (context.unloadedModes.has(boundMode)) {
    return undefined;
  }
  if (!context.modes.has(boundMode)) {
    return problemAt(context.config, ["bindings", name], {
      message: `bindings binds ${name} to ${boundMode}, which is not a mode.`,
      fix: `Bind ${name} to a mode that implements ${reference}: ${candidates}.`,
    });
  }
  if (!implementers.includes(boundMode)) {
    return problemAt(context.config, ["bindings", name], {
      message:
        `bindings binds ${name} to ${boundMode}, which does not implement ${reference}, ` +
        `as mode ${mode.value.name} requires.`,
      fix:
        `Bind ${name} to a mode that implements ${reference} (${candidates}), ` +
        `or add ${reference} to the implements of ${boundMode}.`,
    });
  }
  return undefined;
}

function requiresProblems(context: Context, mode: ModeSource): readonly Problem[] {
  return requiredReferences(mode.value).flatMap((reference, index) => {
    if (!context.interfaces.has(reference)) {
      const subject = `Mode ${mode.value.name} requires`;
      return [problemAt(mode, ["requires", "interfaces", index], unknownInterface(context, subject, reference))];
    }
    return bindingProblem(context, mode, reference) ?? [];
  });
}

async function readSchemaFile(files: FileSystem, file: string): Promise<SchemaFile> {
  const text = await files.readText(file);
  if (text === undefined) {
    return { state: "missing" };
  }
  try {
    const schema: unknown = JSON.parse(text);
    return { state: "valid", schema };
  } catch (error) {
    return { state: "invalid", reason: error instanceof Error ? error.message : String(error) };
  }
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
  files: FileSystem,
  place: ActionPlace,
  implemented: ImplementedSignature,
): Promise<readonly Problem[]> {
  const problems: Problem[] = [];
  for (const direction of schemaDirections) {
    const ownPath = place.action[direction];
    const declaredPath = implemented.signature[direction];
    const own = await readSchemaFile(files, join(place.mode.folder, ownPath));
    const declared = await readSchemaFile(files, join(interfacesFolder, declaredPath));
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
  files: FileSystem,
  mode: ModeSource,
  definition: Interface,
): Promise<readonly Problem[]> {
  const reference = interfaceReference(definition);
  const problems: Problem[] = [];
  for (const [name, signature] of Object.entries(definition.actions)) {
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
    problems.push(...extraEffectProblems(place, { reference, signature }));
    problems.push(...(await shapeProblems(files, place, { reference, signature })));
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
    problems.push(...(await signatureProblems(context.files, mode, definition.value)));
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
      file: join(interfacesFolder, signature[direction]),
      subject: `Action ${name} of interface ${reference} names the ${direction} schema ${signature[direction]}`,
    })),
  );
}

async function fileReferenceProblem(files: FileSystem, reference: FileReference): Promise<Problem | undefined> {
  const missing = {
    message: `${reference.subject}, but ${reference.file} does not exist.`,
    fix: `Create ${reference.file}, or correct the path.`,
  };
  if (reference.kind === "file") {
    return (await files.exists(reference.file)) ? undefined : problemAt(reference.owner, reference.path, missing);
  }
  const schemaFile = await readSchemaFile(files, reference.file);
  switch (schemaFile.state) {
    case "missing":
      return problemAt(reference.owner, reference.path, missing);
    case "invalid":
      return problemAt(reference.owner, reference.path, {
        message: `${reference.subject}, but ${reference.file} is not valid JSON: ${schemaFile.reason}.`,
        fix: `Correct the JSON in ${reference.file}.`,
      });
    case "valid":
      return undefined;
  }
}

async function referenceProblems(context: Context): Promise<readonly Problem[]> {
  const references = [
    ...[...context.modes.values()].flatMap(modeReferences),
    ...[...context.interfaces.values()].flatMap(interfaceReferences),
  ];
  const problems: Problem[] = [];
  for (const reference of references) {
    const problem = await fileReferenceProblem(context.files, reference);
    if (problem !== undefined) {
      problems.push(problem);
    }
  }
  return problems;
}

function dependencyGraph(context: Context): ReadonlyMap<string, readonly string[]> {
  const graph = new Map<string, readonly string[]>();
  for (const mode of context.modes.values()) {
    const dependencies = requiredReferences(mode.value).flatMap((reference) => boundModeOf(context, reference) ?? []);
    graph.set(mode.value.name, dependencies);
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
  return workflows.flatMap((entry) => {
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
  const schemaFile = await readSchemaFile(context.files, join(mode.folder, settingsPath));
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
      fix: `Correct ${join(mode.folder, settingsPath)}.`,
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
    if (context.unloadedModes.has(modeName)) {
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
  for (const mode of context.modes.values()) {
    problems.push(...requiresProblems(context, mode));
    problems.push(...(await implementsProblems(context, mode)));
    problems.push(...actionsOf(mode).flatMap((place) => actionProblems(context, place)));
    problems.push(...(await modeSettingsProblems(context, mode)));
  }
  problems.push(...straySettingsProblems(context));
  problems.push(...(await referenceProblems(context)));
  problems.push(...cycleProblems(context));
  return problems;
}

function buildSystem(context: Context, config: Config, workflows: readonly ModeWorkflow[]): System {
  const modes = new Map<string, LoadedMode>();
  const bindings = new Map<string, string>();
  for (const [name, mode] of context.modes) {
    const own = workflows
      .filter((entry) => entry.mode.value.name === name)
      .map((entry) => [entry.path, entry.loaded.value] as const);
    modes.set(name, {
      folder: mode.folder,
      manifest: mode.value,
      workflows: new Map(own),
      settings: settingsOf(config, name),
    });
    for (const reference of requiredReferences(mode.value)) {
      const boundMode = boundModeOf(context, reference);
      if (boundMode !== undefined) {
        bindings.set(reference, boundMode);
      }
    }
  }
  const interfaces = new Map<string, LoadedInterface>();
  for (const [reference, loaded] of context.interfaces) {
    interfaces.set(reference, { file: loaded.file, definition: loaded.value });
  }
  return { modes, interfaces, bindings, config };
}

export async function loadSystem(files: FileSystem, layout: SystemLayout): Promise<Outcome<System>> {
  const rooted = rootedFileSystem(files, layout.root);
  const modes = await loadModes(rooted);
  const interfaces = await loadInterfaces(rooted);
  const config = await loadConfig(rooted, layout.configFile);
  const modeIndex = indexModes(modes.values);
  const interfaceIndex = indexInterfaces(interfaces.values);
  const context: Context = {
    files: rooted,
    modes: modeIndex.index,
    interfaces: interfaceIndex.index,
    config: config.ok ? config.value : undefined,
    unloadedModes: modes.unloaded,
  };
  const workflows = await loadWorkflows(context);
  const problems = [
    ...(await modeInInterfacesProblems(rooted)),
    ...modes.problems,
    ...interfaces.problems,
    ...(config.ok ? [] : config.problems),
    ...folderNameProblems(modes.values),
    ...modeIndex.problems,
    ...interfaceIndex.problems,
    ...(await consistencyProblems(context)),
    ...workflows.problems,
    ...workflowProblems(context, workflows.values),
  ];
  if (problems.length > 0 || !config.ok) {
    return { ok: false, problems };
  }
  return { ok: true, value: buildSystem(context, config.value.value, workflows.values) };
}
