import type { Json } from "./contracts.ts";
import { isJson } from "./protocol-json.ts";
import type { FileSystem } from "./ports.ts";
import { partAt, referencesWithin } from "./given-schema.ts";
import type { SchemaFile, SchemaParts, UnfollowedReference } from "./value-check.ts";

export type NameableSchemas = {
  readonly owner: string;
  readonly files: ReadonlyMap<string, string>;
};

type JsonText = { readonly read: true; readonly value: Json } | { readonly read: false; readonly reason: string };

type Part = { readonly name: string; readonly value: Json };

const pointerStart = "/";

function jsonOf(text: string): JsonText {
  try {
    const value: unknown = JSON.parse(text);
    return isJson(value)
      ? { read: true, value }
      : { read: false, reason: "it is nested more than 64 levels deep, deeper than the kernel reads" };
  } catch (error) {
    return { read: false, reason: error instanceof Error ? error.message : String(error) };
  }
}

function externalReferences(schema: Json): readonly string[] {
  const outside = referencesWithin(schema).filter(
    (reference) => reference.keyword === "$ref" && !reference.target.startsWith("#"),
  );
  return [...new Set(outside.map((reference) => reference.target))];
}

function nameable(schemas: NameableSchemas): string {
  const names = [...schemas.files.keys()];
  return names.length === 0 ? "none" : names.join(", ");
}

function notNameable(reference: string, schemas: NameableSchemas): UnfollowedReference {
  return {
    clause: `refers to ${reference}, which names a file ${schemas.owner} may not name`,
    fix:
      `Refer only to a part of a schema of an interface ${schemas.owner} implements or requires, ` +
      `written <interface>@<major>/<file>#<part>: ${nameable(schemas)}.`,
  };
}

function namesNothing(reference: string, name: string, why: string): UnfollowedReference {
  return {
    clause: `refers to ${reference}, which names nothing: ${why}`,
    fix: `Correct the reference to name a part of ${name}, such as ${name}#/$defs/<name>.`,
  };
}

async function partOf(
  files: FileSystem,
  schemas: NameableSchemas,
  reference: string,
): Promise<Part | UnfollowedReference> {
  const [name = "", fragment = ""] = reference.split("#", 2);
  const file = schemas.files.get(name);
  if (file === undefined) {
    return notNameable(reference, schemas);
  }
  const text = await files.readText(file);
  if (text === undefined) {
    return namesNothing(reference, name, `${name} does not exist`);
  }
  const json = jsonOf(text);
  if (!json.read) {
    return namesNothing(reference, name, `${name} is not valid JSON: ${json.reason}`);
  }
  if (fragment !== "" && (!fragment.startsWith(pointerStart) || partAt(json.value, fragment) === undefined)) {
    return namesNothing(reference, name, `${name} has no part ${fragment}`);
  }
  return { name, value: json.value };
}

function isPart(found: Part | UnfollowedReference): found is Part {
  return "value" in found;
}

function isUnfollowed(found: Part | UnfollowedReference): found is UnfollowedReference {
  return !isPart(found);
}

export async function readSchemaFile(files: FileSystem, file: string, schemas: NameableSchemas): Promise<SchemaFile> {
  const text = await files.readText(file);
  if (text === undefined) {
    return { state: "missing" };
  }
  const json = jsonOf(text);
  if (!json.read) {
    return { state: "invalid", reason: json.reason };
  }
  const found = await Promise.all(externalReferences(json.value).map((reference) => partOf(files, schemas, reference)));
  const unfollowed = found.filter(isUnfollowed);
  if (unfollowed.length > 0) {
    return { state: "unfollowed", references: unfollowed };
  }
  const parts: SchemaParts = Object.fromEntries(found.filter(isPart).map((part) => [part.name, part.value]));
  return { state: "valid", schema: json.value, parts };
}
