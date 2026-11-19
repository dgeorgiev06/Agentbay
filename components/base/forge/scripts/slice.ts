import { defineScript, fieldsOf, type Json } from "../../../../bay/sdk.ts";
import { sliceOf, startCard } from "./lib/cards.ts";
import { namedTests } from "./lib/handed-tests.ts";

function bugNames(bugs: Json | undefined): readonly string[] {
  const listed = Array.isArray(bugs) ? bugs : [];
  return listed.map((bug: Json) => fieldsOf(bug).name).filter((name) => typeof name === "string");
}

function pathsOf(value: Json | undefined): readonly string[] {
  return Array.isArray(value) ? value.filter((path) => typeof path === "string") : [];
}

export const run = defineScript((input) => {
  const fields = fieldsOf(input);
  const planned = fieldsOf(fields.planned ?? null);
  const slice = planned.slice ?? null;
  const base = typeof fields.base === "string" ? fields.base : "";
  const title = typeof planned.title === "string" ? planned.title : "";
  const read = sliceOf(slice);
  const card = startCard({ slice: read, title, base, bugs: bugNames(fields.bugs) });
  const fixed = namedTests(read);
  return Promise.resolve({ slice, base, bugs: fields.bugs ?? [], interface: pathsOf(fields.interface), fixed, card });
});
