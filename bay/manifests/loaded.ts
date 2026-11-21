import { basename, join } from "node:path/posix";
import type { Config } from "../generated/config.ts";
import type { Interface } from "../generated/interface.ts";
import type { Action, Mode } from "../generated/mode.ts";
import type { Workflow } from "../generated/workflow.ts";
import { shownPath, type Layout } from "../layout.ts";
import type { FileSystem } from "../ports.ts";
import { loadSpec } from "./spec.ts";
import type { Loaded, SchemaFile } from "../value-check.ts";
import type { Outcome, Problem } from "../outcome.ts";
import { type ModeFolder, type TierFolder, manifestFileOf, findModeFolders, findInterfaceFiles } from "./folders.ts";

export type SchemaReader = (file: string) => Promise<SchemaFile>;

export type ModeRead = {
  readonly found: TierFolder;
  readonly outcome: Outcome<Loaded<Mode>>;
};

export type ModeSource = Loaded<Mode> & ModeFolder;

export type UnloadedMode = ModeFolder & {
  readonly name: string;
  readonly problems: readonly Problem[];
};

export type Collected<T> = {
  readonly values: readonly T[];
  readonly problems: readonly Problem[];
};

export type LoadedModes = {
  readonly read: readonly ModeRead[];
  readonly values: readonly ModeSource[];
  readonly unloaded: readonly UnloadedMode[];
};

export type Context = {
  readonly files: FileSystem;
  readonly readSchema: SchemaReader;
  readonly layout: Layout;
  readonly modes: ReadonlyMap<string, ModeSource>;
  readonly interfaces: ReadonlyMap<string, Loaded<Interface>>;
  readonly config: Loaded<Config> | undefined;
  readonly unloadedModes: ReadonlySet<string>;
  readonly active: ReadonlySet<string>;
};

export type ActionPlace = {
  readonly mode: ModeSource;
  readonly name: string;
  readonly action: Action;
};

export type ModeWorkflow = {
  readonly mode: ModeSource;
  readonly path: string;
  readonly loaded: Loaded<Workflow>;
};

export function shown(context: Context, path: string): string {
  return shownPath(context.layout, path);
}

export function actionsOf(mode: ModeSource): readonly ActionPlace[] {
  return Object.entries(mode.value.actions).map(([name, action]) => ({ mode, name, action }));
}

export function actionLabel(place: ActionPlace): string {
  return `Action ${place.name} of mode ${place.mode.value.name}`;
}

export function settingsOf(config: Config, modeName: string): Readonly<Record<string, unknown>> {
  return config.settings?.[modeName] ?? {};
}

export function activeModesOf(context: Context): readonly ModeSource[] {
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

export async function loadModes(files: FileSystem, layout: Layout): Promise<LoadedModes> {
  const read: ModeRead[] = [];
  const values: ModeSource[] = [];
  const unloaded: UnloadedMode[] = [];
  for (const found of await findModeFolders(files, layout)) {
    const outcome = await loadSpec(files, manifestFileOf(found), "mode");
    read.push({ found, outcome });
    if (outcome.ok) {
      values.push({ ...outcome.value, home: found.home, folder: found.folder });
    } else {
      unloaded.push({
        home: found.home,
        folder: found.folder,
        name: basename(found.folder),
        problems: outcome.problems,
      });
    }
  }
  return { read, values, unloaded };
}

export async function loadInterfaces(files: FileSystem, layout: Layout): Promise<Collected<Loaded<Interface>>> {
  return loadEach(await findInterfaceFiles(files, layout), (file) => loadSpec(files, file, "interface"));
}

export async function loadConfig(files: FileSystem, layout: Layout): Promise<Outcome<Loaded<Config>>> {
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

export async function loadWorkflows(context: Context): Promise<Collected<ModeWorkflow>> {
  const values: ModeWorkflow[] = [];
  const problems: Problem[] = [];
  for (const mode of activeModesOf(context)) {
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
