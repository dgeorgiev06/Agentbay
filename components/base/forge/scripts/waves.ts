import { defineScript, fieldsOf } from "../../../../bay/sdk.ts";
import { refusedLines, workedOutLines } from "./lib/lines.ts";
import { workOut } from "./lib/plan-waves.ts";
import { readFeatures, readPlan } from "./lib/reading.ts";

export const run = defineScript(async (input, context) => {
  const path = fieldsOf(input).plan;
  const planPath = typeof path === "string" ? path : "";
  const read = await readPlan(context, planPath);
  if (read.kind === "refused") {
    const problems = read.refusals.map((refusal) => ({ at: refusal.at, sentence: refusal.sentence }));
    return { answer: "refused", problems, lines: refusedLines(planPath, read.refusals) };
  }
  const plan = read.plan;
  const workedOut = workOut(plan, await readFeatures(context));
  return {
    answer: "worked out",
    title: plan.title,
    slices: plan.slices,
    ...workedOut,
    lines: workedOutLines(plan, workedOut),
  };
});
