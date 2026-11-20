import { defineScript, fail, fieldsOf, type Json, type ScriptContext } from "../../../../bay/sdk.ts";
import { answerOf } from "./lib/called.ts";
import { listOf, textOf, textsOf } from "./lib/json-values.ts";
import { forgetKept } from "./lib/kept-tests.ts";
import { headMerged } from "./lib/merge-head.ts";
import { joinedOf } from "./lib/wave-answer.ts";

const choices = ["merge", "keep"] as const;

async function merged(context: ScriptContext, at: { cutAs: string; combined: Json; into: string }): Promise<Json> {
  const joined = joinedOf(at.combined);
  if (joined.kind !== "combined") {
    return fail("carry-out-wave was asked to merge a wave with no combined head, and merge is withheld for it.");
  }
  const { folder, commit } = await headMerged(context, { cutAs: at.cutAs, head: joined.head, into: at.into });
  await answerOf(context, "worktrees.remove", { folder, branchAfter: "kept" });
  return { choice: "merge", merged: commit, into: at.into, slices: [...joined.merged] };
}

export const run = defineScript(async (input, context) => {
  const fields = fieldsOf(input);
  const choice = choices.find((name) => name === fields.choice);
  if (choice === undefined) {
    return fail(`carry-out-wave was given no choice it knows; it knows ${choices.join(", ")}.`);
  }
  const wave = fieldsOf(fields.wave ?? null);
  const slices = textsOf(wave.slices);
  for (const slice of slices) {
    await forgetKept(context, slice);
  }
  const work = listOf(fields.slices)
    .flatMap(listOf)
    .map((settled) => textOf(fieldsOf(settled).work));
  if (choice === "keep") {
    return { choice, kept: [...work] };
  }
  const into = textOf(wave.into);
  return merged(context, {
    cutAs: textOf(wave.name),
    combined: fieldsOf(fields.combined ?? null).joined ?? null,
    into,
  });
});
