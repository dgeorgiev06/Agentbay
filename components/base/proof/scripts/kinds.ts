import { proveChecks } from "./kinds/checks.ts";
import { proveBugsCaught } from "./kinds/bugs-caught.ts";
import { proveFailsFirst } from "./kinds/fails-first.ts";
import { proveAsDeclared } from "./kinds/as-declared.ts";
import { proveCount } from "./kinds/count.ts";
import { proveRealThing } from "./kinds/real-thing.ts";
import { proveSameOutput } from "./kinds/same-output.ts";
import { proveInScope } from "./kinds/in-scope.ts";
import type { KindName, ProofOf, Request } from "./lib/request.ts";
import type { ProofStep } from "./lib/step.ts";
import type { Parts } from "./lib/verdicts.ts";

type KindScript<Kind extends KindName> = (step: ProofStep, request: Request, proof: ProofOf<Kind>) => Promise<Parts>;

type Table = { readonly [Kind in KindName]: KindScript<Kind> };

export const kinds: Table = {
  checks: proveChecks,
  "fails-first": proveFailsFirst,

  "in-scope": proveInScope,
  "as-declared": proveAsDeclared,

  "bugs-caught": proveBugsCaught,

  "same-output": proveSameOutput,
  "real-thing": proveRealThing,

  count: proveCount,
};
