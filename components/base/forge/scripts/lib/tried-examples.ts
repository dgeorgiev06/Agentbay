import { fieldsOf, readYaml, type Json } from "../../../../../bay/sdk.ts";
import { listOf, textOf } from "./json-values.ts";
import { spelledOut } from "./long-texts.ts";

export type ToTry = {
  readonly action: string;
  readonly mode?: string;
  readonly examples: readonly Json[];
};

export type Expected =
  { readonly kind: "answer"; readonly value: Json } | { readonly kind: "refusal"; readonly sentence: string };

type Named = {
  readonly slice: string;
  readonly action: string;
  readonly number: number;
};

export type Side = { readonly how: string; readonly text: string };

export type Result = Named &
  (
    | { readonly outcome: "as designed" | "refused by its schema" }
    | { readonly outcome: "otherwise"; readonly designed: Side; readonly built: Side }
    | { readonly outcome: "not known" | "not tried"; readonly reason: string }
  );

export type Trial = Named & {
  readonly outcome: "to try";
  readonly runs: readonly (readonly string[])[];
  readonly expected: Expected;
};

export type Entry = Trial | Result;

export type TrialsAt = {
  readonly built: readonly string[];
  readonly room: number;
  readonly notBuilt: string;
};

export type Printed = { readonly exitCode: number; readonly stdout: string };

export type Proved = { readonly printed: readonly Printed[] } | { readonly reason: string };

export type Ran =
  | { readonly kind: "answered"; readonly output: Json }
  | { readonly kind: "refused"; readonly reason: string }
  | { readonly kind: "schema refused"; readonly message: string }
  | { readonly kind: "not started"; readonly message: string }
  | { readonly kind: "waited"; readonly reason: string }
  | { readonly kind: "unreadable" };

type Call = { readonly action: string; readonly input: Json };

type Spelled = { readonly calls: readonly Call[]; readonly expected: Expected } | { readonly refused: true };

export const triedPrefix = "tried-";

const longestWord = 50_000;

function interfaceOf(action: string): string {
  return action.slice(0, action.indexOf("."));
}

function spelledValue(value: Json, refused: string[]): Json {
  const spelled = spelledOut(value);
  refused.push(...spelled.refused);
  return spelled.value;
}

function expectedOf(fields: Readonly<Record<string, Json>>, refused: string[]): Expected {
  return fields.answer === undefined
    ? { kind: "refusal", sentence: textOf(fields.refusal) }
    : { kind: "answer", value: spelledValue(fields.answer, refused) };
}

function spelledExample(action: string, example: Json): Spelled {
  const fields = fieldsOf(example);
  const refused: string[] = [];
  const named = interfaceOf(action);
  const earlier = listOf(fields.earlier).map((call) => ({
    action: `${named}.${textOf(fieldsOf(call).action)}`,
    input: spelledValue(fieldsOf(call).input ?? null, refused),
  }));
  const last = { action, input: spelledValue(fields.input ?? null, refused) };
  const expected = expectedOf(fields, refused);
  return refused.length > 0 ? { refused: true } : { calls: [...earlier, last], expected };
}

function wordsOf(mode: string, call: Call): readonly string[] {
  const name = call.action.slice(call.action.indexOf(".") + 1);
  return ["call", `${mode}.${name}`, JSON.stringify(call.input), "--json"];
}

function entryOf(named: Named, toTry: ToTry, at: TrialsAt & { readonly example: Json }): Entry {
  const notTried = (reason: string): Entry => ({ ...named, outcome: "not tried", reason });
  const { mode } = toTry;
  if (mode === undefined) {
    const offered = interfaceOf(toTry.action);
    return notTried(
      `no one module of the design offers the interface ${offered}, so forge cannot tell which mode to call`,
    );
  }
  const spelled = spelledExample(toTry.action, at.example);
  if ("refused" in spelled) {
    return notTried("a long text in it cannot be spelled out");
  }
  const missing = spelled.calls.find((call) => !at.built.includes(call.action));
  if (missing !== undefined) {
    return notTried(`it calls ${missing.action} first, ${at.notBuilt}`);
  }
  if (spelled.calls.some((call) => JSON.stringify(call.input).length > longestWord)) {
    return notTried("a request in it is longer than proof takes in one word");
  }
  if (at.room < 1) {
    return notTried("proof takes at most 100 items in one call");
  }
  const runs = spelled.calls.map((call) => wordsOf(mode, call));
  return { ...named, outcome: "to try", runs, expected: spelled.expected };
}

export function plannedTrials(slice: string, toTry: readonly ToTry[], at: TrialsAt): readonly Entry[] {
  const entries: Entry[] = [];
  for (const each of toTry) {
    each.examples.forEach((example, index) => {
      const room = at.room - entries.filter((entry) => entry.outcome === "to try").length;
      entries.push(entryOf({ slice, action: each.action, number: index + 1 }, each, { ...at, room, example }));
    });
  }
  return entries;
}

export type TrialItem = {
  readonly id: string;
  readonly says: string;
  readonly level: "should";
  readonly proof: { readonly kind: "printed"; readonly runs: readonly { readonly bay: readonly string[] }[] };
};

export function trialItems(trials: readonly Trial[]): readonly TrialItem[] {
  return trials.map((trial, index) => ({
    id: `${triedPrefix}${String(index + 1)}`,
    says: `The design's example ${String(trial.number)} of ${trial.action} is run.`,
    level: "should",
    proof: { kind: "printed", runs: trial.runs.map((words) => ({ bay: [...words] })) },
  }));
}

function firstProblem(problems: Json | undefined): { readonly path: string; readonly message: string } {
  const first = fieldsOf(listOf(problems)[0] ?? null);
  return { path: textOf(first.path), message: textOf(first.message) };
}

function runRan(run: Readonly<Record<string, Json>>): Ran {
  switch (textOf(run.status)) {
    case "done":
      return { kind: "answered", output: run.output ?? null };
    case "failed":
      return { kind: "refused", reason: textOf(run.reason) };
    case "waiting":
      return { kind: "waited", reason: textOf(run.waitingFor) };
    default:
      return { kind: "unreadable" };
  }
}

export function ranOf(stdout: string): Ran {
  const read = readYaml(stdout);
  if (!read.ok || !isRecord(read.value)) {
    return { kind: "unreadable" };
  }
  const fields = fieldsOf(read.value);
  if (fields.run !== undefined) {
    return runRan(fieldsOf(fields.run));
  }
  if (fields.problems === undefined) {
    return { kind: "unreadable" };
  }
  const problem = firstProblem(fields.problems);
  const schema = problem.path === "/input" || problem.path.startsWith("/input/");
  return { kind: schema ? "schema refused" : "not started", message: problem.message };
}

function sameList(one: readonly Json[], other: readonly Json[]): boolean {
  return one.length === other.length && one.every((entry, at) => sameJson(entry, other[at] ?? null));
}

function sameFields(one: Json, other: Json): boolean {
  const [ones, others] = [fieldsOf(one), fieldsOf(other)];
  const keys = Object.keys(ones);
  return (
    keys.length === Object.keys(others).length &&
    keys.every((key) => key in others && sameJson(ones[key] ?? null, others[key] ?? null))
  );
}

function isRecord(value: Json): boolean {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function sameJson(one: Json, other: Json): boolean {
  if (Array.isArray(one) || Array.isArray(other)) {
    return Array.isArray(one) && Array.isArray(other) && sameList(listOf(one), listOf(other));
  }
  if (isRecord(one) || isRecord(other)) {
    return isRecord(one) && isRecord(other) && sameFields(one, other);
  }
  return one === other;
}

function designedSide(expected: Expected): Side {
  return expected.kind === "answer"
    ? { how: "answers", text: JSON.stringify(expected.value) }
    : { how: "refuses", text: JSON.stringify(expected.sentence) };
}

function builtSide(ran: Ran & { readonly kind: "answered" | "refused" | "schema refused" }): Side {
  switch (ran.kind) {
    case "answered":
      return { how: "answered", text: JSON.stringify(ran.output) };
    case "refused":
      return { how: "refused", text: JSON.stringify(ran.reason) };
    case "schema refused":
      return { how: "refused by the request schema", text: JSON.stringify(ran.message) };
  }
}

function asDesigned(expected: Expected, ran: Ran & { readonly kind: "answered" | "refused" }): boolean {
  if (ran.kind === "answered") {
    return expected.kind === "answer" && sameJson(expected.value, ran.output);
  }
  return expected.kind === "refusal" && expected.sentence === ran.reason;
}

function comparedResult(trial: Trial, ran: Ran): Result {
  const named = { slice: trial.slice, action: trial.action, number: trial.number };
  switch (ran.kind) {
    case "unreadable":
      return {
        ...named,
        outcome: "not known",
        reason: "what the last call printed is not the run bay call --json prints",
      };
    case "not started":
      return {
        ...named,
        outcome: "not tried",
        reason: `the kernel did not start the call: ${JSON.stringify(ran.message)}`,
      };
    case "waited":
      return {
        ...named,
        outcome: "not tried",
        reason: `the call waits for ${ran.reason === "" ? "an answer" : `a ${ran.reason}`}, which nobody gives in a throwaway copy`,
      };
    case "schema refused":
      if (trial.expected.kind === "refusal") {
        return { ...named, outcome: "refused by its schema" };
      }
      return { ...named, outcome: "otherwise", designed: designedSide(trial.expected), built: builtSide(ran) };
    case "answered":
    case "refused":
      return asDesigned(trial.expected, ran)
        ? { ...named, outcome: "as designed" }
        : { ...named, outcome: "otherwise", designed: designedSide(trial.expected), built: builtSide(ran) };
  }
}

export function resultOf(trial: Trial, proved: Proved): Result {
  if ("reason" in proved) {
    return {
      slice: trial.slice,
      action: trial.action,
      number: trial.number,
      outcome: "not known",
      reason: proved.reason,
    };
  }
  const last = proved.printed.at(-1);
  if (last === undefined || proved.printed.length !== trial.runs.length) {
    return comparedResult(trial, { kind: "unreadable" });
  }
  return comparedResult(trial, ranOf(last.stdout));
}
