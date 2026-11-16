import { fieldsOf, type Json } from "../../../../../bay/sdk.ts";

export type CheckoutRequest = {
  readonly folder: string;
  readonly names: readonly string[] | undefined;
  readonly timeLimitSeconds: number;
};

function textsOf(value: Json | undefined): readonly string[] | undefined {
  return Array.isArray(value) ? value.filter((item) => typeof item === "string") : undefined;
}

export function checkoutRequestOf(
  input: Json,
  given: { readonly namesField: string; readonly defaultSeconds: number },
): CheckoutRequest {
  const fields = fieldsOf(input);
  const folder = fields.folder;
  const seconds = fields.timeLimitSeconds;
  return {
    folder: typeof folder === "string" ? folder : "",
    names: textsOf(fields[given.namesField]),
    timeLimitSeconds: typeof seconds === "number" ? seconds : given.defaultSeconds,
  };
}
