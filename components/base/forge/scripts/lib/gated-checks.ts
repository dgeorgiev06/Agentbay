import { fail, fieldsOf, pathMatch, type JsonFields, type ScriptContext } from "../../../../../bay/sdk.ts";
import { answerOf } from "./called.ts";
import type { Gate } from "./gate.ts";
import { listOf, textOf, textsOf } from "./json-values.ts";
import { withGatedRuns, withGateSaid, withoutGatedRuns } from "./tool-checks.ts";

type ModeGate = Extract<Gate, { readonly gate: "mode" }>;

type ReadAt = {
  readonly cutAs: string;
  readonly head: string;
};

export const mostTestsFrom = 200;

export function modeTestsOf(listed: readonly string[], testFiles: readonly string[]): readonly string[] {
  return listed.filter((path) => testFiles.some((pattern) => pathMatch(pattern, path).kind === "matched"));
}

export function testsFromOf(
  gate: ModeGate,
  modeTests: readonly string[],
  alsoRun: readonly string[],
): readonly string[] {
  if (modeTests.length === 0) {
    return [gate.folder];
  }
  const testsFrom = [...new Set([...modeTests, ...alsoRun])];
  if (testsFrom.length > mostTestsFrom) {
    const most = String(mostTestsFrom);
    return fail(
      `forge found more than ${most} test files for the mode gate under ${gate.folder} and in the setting ` +
        `modeGateTests, and proof takes at most ${most}.`,
    );
  }
  return testsFrom;
}

async function listedAt(context: ScriptContext, gate: ModeGate, at: ReadAt): Promise<readonly string[]> {
  const asked = { cutAs: at.cutAs, base: at.head, paths: [], list: [gate.folder] };
  const answer = await answerOf(context, "read-on-branch", asked);
  if (answer.listedCut === true) {
    return fail(`forge could not list every file under ${gate.folder} at ${at.head}: there are more than it lists.`);
  }
  return textsOf(answer.listed);
}

async function testFilesOf(context: ScriptContext): Promise<readonly string[]> {
  const described = await answerOf(context, "toolchain.describe", {});
  return listOf(described.testFiles).map(textOf);
}

export function askedUnderWhole(asked: JsonFields): JsonFields {
  return { ...asked, slice: withoutGatedRuns(asked.slice ?? null) };
}

export async function gatedAsked(context: ScriptContext, asked: JsonFields, gate: Gate): Promise<JsonFields> {
  if (gate.gate === "whole") {
    return askedUnderWhole(asked);
  }
  const slice = asked.slice ?? null;
  const at = { cutAs: `${textOf(fieldsOf(slice).name)}-gate`, head: textOf(asked.head) };
  const modeTests = modeTestsOf(await listedAt(context, gate, at), await testFilesOf(context));
  const testsFrom = testsFromOf(gate, modeTests, textsOf(context.settings.modeGateTests));
  return { ...asked, slice: withGatedRuns(withGateSaid(slice, gate), testsFrom) };
}
