import { fail, type Json, type ScriptContext } from "../../../../../bay/sdk.ts";

export async function called(context: ScriptContext, reference: string, input: Json): Promise<Json> {
  const answer = await context.call(reference, input);
  if (!answer.ok) {
    return fail(`${reference} failed: ${answer.message}`);
  }
  return answer.value;
}
