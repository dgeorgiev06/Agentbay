import { defineScript, fieldsOf, type Json, type ScriptContext } from "../../../../bay/sdk.ts";
import type { Stayed } from "./lib/branch-endings.ts";
import { answerOf } from "./lib/called.ts";
import { sliceOf } from "./lib/slice-form.ts";
import { codeAt } from "./lib/code.ts";
import { cutAfresh, intoOf, removedThenDropped } from "./lib/drops.ts";
import { bugsHanded, bugsOf, plants, type Bug } from "./lib/planting.ts";
import { afterRoundOf, type AfterRound } from "./lib/rounds.ts";
import { textsOf } from "./lib/json-values.ts";

type Asked = AfterRound & {
  readonly interface: readonly string[];
  readonly owner: readonly Bug[];
};

type Planted = {
  readonly bugs: readonly Bug[];
  readonly stayed: readonly Stayed[];
};

function askedOf(input: Json): Asked {
  const fields = fieldsOf(input);
  return {
    ...afterRoundOf(fields, "bugs"),
    interface: textsOf(fields.interface),
    owner: bugsOf(fields.bugs),
  };
}

async function plantedBugs(context: ScriptContext, asked: Asked): Promise<Planted> {
  const { base, builder } = asked.state;
  const into = intoOf(context);
  const cut = await cutAfresh(context, { slice: `${asked.name}-planter`, base: builder.commit }, into);
  const code = await codeAt(context, { base, commit: builder.commit, folder: cut.folder, fixed: asked.fixed });
  const answer = await answerOf(context, "plant", {
    slice: asked.slice,
    interface: [...asked.interface],
    code: [...code],
  });
  const drops = await removedThenDropped(context, cut, into);
  return { bugs: bugsOf(answer.bugs), stayed: drops.stayed };
}

export const run = defineScript(async (input, context) => {
  const asked = askedOf(input);
  const planting = plants(sliceOf(asked.slice), asked.state);
  const planted = planting ? await plantedBugs(context, asked) : { bugs: [], stayed: [] };
  const stayed = [...planted.stayed];
  return { bugs: bugsHanded(asked.owner, planted.bugs), planted: planted.bugs.length, stayed };
});
