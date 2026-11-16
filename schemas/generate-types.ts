import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { format } from "prettier";
import { nodeFileSystem } from "../bay/node-ports.ts";
import type { FileSystem } from "../bay/ports.ts";

type JsonObject = Readonly<Record<string, unknown>>;

const schemaKinds = ["mode", "interface", "skill", "workflow", "config"] as const;

const primitiveTypes: ReadonlyMap<unknown, string> = new Map([
  ["string", "string"],
  ["integer", "number"],
  ["number", "number"],
  ["boolean", "boolean"],
]);

const definitionPrefix = "#/$defs/";

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function typeName(definitionName: string): string {
  return definitionName.charAt(0).toUpperCase() + definitionName.slice(1);
}

function referencedType(reference: string): string {
  if (!reference.startsWith(definitionPrefix)) {
    throw new Error(`The generator supports only local references, not ${reference}.`);
  }
  return typeName(reference.slice(definitionPrefix.length));
}

function objectType(schema: JsonObject): string {
  if (isJsonObject(schema.additionalProperties)) {
    return `Readonly<Record<string, ${typeOf(schema.additionalProperties)}>>`;
  }
  if (!isJsonObject(schema.properties)) {
    return "Readonly<Record<string, unknown>>";
  }
  const properties = schema.properties;
  const required: readonly unknown[] = Array.isArray(schema.required) ? schema.required : [];
  const members = Object.entries(properties).map(([name, property]) => {
    const optional = required.includes(name) ? "" : "?";
    return `readonly ${name}${optional}: ${typeOf(property)};`;
  });
  return `{ ${members.join(" ")} }`;
}

function typeOfDeclaredType(schema: JsonObject): string {
  if (schema.type === "array") {
    return `ReadonlyArray<${typeOf(schema.items)}>`;
  }
  if (schema.type === "object") {
    return objectType(schema);
  }
  const primitive = primitiveTypes.get(schema.type);
  if (primitive === undefined) {
    throw new Error(`The generator does not support the schema ${JSON.stringify(schema)}.`);
  }
  return primitive;
}

function typeOf(schema: unknown): string {
  if (!isJsonObject(schema)) {
    throw new Error(`A schema must be an object, not ${JSON.stringify(schema)}.`);
  }
  if (typeof schema.$ref === "string") {
    return referencedType(schema.$ref);
  }
  if ("const" in schema) {
    return JSON.stringify(schema.const);
  }
  if (Array.isArray(schema.enum)) {
    return schema.enum.map((value: unknown) => JSON.stringify(value)).join(" | ");
  }
  if (Array.isArray(schema.oneOf)) {
    return schema.oneOf.map((branch: unknown) => typeOf(branch)).join(" | ");
  }
  return typeOfDeclaredType(schema);
}

export function typeDeclarations(schema: unknown): string {
  if (!isJsonObject(schema) || typeof schema.title !== "string") {
    throw new Error("A schema must be an object with a title, which names its type.");
  }
  const definitions = isJsonObject(schema.$defs) ? Object.entries(schema.$defs) : [];
  const declarations = [
    `export type ${schema.title} = ${typeOf(schema)};`,
    ...definitions.map(([name, definition]) => `export type ${typeName(name)} = ${typeOf(definition)};`),
  ];
  return declarations.join("\n\n");
}

async function readJson(files: FileSystem, path: string): Promise<unknown> {
  const text = await files.readText(path);
  if (text === undefined) {
    throw new Error(`${path} does not exist.`);
  }
  return JSON.parse(text);
}

async function printWidth(files: FileSystem, root: string): Promise<number> {
  const options = await readJson(files, join(root, "components/base/typescript/prettier.json"));
  if (!isJsonObject(options) || typeof options.printWidth !== "number") {
    throw new Error("The prettier config must set printWidth.");
  }
  return options.printWidth;
}

export async function generatedTypeFiles(files: FileSystem, root: string): Promise<ReadonlyMap<string, string>> {
  const width = await printWidth(files, root);
  const generated = new Map<string, string>();
  for (const kind of schemaKinds) {
    const schema = await readJson(files, join(root, "schemas", `${kind}.schema.json`));
    const text = await format(typeDeclarations(schema), { parser: "typescript", printWidth: width });
    generated.set(`bay/generated/${kind}.ts`, text);
  }
  return generated;
}

export async function staleTypeFiles(files: FileSystem, root: string): Promise<readonly string[]> {
  const stale: string[] = [];
  for (const [path, text] of await generatedTypeFiles(files, root)) {
    if ((await files.readText(join(root, path))) !== text) {
      stale.push(path);
    }
  }
  return stale;
}

async function main(commandArguments: readonly string[]): Promise<void> {
  const root = fileURLToPath(new URL("..", import.meta.url));
  if (commandArguments.includes("--check")) {
    const stale = await staleTypeFiles(nodeFileSystem, root);
    for (const path of stale) {
      console.error(`${path} is stale or missing; run npm run generate and commit the result.`);
    }
    process.exitCode = stale.length === 0 ? 0 : 1;
    return;
  }
  for (const [path, text] of await generatedTypeFiles(nodeFileSystem, root)) {
    await nodeFileSystem.writeAtomic(join(root, path), text);
  }
}

if (import.meta.main) {
  await main(process.argv.slice(2));
}
