import { isMap, isScalar, LineCounter, parseDocument, type Pair } from "yaml";
import { errors, warnings, type CheckContext, type Finding } from "./check-context.ts";
import type { Problem } from "./spec.ts";

const measures = ["kernel_lines", "adapter_lines", "concepts", "cli_commands", "top_level_folders"] as const;

type Measure = (typeof measures)[number];

type Counter = (context: CheckContext) => Promise<number>;

type Ceiling = {
  readonly measure: Measure;
  readonly ceiling: number;
  readonly line: number;
};

type Ceilings =
  | { readonly ok: true; readonly ceilings: readonly Ceiling[] }
  | { readonly ok: false; readonly problems: readonly Problem[] };

const limitsFile = "framework/limits.yaml";

const measureList = measures.join(", ");

async function linesOf(context: CheckContext, files: readonly string[]): Promise<number> {
  let total = 0;
  for (const file of files) {
    const text = (await context.files.readText(file)) ?? "";
    total += text.split("\n").length - (text.endsWith("\n") ? 1 : 0);
  }
  return total;
}

function typeScriptFilesUnder(context: CheckContext, folder: string): readonly string[] {
  return context.paths.filter((path) => path.startsWith(folder) && path.endsWith(".ts"));
}

async function kernelLines(context: CheckContext): Promise<number> {
  const files = typeScriptFilesUnder(context, "bay/").filter((path) => !path.startsWith("bay/generated/"));
  return linesOf(context, files);
}

async function largestAdapterLines(context: CheckContext): Promise<number> {
  const adapters = new Set(typeScriptFilesUnder(context, "adapters/").map((path) => path.split("/")[1] ?? ""));
  let largest = 0;
  for (const adapter of adapters) {
    const code = typeScriptFilesUnder(context, `adapters/${adapter}/`).filter((path) => !path.includes("/tests/"));
    largest = Math.max(largest, await linesOf(context, code));
  }
  return largest;
}

function conceptCount(context: CheckContext): Promise<number> {
  return Promise.resolve(context.paths.filter((path) => /^schemas\/[^/]+\.schema\.json$/.test(path)).length);
}

function topLevelFolderCount(context: CheckContext): Promise<number> {
  const folders = context.paths.filter((path) => path.includes("/")).map((path) => path.split("/")[0]);
  return Promise.resolve(new Set(folders).size);
}

const counters: { readonly [Name in Measure]?: Counter } = {
  kernel_lines: kernelLines,
  adapter_lines: largestAdapterLines,
  concepts: conceptCount,
  top_level_folders: topLevelFolderCount,
};

function limitsProblem(line: number | undefined, message: string, fix: string): Problem {
  return { file: limitsFile, path: "", ...(line === undefined ? {} : { line }), message, fix };
}

function isMeasure(name: string): name is Measure {
  return measures.some((measure) => measure === name);
}

function ceilingOf(pair: Pair, lineOf: (offset: number) => number): Ceiling | Problem {
  const key = isScalar(pair.key) ? String(pair.key.value) : "";
  const line = isScalar(pair.key) && pair.key.range ? lineOf(pair.key.range[0]) : 1;
  const value = isScalar(pair.value) ? pair.value.value : undefined;
  if (!isMeasure(key)) {
    return limitsProblem(
      line,
      `${limitsFile} names ${key}, which is not a measure.`,
      `The measures are ${measureList}.`,
    );
  }
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    return limitsProblem(line, `The ceiling of ${key} must be a whole number of 0 or more.`, `Set ${key} to one.`);
  }
  return { measure: key, ceiling: value, line };
}

function isCeiling(entry: Ceiling | Problem): entry is Ceiling {
  return "measure" in entry;
}

function isProblem(entry: Ceiling | Problem): entry is Problem {
  return !isCeiling(entry);
}

function missingProblems(ceilings: readonly Ceiling[]): readonly Problem[] {
  const missing = measures.filter((measure) => !ceilings.some((entry) => entry.measure === measure));
  return missing.map((measure) =>
    limitsProblem(undefined, `${limitsFile} gives no ceiling for ${measure}.`, `Add ${measure}: <ceiling>.`),
  );
}

function parseCeilings(text: string): Ceilings {
  const lineCounter = new LineCounter();
  const document = parseDocument(text, { lineCounter, prettyErrors: false });
  const lineOf = (offset: number): number => lineCounter.linePos(offset).line;
  const syntax = document.errors.map((error) =>
    limitsProblem(lineOf(error.pos[0]), `The YAML cannot be read: ${error.message}.`, "Correct the YAML syntax."),
  );
  if (syntax.length > 0) {
    return { ok: false, problems: syntax };
  }
  if (!isMap(document.contents)) {
    const message = `${limitsFile} is not a mapping of measure to ceiling.`;
    return { ok: false, problems: [limitsProblem(1, message, `Write one line per measure: ${measureList}.`)] };
  }
  const entries = document.contents.items.map((pair) => ceilingOf(pair, lineOf));
  const ceilings = entries.filter(isCeiling);
  const problems = [...entries.filter(isProblem), ...missingProblems(ceilings)];
  return problems.length > 0 ? { ok: false, problems } : { ok: true, ceilings };
}

async function overCeiling(context: CheckContext, entry: Ceiling): Promise<readonly Problem[]> {
  const counter = counters[entry.measure];
  const count = counter === undefined ? 0 : await counter(context);
  if (count <= entry.ceiling) {
    return [];
  }
  const message = `${entry.measure} is ${String(count)}, over its ceiling of ${String(entry.ceiling)}.`;
  const fix =
    "Review whether the growth is needed. A line budget never outranks readability: " +
    "being over is a signal for review, not a failure.";
  return [limitsProblem(entry.line, message, fix)];
}

export async function checkLimits(context: CheckContext): Promise<readonly Finding[]> {
  const text = await context.files.readText(limitsFile);
  if (text === undefined) {
    const fix = `Create it with a ceiling for each of ${measureList}.`;
    return errors([limitsProblem(undefined, `${limitsFile} does not exist.`, fix)]);
  }
  const parsed = parseCeilings(text);
  if (!parsed.ok) {
    return errors(parsed.problems);
  }
  const problems: Problem[] = [];
  for (const entry of parsed.ceilings) {
    problems.push(...(await overCeiling(context, entry)));
  }
  return warnings(problems);
}
