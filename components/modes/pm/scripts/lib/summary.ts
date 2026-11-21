import { nextTurnCommand, type Interview } from "./interview.ts";
import { frontierOf, hasMoreToAsk } from "./tree.ts";
import { counted } from "./words.ts";

export function startedSummary(interview: Interview): string {
  return (
    `The interview of ${interview.job} is started. When the owner asks for its turn ${String(interview.turn)}, ` +
    `run: ${nextTurnCommand(interview.job)}`
  );
}

export function keptSummary(before: Interview, after: Interview, perTurn: number): string {
  const settledBefore = frontierOf(before, perTurn).settled;
  const found = frontierOf(after, perTurn);
  const kept = `Turn ${String(before.turn)} of the interview of ${before.job} is kept`;
  const settled = `${counted(found.settled - settledBefore, "question", "questions")} settled, ${String(found.total - found.settled)} open`;
  const next = hasMoreToAsk(found)
    ? `When the owner asks for turn ${String(after.turn)}, run: ${nextTurnCommand(before.job)}`
    : "Nothing more can be asked; the sign-off is not built yet.";
  return `${kept}: ${settled}. ${next}`;
}
