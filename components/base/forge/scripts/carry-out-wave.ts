import { defineScript, fail, fieldsOf, type Json, type ScriptContext } from "../../../../bay/sdk.ts";
import { branchesAfter, branchesSaid, type Ending, type WaveSlice } from "./lib/branch-endings.ts";
import { settled } from "./lib/drops.ts";
import { listOf, textOf, textsOf } from "./lib/json-values.ts";
import { forgetKept } from "./lib/kept-tests.ts";
import { headMerged } from "./lib/merge-head.ts";
import { joinedOf, type Joined } from "./lib/wave-answer.ts";

const choices = ["merge", "keep"] as const;

type Choice = (typeof choices)[number];

type Wave = {
  readonly name: string;
  readonly into: string;
  readonly joined: Joined;
  readonly slices: readonly WaveSlice[];
};

function mergedNames(joined: Joined): readonly string[] {
  return joined.kind === "combined" ? joined.merged : [];
}

function waveOf(fields: Readonly<Record<string, Json>>): Wave {
  const wave = fieldsOf(fields.wave ?? null);
  const joined = joinedOf(fieldsOf(fields.combined ?? null).joined ?? null);
  const slices = listOf(fields.slices).map((value) => {
    const settledSlice = fieldsOf(value);
    const merged = mergedNames(joined).includes(textOf(settledSlice.name));
    return { builder: textOf(settledSlice.builder), head: textOf(settledSlice.work), merged };
  });
  return { name: textOf(wave.name), into: textOf(wave.into), joined, slices };
}

function endingOf(choice: Choice, wave: Wave): Ending {
  if (choice === "merge") {
    return { kind: "wave merged", wave: wave.name, slices: wave.slices };
  }
  return { kind: "wave kept", wave: wave.name, combined: wave.joined.kind === "combined", slices: wave.slices };
}

async function mergedHead(context: ScriptContext, wave: Wave): Promise<Json> {
  const { joined } = wave;
  if (joined.kind !== "combined") {
    return fail("carry-out-wave was asked to merge a wave with no combined head, and merge is withheld for it.");
  }
  const commit = await headMerged(context, { cutAs: wave.name, head: joined.head, into: wave.into });
  return { choice: "merge", merged: commit, into: wave.into, slices: [...joined.merged] };
}

export const run = defineScript(async (input, context) => {
  const fields = fieldsOf(input);
  const choice = choices.find((name) => name === fields.choice);
  if (choice === undefined) {
    return fail(`carry-out-wave was given no choice it knows; it knows ${choices.join(", ")}.`);
  }
  for (const slice of textsOf(fieldsOf(fields.wave ?? null).slices)) {
    await forgetKept(context, slice);
  }
  const wave = waveOf(fields);
  const done = choice === "merge" ? await mergedHead(context, wave) : { choice };
  const branches = branchesAfter(endingOf(choice, wave));
  const drops = await settled(context, branches, wave.into);
  return { ...fieldsOf(done), kept: [...branches.keep], ...branchesSaid([], drops.stayed) };
});
