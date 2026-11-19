import { defineScript, fail, fieldsOf, type Json, type ScriptContext } from "../../../../bay/sdk.ts";
import { answerOf } from "./lib/called.ts";
import { sliceOf } from "./lib/cards.ts";
import { codeAt } from "./lib/code.ts";
import { forgetKept } from "./lib/kept-tests.ts";
import { bugsHanded, bugsOf, plants, type Bug } from "./lib/planting.ts";
import { roundsStateOf, type RoundsState } from "./lib/rounds.ts";
import { textOf, textsOf } from "./lib/json-values.ts";

type Asked = {
  readonly name: string;
  readonly slice: Json;
  readonly interface: readonly string[];
  readonly fixed: readonly string[];
  readonly owner: readonly Bug[];
  readonly state: RoundsState;
};

function askedOf(input: Json): Asked {
  const fields = fieldsOf(input);
  const slice = fields.slice ?? null;
  return {
    name: sliceOf(slice).name,
    slice,
    interface: textsOf(fields.interface),
    fixed: textsOf(fields.fixed),
    owner: bugsOf(fields.bugs),
    state: roundsStateOf(fields.state) ?? fail("bugs was given no state of the rounds."),
  };
}

async function plantedBugs(context: ScriptContext, asked: Asked): Promise<readonly Bug[]> {
  const { base, builder } = asked.state;
  const cut = await answerOf(context, "worktrees.cut", { slice: `${asked.name}-planter`, base: builder.commit });
  const folder = textOf(cut.folder);
  const code = await codeAt(context, { base, commit: builder.commit, folder, fixed: asked.fixed });
  const answer = await answerOf(context, "plant", {
    slice: asked.slice,
    interface: [...asked.interface],
    code: [...code],
  });
  await answerOf(context, "worktrees.remove", { folder, branchAfter: "kept" });
  return bugsOf(answer.bugs);
}

export const run = defineScript(async (input, context) => {
  const asked = askedOf(input);
  const planting = plants(sliceOf(asked.slice), asked.state.built);
  const planted = planting ? await plantedBugs(context, asked) : [];
  await forgetKept(context, asked.name);
  return { bugs: bugsHanded(asked.owner, planted), planted: planted.length };
});
