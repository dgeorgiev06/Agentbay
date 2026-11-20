import type { Json, ScriptContext } from "../../../../../bay/sdk.ts";
import { filteredProof } from "./failing.ts";
import type { HandedTest } from "./handed-tests.ts";

export type ProofAsked = { readonly ok: true; readonly value: Json } | { readonly ok: false; readonly message: string };

export async function provedAgainst(
  context: ScriptContext,
  request: Json,
  tests: readonly HandedTest[],
): Promise<ProofAsked> {
  const answer = await context.call("proof.prove", request);
  return answer.ok ? { ok: true, value: filteredProof(answer.value, tests) } : { ok: false, message: answer.message };
}
