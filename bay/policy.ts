import { isAbsolute, join, normalize } from "node:path/posix";
import type { Effect, Permissions, PolicyOf } from "./contracts.ts";
import type { Mode } from "./generated/mode.ts";
import type { LoadedMode, System, SystemLayout } from "./registry.ts";
import type { Outcome, Problem } from "./spec.ts";

type ProtectedArea = {
  readonly path: string;
  readonly name: string;
};

type DeclaredPath = {
  readonly direction: "read" | "write";
  readonly index: number;
  readonly path: string;
};

type ModePlace = {
  readonly mode: string;
  readonly action: string;
};

const kernelAreas: readonly ProtectedArea[] = [
  { path: ".agentbay", name: "the kernel's state folder .agentbay/" },
  { path: ".git", name: "the git folder .git/" },
  { path: "bay", name: "the kernel folder bay/" },
  { path: "schemas", name: "the schemas folder schemas/" },
  { path: "adapters", name: "the adapters folder adapters/" },
  { path: "framework", name: "the framework folder framework/" },
];

export const secretNamePattern = /^[A-Z][A-Z0-9_]*$/;

const hostPattern = /^(\*\.)?([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)*[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;

function manifestFile(mode: LoadedMode): string {
  return join(mode.folder, "mode.yaml");
}

function isInsideOrEqual(path: string, folder: string): boolean {
  return path === folder || path.startsWith(`${folder}/`);
}

function protectedAreas(system: System, own: LoadedMode): readonly ProtectedArea[] {
  const otherModes = [...system.modes.values()]
    .filter((mode) => mode !== own)
    .map((mode) => ({ path: normalize(mode.folder), name: `the folder of the mode ${mode.manifest.name}` }));
  return [...kernelAreas, ...otherModes];
}

type DeclaredResources = {
  readonly read: readonly string[];
  readonly write: readonly string[];
  readonly secrets: readonly string[];
  readonly hosts: readonly string[];
  readonly commands: readonly string[];
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

function pathWording(declared: DeclaredPath, areas: readonly ProtectedArea[]): string | undefined {
  const path = normalized(declared.path);
  if (isAbsolute(declared.path) || path === ".." || path.startsWith("../")) {
    return `The path ${declared.path} leaves the project root.`;
  }
  const folded = path.toLowerCase();
  for (const area of areas) {
    const areaFolded = area.path.toLowerCase();
    if (isInsideOrEqual(folded, areaFolded)) {
      return `The path ${declared.path} points into ${area.name}, which no mode may name.`;
    }
    if (folded === "." || areaFolded.startsWith(`${folded}/`)) {
      return `The path ${declared.path} contains ${area.name}, which no mode may name.`;
    }
  }
  return undefined;
}

function pathProblems(system: System, mode: LoadedMode): readonly Problem[] {
  const areas = protectedAreas(system, mode);
  return declaredPaths(mode.manifest).flatMap((declared) => {
    const message = pathWording(declared, areas);
    if (message === undefined) {
      return [];
    }
    return [
      {
        file: manifestFile(mode),
        path: `/resources/files/${declared.direction}/${String(declared.index)}`,
        message,
        fix: "Name a folder of the project outside the kernel, state and other modes' folders.",
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

function unionOfEffects(manifest: Mode): readonly Effect[] {
  const effects = new Set<Effect>();
  for (const action of Object.values(manifest.actions)) {
    for (const effect of action.effects) {
      effects.add(effect);
    }
  }
  return [...effects];
}

function rootedPaths(root: string, paths: readonly string[]): readonly string[] {
  return paths.map((path) => join(root, normalized(path)));
}

function unknownMode(name: string): Outcome<Permissions> {
  return {
    ok: false,
    problems: [
      { file: "", path: "", message: `There is no mode named ${name}.`, fix: "Name a mode the registry loaded." },
    ],
  };
}

function permissionsOfMode(mode: LoadedMode, layout: SystemLayout): Permissions {
  const declared = declaredResources(mode.manifest);
  const modeFolder = join(layout.root, normalized(mode.folder));
  const writePaths = rootedPaths(layout.root, declared.write);
  return {
    mode: mode.manifest.name,
    modeFolder,
    databaseFile: join(layout.root, ".agentbay", "data", `${mode.manifest.name}.db`),
    readPaths: [modeFolder, ...rootedPaths(layout.root, declared.read), ...writePaths],
    writePaths,
    secrets: [...declared.secrets],
    hosts: [...declared.hosts],
    commands: [...declared.commands],
    effects: unionOfEffects(mode.manifest),
  };
}

export function permissionsFor(system: System, modeName: string, layout: SystemLayout): Outcome<Permissions> {
  const mode = system.modes.get(modeName);
  if (mode === undefined) {
    return unknownMode(modeName);
  }
  const problems = [...pathProblems(system, mode), ...secretProblems(mode), ...hostProblems(mode)];
  if (problems.length > 0) {
    return { ok: false, problems };
  }
  return { ok: true, value: permissionsOfMode(mode, layout) };
}

export function permissionsForAction(system: System, place: ModePlace, layout: SystemLayout): Outcome<Permissions> {
  const outcome = permissionsFor(system, place.mode, layout);
  if (!outcome.ok) {
    return outcome;
  }
  const mode = system.modes.get(place.mode);
  const action = mode?.manifest.actions[place.action];
  if (mode === undefined || action === undefined) {
    return {
      ok: false,
      problems: [
        {
          file: mode === undefined ? "" : manifestFile(mode),
          path: "/actions",
          message: `The mode ${place.mode} has no action ${place.action}.`,
          fix: "Name an action the mode declares.",
        },
      ],
    };
  }
  return { ok: true, value: { ...outcome.value, effects: [...action.effects] } };
}

export function policyFor(system: System, layout: SystemLayout): Outcome<PolicyOf> {
  const permissions = new Map<string, Permissions>();
  const problems: Problem[] = [];
  for (const name of system.modes.keys()) {
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
        throw new Error(`The policy was asked for the mode ${mode}, which the system does not hold.`);
      }
      return found;
    },
  };
}
