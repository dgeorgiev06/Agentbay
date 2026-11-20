import { fieldsOf, type Json } from "../../../../../bay/sdk.ts";
import { listOf, textOf, textsOf } from "./json-values.ts";
import { onlyChecks } from "./tool-checks.ts";

export type ToJoin = {
  readonly name: string;
  readonly head: string;
  readonly slice: Json;
  readonly declared: Json;
  readonly included: boolean;
};

export type WaveNamed = {
  readonly name: string;
  readonly base: string;
};

const waveChecksItem = {
  id: "checks",
  says: "The toolchain's checks and the whole test run pass on the wave's slices combined.",
  level: "must",
  proof: { kind: "checks" },
};

const nameKinds = ["gained", "lost", "changed"] as const;

export function toJoinOf(settled: Json): ToJoin {
  const fields = fieldsOf(settled);
  return {
    name: textOf(fields.name),
    head: textOf(fields.head),
    slice: fields.slice ?? null,
    declared: fields.declared ?? null,
    included: typeof fields.reason !== "string",
  };
}

export function slicesToJoin(slices: Json): readonly ToJoin[] {
  return listOf(slices).map(toJoinOf);
}

function unionOf(lists: readonly (readonly string[])[]): readonly string[] {
  return [...new Set(lists.flat())];
}

function declaredOf(joined: readonly ToJoin[]): Json {
  const declared = joined.map((each) => fieldsOf(each.declared));
  const names = declared.map((each) => fieldsOf(each.names ?? null));
  const unionAt = (kind: (typeof nameKinds)[number]): readonly string[] =>
    unionOf(names.map((each) => textsOf(each[kind])));
  return {
    files: [...unionOf(declared.map((each) => textsOf(each.files)))],
    names: Object.fromEntries(nameKinds.map((kind) => [kind, [...unionAt(kind)]])),
  };
}

export function waveProofRequest(wave: WaveNamed, joined: readonly ToJoin[], head: string): Json {
  const scope = unionOf(joined.map((each) => textsOf(fieldsOf(each.slice).scope)));
  const kind = textOf(fieldsOf(joined[0]?.slice ?? null).kind);
  const slice = { name: wave.name, kind, scope: [...scope], after: [], done: [waveChecksItem] };
  return { slice, base: wave.base, head, declared: declaredOf(joined), bugs: [] };
}

function aloneRequest(wave: WaveNamed, joined: ToJoin): Json {
  const asked = {
    slice: onlyChecks(joined.slice),
    base: wave.base,
    head: joined.head,
    declared: joined.declared,
    bugs: [],
  };
  return { kind: "asked", asked, keptOf: [joined.name], whenFailed: [] };
}

export function proving(wave: WaveNamed, joined: readonly ToJoin[], head: string): Json {
  return {
    kind: "asked",
    asked: waveProofRequest(wave, joined, head),
    keptOf: joined.map((each) => each.name),
    whenFailed: joined.map((each) => aloneRequest(wave, each)),
  };
}
