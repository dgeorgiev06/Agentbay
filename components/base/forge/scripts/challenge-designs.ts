import { defineScript, fieldsOf, type Json, type ScriptContext } from "../../../../bay/sdk.ts";
import { answerOf } from "./lib/called.ts";
import { challengeOf, type Challenge } from "./lib/challenge-answer.ts";
import { readIn } from "./lib/code.ts";
import { differences } from "./lib/design-compare.ts";
import { designOf } from "./lib/design-form.ts";
import { listOf, textOf, textsOf } from "./lib/json-values.ts";
import { designPractices, type Practice } from "./lib/practices.ts";
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

type Read = {
  readonly folder: string;
  readonly practices: readonly Practice[];
};

async function practicesAt(context: ScriptContext, asked: Asked, job: string): Promise<Read> {
  const cut = await answerOf(context, "worktrees.cut", { slice: `${job}-practices`, base: asked.into });
  const folder = textOf(cut.folder);
  const files = await Promise.all(asked.practices.map((path) => readIn(context, folder, path)));
  return { folder, practices: files.flatMap((file) => designPractices(file.text)) };
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
  const { folder, practices } = await practicesAt(context, asked, requirements.job);
  const answer = await answerOf(context, "challenge", {
    file: asked.file,
    requirements: asked.requirements,
    designs: [...asked.designs],
    differences: [...compared],
    practices: [...practices],
  });
  await answerOf(context, "worktrees.remove", { folder, branchAfter: "kept" });
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
