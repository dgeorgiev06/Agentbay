import type { RealRun } from "../lib/request.ts";
import { notBuiltParts, type Parts } from "../lib/verdicts.ts";
import type { BayRun } from "./bay-run.ts";

export type RealThingEvidence =
  | { readonly found: "not copied"; readonly reason: string }
  | { readonly found: "ran"; readonly runs: readonly BayRun[] };

export function realThingParts(_expected: readonly RealRun[], _evidence: RealThingEvidence): Parts {
  return notBuiltParts("real-thing");
}
