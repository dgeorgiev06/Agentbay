import { fieldsOf, type Json, type JsonFields } from "../../../../../bay/sdk.ts";
import { listOf, textOf, textsOf } from "./json-values.ts";

function requestOf(planned: JsonFields, base: string): Json {
  const { title = null, slice = null } = planned;
  return { planned: { title, slice }, base, bugs: [], interface: [...textsOf(planned.interface)] };
}

export function sliceRequests(plan: Json, names: readonly string[], base: string): readonly Json[] {
  const slices = listOf(fieldsOf(plan).slices).map(fieldsOf);
  const named = (name: string): readonly JsonFields[] =>
    slices.filter((planned) => textOf(fieldsOf(planned.slice ?? null).name) === name);
  return names.flatMap(named).map((planned) => requestOf(planned, base));
}
