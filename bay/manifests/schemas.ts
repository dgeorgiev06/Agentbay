import { dirname, join, relative } from "node:path/posix";
import type { Interface } from "../generated/interface.ts";
import { isInsideOrEqual } from "../layout.ts";
import type { FileSystem } from "../ports.ts";
import { type NameableSchemas, readSchemaFile } from "../schema-files.ts";
import type { SchemaFile } from "../value-check.ts";
import { interfaceName } from "./interfaces.ts";
import type { SchemaReader } from "./loaded.ts";

export const schemaDirections = ["input", "output"] as const;

export type SchemaDirection = (typeof schemaDirections)[number];

export type InterfaceSource = {
  readonly file: string;
  readonly definition: Interface;
};

export type SchemaOwner = {
  readonly name: string;
  readonly folder: string;
  readonly interfaces: readonly string[];
};

type InterfaceOf = (reference: string) => InterfaceSource | undefined;

function schemasOfInterface(reference: string, source: InterfaceSource): readonly (readonly [string, string])[] {
  const definitions = dirname(source.file);
  const folder = join(definitions, interfaceName(reference));
  const named = Object.values(source.definition.actions).flatMap((signature) => [signature.input, signature.output]);
  return named
    .map((path) => join(definitions, path))
    .filter((file) => isInsideOrEqual(file, folder) && file !== folder)
    .map((file) => [`${reference}/${relative(folder, file)}`, file] as const);
}

export function interfaceSchemas(owner: SchemaOwner, interfaceOf: InterfaceOf): NameableSchemas {
  const files = owner.interfaces.flatMap((reference) => {
    const source = interfaceOf(reference);
    return source === undefined ? [] : schemasOfInterface(reference, source);
  });
  return { owner: `mode ${owner.name}`, files: new Map(files) };
}

const interfaceOwned: NameableSchemas = { owner: "an interface's schema", files: new Map() };

export function schemaReader(
  files: FileSystem,
  owners: readonly SchemaOwner[],
  interfaceOf: InterfaceOf,
): SchemaReader {
  const read = new Map<string, Promise<SchemaFile>>();
  const nameableFor = (file: string): NameableSchemas => {
    const owner = owners.find((mode) => isInsideOrEqual(file, mode.folder));
    return owner === undefined ? interfaceOwned : interfaceSchemas(owner, interfaceOf);
  };
  return (file) => {
    const reading = read.get(file) ?? readSchemaFile(files, file, nameableFor(file));
    read.set(file, reading);
    return reading;
  };
}
