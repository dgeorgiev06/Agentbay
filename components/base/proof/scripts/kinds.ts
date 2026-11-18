import type { KindName, ProofOf, Request } from "./lib/request.ts";
import type { ProofStep } from "./lib/step.ts";
import { notBuiltParts, type Parts } from "./lib/verdicts.ts";

type KindScript<Kind extends KindName> = (step: ProofStep, request: Request, proof: ProofOf<Kind>) => Promise<Parts>;

type Table = { readonly [Kind in KindName]: KindScript<Kind> };

function notBuilt(_step: ProofStep, _request: Request, proof: { readonly kind: KindName }): Promise<Parts> {
  return Promise.resolve(notBuiltParts(proof.kind));
}

export const kinds: Table = {
  checks: notBuilt,
  "fails-first": notBuilt,

  "in-scope": notBuilt,
  "as-declared": notBuilt,

  "bugs-caught": notBuilt,

  "same-output": notBuilt,
  "real-thing": notBuilt,

  count: notBuilt,
};
