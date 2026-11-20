import {
  fail,
  fieldsOf,
  readYaml,
  segmentsOfPointer,
  type Json,
  type JsonFields,
  type ScriptContext,
} from "../../../../../bay/sdk.ts";
import type { After, Feature, Plan, PlannedSlice, SliceKind } from "./plan.ts";

export type Refusal = {
  readonly at: string;
  readonly line: number | undefined;
  readonly sentence: string;
};

export type PlanRead =
  { readonly kind: "read"; readonly plan: Plan } | { readonly kind: "refused"; readonly refusals: readonly Refusal[] };

type LineOf = (path: readonly (string | number)[]) => number | undefined;

const planSchema = "schemas/plan.json";

const featureMapSchema = "schemas/feature-map.json";

const sliceKinds: readonly SliceKind[] = ["interface", "capability", "mode"];

function isList(value: Json | undefined): value is readonly Json[] {
  return Array.isArray(value);
}

function textAt(fields: JsonFields, key: string): string {
  const value = fields[key];
  return typeof value === "string" ? value : "";
}

function listAt(fields: JsonFields, key: string): readonly Json[] {
  const value = fields[key];
  return isList(value) ? value : [];
}

function textsAt(fields: JsonFields, key: string): readonly string[] {
  return listAt(fields, key).filter((value) => typeof value === "string");
}

function afterOf(value: Json): After {
  const fields = fieldsOf(value);
  return { slice: textAt(fields, "slice"), because: textAt(fields, "because") };
}

function plannedSliceOf(value: Json): PlannedSlice {
  const planned = fieldsOf(value);
  const slice = fieldsOf(planned.slice ?? null);
  return {
    name: textAt(slice, "name"),
    title: textAt(planned, "title"),
    kind: sliceKinds.find((kind) => kind === slice.kind) ?? "mode",
    scope: textsAt(slice, "scope"),
    after: listAt(slice, "after").map(afterOf),
  };
}

function planOf(value: Json): Plan {
  const fields = fieldsOf(value);
  const plan = { title: textAt(fields, "title"), slices: listAt(fields, "slices").map(plannedSliceOf) };
  const because = fields.oneAfterAnotherBecause;
  return typeof because === "string" ? { ...plan, oneAfterAnotherBecause: because } : plan;
}

function refusalAt(lineOf: LineOf, at: string, sentence: string): Refusal {
  return { at, line: lineOf(segmentsOfPointer(at)), sentence };
}

function namedTwice(plan: Plan, lineOf: LineOf): readonly Refusal[] {
  return plan.slices.flatMap((slice, at) => {
    const first = plan.slices.findIndex((other) => other.name === slice.name);
    if (first === at) {
      return [];
    }
    const sentence =
      `Slices ${String(first + 1)} and ${String(at + 1)} are both named ${slice.name}. ` +
      "Give each slice a name of its own, since an after names a slice by it.";
    return [refusalAt(lineOf, `/slices/${String(at)}/slice/name`, sentence)];
  });
}

export async function readPlan(context: ScriptContext, path: string): Promise<PlanRead> {
  const text = await context.files.read(path);
  if (!text.ok) {
    return { kind: "refused", refusals: [{ at: "", line: undefined, sentence: text.message }] };
  }
  const read = readYaml(text.value);
  if (!read.ok) {
    const refusals = read.problems.map((problem) => ({
      at: "",
      line: problem.line,
      sentence: `${problem.message} ${problem.fix}`,
    }));
    return { kind: "refused", refusals };
  }
  const checked = await context.schemas.check(planSchema, read.value);
  if (!checked.ok) {
    return fail(checked.message);
  }
  if (!checked.value.passed) {
    const refusals = checked.value.problems.map((problem) => {
      const sentence = problem.fix === undefined ? problem.message : `${problem.message} ${problem.fix}`;
      return refusalAt(read.lineOf, problem.path, sentence);
    });
    return { kind: "refused", refusals };
  }
  const plan = planOf(checked.value.value);
  const twice = namedTwice(plan, read.lineOf);
  return twice.length > 0 ? { kind: "refused", refusals: twice } : { kind: "read", plan };
}

function featuresOf(value: Json): readonly Feature[] {
  return Object.entries(fieldsOf(fieldsOf(value).features ?? null)).map(([name, feature]) => ({
    name,
    private: textsAt(fieldsOf(feature), "private"),
  }));
}

export async function readFeatures(context: ScriptContext): Promise<readonly Feature[]> {
  const path = context.settings.featureMap;
  if (typeof path !== "string") {
    return [];
  }
  const text = await context.files.read(path);
  if (!text.ok) {
    return fail(`The map of features ${path}, named in forge's settings, could not be read: ${text.message}`);
  }
  const read = readYaml(text.value);
  const checked = read.ok ? await context.schemas.check(featureMapSchema, read.value) : undefined;
  if (checked === undefined || !checked.ok || !checked.value.passed) {
    return fail(`The map of features ${path}, named in forge's settings, does not list each feature's private files.`);
  }
  return featuresOf(checked.value.value);
}
