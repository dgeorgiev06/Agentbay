import { defineScript, fieldsOf, type Json, type ScriptContext } from "../../../../bay/sdk.ts";
import { answerOf } from "./lib/called.ts";
import { codeAt, readIn } from "./lib/code.ts";
import { keepFindings, keptTests } from "./lib/kept-tests.ts";
import { reviewersPractices, type Practice } from "./lib/practices.ts";
import { reviewOf } from "./lib/review.ts";
import { afterRoundOf, reviewPlan, reviewedState, type AfterRound, type Reviewed } from "./lib/rounds.ts";
import { textsOf } from "./lib/json-values.ts";

type Asked = AfterRound & {
  readonly practices: readonly string[];
};

function askedOf(input: Json): Asked {
  const fields = fieldsOf(input);
  return { ...afterRoundOf(fields, "review-round"), practices: textsOf(fields.practices) };
}

async function practicesOf(context: ScriptContext, asked: Asked, folder: string): Promise<readonly Practice[]> {
  const files = await Promise.all(asked.practices.map((path) => readIn(context, folder, path)));
  return files.flatMap((file) => reviewersPractices(file.text));
}

async function reviewed(context: ScriptContext, asked: Asked, folder: string): Promise<Reviewed> {
  const { state } = asked;
  const code = await codeAt(context, { base: state.base, commit: state.builder.commit, folder, fixed: asked.fixed });
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
  return reviewedState(asked.state, await reviewedOrNot(context, asked), `review-${String(asked.state.round)}`);
});
