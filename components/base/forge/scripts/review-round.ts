import { defineScript, fieldsOf, type Json, type ScriptContext } from "../../../../bay/sdk.ts";
import { branchesAfter } from "./lib/branch-endings.ts";
import { answerOf } from "./lib/called.ts";
import { codeAt, readIn } from "./lib/code.ts";
import { keepFindings, keptTests } from "./lib/kept-tests.ts";
import { pinnedFiles } from "./lib/pinned-files.ts";
import { intoOf, settled } from "./lib/drops.ts";
import { checksPractices, reviewersPractices, type Practice } from "./lib/practices.ts";
import { reviewOf } from "./lib/review.ts";
import { judgedPractices } from "./lib/reviewer-practices.ts";
import {
  afterRoundOf,
  findingsLeft,
  reviewPlan,
  reviewedState,
  withStayed,
  type AfterRound,
  type Reviewed,
  type ReviewPlan,
  type RoundsState,
} from "./lib/rounds.ts";
import { listOf, textsOf } from "./lib/json-values.ts";

type Asked = AfterRound & {
  readonly practices: readonly string[];
  readonly interface: readonly string[];
  readonly rules: Json;
};

function askedOf(input: Json): Asked {
  const fields = fieldsOf(input);
  const after = afterRoundOf(fields, "review-round");
  const rules = [...listOf(fields.rules)];
  return { ...after, practices: textsOf(fields.practices), interface: textsOf(fields.interface), rules };
}

type PracticesRead = {
  readonly reviewers: readonly Practice[];
  readonly checks: number;
};

async function practicesOf(context: ScriptContext, asked: Asked, folder: string): Promise<PracticesRead> {
  const files = await Promise.all(asked.practices.map((path) => readIn(context, folder, path)));
  return {
    reviewers: files.flatMap((file) => reviewersPractices(file.text)),
    checks: files.flatMap((file) => checksPractices(file.text)).length,
  };
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
    practices: [...practices.reviewers],
    rules: asked.rules,
  });
  await answerOf(context, "worktrees.remove", { folder, branchAfter: "kept" });
  const review = reviewOf(answer);
  const forTests = review.findings.filter((finding) => finding.to === "test-writer");
  await keepFindings(context, asked.name, forTests);
  const texts = tests.map((test) => test.text);
  const remaining = findingsLeft(review.findings, texts);
  const judged = judgedPractices(review.practices, {
    practices: practices.reviewers,
    tests: texts,
    checks: practices.checks,
  });
  return { plan: "review", review, remaining, practices: judged };
}

async function reviewedOrNot(
  context: ScriptContext,
  asked: Asked,
  plan: Exclude<ReviewPlan, "pass-on">,
): Promise<Reviewed> {
  const folder = asked.state.folder ?? "";
  if (plan === "review") {
    return reviewed(context, asked, folder);
  }
  await answerOf(context, "worktrees.remove", { folder, branchAfter: "kept" });
  return { plan };
}

async function endedRounds(context: ScriptContext, asked: Asked, next: RoundsState): Promise<RoundsState> {
  if (!next.done) {
    return next;
  }
  const work = { builder: next.builder.branch, head: next.branch };
  const ending = { kind: "rounds ended", name: asked.name, round: next.round, work } as const;
  const drops = await settled(context, branchesAfter(ending), intoOf(context));
  return withStayed(next, [...(next.stayed ?? []), ...drops.stayed]);
}

export const run = defineScript(async (input, context) => {
  const asked = askedOf(input);
  const plan = reviewPlan(asked.state);
  if (plan === "pass-on") {
    return asked.state;
  }
  const pinnedAtHead = await pinnedFiles(context, asked.state.folder ?? "", asked.interface);
  const reviewed = await reviewedOrNot(context, asked, plan);
  const next = { ...reviewedState(asked.state, reviewed, `review-${String(asked.state.round)}`), pinnedAtHead };
  return endedRounds(context, asked, next);
});
