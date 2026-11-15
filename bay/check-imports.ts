import { dirname, join, normalize } from "node:path/posix";
import { errors, lineOfIndex, type CheckContext, type Finding, type ModeFolder } from "./check-context.ts";
import type { Problem } from "./spec.ts";

type Specifier =
  | { readonly kind: "literal"; readonly text: string; readonly line: number }
  | { readonly kind: "computed"; readonly line: number };

type SourceFile = {
  readonly file: string;
  readonly specifiers: readonly Specifier[];
};

type LiteralImport = {
  readonly file: string;
  readonly text: string;
  readonly line: number;
};

type Graph = ReadonlyMap<string, readonly string[]>;

const staticImportPattern =
  /(?<![\w$.])(?:import|export)\s+(?:type\s+)?(?:[\w$*{}\s,]+?\s+from\s+)?(["'])([^"'\n]+)\1/g;

const literalDynamicImportPattern = /(?<![\w$.])import\s*\(\s*(["'`])([^"'`\n$]*)\1\s*[,)]/g;

const anyDynamicImportPattern = /(?<![\w$.])import\s*\(/g;

const sdkFile = "bay/sdk.ts";

const entryPoints = ["bay/cli.ts", "bay/mcp.ts"] as const;

function literalSpecifiers(text: string, pattern: RegExp): readonly Specifier[] {
  return [...text.matchAll(pattern)].map((match) => ({
    kind: "literal" as const,
    text: match[2] ?? "",
    line: lineOfIndex(text, match.index),
  }));
}

function computedSpecifiers(text: string): readonly Specifier[] {
  const literalStarts = new Set([...text.matchAll(literalDynamicImportPattern)].map((match) => match.index));
  return [...text.matchAll(anyDynamicImportPattern)]
    .filter((match) => !literalStarts.has(match.index))
    .map((match) => ({ kind: "computed" as const, line: lineOfIndex(text, match.index) }));
}

function importSpecifiers(text: string): readonly Specifier[] {
  return [
    ...literalSpecifiers(text, staticImportPattern),
    ...literalSpecifiers(text, literalDynamicImportPattern),
    ...computedSpecifiers(text),
  ].sort((first, second) => first.line - second.line);
}

async function readSources(context: CheckContext, files: readonly string[]): Promise<readonly SourceFile[]> {
  const sources: SourceFile[] = [];
  for (const file of files) {
    const text = await context.files.readText(file);
    sources.push({ file, specifiers: text === undefined ? [] : importSpecifiers(text) });
  }
  return sources;
}

function literalImports(source: SourceFile): readonly LiteralImport[] {
  return source.specifiers.flatMap((specifier) =>
    specifier.kind === "literal" ? [{ file: source.file, text: specifier.text, line: specifier.line }] : [],
  );
}

function isRelative(specifier: string): boolean {
  return specifier.startsWith("./") || specifier.startsWith("../");
}

function resolved(file: string, specifier: string): string {
  return normalize(join(dirname(file), specifier));
}

function isInside(path: string, folder: string): boolean {
  return path.startsWith(`${folder}/`);
}

function bareImportProblem(mode: ModeFolder, entry: LiteralImport): Problem {
  return {
    file: entry.file,
    path: "",
    line: entry.line,
    message: `${entry.file} imports the package ${entry.text}; mode code has no dependencies in 5.0.0.`,
    fix: `Use ${sdkFile} or a node: built-in instead, or copy what you need into ${mode.folder}.`,
  };
}

function outsideImportProblem(mode: ModeFolder, entry: LiteralImport, target: string): Problem {
  return {
    file: entry.file,
    path: "",
    line: entry.line,
    message:
      `${entry.file} imports ${entry.text}, which resolves to ${target}, outside the mode folder ${mode.folder}; ` +
      `mode code imports only ${sdkFile}, node: built-ins and files of its own mode.`,
    fix: "Call the other mode's actions through an interface, or use what bay/sdk.ts gives.",
  };
}

function modeImportProblem(mode: ModeFolder, entry: LiteralImport): Problem | undefined {
  if (entry.text.startsWith("node:")) {
    return undefined;
  }
  if (entry.text.startsWith("/")) {
    return outsideImportProblem(mode, entry, entry.text);
  }
  if (!isRelative(entry.text)) {
    return bareImportProblem(mode, entry);
  }
  const target = resolved(entry.file, entry.text);
  return target === sdkFile || isInside(target, mode.folder) ? undefined : outsideImportProblem(mode, entry, target);
}

function computedImportProblems(source: SourceFile): readonly Problem[] {
  return source.specifiers
    .filter((specifier) => specifier.kind === "computed")
    .map((specifier) => ({
      file: source.file,
      path: "",
      line: specifier.line,
      message:
        `${source.file} calls import() with a specifier that is not a plain string, ` +
        "which bay check cannot follow.",
      fix: "Use a static import of a file of the mode, bay/sdk.ts or a node: built-in.",
    }));
}

async function modeImportProblems(context: CheckContext, mode: ModeFolder): Promise<readonly Problem[]> {
  const files = mode.files.filter((file) => file.endsWith(".ts")).map((file) => join(mode.folder, file));
  const sources = await readSources(context, files);
  return sources.flatMap((source) => [
    ...literalImports(source).flatMap((entry) => modeImportProblem(mode, entry) ?? []),
    ...computedImportProblems(source),
  ]);
}

function kernelGraph(sources: readonly SourceFile[]): Graph {
  const known = new Set(sources.map((source) => source.file));
  return new Map(
    sources.map((source) => {
      const targets = literalImports(source)
        .filter((entry) => isRelative(entry.text))
        .map((entry) => resolved(entry.file, entry.text))
        .filter((target) => known.has(target));
      return [source.file, [...new Set(targets)]];
    }),
  );
}

function rotatedToSmallest(cycle: readonly string[]): readonly string[] {
  const nodes = cycle.slice(0, -1);
  const smallest = [...nodes].sort()[0] ?? "";
  const start = nodes.indexOf(smallest);
  const rotated = [...nodes.slice(start), ...nodes.slice(0, start)];
  return [...rotated, smallest];
}

function cyclesOf(graph: Graph): readonly (readonly string[])[] {
  const cycles = new Map<string, readonly string[]>();
  const finished = new Set<string>();
  const visit = (node: string, path: readonly string[]): void => {
    const start = path.indexOf(node);
    if (start >= 0) {
      const cycle = rotatedToSmallest([...path.slice(start), node]);
      cycles.set(cycle.join(" "), cycle);
      return;
    }
    if (finished.has(node)) {
      return;
    }
    for (const next of graph.get(node) ?? []) {
      visit(next, [...path, node]);
    }
    finished.add(node);
  };
  for (const node of [...graph.keys()].sort()) {
    visit(node, []);
  }
  return [...cycles.values()];
}

function cycleProblems(graph: Graph): readonly Problem[] {
  return cyclesOf(graph).map((cycle) => ({
    file: cycle[0] ?? "",
    path: "",
    message: `Kernel files import each other in a cycle: ${cycle.join(" -> ")}.`,
    fix: "Move what the files share into a file of its own, so that no file imports itself through others.",
  }));
}

function isEntryPoint(file: string): boolean {
  return entryPoints.some((entryPoint) => entryPoint === file);
}

function entryPointImportProblem(entry: LiteralImport): Problem | undefined {
  if (isEntryPoint(entry.file) || !isRelative(entry.text)) {
    return undefined;
  }
  const target = resolved(entry.file, entry.text);
  if (!isEntryPoint(target) && !target.startsWith("adapters/")) {
    return undefined;
  }
  return {
    file: entry.file,
    path: "",
    line: entry.line,
    message: `${entry.file} imports ${target}; the kernel core never imports cli.ts, mcp.ts or an adapter.`,
    fix: "Turn the dependency around: let cli.ts, mcp.ts or the adapter import the kernel instead.",
  };
}

async function kernelImportProblems(context: CheckContext): Promise<readonly Problem[]> {
  const files = context.paths.filter((path) => path.startsWith("bay/") && path.endsWith(".ts"));
  const sources = await readSources(context, files);
  const boundary = sources.flatMap((source) =>
    literalImports(source).flatMap((entry) => entryPointImportProblem(entry) ?? []),
  );
  return [...cycleProblems(kernelGraph(sources)), ...boundary];
}

export async function checkImports(context: CheckContext): Promise<readonly Finding[]> {
  const problems: Problem[] = [];
  for (const mode of context.modes) {
    problems.push(...(await modeImportProblems(context, mode)));
  }
  problems.push(...(await kernelImportProblems(context)));
  return errors(problems);
}
