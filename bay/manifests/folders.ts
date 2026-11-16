import { join, relative } from "node:path/posix";
import { isProjectTheKit, pathIn, shownPath, type Home, type Layout } from "../layout.ts";
import type { FileSystem } from "../ports.ts";
import type { Problem } from "../outcome.ts";

export type KitLayout = {
  readonly components: string;
  readonly tiers: readonly string[];
  readonly interfaces: string;
};

export type ModeFolder = {
  readonly home: Home;
  readonly folder: string;
};

export type ModeTier = "base" | "modes";

export type TierFolder = ModeFolder & {
  readonly tier: ModeTier;
};

type FolderRules = {
  readonly kitComponents: string;
  readonly base: TierFolder;
  readonly kitModes: TierFolder;
  readonly projectModes: TierFolder | undefined;
  readonly kitInterfaces: string;
  readonly projectInterfaces: string | undefined;
};

export function folderRules(layout: Layout): FolderRules {
  const kitComponents = pathIn(layout, "kit", "components");
  const base: TierFolder = { home: "kit", tier: "base", folder: join(kitComponents, "base") };
  const kitModes: TierFolder = { home: "kit", tier: "modes", folder: join(kitComponents, "modes") };
  const kitInterfaces = join(base.folder, "interfaces");
  if (isProjectTheKit(layout)) {
    return { kitComponents, base, kitModes, projectModes: undefined, kitInterfaces, projectInterfaces: undefined };
  }
  return {
    kitComponents,
    base,
    kitModes,
    projectModes: { home: "project", tier: "modes", folder: pathIn(layout, "project", "components/modes") },
    kitInterfaces,
    projectInterfaces: pathIn(layout, "project", "components/interfaces"),
  };
}

export function modeTiers(rules: FolderRules): readonly TierFolder[] {
  return rules.projectModes === undefined
    ? [rules.base, rules.kitModes]
    : [rules.base, rules.kitModes, rules.projectModes];
}

export function ownModeTiers(rules: FolderRules): readonly TierFolder[] {
  return rules.projectModes === undefined ? [rules.base, rules.kitModes] : [rules.projectModes];
}

export function interfaceFolders(layout: Layout): readonly string[] {
  const rules = folderRules(layout);
  return rules.projectInterfaces === undefined ? [rules.kitInterfaces] : [rules.kitInterfaces, rules.projectInterfaces];
}

export function ownInterfacesFolder(layout: Layout): string {
  const rules = folderRules(layout);
  return rules.projectInterfaces ?? rules.kitInterfaces;
}

export function kitLayoutOf(layout: Layout): KitLayout {
  const rules = folderRules(layout);
  return {
    components: relative(layout.kit, rules.kitComponents),
    tiers: [rules.base, rules.kitModes].map((tier) => relative(layout.kit, tier.folder)),
    interfaces: relative(layout.kit, rules.kitInterfaces),
  };
}

export function manifestFileOf(mode: ModeFolder): string {
  return join(mode.folder, "mode.yaml");
}

export async function findModeFolders(files: FileSystem, layout: Layout): Promise<readonly TierFolder[]> {
  const interfaces = interfaceFolders(layout);
  const found: TierFolder[] = [];
  for (const tier of modeTiers(folderRules(layout))) {
    for (const name of await files.list(tier.folder)) {
      const folder = join(tier.folder, name);
      if (!interfaces.includes(folder) && (await files.exists(join(folder, "mode.yaml")))) {
        found.push({ ...tier, folder });
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

export async function modeInInterfacesProblems(files: FileSystem, layout: Layout): Promise<readonly Problem[]> {
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
