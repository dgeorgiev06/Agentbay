import { fail, fieldsOf, type Json } from "../../../../../bay/sdk.ts";
import { counted } from "./card-lines.ts";
import { listOf, numberOf, textOf } from "./json-values.ts";

export type Outcome = {
  readonly id: string;
  readonly says: string;
  readonly conditions: readonly string[];
};

export type Requirements = {
  readonly job: string;
  readonly version: number;
  readonly signedBy: string;
  readonly outcomes: readonly Outcome[];
  readonly leftOut: number;
};

function outcomeOf(value: Json): Outcome {
  const fields = fieldsOf(value);
  const conditions = listOf(fields.conditions).map((condition) => textOf(fieldsOf(condition).id));
  return { id: textOf(fields.id), says: textOf(fields.says), conditions };
}

export function requirementsOf(value: Json): Requirements {
  const fields = fieldsOf(value);
  return {
    job: textOf(fields.job),
    version: numberOf(fields.version),
    signedBy: textOf(fieldsOf(fields.signed ?? null).by),
    outcomes: listOf(fields.outcomes).map(outcomeOf),
    leftOut: listOf(fields.leftOut).length,
  };
}

export function conditionsOf(requirements: Requirements): readonly string[] {
  return requirements.outcomes.flatMap((outcome) => outcome.conditions);
}

function problemWords(value: Json): string {
  const fields = fieldsOf(value);
  const line = typeof fields.line === "number" ? `line ${String(fields.line)}: ` : "";
  return `${line}${textOf(fields.sentence)}`;
}

export type Work = "design" | "plan";

export type Accepted = {
  readonly file: string;
  readonly requirements: Json;
};

function refusedReason(checked: Json, work: Work): string {
  const fields = fieldsOf(checked);
  const problems = listOf(fields.problems);
  const opening =
    `requirements.check refused ${textOf(fields.file)} for ${counted(problems.length, "problem")}, ` +
    `so no ${work} is written; correct each and run the ${work} again:`;
  return [opening, ...problems.map(problemWords)].join(" ");
}

export function acceptedOrStopped(checked: Json, work: Work): Accepted {
  const answer = fieldsOf(checked);
  if (answer.answer !== "accepted") {
    return fail(refusedReason(checked, work));
  }
  return { file: textOf(answer.file), requirements: answer.requirements ?? null };
}
