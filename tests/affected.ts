export type Tier = "mode" | "manifest" | "all";

export type Affected = {
  readonly tier: Tier;
  readonly files: readonly string[];
  readonly why: string;
};

export type Change = {
  readonly changed: readonly string[];
  readonly testFiles: readonly string[];
  readonly modeFolders: readonly string[];
};

export const testsThatOpenTheKit: readonly string[] = [];

export function affectedTests(change: Change): Affected {
  return { tier: "all", files: change.testFiles, why: "" };
}

export function repositoryTestFiles(): readonly string[] {
  return [];
}
