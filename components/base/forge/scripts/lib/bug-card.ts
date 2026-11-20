import { patchedFiles, type Bug } from "./planting.ts";
import type { Verdict } from "./proof-answer.ts";

type SurvivedBug = {
  readonly name: string;
  readonly files: readonly string[];
};

export type BugsOnCard = {
  readonly planted: number;
  readonly survived: readonly SurvivedBug[];
};

function survived(bug: Bug, verdicts: readonly Verdict[]): boolean {
  return verdicts.some(
    (verdict) =>
      verdict.kind === "bugs-caught" &&
      verdict.verdict === "failed" &&
      verdict.detail.includes(`A bug survived: ${bug.name}.`),
  );
}

export function bugsOnCard(bugs: readonly Bug[], verdicts: readonly Verdict[], planted: number): BugsOnCard {
  const survivors = bugs.filter((bug) => survived(bug, verdicts));
  return { planted, survived: survivors.map((bug) => ({ name: bug.name, files: patchedFiles(bug.patch) })) };
}
