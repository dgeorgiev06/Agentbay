import type { Json, ScriptContext } from "../../../../../bay/sdk.ts";
import type { Stayed } from "./branch-endings.ts";
import { answerOf } from "./called.ts";
import { rulesGiven } from "./design-summary.ts";
import { cutAfresh, removedThenDropped } from "./drops.ts";
import { handedTestsOf, type HandedTest } from "./handed-tests.ts";
import { keptFindings, keptTests } from "./kept-tests.ts";

export type Writing = {
  readonly number: number;
  readonly name: string;
  readonly slice: Json;
  readonly interface: Json;
  readonly rules: Json;
  readonly practices: Json;
  readonly base: string;
  readonly folder: string;
  readonly into: string;
};

export type Written = {
  readonly tests: readonly HandedTest[];
  readonly stayed: readonly Stayed[];
};

async function testsAsked(context: ScriptContext, writing: Writing, folder: string): Promise<readonly HandedTest[]> {
  const { slice, practices } = writing;
  const asked = { slice, interface: writing.interface, ...rulesGiven(writing.rules), folder, practices };
  if (writing.number === 1) {
    return handedTestsOf(await answerOf(context, "write-tests", asked));
  }
  const earlier = await keptTests(context, writing.name);
  const findings = await keptFindings(context, writing.name);
  return handedTestsOf(await answerOf(context, "write-tests", { ...asked, earlier: [...earlier], findings }));
}

export async function newTests(context: ScriptContext, writing: Writing): Promise<Written> {
  if (writing.number === 1) {
    return { tests: await testsAsked(context, writing, writing.folder), stayed: [] };
  }
  const toCut = { slice: `${writing.name}-writer-${String(writing.number)}`, base: writing.base };
  const writer = await cutAfresh(context, toCut, writing.into);
  const tests = await testsAsked(context, writing, writer.folder);
  const drops = await removedThenDropped(context, writer, writing.into);
  return { tests, stayed: drops.stayed };
}
