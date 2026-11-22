import { fail, fieldsOf, type JsonFields, type ScriptContext } from "../../../../../bay/sdk.ts";
import { answerOf } from "./called.ts";
import type { Gate } from "./gate.ts";
import { modeTestsFolder } from "./gate-words.ts";
import { textOf, textsOf } from "./json-values.ts";
import { mostListed } from "./listing.ts";
import { withTestsFrom } from "./tool-checks.ts";

type ModeGate = Extract<Gate, { readonly gate: "mode" }>;

export function testsFromOf(gate: ModeGate, listed: readonly string[], alsoRun: readonly string[]): readonly string[] {
  const testsFrom = [...new Set([...listed, ...alsoRun])];
  if (listed.length >= mostListed || testsFrom.length >= mostListed) {
    return fail(
      `forge found more than ${String(mostListed - 1)} files to take the mode gate's tests from under ` +
        `${modeTestsFolder(gate)} and the setting modeGateTests, and proof takes at most ${String(mostListed - 1)}.`,
    );
  }
  return testsFrom.length === 0 ? [modeTestsFolder(gate)] : testsFrom;
}

type ReadAt = {
  readonly cutAs: string;
  readonly head: string;
};

async function listedAt(context: ScriptContext, gate: ModeGate, at: ReadAt): Promise<readonly string[]> {
  const asked = { cutAs: at.cutAs, base: at.head, paths: [], list: [modeTestsFolder(gate)] };
  return textsOf((await answerOf(context, "read-on-branch", asked)).listed);
}

export async function gatedAsked(context: ScriptContext, asked: JsonFields, gate: Gate): Promise<JsonFields> {
  if (gate.gate === "whole") {
    return asked;
  }
  const slice = asked.slice ?? null;
  const at = { cutAs: `${textOf(fieldsOf(slice).name)}-gate`, head: textOf(asked.head) };
  const listed = await listedAt(context, gate, at);
  const testsFrom = testsFromOf(gate, listed, textsOf(context.settings.modeGateTests));
  return { ...asked, slice: withTestsFrom(slice, testsFrom) };
}
