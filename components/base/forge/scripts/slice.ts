import { defineScript, fieldsOf, type Json } from "../../../../bay/sdk.ts";
import { sliceOf, startCard } from "./lib/cards.ts";

function bugNames(bugs: Json | undefined): readonly string[] {
  const listed = Array.isArray(bugs) ? bugs : [];
  return listed.map((bug: Json) => fieldsOf(bug).name).filter((name) => typeof name === "string");
}

export const run = defineScript((input) => {
  const fields = fieldsOf(input);
  const planned = fieldsOf(fields.planned ?? null);
  const slice = planned.slice ?? null;
  const base = typeof fields.base === "string" ? fields.base : "";
  const title = typeof planned.title === "string" ? planned.title : "";
  const card = startCard({ slice: sliceOf(slice), title, base, bugs: bugNames(fields.bugs) });
  return Promise.resolve({ slice, base, bugs: fields.bugs ?? [], card });
});
