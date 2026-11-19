import { basename, isAbsolute, join, normalize } from "node:path/posix";
import type { GrantedCommand, ListTrust, ModeGrants, ModeList } from "./contracts.ts";
import type { Mode } from "./generated/mode.ts";
import { isInsideOrEqual, isProjectTheKit, pathIn, shownPath, type Home, type Layout } from "./layout.ts";
import type { Outcome } from "./outcome.ts";
import { listHashOf, type TrustRecord } from "./trust.ts";

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
  readonly record: Outcome<TrustRecord>;
};

export type ListTrustRequest = Pick<GrantRequest, "manifest" | "home" | "folder" | "layout" | "record">;

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

function isBaseForge(request: GrantRequest): boolean {
  const { manifest, home, folder, layout } = request;
  return manifest.name === "forge" && home === "kit" && folder === pathIn(layout, "kit", forgeFolder);
}

function isForge(request: GrantRequest): boolean {
  return isBaseForge(request) && isProjectTheKit(request.layout);
}

function ownCodeAreas(own: GrantRequest): readonly ProtectedArea[] {
  return [
    { path: join(own.folder, "mode.yaml"), name: "the mode's own mode.yaml", rule: ownCode },
    { path: join(own.folder, "scripts"), name: "the mode's own scripts/ folder", rule: ownCode },
    { path: join(own.folder, "skills"), name: "the mode's own skills/ folder", rule: ownCode },
  ];
}

function stateAreas(layout: Layout): readonly ProtectedArea[] {
  const folders = stateFolders.map((folder) => ({
    path: pathIn(layout, "project", folder.path),
    name: folder.name,
    rule: noMode,
  }));
  const configFile = {
    path: layout.configFile,
    name: `the project's config file ${basename(layout.configFile)}`,
    rule: noMode,
  };
  return [...folders, configFile];
}

function kernelHomes(own: GrantRequest, direction: Direction): readonly Home[] {
  if (isProjectTheKit(own.layout) || (direction === "read" && isBaseForge(own))) {
    return ["kit"];
  }
  return ["kit", "project"];
}

function kernelAreas(own: GrantRequest, direction: Direction): readonly ProtectedArea[] {
  const { layout } = own;
  return kernelHomes(own, direction).flatMap((home) =>
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
  return [...stateAreas(layout), ...kernelAreas(own, direction), ...kitArea(layout), ...otherModes, ...code];
}

type DeclaredResources = {
  readonly read: readonly string[];
  readonly write: readonly string[];
  readonly throwaway: readonly string[];
  readonly secrets: readonly string[];
  readonly hosts: readonly string[];
  readonly commands: readonly GrantedCommand[];
  readonly migrations: string;
};

type DeclaredFiles = Pick<DeclaredResources, "read" | "write" | "throwaway">;

function declaredFiles(manifest: Mode): DeclaredFiles {
  const files = manifest.resources?.files ?? {};
  return { read: files.read ?? [], write: files.write ?? [], throwaway: files.throwaway ?? [] };
}

function wordsOf(text: string): readonly string[] {
  return text.split(/\s+/).filter((word) => word !== "");
}

export function listedCommandsOf(manifest: Mode): readonly GrantedCommand[] {
  const resources = manifest.resources ?? {};
  const startWords = wordsOf(resources.commandsStartWith ?? "");
  return Object.entries(resources.commands ?? {}).map(([name, command]) => ({
    name,
    words: [...startWords, ...wordsOf(command.run)],
    effects: [...command.effects],
  }));
}

function declaredResources(manifest: Mode): DeclaredResources {
  const resources = manifest.resources ?? {};
  return {
    ...declaredFiles(manifest),
    secrets: resources.secrets ?? [],
    hosts: resources.network ?? [],
    commands: listedCommandsOf(manifest),
    migrations: resources.db?.migrations ?? "migrations",
  };
}

export function listOf(manifest: Mode): ModeList {
  const declared = declaredResources(manifest);
  return {
    mode: manifest.name,
    commands: declared.commands,
    commandsStartWith: wordsOf(manifest.resources?.commandsStartWith ?? ""),
    throwaway: declared.throwaway.map(normalized),
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

function isBaseMode(request: ListTrustRequest): boolean {
  return request.home === "kit" && isInsideOrEqual(request.folder, pathIn(request.layout, "kit", baseTier));
}

function commandEffectProblems(request: GrantRequest): readonly GrantProblem[] {
  const { manifest, layout } = request;
  return declaredResources(manifest).commands.flatMap(({ name, effects }) =>
    effects.length > 0
      ? []
      : [
          {
            at: ["resources", "commands", name, "effects"],
            message: `The command ${name} of mode ${manifest.name} lists no effects, and a command has at least one.`,
            fix:
              `List under resources.commands.${name}.effects in ${shownPath(layout, manifestFile(request))} ` +
              "each effect the command can have: read, write, network, spend or delete. " +
              "The kernel believes the list and cannot check it.",
          },
        ],
  );
}

function startWordsGiven(manifest: Mode): string {
  const startWords = wordsOf(manifest.resources?.commandsStartWith ?? "").join(" ");
  return `Mode ${manifest.name} gives ${startWords} as the words every command it lists starts with`;
}

function startWordsWithoutCommandsProblems(request: GrantRequest): readonly GrantProblem[] {
  const { manifest, layout } = request;
  if (manifest.resources?.commandsStartWith === undefined || declaredResources(manifest).commands.length > 0) {
    return [];
  }
  return [
    {
      at: ["resources", "commandsStartWith"],
      message: `${startWordsGiven(manifest)}, and lists no command.`,
      fix:
        `List the commands under resources.commands in ${shownPath(layout, manifestFile(request))}, ` +
        "or remove commandsStartWith.",
    },
  ];
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

export function listTrustOf(request: ListTrustRequest): ListTrust {
  const list = listOf(request.manifest);
  const listsNothing = list.commands.length === 0 && list.throwaway.length === 0;
  if (isBaseMode(request) || listsNothing) {
    return { state: "not needed" };
  }
  if (!request.record.ok) {
    return { state: "unreadable record", list, problems: request.record.problems };
  }
  const trusted = request.record.value.modes;
  const given = Object.hasOwn(trusted, list.mode) ? trusted[list.mode] : undefined;
  if (given === undefined) {
    return { state: "never trusted", list };
  }
  return given.hash === listHashOf(list) ? { state: "trusted", given } : { state: "changed", list, given };
}

function isInForce(listTrust: ListTrust): boolean {
  return listTrust.state === "not needed" || listTrust.state === "trusted";
}

function grantsOfMode(request: GrantRequest): ModeGrants {
  const { manifest, folder, layout } = request;
  const declared = declaredResources(manifest);
  const writePaths = projectPaths(layout, declared.write);
  const listTrust = listTrustOf(request);
  const inForce = isInForce(listTrust);
  return {
    mode: manifest.name,
    modeFolder: folder,
    databaseFile: pathIn(layout, "project", join(".agentbay", "data", `${manifest.name}.db`)),
    migrationsFolder: join(folder, normalized(declared.migrations)),
    readPaths: [folder, ...projectPaths(layout, declared.read), ...writePaths],
    writePaths,
    throwawayPaths: inForce ? projectPaths(layout, declared.throwaway) : [],
    secrets: [...declared.secrets],
    hosts: [...declared.hosts],
    commands: inForce ? declared.commands : [],
    listTrust,
  };
}

export function grantsOf(request: GrantRequest): GrantRuling {
  const problems = [
    ...pathProblems(request),
    ...secretProblems(request.manifest),
    ...hostProblems(request.manifest),
    ...startWordsWithoutCommandsProblems(request),
    ...commandEffectProblems(request),
    ...throwawayOverlapProblems(request),
  ];
  if (problems.length > 0) {
    return { ok: false, problems };
  }
  return { ok: true, value: grantsOfMode(request) };
}
