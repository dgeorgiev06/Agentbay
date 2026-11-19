import { fieldsOf, type Json, type JsonFields } from "../../../../../bay/sdk.ts";
import type { Slice } from "./cards.ts";
import type { HandedTest } from "./handed-tests.ts";
import { quotesAny } from "./quoting.ts";

export const addressees = ["test-writer", "builder"] as const;

export type Addressee = (typeof addressees)[number];

export type Finding = {
  readonly to: Addressee;
  readonly case: string;
  readonly question: string;
  readonly fix: string;
};

export type Condition =
  | { readonly item: string; readonly held: true; readonly cases: readonly string[] }
  | { readonly item: string; readonly held: false; readonly why: string };

export type Review = {
  readonly conditions: readonly Condition[];
  readonly findings: readonly Finding[];
};

export type Reviewing = {
  readonly slice: Slice;
  readonly tests: readonly HandedTest[];
  readonly failing: readonly string[];
  readonly practices: readonly string[];
};

type Numbered = {
  readonly fields: JsonFields;
  readonly number: number;
};

const reviewFields = ["conditions", "findings"];

const findingFields = ["to", "case", "question", "fix"];

const conditionFields = ["item", "held", "cases", "why"];

const longestSentence = 200;

const question = /^(Q([1-9]|10)|negative-paths|condition)$/;

const practiceId = /^[A-Z]{1,4}-\d{1,3}$/;

const caseCall = /\b(?:test|it|describe)\s*\(\s*(["'`])((?:\\.|(?!\1)[^\\])*)\1/g;

const notQuoting = "say it in your own words; the builder never reads a line of a test.";

function textOf(value: Json | undefined): string {
  return typeof value === "string" ? value : "";
}

function isList(value: Json | undefined): value is readonly Json[] {
  return Array.isArray(value);
}

function listOf(value: Json | undefined): readonly Json[] {
  return isList(value) ? value : [];
}

function strays(fields: JsonFields, allowed: readonly string[]): readonly string[] {
  return Object.keys(fields).filter((field) => !allowed.includes(field));
}

function numbered(value: Json | undefined): readonly Numbered[] {
  return listOf(value).map((entry, at) => ({ fields: fieldsOf(entry), number: at + 1 }));
}

function isAddressee(value: Json | undefined): value is Addressee {
  return addressees.some((addressee) => addressee === value);
}

export function caseNamesOf(text: string): readonly string[] {
  return [...text.matchAll(caseCall)].map((found) => found[2] ?? "");
}

function isCaseName(name: string, reviewing: Reviewing): boolean {
  const names = reviewing.tests.flatMap((test) => caseNamesOf(test.text));
  return name !== "" && (reviewing.failing.includes(name) || names.some((each) => each.includes(name)));
}

export function isOneSentence(text: string): boolean {
  const trimmed = text.trim();
  return (
    trimmed !== "" &&
    Array.from(text).length <= longestSentence &&
    !/[\r\n]/.test(text) &&
    !/[.!?]["')\]]*\s+\S/.test(trimmed)
  );
}

function quotesTests(text: string, reviewing: Reviewing): boolean {
  return quotesAny(
    text,
    reviewing.tests.map((test) => test.text),
  );
}

function questionProblems(said: string, finding: Numbered, reviewing: Reviewing): readonly string[] {
  if (question.test(said)) {
    return [];
  }
  if (practiceId.test(said)) {
    return reviewing.practices.includes(said)
      ? []
      : [`Finding ${String(finding.number)} names the practice ${said}, which is not among the practices given.`];
  }
  return [
    `Finding ${String(finding.number)} names no question: Q1 to Q10, negative-paths, condition, ` +
      "or the id of a practice given.",
  ];
}

function builderProblems(finding: Numbered, reviewing: Reviewing): readonly string[] {
  const label = `Finding ${String(finding.number)}, for the builder,`;
  const problems: string[] = [];
  if (!isCaseName(textOf(finding.fields.case), reviewing)) {
    problems.push(`${label} names a case the tests do not name. Name the case as the tests name it.`);
  }
  if (quotesTests(textOf(finding.fields.fix), reviewing)) {
    problems.push(`${label} shares a run of 20 or more characters with the tests: ${notQuoting}`);
  }
  return problems;
}

function findingProblems(finding: Numbered, reviewing: Reviewing): readonly string[] {
  const label = `Finding ${String(finding.number)}`;
  const stray = strays(finding.fields, findingFields);
  if (stray.length > 0) {
    return [`${label} has the field ${stray.join(", ")}; a finding has to, case, question and fix only.`];
  }
  const { to } = finding.fields;
  if (!isAddressee(to)) {
    return [`${label} names no addressee: to is test-writer or builder.`];
  }
  return [
    ...(textOf(finding.fields.case).trim() === "" ? [`${label} names no case.`] : []),
    ...questionProblems(textOf(finding.fields.question), finding, reviewing),
    ...(isOneSentence(textOf(finding.fields.fix))
      ? []
      : [`The fix of finding ${String(finding.number)} is not one sentence of at most 200 characters.`]),
    ...(to === "builder" ? builderProblems(finding, reviewing) : []),
  ];
}

function heldProblems(item: string, fields: JsonFields, reviewing: Reviewing): readonly string[] {
  const cases = listOf(fields.cases).map(textOf);
  if (cases.length === 0) {
    return [`${item} is held by no case named. Name the cases that hold it, or say it is not held and why.`];
  }
  return cases.every((name) => isCaseName(name, reviewing))
    ? []
    : [`A case named for ${item} is not a case the tests name. Name each case as the tests name it.`];
}

function notHeldProblems(item: string, fields: JsonFields, reviewing: Reviewing): readonly string[] {
  const why = textOf(fields.why);
  if (!isOneSentence(why)) {
    return [`The reason ${item} is not held is not one sentence of at most 200 characters.`];
  }
  return quotesTests(why, reviewing)
    ? [`The reason ${item} is not held shares a run of 20 or more characters with the tests: ${notQuoting}`]
    : [];
}

function conditionProblems(condition: Numbered, reviewing: Reviewing): readonly string[] {
  const item = textOf(condition.fields.item);
  const stray = strays(condition.fields, conditionFields);
  if (stray.length > 0) {
    return [`The verdict on ${item} has the field ${stray.join(", ")}; it has item, held, and cases or why.`];
  }
  const { held } = condition.fields;
  if (held === true) {
    return heldProblems(item, condition.fields, reviewing);
  }
  if (held === false) {
    return notHeldProblems(item, condition.fields, reviewing);
  }
  return [`The verdict on ${item} does not say whether it is held.`];
}

function coverageProblems(items: readonly string[], slice: Slice): readonly string[] {
  const conditions = slice.done.map((done) => done.id);
  const missing = conditions.filter((id) => !items.includes(id));
  const twice = [...new Set(items.filter((id, at) => items.indexOf(id) !== at))];
  const unknown = items.filter((id) => !conditions.includes(id));
  return [
    ...missing.map((id) => `The review gives no verdict on ${id}. Say for each condition whether it is held.`),
    ...twice.map((id) => `The review gives ${id} more than once. Give each condition once.`),
    ...unknown.map((id) => `The review names ${id}, which is not a condition of the slice.`),
  ];
}

export function refusedReview(review: Json, reviewing: Reviewing): readonly string[] {
  const fields = fieldsOf(review);
  const stray = strays(fields, reviewFields);
  if (stray.length > 0) {
    return [`The review has the field ${stray.join(", ")}; it has conditions and findings only.`];
  }
  const conditions = numbered(fields.conditions);
  return [
    ...coverageProblems(
      conditions.map((condition) => textOf(condition.fields.item)),
      reviewing.slice,
    ),
    ...conditions.flatMap((condition) => conditionProblems(condition, reviewing)),
    ...numbered(fields.findings).flatMap((finding) => findingProblems(finding, reviewing)),
  ];
}

function conditionOf(value: Json): Condition {
  const fields = fieldsOf(value);
  const item = textOf(fields.item);
  return fields.held === true
    ? { item, held: true, cases: listOf(fields.cases).map(textOf) }
    : { item, held: false, why: textOf(fields.why) };
}

function findingOf(value: Json): Finding {
  const fields = fieldsOf(value);
  const to = isAddressee(fields.to) ? fields.to : "builder";
  return { to, case: textOf(fields.case), question: textOf(fields.question), fix: textOf(fields.fix) };
}

export function reviewOf(value: Json): Review {
  const fields = fieldsOf(value);
  return { conditions: listOf(fields.conditions).map(conditionOf), findings: listOf(fields.findings).map(findingOf) };
}
