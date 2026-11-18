import type { Plan, PlannedSlice } from "./plan.ts";
import type { WorkedOut } from "./plan-waves.ts";
import type { Refusal } from "./reading.ts";

function counted(count: number, one: string, many: string): string {
  return `${String(count)} ${count === 1 ? one : many}`;
}

function summaryLines(plan: Plan, workedOut: WorkedOut): readonly string[] {
  if (plan.slices.length === 0) {
    return ["The plan has no slices, so it has no waves."];
  }
  const chain = workedOut.longestChain;
  const summary =
    `${counted(plan.slices.length, "slice", "slices")} in ${counted(workedOut.waves.length, "wave", "waves")}. ` +
    `Longest chain, ${counted(chain.length, "slice", "slices")}: ${chain.join(", ")}.`;
  const notPlaced = workedOut.notPlaced;
  if (notPlaced.length === 0) {
    return [summary];
  }
  const unplaced = `Not in any wave, since each is in a cycle or after one: ${notPlaced.join(", ")}.`;
  return [summary, unplaced];
}

function sliceLines(slice: PlannedSlice): readonly string[] {
  const afters = slice.after.map((after) => `  after ${after.slice}: ${after.because}`);
  return [
    `${slice.name} (${slice.kind}) ${slice.title}`,
    `  scope: ${slice.scope.join(", ")}`,
    ...(afters.length === 0 ? ["  after nothing"] : afters),
  ];
}

function waveLines(workedOut: WorkedOut): readonly string[] {
  return workedOut.waves.map(
    (wave) => `wave ${String(wave.wave)}: ${wave.slices.join(", ")} (${counted(wave.builders, "builder", "builders")})`,
  );
}

function problemLines(workedOut: WorkedOut): readonly string[] {
  if (workedOut.problems.length === 0) {
    return ["No problems."];
  }
  return workedOut.problems.map((problem) => `${problem.level}: ${problem.sentence}`);
}

export function workedOutLines(plan: Plan, workedOut: WorkedOut): readonly string[] {
  if (plan.slices.length === 0) {
    return [plan.title, ...summaryLines(plan, workedOut)];
  }
  return [
    plan.title,
    ...summaryLines(plan, workedOut),
    "",
    "Slices",
    ...plan.slices.flatMap(sliceLines),
    "",
    "Waves",
    ...waveLines(workedOut),
    "",
    "Problems",
    ...problemLines(workedOut),
  ];
}

export function refusedLines(path: string, refusals: readonly Refusal[]): readonly string[] {
  const where = (refusal: Refusal): string => (refusal.line === undefined ? "" : `line ${String(refusal.line)}: `);
  return [
    `${path} is not a plan forge can read, for ${counted(refusals.length, "reason", "reasons")}:`,
    ...refusals.map((refusal) => `${where(refusal)}${refusal.sentence}`),
  ];
}
