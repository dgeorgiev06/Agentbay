import { defineScript, fail, type DefinedScript, type Json, type ScriptContext } from "../../../../../bay/sdk.ts";

type Fields = { readonly [key: string]: Json };

export type Request = {
  readonly text: (name: string) => string;
  readonly optionalText: (name: string) => string | undefined;
  readonly texts: (name: string) => readonly string[];
};

function isFields(value: Json): value is Fields {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requestOf(input: Json): Request {
  const fields = isFields(input) ? input : {};
  const optionalText = (name: string): string | undefined => {
    const value = fields[name];
    return typeof value === "string" ? value : undefined;
  };
  return {
    optionalText,
    text: (name) => optionalText(name) ?? fail(`The request has no ${name}.`),
    texts: (name) => {
      const value = fields[name];
      return Array.isArray(value) ? value.filter((item) => typeof item === "string") : [];
    },
  };
}

export function defineRequestScript(
  handler: (request: Request, context: ScriptContext) => Promise<Json>,
): DefinedScript {
  return defineScript((input, context) => handler(requestOf(input), context));
}
