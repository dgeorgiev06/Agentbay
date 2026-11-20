import { defineScript, fieldsOf } from "../../../../bay/sdk.ts";
import { bugsOnCard } from "./lib/bug-card.ts";
import { builtOf } from "./lib/builder-answer.ts";
import { drawn } from "./lib/merge-card.ts";
import { provedOf } from "./lib/proof-answer.ts";
import { sliceOf } from "./lib/slice-form.ts";
import { bugsOf } from "./lib/planting.ts";
import { roundsOnCard } from "./lib/round-card.ts";
import { roundsStateOf } from "./lib/rounds.ts";

export const run = defineScript((input) => {
  const fields = fieldsOf(input);
  const branch = (key: "work" | "into"): string => {
    const value = fields[key];
    return typeof value === "string" ? value : "";
  };
  const rounds = roundsStateOf(fields.rounds);
  const proof = provedOf(fields.proof);
  const planted = typeof fields.planted === "number" ? fields.planted : 0;
  const bugs = fields.bugs === undefined ? {} : { bugs: bugsOnCard(bugsOf(fields.bugs), proof.verdicts, planted) };
  const merge = drawn({
    slice: sliceOf(fields.slice),
    proof,
    built: builtOf(fields.built),
    builtAt: rounds?.builtAt ?? "build",
    work: branch("work"),
    kept: fields.kept === "with-tests" ? "with-tests" : "set-aside",
    into: branch("into"),
    ...(rounds === undefined ? {} : { rounds: roundsOnCard(rounds), leaks: rounds.leaks }),
    ...bugs,
  });
  return Promise.resolve(merge);
});
