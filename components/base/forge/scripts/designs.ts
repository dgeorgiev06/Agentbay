import { defineScript, fail, fieldsOf, type Json, type ScriptContext } from "../../../../bay/sdk.ts";
import { answerOf } from "./lib/called.ts";
import { textOf } from "./lib/json-values.ts";
import { pathOf, stanceOf, stoppedOnPath } from "./lib/path-card.ts";

type Asked = {
  readonly file: string;
  readonly requirements: Json;
};

function designed(context: ScriptContext, asked: Asked, which: "first" | "second"): Promise<Json> {
  return answerOf(context, "design", { ...asked, stance: stanceOf(which) });
}

export const run = defineScript(async (input, context) => {
  const fields = fieldsOf(input);
  const path = pathOf(textOf(fields.choice)) ?? fail(stoppedOnPath);
  const asked = { file: textOf(fields.file), requirements: fields.requirements ?? null };
  const first = await designed(context, asked, "first");
  if (path === "light") {
    return { path, designs: [first] };
  }
  return { path, designs: [first, await designed(context, asked, "second")] };
});
