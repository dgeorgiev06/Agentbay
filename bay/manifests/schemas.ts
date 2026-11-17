import type { Json } from "../contracts.ts";
import type { FileSystem } from "../ports.ts";
import { checkValue } from "./spec.ts";
import type { Problem } from "../outcome.ts";

export type SchemaReader = (file: string) => Promise<SchemaFile>;

type SchemaFile =
  | { readonly state: "missing" }
  | { readonly state: "invalid"; readonly reason: string }
  | { readonly state: "valid"; readonly schema: unknown };

export type SchemaSource = {
  readonly file: string;
  readonly schemaFile: SchemaFile;
  readonly label: SchemaDirection;
};

export const schemaDirections = ["input", "output"] as const;

export type SchemaDirection = (typeof schemaDirections)[number];

async function readSchemaFile(files: FileSystem, file: string): Promise<SchemaFile> {
  const text = await files.readText(file);
  if (text === undefined) {
    return { state: "missing" };
  }
  try {
    const schema: unknown = JSON.parse(text);
    return { state: "valid", schema };
  } catch (error) {
    return { state: "invalid", reason: error instanceof Error ? error.message : String(error) };
  }
}

export function schemaReader(files: FileSystem): SchemaReader {
  const read = new Map<string, Promise<SchemaFile>>();
  return (file) => {
    const reading = read.get(file) ?? readSchemaFile(files, file);
    read.set(file, reading);
    return reading;
  };
}

export function valueProblems(source: SchemaSource, value: Json): readonly Problem[] {
  const { file, schemaFile, label } = source;
  switch (schemaFile.state) {
    case "missing":
      return [{ file, path: "", message: `The schema file ${file} does not exist, so the ${label} is not checked.` }];
    case "invalid":
      return [{ file, path: "", message: `The schema file ${file} is not valid JSON: ${schemaFile.reason}.` }];
    case "valid": {
      const loaded = { file, value, lineOf: () => undefined };
      const result = checkValue(schemaFile.schema, value, { loaded, path: [label] });
      if (result.kind === "unusable-schema") {
        return [{ file, path: "", message: `The schema file ${file} is not a usable JSON Schema: ${result.reason}.` }];
      }
      return result.problems;
    }
  }
}
