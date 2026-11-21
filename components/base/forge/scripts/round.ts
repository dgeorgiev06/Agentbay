import { defineScript, fail, fieldsOf, type Json, type JsonFields, type ScriptContext } from "../../../../bay/sdk.ts";
import { answerOf } from "./lib/called.ts";
import { builtOf, type Built } from "./lib/builder-answer.ts";
import { rulesGiven } from "./lib/design-summary.ts";
import type { Leak } from "./lib/leaks.ts";
import { sliceOf } from "./lib/slice-form.ts";
import type { Stayed } from "./lib/branch-endings.ts";
import { intoOf } from "./lib/drops.ts";
import { failingOf, safeVerdicts, withoutCases } from "./lib/failing.ts";
import type { HandedTest } from "./lib/handed-tests.ts";
import { keepTests, keptMark, keptTests } from "./lib/kept-tests.ts";
import { leaksAfterBuild } from "./lib/leak-check.ts";
import { newMark } from "./lib/mark.ts";
import { newTests } from "./lib/round-writer.ts";
import { roundPlan, roundsStateOf, withStayed, type RoundPlan, type RoundsState, type Work } from "./lib/rounds.ts";
import { withoutChecks } from "./lib/tool-checks.ts";
import { listOf, textOf, textsOf } from "./lib/json-values.ts";

type Round = {
  readonly number: number;
  readonly name: string;
  readonly into: string;
  readonly slice: Json;
  readonly interface: Json;
  readonly rules: Json;
  readonly fixed: Json;
  readonly cut: Work & { readonly folder: string };
  readonly declared: Json;
  readonly practices: Json;
  readonly before: RoundsState | undefined;
};

type Building = {
  readonly built: Built;
  readonly builder: Work;
  readonly builtAt?: string;
};

type Committed = Work & {
  readonly folder: string;
};

function roundOf(input: Json, into: string): Round {
  const fields = fieldsOf(input);
  const slice = fields.slice ?? null;
  const cut = fieldsOf(fields.cut ?? null);
  return {
    number: typeof fields.round === "number" ? fields.round : 1,
    name: sliceOf(slice).name,
    into,
    slice,
    interface: fields.interface ?? [],
    rules: fields.rules ?? [],
    fixed: fields.fixed ?? [],
    cut: { folder: textOf(cut.folder), branch: textOf(cut.branch), commit: textOf(cut.commit) },
    declared: fields.declared ?? null,
    practices: fields.practices ?? [],
    before: roundsStateOf(fields.before),
  };
}

function withTests(declared: Json, tests: readonly string[]): Json {
  const fields = fieldsOf(declared);
  const files = [...new Set([...textsOf(fields.files), ...tests])];
  return { files, names: fields.names ?? null };
}

async function cutAt(context: ScriptContext, slice: string, base: string): Promise<Committed> {
  const cut = await answerOf(context, "worktrees.cut", { slice, base });
  return { folder: textOf(cut.folder), branch: textOf(cut.branch), commit: textOf(cut.commit) };
}

async function removed(context: ScriptContext, request: Json): Promise<void> {
  await answerOf(context, "worktrees.remove", request);
}

async function committed(context: ScriptContext, folder: string, message: string): Promise<Committed> {
  const answer = await answerOf(context, "worktrees.commit", { folder, message });
  return { folder, branch: textOf(answer.branch), commit: textOf(answer.commit) };
}

async function builderFolder(context: ScriptContext, round: Round, before: RoundsState | undefined): Promise<string> {
  if (before === undefined) {
    return round.cut.folder;
  }
  const cut = await cutAt(context, `${round.name}-${String(round.number)}`, before.builder.commit);
  return cut.folder;
}

function builderAsked(round: Round, folder: string): JsonFields {
  const { slice, fixed, declared, practices } = round;
  const asked = { slice, interface: round.interface, ...rulesGiven(round.rules), fixed, folder, practices, declared };
  const { before } = round;
  return before === undefined ? asked : { ...asked, findings: [...before.toBuilder], failing: before.failing };
}

async function builtAgain(context: ScriptContext, round: Round): Promise<Building> {
  const folder = await builderFolder(context, round, round.before);
  const built = builtOf(await answerOf(context, "build-without-tests", builderAsked(round, folder)));
  const work = await committed(context, folder, `${round.name}: the builder's work, round ${String(round.number)}`);
  await removed(context, { folder, branchAfter: "kept" });
  return { built, builder: { branch: work.branch, commit: work.commit }, builtAt: `round-${String(round.number)}` };
}

async function testsWritten(context: ScriptContext, folder: string, tests: readonly HandedTest[]): Promise<void> {
  for (const test of tests) {
    const written = await context.files.write(`${folder}/${test.path}`, test.text);
    if (!written.ok) {
      fail(`forge could not write the test ${test.path} into ${folder}: ${written.message}`);
    }
  }
}

type Made = {
  readonly building: Building;
  readonly tests: readonly HandedTest[];
};

type Head = Committed & {
  readonly leaks: readonly Leak[];
  readonly stayed: readonly Stayed[];
};

async function leaksIn(
  context: ScriptContext,
  round: Round,
  made: Made & { readonly folder: string },
): Promise<Pick<Head, "leaks" | "stayed">> {
  return leaksAfterBuild(context, {
    slice: sliceOf(round.slice),
    round: round.number,
    into: round.into,
    base: round.cut.commit,
    commit: made.building.builder.commit,
    folder: made.folder,
    fixed: textsOf(round.fixed),
    interface: textsOf(round.interface),
    tests: made.tests,
    mark: await keptMark(context, round.name),
    answer: made.building.built,
  });
}

async function headOf(context: ScriptContext, round: Round, made: Made): Promise<Head> {
  const { building, tests } = made;
  const folder = await cutAt(context, `${round.name}-tests-${String(round.number)}`, building.builder.commit);
  const checked = await leaksIn(context, round, { ...made, folder: folder.folder });
  await testsWritten(context, folder.folder, tests);
  const head = await committed(context, folder.folder, `${round.name}: the tests the test writer handed in`);
  return { ...head, ...checked };
}

async function proved(
  context: ScriptContext,
  round: Round,
  head: Head & { readonly tests: readonly string[] },
): Promise<readonly Json[]> {
  if (head.leaks.length > 0) {
    return [];
  }
  const asked = {
    slice: withoutChecks(round.slice),
    base: round.cut.commit,
    head: head.commit,
    declared: withTests(round.declared, head.tests),
    bugs: [],
  };
  return listOf((await answerOf(context, "proof.prove", asked)).verdicts);
}

async function runMark(context: ScriptContext, round: Round): Promise<string> {
  const kept = round.number === 1 ? undefined : await keptMark(context, round.name);
  return kept ?? (await newMark(context));
}

function buildingOf(context: ScriptContext, round: Round, plan: RoundPlan): Promise<Building> {
  if (plan.build || round.before === undefined) {
    return builtAgain(context, round);
  }
  const { built, builder, builtAt } = round.before;
  return Promise.resolve(builtAt === undefined ? { built, builder } : { built, builder, builtAt });
}

function lastReviewOf(before: RoundsState | undefined): Pick<RoundsState, "practices" | "reviewedAt"> {
  const practices = before?.practices === undefined ? {} : { practices: before.practices };
  return before?.reviewedAt === undefined ? practices : { ...practices, reviewedAt: before.reviewedAt };
}

async function written(context: ScriptContext, round: Round, plan: RoundPlan): Promise<readonly Stayed[]> {
  if (!plan.writeTests) {
    return [];
  }
  const { number, name, slice, practices } = round;
  const writing = { number, name, slice, interface: round.interface, rules: round.rules, practices, into: round.into };
  const { tests, stayed } = await newTests(context, { ...writing, base: round.cut.commit, folder: round.cut.folder });
  await keepTests(context, { slice: round.name, tests, mark: await runMark(context, round) });
  return stayed;
}

async function ranRound(context: ScriptContext, round: Round, plan: RoundPlan): Promise<RoundsState> {
  const writerStayed = await written(context, round, plan);
  const building = await buildingOf(context, round, plan);
  const tests = await keptTests(context, round.name);
  const paths = tests.map((test) => test.path);
  const head = await headOf(context, round, { building, tests });
  const verdicts = await proved(context, round, { ...head, tests: paths });
  const state: RoundsState = {
    round: round.number,
    stage: "proved",
    done: false,
    base: round.cut.commit,
    ...building,
    head: head.commit,
    branch: head.branch,
    folder: head.folder,
    declared: withTests(round.declared, paths),
    tests: paths,
    verdicts: withoutCases(safeVerdicts(verdicts, tests)),
    failing: failingOf(sliceOf(round.slice), verdicts, tests),
    toBuilder: [],
    toTests: 0,
    conditions: round.before?.conditions ?? [],
    remaining: [],
    leaks: head.leaks,
    ...lastReviewOf(round.before),
  };
  return withStayed(state, [...(round.before?.stayed ?? []), ...writerStayed, ...head.stayed]);
}

export const run = defineScript(async (input, context) => {
  const round = roundOf(input, intoOf(context));
  const plan = roundPlan(round.before);
  if (plan === undefined) {
    return round.before ?? null;
  }
  return ranRound(context, round, plan);
});
