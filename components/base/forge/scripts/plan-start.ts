import { defineScript, fail, fieldsOf, readYaml, type Json } from "../../../../bay/sdk.ts";
import { branchesSaid } from "./lib/branch-endings.ts";
import { whileOnBranch } from "./lib/branch-files.ts";
import { answerOf } from "./lib/called.ts";
import { designSummaryOf, type DesignSummary } from "./lib/design-summary.ts";
import { textOf, textsOf } from "./lib/json-values.ts";
import { planPractices, type Practice } from "./lib/practices.ts";
import { acceptedOrStopped } from "./lib/requirements-form.ts";

type Read = {
  readonly text: string;
  readonly practices: readonly Practice[];
};

function jobOfPath(design: string): string {
  return design.split("/").at(-2) ?? "";
}

function documentOf(design: string, text: string): Json {
  const read = readYaml(text);
  if (!read.ok) {
    const why = read.problems.map((problem) => problem.message).join(" ");
    return fail(`forge could not read the design ${design} as YAML, so no plan is written: ${why}`);
  }
  return read.value;
}

function summaryOf(design: string, document: Json): DesignSummary {
  const summary = designSummaryOf(design, document);
  if (summary.modules.length === 0 || summary.requirements === "") {
    return fail(
      `${design} names no module or no requirements file, so it is not a design the design workflow ` +
        "committed; name the design.yaml it committed.",
    );
  }
  return summary;
}

export const run = defineScript(async (input, context) => {
  const fields = fieldsOf(input);
  const design = textOf(fieldsOf(fields.asked ?? null).design);
  const into = textOf(fields.into);
  const onBranch = {
    slice: `${jobOfPath(design)}-plan-reading`,
    branch: into,
    paths: [design, ...textsOf(fields.practices)],
  };
  const onIt = await whileOnBranch(context, onBranch, ([first, ...rest]): Promise<Read> => {
    const practices = rest.flatMap((file) => planPractices(file.text));
    return Promise.resolve({ text: first?.text ?? "", practices });
  });
  const read = onIt.made;
  const document = documentOf(design, read.text);
  const summary = summaryOf(design, document);
  const checked = await answerOf(context, "requirements.check", { file: summary.requirements });
  const { file, requirements } = acceptedOrStopped(checked, "plan");
  const practices = read.practices.map((practice) => ({ ...practice }));
  const said = branchesSaid([], onIt.stayed);
  return { design, document, file, requirements, job: summary.job, practices, ...said };
});
