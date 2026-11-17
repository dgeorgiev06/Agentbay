import { join } from "node:path/posix";
import { refused } from "../answers.ts";
import type { Json, Permissions, RunEvent, Submission } from "../contracts.ts";
import { submissionRefusal } from "../broker/broker.ts";
import { textField } from "../json.ts";
import { failedWith, problemText, type Outcome, type Problem } from "../outcome.ts";
import type { ActionTarget, Schema, SkillUse } from "../manifests/manifests.ts";
import type { StepRecord } from "./run-store.ts";
import type { SkillTask } from "./run-state.ts";
import type { SkillDetail } from "./step-detail.ts";
import { skillRoundKey } from "./step-key.ts";
import type { Services } from "./walk.ts";

export type StartedSkill = Extract<StepRecord, { readonly kind: "skill"; readonly status: "started" }>;

export type SkillAt = {
  readonly runId: string;
  readonly key: string;
  readonly input: Json;
  readonly detail: SkillDetail;
};

type TaskContext = {
  readonly folder: string;
  readonly permissions: Permissions;
  readonly events: readonly RunEvent[];
};

export function startedSkillOf(record: StepRecord | undefined): StartedSkill | undefined {
  return record?.kind === "skill" && record.status === "started" ? record : undefined;
}

export const toolCalledKind = "tool.called";

export function toolCallsAt(events: readonly RunEvent[], waitingKey: string): number {
  return events.filter((event) => event.kind === toolCalledKind && textField(event.detail, "stepKey") === waitingKey)
    .length;
}

export function skillTaskOf(at: SkillAt, context: TaskContext): SkillTask {
  const { detail } = at;
  const { folder } = context;
  const stepKey = skillRoundKey(at.key, detail.round);
  const outputSchema = detail.schemas[0] ?? "";
  return {
    runId: at.runId,
    stepKey,
    round: detail.round,
    feedback: detail.feedback,
    skill: detail.skill,
    tier: detail.tier,
    input: at.input,
    files: {
      skill: join(folder, detail.skill, "SKILL.md"),
      outputSchema: outputSchema === "" ? "" : join(folder, outputSchema),
      alsoMatches: detail.schemas.slice(1).map((schema) => join(folder, schema)),
    },
    place: { runId: at.runId, mode: detail.mode, action: detail.action, stepKey: at.key },
    permissions: context.permissions,
    toolCalls: toolCallsAt(context.events, stepKey),
  };
}

function outputSchemasOf(skill: SkillUse, target: ActionTarget): ReadonlyMap<string, Schema> {
  const own = skill.frontMatter.metadata?.output;
  const schemas = new Map([[target.action.output, target.output]]);
  return own === undefined || skill.output === undefined ? schemas : new Map([[own, skill.output], ...schemas]);
}

export async function skillSchemas(
  target: ActionTarget,
  at: { readonly skill: string; readonly last: boolean },
): Promise<readonly string[] | string> {
  const skill = await target.mode.skill(at.skill);
  if (!skill.ok) {
    return `The skill ${join(target.mode.folder, at.skill, "SKILL.md")} cannot be read: ${problemText(skill.problems)}`;
  }
  const own = skill.value.frontMatter.metadata?.output;
  const outputs = [...(own === undefined ? [] : [own]), ...(at.last ? [target.action.output] : [])];
  return [...new Set(outputs)];
}

function submittedSpendProblems(
  target: ActionTarget,
  record: StartedSkill,
  submission: Submission,
): readonly Problem[] {
  const { action, round } = record.detail;
  const effects = target.action.effects;
  const manifest = join(target.mode.folder, "mode.yaml");
  const at = { stepKey: skillRoundKey(record.key, round), action, manifest };
  const wording = submissionRefusal(submission.spent.usd, effects, at);
  return wording === undefined ? [] : [{ file: manifest, path: "", message: refused(wording).message }];
}

function unnamedSchema(target: ActionTarget, record: StartedSkill, path: string): Outcome<Json> {
  const file = join(target.mode.folder, path);
  const { skill, mode, action } = record.detail;
  const message =
    `The schema file ${file} is no longer named by the skill ${skill} or the action ${mode}.${action}, ` +
    "so the output is not checked.";
  return failedWith([{ file, path: "", message }]);
}

export async function submissionProblems(
  services: Services,
  record: StartedSkill,
  submission: Submission,
): Promise<readonly Problem[]> {
  const target = services.system.action(`${record.detail.mode}.${record.detail.action}`);
  if (!target.ok) {
    return target.problems;
  }
  const skill = await target.value.mode.skill(record.detail.skill);
  if (!skill.ok) {
    return skill.problems;
  }
  const schemas = outputSchemasOf(skill.value, target.value);
  const problems: Problem[] = [...submittedSpendProblems(target.value, record, submission)];
  for (const path of record.detail.schemas) {
    const checked = schemas.get(path)?.check(submission.output) ?? unnamedSchema(target.value, record, path);
    problems.push(...(checked.ok ? [] : checked.problems));
  }
  return problems;
}
