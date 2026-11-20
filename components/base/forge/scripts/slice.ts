import { defineScript, fieldsOf, type Json, type JsonFields } from "../../../../bay/sdk.ts";
import { namedTests } from "./lib/handed-tests.ts";
import { sliceOf, type Slice } from "./lib/slice-form.ts";
import { startCard, type InterfaceFiles } from "./lib/start-card.ts";
import { startChoices } from "./lib/start-choices.ts";
import { withToolChecks } from "./lib/tool-checks.ts";
import { droppedOf, type Dropped } from "./lib/branch-endings.ts";

type Asked = {
  readonly request: JsonFields;
  readonly planter: boolean;
  readonly leftovers: readonly Dropped[];
};

type Starting = {
  readonly slice: Slice;
  readonly title: string;
  readonly base: string;
  readonly bugs: readonly string[];
  readonly interface: readonly string[];
  readonly leftovers: readonly Dropped[];
};

function askedOf(input: Json): Asked {
  const fields = fieldsOf(input);
  return fields.planter === true
    ? { request: fieldsOf(fields.request ?? null), planter: true, leftovers: droppedOf(fields.leftovers) }
    : { request: fields, planter: false, leftovers: [] };
}

function bugNames(bugs: Json | undefined): readonly string[] {
  const listed = Array.isArray(bugs) ? bugs : [];
  return listed.map((bug: Json) => fieldsOf(bug).name).filter((name) => typeof name === "string");
}

function pathsOf(value: Json | undefined): readonly string[] {
  return Array.isArray(value) ? value.filter((path) => typeof path === "string") : [];
}

function oneSliceCard(starting: Starting): JsonFields {
  const card = startCard({ ...starting, planter: "none", interface: "not asked" });
  return { card };
}

function roundsCard(starting: Starting, slice: Json): JsonFields {
  const agreed: InterfaceFiles = starting.interface.length > 0 ? "named" : "none";
  const choices = startChoices(starting.interface, starting.leftovers);
  const card = startCard({ ...starting, planter: "runs", interface: agreed });
  return { card: { ...card, withheld: choices.withheld }, offered: choices.offered, proved: withToolChecks(slice) };
}

export const run = defineScript((input) => {
  const { request, planter, leftovers } = askedOf(input);
  const planned = fieldsOf(request.planned ?? null);
  const slice = planned.slice ?? null;
  const base = typeof request.base === "string" ? request.base : "";
  const starting = {
    slice: sliceOf(slice),
    title: typeof planned.title === "string" ? planned.title : "",
    base,
    bugs: bugNames(request.bugs),
    interface: pathsOf(request.interface),
    leftovers,
  };
  const shown = planter ? roundsCard(starting, slice) : oneSliceCard(starting);
  const fixed = namedTests(starting.slice);
  const bugs = request.bugs ?? [];
  return Promise.resolve({ slice, base, bugs, interface: [...starting.interface], fixed, ...shown });
});
