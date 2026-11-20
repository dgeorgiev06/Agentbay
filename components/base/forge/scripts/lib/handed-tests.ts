import { fieldsOf, pathMatch, type Json } from "../../../../../bay/sdk.ts";
import type { Slice } from "./slice-form.ts";

export type HandedTest = {
  readonly path: string;
  readonly text: string;
};

const startsCase = /^\s*(?:test|it)\s*\(/m;

function textOf(value: Json | undefined): string {
  return typeof value === "string" ? value : "";
}

function listed(paths: readonly string[]): string {
  return paths.join(", ");
}

function files(count: number): string {
  return count === 1 ? "a file" : `${String(count)} files`;
}

export function handedTestsOf(value: Json): readonly HandedTest[] {
  const tests = fieldsOf(value).tests;
  const entries = Array.isArray(tests) ? tests : [];
  return entries.map((entry: Json) => ({ path: textOf(fieldsOf(entry).path), text: textOf(fieldsOf(entry).text) }));
}

export function namedTests(slice: Slice): readonly string[] {
  const named = slice.done.flatMap((item) => (item.proof?.kind === "fails-first" ? item.proof.tests : []));
  return [...new Set(named)];
}

function outsideScope(slice: Slice, paths: readonly string[]): readonly string[] {
  const outside = paths.filter((path) => !slice.scope.some((pattern) => pathMatch(pattern, path).kind === "matched"));
  if (outside.length === 0) {
    return [];
  }
  return [
    `The tests name ${files(outside.length)} outside the slice's write scope: ${listed(outside)}. ` +
      `Hand in only files the scope admits: ${listed(slice.scope)}.`,
  ];
}

function notNamed(named: readonly string[], paths: readonly string[]): readonly string[] {
  const others = paths.filter((path) => !named.includes(path));
  if (others.length === 0) {
    return [];
  }
  return [
    `The tests name ${files(others.length)} that no fails-first item names: ${listed(others)}. ` +
      `Hand in only the named test files: ${listed(named)}.`,
  ];
}

function givenTwice(paths: readonly string[]): readonly string[] {
  const twice = [...new Set(paths.filter((path, at) => paths.indexOf(path) !== at))];
  return twice.length === 0 ? [] : [`The tests give ${listed(twice)} more than once. Give each file once.`];
}

function notHandedIn(named: readonly string[], paths: readonly string[]): readonly string[] {
  const missing = named.filter((path) => !paths.includes(path));
  if (missing.length === 0) {
    return [];
  }
  return [`No test was handed in for ${listed(missing)}, which a fails-first item names. Hand in every named file.`];
}

function emptyTexts(tests: readonly HandedTest[]): readonly string[] {
  const empty = tests.filter((test) => test.text.trim() === "").map((test) => test.path);
  return empty.length === 0 ? [] : [`The test text of ${listed(empty)} is empty. Write the file whole.`];
}

function withoutCase(tests: readonly HandedTest[]): readonly string[] {
  const written = tests.filter((test) => test.text.trim() !== "");
  const caseless = written.filter((test) => !startsCase.test(test.text)).map((test) => test.path);
  if (caseless.length === 0) {
    return [];
  }
  return [
    `The test text of ${listed(caseless)} has no case: no line starts a call of test or it. ` +
      "Write a case for each condition the file holds.",
  ];
}

export function refusedTests(slice: Slice, tests: readonly HandedTest[]): readonly string[] {
  const named = namedTests(slice);
  const paths = tests.map((test) => test.path);
  return [
    ...outsideScope(slice, paths),
    ...notNamed(named, paths),
    ...givenTwice(paths),
    ...notHandedIn(named, paths),
    ...emptyTexts(tests),
    ...withoutCase(tests),
  ];
}
