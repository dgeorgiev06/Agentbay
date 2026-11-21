import { fieldsOf, readYaml, type Json, type JsonFields, type ScriptContext } from "../../../../../bay/sdk.ts";
import { counted } from "./card-lines.ts";
import { designSummaryOf, type DesignSummary } from "./design-summary.ts";
import { listOf, textOf } from "./json-values.ts";
import type { Plan } from "./plan.ts";
import type { Conditions } from "./plan-conditions.ts";
import { conditionsOf, requirementsOf } from "./requirements-form.ts";

export type Sources = {
  readonly conditions?: Conditions;
  readonly design?: DesignSummary;
};

export type SourceProblem = {
  readonly kind: "requirements not accepted" | "design not read";
  readonly level: "error";
  readonly file: string;
  readonly sentence: string;
};

type SourcesRead = {
  readonly sources: Sources;
  readonly problems: readonly SourceProblem[];
};

export type Given = {
  readonly file: string;
  readonly requirements: Json;
  readonly design: string;
  readonly document: Json;
};

export function givenOf(value: Json): Given {
  const fields = fieldsOf(value);
  return {
    file: textOf(fields.file),
    requirements: fields.requirements ?? null,
    design: textOf(fields.design),
    document: fields.document ?? null,
  };
}

export function plannerAsked(start: Json, adds: JsonFields): JsonFields {
  const { file = null, requirements = null, design = null, document = null, practices = null } = fieldsOf(start);
  return { file, requirements, design, document, practices, ...adds };
}

const nothingNamed: SourcesRead = { sources: {}, problems: [] };

function conditionsGiven(file: string, requirements: Json): Conditions {
  return { file, ids: conditionsOf(requirementsOf(requirements)) };
}

export type Both = {
  readonly conditions: Conditions;
  readonly design: DesignSummary;
};

export function sourcesGiven(given: Given): Both {
  return {
    conditions: conditionsGiven(given.file, given.requirements),
    design: designSummaryOf(given.design, given.document),
  };
}

function refusedRequirements(file: string, why: string): SourcesRead {
  const sentence =
    `The plan names the requirements ${file}, which forge could not use: ${why} ` +
    "Correct the file, or name the requirements the plan was cut from.";
  return { sources: {}, problems: [{ kind: "requirements not accepted", level: "error", file, sentence }] };
}

async function requirementsRead(context: ScriptContext, file: string): Promise<SourcesRead> {
  const checked = await context.call("requirements.check", { file });
  if (!checked.ok) {
    return refusedRequirements(file, checked.message);
  }
  const answer = fieldsOf(checked.value);
  if (answer.answer !== "accepted") {
    const problems = listOf(answer.problems).length;
    return refusedRequirements(file, `requirements.check refused it for ${counted(problems, "problem")}.`);
  }
  return { sources: { conditions: conditionsGiven(file, answer.requirements ?? null) }, problems: [] };
}

function unreadDesign(file: string, why: string): SourcesRead {
  const sentence =
    `The plan names the design ${file}, which forge could not read: ${why} ` +
    "Name the design.yaml the design workflow committed.";
  return { sources: {}, problems: [{ kind: "design not read", level: "error", file, sentence }] };
}

async function designRead(context: ScriptContext, file: string): Promise<SourcesRead> {
  const text = await context.files.read(file);
  if (!text.ok) {
    return unreadDesign(file, text.message);
  }
  const read = readYaml(text.value);
  if (!read.ok) {
    return unreadDesign(file, read.problems.map((problem) => problem.message).join(" "));
  }
  const design = designSummaryOf(file, read.value);
  if (design.modules.length === 0) {
    return unreadDesign(file, "it names no module, so it is not a design the design workflow committed.");
  }
  return { sources: { design }, problems: [] };
}

export async function readSources(context: ScriptContext, plan: Plan): Promise<SourcesRead> {
  const requirements =
    plan.requirements === undefined ? nothingNamed : await requirementsRead(context, plan.requirements);
  const design = plan.design === undefined ? nothingNamed : await designRead(context, plan.design);
  return {
    sources: { ...requirements.sources, ...design.sources },
    problems: [...requirements.problems, ...design.problems],
  };
}
