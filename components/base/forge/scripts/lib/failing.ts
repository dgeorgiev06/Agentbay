import { fieldsOf, type Json } from "../../../../../bay/sdk.ts";
import type { Slice } from "./cards.ts";
import type { HandedTest } from "./handed-tests.ts";
import { quotesAny } from "./quoting.ts";
import { listOf, textOf } from "./json-values.ts";

export type FailingCase = {
  readonly name: string;
  readonly file?: string;
  readonly message?: string;
};

export type Failing = {
  readonly items: readonly string[];
  readonly cases: readonly FailingCase[];
  readonly withheld: number;
  readonly notListed: number;
  readonly notLoaded: readonly string[];
};

type Reported = {
  readonly name: string;
  readonly file: string;
  readonly message: string;
};

type Told = {
  readonly told: FailingCase;
  readonly withheld: boolean;
};

const longestName = 200;

const unsafe = /[\p{Cc}\p{Cf}]/gu;

function plain(text: string): string {
  return Array.from(text.replace(unsafe, " ")).slice(0, longestName).join("").trim();
}

function namedFile(file: string, paths: readonly string[]): string | undefined {
  return paths.find((path) => file === path || file.endsWith(`/${path}`));
}

function isMustFailure(slice: Slice, verdict: Json): boolean {
  const fields = fieldsOf(verdict);
  const item = slice.done.find((each) => each.id === fields.item);
  return fields.verdict === "failed" && (item === undefined || item.level === "must");
}

function reportedOf(value: Json): Reported {
  const fields = fieldsOf(value);
  return { name: textOf(fields.name), file: textOf(fields.file), message: textOf(fields.message) };
}

function onceEach(reported: readonly Reported[]): readonly Reported[] {
  const keys = reported.map((each) => JSON.stringify([each.name, each.file]));
  return reported.filter((_, at) => keys.indexOf(keys[at] ?? "") === at);
}

function toldOf(reported: Reported, tests: readonly HandedTest[]): Told {
  const name = plain(reported.name);
  const file = namedFile(
    reported.file,
    tests.map((test) => test.path),
  );
  const named = file === undefined ? { name } : { name, file };
  const message = plain(reported.message);
  if (message === "") {
    return { told: named, withheld: false };
  }
  const texts = tests.map((test) => test.text);
  const quoting = quotesAny(reported.message, texts) || quotesAny(message, texts);
  return quoting ? { told: named, withheld: true } : { told: { ...named, message }, withheld: false };
}

function notLoadedOf(cases: readonly Json[], tests: readonly HandedTest[]): readonly string[] {
  const paths = tests.map((test) => test.path);
  const files = cases.flatMap((each) => listOf(fieldsOf(each).notLoaded).map(textOf));
  const named = files.flatMap((file) => namedFile(file, paths) ?? []);
  return [...new Set(named)];
}

function notListedOf(cases: readonly Json[]): number {
  const counts = cases.map((each) => fieldsOf(each).failuresNotListed);
  return counts.reduce<number>((sum, count) => sum + (typeof count === "number" ? count : 0), 0);
}

export function failingOf(slice: Slice, verdicts: readonly Json[], tests: readonly HandedTest[]): Failing {
  const failed = verdicts.filter((verdict) => isMustFailure(slice, verdict));
  const cases = failed.flatMap((verdict) => fieldsOf(verdict).cases ?? []);
  const reported = onceEach(cases.flatMap((each) => listOf(fieldsOf(each).failures).map(reportedOf)));
  const told = reported.map((each) => toldOf(each, tests));
  return {
    items: failed.map((verdict) => textOf(fieldsOf(verdict).item)),
    cases: told.map((each) => each.told),
    withheld: told.filter((each) => each.withheld).length,
    notListed: notListedOf(cases),
    notLoaded: notLoadedOf(cases, tests),
  };
}

export function withoutCases(verdicts: readonly Json[]): readonly Json[] {
  return verdicts.map((verdict) =>
    Object.fromEntries(Object.entries(fieldsOf(verdict)).filter(([field]) => field !== "cases")),
  );
}
