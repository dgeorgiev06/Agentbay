import { fieldsOf, type Json, type JsonFields } from "../../../../../bay/sdk.ts";
import type { Slice } from "./slice-form.ts";
import type { HandedTest } from "./handed-tests.ts";
import { mayQuoteAny, quotedPlaces } from "./quoting.ts";
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

const keptReason = "Proof's reason is kept from the card: it quotes a test.";

const unsafe = /[\p{Cc}\p{Cf}]/gu;

const withheldMark = "…";

const withheldStretch = /…+/g;

const holdsWords = /[\p{L}\p{N}]/u;

const wordlessSaid =
  "The first line of the test runner's message for this case holds no letter or digit, and forge hands on no other line of it.";

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

function messageQuotes(message: string, texts: readonly string[]): boolean {
  return mayQuoteAny(message, texts) || mayQuoteAny(plain(message), texts);
}

type Shown = {
  readonly message?: string;
  readonly withheld: boolean;
};

function shownMessage(reported: string, texts: readonly string[]): Shown {
  if (plain(reported) === "") {
    return { withheld: false };
  }
  if (texts.length === 0) {
    return { withheld: true };
  }
  const cleaned = reported.replace(unsafe, " ");
  const quoted = quotedPlaces([reported, cleaned], texts);
  const marked = Array.from(cleaned).map((character, at) => (quoted.has(at) ? withheldMark : character));
  const kept = plain(marked.join("").replace(withheldStretch, withheldMark));
  const withheld = quoted.size > 0;
  if (holdsWords.test(kept)) {
    return { message: kept, withheld };
  }
  return withheld ? { withheld } : { message: wordlessSaid, withheld };
}

function toldOf(reported: Reported, tests: readonly HandedTest[]): Told {
  const name = plain(reported.name);
  const file = namedFile(
    reported.file,
    tests.map((test) => test.path),
  );
  const named = file === undefined ? { name } : { name, file };
  const { message, withheld } = shownMessage(
    reported.message,
    tests.map((test) => test.text),
  );
  return { told: message === undefined ? named : { ...named, message }, withheld };
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

function saidSafely(fields: JsonFields, texts: readonly string[]): JsonFields {
  const said = (key: "detail" | "reason"): JsonFields => {
    const text = fields[key];
    return typeof text === "string" && mayQuoteAny(text, texts) ? { [key]: keptReason } : {};
  };
  return { ...fields, ...said("detail"), ...said("reason") };
}

function filteredFailure(value: Json, texts: readonly string[]): Json {
  const fields = fieldsOf(value);
  return messageQuotes(textOf(fields.message), texts) ? { ...fields, message: "", charactersCut: 0 } : fields;
}

function filteredCases(value: Json, texts: readonly string[]): Json {
  const fields = fieldsOf(value);
  if (fields.failures === undefined) {
    return fields;
  }
  return { ...fields, failures: listOf(fields.failures).map((failure) => filteredFailure(failure, texts)) };
}

export function safeVerdicts(verdicts: readonly Json[], tests: readonly HandedTest[]): readonly Json[] {
  const texts = tests.map((test) => test.text);
  return verdicts.map((verdict) => saidSafely(fieldsOf(verdict), texts));
}

export function filteredProof(answer: Json, tests: readonly HandedTest[]): Json {
  const fields = fieldsOf(answer);
  const texts = tests.map((test) => test.text);
  const verdicts = safeVerdicts(listOf(fields.verdicts), tests).map((verdict) => {
    const verdictFields = fieldsOf(verdict);
    const { cases } = verdictFields;
    return cases === undefined ? verdict : { ...verdictFields, cases: filteredCases(cases, texts) };
  });
  return { ...fields, verdicts };
}
