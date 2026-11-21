import { join, relative } from "node:path/posix";
import type { Interface } from "./generated/interface.ts";
import type { Mode } from "./generated/mode.ts";
import { homeFolder, isProjectTheKit, shownPath, type Home, type Layout } from "./layout.ts";
import type { FileListing, FileSystem } from "./ports.ts";
import type { InspectedFolder, Inspection } from "./manifests/manifests.ts";
import type { Problem } from "./outcome.ts";

export type Severity = "error" | "warning";

export type Finding = Problem & { readonly severity: Severity };

export type Wording = Pick<Problem, "message" | "fix">;

type FolderFiles = {
  readonly label: string;
  readonly files: readonly string[];
};

export type ModeFolder = InspectedFolder & FolderFiles;

export type LoadedModeFolder = Extract<InspectedFolder, { readonly manifest: Mode }> & FolderFiles;

export type KitTree = {
  readonly files: FileSystem;
  readonly paths: readonly string[];
  readonly layout: Inspection["kitLayout"];
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
  readonly inspection: Inspection;
};

export function counted(count: number, word: string): string {
  return `${String(count)} ${word}${count === 1 ? "" : "s"}`;
}

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

function listingsOf(sources: CheckSources): (home: Home) => Promise<readonly string[]> {
  const listings = new Map<Home, Promise<readonly string[]>>();
  return (home) => {
    const folder = homeFolder(sources.layout, home);
    const earlier = listings.get(home) ?? sources.listing.projectFiles(folder);
    listings.set(home, earlier);
    return earlier;
  };
}

function isChecked(layout: Layout, folder: InspectedFolder): boolean {
  return folder.home === "project" || isProjectTheKit(layout) || folder.active;
}

async function modeFoldersOf(
  sources: CheckSources,
  listing: (home: Home) => Promise<readonly string[]>,
): Promise<readonly ModeFolder[]> {
  const { layout } = sources;
  const modes: ModeFolder[] = [];
  for (const found of sources.inspection.folders.filter((folder) => isChecked(layout, folder))) {
    const below = relative(homeFolder(layout, found.home), found.folder);
    const modeFiles = filesUnder(await listing(found.home), below);
    modes.push({ ...found, label: shownPath(layout, found.folder), files: modeFiles });
  }
  return modes;
}

export async function checkContextOf(sources: CheckSources): Promise<CheckContext> {
  const { files, layout, inspection } = sources;
  const listing = listingsOf(sources);
  const kitPaths = isProjectTheKit(layout) ? await listing("kit") : [];
  const modes = await modeFoldersOf(sources, listing);
  const kit = { files: rootedFileSystem(files, layout.kit), paths: kitPaths, layout: inspection.kitLayout };
  return { layout, files, kit, modes, interfaces: inspection.interfaces };
}
