import { join } from "node:path/posix";
import type { Interface } from "./generated/interface.ts";
import type { Mode } from "./generated/mode.ts";
import type { FileSystem } from "./ports.ts";
import { loadSpec, type Loaded, type Problem } from "./spec.ts";

export type Severity = "error" | "warning";

export type Finding = Problem & { readonly severity: Severity };

export type ModeFolder = {
  readonly folder: string;
  readonly files: readonly string[];
  readonly manifest: Loaded<Mode> | undefined;
};

export type LoadedModeFolder = ModeFolder & { readonly manifest: Loaded<Mode> };

export type CheckContext = {
  readonly files: FileSystem;
  readonly paths: readonly string[];
  readonly modes: readonly ModeFolder[];
  readonly interfaces: ReadonlyMap<string, Interface>;
};

const modeTiers = ["components/base", "components/modes"] as const;

const interfacesFolder = "components/base/interfaces";

export function errors(problems: readonly Problem[]): readonly Finding[] {
  return problems.map((problem) => ({ ...problem, severity: "error" }));
}

export function warnings(problems: readonly Problem[]): readonly Finding[] {
  return problems.map((problem) => ({ ...problem, severity: "warning" }));
}

export function rootedFileSystem(files: FileSystem, root: string): FileSystem {
  return {
    readText: (path) => files.readText(join(root, path)),
    list: (directory) => files.list(join(root, directory)),
    exists: (path) => files.exists(join(root, path)),
    writeAtomic: (path, text) => files.writeAtomic(join(root, path), text),
  };
}

export function isLoaded(mode: ModeFolder): mode is LoadedModeFolder {
  return mode.manifest !== undefined;
}

function filesUnder(paths: readonly string[], folder: string): readonly string[] {
  const prefix = `${folder}/`;
  return paths.filter((path) => path.startsWith(prefix)).map((path) => path.slice(prefix.length));
}

async function modeFolderNames(files: FileSystem): Promise<readonly string[]> {
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

async function loadModeFolders(files: FileSystem, paths: readonly string[]): Promise<readonly ModeFolder[]> {
  const modes: ModeFolder[] = [];
  for (const folder of await modeFolderNames(files)) {
    const outcome = await loadSpec(files, join(folder, "mode.yaml"), "mode");
    const manifest = outcome.ok ? outcome.value : undefined;
    modes.push({ folder, files: filesUnder(paths, folder), manifest });
  }
  return modes;
}

async function loadInterfaceDefinitions(files: FileSystem): Promise<ReadonlyMap<string, Interface>> {
  const definitions = new Map<string, Interface>();
  for (const name of await files.list(interfacesFolder)) {
    if (!name.endsWith(".yaml")) {
      continue;
    }
    const outcome = await loadSpec(files, join(interfacesFolder, name), "interface");
    if (outcome.ok) {
      const definition = outcome.value.value;
      definitions.set(`${definition.name}@${String(definition.version)}`, definition);
    }
  }
  return definitions;
}

export async function loadCheckContext(files: FileSystem, paths: readonly string[]): Promise<CheckContext> {
  const modes = await loadModeFolders(files, paths);
  const interfaces = await loadInterfaceDefinitions(files);
  return { files, paths, modes, interfaces };
}
