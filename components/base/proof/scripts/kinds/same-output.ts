import { notBuiltParts, type Parts } from "../lib/verdicts.ts";
import type { BayRun } from "./bay-run.ts";

export type CommandRuns = { readonly name: string; readonly base: BayRun; readonly head: BayRun };

export type SameOutputEvidence =
  | { readonly found: "no commands" }
  | { readonly found: "not copied"; readonly reason: string }
  | { readonly found: "ran"; readonly commands: readonly CommandRuns[] };

export function sameOutputParts(_differ: readonly string[], _evidence: SameOutputEvidence): Parts {
  return notBuiltParts("same-output");
}
