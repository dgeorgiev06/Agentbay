import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { mock, test } from "node:test";
import { Ajv2020, type ValidateFunction } from "ajv/dist/2020.js";
import type { Json } from "../bay/contracts.ts";
import { isJson } from "../bay/protocol-json.ts";
import { readSchemaFile } from "../bay/schema-files.ts";
import {
  checkedValue,
  checkValue,
  emptiedRequiredFields,
  errorProblems,
  madeOnFirstUse,
  type SchemaFile,
  type SchemaParts,
} from "../bay/value-check.ts";
import { fakeFileSystem } from "./fakes.ts";

type ValidSchema = Extract<SchemaFile, { readonly state: "valid" }>;

type Fields = { readonly [key: string]: Json };

const kitRoot = join(import.meta.dirname, "..");

const noNameableSchemas = { owner: "a test", files: new Map<string, string>() };

function isFields(value: Json | undefined): value is Fields {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validSchema(schema: Json, parts: SchemaParts = {}): ValidSchema {
  return { state: "valid", schema, parts };
}

function copied(schema: ValidSchema): ValidSchema {
  const text = JSON.stringify(schema);
  const value: unknown = JSON.parse(text);
  assert.ok(isJson(value) && isFields(value) && isFields(value.parts));
  return validSchema(value.schema ?? null, value.parts);
}

function placeFor(value: unknown): Parameters<typeof checkValue>[2] {
  return { loaded: { file: "value.json", value, lineOf: () => undefined }, path: ["input"] };
}

function oldCompile(schema: ValidSchema): ValidateFunction | string {
  if (!isFields(schema.schema) && typeof schema.schema !== "boolean") {
    return "a JSON Schema must be a mapping, true or false";
  }
  try {
    const ajv = new Ajv2020({ allErrors: true, strict: false, verbose: true, logger: false });
    for (const [name, part] of Object.entries(schema.parts)) {
      if (!isFields(part) && typeof part !== "boolean") {
        return `the schema ${name} it refers to is not a mapping, true or false`;
      }
      ajv.addSchema(part, name);
    }
    return ajv.compile(schema.schema);
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

function oldCheck(schema: ValidSchema, value: unknown): ReturnType<typeof checkValue> {
  const validate = oldCompile(schema);
  if (typeof validate === "string") {
    return { kind: "unusable-schema", reason: validate };
  }
  if (validate(value)) {
    return { kind: "checked", problems: [] };
  }
  const errors = validate.errors ?? [];
  return { kind: "checked", problems: errorProblems(errors, placeFor(value), emptiedRequiredFields(validate, value)) };
}

function compileCounter(): { readonly count: () => number; readonly stop: () => void } {
  const compile = mock.method(Ajv2020.prototype, "compile");
  return {
    count: () => compile.mock.callCount(),
    stop: () => {
      compile.mock.restore();
    },
  };
}

function resolved(schema: Json, root: Json): Json {
  if (!isFields(schema) || typeof schema.$ref !== "string" || !schema.$ref.startsWith("#/")) {
    return schema;
  }
  const steps = schema.$ref.slice(2).split("/");
  const found = steps.reduce<Json | undefined>((at, step) => (isFields(at) ? at[step] : undefined), root);
  return found ?? schema;
}

function sampleString(schema: Fields): string {
  const length = typeof schema.minLength === "number" ? schema.minLength : 1;
  return "a".repeat(Math.max(length, 1));
}

function sampleObject(schema: Fields, root: Json, depth: number): Json {
  const properties = isFields(schema.properties) ? schema.properties : {};
  const required = isJsonList(schema.required) ? schema.required : [];
  const names = required.filter((name): name is string => typeof name === "string");
  return Object.fromEntries(names.map((name) => [name, sampleValue(properties[name] ?? {}, root, depth + 1)]));
}

function sampleArray(schema: Fields, root: Json, depth: number): Json {
  const count = typeof schema.minItems === "number" ? schema.minItems : 0;
  return Array.from({ length: count }, () => sampleValue(schema.items ?? {}, root, depth + 1));
}

function isJsonList(value: Json | undefined): value is readonly Json[] {
  return Array.isArray(value);
}

function firstOf(list: Json | undefined): Json | undefined {
  return isJsonList(list) ? list[0] : undefined;
}

function sampleOfType(schema: Fields, root: Json, depth: number): Json {
  const given = isJsonList(schema.type) ? schema.type[0] : schema.type;
  const type = typeof given === "string" ? given : "";
  switch (type) {
    case "object":
      return sampleObject(schema, root, depth);
    case "array":
      return sampleArray(schema, root, depth);
    case "string":
      return sampleString(schema);
    case "integer":
    case "number":
      return typeof schema.minimum === "number" ? schema.minimum : 1;
    case "boolean":
      return true;
    default:
      return null;
  }
}

function sampleValue(given: Json, root: Json, depth: number): Json {
  const schema = resolved(given, root);
  if (!isFields(schema) || depth > 6) {
    return null;
  }
  if (schema.const !== undefined) {
    return schema.const;
  }
  const choice = firstOf(schema.enum) ?? firstOf(schema.oneOf) ?? firstOf(schema.anyOf);
  if (choice !== undefined) {
    return Array.isArray(schema.enum) ? choice : sampleValue(choice, root, depth + 1);
  }
  return sampleOfType(schema, root, depth);
}

function wrongTypeOf(value: Json | undefined): Json {
  return typeof value === "number" ? "text" : 42;
}

function fieldChanges(sample: Fields, schema: Fields): readonly Json[] {
  const properties = isFields(schema.properties) ? Object.keys(schema.properties) : [];
  return properties.flatMap((name) => {
    const without = Object.fromEntries(Object.entries(sample).filter(([field]) => field !== name));
    return [without, { ...sample, [name]: null }, { ...sample, [name]: wrongTypeOf(sample[name]) }];
  });
}

function valuesFor(schema: Json): readonly Json[] {
  const sample = sampleValue(schema, schema, 0);
  const plain: readonly Json[] = [null, [], "text", 7, {}, sample];
  if (!isFields(sample) || !isFields(schema)) {
    return plain;
  }
  return [...plain, { ...sample, unexpected: 1 }, ...fieldChanges(sample, schema)];
}

async function jsonFiles(folder: string): Promise<readonly string[]> {
  const names = await readdir(folder);
  return names.filter((name) => name.endsWith(".json")).map((name) => join(folder, name));
}

async function kitSchemaFiles(): Promise<readonly string[]> {
  const interfaces = join(kitRoot, "components/base/interfaces");
  const entries = await readdir(interfaces, { withFileTypes: true });
  const folders = entries.filter((entry) => entry.isDirectory()).map((entry) => join(interfaces, entry.name));
  const perInterface = await Promise.all(folders.map(jsonFiles));
  return [...(await jsonFiles(join(kitRoot, "schemas"))), ...perInterface.flat()];
}

async function schemaOf(file: string): Promise<ValidSchema> {
  const value: unknown = JSON.parse(await readFile(file, "utf8"));
  assert.ok(isJson(value), file);
  return validSchema(value);
}

test("every schema of the kit gives the same problems, in the same order, as a fresh compile, on first and later checks", async () => {
  const files = await kitSchemaFiles();
  const schemas = await Promise.all(files.map(schemaOf));
  const cases = schemas.flatMap((schema, index) =>
    valuesFor(schema.schema).map((value) => ({ file: files[index], schema, value })),
  );
  const rounds = [cases, [...cases].reverse()];
  const passed = rounds.flatMap((round) =>
    round.map(({ file, schema, value }) => {
      const expected = oldCheck(schema, value);
      assert.deepEqual(checkValue(copied(schema), value, placeFor(value)), expected, String(file));
      return expected.kind === "checked" && expected.problems.length === 0;
    }),
  );
  assert.ok(files.length >= 54, `only ${String(files.length)} schemas were found`);
  assert.ok(passed.length >= 1572, `only ${String(passed.length)} checks were made`);
  assert.ok(
    passed.filter(Boolean).length >= 144,
    "too few values passed their schema to show the checks are not all refusals",
  );
});

const titled = (required: readonly string[]): ValidSchema =>
  validSchema({
    title: "Shared",
    type: "object",
    required: [...required],
    properties: { name: { type: "string" }, size: { type: "integer" } },
  });

test("repeated checks of one schema, each read afresh, compile it once", () => {
  const schema = validSchema({ title: "Counted once", type: "object", required: ["counted"] });
  const counter = compileCounter();
  try {
    const answers = [1, 2, 3, 4, 5].map(() => checkValue(copied(schema), {}, placeFor({})));
    assert.equal(counter.count(), 1);
    assert.deepEqual(new Set(answers.map((answer) => JSON.stringify(answer))).size, 1);
  } finally {
    counter.stop();
  }
});

test("two schemas with the same title each answer for their own content", () => {
  const counter = compileCounter();
  try {
    const first = checkedValue("first", titled(["name"]), {});
    const second = checkedValue("second", titled(["size"]), {});
    const firstAgain = checkedValue("first", titled(["name"]), {});
    assert.deepEqual(first, {
      passed: false,
      problems: [{ path: "", message: "This file is missing the required field name.", fix: "Add name." }],
    });
    assert.deepEqual(second, {
      passed: false,
      problems: [{ path: "", message: "This file is missing the required field size.", fix: "Add size." }],
    });
    assert.deepEqual(firstAgain, first);
    assert.equal(counter.count(), 2);
  } finally {
    counter.stop();
  }
});

test("a schema changed on disk between two reads is checked against its new content", async () => {
  const file = "/project/modes/keeper/schemas/entry.json";
  const files = fakeFileSystem({
    [file]: JSON.stringify({ title: "Entry", type: "object", required: ["name"] }),
  });
  const before = await readSchemaFile(files, file, noNameableSchemas);
  assert.deepEqual(checkedValue(file, before, { name: "kept" }), { passed: true, value: { name: "kept" } });
  await files.writeAtomic(file, JSON.stringify({ title: "Entry", type: "object", required: ["name", "size"] }));
  const after = await readSchemaFile(files, file, noNameableSchemas);
  assert.deepEqual(checkedValue(file, after, { name: "kept" }), {
    passed: false,
    problems: [{ path: "", message: "This file is missing the required field size.", fix: "Add size." }],
  });
});

test("a schema that cannot be compiled gives the same reason every time it is checked", () => {
  const broken = validSchema({ type: "object", properties: { name: { $ref: "#/$defs/missing" } } });
  const answers = [1, 2].map(() => checkValue(copied(broken), {}, placeFor({})));
  assert.deepEqual(answers, [oldCheck(broken, {}), oldCheck(broken, {})]);
  assert.equal(answers[0]?.kind, "unusable-schema");
});

test("a schema whose parts differ is compiled for each set of parts", () => {
  const schema = { type: "object", properties: { slice: { $ref: "part.json#/$defs/slice" } } };
  const loose = validSchema(schema, { "part.json": { $defs: { slice: { type: "string" } } } });
  const strict = validSchema(schema, { "part.json": { $defs: { slice: { type: "integer" } } } });
  const value = { slice: "a" };
  assert.deepEqual(checkValue(loose, value, placeFor(value)), { kind: "checked", problems: [] });
  assert.deepEqual(checkValue(strict, value, placeFor(value)), oldCheck(strict, value));
  assert.deepEqual(checkValue(loose, value, placeFor(value)), { kind: "checked", problems: [] });
});

test("a caller that changes its schema object after a check cannot change what that content answers later", () => {
  const name = { type: "string", description: "first" };
  const schema = validSchema({
    title: "Changed by its caller",
    type: "object",
    required: ["name"],
    properties: { name },
  });
  const original = copied(schema);
  const expected = (description: string): ReturnType<typeof checkValue> => ({
    kind: "checked",
    problems: [
      {
        file: "value.json",
        path: "/input",
        message: "input is missing the required field name.",
        fix: `Add name. Expected: ${description}`,
      },
    ],
  });
  assert.deepEqual(checkValue(schema, {}, placeFor({})), expected("first"));
  name.description = "second";
  assert.deepEqual(checkValue(copied(original), {}, placeFor({})), expected("first"));
  assert.deepEqual(checkValue(schema, {}, placeFor({})), expected("second"));
});

test("the cache keeps the 256 schemas checked last and compiles an older one again", () => {
  const schemas = Array.from({ length: 257 }, (_, index) =>
    validSchema({ title: `Kept ${String(index)}`, type: "object", required: ["kept"] }),
  );
  const counter = compileCounter();
  try {
    for (const schema of schemas) {
      checkValue(copied(schema), {}, placeFor({}));
    }
    assert.equal(counter.count(), 257);
    for (const schema of schemas.slice(1)) {
      checkValue(copied(schema), {}, placeFor({}));
    }
    assert.equal(counter.count(), 257);
    const [first] = schemas;
    assert.ok(first !== undefined);
    checkValue(copied(first), {}, placeFor({}));
    assert.equal(counter.count(), 258);
  } finally {
    counter.stop();
  }
});

test("a value made on first use is made once, and a make that fails is not kept but fails again each time", () => {
  let makes = 0;
  const made = madeOnFirstUse(() => {
    makes += 1;
    return { made: makes };
  });
  assert.equal(made(), made());
  assert.equal(makes, 1);
  let failures = 0;
  const broken = madeOnFirstUse((): never => {
    failures += 1;
    throw new Error("The kit's schema is broken.");
  });
  assert.throws(broken, /The kit's schema is broken/);
  assert.throws(broken, /The kit's schema is broken/);
  assert.equal(failures, 2);
});
