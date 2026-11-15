import { join } from "node:path/posix";
import type { Permissions } from "./contracts.ts";
import { scrubSecretPatterns } from "./secret-patterns.ts";

export type Resource = "db" | "files" | "secrets" | "http" | "events" | "call" | "spend" | "script";

export type Refusal = {
  readonly ok: false;
  readonly kind: "refused";
  readonly resource: Resource;
  readonly asked: string;
  readonly declared: string;
  readonly change: string;
  readonly message: string;
};

export type Failure = {
  readonly ok: false;
  readonly kind: "failed";
  readonly message: string;
};

export type Answer<T> = { readonly ok: true; readonly value: T } | Refusal | Failure;

export type RefusalWording = {
  readonly resource: Resource;
  readonly asked: string;
  readonly declared: string;
  readonly change: string;
};

export function granted<T>(value: T): { readonly ok: true; readonly value: T } {
  return { ok: true, value };
}

export function refused(wording: RefusalWording): Refusal {
  return {
    ok: false,
    kind: "refused",
    ...wording,
    message: `${wording.asked}, but ${wording.declared}. ${wording.change}`,
  };
}

export function failed(message: string): Failure {
  return { ok: false, kind: "failed", message };
}

export function listed(values: readonly string[], noneWording: string): string {
  return values.length === 0 ? noneWording : values.join(", ");
}

export function manifestOf(permissions: Permissions): string {
  return join(permissions.modeFolder, "mode.yaml");
}

export function errorLine(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return scrubSecretPatterns(message.split("\n")[0] ?? "");
}
