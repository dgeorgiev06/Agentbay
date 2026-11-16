import { join } from "node:path/posix";
import type { Interface } from "../generated/interface.ts";
import { shownPath, type Home, type Layout } from "../layout.ts";
import { checkValue } from "./spec.ts";
import type { Problem } from "../outcome.ts";
import { type ModeTier, manifestFileOf } from "./folders.ts";
import {
  type ModeSource,
  type UnloadedMode,
  type Collected,
  type LoadedModes,
  type Context,
  actionsOf,
  activeModesOf,
} from "./loaded.ts";
import { bindingMapProblems, requiresProblems, cycleProblems } from "./binding-problems.ts";
import { implementsProblems } from "./implements-problems.ts";
import { actionProblems } from "./action-problems.ts";
import { referenceProblems } from "./file-references.ts";
import { modeSettingsProblems, straySettingsProblems } from "./settings-problems.ts";

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

export function inactiveNotice(layout: Layout, mode: UnloadedMode): Problem {
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

export async function consistencyProblems(context: Context): Promise<readonly Problem[]> {
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

export function loadProblems(context: Context, modes: LoadedModes): Collected<UnloadedMode> {
  const inactive = modes.unloaded.filter((mode) => !context.active.has(mode.name));
  const active = modes.unloaded.filter((mode) => context.active.has(mode.name));
  return { values: inactive, problems: active.flatMap((mode) => mode.problems) };
}

export function schemaProblemsOf(
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

export function interfaceDefinitions(context: Context): ReadonlyMap<string, Interface> {
  return new Map([...context.interfaces].map(([reference, loaded]) => [reference, loaded.value]));
}
