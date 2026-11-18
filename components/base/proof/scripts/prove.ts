import { defineScript } from "../../../../bay/sdk.ts";
import { kinds } from "./kinds.ts";
import { requestOf, type KindName, type ProofOf, type ProvenItem, type Request } from "./lib/request.ts";
import { sizeOfTheChange } from "./lib/size.ts";
import { ProofStep } from "./lib/step.ts";
import { verdictOf, type Parts, type Verdict } from "./lib/verdicts.ts";

const addedToEverySlice: readonly ProvenItem[] = [
  { id: "scope", proof: { kind: "in-scope" } },
  { id: "declared", proof: { kind: "as-declared" } },
];

type KindOfItem<Kind extends KindName> = { readonly kind: Kind; readonly proof: ProofOf<Kind> };

function partsOf<Kind extends KindName>(step: ProofStep, request: Request, item: KindOfItem<Kind>): Promise<Parts> {
  return kinds[item.kind](step, request, item.proof);
}

export const run = defineScript(async (input, context) => {
  const request = requestOf(input, context.settings);
  const step = new ProofStep(context);
  const verdicts: Verdict[] = [];
  for (const item of [...request.proven, ...addedToEverySlice]) {
    const parts = await partsOf(step, request, { kind: item.proof.kind, proof: item.proof });
    verdicts.push(verdictOf(item.id, item.proof.kind, parts));
  }
  return { verdicts, judgement: request.judgement, size: await sizeOfTheChange(step, request) };
});
