import { basename, join, relative } from "node:path/posix";
import type { Interface } from "./generated/interface.ts";
import type { Mode } from "./generated/mode.ts";
import { homeFolder, isProjectTheKit, shownPath, type Home, type Layout } from "./layout.ts";
import type { FileSystem } from "./ports.ts";
import { findInterfaceFiles, findModeFolders } from "./registry.ts";
import { loadSpec, type Loaded, type Problem } from "./spec.ts";

export type Severity = "error" | "warning";

export type Finding = Problem & { readonly severity: Severity };

export type FileListing = {
  readonly projectFiles: (folder: string) => Promise<readonly string[]>;
};

export type ModeFolder = {
  readonly home: Home;
  readonly folder: string;
  readonly label: string;
  readonly files: readonly string[];
  readonly manifest: Loaded<Mode> | undefined;
};

export type LoadedModeFolder = ModeFolder & { readonly manifest: Loaded<Mode> };

export type KitTree = {
  readonly files: FileSystem;
  readonly paths: readonly string[];
};

export type CheckContext = {
  readonly layout: Layout;
  readonly files: FileSystem;
  readonly kit: KitTree;
  readonly modes: readonly ModeFolder[];
  readonly interfaces: ReadonlyMap<string, Interface>;
};

export type CheckSources = {
  readonly files: FileSystem;
  readonly listing: FileListing;
  readonly layout: Layout;
  readonly active: ReadonlySet<string>;
};

export const kitInterfacesFolder = "components/base/interfaces";

export function errors(problems: readonly Problem[]): readonly Finding[] {
  return problems.map((problem) => ({ ...problem, severity: "error" }));
}

export function warnings(problems: readonly Problem[]): readonly Finding[] {
  return problems.map((problem) => ({ ...problem, severity: "warning" }));
}

function rootedFileSystem(files: FileSystem, root: string): FileSystem {
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

export function filesUnder(paths: readonly string[], folder: string): readonly string[] {
  const prefix = `${folder}/`;
  return paths.filter((path) => path.startsWith(prefix)).map((path) => path.slice(prefix.length));
}

export function lineOfIndex(text: string, index: number): number {
  return text.slice(0, index).split("\n").length;
}

function listingsOf(sources: CheckSources): (home: Home) => Promise<readonly string[]> {
  const listings = new Map<Home, Promise<readonly string[]>>();
  return (home) => {
    const folder = homeFolder(sources.layout, home);
    const earlier = listings.get(home) ?? sources.listing.projectFiles(folder);
    listings.set(home, earlier);
    return earlier;
  };
}

function isChecked(sources: CheckSources, home: Home, name: string): boolean {
  return home === "project" || isProjectTheKit(sources.layout) || sources.active.has(name);
}

async function loadModeFolders(
  sources: CheckSources,
  listing: (home: Home) => Promise<readonly string[]>,
): Promise<readonly ModeFolder[]> {
  const { files, layout } = sources;
  const modes: ModeFolder[] = [];
  for (const found of await findModeFolders(files, layout)) {
    const outcome = await loadSpec(files, join(found.folder, "mode.yaml"), "mode");
    const manifest = outcome.ok ? outcome.value : undefined;
    if (!isChecked(sources, found.home, manifest?.value.name ?? basename(found.folder))) {
      continue;
    }
    const below = relative(homeFolder(layout, found.home), found.folder);
    const modeFiles = filesUnder(await listing(found.home), below);
    modes.push({ ...found, label: shownPath(layout, found.folder), files: modeFiles, manifest });
  }
  return modes;
}

async function loadInterfaceDefinitions(files: FileSystem, layout: Layout): Promise<ReadonlyMap<string, Interface>> {
  const definitions = new Map<string, Interface>();
  for (const file of await findInterfaceFiles(files, layout)) {
    const outcome = await loadSpec(files, file, "interface");
    if (outcome.ok) {
      const definition = outcome.value.value;
      definitions.set(`${definition.name}@${String(definition.version)}`, definition);
    }
  }
  return definitions;
}

export async function loadCheckContext(sources: CheckSources): Promise<CheckContext> {
  const { files, layout } = sources;
  const listing = listingsOf(sources);
  const kitPaths = isProjectTheKit(layout) ? await listing("kit") : [];
  const modes = await loadModeFolders(sources, listing);
  const interfaces = await loadInterfaceDefinitions(files, layout);
  const kit = { files: rootedFileSystem(files, layout.kit), paths: kitPaths };
  return { layout, files, kit, modes, interfaces };
}
