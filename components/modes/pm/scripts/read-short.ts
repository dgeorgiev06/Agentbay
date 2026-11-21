import { defineScript, fieldsOf } from "../../../../bay/sdk.ts";
import { textAt } from "./lib/json.ts";
import { shortReading } from "./lib/reading.ts";
import { turnOf } from "./lib/turn.ts";

export const run = defineScript((input) => {
  const reading = shortReading(turnOf(fieldsOf(input).turn ?? null), textAt(input, "said"));
  return Promise.resolve(reading === undefined ? { short: false } : { short: true, reading });
});
