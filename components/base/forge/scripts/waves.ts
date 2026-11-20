import { defineScript, fieldsOf, type Json } from "../../../../bay/sdk.ts";
import { refusedLines, workedOutLines } from "./lib/lines.ts";
import type { PlannedSlice } from "./lib/plan.ts";
import { workOut } from "./lib/plan-waves.ts";
import { readSources } from "./lib/plan-sources.ts";
import { readFeatures, readPlan } from "./lib/reading.ts";

function rowOf(slice: PlannedSlice): Json {
  const row = { name: slice.name, title: slice.title, kind: slice.kind, scope: [...slice.scope] };
  const after = slice.after.map((each) => ({ ...each }));
  const meets = slice.meets === undefined ? {} : { meets: [...slice.meets] };
  const named = slice.interface === undefined ? {} : { interface: [...slice.interface] };
  return { ...row, after, ...meets, ...named };
}

export const run = defineScript(async (input, context) => {
  const path = fieldsOf(input).plan;
  const planPath = typeof path === "string" ? path : "";
  const read = await readPlan(context, planPath);
  if (read.kind === "refused") {
    const problems = read.refusals.map((refusal) => ({ at: refusal.at, sentence: refusal.sentence }));
    return { answer: "refused", problems, lines: refusedLines(planPath, read.refusals) };
  }
  const plan = read.plan;
  const sources = await readSources(context, plan);
  const workedOut = workOut(plan, await readFeatures(context), sources.sources);
  const found = { ...workedOut, problems: [...sources.problems, ...workedOut.problems] };
  return {
    answer: "worked out",
    title: plan.title,
    slices: plan.slices.map(rowOf),
    ...found,
    lines: workedOutLines(plan, found),
  };
});
