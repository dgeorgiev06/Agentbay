import assert from "node:assert/strict";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { generatedTypeFiles, staleTypeFiles, typeDeclarations } from "../bay/generate-types.ts";
import { nodeFileSystem } from "../bay/node-ports.ts";
import { fakeFileSystem } from "./fakes.ts";

const repositoryRoot = fileURLToPath(new URL("..", import.meta.url));

const sampleSchema = {
  title: "Sample",
  type: "object",
  additionalProperties: false,
  required: ["name", "steps"],
  properties: {
    name: { type: "string" },
    count: { type: "integer" },
    ready: { const: true },
    labels: { type: "object", additionalProperties: { type: "string" } },
    steps: { type: "array", items: { $ref: "#/$defs/step" } },
  },
  $defs: {
    step: { oneOf: [{ type: "object", required: ["run"], properties: { run: { enum: ["fast", "slow"] } } }] },
  },
};

test("typeDeclarations writes a readonly type for the schema and one for each definition", () => {
  assert.equal(
    typeDeclarations(sampleSchema),
    [
      "export type Sample = { readonly name: string; readonly count?: number; readonly ready?: true; " +
        "readonly labels?: Readonly<Record<string, string>>; readonly steps: ReadonlyArray<Step>; };",
      'export type Step = { readonly run: "fast" | "slow"; };',
    ].join("\n\n"),
  );
});

test("typeDeclarations refuses a schema it cannot translate", () => {
  assert.throws(() => typeDeclarations({ type: "object" }), /must be an object with a title/);
  assert.throws(() => typeDeclarations({ title: "T", type: "null" }), /does not support the schema/);
  assert.throws(() => typeDeclarations({ title: "T", $ref: "other.json" }), /only local references/);
});

test("the committed generated types match the schemas", async () => {
  assert.deepEqual(await staleTypeFiles(nodeFileSystem, repositoryRoot), []);
});

test("a stale or missing generated file is reported, and the generated text is what would be written", async () => {
  const files = fakeFileSystem();
  for (const path of [
    "components/base/typescript/prettier.json",
    ...["mode", "interface", "skill", "workflow", "config"].map((kind) => `schemas/${kind}.schema.json`),
  ]) {
    const text = await nodeFileSystem.readText(join(repositoryRoot, path));
    assert.ok(text !== undefined);
    await files.writeAtomic(join("/repository", path), text);
  }
  const generated = await generatedTypeFiles(files, "/repository");
  assert.deepEqual(await staleTypeFiles(files, "/repository"), [...generated.keys()]);
  for (const [path, text] of generated) {
    await files.writeAtomic(join("/repository", path), text);
  }
  assert.deepEqual(await staleTypeFiles(files, "/repository"), []);
  await files.writeAtomic("/repository/bay/generated/mode.ts", "export type Mode = unknown;\n");
  assert.deepEqual(await staleTypeFiles(files, "/repository"), ["bay/generated/mode.ts"]);
  assert.match(generated.get("bay/generated/mode.ts") ?? "", /^export type Mode = \{/);
});
