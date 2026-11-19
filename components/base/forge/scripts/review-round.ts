import { defineScript, fail, fieldsOf, type Json, type JsonFields, type ScriptContext } from "../../../../bay/sdk.ts";
import { answerOf } from "./lib/called.ts";
import { sliceOf } from "./lib/cards.ts";
import type { HandedTest } from "./lib/handed-tests.ts";
import { forgetKept, keepFindings, keptTests } from "./lib/kept-tests.ts";
import { reviewersPractices, type Practice } from "./lib/practices.ts";
import { reviewOf } from "./lib/review.ts";
import { reviewPlan, reviewedState, roundsStateOf, type Reviewed, type RoundsState } from "./lib/rounds.ts";

type Asked = {
  readonly name: string;
  readonly slice: Json;
  readonly fixed: readonly string[];
  readonly practices: readonly string[];
  readonly state: RoundsState;
};

const mostCodeFiles = 200;

function textsOf(value: Json | undefined): readonly string[] {
  return Array.isArray(value) ? value.filter((text) => typeof text === "string") : [];
}

function askedOf(input: Json): Asked {
  const fields = fieldsOf(input);
  const slice = fields.slice ?? null;
  const state = roundsStateOf(fields.state) ?? fail("review-round was given no state of the rounds.");
  return {
    name: sliceOf(slice).name,
    slice,
    fixed: textsOf(fields.fixed),
    practices: textsOf(fields.practices),
    state,
  };
}

async function readFrom(context: ScriptContext, folder: string, path: string): Promise<HandedTest> {
  const read = await context.files.read(`${folder}/${path}`);
  return read.ok ? { path, text: read.value } : fail(`forge could not read ${path} in ${folder}: ${read.message}`);
}

function changedPaths(answer: JsonFields): readonly string[] {
  const paths = Array.isArray(answer.paths) ? answer.paths : [];
  const kept = paths.map((entry: Json) => fieldsOf(entry)).filter((entry) => entry.how !== "deleted");
  return kept.map((entry) => (typeof entry.path === "string" ? entry.path : ""));
}

async function codeOf(context: ScriptContext, asked: Asked, folder: string): Promise<readonly HandedTest[]> {
  const { base, builder } = asked.state;
  const changed = changedPaths(await answerOf(context, "worktrees.changed", { from: base, to: builder.commit }));
  const code = changed.filter((path) => !asked.fixed.includes(path)).slice(0, mostCodeFiles);
  return Promise.all(code.map((path) => readFrom(context, folder, path)));
}

async function practicesOf(context: ScriptContext, asked: Asked, folder: string): Promise<readonly Practice[]> {
  const files = await Promise.all(asked.practices.map((path) => readFrom(context, folder, path)));
  return files.flatMap((file) => reviewersPractices(file.text));
}

async function reviewed(context: ScriptContext, asked: Asked, folder: string): Promise<Reviewed> {
  const { state } = asked;
  const code = await codeOf(context, asked, folder);
  const practices = await practicesOf(context, asked, folder);
  const tests = await keptTests(context, asked.name);
  const answer = await answerOf(context, "review", {
    round: state.round,
    slice: asked.slice,
    tests: [...tests],
    code: [...code],
    verdicts: [...state.verdicts],
    failing: state.failing,
    practices: [...practices],
  });
  await answerOf(context, "worktrees.remove", { folder, branchAfter: "kept" });
  const review = reviewOf(answer);
  const forTests = review.findings.filter((finding) => finding.to === "test-writer");
  await keepFindings(context, asked.name, forTests);
  return { plan: "review", review };
}

async function reviewedOrNot(context: ScriptContext, asked: Asked): Promise<Reviewed> {
  const plan = reviewPlan(asked.state);
  const folder = asked.state.folder ?? "";
  if (plan === "review") {
    return reviewed(context, asked, folder);
  }
  await answerOf(context, "worktrees.remove", { folder, branchAfter: "kept" });
  return { plan: plan === "stopped" ? "stopped" : "failing" };
}

export const run = defineScript(async (input, context) => {
  const asked = askedOf(input);
  if (reviewPlan(asked.state) === "pass-on") {
    return asked.state;
  }
  const next = reviewedState(asked.state, await reviewedOrNot(context, asked), `review-${String(asked.state.round)}`);
  if (next.done) {
    await forgetKept(context, asked.name);
  }
  return next;
});
