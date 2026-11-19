import { defineScript, fail, fieldsOf, type Json, type JsonFields, type ScriptContext } from "../../../../bay/sdk.ts";
import { answerOf } from "./lib/called.ts";
import { builtOf, sliceOf, type Built } from "./lib/cards.ts";
import { failingOf, withoutCases } from "./lib/failing.ts";
import { handedTestsOf, type HandedTest } from "./lib/handed-tests.ts";
import { keepTests, keptFindings, keptTests } from "./lib/kept-tests.ts";
import { roundPlan, roundsStateOf, type RoundPlan, type RoundsState, type Work } from "./lib/rounds.ts";

type Round = {
  readonly number: number;
  readonly name: string;
  readonly slice: Json;
  readonly interface: Json;
  readonly fixed: Json;
  readonly cut: Work & { readonly folder: string };
  readonly declared: Json;
  readonly practices: Json;
  readonly before: RoundsState | undefined;
};

type Building = {
  readonly built: Built;
  readonly builder: Work;
};

type Committed = Work & {
  readonly folder: string;
};

function textAt(fields: JsonFields, key: string): string {
  const value = fields[key];
  return typeof value === "string" ? value : "";
}

function textsAt(fields: JsonFields, key: string): readonly string[] {
  const value = fields[key];
  return Array.isArray(value) ? value.filter((text) => typeof text === "string") : [];
}

function roundOf(input: Json): Round {
  const fields = fieldsOf(input);
  const slice = fields.slice ?? null;
  const cut = fieldsOf(fields.cut ?? null);
  return {
    number: typeof fields.round === "number" ? fields.round : 1,
    name: sliceOf(slice).name,
    slice,
    interface: fields.interface ?? [],
    fixed: fields.fixed ?? [],
    cut: { folder: textAt(cut, "folder"), branch: textAt(cut, "branch"), commit: textAt(cut, "commit") },
    declared: fields.declared ?? null,
    practices: fields.practices ?? [],
    before: roundsStateOf(fields.before),
  };
}

function isList(value: Json | undefined): value is readonly Json[] {
  return Array.isArray(value);
}

function listOf(value: Json | undefined): readonly Json[] {
  return isList(value) ? value : [];
}

function withTests(declared: Json, tests: readonly string[]): Json {
  const fields = fieldsOf(declared);
  const files = [...new Set([...textsAt(fields, "files"), ...tests])];
  return { files, names: fields.names ?? null };
}

function lessChecks(slice: Json): Json {
  const fields = fieldsOf(slice);
  const done = Array.isArray(fields.done) ? fields.done : [];
  const kept = done.filter((item: Json) => fieldsOf(fieldsOf(item).proof ?? null).kind !== "checks");
  return { ...fields, done: kept };
}

async function cutAt(context: ScriptContext, slice: string, base: string): Promise<Committed> {
  const cut = await answerOf(context, "worktrees.cut", { slice, base });
  return { folder: textAt(cut, "folder"), branch: textAt(cut, "branch"), commit: textAt(cut, "commit") };
}

async function removed(context: ScriptContext, request: Json): Promise<void> {
  await answerOf(context, "worktrees.remove", request);
}

async function committed(context: ScriptContext, folder: string, message: string): Promise<Committed> {
  const answer = await answerOf(context, "worktrees.commit", { folder, message });
  return { folder, branch: textAt(answer, "branch"), commit: textAt(answer, "commit") };
}

async function testsAsked(context: ScriptContext, round: Round, folder: string): Promise<readonly HandedTest[]> {
  const asked = { slice: round.slice, interface: round.interface, folder, practices: round.practices };
  if (round.number === 1) {
    return handedTestsOf(await answerOf(context, "write-tests", asked));
  }
  const earlier = await keptTests(context, round.name);
  const findings = await keptFindings(context, round.name);
  return handedTestsOf(await answerOf(context, "write-tests", { ...asked, earlier: [...earlier], findings }));
}

async function newTests(context: ScriptContext, round: Round): Promise<readonly HandedTest[]> {
  if (round.number === 1) {
    return testsAsked(context, round, round.cut.folder);
  }
  const writer = await cutAt(context, `${round.name}-writer-${String(round.number)}`, round.cut.commit);
  const tests = await testsAsked(context, round, writer.folder);
  await removed(context, { folder: writer.folder, into: round.cut.commit });
  return tests;
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
  const asked = { slice, interface: round.interface, fixed, folder, practices, declared };
  const { before } = round;
  return before === undefined ? asked : { ...asked, findings: [...before.toBuilder], failing: before.failing };
}

async function builtAgain(context: ScriptContext, round: Round): Promise<Building> {
  const folder = await builderFolder(context, round, round.before);
  const built = builtOf(await answerOf(context, "build-without-tests", builderAsked(round, folder)));
  const work = await committed(context, folder, `${round.name}: the builder's work, round ${String(round.number)}`);
  await removed(context, { folder, branchAfter: "kept" });
  return { built, builder: { branch: work.branch, commit: work.commit } };
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
  readonly builder: Work;
  readonly tests: readonly HandedTest[];
};

async function headOf(context: ScriptContext, round: Round, made: Made): Promise<Committed> {
  const { builder, tests } = made;
  const folder = await cutAt(context, `${round.name}-tests-${String(round.number)}`, builder.commit);
  await testsWritten(context, folder.folder, tests);
  return committed(context, folder.folder, `${round.name}: the tests the test writer handed in`);
}

async function proved(
  context: ScriptContext,
  round: Round,
  head: Committed & { readonly tests: readonly string[] },
): Promise<readonly Json[]> {
  const asked = {
    slice: lessChecks(round.slice),
    base: round.cut.commit,
    head: head.commit,
    declared: withTests(round.declared, head.tests),
    bugs: [],
  };
  return listOf((await answerOf(context, "proof.prove", asked)).verdicts);
}

function buildingOf(context: ScriptContext, round: Round, plan: RoundPlan): Promise<Building> {
  if (plan.build || round.before === undefined) {
    return builtAgain(context, round);
  }
  return Promise.resolve({ built: round.before.built, builder: round.before.builder });
}

function reviewedAtOf(before: RoundsState | undefined): { readonly reviewedAt?: string } {
  return before?.reviewedAt === undefined ? {} : { reviewedAt: before.reviewedAt };
}

async function ranRound(context: ScriptContext, round: Round, plan: RoundPlan): Promise<RoundsState> {
  if (plan.writeTests) {
    await keepTests(context, round.name, await newTests(context, round));
  }
  const building = await buildingOf(context, round, plan);
  const tests = await keptTests(context, round.name);
  const paths = tests.map((test) => test.path);
  const head = await headOf(context, round, { builder: building.builder, tests });
  const verdicts = await proved(context, round, { ...head, tests: paths });
  return {
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
    verdicts: withoutCases(verdicts),
    failing: failingOf(sliceOf(round.slice), verdicts, tests),
    toBuilder: [],
    toTests: 0,
    conditions: round.before?.conditions ?? [],
    remaining: [],
    ...reviewedAtOf(round.before),
  };
}

export const run = defineScript(async (input, context) => {
  const round = roundOf(input);
  const plan = roundPlan(round.before);
  if (plan === undefined) {
    return round.before ?? null;
  }
  return ranRound(context, round, plan);
});
