import { Ajv2020 } from "ajv/dist/2020.js";

export type SchemaValue = boolean | Readonly<Record<string, unknown>>;

const defaultMetaSchema = "https://json-schema.org/draft/2020-12/schema";

let checker: Ajv2020 | undefined;

function namesDefaultMetaSchema(schema: SchemaValue): boolean {
  return typeof schema === "boolean" || schema.$schema === undefined || schema.$schema === defaultMetaSchema;
}

export function passesMetaSchema(schema: SchemaValue): boolean {
  checker ??= new Ajv2020({ allErrors: true, strict: false, logger: false });
  return namesDefaultMetaSchema(schema) && checker.validateSchema(schema) === true;
}
