import { fail, fieldsOf, readYaml, segmentsOfPointer, type Json, type ScriptContext } from "../../../../../bay/sdk.ts";
import type { Feature, Plan } from "./plan.ts";
import { gatesClaimed, planOf, twiceNamed } from "./plan-form.ts";
import { textsOf } from "./json-values.ts";

export type Refusal = {
  readonly at: string;
  readonly line: number | undefined;
  readonly sentence: string;
};

export type PlanRead =
  | { readonly kind: "read"; readonly plan: Plan; readonly document: Json }
  | { readonly kind: "refused"; readonly refusals: readonly Refusal[] };

type LineOf = (path: readonly (string | number)[]) => number | undefined;

const planSchema = "schemas/plan.json";

const featureMapSchema = "schemas/feature-map.json";

function refusalAt(lineOf: LineOf, at: string, sentence: string): Refusal {
  return { at, line: lineOf(segmentsOfPointer(at)), sentence };
}

function namedTwice(plan: Plan, lineOf: LineOf): readonly Refusal[] {
  return twiceNamed(plan).map((named) => refusalAt(lineOf, `/slices/${String(named.at)}/slice/name`, named.sentence));
}

export async function readPlan(context: ScriptContext, path: string): Promise<PlanRead> {
  const text = await context.files.read(path);
  if (!text.ok) {
    return { kind: "refused", refusals: [{ at: "", line: undefined, sentence: text.message }] };
  }
  return planOfText(context, text.value);
}

export async function planOfText(context: ScriptContext, text: string): Promise<PlanRead> {
  const read = readYaml(text);
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
  const document = checked.value.value;
  const plan = planOf(document);
  const claimed = gatesClaimed(document).map((claim) => refusalAt(read.lineOf, claim.at, claim.sentence));
  const refusals = [...namedTwice(plan, read.lineOf), ...claimed];
  return refusals.length > 0 ? { kind: "refused", refusals } : { kind: "read", plan, document };
}

function featuresOf(value: Json): readonly Feature[] {
  return Object.entries(fieldsOf(fieldsOf(value).features ?? null)).map(([name, feature]) => ({
    name,
    private: textsOf(fieldsOf(feature).private),
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
