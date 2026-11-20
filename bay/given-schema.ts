import type { Answer } from "./answers.ts";
import type { Json } from "./contracts.ts";
import { deepestNesting, isJson } from "./protocol-json.ts";
import { checkValue, pointer, schemaCheckOf, type PathSegments, type SchemaCheck } from "./value-check.ts";

const largestGivenSchema = 65_536;

const mostUnfoldedParts = 65_536;

const referenceKeywords = ["$ref", "$dynamicRef", "$recursiveRef"] as const;

type JsonFields = { readonly [key: string]: Json };

type Mapping = {
  readonly path: PathSegments;
  readonly fields: JsonFields;
};

type Reference = {
  readonly path: PathSegments;
  readonly keyword: (typeof referenceKeywords)[number];
  readonly target: string;
};

type Unfolding = {
  readonly value: Json | undefined;
  readonly followed: readonly string[];
};

function isJsonFields(value: Json | undefined): value is JsonFields {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isJsonList(value: Json | undefined): value is readonly Json[] {
  return Array.isArray(value);
}

function stepInto(value: Json | undefined, step: string): Json | undefined {
  if (isJsonList(value)) {
    return /^(0|[1-9][0-9]*)$/.test(step) ? value[Number(step)] : undefined;
  }
  return isJsonFields(value) && Object.hasOwn(value, step) ? value[step] : undefined;
}

export function partAt(value: Json, location: string): Json | undefined {
  if (location === "") {
    return value;
  }
  const steps = location
    .slice(1)
    .split("/")
    .map((step) => step.replaceAll("~1", "/").replaceAll("~0", "~"));
  return steps.reduce<Json | undefined>(stepInto, value);
}

function mappingsWithin(value: Json): readonly Mapping[] {
  const mappings: Mapping[] = [];
  const waiting: { readonly path: PathSegments; readonly value: Json }[] = [{ path: [], value }];
  for (let index = 0; index < waiting.length; index += 1) {
    const next = waiting[index];
    if (isJsonList(next?.value)) {
      waiting.push(...next.value.map((item, at) => ({ path: [...next.path, at], value: item })));
    } else if (next !== undefined && isJsonFields(next.value)) {
      mappings.push({ path: next.path, fields: next.value });
      waiting.push(...Object.entries(next.value).map(([key, item]) => ({ path: [...next.path, key], value: item })));
    }
  }
  return mappings;
}

export function referencesWithin(schema: Json): readonly Reference[] {
  return mappingsWithin(schema).flatMap(({ path, fields }) =>
    referenceKeywords.flatMap((keyword) => {
      const target = fields[keyword];
      return typeof target === "string" ? [{ path: [...path, keyword], keyword, target }] : [];
    }),
  );
}

function ownPointer(target: string): string | undefined {
  if (target !== "#" && !target.startsWith("#/")) {
    return undefined;
  }
  try {
    return decodeURIComponent(target.slice(1));
  } catch {
    return undefined;
  }
}

function referenceFault(schema: Json, reference: Reference): string | undefined {
  const { target } = reference;
  const at = pointer(reference.path);
  const own = ownPointer(target);
  if (own === undefined) {
    return (
      `refers to ${target} at ${at}, outside itself; a given schema may refer only to its own parts, ` +
      "written #/<path>, and nothing outside it is read"
    );
  }
  if (partAt(schema, own) === undefined) {
    return `refers to ${target} at ${at}, which names none of its parts; refer to a part it has, such as #/$defs/<name>`;
  }
  return undefined;
}

function innerIdFault(schema: Json): string | undefined {
  const scoped = mappingsWithin(schema).find(({ path, fields }) => path.length > 0 && typeof fields.$id === "string");
  if (scoped === undefined) {
    return undefined;
  }
  return (
    `sets $id at ${pointer(scoped.path)}; a given schema may set $id only at its top, ` +
    "so that each #/ reference names a part of the whole schema"
  );
}

function isReferenceKeyword(key: string): boolean {
  return referenceKeywords.some((keyword) => keyword === key);
}

function followedInPlace(schema: Json, entry: readonly [string, Json], followed: readonly string[]): Unfolding {
  const [key, inner] = entry;
  const target = isReferenceKeyword(key) && typeof inner === "string" ? inner : undefined;
  const own = target === undefined ? undefined : ownPointer(target);
  if (target === undefined || own === undefined || followed.includes(target)) {
    return { value: inner, followed };
  }
  return { value: partAt(schema, own), followed: [...followed, target] };
}

function partsInside(schema: Json, unfolding: Unfolding): readonly Unfolding[] {
  const { value, followed } = unfolding;
  if (isJsonList(value)) {
    return value.map((item) => ({ value: item, followed }));
  }
  if (!isJsonFields(value)) {
    return [];
  }
  return Object.entries(value).map((entry) => followedInPlace(schema, entry, followed));
}

function growsPastLimit(schema: Json): boolean {
  const waiting: Unfolding[] = [{ value: schema, followed: [] }];
  let parts = 0;
  for (let next = waiting.pop(); next !== undefined; next = waiting.pop()) {
    parts += 1;
    if (parts > mostUnfoldedParts) {
      return true;
    }
    waiting.push(...partsInside(schema, next));
  }
  return false;
}

function givenSchemaFault(schema: Json): string | undefined {
  if (!isJson(schema)) {
    return (
      `is nested more than ${String(deepestNesting)} levels deep, deeper than the kernel reads; ` +
      "name deep parts under $defs and refer to them"
    );
  }
  const size = JSON.stringify(schema).length;
  if (size > largestGivenSchema) {
    return (
      `is ${String(size)} characters long as JSON, longer than the ${String(largestGivenSchema)} a given schema ` +
      "may be; make it shorter, such as by naming a repeated part once under $defs"
    );
  }
  const referenceFaults = referencesWithin(schema).flatMap((reference) => referenceFault(schema, reference) ?? []);
  const fault = referenceFaults[0] ?? innerIdFault(schema);
  if (fault !== undefined) {
    return fault;
  }
  if (!growsPastLimit(schema)) {
    return undefined;
  }
  return (
    `grows past ${String(mostUnfoldedParts)} parts when each of its references is followed in place, ` +
    "so checking a value against it could run without end; refer to shared parts from fewer places"
  );
}

function givenRefused(clause: string): Answer<SchemaCheck> {
  return { ok: false, kind: "failed", message: `The schema given ${clause}.` };
}

export function checkedAgainst(schema: Json, value: Json): Answer<SchemaCheck> {
  const fault = givenSchemaFault(schema);
  if (fault !== undefined) {
    return givenRefused(fault);
  }
  const loaded = { file: "", value, lineOf: () => undefined };
  const result = checkValue({ state: "valid", schema, parts: {} }, value, { loaded, path: [], whole: "The value" });
  if (result.kind === "unusable-schema") {
    return givenRefused(`is not a usable JSON Schema: ${result.reason}`);
  }
  return { ok: true, value: schemaCheckOf(value, result.problems) };
}
