import { join } from "node:path/posix";
import { refused } from "../answers.ts";
import type { Json, Permissions, RunEvent, Submission } from "../contracts.ts";
import { effectRefusal } from "../effect-rule.ts";
import { textField } from "../json.ts";
import { problemText, unplacedProblem, type Problem } from "../outcome.ts";
import type { ActiveMode } from "../manifests/manifests.ts";
import type { StepRecord } from "./run-store.ts";
import type { SkillTask } from "./run-state.ts";
import { parseSkill } from "../manifests/spec.ts";
import type { SkillDetail } from "./step-detail.ts";
import { skillRoundKey } from "./step-key.ts";
import { schemaProblems, type Services } from "./walk.ts";

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

export async function skillSchemas(
  services: Services,
  mode: ActiveMode,
  at: { readonly skill: string; readonly actionOutput: string | undefined },
): Promise<readonly string[] | string> {
  const file = join(mode.folder, at.skill, "SKILL.md");
  const parsed = await parseSkill(services.files, file);
  if (!parsed.ok) {
    return `The skill ${file} cannot be read: ${problemText(parsed.problems)}`;
  }
  const own = parsed.value.frontMatter.metadata?.output;
  const outputs = [...(own === undefined ? [] : [own]), ...(at.actionOutput === undefined ? [] : [at.actionOutput])];
  return [...new Set(outputs)];
}

function submittedSpendProblems(mode: ActiveMode, record: StartedSkill, submission: Submission): readonly Problem[] {
  const { action, round } = record.detail;
  const effects = mode.manifest.actions[action]?.effects ?? [];
  const manifest = join(mode.folder, "mode.yaml");
  const at = { stepKey: skillRoundKey(record.key, round), action, manifest };
  const wording = effectRefusal({ kind: "skill.submit", usd: submission.spent.usd }, effects, at);
  return wording === undefined ? [] : [{ file: manifest, path: "", message: refused(wording).message }];
}

export async function submissionProblems(
  services: Services,
  record: StartedSkill,
  submission: Submission,
): Promise<readonly Problem[]> {
  const mode = services.system.modes.get(record.detail.mode);
  if (mode === undefined) {
    return [unplacedProblem(`The skill step ${record.key} belongs to mode ${record.detail.mode}, which is gone.`)];
  }
  const problems: Problem[] = [...submittedSpendProblems(mode, record, submission)];
  for (const schema of record.detail.schemas) {
    const check = { mode, schema, value: submission.output, label: "output" };
    problems.push(...(await schemaProblems(services, check)));
  }
  return problems;
}
