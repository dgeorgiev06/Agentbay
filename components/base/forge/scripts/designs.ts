import { defineScript, fail, fieldsOf, type Json, type JsonFields, type ScriptContext } from "../../../../bay/sdk.ts";
import { branchesSaid, stayedOf } from "./lib/branch-endings.ts";
import { answerOf } from "./lib/called.ts";
import { listOf, textOf, textsOf } from "./lib/json-values.ts";
import { pathOf, stanceOf, stoppedOnPath, type Stance } from "./lib/path-card.ts";
import { designPractices, type Practice } from "./lib/practices.ts";
import { requirementsOf } from "./lib/requirements-form.ts";

type Reading = {
  readonly job: string;
  readonly into: string;
  readonly paths: readonly string[];
};

function designed(context: ScriptContext, asked: JsonFields, which: Stance): Promise<Json> {
  return answerOf(context, "design", { ...asked, stance: stanceOf(which) });
}

function practicesIn(files: readonly Json[], into: string): readonly Practice[] {
  return files.map(fieldsOf).flatMap((file) => {
    const { text } = file;
    if (typeof text !== "string") {
      return fail(
        `forge found no practices file ${textOf(file.path)} at the head of ${into}, so no design is written; ` +
          "commit it there, or name only files that are there in the setting practices.",
      );
    }
    return designPractices(text);
  });
}

async function practicesRead(context: ScriptContext, reading: Reading): Promise<JsonFields> {
  const asked = { cutAs: `${reading.job}-practices`, base: reading.into, paths: [...reading.paths] };
  const answer = await answerOf(context, "read-on-branch", asked);
  const practices = practicesIn(listOf(answer.files), reading.into).map((practice) => ({ ...practice }));
  return { practices, ...branchesSaid([], stayedOf(answer.stayed)) };
}

export const run = defineScript(async (input, context) => {
  const fields = fieldsOf(input);
  const path = pathOf(textOf(fields.choice)) ?? fail(stoppedOnPath);
  const requirements = fields.requirements ?? null;
  const reading = {
    job: requirementsOf(requirements).job,
    into: textOf(fields.into),
    paths: textsOf(fields.practices),
  };
  const read = await practicesRead(context, reading);
  const asked = { file: textOf(fields.file), requirements, practices: read.practices ?? [] };
  const first = await designed(context, asked, "first");
  const designs = path === "light" ? [first] : [first, await designed(context, asked, "second")];
  return { path, designs, ...read };
});
