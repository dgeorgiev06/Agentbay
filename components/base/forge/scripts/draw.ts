import { defineScript, fieldsOf } from "../../../../bay/sdk.ts";
import { builtOf, drawn, provedOf, sliceOf } from "./lib/cards.ts";
import { roundsOnCard } from "./lib/round-card.ts";
import { roundsStateOf } from "./lib/rounds.ts";

export const run = defineScript((input) => {
  const fields = fieldsOf(input);
  const branch = (key: "work" | "into"): string => {
    const value = fields[key];
    return typeof value === "string" ? value : "";
  };
  const rounds = roundsStateOf(fields.rounds);
  const merge = drawn({
    slice: sliceOf(fields.slice),
    proof: provedOf(fields.proof),
    built: builtOf(fields.built),
    work: branch("work"),
    kept: fields.kept === "with-tests" ? "with-tests" : "set-aside",
    into: branch("into"),
    ...(rounds === undefined ? {} : { rounds: roundsOnCard(rounds) }),
  });
  return Promise.resolve(merge);
});
