import type { Json } from "../../../../../bay/sdk.ts";

export function checkAnswer(refused: readonly string[]): Promise<Json> {
  const answer = refused.length === 0 ? { passed: true } : { passed: false, feedback: refused.join(" ") };
  return Promise.resolve(answer);
}
