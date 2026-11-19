import { fail, fieldsOf, type Json, type JsonFields, type ScriptContext } from "../../../../../bay/sdk.ts";

export async function answerOf(context: ScriptContext, reference: string, input: Json): Promise<JsonFields> {
  const answer = await context.call(reference, input);
  return answer.ok ? fieldsOf(answer.value) : fail(answer.message);
}
