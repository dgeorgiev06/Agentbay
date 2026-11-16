import { isAbsolute, join, normalize } from "node:path/posix";
import type { ModeGrants } from "./contracts.ts";
import type { Mode } from "./generated/mode.ts";
import { isInsideOrEqual, isProjectTheKit, pathIn, shownPath, type Home, type Layout } from "./layout.ts";

export type OtherMode = {
  readonly name: string;
  readonly folder: string;
  readonly manifest: Mode;
};

export type GrantRequest = {
  readonly manifest: Mode;
  readonly home: Home;
  readonly folder: string;
  readonly layout: Layout;
  readonly otherModes: readonly OtherMode[];
};

export type GrantProblem = {
  readonly at: readonly (string | number)[];
  readonly message: string;
  readonly fix: string;
};

export type GrantRuling =
  | { readonly ok: true; readonly value: ModeGrants }
  | { readonly ok: false; readonly problems: readonly GrantProblem[] };

type ProtectedArea = {
  readonly path: string;
  readonly name: string;
  readonly rule: string;
};

type Direction = "read" | "write" | "throwaway";

type NamedFolder = {
  readonly path: string;
  readonly name: string;
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

const baseTier = "components/base";

export const secretNamePattern = /^[A-Z][A-Z0-9_]*$/;

const hostPattern = /^(\*\.)?([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)*[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;

function manifestFile(request: GrantRequest): string {
  return join(request.folder, "mode.yaml");
}

function isForge(request: GrantRequest): boolean {
  const { manifest, folder, layout } = request;
  return manifest.name === "forge" && isProjectTheKit(layout) && folder === pathIn(layout, "kit", forgeFolder);
}

function ownCodeAreas(own: GrantRequest): readonly ProtectedArea[] {
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

function protectedAreas(own: GrantRequest, direction: Direction): readonly ProtectedArea[] {
  const { layout } = own;
  if (isForge(own)) {
    return stateAreas(layout);
  }
  const otherModes = own.otherModes.map((mode) => ({
    path: mode.folder,
    name: `the folder of the mode ${mode.name}`,
    rule: onlyForge,
  }));
  const code = direction === "read" ? [] : ownCodeAreas(own);
  return [...stateAreas(layout), ...kernelAreas(layout), ...kitArea(layout), ...otherModes, ...code];
}

type DeclaredResources = {
  readonly read: readonly string[];
  readonly write: readonly string[];
  readonly throwaway: readonly string[];
  readonly secrets: readonly string[];
  readonly hosts: readonly string[];
  readonly commands: readonly string[];
  readonly migrations: string;
};

type DeclaredFiles = Pick<DeclaredResources, "read" | "write" | "throwaway">;

function declaredFiles(manifest: Mode): DeclaredFiles {
  const files = manifest.resources?.files ?? {};
  return { read: files.read ?? [], write: files.write ?? [], throwaway: files.throwaway ?? [] };
}

function declaredResources(manifest: Mode): DeclaredResources {
  const resources = manifest.resources ?? {};
  return {
    ...declaredFiles(manifest),
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
  const throwaway = declared.throwaway.map((path, index) => ({ direction: "throwaway" as const, index, path }));
  return [...read, ...write, ...throwaway];
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

function pathProblems(request: GrantRequest): readonly GrantProblem[] {
  return declaredPaths(request.manifest).flatMap((declared) => {
    const areas = protectedAreas(request, declared.direction);
    const message = pathWording(request.layout, declared, areas);
    if (message === undefined) {
      return [];
    }
    return [
      {
        at: ["resources", "files", declared.direction, declared.index],
        message,
        fix: "Name a folder outside the kernel, state and other modes' folders, and outside the mode's own code.",
      },
    ];
  });
}

function secretProblems(manifest: Mode): readonly GrantProblem[] {
  return declaredResources(manifest).secrets.flatMap((name, index) =>
    secretNamePattern.test(name)
      ? []
      : [
          {
            at: ["resources", "secrets", index],
            message: `The secret name ${name} is not made of upper-case letters, digits and underscores.`,
            fix: `Rename it, for example to ${name.toUpperCase().replace(/[^A-Z0-9_]/g, "_")}.`,
          },
        ],
  );
}

function hostProblems(manifest: Mode): readonly GrantProblem[] {
  return declaredResources(manifest).hosts.flatMap((host, index) =>
    hostPattern.test(host)
      ? []
      : [
          {
            at: ["resources", "network", index],
            message: `The host ${host} is not a lower-case host name, or a host name after a leading *.`,
            fix: "Write the host alone, such as api.example.com or *.example.com, with no scheme, port or path.",
          },
        ],
  );
}

function isBaseMode(request: GrantRequest): boolean {
  return request.home === "kit" && isInsideOrEqual(request.folder, pathIn(request.layout, "kit", baseTier));
}

function commandProblems(request: GrantRequest): readonly GrantProblem[] {
  if (isBaseMode(request)) {
    return [];
  }
  const { manifest, layout } = request;
  return declaredResources(manifest).commands.map((command, index) => ({
    at: ["resources", "commands", index],
    message:
      `Mode ${manifest.name} lists the command ${command}; a listed command can run code the agent wrote. ` +
      `Only a mode under the kit's ${baseTier}/ may list commands.`,
    fix: `Remove the command from ${shownPath(layout, manifestFile(request))}; a skill step's checks belong in script steps.`,
  }));
}

function throwawayPlaceProblems(request: GrantRequest): readonly GrantProblem[] {
  if (isBaseMode(request)) {
    return [];
  }
  const { manifest, layout } = request;
  return declaredFiles(manifest).throwaway.map((path, index) => ({
    at: ["resources", "files", "throwaway", index],
    message:
      `Mode ${manifest.name} names the throwaway folder ${path}; the kernel removes whole folders and makes links ` +
      `there for it. Only a mode under the kit's ${baseTier}/ may name throwaway folders.`,
    fix: `Remove resources.files.throwaway from ${shownPath(layout, manifestFile(request))}.`,
  }));
}

type GrantedPath = {
  readonly mode: string;
  readonly access: "read" | "write";
  readonly path: string;
};

function grantedPaths(manifest: Mode): readonly GrantedPath[] {
  const files = declaredFiles(manifest);
  return [
    ...files.read.map((path) => ({ mode: manifest.name, access: "read" as const, path })),
    ...files.write.map((path) => ({ mode: manifest.name, access: "write" as const, path })),
  ];
}

function throwawayOverlapProblems(request: GrantRequest): readonly GrantProblem[] {
  const { manifest, layout } = request;
  const granted = [manifest, ...request.otherModes.map((other) => other.manifest)].flatMap(grantedPaths);
  const inProject = (path: string): string => pathIn(layout, "project", normalized(path));
  return declaredFiles(manifest).throwaway.flatMap((path, index) => {
    const folder = inProject(path);
    const overlapping = granted.find(
      (other) => isInsideOrEqual(inProject(other.path), folder) || isInsideOrEqual(folder, inProject(other.path)),
    );
    if (overlapping === undefined) {
      return [];
    }
    return [
      {
        at: ["resources", "files", "throwaway", index],
        message:
          `The throwaway folder ${path} overlaps ${overlapping.path}, which the mode ${overlapping.mode} may ` +
          `${overlapping.access}; the kernel removes whole folders in a throwaway folder.`,
        fix: "Name a throwaway folder that neither holds nor sits inside a path any mode may read or write.",
      },
    ];
  });
}

function projectPaths(layout: Layout, paths: readonly string[]): readonly string[] {
  return paths.map((path) => pathIn(layout, "project", normalized(path)));
}

function grantsOfMode(request: GrantRequest): ModeGrants {
  const { manifest, folder, layout } = request;
  const declared = declaredResources(manifest);
  const writePaths = projectPaths(layout, declared.write);
  return {
    mode: manifest.name,
    modeFolder: folder,
    databaseFile: pathIn(layout, "project", join(".agentbay", "data", `${manifest.name}.db`)),
    migrationsFolder: join(folder, normalized(declared.migrations)),
    readPaths: [folder, ...projectPaths(layout, declared.read), ...writePaths],
    writePaths,
    throwawayPaths: projectPaths(layout, declared.throwaway),
    secrets: [...declared.secrets],
    hosts: [...declared.hosts],
    commands: [...declared.commands],
  };
}

export function grantsOf(request: GrantRequest): GrantRuling {
  const problems = [
    ...pathProblems(request),
    ...secretProblems(request.manifest),
    ...hostProblems(request.manifest),
    ...commandProblems(request),
    ...throwawayPlaceProblems(request),
    ...throwawayOverlapProblems(request),
  ];
  if (problems.length > 0) {
    return { ok: false, problems };
  }
  return { ok: true, value: grantsOfMode(request) };
}
