import { fieldsOf, type Json } from "../../../../../bay/sdk.ts";
import type { Leak, Slice } from "./cards.ts";
import type { HandedTest } from "./handed-tests.ts";
import { listOf, textOf } from "./json-values.ts";

export type Compared = {
  readonly code: readonly HandedTest[];
  readonly tests: readonly string[];
  readonly phrases: readonly string[];
  readonly interface: readonly string[];
  readonly base: readonly HandedTest[];
};

export type SharedText = {
  readonly path: string;
  readonly lines: number;
};

export type Found = {
  readonly shared: readonly SharedText[];
  readonly code: readonly HandedTest[];
  readonly mark: string | undefined;
  readonly answer: Json;
};

const leastCharacters = 40;

const shortestPhrase = 10;

const importLine = /^(import\b|from\s+\S+\s+import\b|export\b.*\bfrom\s*["'`]|\}\s*from\s*["'`])/;

const address = /[a-z][a-z0-9+.-]*:\/\/[^\s"'`<>)]+/gi;

const sentenceEnd = /(?<=[.;:!?])\s+/;

function normalized(line: string): string {
  return line.trim().replace(/\s+/g, " ");
}

function linesOf(text: string): readonly string[] {
  return text.split("\n").map(normalized);
}

function nonSpace(text: string): number {
  return text.replace(/\s/g, "").length;
}

function sentencesOf(says: string): readonly string[] {
  return says.split(sentenceEnd).map((sentence) => normalized(sentence).replace(/[.;:!?]+$/, ""));
}

function scopeStart(pattern: string): string {
  const wild = pattern.search(/[*?[{]/);
  return wild < 0 ? pattern : pattern.slice(0, wild);
}

export function phrasesOf(slice: Slice, paths: readonly string[]): readonly string[] {
  const sentences = slice.done.flatMap((item) => sentencesOf(item.says));
  const phrases = [...sentences, ...slice.scope.map(scopeStart), ...paths].map((phrase) => phrase.toLowerCase());
  return [...new Set(phrases)].filter((phrase) => phrase.length >= shortestPhrase);
}

function withoutPhrases(line: string, phrases: readonly string[]): string {
  const lower = line.toLowerCase().replace(address, " ");
  return phrases.reduce((left, phrase) => left.split(phrase).join(" "), lower);
}

function telling(line: string, phrases: readonly string[]): boolean {
  return !importLine.test(line) && nonSpace(withoutPhrases(line, phrases)) >= leastCharacters;
}

function standingLines(files: readonly HandedTest[]): ReadonlySet<string> {
  return new Set(files.flatMap((file) => linesOf(file.text)));
}

export function sharedText(compared: Compared): readonly SharedText[] {
  const tests = compared.tests.flatMap(linesOf).filter((line) => telling(line, compared.phrases));
  const told = new Set(tests);
  const interfaceLines = standingLines(compared.base.filter((file) => compared.interface.includes(file.path)));
  return compared.code.flatMap((file) => {
    const before = standingLines(compared.base.filter((each) => each.path === file.path));
    const lines = linesOf(file.text).filter((line) => told.has(line));
    const shared = new Set(lines.filter((line) => !interfaceLines.has(line) && !before.has(line)));
    return shared.size === 0 ? [] : [{ path: file.path, lines: shared.size }];
  });
}

function fileLeaks(file: HandedTest, found: Found): readonly Leak[] {
  const shared = found.shared.find((each) => each.path === file.path);
  const text: readonly Leak[] = shared === undefined ? [] : [{ kind: "shared-text", ...shared }];
  const holds = found.mark !== undefined && file.text.includes(found.mark);
  return holds ? [...text, { kind: "mark", path: file.path }] : text;
}

export function leaksFound(found: Found): readonly Leak[] {
  const holds = found.mark !== undefined && JSON.stringify(found.answer).includes(found.mark);
  const answer: readonly Leak[] = holds ? [{ kind: "mark-in-answer" }] : [];
  return [...found.code.flatMap((file) => fileLeaks(file, found)), ...answer];
}

function leakOf(value: Json): Leak {
  const fields = fieldsOf(value);
  const path = textOf(fields.path);
  if (fields.kind === "mark-in-answer") {
    return { kind: "mark-in-answer" };
  }
  if (fields.kind === "mark") {
    return { kind: "mark", path };
  }
  return { kind: "shared-text", path, lines: typeof fields.lines === "number" ? fields.lines : 0 };
}

export function leaksOf(value: Json | undefined): readonly Leak[] {
  return listOf(value).map(leakOf);
}
