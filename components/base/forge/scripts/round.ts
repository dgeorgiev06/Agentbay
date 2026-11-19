import { defineScript, fail, fieldsOf, type Json, type JsonFields, type ScriptContext } from "../../../../bay/sdk.ts";
import { answerOf } from "./lib/called.ts";
import { sliceOf } from "./lib/cards.ts";
import { handedTestsOf, type HandedTest } from "./lib/handed-tests.ts";
import { forgetTests, keepTests, keptTests } from "./lib/kept-tests.ts";

type Round = {
  readonly name: string;
  readonly slice: Json;
  readonly interface: Json;
  readonly fixed: Json;
  readonly folder: string;
  readonly declared: Json;
  readonly practices: Json;
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
  return {
    name: sliceOf(slice).name,
    slice,
    interface: fields.interface ?? [],
    fixed: fields.fixed ?? [],
    folder: textAt(fieldsOf(fields.cut ?? null), "folder"),
    declared: fields.declared ?? null,
    practices: fields.practices ?? [],
  };
}

function withTests(declared: Json, tests: readonly string[]): Json {
  const fields = fieldsOf(declared);
  const files = [...new Set([...textsAt(fields, "files"), ...tests])];
  return { files, names: fields.names ?? null };
}

async function writtenTests(context: ScriptContext, round: Round): Promise<readonly HandedTest[]> {
  const asked = { slice: round.slice, interface: round.interface, folder: round.folder, practices: round.practices };
  return handedTestsOf(await answerOf(context, "write-tests", asked));
}

async function builtWithoutTests(context: ScriptContext, round: Round): Promise<JsonFields> {
  const { slice, fixed, folder, declared, practices } = round;
  return answerOf(context, "build-without-tests", {
    slice,
    interface: round.interface,
    fixed,
    folder,
    practices,
    declared,
  });
}

async function committed(context: ScriptContext, folder: string, message: string): Promise<JsonFields> {
  return answerOf(context, "worktrees.commit", { folder, message });
}

async function testsWritten(context: ScriptContext, folder: string, tests: readonly HandedTest[]): Promise<void> {
  for (const test of tests) {
    const written = await context.files.write(`${folder}/${test.path}`, test.text);
    if (!written.ok) {
      fail(`forge could not write the test ${test.path} into ${folder}: ${written.message}`);
    }
  }
}

export const run = defineScript(async (input, context) => {
  const round = roundOf(input);
  await keepTests(context, round.name, await writtenTests(context, round));
  const built = await builtWithoutTests(context, round);
  const work = await committed(context, round.folder, `${round.name}: the builder's work`);
  const cut = { slice: `${round.name}-tests`, base: textAt(work, "commit") };
  const testsFolder = textAt(await answerOf(context, "worktrees.cut", cut), "folder");
  const kept = await keptTests(context, round.name);
  await testsWritten(context, testsFolder, kept);
  const head = await committed(context, testsFolder, `${round.name}: the tests the test writer handed in`);
  await forgetTests(context, round.name);
  const tests = kept.map((test) => test.path);
  return {
    built,
    head: textAt(head, "commit"),
    branch: textAt(head, "branch"),
    declared: withTests(round.declared, tests),
    tests,
  };
});
