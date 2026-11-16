import type { Json } from "../../../../../bay/sdk.ts";

type Fields = { readonly [key: string]: Json };

export type CheckoutRequest = {
  readonly folder: string;
  readonly names: readonly string[] | undefined;
  readonly timeLimitSeconds: number;
};

function isFields(value: Json): value is Fields {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function textsOf(value: Json | undefined): readonly string[] | undefined {
  return Array.isArray(value) ? value.filter((item) => typeof item === "string") : undefined;
}

export function checkoutRequestOf(
  input: Json,
  given: { readonly namesField: string; readonly defaultSeconds: number },
): CheckoutRequest {
  const fields = isFields(input) ? input : {};
  const folder = fields.folder;
  const seconds = fields.timeLimitSeconds;
  return {
    folder: typeof folder === "string" ? folder : "",
    names: textsOf(fields[given.namesField]),
    timeLimitSeconds: typeof seconds === "number" ? seconds : given.defaultSeconds,
  };
}
