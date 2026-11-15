import { isMap, isScalar, LineCounter, parseDocument, type Document, type Pair } from "yaml";
import { errors, warnings, type CheckContext, type Finding } from "./check-context.ts";
import type { Problem } from "./spec.ts";

type Range = {
  readonly start: number;
  readonly end: number;
};

type Lexer = {
  readonly text: string;
  readonly ranges: Range[];
  readonly templates: number[];
  index: number;
  braces: number;
  regexAllowed: boolean;
};

type Measure = "kernel_lines" | "adapter_lines" | "concepts" | "cli_commands" | "top_level_folders" | "comment_lines";

type Ceilings = {
  readonly values: ReadonlyMap<Measure, number>;
  readonly lineOf: (measure: string) => number | undefined;
};

type CeilingsOutcome =
  { readonly ok: true; readonly ceilings: Ceilings } | { readonly ok: false; readonly problems: readonly Problem[] };

type CeilingEntry = {
  readonly key: string;
  readonly line: number | undefined;
  readonly value: unknown;
};

type Texts = ReadonlyMap<string, string>;

type FileComments = {
  readonly file: string;
  readonly lines: readonly number[];
};

const limitsFile = "framework/limits.yaml";

const measures: readonly Measure[] = [
  "kernel_lines",
  "adapter_lines",
  "concepts",
  "cli_commands",
  "top_level_folders",
  "comment_lines",
];

const commentPlaces = ["bay/", "adapters/", "components/"] as const;

const regexKeywords = new Set([
  "return",
  "typeof",
  "instanceof",
  "in",
  "of",
  "new",
  "delete",
  "void",
  "throw",
  "case",
  "do",
  "else",
  "yield",
  "await",
]);

const identifierPattern = /[\w$]/;

function character(lexer: Lexer, offset = 0): string {
  return lexer.text[lexer.index + offset] ?? "";
}

function endOfLine(lexer: Lexer): number {
  const newline = lexer.text.indexOf("\n", lexer.index);
  return newline < 0 ? lexer.text.length : newline;
}

function skipLineComment(lexer: Lexer): void {
  const end = endOfLine(lexer);
  lexer.ranges.push({ start: lexer.index, end });
  lexer.index = end;
}

function skipBlockComment(lexer: Lexer): void {
  const close = lexer.text.indexOf("*/", lexer.index + 2);
  const end = close < 0 ? lexer.text.length : close + 2;
  lexer.ranges.push({ start: lexer.index, end });
  lexer.index = end;
}

function skipQuoted(lexer: Lexer, quote: string): void {
  lexer.index += 1;
  while (lexer.index < lexer.text.length && character(lexer) !== quote && character(lexer) !== "\n") {
    lexer.index += character(lexer) === "\\" ? 2 : 1;
  }
  lexer.index += 1;
  lexer.regexAllowed = false;
}

function skipTemplateText(lexer: Lexer): void {
  while (lexer.index < lexer.text.length) {
    const current = character(lexer);
    if (current === "\\") {
      lexer.index += 2;
    } else if (current === "`") {
      lexer.index += 1;
      lexer.regexAllowed = false;
      return;
    } else if (current === "$" && character(lexer, 1) === "{") {
      lexer.templates.push(lexer.braces);
      lexer.index += 2;
      lexer.regexAllowed = true;
      return;
    } else {
      lexer.index += 1;
    }
  }
}

function skipRegex(lexer: Lexer): void {
  let inClass = false;
  lexer.index += 1;
  while (lexer.index < lexer.text.length && character(lexer) !== "\n") {
    const current = character(lexer);
    if (current === "\\") {
      lexer.index += 2;
      continue;
    }
    lexer.index += 1;
    if (current === "/" && !inClass) {
      break;
    }
    inClass = (inClass || current === "[") && current !== "]";
  }
  while (identifierPattern.test(character(lexer))) {
    lexer.index += 1;
  }
  lexer.regexAllowed = false;
}

function skipWord(lexer: Lexer): void {
  const start = lexer.index;
  while (identifierPattern.test(character(lexer))) {
    lexer.index += 1;
  }
  lexer.regexAllowed = regexKeywords.has(lexer.text.slice(start, lexer.index));
}

function closeBrace(lexer: Lexer): void {
  if (lexer.templates.at(-1) === lexer.braces) {
    lexer.templates.pop();
    lexer.index += 1;
    skipTemplateText(lexer);
    return;
  }
  lexer.braces -= 1;
  lexer.index += 1;
  lexer.regexAllowed = false;
}

function punctuation(lexer: Lexer, current: string): void {
  if (current === "{") {
    lexer.braces += 1;
  }
  if (current.trim() !== "") {
    lexer.regexAllowed = current !== ")" && current !== "]";
  }
  lexer.index += 1;
}

function advance(lexer: Lexer): void {
  const current = character(lexer);
  const pair = `${current}${character(lexer, 1)}`;
  if (pair === "//") {
    skipLineComment(lexer);
  } else if (pair === "/*") {
    skipBlockComment(lexer);
  } else if (current === '"' || current === "'") {
    skipQuoted(lexer, current);
  } else if (current === "`") {
    lexer.index += 1;
    skipTemplateText(lexer);
  } else if (current === "/" && lexer.regexAllowed) {
    skipRegex(lexer);
  } else if (current === "}") {
    closeBrace(lexer);
  } else if (identifierPattern.test(current)) {
    skipWord(lexer);
  } else {
    punctuation(lexer, current);
  }
}

function commentRanges(text: string): readonly Range[] {
  const start = text.startsWith("#!") ? Math.max(text.indexOf("\n"), 0) : 0;
  const lexer: Lexer = { text, ranges: [], templates: [], index: start, braces: 0, regexAllowed: true };
  while (lexer.index < text.length) {
    advance(lexer);
  }
  return lexer.ranges;
}

export function commentLineNumbers(text: string): readonly number[] {
  const lines = new Set<number>();
  for (const range of commentRanges(text)) {
    const first = text.slice(0, range.start).split("\n").length;
    const last = text.slice(0, Math.max(range.end - 1, range.start)).split("\n").length;
    for (let line = first; line <= last; line += 1) {
      lines.add(line);
    }
  }
  return [...lines].sort((first, second) => first - second);
}

function lineCount(text: string): number {
  if (text === "") {
    return 0;
  }
  const lines = text.split("\n").length;
  return text.endsWith("\n") ? lines - 1 : lines;
}

function isMeasure(name: string): name is Measure {
  return measures.some((measure) => measure === name);
}

function limitsProblem(line: number | undefined, message: string, fix: string): Problem {
  return { file: limitsFile, path: "", ...(line === undefined ? {} : { line }), message, fix };
}

function readEntry(pair: Pair, lineOf: (offset: number) => number): CeilingEntry {
  const key = isScalar(pair.key) ? String(pair.key.value) : "";
  const line = isScalar(pair.key) && pair.key.range ? lineOf(pair.key.range[0]) : undefined;
  const value = isScalar(pair.value) ? pair.value.value : undefined;
  return { key, line, value };
}

function ceilingEntries(document: Document, lineOf: (offset: number) => number): CeilingsOutcome {
  const contents = document.contents;
  if (!isMap(contents)) {
    const fix = `Write one measure: ceiling line for each of ${measures.join(", ")}.`;
    return { ok: false, problems: [limitsProblem(1, `${limitsFile} is not a mapping of measure to ceiling.`, fix)] };
  }
  const values = new Map<Measure, number>();
  const lines = new Map<string, number>();
  const problems: Problem[] = [];
  for (const pair of contents.items) {
    const { key, line, value } = readEntry(pair, lineOf);
    if (line !== undefined) {
      lines.set(key, line);
    }
    problems.push(...ceilingEntryProblems(key, value, line));
    if (isMeasure(key) && typeof value === "number") {
      values.set(key, value);
    }
  }
  problems.push(...missingMeasureProblems(values));
  if (problems.length > 0) {
    return { ok: false, problems };
  }
  return { ok: true, ceilings: { values, lineOf: (measure) => lines.get(measure) } };
}

function ceilingEntryProblems(key: string, value: unknown, line: number | undefined): readonly Problem[] {
  if (!isMeasure(key)) {
    return [
      limitsProblem(
        line,
        `${limitsFile} names ${key}, which is not a measure.`,
        `Remove it; the measures are ${measures.join(", ")}.`,
      ),
    ];
  }
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    return [
      limitsProblem(
        line,
        `The ceiling of ${key} must be a whole number of 0 or more.`,
        `Set ${key} to a whole number.`,
      ),
    ];
  }
  return [];
}

function missingMeasureProblems(values: ReadonlyMap<Measure, number>): readonly Problem[] {
  return measures
    .filter((measure) => !values.has(measure))
    .map((measure) =>
      limitsProblem(undefined, `${limitsFile} gives no ceiling for ${measure}.`, `Add ${measure}: <ceiling>.`),
    );
}

function parseCeilings(text: string): CeilingsOutcome {
  const lineCounter = new LineCounter();
  const document = parseDocument(text, { lineCounter, prettyErrors: false });
  const lineOf = (offset: number): number => lineCounter.linePos(offset).line;
  if (document.errors.length > 0) {
    const problems = document.errors.map((error) =>
      limitsProblem(lineOf(error.pos[0]), `The YAML cannot be read: ${error.message}.`, "Correct the YAML syntax."),
    );
    return { ok: false, problems };
  }
  return ceilingEntries(document, lineOf);
}

async function readCeilings(context: CheckContext): Promise<CeilingsOutcome> {
  const text = await context.files.readText(limitsFile);
  if (text === undefined) {
    const fix = `Create it with one measure: ceiling line for each of ${measures.join(", ")}.`;
    return { ok: false, problems: [limitsProblem(undefined, `${limitsFile} does not exist.`, fix)] };
  }
  return parseCeilings(text);
}

async function readTexts(context: CheckContext, files: readonly string[]): Promise<Texts> {
  const texts = new Map<string, string>();
  for (const file of files) {
    texts.set(file, (await context.files.readText(file)) ?? "");
  }
  return texts;
}

function linesIn(texts: Texts, files: readonly string[]): number {
  return files.reduce((total, file) => total + lineCount(texts.get(file) ?? ""), 0);
}

function kernelFiles(paths: readonly string[]): readonly string[] {
  return paths.filter((path) => path.startsWith("bay/") && !path.startsWith("bay/generated/") && path.endsWith(".ts"));
}

function adapterLines(texts: Texts, paths: readonly string[]): number {
  const adapterFiles = paths.filter((path) => path.startsWith("adapters/") && path.endsWith(".ts"));
  const adapters = new Set(adapterFiles.map((path) => path.split("/")[1] ?? ""));
  const counts = [...adapters].map((adapter) =>
    linesIn(
      texts,
      adapterFiles.filter((path) => path.startsWith(`adapters/${adapter}/`)),
    ),
  );
  return Math.max(0, ...counts);
}

function conceptCount(paths: readonly string[]): number {
  return paths.filter((path) => /^schemas\/[^/]+\.schema\.json$/.test(path)).length;
}

function topLevelFolderCount(paths: readonly string[]): number {
  return new Set(paths.filter((path) => path.includes("/")).map((path) => path.split("/")[0])).size;
}

function commentFiles(texts: Texts): readonly FileComments[] {
  return [...texts]
    .map(([file, text]) => ({ file, lines: commentLineNumbers(text) }))
    .filter((entry) => entry.lines.length > 0);
}

function measured(texts: Texts, paths: readonly string[]): ReadonlyMap<Measure, number> {
  const comments = commentFiles(texts).reduce((total, entry) => total + entry.lines.length, 0);
  return new Map<Measure, number>([
    ["kernel_lines", linesIn(texts, kernelFiles(paths))],
    ["adapter_lines", adapterLines(texts, paths)],
    ["concepts", conceptCount(paths)],
    ["top_level_folders", topLevelFolderCount(paths)],
    ["comment_lines", comments],
  ]);
}

function overCeilingWarnings(counts: ReadonlyMap<Measure, number>, ceilings: Ceilings): readonly Problem[] {
  return measures.flatMap((measure) => {
    const count = counts.get(measure);
    const ceiling = ceilings.values.get(measure);
    if (measure === "comment_lines" || count === undefined || ceiling === undefined || count <= ceiling) {
      return [];
    }
    return [
      limitsProblem(
        ceilings.lineOf(measure),
        `${measure} is ${String(count)}, over its ceiling of ${String(ceiling)}.`,
        "Review whether the growth is needed. A line budget never outranks readability: " +
          "being over is a signal for review, not a failure.",
      ),
    ];
  });
}

function commentErrors(texts: Texts, ceilings: Ceilings): readonly Problem[] {
  const files = commentFiles(texts);
  const total = files.reduce((sum, entry) => sum + entry.lines.length, 0);
  const ceiling = ceilings.values.get("comment_lines") ?? 0;
  if (total <= ceiling) {
    return [];
  }
  return files.map((entry) => ({
    file: entry.file,
    path: "",
    line: entry.lines[0] ?? 1,
    message:
      `${entry.file} has comment lines at ${entry.lines.join(", ")}; comment_lines is ${String(total)} ` +
      `in all, over its ceiling of ${String(ceiling)}.`,
    fix: "Remove the comments; say it with names, types and tests instead.",
  }));
}

export async function checkLimits(context: CheckContext): Promise<readonly Finding[]> {
  const outcome = await readCeilings(context);
  if (!outcome.ok) {
    return errors(outcome.problems);
  }
  const textFiles = context.paths.filter(
    (path) => path.endsWith(".ts") && commentPlaces.some((place) => path.startsWith(place)),
  );
  const texts = await readTexts(context, textFiles);
  const counts = measured(texts, context.paths);
  return [
    ...warnings(overCeilingWarnings(counts, outcome.ceilings)),
    ...errors(commentErrors(texts, outcome.ceilings)),
  ];
}
