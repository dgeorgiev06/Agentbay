import { defineScript, fieldsOf, type Json, type JsonFields } from "../../../../bay/sdk.ts";
import { sliceOf, startCard } from "./lib/cards.ts";
import { namedTests } from "./lib/handed-tests.ts";

type Asked = {
  readonly request: JsonFields;
  readonly planter: boolean;
};

function askedOf(input: Json): Asked {
  const fields = fieldsOf(input);
  return fields.planter === true
    ? { request: fieldsOf(fields.request ?? null), planter: true }
    : { request: fields, planter: false };
}

function bugNames(bugs: Json | undefined): readonly string[] {
  const listed = Array.isArray(bugs) ? bugs : [];
  return listed.map((bug: Json) => fieldsOf(bug).name).filter((name) => typeof name === "string");
}

function pathsOf(value: Json | undefined): readonly string[] {
  return Array.isArray(value) ? value.filter((path) => typeof path === "string") : [];
}

export const run = defineScript((input) => {
  const { request, planter } = askedOf(input);
  const planned = fieldsOf(request.planned ?? null);
  const slice = planned.slice ?? null;
  const base = typeof request.base === "string" ? request.base : "";
  const title = typeof planned.title === "string" ? planned.title : "";
  const read = sliceOf(slice);
  const card = startCard({
    slice: read,
    title,
    base,
    bugs: bugNames(request.bugs),
    planter: planter ? "runs" : "none",
  });
  const fixed = namedTests(read);
  const bugs = request.bugs ?? [];
  return Promise.resolve({ slice, base, bugs, interface: pathsOf(request.interface), fixed, card });
});
