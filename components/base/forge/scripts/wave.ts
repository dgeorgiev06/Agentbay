import { defineScript, fail, fieldsOf, type JsonFields, type ScriptContext } from "../../../../bay/sdk.ts";
import { branchOf, roundsBranches, type Dropped } from "./lib/branch-endings.ts";
import { answerOf } from "./lib/called.ts";
import { shortCommit } from "./lib/card-lines.ts";
import type { DesignSummary } from "./lib/design-summary.ts";
import { listOf, numberOf, textOf, textsOf } from "./lib/json-values.ts";
import { workOut } from "./lib/plan-waves.ts";
import { readSources } from "./lib/plan-sources.ts";
import { planOfText, readFeatures } from "./lib/reading.ts";
import { leftOver } from "./lib/drops.ts";
import { lastRound } from "./lib/rounds.ts";
import { waveChoices } from "./lib/start-choices.ts";
import { builtBefore, testsToLookFor, waveOf, type PlanFound, type WaveAsked } from "./lib/wave-plan.ts";
import { sideBySideOf } from "./lib/side-by-side.ts";
import { gateOf } from "./lib/gate.ts";
import { waveStartCard } from "./lib/wave-start-card.ts";

type Read = {
  readonly commit: string;
  readonly texts: ReadonlyMap<string, string>;
};

type ToRead = {
  readonly cutAs: string;
  readonly base: string;
  readonly paths: readonly string[];
};

type Found = PlanFound & {
  readonly design?: DesignSummary;
};

function askedOf(input: JsonFields): WaveAsked {
  const asked = fieldsOf(input.asked ?? null);
  return { plan: textOf(asked.plan), wave: numberOf(asked.wave), into: textOf(input.into) };
}

async function readOnBranch(context: ScriptContext, toRead: ToRead): Promise<Read> {
  const answer = await answerOf(context, "read-on-branch", { ...toRead, paths: [...toRead.paths] });
  const files = listOf(answer.files).map(fieldsOf);
  const texts = files.flatMap((file) =>
    typeof file.text === "string" ? [[textOf(file.path), file.text] as const] : [],
  );
  return { commit: textOf(answer.commit), texts: new Map(texts) };
}

async function planFound(context: ScriptContext, asked: WaveAsked, read: Read): Promise<Found> {
  const text = read.texts.get(asked.plan);
  if (text === undefined) {
    return fail(
      `forge found no plan ${asked.plan} at the head of ${asked.into}, so no wave is built; commit it there.`,
    );
  }
  const parsed = await planOfText(context, text);
  if (parsed.kind === "refused") {
    const sentences = parsed.refusals.map((refusal) => refusal.sentence).join(" ");
    return fail(`forge could not read the plan ${asked.plan} at the head of ${asked.into}: ${sentences}`);
  }
  const { sources, problems } = await readSources(context, parsed.plan);
  const workedOut = workOut(parsed.plan, await readFeatures(context), sources);
  const found = {
    plan: parsed.plan,
    document: parsed.document,
    workedOut: { ...workedOut, problems: [...problems, ...workedOut.problems] },
  };
  return sources.design === undefined ? found : { ...found, design: sources.design };
}

async function testsRead(context: ScriptContext, found: Found, at: ToRead & { readonly wave: number }): Promise<Read> {
  const paths = testsToLookFor(found, at.wave);
  return paths.length === 0 ? { commit: at.base, texts: new Map() } : readOnBranch(context, { ...at, paths });
}

function leftByEarlierRuns(
  context: ScriptContext,
  name: string,
  slices: readonly string[],
): Promise<readonly Dropped[]> {
  const branches = slices.flatMap((slice) => roundsBranches(slice, lastRound));
  return leftOver(context, [branchOf(name), ...branches]);
}

export const run = defineScript(async (input, context) => {
  const asked = askedOf(fieldsOf(input));
  const name = `wave-${String(asked.wave)}`;
  const read = await readOnBranch(context, { cutAs: `${name}-plan`, base: asked.into, paths: [asked.plan] });
  const found = await planFound(context, asked, read);
  const base = read.commit;
  const looked = await testsRead(context, found, { cutAs: `${name}-tests`, base, paths: [], wave: asked.wave });
  const wave = waveOf(asked, found, { base, present: [...looked.texts.keys()], name });
  if (wave.kind === "refused") {
    return fail(wave.sentences.join(" "));
  }
  const sideBySide = sideBySideOf(context.settings.sideBySide);
  const design = found.design === undefined ? {} : { design: found.design };
  const leftovers = await leftByEarlierRuns(
    context,
    name,
    wave.slices.map((slice) => slice.name),
  );
  const shown = { ...asked, waves: wave.waves, base: shortCommit(base), slices: wave.slices, sideBySide, ...design };
  const choices = waveChoices(leftovers);
  const gate = gateOf(wave.slices);
  const card = waveStartCard({ ...shown, leftovers, gate: { gate, alsoRun: textsOf(context.settings.modeGateTests) } });
  return {
    name,
    plan: asked.plan,
    wave: asked.wave,
    into: asked.into,
    base,
    card: { ...card, withheld: choices.withheld },
    offered: choices.offered,
    leftovers: leftovers.map((left) => ({ ...left })),
    slices: wave.slices.map((slice) => slice.name),
    requests: [...wave.requests],
    builtBefore: [...builtBefore(found, asked.wave)],
    sideBySide,
    gate,
  };
});
