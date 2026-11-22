import { defineScript, fail, fieldsOf, type Json, type JsonFields } from "../../../../bay/sdk.ts";
import { gateOf, type Gate } from "./lib/gate.ts";
import { claimSentence } from "./lib/gate-words.ts";
import { namedTests } from "./lib/handed-tests.ts";
import { textsOf } from "./lib/json-values.ts";
import { sliceOf, type Slice } from "./lib/slice-form.ts";
import { startCard, type GateShown, type InterfaceFiles } from "./lib/start-card.ts";
import { startChoices } from "./lib/start-choices.ts";
import { testsFromNamed, withGateSaid, withToolChecks } from "./lib/tool-checks.ts";
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
  readonly gate: GateShown;
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

function gatedOf(slice: Json): { readonly gate: Gate; readonly said: Json } {
  const form = sliceOf(slice);
  const claimed = testsFromNamed(slice);
  if (claimed.length > 0) {
    return fail(claimSentence(form.name, claimed));
  }
  const gate = gateOf([form]);
  return { gate, said: withGateSaid(slice, gate) };
}

function startingOf(asked: Asked, said: Json, gate: GateShown): Starting {
  const { request, leftovers } = asked;
  const planned = fieldsOf(request.planned ?? null);
  return {
    slice: sliceOf(said),
    title: typeof planned.title === "string" ? planned.title : "",
    base: typeof request.base === "string" ? request.base : "",
    bugs: bugNames(request.bugs),
    interface: pathsOf(request.interface),
    leftovers,
    gate,
  };
}

export const run = defineScript((input, context) => {
  const asked = askedOf(input);
  const { request, planter } = asked;
  const slice = fieldsOf(request.planned ?? null).slice ?? null;
  const { gate, said } = gatedOf(slice);
  const starting = startingOf(asked, said, { gate, alsoRun: textsOf(context.settings.modeGateTests) });
  const { base } = starting;
  const shown = planter ? roundsCard(starting, slice) : oneSliceCard(starting);
  const fixed = namedTests(starting.slice);
  const bugs = request.bugs ?? [];
  const { rules = [], examples = [] } = request;
  const handed = {
    slice,
    base,
    bugs,
    interface: [...starting.interface],
    rules,
    examples,
    fixed,
  };
  return Promise.resolve({ ...handed, ...shown });
});
