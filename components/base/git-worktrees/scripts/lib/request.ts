import {
  defineScript,
  fail,
  fieldsOf,
  type DefinedScript,
  type Json,
  type ScriptContext,
} from "../../../../../bay/sdk.ts";

export type Request = {
  readonly text: (name: string) => string;
  readonly optionalText: (name: string) => string | undefined;
  readonly texts: (name: string) => readonly string[];
};

function requestOf(input: Json): Request {
  const fields = fieldsOf(input);
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
