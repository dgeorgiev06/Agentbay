import { defineScript, fieldsOf, type Json } from "../../../../bay/sdk.ts";
import { branchesSaid, stayedOf } from "./lib/branch-endings.ts";
import { answerOf } from "./lib/called.ts";
import { challengeOf, type Challenge } from "./lib/challenge-answer.ts";
import { differences } from "./lib/design-compare.ts";
import { designOf } from "./lib/design-form.ts";
import { listOf, textOf } from "./lib/json-values.ts";
import { conditionsOf, requirementsOf, type Requirements } from "./lib/requirements-form.ts";

type Asked = {
  readonly file: string;
  readonly requirements: Json;
  readonly path: string;
  readonly designs: readonly Json[];
  readonly practices: readonly Json[];
  readonly stayed: Json;
};

function askedOf(input: Json): Asked {
  const fields = fieldsOf(input);
  const designs = fieldsOf(fields.designs ?? null);
  return {
    file: textOf(fields.file),
    requirements: fields.requirements ?? null,
    path: textOf(designs.path),
    designs: listOf(designs.designs),
    practices: listOf(designs.practices),
    stayed: designs.stayed ?? null,
  };
}

function differencesOf(asked: Asked, requirements: Requirements): readonly string[] {
  const [first, second] = asked.designs;
  if (first === undefined || second === undefined) {
    return [];
  }
  return differences({ first: designOf(first), second: designOf(second) }, conditionsOf(requirements));
}

function chosenDesign(asked: Asked, challenge: Challenge): Json {
  const [first = null, second = null] = asked.designs;
  switch (challenge.chosen) {
    case "first":
      return first;
    case "second":
      return second;
    case "merged":
      return challenge.design ?? null;
  }
}

export const run = defineScript(async (input, context) => {
  const asked = askedOf(input);
  const compared = differencesOf(asked, requirementsOf(asked.requirements));
  const answer = await answerOf(context, "challenge", {
    file: asked.file,
    requirements: asked.requirements,
    designs: [...asked.designs],
    differences: [...compared],
    practices: [...asked.practices],
  });
  const challenge = challengeOf(answer);
  return {
    path: asked.path,
    chosen: challenge.chosen,
    because: challenge.because,
    design: chosenDesign(asked, challenge),
    practices: challenge.practices.map((practice) => ({ ...practice })),
    findings: challenge.findings.map((finding) => ({ ...finding })),
    undecided: challenge.undecided.map((item) => ({ ...item })),
    differences: [...compared],
    ...branchesSaid([], stayedOf(asked.stayed)),
  };
});
