import { isAbsolute, join, normalize } from "node:path/posix";
import type { ModeGrants, PolicyOf } from "./contracts.ts";
import type { Mode } from "./generated/mode.ts";
import type { FileSystem } from "./ports.ts";
import {
  isInsideOrEqual,
  isProjectTheKit,
  pathIn,
  shownPath,
  shownProblems,
  type Home,
  type Layout,
} from "./layout.ts";
import { loadSystemReport, type LoadedMode, type System, type SystemReport } from "./manifests/registry.ts";
import { problemAt } from "./manifests/spec.ts";
import type { Outcome, Problem } from "./outcome.ts";

export type OtherMode = {
  readonly name: string;
  readonly folder: string;
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

type Direction = "read" | "write";

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
  ];
  if (problems.length > 0) {
    return { ok: false, problems };
  }
  return { ok: true, value: grantsOfMode(request) };
}

function refusedMode(wording: { readonly message: string; readonly fix: string }): Outcome<ModeGrants> {
  return { ok: false, problems: [{ file: "", path: "", ...wording }] };
}

function placedProblem(mode: LoadedMode, problem: GrantProblem): Problem {
  const loaded = { file: join(mode.folder, "mode.yaml"), value: mode.manifest, lineOf: mode.lineOf };
  return problemAt(loaded, problem.at, { message: problem.message, fix: problem.fix });
}

export function permissionsFor(system: System, modeName: string, layout: Layout): Outcome<ModeGrants> {
  const mode = system.modes.get(modeName);
  if (mode === undefined) {
    return refusedMode({ message: `There is no mode named ${modeName}.`, fix: "Name a mode the registry loaded." });
  }
  if (!system.active.has(modeName)) {
    return refusedMode(inactiveModeWording(modeName));
  }
  const otherModes = [...system.modes.values()]
    .filter((other) => other !== mode)
    .map((other) => ({ name: other.manifest.name, folder: other.folder }));
  const ruling = grantsOf({ manifest: mode.manifest, home: mode.home, folder: mode.folder, layout, otherModes });
  if (!ruling.ok) {
    return {
      ok: false,
      problems: shownProblems(
        layout,
        ruling.problems.map((problem) => placedProblem(mode, problem)),
      ),
    };
  }
  return ruling;
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

export type PolicedSystem = {
  readonly system: System;
  readonly policyOf: PolicyOf;
};

export type PolicedReport = Omit<SystemReport, "outcome"> & { readonly outcome: Outcome<PolicedSystem> };

export async function loadPolicedSystem(files: FileSystem, layout: Layout): Promise<PolicedReport> {
  const report = await loadSystemReport(files, layout);
  if (!report.outcome.ok) {
    return { ...report, outcome: report.outcome };
  }
  const system = report.outcome.value;
  const policy = policyFor(system, layout);
  return { ...report, outcome: policy.ok ? { ok: true, value: { system, policyOf: policy.value } } : policy };
}
