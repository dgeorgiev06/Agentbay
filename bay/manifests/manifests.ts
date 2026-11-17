import { basename, join, relative } from "node:path/posix";
import type { Json, ModeGrants } from "../contracts.ts";
import type { Config } from "../generated/config.ts";
import type { Interface } from "../generated/interface.ts";
import type { Action, Effect, Mode } from "../generated/mode.ts";
import type { SkillFrontMatter } from "../generated/skill.ts";
import type { Workflow } from "../generated/workflow.ts";
import { isProjectTheKit, shownProblems, type Home, type Layout } from "../layout.ts";
import { toJson } from "../json.ts";
import type { FileSystem } from "../ports.ts";
import { resolveInput, resolveValue } from "./references.ts";
import {
  parseSkill,
  problemAt,
  readSkill,
  type Loaded,
  type PathSegments,
  type SkillText,
  type Wording,
} from "./spec.ts";
import { failedWith, succeededWith, unplacedProblem, type Outcome, type Problem } from "../outcome.ts";
import { type KitLayout, type ModeTier, folderRules, kitLayoutOf, modeInInterfacesProblems } from "./folders.ts";
import { type SchemaSource, schemaReader, valueProblems } from "./schemas.ts";
import { schemaFilesOf, signaturesNaming } from "./action-schemas.ts";
import {
  type ModeRead,
  type ModeSource,
  type Context,
  type ModeWorkflow,
  actionsOf,
  settingsOf,
  loadModes,
  loadInterfaces,
  loadConfig,
  loadWorkflows,
} from "./loaded.ts";
import { interfaceName, requiredReferences } from "./interfaces.ts";
import { bindingFor } from "./bindings.ts";
import { homesOf, activation } from "./activation.ts";
import { folderNameProblems, indexModes, indexInterfaces } from "./naming.ts";
import { workflowProblems } from "./workflow-problems.ts";
import { grantsOfActiveModes } from "./grants.ts";
import {
  type FolderPlace,
  type SchemaAgainst,
  inactiveNotice,
  consistencyProblems,
  loadProblems,
  schemaProblemsOf,
  interfaceDefinitions,
} from "./inspection.ts";
import {
  partProblem,
  nameProblems,
  folderInHome,
  takenModeProblems,
  modeToWriteIn,
  placeInterface,
} from "./placement.ts";

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

type ActionSchemas = {
  readonly input: Schema;
  readonly output: Schema;
};

type LoadedInterface = {
  readonly file: string;
  readonly definition: Interface;
};

type ActionWithSchemas = Action & {
  readonly input: string;
  readonly output: string;
};

export type ActionTarget = {
  readonly mode: ActiveMode;
  readonly name: string;
  readonly action: ActionWithSchemas;
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

export type InspectedFolder =
  | (FolderPlace & { readonly manifest: undefined })
  | (FolderPlace & {
      readonly manifest: Mode;
      readonly at: (path: PathSegments, wording: Wording) => Problem;
      readonly schemaProblems: (value: unknown, against: SchemaAgainst) => Promise<readonly Problem[]>;
      readonly skill: (folder: string) => Promise<InspectedSkill>;
    });

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

export type InterfaceAction = {
  readonly reference: string;
  readonly effects: readonly Effect[];
};

type NewMode = Extract<NewPart, { readonly mode: string }>;

type NewModePart = Extract<NewPart, { readonly inMode: string }>;

function servingMode(system: System, requirer: string, reference: string): string | undefined {
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
  for (const requirer of [...system.modes.keys()].sort()) {
    for (const [name, servedBy] of servedReferences(system, requirer)) {
      const key = `${name} ${servedBy}`;
      const requirers = uses.get(key)?.requirers ?? [];
      uses.set(key, { interfaceName: name, requirers: [...requirers, requirer], servedBy });
    }
  }
  return [...uses.values()].sort((first, second) => first.interfaceName.localeCompare(second.interfaceName));
}

function schemaOf(source: SchemaSource): Schema {
  const { file, schemaFile } = source;
  return {
    file,
    json: schemaFile.state === "valid" ? toJson(schemaFile.schema) : undefined,
    check: (value) => {
      const problems = valueProblems(source, value);
      return problems.length === 0 ? succeededWith(value) : failedWith(problems);
    },
  };
}

async function actionSchemasOf(context: Context, mode: ModeSource): Promise<ReadonlyMap<string, ActionSchemas>> {
  const actionSchemas = new Map<string, ActionSchemas>();
  for (const place of actionsOf(mode)) {
    const files = schemaFilesOf(context, place);
    if (files === undefined) {
      continue;
    }
    actionSchemas.set(place.name, {
      input: schemaOf({ file: files.input, schemaFile: await context.readSchema(files.input), label: "input" }),
      output: schemaOf({ file: files.output, schemaFile: await context.readSchema(files.output), label: "output" }),
    });
  }
  return actionSchemas;
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
  const paths = {
    input: relative(mode.folder, schemas.input.file),
    output: relative(mode.folder, schemas.output.file),
  };
  const target = { mode, name, action: { ...action, ...paths }, caller: undefined };
  return succeededWith({ ...target, input: schemas.input, output: schemas.output });
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
      actionSchemas: await actionSchemasOf(context, mode),
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

function inspectedSkill(context: Context, mode: ModeSource): (folder: string) => Promise<InspectedSkill> {
  return async (folder) => {
    const file = join(mode.folder, folder, "SKILL.md");
    return { file, text: await readSkill(context.files, file) };
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

async function placeModePart(files: FileSystem, layout: Layout, part: NewModePart): Promise<Outcome<string>> {
  const target = await modeToWriteIn(files, layout, part.inMode);
  const refusals = nameProblems(part.kind, part.name, target.ok ? target.value : part.inMode);
  if (!target.ok || refusals.length > 0) {
    return failedWith([...(target.ok ? [] : target.problems), ...refusals]);
  }
  return target;
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

export async function interfaceActionFor(
  files: FileSystem,
  layout: Layout,
  part: NewModePart,
): Promise<InterfaceAction | undefined> {
  const mode = (await loadModes(files, layout)).values.find((entry) => basename(entry.folder) === part.inMode);
  if (mode === undefined) {
    return undefined;
  }
  const interfaces = indexInterfaces((await loadInterfaces(files, layout)).values, layout).index;
  const [named] = signaturesNaming(interfaces, mode.value.implements ?? [], part.name);
  return named === undefined ? undefined : { reference: named.reference, effects: named.signature.effects };
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
