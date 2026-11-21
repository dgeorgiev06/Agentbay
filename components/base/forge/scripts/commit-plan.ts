import { defineScript, fail, fieldsOf, type Json, type ScriptContext } from "../../../../bay/sdk.ts";
import { branchesSaid } from "./lib/branch-endings.ts";
import { committedInto, type Written } from "./lib/commit-files.ts";
import { textOf } from "./lib/json-values.ts";
import { planDocument, planFile, plansIn, type Named } from "./lib/plan-file.ts";
import { planOf } from "./lib/plan-form.ts";
import { givenOf, sourcesGiven } from "./lib/plan-sources.ts";
import { workOut } from "./lib/plan-waves.ts";
import { sliceRequests } from "./lib/slice-requests.ts";

const stoppedOnCard = "The owner chose stop on the plan card, so nothing is committed.";

type Filing = Named & {
  readonly job: string;
  readonly plan: Json;
};

async function namesIn(context: ScriptContext, folder: string): Promise<readonly string[]> {
  const listed = await context.files.list(plansIn(folder));
  return listed.ok ? listed.value : fail(`forge could not list the plans in ${plansIn(folder)}: ${listed.message}`);
}

function filed(context: ScriptContext, filing: Filing): (folder: string) => Promise<readonly Written[]> {
  return async (folder) => [planFile(filing.plan, { ...filing, names: await namesIn(context, folder) })];
}

export const run = defineScript(async (input, context) => {
  const fields = fieldsOf(input);
  if (fields.choice !== "approve") {
    return fail(stoppedOnCard);
  }
  const start = fieldsOf(fields.start ?? null);
  const given = givenOf(start);
  const job = textOf(start.job);
  const into = textOf(fields.into);
  const plan = fieldsOf(fields.again ?? null).plan ?? null;
  const named = { requirements: given.file, design: given.design };
  const message = `${job}: the plan, approved on the plan card`;
  const files = filed(context, { ...named, job, plan });
  const done = await committedInto(context, { slice: `${job}-plan`, into, files, message });
  const { commit, merged, files: written } = done;
  const document = planDocument(plan, named);
  const sources = sourcesGiven(given);
  const [first] = workOut(planOf(document), [], sources).waves;
  return {
    commit,
    merged,
    into,
    plan: written[0]?.path ?? "",
    wave: [...sliceRequests(document, first?.slices ?? [], { base: commit, design: sources.design })],
    ...branchesSaid(done.dropped, done.stayed),
  };
});
