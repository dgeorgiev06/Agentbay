import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const interfaces = fileURLToPath(new URL("../../interfaces", import.meta.url));

type Definitions = Readonly<Record<string, unknown>>;

function definitionsOf(file: string): Definitions {
  const schema: unknown = JSON.parse(readFileSync(file, "utf8"));
  const definitions: unknown = typeof schema === "object" && schema !== null ? Reflect.get(schema, "$defs") : undefined;
  return typeof definitions === "object" && definitions !== null ? { ...definitions } : {};
}

function schemaFiles(): readonly string[] {
  return ["items-source", "items-store"].flatMap((folder) =>
    readdirSync(join(interfaces, folder)).map((name) => join(interfaces, folder, name)),
  );
}

test("the item, the selector and the cost are the same in every interface schema that holds them", () => {
  const seen = new Map<string, { readonly file: string; readonly definition: unknown }>();
  let compared = 0;
  for (const file of schemaFiles()) {
    for (const [name, definition] of Object.entries(definitionsOf(file))) {
      const first = seen.get(name);
      if (first === undefined) {
        seen.set(name, { file, definition });
        continue;
      }
      assert.deepEqual(definition, first.definition, `${name} in ${file} differs from ${first.file}`);
      compared += 1;
    }
  }
  assert.deepEqual([...seen.keys()].sort(), ["cost", "item", "selector"]);
  assert.ok(compared >= 8);
});

function propertiesWithoutDescription(schema: unknown, path: string): readonly string[] {
  if (typeof schema !== "object" || schema === null) {
    return [];
  }
  const nested = Object.entries(schema).flatMap(([key, value]) =>
    propertiesWithoutDescription(value, `${path}/${key}`),
  );
  const properties: unknown = Reflect.get(schema, "properties");
  if (typeof properties !== "object" || properties === null) {
    return nested;
  }
  const missing = Object.entries(properties)
    .filter(([, property]) => typeof property !== "object" || property === null || !("description" in property))
    .map(([name]) => `${path}/properties/${name}`);
  return [...missing, ...nested];
}

test("every property of every interface schema says why it exists", () => {
  for (const file of schemaFiles()) {
    const schema: unknown = JSON.parse(readFileSync(file, "utf8"));
    assert.deepEqual(propertiesWithoutDescription(schema, ""), [], file);
  }
});
