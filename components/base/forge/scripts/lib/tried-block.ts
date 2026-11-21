import { fieldsOf, type Json, type JsonFields, type ScriptContext } from "../../../../../bay/sdk.ts";
import type { HandedTest } from "./handed-tests.ts";
import { listOf, numberOf, oneOf, textOf } from "./json-values.ts";
import { provedAgainst } from "./kept-proof.ts";
import { quotesAnyBeyond } from "./quoting.ts";
import {
  resultOf,
  trialItems,
  triedPrefix,
  type Entry,
  type Proved,
  type Result,
  type Side,
  type SliceToTry,
  type ToTry,
  type Trial,
} from "./tried-examples.ts";

export const settings = ["must", "shown", "off"] as const;

export type Setting = (typeof settings)[number];

export type TriedBlock = {
  readonly setting: Setting;
  readonly head: string;
  readonly carried: boolean;
  readonly results: readonly Result[];
};

export type SliceTried = TriedBlock & { readonly slice: string };

type Split = { readonly proof: Json; readonly proved: ReadonlyMap<string, Proved> };

export type ProvedTrying =
  | { readonly ok: true; readonly proof: Json; readonly results: readonly Result[] }
  | { readonly ok: false; readonly message: string };

const outcomes = ["as designed", "refused by its schema", "otherwise", "not known", "not tried"] as const;

export const keptFromCard = "kept from the card: it quotes a test";

export function settingOf(value: Json | undefined): Setting {
  return oneOf(settings, value) ?? "must";
}

export function toTryOf(value: Json | undefined): readonly ToTry[] {
  return listOf(value).map((entry) => {
    const fields = fieldsOf(entry);
    const named = { action: textOf(fields.action), examples: listOf(fields.examples) };
    return typeof fields.mode === "string" ? { ...named, mode: fields.mode } : named;
  });
}

export function actionsOf(toTry: readonly ToTry[]): readonly string[] {
  return toTry.map((each) => each.action);
}

export function trialsIn(entries: readonly Entry[]): readonly Trial[] {
  return entries.flatMap((entry) => (entry.outcome === "to try" ? [entry] : []));
}

export function askedWithTrials(asked: Json, trials: readonly Trial[]): Json {
  const fields = fieldsOf(asked);
  const slice = fieldsOf(fields.slice ?? null);
  const done = [...listOf(slice.done), ...trialItems(trials)];
  return { ...fields, slice: { ...slice, done } };
}

function provedFrom(verdict: JsonFields): Proved {
  if (verdict.verdict !== "passed") {
    return { reason: textOf(verdict.reason) || textOf(verdict.detail) };
  }
  const printed = listOf(verdict.printed).map((run) => ({
    exitCode: numberOf(fieldsOf(run).exitCode),
    stdout: textOf(fieldsOf(run).stdout),
  }));
  return { printed };
}

export function split(answer: Json): Split {
  const fields = fieldsOf(answer);
  const verdicts = listOf(fields.verdicts).map(fieldsOf);
  const isTried = (verdict: JsonFields): boolean => textOf(verdict.item).startsWith(triedPrefix);
  const proved = new Map(verdicts.filter(isTried).map((verdict) => [textOf(verdict.item), provedFrom(verdict)]));
  return { proof: { ...fields, verdicts: verdicts.filter((verdict) => !isTried(verdict)) }, proved };
}

const noVerdict = { reason: "proof gave no verdict for it" };

export function resultsOf(entries: readonly Entry[], proved: ReadonlyMap<string, Proved>): readonly Result[] {
  let tried = 0;
  return entries.map((entry) => {
    if (entry.outcome !== "to try") {
      return entry;
    }
    tried += 1;
    return resultOf(entry, proved.get(`${triedPrefix}${String(tried)}`) ?? noVerdict);
  });
}

function stringsIn(value: Json): readonly string[] {
  if (typeof value === "string") {
    return [value];
  }
  if (value === null || typeof value !== "object") {
    return [];
  }
  return (Array.isArray(value) ? listOf(value) : Object.values(fieldsOf(value))).flatMap(stringsIn);
}

export function givenTexts(trials: readonly Trial[]): readonly string[] {
  return trials.flatMap((trial) => {
    const expected = trial.expected.kind === "answer" ? trial.expected.value : trial.expected.sentence;
    return [...trial.runs.flat(), JSON.stringify(expected), ...stringsIn(expected)];
  });
}

function shownSide(side: Side, tests: readonly string[], given: readonly string[]): Side {
  return quotesAnyBeyond(side.text, tests, given) ? { how: side.how, text: keptFromCard, kept: true } : side;
}

export function shownResults(
  results: readonly Result[],
  tests: readonly string[],
  given: readonly string[],
): readonly Result[] {
  return results.map((result) =>
    result.outcome === "otherwise" ? { ...result, built: shownSide(result.built, tests, given) } : result,
  );
}

export async function provedTrying(
  context: ScriptContext,
  asked: Json,
  trying: { readonly entries: readonly Entry[]; readonly tests: readonly HandedTest[] },
): Promise<ProvedTrying> {
  const trials = trialsIn(trying.entries);
  const proved = await provedAgainst(context, askedWithTrials(asked, trials), trying.tests);
  if (!proved.ok) {
    return proved;
  }
  const apart = split(proved.value);
  const results = resultsOf(trying.entries, apart.proved);
  const tests = trying.tests.map((test) => test.text);
  return { ok: true, proof: apart.proof, results: shownResults(results, tests, givenTexts(trials)) };
}

function sideOf(value: Json | undefined): Side {
  const fields = fieldsOf(value ?? null);
  const side = { how: textOf(fields.how), text: textOf(fields.text) };
  return fields.kept === true ? { ...side, kept: true } : side;
}

function resultFrom(value: Json): Result {
  const fields = fieldsOf(value);
  const named = { slice: textOf(fields.slice), action: textOf(fields.action), number: numberOf(fields.number) };
  const outcome = oneOf(outcomes, fields.outcome) ?? "not known";
  switch (outcome) {
    case "as designed":
    case "refused by its schema":
      return { ...named, outcome };
    case "otherwise":
      return { ...named, outcome, designed: sideOf(fields.designed), built: sideOf(fields.built) };
    case "not known":
    case "not tried":
      return { ...named, outcome, reason: textOf(fields.reason) };
  }
}

export function triedBlockOf(value: Json | undefined): TriedBlock | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  const fields = fieldsOf(value);
  return {
    setting: settingOf(fields.setting),
    head: textOf(fields.head),
    carried: fields.carried === true,
    results: listOf(fields.results).map(resultFrom),
  };
}

export function slicesTriedOf(value: Json | undefined): readonly SliceTried[] {
  return listOf(value).flatMap((entry) => {
    const block = triedBlockOf(entry);
    return block === undefined ? [] : [{ ...block, slice: textOf(fieldsOf(entry).slice) }];
  });
}

export function blocksBySlice(
  slices: readonly SliceToTry[],
  at: { readonly setting: Setting; readonly head: string },
  results: readonly Result[],
): readonly SliceTried[] {
  return slices.map((each) => ({
    slice: each.slice,
    setting: at.setting,
    head: at.head,
    carried: each.toTry.length > 0,
    results: results.filter((result) => result.slice === each.slice),
  }));
}
