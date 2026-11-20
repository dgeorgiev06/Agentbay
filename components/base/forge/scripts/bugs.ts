import { defineScript, fieldsOf, type Json, type ScriptContext } from "../../../../bay/sdk.ts";
import { answerOf } from "./lib/called.ts";
import { sliceOf } from "./lib/slice-form.ts";
import { codeAt } from "./lib/code.ts";
import { bugsHanded, bugsOf, plants, type Bug } from "./lib/planting.ts";
import { afterRoundOf, type AfterRound } from "./lib/rounds.ts";
import { textOf, textsOf } from "./lib/json-values.ts";

type Asked = AfterRound & {
  readonly cutAs: string;
  readonly interface: readonly string[];
  readonly owner: readonly Bug[];
};

function askedOf(input: Json): Asked {
  const fields = fieldsOf(input);
  return {
    ...afterRoundOf(fields, "bugs"),
    cutAs: textOf(fields.cutAs),
    interface: textsOf(fields.interface),
    owner: bugsOf(fields.bugs),
  };
}

async function plantedBugs(context: ScriptContext, asked: Asked): Promise<readonly Bug[]> {
  const { base, builder } = asked.state;
  const cut = await answerOf(context, "worktrees.cut", { slice: `${asked.cutAs}-planter`, base: builder.commit });
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
  const planting = plants(sliceOf(asked.slice), asked.state);
  const planted = planting ? await plantedBugs(context, asked) : [];
  return { bugs: bugsHanded(asked.owner, planted), planted: planted.length };
});
