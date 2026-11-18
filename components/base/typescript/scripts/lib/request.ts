import { fieldsOf, type Json } from "../../../../../bay/sdk.ts";

export type CheckoutAction = "check" | "test";

export type CheckoutRequest = {
  readonly folder: string;
  readonly names: readonly string[] | undefined;
  readonly timeLimitSeconds: number;
};

const actions: Readonly<Record<CheckoutAction, { readonly namesField: string; readonly defaultSeconds: number }>> = {
  check: { namesField: "checks", defaultSeconds: 90 },
  test: { namesField: "files", defaultSeconds: 420 },
};

function textsOf(value: Json | undefined): readonly string[] | undefined {
  return Array.isArray(value) ? value.filter((item) => typeof item === "string") : undefined;
}

export function checkoutRequestOf(input: Json, action: CheckoutAction): CheckoutRequest {
  const { namesField, defaultSeconds } = actions[action];
  const fields = fieldsOf(input);
  const folder = fields.folder;
  const seconds = fields.timeLimitSeconds;
  return {
    folder: typeof folder === "string" ? folder : "",
    names: textsOf(fields[namesField]),
    timeLimitSeconds: typeof seconds === "number" ? seconds : defaultSeconds,
  };
}
