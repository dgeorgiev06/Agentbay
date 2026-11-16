import { basename, dirname, join } from "node:path/posix";
import { isDeepStrictEqual } from "node:util";
import type { Json } from "./contracts.ts";
import type { Config } from "./generated/config.ts";
import type { Interface, Signature } from "./generated/interface.ts";
import type { Action, Effect, Mode, Step } from "./generated/mode.ts";
import type { Workflow, Step as WorkflowStep } from "./generated/workflow.ts";
import { isProjectTheKit, pathIn, shownPath, shownProblems, type Home, type Layout } from "./layout.ts";
import { toJson } from "./json.ts";
import type { FileSystem } from "./ports.ts";
import { workflowReferenceIssues } from "./references.ts";
import { checkValue, loadSpec, problemAt, type Loaded, type PathSegments, type Wording } from "./spec.ts";
import { failedWith, succeededWith, unplacedProblem, type Outcome, type Problem } from "./outcome.ts";

export type LoadedMode = {
  readonly home: Home;
  readonly folder: string;
  readonly manifest: Mode;
  readonly lineOf: Loaded<Mode>["lineOf"];
  readonly workflows: ReadonlyMap<string, Workflow>;
  readonly settings: Readonly<Record<string, unknown>>;
  readonly inputSchemas: ReadonlyMap<string, Json>;
};

export type LoadedInterface = {
  readonly file: string;
  readonly definition: Interface;
};

export type System = {
  readonly modes: ReadonlyMap<string, LoadedMode>;
  readonly active: ReadonlySet<string>;
  readonly interfaces: ReadonlyMap<string, LoadedInterface>;
  readonly config: Config;
};

export type BindingUse = {
  readonly interfaceName: string;
  readonly requirers: readonly string[];
  readonly servedBy: string;
};

export type SystemReport = {
  readonly outcome: Outcome<System>;
  readonly active: ReadonlySet<string>;
  readonly notices: readonly Problem[];
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

export type ModeFolder = {
  readonly home: Home;
  readonly folder: string;
};

type ModeSource = Loaded<Mode> & ModeFolder;

type UnloadedMode = ModeFolder & {
  readonly name: string;
  readonly problems: readonly Problem[];
};

type Collected<T> = {
  readonly values: readonly T[];
  readonly problems: readonly Problem[];
};

type LoadedModes = {
  readonly values: readonly ModeSource[];
  readonly unloaded: readonly UnloadedMode[];
};

type Indexed<T> = {
  readonly index: ReadonlyMap<string, T>;
  readonly problems: readonly Problem[];
};

type Context = {
  readonly files: FileSystem;
  readonly layout: Layout;
  readonly modes: ReadonlyMap<string, ModeSource>;
  readonly interfaces: ReadonlyMap<string, Loaded<Interface>>;
  readonly config: Loaded<Config> | undefined;
  readonly unloadedModes: ReadonlySet<string>;
  readonly active: ReadonlySet<string>;
};

type Activation = {
  readonly active: ReadonlySet<string>;
  readonly problems: readonly Problem[];
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

type RequiredBinding = {
  readonly reference: string;
  readonly bound: BoundMode;
};

type BoundMode = {
  readonly mode: string;
  readonly path: PathSegments;
  readonly label: string;
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

const kitModeTiers = ["components/base", "components/modes"] as const;

const projectModeTier = "components/modes";

const kitInterfacesFolder = "components/base/interfaces";

const projectInterfacesFolder = "components/interfaces";

const forge = "forge";

const defaultKey = "default";

const schemaDirections = ["input", "output"] as const;

function modeTierFolders(layout: Layout): readonly ModeFolder[] {
  const kitTiers = kitModeTiers.map((tier) => ({ home: "kit" as const, folder: pathIn(layout, "kit", tier) }));
  if (isProjectTheKit(layout)) {
    return kitTiers;
  }
  return [...kitTiers, { home: "project", folder: pathIn(layout, "project", projectModeTier) }];
}

export function ownInterfacesFolder(layout: Layout): string {
  return isProjectTheKit(layout)
    ? pathIn(layout, "kit", kitInterfacesFolder)
    : pathIn(layout, "project", projectInterfacesFolder);
}

function interfaceFolders(layout: Layout): readonly string[] {
  const kitFolder = pathIn(layout, "kit", kitInterfacesFolder);
  return isProjectTheKit(layout) ? [kitFolder] : [kitFolder, ownInterfacesFolder(layout)];
}

function shown(context: Context, path: string): string {
  return shownPath(context.layout, path);
}

function manifestFileOf(mode: ModeFolder): string {
  return join(mode.folder, "mode.yaml");
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

function bindingFor(bindings: Config["bindings"], requirer: string, reference: string): BoundMode | undefined {
  const name = interfaceName(reference);
  const binding = Object.hasOwn(bindings, name) ? bindings[name] : undefined;
  if (binding === undefined) {
    return undefined;
  }
  if (typeof binding === "string") {
    return { mode: binding, path: ["bindings", name], label: name };
  }
  const key = Object.hasOwn(binding, requirer) ? requirer : defaultKey;
  const mode = Object.hasOwn(binding, key) ? binding[key] : undefined;
  return mode === undefined ? undefined : { mode, path: ["bindings", name, key], label: `${name} for ${requirer}` };
}

export function servingMode(system: System, requirer: string, reference: string): string | undefined {
  const bound = bindingFor(system.config.bindings, requirer, reference)?.mode;
  return bound !== undefined && system.modes.has(bound) ? bound : undefined;
}

function servedReferences(system: System, requirer: string): readonly (readonly [string, string])[] {
  const mode = system.modes.get(requirer);
  const references = mode === undefined ? [] : requiredReferences(mode.manifest);
  return references.flatMap((reference) => {
    const servedBy = servingMode(system, requirer, reference);
    return servedBy === undefined ? [] : [[interfaceName(reference), servedBy] as const];
  });
}

export function bindingUses(system: System): readonly BindingUse[] {
  const uses = new Map<string, BindingUse>();
  for (const requirer of [...system.active].sort()) {
    for (const [name, servedBy] of servedReferences(system, requirer)) {
      const key = `${name} ${servedBy}`;
      const requirers = uses.get(key)?.requirers ?? [];
      uses.set(key, { interfaceName: name, requirers: [...requirers, requirer], servedBy });
    }
  }
  return [...uses.values()].sort((first, second) => first.interfaceName.localeCompare(second.interfaceName));
}

function boundModeOf(context: Context, requirer: string, reference: string): BoundMode | undefined {
  const config = context.config;
  return config === undefined ? undefined : bindingFor(config.value.bindings, requirer, reference);
}

function activeModesOf(context: Context): readonly ModeSource[] {
  return [...context.modes.values()].filter((mode) => context.active.has(mode.value.name));
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

export async function findModeFolders(files: FileSystem, layout: Layout): Promise<readonly ModeFolder[]> {
  const interfacesFolders = interfaceFolders(layout);
  const found: ModeFolder[] = [];
  for (const tier of modeTierFolders(layout)) {
    for (const name of await files.list(tier.folder)) {
      const folder = join(tier.folder, name);
      if (!interfacesFolders.includes(folder) && (await files.exists(join(folder, "mode.yaml")))) {
        found.push({ home: tier.home, folder });
      }
    }
  }
  return found;
}

export async function findInterfaceFiles(files: FileSystem, layout: Layout): Promise<readonly string[]> {
  const found: string[] = [];
  for (const folder of interfaceFolders(layout)) {
    const names = await files.list(folder);
    found.push(
      ...names.filter((name) => name.endsWith(".yaml") && name !== "mode.yaml").map((name) => join(folder, name)),
    );
  }
  return found;
}

async function modeInInterfacesProblems(files: FileSystem, layout: Layout): Promise<readonly Problem[]> {
  const problems: Problem[] = [];
  for (const folder of interfaceFolders(layout)) {
    const file = join(folder, "mode.yaml");
    if (await files.exists(file)) {
      problems.push({
        file,
        path: "",
        message: `${shownPath(layout, folder)} holds interface files only, but it has a mode.yaml.`,
        fix: "Move the mode to a folder of its own, such as components/modes/<mode>/mode.yaml.",
      });
    }
  }
  return problems;
}

async function loadModes(files: FileSystem, layout: Layout): Promise<LoadedModes> {
  const values: ModeSource[] = [];
  const unloaded: UnloadedMode[] = [];
  for (const found of await findModeFolders(files, layout)) {
    const outcome = await loadSpec(files, manifestFileOf(found), "mode");
    if (outcome.ok) {
      values.push({ ...outcome.value, ...found });
    } else {
      unloaded.push({ ...found, name: basename(found.folder), problems: outcome.problems });
    }
  }
  return { values, unloaded };
}

async function loadInterfaces(files: FileSystem, layout: Layout): Promise<Collected<Loaded<Interface>>> {
  return loadEach(await findInterfaceFiles(files, layout), (file) => loadSpec(files, file, "interface"));
}

async function loadConfig(files: FileSystem, layout: Layout): Promise<Outcome<Loaded<Config>>> {
  const configFile = layout.configFile;
  if (await files.exists(configFile)) {
    return loadSpec(files, configFile, "config");
  }
  const problem = {
    file: configFile,
    path: "",
    message: `The project config ${shownPath(layout, configFile)} does not exist.`,
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
      } else if (context.active.has(mode.value.name)) {
        problems.push(...outcome.problems);
      }
    }
  }
  return { values, problems };
}

function homesOf(modes: LoadedModes): ReadonlyMap<string, ModeFolder> {
  const loaded = modes.values.map((mode) => ({ name: mode.value.name, home: mode.home, folder: mode.folder }));
  const homes = new Map<string, ModeFolder>();
  for (const mode of [...loaded, ...modes.unloaded]) {
    if (!homes.has(mode.name)) {
      homes.set(mode.name, { home: mode.home, folder: mode.folder });
    }
  }
  return homes;
}

function listedModeProblem(context: Context, name: string, index: number): Problem | undefined {
  const config = context.config;
  if (config === undefined) {
    return undefined;
  }
  if (name === forge && !isProjectTheKit(context.layout)) {
    return problemAt(config, ["modes", index], {
      message: "modes lists forge, which can be active only when the project is the kit itself.",
      fix: "Remove forge from modes; forge changes the kit, so it runs only in the kit's own folder.",
    });
  }
  if (context.modes.has(name) || context.unloadedModes.has(name)) {
    return undefined;
  }
  return problemAt(config, ["modes", index], {
    message: `modes lists ${name}, which is not a mode of the kit or of the project.`,
    fix: `Correct the name, or remove ${name} from modes.`,
  });
}

function seedModes(context: Context, homes: ReadonlyMap<string, ModeFolder>): Activation {
  const listed = context.config?.value.modes ?? [];
  const problems = listed.flatMap((name, index) => listedModeProblem(context, name, index) ?? []);
  if (isProjectTheKit(context.layout)) {
    return { active: new Set(homes.keys()), problems };
  }
  const own = [...homes].filter(([, mode]) => mode.home === "project").map(([name]) => name);
  const known = listed.filter((name) => homes.has(name) && name !== forge);
  return { active: new Set([...own, ...known]), problems };
}

function boundForgeProblems(context: Context, binding: RequiredBinding): readonly Problem[] {
  const config = context.config;
  if (config === undefined) {
    return [];
  }
  const { reference, bound } = binding;
  const problem = problemAt(config, bound.path, {
    message: `bindings binds ${bound.label} to forge, which can be active only when the project is the kit itself.`,
    fix: `Bind ${interfaceName(reference)} to another mode that implements ${reference}.`,
  });
  return [problem];
}

function bindingsFrom(context: Context, name: string): readonly RequiredBinding[] {
  const mode = context.modes.get(name);
  const references = mode === undefined ? [] : requiredReferences(mode.value);
  return references.flatMap((reference) => {
    const bound = boundModeOf(context, name, reference);
    return bound === undefined ? [] : [{ reference, bound }];
  });
}

function activation(context: Context, homes: ReadonlyMap<string, ModeFolder>): Activation {
  const seeded = seedModes(context, homes);
  const active = new Set(seeded.active);
  const problems = [...seeded.problems];
  const queue = [...active];
  for (let name = queue.shift(); name !== undefined; name = queue.shift()) {
    for (const binding of bindingsFrom(context, name)) {
      const bound = binding.bound.mode;
      if (active.has(bound) || !homes.has(bound)) {
        continue;
      }
      if (bound === forge && !isProjectTheKit(context.layout)) {
        problems.push(...boundForgeProblems(context, binding));
        continue;
      }
      active.add(bound);
      queue.push(bound);
    }
  }
  return { active, problems };
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

function folderNameProblems(context: Context): readonly Problem[] {
  return activeModesOf(context).flatMap((mode) => {
    const folderName = basename(mode.folder);
    if (folderName === mode.value.name) {
      return [];
    }
    return [
      problemAt(mode, ["name"], {
        message: `The mode is named ${mode.value.name}, but its folder is ${shown(context, mode.folder)}.`,
        fix: `Rename the folder to ${mode.value.name}, or set name: ${folderName}.`,
      }),
    ];
  });
}

function duplicateWording(layout: Layout, name: string, files: readonly string[]): Wording {
  const both = files.map((file) => shownPath(layout, file)).join(" and ");
  return {
    message: `Two modes are named ${name}: ${both}.`,
    fix: "Rename one of them; every mode needs its own name, and a project mode cannot replace a kit mode.",
  };
}

function indexModes(modes: LoadedModes, layout: Layout): Indexed<ModeSource> {
  const index = new Map<string, ModeSource>();
  const seen = new Map<string, string>();
  const problems: Problem[] = [];
  for (const mode of modes.unloaded) {
    const first = seen.get(mode.name);
    const file = manifestFileOf(mode);
    if (first !== undefined) {
      problems.push({ file, path: "", ...duplicateWording(layout, mode.name, [first, file]) });
    }
    seen.set(mode.name, first ?? file);
  }
  for (const mode of modes.values) {
    const name = mode.value.name;
    const first = seen.get(name);
    if (first !== undefined) {
      problems.push(problemAt(mode, ["name"], duplicateWording(layout, name, [first, mode.file])));
      continue;
    }
    seen.set(name, mode.file);
    index.set(name, mode);
  }
  return { index, problems };
}

function indexInterfaces(interfaces: readonly Loaded<Interface>[], layout: Layout): Indexed<Loaded<Interface>> {
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
        message: `Two interface files define ${reference}: ${shownPath(layout, first.file)} and ${shownPath(layout, loaded.file)}.`,
        fix: "Remove one of them, or give one a different name or version.",
      }),
    );
  }
  return { index, problems };
}

function unknownInterface(context: Context, subject: string, reference: string): Wording {
  const otherVersions = [...context.interfaces.keys()].filter((key) => interfaceName(key) === interfaceName(reference));
  const found = otherVersions.length === 0 ? "" : ` (found: ${otherVersions.join(", ")})`;
  const folders = interfaceFolders(context.layout).map((folder) => shown(context, folder));
  return {
    message: `${subject} ${reference}, but no interface file in ${folders.join(" or ")} defines it${found}.`,
    fix: `Correct the name or major version, or add the interface to ${folders.at(-1) ?? ""}.`,
  };
}

function candidatesOf(context: Context, reference: string): string {
  const implementers = implementersOf(context, reference);
  return implementers.length === 0 ? "none yet" : implementers.join(", ");
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

function requirersOf(context: Context, name: string): readonly string[] {
  return [...context.modes.values()]
    .filter((mode) => requiredReferences(mode.value).some((reference) => interfaceName(reference) === name))
    .map((mode) => mode.value.name);
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
    const declared = await readSchemaFile(files, join(implemented.folder, declaredPath));
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
    problems.push(...(await shapeProblems(files, place, { reference, signature, folder })));
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
    problems.push(...(await signatureProblems(context.files, mode, definition)));
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
  const schemaFile = await readSchemaFile(context.files, reference.file);
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

async function inputSchemasOf(files: FileSystem, mode: ModeSource): Promise<ReadonlyMap<string, Json>> {
  const schemas = new Map<string, Json>();
  for (const place of actionsOf(mode)) {
    const schemaFile = await readSchemaFile(files, join(mode.folder, place.action.input));
    if (schemaFile.state === "valid") {
      schemas.set(place.name, toJson(schemaFile.schema));
    }
  }
  return schemas;
}

async function buildSystem(context: Context, config: Config, workflows: readonly ModeWorkflow[]): Promise<System> {
  const modes = new Map<string, LoadedMode>();
  for (const [name, mode] of context.modes) {
    const own = workflows
      .filter((entry) => entry.mode.value.name === name)
      .map((entry) => [entry.path, entry.loaded.value] as const);
    modes.set(name, {
      home: mode.home,
      folder: mode.folder,
      manifest: mode.value,
      lineOf: mode.lineOf,
      workflows: new Map(own),
      settings: settingsOf(config, name),
      inputSchemas: await inputSchemasOf(context.files, mode),
    });
  }
  const interfaces = new Map<string, LoadedInterface>();
  for (const [reference, loaded] of context.interfaces) {
    interfaces.set(reference, { file: loaded.file, definition: loaded.value });
  }
  return { modes, active: context.active, interfaces, config };
}

function loadProblems(context: Context, modes: LoadedModes): Collected<UnloadedMode> {
  const inactive = modes.unloaded.filter((mode) => !context.active.has(mode.name));
  const active = modes.unloaded.filter((mode) => context.active.has(mode.name));
  return { values: inactive, problems: active.flatMap((mode) => mode.problems) };
}

export async function loadSystemReport(files: FileSystem, layout: Layout): Promise<SystemReport> {
  const modes = await loadModes(files, layout);
  const interfaces = await loadInterfaces(files, layout);
  const config = await loadConfig(files, layout);
  const modeIndex = indexModes(modes, layout);
  const interfaceIndex = indexInterfaces(interfaces.values, layout);
  const loaded = {
    files,
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
  const notices = shownProblems(
    layout,
    unloaded.values.map((mode) => inactiveNotice(layout, mode)),
  );
  const report = { active: context.active, notices };
  if (problems.length > 0 || !config.ok) {
    return { ...report, outcome: { ok: false, problems: shownProblems(layout, problems) } };
  }
  const system = await buildSystem(context, config.value.value, workflows.values);
  return { ...report, outcome: { ok: true, value: system } };
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

function activeModesByName(system: System): readonly LoadedMode[] {
  return [...system.active].sort().flatMap((name) => system.modes.get(name) ?? []);
}

function listedModes(system: System, words: readonly string[]): ActionsListing {
  const modes = activeModesByName(system).map((mode) => ({
    name: mode.manifest.name,
    description: mode.manifest.description,
  }));
  return { modes: modes.filter((mode) => holdsEveryWord(words, mode)) };
}

function listedActions(mode: LoadedMode, words: readonly string[]): Outcome<ActionsListing> {
  const actions: ActionListed[] = [];
  const problems: Problem[] = [];
  for (const [name, action] of Object.entries(mode.manifest.actions)) {
    const reference = `${mode.manifest.name}.${name}`;
    const input = mode.inputSchemas.get(name);
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

export function actionsListing(system: System, question: ListingQuestion): Outcome<ActionsListing> {
  const words = wordsOf(question.find);
  if (question.mode === undefined) {
    return succeededWith(listedModes(system, words));
  }
  const mode = system.active.has(question.mode) ? system.modes.get(question.mode) : undefined;
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
