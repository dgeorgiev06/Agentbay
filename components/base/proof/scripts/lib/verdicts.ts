import type { KindName } from "./request.ts";

export type Part =
  | { readonly verdict: "passed" }
  | { readonly verdict: "failed"; readonly detail: string }
  | { readonly verdict: "inconclusive"; readonly reason: string };

export type Parts = {
  readonly parts: readonly [Part, ...Part[]];
  readonly whenPassed: string;
};

export type Verdict =
  | { readonly item: string; readonly kind: KindName; readonly verdict: "passed" | "failed"; readonly detail: string }
  | { readonly item: string; readonly kind: KindName; readonly verdict: "inconclusive"; readonly reason: string };

export const held: Part = { verdict: "passed" };

export function broken(detail: string): Part {
  return { verdict: "failed", detail };
}

export function unknown(reason: string): Part {
  return { verdict: "inconclusive", reason };
}

export function verdictOf(item: string, kind: KindName, found: Parts): Verdict {
  const reasons = found.parts.flatMap((part) => (part.verdict === "inconclusive" ? [part.reason] : []));
  if (reasons.length > 0) {
    return { item, kind, verdict: "inconclusive", reason: reasons.join(" ") };
  }
  const details = found.parts.flatMap((part) => (part.verdict === "failed" ? [part.detail] : []));
  if (details.length > 0) {
    return { item, kind, verdict: "failed", detail: details.join(" ") };
  }
  return { item, kind, verdict: "passed", detail: found.whenPassed };
}

export function counted(count: number, one: string, many: string): string {
  return `${String(count)} ${count === 1 ? one : many}`;
}
