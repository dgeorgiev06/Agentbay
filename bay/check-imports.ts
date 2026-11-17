import { dirname, join, normalize, relative } from "node:path/posix";
import {
  errors,
  isLoaded,
  type CheckContext,
  type Finding,
  type KitTree,
  type LoadedModeFolder,
  type ModeFolder,
} from "./check-context.ts";
import { type Binds, importSpecifiers, type ImportSpecifier } from "./import-scanner.ts";
import { isInsideOrEqual, pathIn, shownPath, type Layout } from "./layout.ts";
import type { FileSystem } from "./ports.ts";
import { sdkSpecifier } from "./protocol-json.ts";
import type { Problem } from "./outcome.ts";

type SourceFile = {
  readonly file: string;
  readonly specifiers: readonly ImportSpecifier[];
};

type LiteralImport = {
  readonly file: string;
  readonly text: string;
  readonly line: number;
  readonly binds: Binds;
};

type Graph = ReadonlyMap<string, readonly string[]>;

type ModeImport = {
  readonly layout: Layout;
  readonly mode: ModeFolder;
  readonly sharedTests: readonly string[];
  readonly entry: LiteralImport;
};

const sdkFile = "bay/sdk.ts";

const testToolboxFile = "tests/test-toolbox.ts";

export const sharedTestFile = "tests/shared.ts";

const entryPoints = ["bay/cli.ts", "bay/mcp.ts"] as const;

async function readSources(files: FileSystem, paths: readonly string[]): Promise<readonly SourceFile[]> {
  const sources: SourceFile[] = [];
  for (const file of paths) {
    const text = await files.readText(file);
    sources.push({ file, specifiers: text === undefined ? [] : importSpecifiers(text) });
  }
  return sources;
}

function literalImports(source: SourceFile): readonly LiteralImport[] {
  return source.specifiers.flatMap((specifier) =>
    specifier.kind === "literal" ? [{ ...specifier, file: source.file }] : [],
  );
}

function isRelative(specifier: string): boolean {
  return specifier.startsWith("./") || specifier.startsWith("../");
}

function resolved(file: string, specifier: string): string {
  return normalize(join(dirname(file), specifier));
}

function sdkWords(layout: Layout): string {
  return `${sdkSpecifier} (or, in a mode of the kit, a relative import of ${shownPath(layout, sdkFileOf(layout))})`;
}

function sdkFileOf(layout: Layout): string {
  return pathIn(layout, "kit", sdkFile);
}

function bareImportProblem(found: ModeImport): Problem {
  const { layout, mode, entry } = found;
  const file = shownPath(layout, entry.file);
  return {
    file: entry.file,
    path: "",
    line: entry.line,
    message: `${file} imports the package ${entry.text}; mode code has no dependencies in 5.0.0.`,
    fix: `Use ${sdkWords(layout)} or a node: built-in instead, or copy what you need into ${mode.label}.`,
  };
}

function outsideImportProblem(found: ModeImport, target: string): Problem {
  const { layout, mode, entry } = found;
  return {
    file: entry.file,
    path: "",
    line: entry.line,
    message:
      `${shownPath(layout, entry.file)} imports ${entry.text}, which resolves to ${shownPath(layout, target)}, ` +
      `outside the mode folder ${mode.label}; mode code imports only ${sdkWords(layout)}, node: built-ins ` +
      "and files of its own mode.",
    fix: `Call the other mode's actions through an interface, or use what ${sdkSpecifier} gives.`,
  };
}

function modeImportProblem(found: ModeImport): Problem | undefined {
  const { layout, mode, entry } = found;
  if (entry.text.startsWith("node:") || entry.text === sdkSpecifier) {
    return undefined;
  }
  if (entry.text.startsWith("/")) {
    return outsideImportProblem(found, entry.text);
  }
  if (!isRelative(entry.text)) {
    return bareImportProblem(found);
  }
  const target = resolved(entry.file, entry.text);
  const isKitSdk = mode.home === "kit" && target === sdkFileOf(layout);
  return isKitSdk || isInsideOrEqual(target, mode.folder) || isKitTestFile(found, target)
    ? undefined
    : outsideImportProblem(found, target);
}

function isModeTest(mode: ModeFolder, file: string): boolean {
  return isInsideOrEqual(file, join(mode.folder, "tests"));
}

function isKitTestFile(found: ModeImport, target: string): boolean {
  const { layout, mode, sharedTests, entry } = found;
  const kitTestFiles = [pathIn(layout, "kit", testToolboxFile), ...sharedTests];
  return isModeTest(mode, entry.file) && kitTestFiles.includes(target);
}

function sharedTestOf(context: CheckContext, reference: string): string {
  const [name = ""] = reference.split("@");
  return pathIn(context.layout, "kit", join(context.kit.layout.interfaces, name, sharedTestFile));
}

function implementedReferences(mode: ModeFolder): readonly string[] {
  return isLoaded(mode) ? (mode.manifest.implements ?? []) : [];
}

async function existingSharedTests(context: CheckContext, mode: ModeFolder): Promise<ReadonlyMap<string, string>> {
  const found = new Map<string, string>();
  for (const reference of implementedReferences(mode)) {
    const file = sharedTestOf(context, reference);
    if (await context.files.exists(file)) {
      found.set(reference, file);
    }
  }
  return found;
}

function computedImportProblems(layout: Layout, source: SourceFile): readonly Problem[] {
  return source.specifiers
    .filter((specifier) => specifier.kind === "computed")
    .map((specifier) => ({
      file: source.file,
      path: "",
      line: specifier.line,
      message:
        `${shownPath(layout, source.file)} calls import() with a specifier that is not a plain string, ` +
        "which bay check cannot follow.",
      fix: `Use a static import of a file of the mode, ${sdkSpecifier} or a node: built-in.`,
    }));
}

type SharedTestsOfMode = {
  readonly layout: Layout;
  readonly mode: LoadedModeFolder;
  readonly sharedTests: ReadonlyMap<string, string>;
};

function filesTestsTakeValuesFrom(mode: ModeFolder, sources: readonly SourceFile[]): ReadonlySet<string> {
  const imports = sources.filter((source) => isModeTest(mode, source.file)).flatMap(literalImports);
  const valueImports = imports.filter((entry) => entry.binds === "values" && isRelative(entry.text));
  return new Set(valueImports.map((entry) => resolved(entry.file, entry.text)));
}

function unrunSharedTestProblems(found: SharedTestsOfMode, sources: readonly SourceFile[]): readonly Problem[] {
  const { layout, mode, sharedTests } = found;
  const run = filesTestsTakeValuesFrom(mode, sources);
  const references = mode.manifest.implements ?? [];
  const name = mode.manifest.name;
  return [...sharedTests]
    .filter(([, file]) => !run.has(file))
    .map(([reference, file]) =>
      mode.at(["implements", references.indexOf(reference)], {
        message:
          `Mode ${name} implements ${reference}, whose shared test ${shownPath(layout, file)} no test of the ` +
          "mode runs, so nothing shows that the mode does what the interface means.",
        fix:
          `Add a test file under ${mode.label}/tests/ that imports the function ` +
          `${relative(join(mode.folder, "tests"), file)} exports and calls it with { mode: "${name}" }. ` +
          "An import of its types alone, or of the file for its side effects, runs nothing.",
      }),
    );
}

async function modeImportProblems(context: CheckContext, mode: ModeFolder): Promise<readonly Problem[]> {
  const { layout } = context;
  const paths = mode.files.filter((file) => file.endsWith(".ts")).map((file) => join(mode.folder, file));
  const sources = await readSources(context.files, paths);
  const sharedTests = await existingSharedTests(context, mode);
  const allowed = [...sharedTests.values()];
  return [
    ...sources.flatMap((source) => [
      ...literalImports(source).flatMap(
        (entry) => modeImportProblem({ layout, mode, sharedTests: allowed, entry }) ?? [],
      ),
      ...computedImportProblems(layout, source),
    ]),
    ...(isLoaded(mode) ? unrunSharedTestProblems({ layout, mode, sharedTests }, sources) : []),
  ];
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

async function kernelImportProblems(kit: KitTree): Promise<readonly Problem[]> {
  const files = kit.paths.filter((path) => path.startsWith("bay/") && path.endsWith(".ts"));
  const sources = await readSources(kit.files, files);
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
  return errors(problems);
}

export async function checkKernelImports(kit: KitTree): Promise<readonly Finding[]> {
  return errors(await kernelImportProblems(kit));
}
