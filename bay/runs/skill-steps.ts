import { join } from "node:path/posix";
import { refused } from "../answers.ts";
import type { Json, Permissions, SkillTask, Submission } from "../contracts.ts";
import { effectRefusal } from "../effect-rule.ts";
import { problemText, unplacedProblem, type Problem } from "../outcome.ts";
import type { LoadedMode } from "../registry.ts";
import type { StepRecord } from "./run-store.ts";
import { parseSkill } from "../spec.ts";
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

export function startedSkillOf(record: StepRecord | undefined): StartedSkill | undefined {
  return record?.kind === "skill" && record.status === "started" ? record : undefined;
}

export function skillTaskOf(at: SkillAt, permissions: Permissions): SkillTask {
  const { detail } = at;
  return {
    place: { runId: at.runId, mode: detail.mode, action: detail.action, stepKey: at.key },
    skill: detail.skill,
    tier: detail.tier,
    input: at.input,
    outputSchema: detail.schemas[0] ?? "",
    alsoMatches: detail.schemas.slice(1),
    permissions,
    round: detail.round,
    feedback: detail.feedback,
  };
}

export async function skillSchemas(
  services: Services,
  mode: LoadedMode,
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

function submittedSpendProblems(mode: LoadedMode, record: StartedSkill, submission: Submission): readonly Problem[] {
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
