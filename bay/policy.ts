import { isAbsolute, join, normalize } from "node:path/posix";
import type { ModeGrants, PolicyOf } from "./contracts.ts";
import type { Mode } from "./generated/mode.ts";
import { isInsideOrEqual, isProjectTheKit, pathIn, shownProblems, type Home, type Layout } from "./layout.ts";
import type { LoadedMode, System } from "./registry.ts";
import type { Outcome, Problem } from "./spec.ts";

type ProtectedArea = {
  readonly path: string;
  readonly name: string;
  readonly rule: string;
};

type Direction = "read" | "write";

type NamedFolder = {
  readonly path: string;
  readonly name: string;
};

type PolicyContext = {
  readonly system: System;
  readonly layout: Layout;
};

type DeclaredPath = {
  readonly direction: Direction;
  readonly index: number;
  readonly path: string;
};

const noMode = "which no mode may name";

const onlyForge = "which only the base mode forge may name";

const ownCode = "and only the base mode forge may write a mode's own code";

const kitRule = "which a mode may name only when the project is the kit itself";

const stateFolders: readonly NamedFolder[] = [
  { path: ".agentbay", name: "the kernel's state folder .agentbay/" },
  { path: ".git", name: "the git folder .git/" },
];

const kernelFolders: readonly NamedFolder[] = [
  { path: "bay", name: "the kernel folder bay/" },
  { path: "schemas", name: "the schemas folder schemas/" },
  { path: "adapters", name: "the adapters folder adapters/" },
  { path: "framework", name: "the framework folder framework/" },
];

const forgeFolder = "components/base/forge";

export const secretNamePattern = /^[A-Z][A-Z0-9_]*$/;

const hostPattern = /^(\*\.)?([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)*[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;

function manifestFile(mode: LoadedMode): string {
  return join(mode.folder, "mode.yaml");
}

function isForge(mode: LoadedMode, layout: Layout): boolean {
  return (
    mode.manifest.name === "forge" && isProjectTheKit(layout) && mode.folder === pathIn(layout, "kit", forgeFolder)
  );
}

function ownCodeAreas(own: LoadedMode): readonly ProtectedArea[] {
  return [
    { path: join(own.folder, "mode.yaml"), name: "the mode's own mode.yaml", rule: ownCode },
    { path: join(own.folder, "scripts"), name: "the mode's own scripts/ folder", rule: ownCode },
    { path: join(own.folder, "skills"), name: "the mode's own skills/ folder", rule: ownCode },
  ];
}

function stateAreas(layout: Layout): readonly ProtectedArea[] {
  return stateFolders.map((folder) => ({
    path: pathIn(layout, "project", folder.path),
    name: folder.name,
    rule: noMode,
  }));
}

function kernelAreas(layout: Layout): readonly ProtectedArea[] {
  const homes: readonly Home[] = isProjectTheKit(layout) ? ["kit"] : ["kit", "project"];
  return homes.flatMap((home) =>
    kernelFolders.map((folder) => ({
      path: pathIn(layout, home, folder.path),
      name: home === "kit" && !isProjectTheKit(layout) ? `${folder.name} of the kit` : folder.name,
      rule: onlyForge,
    })),
  );
}

function kitArea(layout: Layout): readonly ProtectedArea[] {
  if (isProjectTheKit(layout) || isInsideOrEqual(layout.project, layout.kit)) {
    return [];
  }
  return [{ path: layout.kit, name: `the agentbay kit ${layout.kit}`, rule: kitRule }];
}

function protectedAreas(context: PolicyContext, own: LoadedMode, direction: Direction): readonly ProtectedArea[] {
  const { system, layout } = context;
  if (isForge(own, layout)) {
    return stateAreas(layout);
  }
  const otherModes = [...system.modes.values()]
    .filter((mode) => mode !== own)
    .map((mode) => ({ path: mode.folder, name: `the folder of the mode ${mode.manifest.name}`, rule: onlyForge }));
  const code = direction === "write" ? ownCodeAreas(own) : [];
  return [...stateAreas(layout), ...kernelAreas(layout), ...kitArea(layout), ...otherModes, ...code];
}

type DeclaredResources = {
  readonly read: readonly string[];
  readonly write: readonly string[];
  readonly secrets: readonly string[];
  readonly hosts: readonly string[];
  readonly commands: readonly string[];
  readonly migrations: string;
};

function declaredResources(manifest: Mode): DeclaredResources {
  const resources = manifest.resources ?? {};
  const files = resources.files ?? {};
  return {
    read: files.read ?? [],
    write: files.write ?? [],
    secrets: resources.secrets ?? [],
    hosts: resources.network ?? [],
    commands: resources.commands ?? [],
    migrations: resources.db?.migrations ?? "migrations",
  };
}

function declaredPaths(manifest: Mode): readonly DeclaredPath[] {
  const declared = declaredResources(manifest);
  const read = declared.read.map((path, index) => ({ direction: "read" as const, index, path }));
  const write = declared.write.map((path, index) => ({ direction: "write" as const, index, path }));
  return [...read, ...write];
}

function normalized(path: string): string {
  return normalize(path).replace(/\/+$/, "");
}

function leavesProject(path: string): boolean {
  const relativePath = normalized(path);
  return isAbsolute(path) || relativePath === ".." || relativePath.startsWith("../");
}

function pathWording(layout: Layout, declared: DeclaredPath, areas: readonly ProtectedArea[]): string | undefined {
  if (leavesProject(declared.path)) {
    return `The path ${declared.path} leaves the project root.`;
  }
  const folded = pathIn(layout, "project", normalized(declared.path)).toLowerCase();
  for (const area of areas) {
    const areaFolded = area.path.toLowerCase();
    if (isInsideOrEqual(folded, areaFolded)) {
      return `The path ${declared.path} points into ${area.name}, ${area.rule}.`;
    }
    if (isInsideOrEqual(areaFolded, folded)) {
      return `The path ${declared.path} contains ${area.name}, ${area.rule}.`;
    }
  }
  return undefined;
}

function pathProblems(context: PolicyContext, mode: LoadedMode): readonly Problem[] {
  return declaredPaths(mode.manifest).flatMap((declared) => {
    const areas = protectedAreas(context, mode, declared.direction);
    const message = pathWording(context.layout, declared, areas);
    if (message === undefined) {
      return [];
    }
    return [
      {
        file: manifestFile(mode),
        path: `/resources/files/${declared.direction}/${String(declared.index)}`,
        message,
        fix: "Name a folder outside the kernel, state and other modes' folders, and outside the mode's own code.",
      },
    ];
  });
}

function secretProblems(mode: LoadedMode): readonly Problem[] {
  return declaredResources(mode.manifest).secrets.flatMap((name, index) =>
    secretNamePattern.test(name)
      ? []
      : [
          {
            file: manifestFile(mode),
            path: `/resources/secrets/${String(index)}`,
            message: `The secret name ${name} is not made of upper-case letters, digits and underscores.`,
            fix: `Rename it, for example to ${name.toUpperCase().replace(/[^A-Z0-9_]/g, "_")}.`,
          },
        ],
  );
}

function hostProblems(mode: LoadedMode): readonly Problem[] {
  return declaredResources(mode.manifest).hosts.flatMap((host, index) =>
    hostPattern.test(host)
      ? []
      : [
          {
            file: manifestFile(mode),
            path: `/resources/network/${String(index)}`,
            message: `The host ${host} is not a lower-case host name, or a host name after a leading *.`,
            fix: "Write the host alone, such as api.example.com or *.example.com, with no scheme, port or path.",
          },
        ],
  );
}

function projectPaths(layout: Layout, paths: readonly string[]): readonly string[] {
  return paths.map((path) => pathIn(layout, "project", normalized(path)));
}

function refusedMode(wording: { readonly message: string; readonly fix: string }): Outcome<ModeGrants> {
  return { ok: false, problems: [{ file: "", path: "", ...wording }] };
}

function grantsOfMode(mode: LoadedMode, layout: Layout): ModeGrants {
  const declared = declaredResources(mode.manifest);
  const writePaths = projectPaths(layout, declared.write);
  return {
    mode: mode.manifest.name,
    modeFolder: mode.folder,
    databaseFile: pathIn(layout, "project", join(".agentbay", "data", `${mode.manifest.name}.db`)),
    migrationsFolder: join(mode.folder, normalized(declared.migrations)),
    readPaths: [mode.folder, ...projectPaths(layout, declared.read), ...writePaths],
    writePaths,
    secrets: [...declared.secrets],
    hosts: [...declared.hosts],
    commands: [...declared.commands],
  };
}

export function permissionsFor(system: System, modeName: string, layout: Layout): Outcome<ModeGrants> {
  const mode = system.modes.get(modeName);
  if (mode === undefined) {
    return refusedMode({ message: `There is no mode named ${modeName}.`, fix: "Name a mode the registry loaded." });
  }
  if (!system.active.has(modeName)) {
    return refusedMode(inactiveModeWording(modeName));
  }
  const context = { system, layout };
  const problems = [...pathProblems(context, mode), ...secretProblems(mode), ...hostProblems(mode)];
  if (problems.length > 0) {
    return { ok: false, problems: shownProblems(layout, problems) };
  }
  return { ok: true, value: grantsOfMode(mode, layout) };
}

export function inactiveModeWording(modeName: string): { readonly message: string; readonly fix: string } {
  return {
    message: `Mode ${modeName} is not active in this project, so nothing of it runs here.`,
    fix: `Add ${modeName} to modes: in agentbay.config.yaml, or bind an interface it implements.`,
  };
}

export function policyFor(system: System, layout: Layout): Outcome<PolicyOf> {
  const permissions = new Map<string, ModeGrants>();
  const problems: Problem[] = [];
  for (const name of system.active) {
    const outcome = permissionsFor(system, name, layout);
    if (outcome.ok) {
      permissions.set(name, outcome.value);
    } else {
      problems.push(...outcome.problems);
    }
  }
  if (problems.length > 0) {
    return { ok: false, problems };
  }
  return {
    ok: true,
    value: (mode) => {
      const found = permissions.get(mode);
      if (found === undefined) {
        throw new Error(`The policy was asked for the mode ${mode}, which is not active in the system.`);
      }
      return found;
    },
  };
}
