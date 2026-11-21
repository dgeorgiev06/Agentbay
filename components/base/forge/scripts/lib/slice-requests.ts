import { fieldsOf, type Json, type JsonFields } from "../../../../../bay/sdk.ts";
import { rulesApplied, rulesDocument, type DesignSummary } from "./design-summary.ts";
import { listOf, textOf, textsOf } from "./json-values.ts";

type Cut = {
  readonly base: string;
  readonly design?: DesignSummary | undefined;
};

function rulesOf(files: readonly string[], design: DesignSummary | undefined): JsonFields {
  return design === undefined ? {} : { rules: rulesDocument(rulesApplied(files, design)) };
}

function requestOf(planned: JsonFields, cut: Cut): Json {
  const { title = null, slice = null } = planned;
  const files = textsOf(planned.interface);
  return { planned: { title, slice }, base: cut.base, bugs: [], interface: [...files], ...rulesOf(files, cut.design) };
}

export function sliceRequests(plan: Json, names: readonly string[], cut: Cut): readonly Json[] {
  const slices = listOf(fieldsOf(plan).slices).map(fieldsOf);
  const named = (name: string): readonly JsonFields[] =>
    slices.filter((planned) => textOf(fieldsOf(planned.slice ?? null).name) === name);
  return names.flatMap(named).map((planned) => requestOf(planned, cut));
}
