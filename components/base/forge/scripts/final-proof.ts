import { defineScript, fail, fieldsOf, type JsonFields } from "../../../../bay/sdk.ts";
import { listOf, textOf } from "./lib/json-values.ts";
import { forgetKept, keptTests } from "./lib/kept-tests.ts";
import { sliceOf } from "./lib/slice-form.ts";
import { plannedTrials, type Entry } from "./lib/tried-examples.ts";
import { actionsOf, provedTrying, settingOf, toTryOf, type Setting } from "./lib/tried-block.ts";

const mostItems = 100;

function entriesOf(fields: JsonFields, setting: Setting): readonly Entry[] {
  if (setting === "off") {
    return [];
  }
  const toTry = toTryOf(fields.examples);
  const room = mostItems - listOf(fieldsOf(fields.slice ?? null).done).length;
  const at = { built: actionsOf(toTry), room, notBuilt: "which this slice does not build" };
  return plannedTrials(sliceOf(fields.slice).name, toTry, at);
}

export const run = defineScript(async (input, context) => {
  const { examples = [], ...asked } = fieldsOf(input);
  const name = sliceOf(asked.slice).name;
  const setting = settingOf(context.settings.tryExamples);
  const entries = entriesOf({ ...asked, examples }, setting);
  const tests = await keptTests(context, name);
  const proved = await provedTrying(context, asked, { entries, tests });
  await forgetKept(context, name);
  if (!proved.ok) {
    return fail(proved.message);
  }
  const carried = listOf(examples).length > 0;
  const tried = { setting, head: textOf(asked.head), carried, results: [...proved.results] };
  return { ...fieldsOf(proved.proof), tried };
});
