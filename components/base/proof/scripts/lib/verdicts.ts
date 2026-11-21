import type { KindName } from "./request.ts";
import type { Cases } from "./toolchain.ts";

type Broken = { readonly verdict: "failed"; readonly detail: string; readonly cases?: Cases };

export type Printed = { readonly exitCode: number; readonly stdout: string };

type Held = { readonly verdict: "passed"; readonly printed?: Printed };

export type Part = Held | Broken | { readonly verdict: "inconclusive"; readonly reason: string };

export type Parts = {
  readonly parts: readonly [Part, ...Part[]];
  readonly whenPassed: string;
};

export type Verdict =
  | {
      readonly item: string;
      readonly kind: KindName;
      readonly verdict: "passed";
      readonly detail: string;
      readonly printed?: Printed;
    }
  | {
      readonly item: string;
      readonly kind: KindName;
      readonly verdict: "failed";
      readonly detail: string;
      readonly cases?: Cases;
    }
  | { readonly item: string; readonly kind: KindName; readonly verdict: "inconclusive"; readonly reason: string };

export const held: Part = { verdict: "passed" };

export function broken(detail: string): Part {
  return { verdict: "failed", detail };
}

export function brokenWithCases(detail: string, cases: Cases): Part {
  return { verdict: "failed", detail, cases };
}

export function heldWith(printed: Printed): Part {
  return { verdict: "passed", printed };
}

function isBroken(part: Part): part is Broken {
  return part.verdict === "failed";
}

export function unknown(reason: string): Part {
  return { verdict: "inconclusive", reason };
}

function printedIn(parts: readonly Part[]): Printed | undefined {
  for (const part of parts) {
    if (part.verdict === "passed" && part.printed !== undefined) {
      return part.printed;
    }
  }
  return undefined;
}

export function verdictOf(item: string, kind: KindName, found: Parts): Verdict {
  const reasons = found.parts.flatMap((part) => (part.verdict === "inconclusive" ? [part.reason] : []));
  if (reasons.length > 0) {
    return { item, kind, verdict: "inconclusive", reason: reasons.join(" ") };
  }
  const brokenParts = found.parts.filter(isBroken);
  if (brokenParts.length > 0) {
    const detail = brokenParts.map((part) => part.detail).join(" ");
    const cases = brokenParts.find((part) => part.cases !== undefined)?.cases;
    return cases === undefined
      ? { item, kind, verdict: "failed", detail }
      : { item, kind, verdict: "failed", detail, cases };
  }
  const printed = printedIn(found.parts);
  const passed = { item, kind, verdict: "passed", detail: found.whenPassed } as const;
  return printed === undefined ? passed : { ...passed, printed };
}

export function counted(count: number, one: string, many: string): string {
  return `${String(count)} ${count === 1 ? one : many}`;
}
