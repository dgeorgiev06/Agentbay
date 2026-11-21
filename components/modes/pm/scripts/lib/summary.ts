import type { Interview } from "./interview.ts";
import { frontierOf } from "./tree.ts";
import { counted } from "./words.ts";

export type Kept = {
  readonly summary: string;
  readonly more: boolean;
};

export function keptSummary(before: Interview, after: Interview, perTurn: number): Kept {
  const settledBefore = frontierOf(before, perTurn).settled;
  const found = frontierOf(after, perTurn);
  const kept = `Turn ${String(before.turn)} of the interview of ${before.job} is kept`;
  const settled = `${counted(found.settled - settledBefore, "question", "questions")} settled, ${String(found.total - found.settled)} open`;
  const more = found.frontier.length > 0 || found.lookUp.length > 0;
  const next = more
    ? `Turn ${String(after.turn)} comes next.`
    : "Nothing more can be asked; the sign-off is not built yet.";
  return { summary: `${kept}: ${settled}. ${next}`, more };
}
