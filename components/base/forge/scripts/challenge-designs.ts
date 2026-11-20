import { defineScript, fieldsOf, type Json } from "../../../../bay/sdk.ts";
import { answerOf } from "./lib/called.ts";
import { challengeOf, type Challenge } from "./lib/challenge-answer.ts";
import { whileOnBranch } from "./lib/branch-files.ts";
import { differences } from "./lib/design-compare.ts";
import { designOf } from "./lib/design-form.ts";
import { listOf, textOf, textsOf } from "./lib/json-values.ts";
import { designPractices } from "./lib/practices.ts";
import { conditionsOf, requirementsOf, type Requirements } from "./lib/requirements-form.ts";

type Asked = {
  readonly file: string;
  readonly requirements: Json;
  readonly path: string;
  readonly designs: readonly Json[];
  readonly practices: readonly string[];
  readonly into: string;
};

function askedOf(input: Json): Asked {
  const fields = fieldsOf(input);
  const designs = fieldsOf(fields.designs ?? null);
  return {
    file: textOf(fields.file),
    requirements: fields.requirements ?? null,
    path: textOf(designs.path),
    designs: listOf(designs.designs),
    practices: textsOf(fields.practices),
    into: textOf(fields.into),
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
  const requirements = requirementsOf(asked.requirements);
  const compared = differencesOf(asked, requirements);
  const onBranch = { slice: `${requirements.job}-practices`, branch: asked.into, paths: asked.practices };
  const answer = await whileOnBranch(context, onBranch, (files) =>
    answerOf(context, "challenge", {
      file: asked.file,
      requirements: asked.requirements,
      designs: [...asked.designs],
      differences: [...compared],
      practices: files.flatMap((file) => designPractices(file.text)).map((practice) => ({ ...practice })),
    }),
  );
  const challenge = challengeOf(answer);
  return {
    path: asked.path,
    chosen: challenge.chosen,
    because: challenge.because,
    design: chosenDesign(asked, challenge),
    practices: challenge.practices.map((practice) => ({ ...practice })),
    differences: [...compared],
  };
});
