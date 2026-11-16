import { basename, join } from "node:path/posix";
import type { Interface } from "../generated/interface.ts";
import { shownPath, shownProblems, type Home, type Layout } from "../layout.ts";
import type { FileSystem } from "../ports.ts";
import { checkValue, problemAt } from "./spec.ts";
import type { Problem } from "../outcome.ts";
import type { System, Inspection, InspectedFolder } from "./manifests.ts";
import { type ModeTier, kitLayoutOf, manifestFileOf, modeInInterfacesProblems } from "./folders.ts";
import { schemaReader } from "./schemas.ts";
import {
  type ModeRead,
  type ModeSource,
  type UnloadedMode,
  type Collected,
  type LoadedModes,
  type Context,
  actionsOf,
  activeModesOf,
  loadModes,
  loadInterfaces,
  loadConfig,
  loadWorkflows,
} from "./loaded.ts";
import { homesOf, activation } from "./activation.ts";
import { folderNameProblems, indexModes, indexInterfaces } from "./naming.ts";
import { bindingMapProblems, requiresProblems, cycleProblems } from "./binding-problems.ts";
import { implementsProblems } from "./implements-problems.ts";
import { actionProblems } from "./action-problems.ts";
import { referenceProblems } from "./file-references.ts";
import { workflowProblems } from "./workflow-problems.ts";
import { modeSettingsProblems, straySettingsProblems } from "./settings-problems.ts";
import { grantsOfActiveModes } from "./grants.ts";
import { inspectedSkill } from "./skills.ts";
import { buildSystem } from "./system.ts";

export type FolderPlace = {
  readonly home: Home;
  readonly tier: ModeTier;
  readonly folder: string;
  readonly active: boolean;
};

export type SchemaAgainst = {
  readonly schema: string;
  readonly file: string;
  readonly under: string;
};

type Pass = {
  readonly inspection: Inspection;
  readonly build: (() => Promise<System>) | undefined;
};

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

function loadProblems(context: Context, modes: LoadedModes): Collected<UnloadedMode> {
  const inactive = modes.unloaded.filter((mode) => !context.active.has(mode.name));
  const active = modes.unloaded.filter((mode) => context.active.has(mode.name));
  return { values: inactive, problems: active.flatMap((mode) => mode.problems) };
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

export async function inspect(files: FileSystem, layout: Layout): Promise<Pass> {
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
