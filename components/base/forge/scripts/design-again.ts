import { defineScript, fail, fieldsOf } from "../../../../bay/sdk.ts";
import { challengeOf } from "./lib/challenge-answer.ts";
import { answeringStance } from "./lib/design-again.ts";
import { textOf } from "./lib/json-values.ts";
import { pathOf, stanceOf } from "./lib/path-card.ts";
import { askedWhenNeeded, foundOf, secondPassNeeded } from "./lib/second-round.ts";

export const run = defineScript(async (input, context) => {
  const fields = fieldsOf(input);
  const designs = fieldsOf(fields.designs ?? null);
  const first = fields.challenge ?? null;
  const challenge = challengeOf(first);
  const chosen = fieldsOf(first).design ?? null;
  const path =
    pathOf(textOf(designs.path)) ??
    fail(
      `The designs step names the path "${textOf(designs.path)}", which is neither light nor full, so no designer ` +
        "is asked again.",
    );
  const asked = {
    file: textOf(fields.file),
    requirements: fields.requirements ?? null,
    stance: stanceOf(answeringStance(path, challenge.chosen)),
    practices: designs.practices ?? [],
    answering: { design: chosen, ...foundOf(challenge) },
  };
  const round = await askedWhenNeeded(context, {
    needed: secondPassNeeded(challenge),
    action: "design",
    asked,
    kept: chosen,
  });
  return { answered: round.ran, design: round.answer };
});
